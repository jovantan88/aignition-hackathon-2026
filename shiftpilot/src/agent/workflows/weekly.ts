/**
 * Weekly planning: a goal-driven run with a visible plan.
 * goal → demand → memory check → [approval] → ask everyone → collect → remind
 * → solve → negotiate → [approval] → publish → confirmations
 */
import { generateText, Output } from "ai";
import { z } from "zod";
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { availability, messages, planningCycles, shiftTemplates, shifts, type DemandOverride, type PlanningCycle } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { DOW_SHORT, addDays, atLocal, dowOf, fmtDay, fmtShortDate, isoWeek, localParts, toMinutes, weekDates, weekStartOf } from "@/lib/time";
import { availabilityFlow } from "@/whatsapp/flows";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { solve, type SolverAvailability, type SolverSlot, type SolverWorker } from "../solver";
import { requestApproval } from "../approvals";
import { schedule } from "../jobs";
import { hasLLM, mainModel, withRetry } from "../llm";
import { activeMemories, describeShift, dmFor, firstName, getOrg, groupConv, notifyManager, orgOutlets, orgWorkers, recurringFor } from "../ops";
import { addRunMetric, advanceTo, audit, finishRun, setStep, startRun } from "../runs";

export const WEEKLY_STEPS = [
  "Understand the goal",
  "Build demand for every outlet",
  "Check memory for known constraints",
  "Get approval to message the team",
  "Ask everyone for availability",
  "Collect and read replies",
  "Chase people who haven't replied",
  "Solve the roster",
  "Negotiate gaps and spare hours",
  "Get approval to publish",
  "Publish and collect confirmations",
];

export async function getCycle(id: string) {
  return db.query.planningCycles.findFirst({ where: eq(planningCycles.id, id) });
}

const weekLabelOf = (ws: string) => `week of ${fmtShortDate(ws)}`;

/** Templates + manager overrides → one slot per headcount */
export async function buildSlots(orgId: string, weekStart: string, overrides: DemandOverride[]): Promise<SolverSlot[]> {
  const os = await orgOutlets(orgId);
  const tpls = await db.select().from(shiftTemplates).where(inArray(shiftTemplates.outletId, os.map((o) => o.id)));
  const slots: SolverSlot[] = [];
  for (const t of tpls) {
    const date = addDays(weekStart, t.dow);
    let headcount = t.headcount;
    for (const ov of overrides) {
      if (ov.outletId !== t.outletId) continue;
      if (ov.date && ov.date !== date) continue;
      if (ov.dow != null && ov.dow !== t.dow) continue;
      if (ov.label && ov.label.toLowerCase() !== t.label.toLowerCase()) continue;
      if (ov.closed) headcount = 0;
      else if (ov.delta) headcount = Math.max(0, headcount + ov.delta);
    }
    for (let i = 0; i < headcount; i++) {
      slots.push({ id: `${t.id}_${date}_${i}`, outletId: t.outletId, date, startMin: toMinutes(t.startTime), endMin: toMinutes(t.endTime), label: t.label, skill: t.skill });
    }
  }
  return slots.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

async function parseGoal(orgId: string, goal: string, weekStart: string) {
  const os = await orgOutlets(orgId);
  const tpls = await db.select().from(shiftTemplates).where(inArray(shiftTemplates.outletId, os.map((o) => o.id)));
  const labels = [...new Set(tpls.map((t) => `${t.label} (${t.startTime}–${t.endTime}, ${t.skill})`))];
  if (!hasLLM() || !goal.trim()) return { overrides: [] as DemandOverride[], understood: ["Use the standard shift templates for every outlet"] };
  const { output } = await withRetry(() =>
    generateText({
      model: mainModel(),
      reasoning: "low",
      output: Output.object({
        schema: z.object({
          understood: z.array(z.string()).describe("Plain-English bullet points of what you understood, 1 per instruction"),
          overrides: z.array(
            z.object({
              outletCode: z.string(),
              dates: z.array(z.string()).describe("YYYY-MM-DD within the week; empty = every day"),
              label: z.string().nullable().describe("Template label to change, or null for all shifts"),
              delta: z.number().int().nullable().describe("Extra (+) or fewer (-) people per matching shift"),
              closed: z.boolean(),
              note: z.string(),
            }),
          ),
        }),
      }),
      prompt: `A café manager gave this goal for planning the week ${weekStart} to ${addDays(weekStart, 6)}:\n"${goal}"\n\nOutlets: ${os.map((o) => `${o.code}=${o.name}`).join(", ")}\nShift templates: ${labels.join("; ")}\nDays: ${weekDates(weekStart).map((d) => `${DOW_SHORT[dowOf(d)]} ${d}`).join(", ")}\n\nConvert it into demand overrides on top of the standard templates. "Busier afternoon"/"promo" usually means more people on Lunch peak; "closed" means closed=true. If the goal is just "plan next week", return no overrides.`,
    }),
  );
  const byCode = new Map(os.map((o) => [o.code.toUpperCase(), o.id]));
  const overrides: DemandOverride[] = [];
  for (const o of output?.overrides ?? []) {
    const outletId = byCode.get(o.outletCode.toUpperCase()) ?? os.find((x) => x.name.toLowerCase().includes(o.outletCode.toLowerCase()))?.id;
    if (!outletId) continue;
    const base = { outletId, label: o.label ?? undefined, delta: o.delta ?? undefined, closed: o.closed, note: o.note };
    if (o.dates.length) for (const d of o.dates) overrides.push({ ...base, date: d });
    else overrides.push(base);
  }
  return { overrides, understood: output?.understood ?? [] };
}

/** Manager gives a goal: start the weekly run and stop at the first approval gate */
export async function startWeeklyPlanning(o: { orgId: string; goal: string }) {
  const org = await getOrg(o.orgId);
  const t = await now(o.orgId);
  const today = localParts(t, org.timezone).date;
  const weekStart = addDays(weekStartOf(today), 7);
  const existing = await db.query.planningCycles.findFirst({ where: and(eq(planningCycles.orgId, o.orgId), eq(planningCycles.weekStart, weekStart)) });
  if (existing && existing.status !== "draft") return { cycleId: existing.id, runId: existing.runId, existing: true };
  if (existing) await db.delete(planningCycles).where(eq(planningCycles.id, existing.id));

  const cycleId = newId("cyc");
  const wk = isoWeek(weekStart);
  const runId = await startRun({ orgId: o.orgId, kind: "weekly", title: `Weekly roster · Week ${wk}`, goal: o.goal, steps: WEEKLY_STEPS, subjectId: cycleId });
  const deadline = new Date(Math.max(atLocal(addDays(weekStart, -3), "22:00").getTime(), t.getTime() + 24 * 3600_000));
  await db.insert(planningCycles).values({ id: cycleId, orgId: o.orgId, weekStart, status: "draft", goal: o.goal, runId, deadlineAt: deadline, demandOverrides: [] });
  await emit(o.orgId, "cycle.updated", { cycleId });

  // 1. Understand the goal
  await advanceTo(runId, 1, "Reading the goal…");
  let parsed: Awaited<ReturnType<typeof parseGoal>>;
  try {
    parsed = await parseGoal(o.orgId, o.goal, weekStart);
  } catch (e) {
    await audit(o.orgId, { runId, kind: "error", title: "Couldn't parse the goal, using standard templates", detail: { error: String(e) } });
    parsed = { overrides: [], understood: ["Use the standard shift templates (goal parsing failed, retry from the dashboard if needed)"] };
  }
  await db.update(planningCycles).set({ demandOverrides: parsed.overrides }).where(eq(planningCycles.id, cycleId));
  await setStep(runId, 1, "done", parsed.understood.join(" · "));
  await audit(o.orgId, { runId, kind: "decision", title: "Understood the goal", detail: { understood: parsed.understood, overrides: parsed.overrides } });

  // 2. Demand
  await advanceTo(runId, 2);
  const slots = await buildSlots(o.orgId, weekStart, parsed.overrides);
  const hours = slots.reduce((h, s) => h + (s.endMin - s.startMin) / 60, 0);
  const os = await orgOutlets(o.orgId);
  await setStep(runId, 2, "done", `${slots.length} shifts (${Math.round(hours)}h) across ${os.length} outlet${os.length > 1 ? "s" : ""}, ${fmtDay(weekStart)} – ${fmtDay(addDays(weekStart, 6))}`);

  // 3. Memory check
  await advanceTo(runId, 3);
  const ws = await orgWorkers(o.orgId);
  const notes: string[] = [];
  for (const w of ws) {
    const mems = await activeMemories(o.orgId, w.id, weekStart);
    for (const m of mems) {
      if (m.kind === "constraint" && /exam|weekend|finals|NS|holiday|max|class|knee|last bus/i.test(m.content)) notes.push(`${firstName(w.name)}: ${m.content}`);
    }
    for (const r of await recurringFor(w.id)) notes.push(`${firstName(w.name)}: ${r.description}`);
  }
  await setStep(runId, 3, "done", notes.length ? notes.slice(0, 6).join(" · ") + (notes.length > 6 ? ` · +${notes.length - 6} more` : "") : "Nothing unusual on file");
  await audit(o.orgId, { runId, kind: "memory", title: `Checked memory: ${notes.length} things to keep in mind`, detail: { notes } });

  // 4. Approval to broadcast
  await advanceTo(runId, 4);
  await setStep(runId, 4, "waiting", `Waiting for ${org.managerName.split(" ")[0]} to approve`);
  await requestApproval({
    orgId: o.orgId,
    runId,
    kind: "broadcast",
    title: `Ask ${ws.length} part-timers for week ${wk} availability`,
    summary: `I'll message ${ws.length} people privately with the availability form (they can also just reply in their own words). Deadline: ${deadline.toLocaleString("en-SG", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: org.timezone })}.\n\nDemand: ${slots.length} shifts. ${parsed.understood.join(" ")}`,
    action: { type: "weekly.broadcast", cycleId },
    risk: "low",
    policyReason: `Messages to more than ${org.settings.broadcastApprovalThreshold} people need approval`,
  });
  return { cycleId, runId, existing: false };
}

function deadlineLabel(c: PlanningCycle, tz: string) {
  return c.deadlineAt ? c.deadlineAt.toLocaleString("en-SG", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz }) : "soon";
}

async function sendAvailabilityAsk(c: PlanningCycle, workerId: string, kind: "ask" | "reminder") {
  const org = await getOrg(c.orgId);
  const w = (await orgWorkers(c.orgId)).find((x) => x.id === workerId);
  const conv = await dmFor(workerId);
  if (!w || !conv) return null;
  const os = await orgOutlets(c.orgId);
  const data = { weekLabel: weekLabelOf(c.weekStart), dates: weekDates(c.weekStart), outlets: os.map((o) => ({ id: o.code, title: o.name })) };
  availabilityFlow(data); // validates the flow definition
  const flowToken = `avail:${c.id}:${w.id}`;
  const dl = deadlineLabel(c, org.timezone);
  const text =
    kind === "ask"
      ? `Hi ${firstName(w.name)}! I'm planning the ${org.name} roster for the *${weekLabelOf(c.weekStart)}*. Tap below to tell me when you can work, or just reply in your own words (e.g. "Mon–Wed after 5, Sat whole day"). Please reply by *${dl}* 🙏`
      : `Hi ${firstName(w.name)}, gentle reminder: I still need your availability for the *${weekLabelOf(c.weekStart)}*. It takes 30 seconds 🙏 Deadline *${dl}*.`;
  return sendMessage({
    orgId: c.orgId,
    conversationId: conv.id,
    runId: c.runId,
    payload: wa.flow(text, "Fill availability", "flow_availability", flowToken, "DAYS", data, { header: kind === "ask" ? `Availability · ${weekLabelOf(c.weekStart)}` : undefined }),
    template: {
      name: kind === "ask" ? "weekly_availability" : "availability_reminder",
      params:
        kind === "ask"
          ? {
              header: [weekLabelOf(c.weekStart)],
              body: [firstName(w.name), org.name, `the ${weekLabelOf(c.weekStart)}`, dl],
              buttonPayloads: [{ flowId: "flow_availability", flowToken, screen: "DAYS", data }],
            }
          : {
              body: [firstName(w.name), `the ${weekLabelOf(c.weekStart)}`, dl],
              buttonPayloads: [{ flowId: "flow_availability", flowToken, screen: "DAYS", data }, `avail:none:${c.id}`],
            },
    },
    privacy: { purpose: "broadcast" },
    proactive: true,
    auditTitle: `${kind === "ask" ? "Asked" : "Reminded"} ${w.name} for availability`,
    manualMinutes: kind === "ask" ? org.settings.baselines.availabilityAsk : org.settings.baselines.reminder,
  });
}

/** Approved: message everyone, schedule persona replies, reminders and the deadline */
export async function broadcastAvailability(cycleId: string) {
  const c = (await getCycle(cycleId))!;
  const org = await getOrg(c.orgId);
  const t = await now(c.orgId);
  // The deadline always falls after the last reminder
  const lastReminderH = Math.max(0, ...org.settings.reminderHours);
  const deadlineAt = new Date(Math.max(c.deadlineAt?.getTime() ?? 0, t.getTime() + (lastReminderH + 4) * 3600_000));
  await db.update(planningCycles).set({ status: "collecting", kickoffAt: t, deadlineAt }).where(eq(planningCycles.id, cycleId));
  c.deadlineAt = deadlineAt;
  if (c.runId) {
    await setStep(c.runId, 4, "done", "Approved by the manager");
    await advanceTo(c.runId, 5, "Sending…");
  }
  const ws = await orgWorkers(c.orgId);
  let viaTemplate = 0;
  let held = 0;
  for (const w of ws) {
    const r = await sendAvailabilityAsk(c, w.id, "ask");
    if (r?.ok && r.viaTemplate) viaTemplate++;
    if (r?.ok && r.queued) held++;
    // People can only reply once the message actually reaches them
    const base = r?.ok ? r.deliverAt : t;
    if (w.autopilot) {
      const resp = w.persona.responsiveness;
      // Fast responders reply within a couple of real minutes; slow ones need reminders
      const silent = resp < 0.55 && Math.random() < 0.6;
      if (!silent) {
        const delaySec = resp >= 0.8 ? 12 + Math.random() * 100 : resp >= 0.65 ? 90 + Math.random() * 300 : 3600 * (6 + Math.random() * 14);
        await schedule(c.orgId, "persona.availability", new Date(base.getTime() + delaySec * 1000), { cycleId, workerId: w.id }, `persona:avail:${cycleId}:${w.id}`);
      }
    }
  }
  for (const [i, h] of org.settings.reminderHours.entries()) {
    await schedule(c.orgId, "availability.reminder", new Date(t.getTime() + h * 3600_000), { cycleId, n: i + 1 }, `cycle:${cycleId}:reminder:${i + 1}`);
  }
  if (c.deadlineAt) await schedule(c.orgId, "cycle.deadline", c.deadlineAt, { cycleId }, `cycle:${cycleId}:deadline`);
  if (c.runId) {
    await setStep(
      c.runId,
      5,
      "done",
      `Sent to ${ws.length} people (${viaTemplate} as approved templates because their 24h window was closed)${held ? `; ${held} held for quiet hours until ${org.settings.quietEnd}` : ""}`,
    );
    await setStep(c.runId, 6, "running", `0/${ws.length} replied`);
    await addRunMetric(c.runId, "messagesSent", ws.length);
  }
  await emit(c.orgId, "cycle.updated", { cycleId });
}

/** Workers who have written to us since the ask went out (their reply may still be being read) */
export async function wroteSinceKickoff(c: PlanningCycle) {
  if (!c.kickoffAt) return new Set<string>();
  const rows = await db
    .selectDistinct({ workerId: messages.senderWorkerId })
    .from(messages)
    .where(and(eq(messages.orgId, c.orgId), eq(messages.direction, "in"), sql`${messages.createdAt} >= ${c.kickoffAt.toISOString()}`));
  return new Set(rows.map((r) => r.workerId).filter(Boolean) as string[]);
}

export async function responders(cycleId: string) {
  const rows = await db
    .selectDistinct({ workerId: availability.workerId })
    .from(availability)
    .where(and(eq(availability.cycleId, cycleId), inArray(availability.source, ["flow", "text"])));
  return new Set(rows.map((r) => r.workerId));
}

export async function onAvailabilitySubmitted(cycleId: string, workerId: string, source: "flow" | "text") {
  const c = await getCycle(cycleId);
  if (!c) return;
  const ws = await orgWorkers(c.orgId);
  const got = await responders(cycleId);
  if (c.runId) {
    await setStep(c.runId, 6, c.status === "collecting" ? "running" : "done", `${got.size}/${ws.length} replied${source === "text" ? " (latest in free text)" : ""}`);
    await addRunMetric(c.runId, source === "text" ? "repliesParsedText" : "repliesForm", 1);
  }
  await emit(c.orgId, "cycle.updated", { cycleId, workerId, replied: got.size, total: ws.length });
  if (c.status === "collecting" && got.size >= ws.length) {
    await schedule(c.orgId, "cycle.deadline", await now(c.orgId), { cycleId }, `cycle:${cycleId}:deadline:all`);
    void import("../jobs").then((m) => m.tick(c.orgId));
  }
  if (c.status !== "collecting" && c.status !== "draft") {
    await audit(c.orgId, { runId: c.runId, kind: "decision", title: "Late availability reply: added to the standby pool for gaps" });
  }
}

export async function sendReminders(cycleId: string, n: number) {
  const c = await getCycle(cycleId);
  if (!c || c.status !== "collecting") return;
  const org = await getOrg(c.orgId);
  const ws = await orgWorkers(c.orgId);
  const got = await responders(cycleId);
  const wrote = await wroteSinceKickoff(c);
  const silent = ws.filter((w) => !got.has(w.id) && !wrote.has(w.id));
  if (c.runId) await setStep(c.runId, 7, "running", `Reminder ${n}: ${silent.length} people`);
  const t = await now(c.orgId);
  for (const w of silent) {
    await sendAvailabilityAsk(c, w.id, "reminder");
    if (w.autopilot && Math.random() < (n === 1 ? 0.75 : 0.5)) {
      await schedule(c.orgId, "persona.availability", new Date(t.getTime() + (20 + Math.random() * 160) * 1000), { cycleId, workerId: w.id }, `persona:avail:${cycleId}:${w.id}:r${n}`);
    }
  }
  const last = n >= org.settings.reminderHours.length;
  if (c.runId) await setStep(c.runId, 7, last ? "done" : "running", `Reminder ${n} sent to ${silent.length}: ${silent.slice(0, 5).map((w) => firstName(w.name)).join(", ")}${silent.length > 5 ? "…" : ""}`);
  if (last && silent.length) {
    await notifyManager(c.orgId, `FYI: ${silent.length} ${silent.length === 1 ? "person hasn't" : "people haven't"} replied about the ${weekLabelOf(c.weekStart)} after ${n} reminders (${silent.map((w) => firstName(w.name)).join(", ")}). I'll plan without them and slot them in if they reply late.`);
  }
}

async function solverWorkers(orgId: string, weekStart: string): Promise<SolverWorker[]> {
  const ws = await orgWorkers(orgId);
  const os = await orgOutlets(orgId);
  const byFirst = new Map(ws.map((w) => [firstName(w.name).toLowerCase(), w.id]));
  const out: SolverWorker[] = [];
  for (const w of ws) {
    const mems = await activeMemories(orgId, w.id, weekStart);
    const likes: string[] = [];
    const avoids: string[] = [];
    const preferredOutletIds: string[] = [];
    const avoidOutletIds: string[] = [];
    for (const m of mems) {
      const name = m.content.match(/with (\w+)/i)?.[1]?.toLowerCase();
      if (name && byFirst.has(name)) {
        if (/not|avoid|rather/i.test(m.content)) avoids.push(byFirst.get(name)!);
        else if (/like|well|love/i.test(m.content)) likes.push(byFirst.get(name)!);
      }
      for (const o of os) {
        if (!m.content.includes(o.name)) continue;
        if (/rather not|avoid/i.test(m.content)) avoidOutletIds.push(o.id);
        else if (/prefer/i.test(m.content)) preferredOutletIds.push(o.id);
      }
    }
    const maxMem = mems.find((m) => /^Max (\d+)h/.test(m.content))?.content.match(/^Max (\d+)h/)?.[1];
    out.push({
      id: w.id,
      name: w.name,
      skills: w.skills,
      maxHours: maxMem ? Math.min(Number(maxMem), w.maxHours) : w.maxHours,
      desiredHours: maxMem ? Math.min(Number(maxMem), w.desiredHours) : w.desiredHours,
      homeLat: w.homeLat,
      homeLng: w.homeLng,
      homeOutletId: w.homeOutletId,
      reliability: w.persona.reliability,
      likes,
      avoids,
      preferredOutletIds,
      avoidOutletIds,
    });
  }
  return out;
}

/** Deadline reached (or everyone replied): solve and move to negotiation */
export async function solveCycle(cycleId: string) {
  const c = await getCycle(cycleId);
  if (!c || !["collecting", "solving"].includes(c.status)) return;
  const org = await getOrg(c.orgId);
  await db.update(planningCycles).set({ status: "solving" }).where(eq(planningCycles.id, cycleId));
  if (c.runId) await advanceTo(c.runId, 8, "Waiting for the last replies to be read…");
  // Don't solve while replies are still being read by the agent
  for (let i = 0; i < 45; i++) {
    const inflight = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.orgId, c.orgId), eq(messages.direction, "in"), isNull(messages.processedAt), ne(messages.type, "reaction")));
    if (!inflight[0]?.n) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (c.runId) await setStep(c.runId, 8, "running", "Running the solver…");
  const t0 = Date.now();

  const slots = await buildSlots(c.orgId, c.weekStart, c.demandOverrides);
  const workers = await solverWorkers(c.orgId, c.weekStart);
  const os = await orgOutlets(c.orgId);
  const avail = (await db.select().from(availability).where(eq(availability.cycleId, cycleId))) as SolverAvailability[];
  // Recurring constraints become unavailable windows for that week
  for (const w of workers) {
    for (const r of await recurringFor(w.id)) {
      if (r.kind !== "unavailable") continue;
      for (const date of weekDates(c.weekStart)) {
        if (!r.dows.includes(dowOf(date))) continue;
        if ((r.validFrom && date < r.validFrom) || (r.validTo && date > r.validTo)) continue;
        avail.push({ workerId: w.id, date, startMin: r.startMin, endMin: r.endMin, kind: "unavailable" });
      }
    }
  }
  const result = solve({ slots, workers, outlets: os, availability: avail });

  await db.delete(shifts).where(and(eq(shifts.cycleId, cycleId), inArray(shifts.status, ["draft", "open"])));
  const byId = new Map(result.assignments.map((a) => [a.slotId, a]));
  const rows = slots.map((s) => {
    const a = byId.get(s.id);
    return {
      id: newId("shf"),
      orgId: c.orgId,
      cycleId,
      outletId: s.outletId,
      date: s.date,
      startsAt: atLocal(s.date, s.startMin, org.timezone),
      endsAt: atLocal(s.date, s.endMin, org.timezone),
      label: s.label,
      skill: s.skill,
      status: (a ? "draft" : "open") as "draft" | "open",
      workerId: a?.workerId ?? null,
      explanation: a ? { score: a.score, reasons: a.reasons, alternatives: a.alternatives } : null,
      source: "solver" as const,
    };
  });
  for (let i = 0; i < rows.length; i += 200) await db.insert(shifts).values(rows.slice(i, i + 200));
  const summary = { ...result.stats, shortages: result.shortages.length, surplus: result.surplus.map((s) => ({ name: s.name, assigned: s.assignedHours, desired: s.desiredHours })), shortageDetail: result.shortages.slice(0, 20) };
  await db.update(planningCycles).set({ solveSummary: summary }).where(eq(planningCycles.id, cycleId));

  const pct = Math.round(result.stats.coverage * 100);
  if (c.runId) {
    await setStep(c.runId, 6, "done");
    await setStep(c.runId, 7, "done");
    await setStep(c.runId, 8, "done", `${result.stats.filled}/${result.stats.slots} filled (${pct}%) in ${Date.now() - t0} ms · ${result.shortages.length} gaps · ${result.surplus.length} people under their hours · 0 rule violations`);
  }
  await audit(c.orgId, {
    runId: c.runId,
    kind: "decision",
    title: `Solved the roster: ${pct}% filled, ${result.shortages.length} gaps`,
    detail: { stats: result.stats, shortages: result.shortages.slice(0, 12) },
    manualMinutes: org.settings.baselines.rosterBuildPerOutlet * os.length,
    latencyMs: Date.now() - t0,
  });
  await emit(c.orgId, "shift.updated", { cycleId });
  await emit(c.orgId, "cycle.updated", { cycleId });

  if (result.shortages.length || result.surplus.length) {
    await db.update(planningCycles).set({ status: "negotiating" }).where(eq(planningCycles.id, cycleId));
    const { startNegotiation } = await import("./negotiate");
    await startNegotiation(cycleId);
  } else {
    await requestPublish(cycleId);
  }
}

export async function requestPublish(cycleId: string) {
  const c = await getCycle(cycleId);
  if (!c || !["negotiating", "solving"].includes(c.status)) return;
  const org = await getOrg(c.orgId);
  await db.update(planningCycles).set({ status: "awaiting_approval" }).where(eq(planningCycles.id, cycleId));
  const all = await db.select().from(shifts).where(eq(shifts.cycleId, cycleId));
  const filled = all.filter((s) => s.workerId);
  const gaps = all.filter((s) => !s.workerId);
  const os = new Map((await orgOutlets(c.orgId)).map((o) => [o.id, o]));
  const people = new Set(filled.map((s) => s.workerId));
  if (c.runId) {
    await setStep(c.runId, 9, "done");
    await advanceTo(c.runId, 10);
    await setStep(c.runId, 10, "waiting", `Waiting for ${org.managerName.split(" ")[0]} to approve`);
  }
  await requestApproval({
    orgId: c.orgId,
    runId: c.runId,
    kind: "publish_roster",
    title: `Publish week ${isoWeek(c.weekStart)} roster`,
    summary: `${filled.length}/${all.length} shifts filled (${Math.round((filled.length / Math.max(1, all.length)) * 100)}%) for ${people.size} people.${gaps.length ? `\nStill open: ${gaps.slice(0, 5).map((g) => `${os.get(g.outletId)?.code} ${fmtDay(g.date).slice(0, 3)} ${g.label}`).join(", ")}${gaps.length > 5 ? ` +${gaps.length - 5} more` : ""}. I'll keep trying to fill these after publishing.` : "\nNo gaps."}\n\nPublishing sends everyone their shifts privately and posts each outlet's crew in its group.`,
    action: { type: "weekly.publish", cycleId },
    risk: "medium",
    policyReason: "Publishing the roster always needs manager approval",
  });
  await emit(c.orgId, "cycle.updated", { cycleId });
}

/** Approved: send everyone their shifts */
export async function publishCycle(cycleId: string) {
  const c = (await getCycle(cycleId))!;
  const org = await getOrg(c.orgId);
  const t = await now(c.orgId);
  if (c.runId) {
    await setStep(c.runId, 10, "done", "Approved by the manager");
    await advanceTo(c.runId, 11, "Sending rosters…");
  }
  await db.update(shifts).set({ status: "assigned" }).where(and(eq(shifts.cycleId, cycleId), eq(shifts.status, "draft")));
  await db.update(planningCycles).set({ status: "published", publishedAt: t }).where(eq(planningCycles.id, cycleId));
  const all = await db.select().from(shifts).where(and(eq(shifts.cycleId, cycleId), isNotNull(shifts.workerId)));
  const os = new Map((await orgOutlets(c.orgId)).map((o) => [o.id, o]));
  const ws = await orgWorkers(c.orgId);
  const got = await responders(cycleId);
  let sent = 0;
  for (const w of ws) {
    const mine = all.filter((s) => s.workerId === w.id).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const conv = await dmFor(w.id);
    if (!conv) continue;
    if (!mine.length && !got.has(w.id)) continue;
    const lines = mine.map((s) => `• ${describeShift(s, os.get(s.outletId))}`);
    const img = `/api/og/roster?worker=${w.id}&week=${c.weekStart}`;
    const text = mine.length
      ? `Hi ${firstName(w.name)}, your shifts for the *${weekLabelOf(c.weekStart)}*:\n\n${lines.join("\n")}\n\nTap *Confirm* so the team knows you've seen it.`
      : `Hi ${firstName(w.name)}, no shifts for you in the ${weekLabelOf(c.weekStart)} this time. I'll message you first if something opens up 🙏`;
    await sendMessage({
      orgId: c.orgId,
      conversationId: conv.id,
      runId: c.runId,
      payload: mine.length
        ? {
            type: "interactive",
            interactive: {
              type: "button",
              header: { type: "image", image: { link: img } },
              body: { text },
              footer: { text: "Reply anytime to swap or ask" },
              action: {
                buttons: [
                  { type: "reply", reply: { id: `roster:confirm:${cycleId}`, title: "Confirm ✅" } },
                  { type: "reply", reply: { id: `roster:problem:${cycleId}`, title: "Problem with a shift" } },
                ],
              },
            },
          }
        : wa.buttons(text, [
            { id: `roster:standby:${cycleId}`, title: "Put me on standby" },
            { id: `roster:ok:${cycleId}`, title: "OK, thanks" },
          ]),
      template: mine.length
        ? { name: "roster_published", params: { headerImage: img, body: [firstName(w.name), `the ${weekLabelOf(c.weekStart)}`, lines.join("\n")], buttonPayloads: [`roster:confirm:${cycleId}`, `roster:problem:${cycleId}`] } }
        : { name: "roster_none", params: { body: [firstName(w.name), `the ${weekLabelOf(c.weekStart)}`, ""], buttonPayloads: [`roster:standby:${cycleId}`, `roster:ok:${cycleId}`] } },
      privacy: { purpose: "notify", recipientIsSubject: true },
      proactive: true,
      auditTitle: `Sent ${w.name} their roster (${mine.length} shifts)`,
      manualMinutes: org.settings.baselines.rosterPublishPerPerson,
    });
    sent++;
    if (w.autopilot && mine.length) {
      await schedule(c.orgId, "persona.confirm", new Date(t.getTime() + (15 + Math.random() * 240) * 1000), { cycleId, workerId: w.id }, `persona:confirm:${cycleId}:${w.id}`);
    }
  }
  for (const o of os.values()) {
    const crew = [...new Set(all.filter((s) => s.outletId === o.id).map((s) => s.workerId!))].map((id) => firstName(ws.find((w) => w.id === id)?.name ?? ""));
    const grp = await groupConv(o.id);
    if (grp && crew.length)
      await sendMessage({
        orgId: c.orgId,
        conversationId: grp.id,
        runId: c.runId,
        payload: wa.text(`📋 Roster for the ${weekLabelOf(c.weekStart)} is out!\n\n${o.name} crew: ${crew.join(", ")}.\n\nYour own shifts are in your DMs. Swaps and questions → message me directly 🙏`),
        privacy: { purpose: "broadcast" },
      });
  }
  await schedule(c.orgId, "cycle.chase", new Date(t.getTime() + 12 * 3600_000), { cycleId }, `cycle:${cycleId}:chase`);
  if (c.runId) {
    await setStep(c.runId, 11, "done", `Sent to ${sent} people, posted in ${os.size} outlet group${os.size > 1 ? "s" : ""}. Waiting for confirmations.`);
    await addRunMetric(c.runId, "rostersSent", sent);
    const filled = all.length;
    const total = (await db.select({ n: sql<number>`count(*)::int` }).from(shifts).where(eq(shifts.cycleId, cycleId)))[0].n;
    await finishRun(c.runId, `Week ${isoWeek(c.weekStart)} published: ${filled}/${total} shifts filled for ${new Set(all.map((s) => s.workerId)).size} people.`);
  }
  await emit(c.orgId, "cycle.updated", { cycleId });
  await emit(c.orgId, "shift.updated", { cycleId });
}

/** 12h after publishing: nudge anyone who hasn't confirmed */
export async function chaseConfirmations(cycleId: string) {
  const c = await getCycle(cycleId);
  if (!c || c.status !== "published") return;
  const rows = await db.select().from(shifts).where(and(eq(shifts.cycleId, cycleId), eq(shifts.status, "assigned")));
  const ids = [...new Set(rows.map((r) => r.workerId!).filter(Boolean))];
  for (const id of ids) {
    const conv = await dmFor(id);
    const w = (await orgWorkers(c.orgId)).find((x) => x.id === id);
    if (!conv || !w) continue;
    await sendMessage({
      orgId: c.orgId,
      conversationId: conv.id,
      runId: c.runId,
      payload: wa.buttons(`Hi ${firstName(w.name)}, just checking you saw your shifts for the ${weekLabelOf(c.weekStart)}?`, [
        { id: `roster:confirm:${cycleId}`, title: "Confirm ✅" },
        { id: `roster:problem:${cycleId}`, title: "Problem with a shift" },
      ]),
      template: { name: "update_available", params: { body: [firstName(w.name)], buttonPayloads: ["window:open"] } },
      proactive: true,
      auditTitle: `Chased ${w.name} to confirm their roster`,
    });
  }
  await audit(c.orgId, { runId: c.runId, kind: "decision", title: `Chased ${ids.length} people who hadn't confirmed` });
}

