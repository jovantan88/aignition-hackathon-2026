/**
 * The manager's side of ShiftPilot. The manager chats with the same agent on
 * WhatsApp (or the dashboard drawer): ask questions, give goals, approve.
 */
import { generateText, isStepCount, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { approvals, coverRequests, shifts, workers, type Conversation, type Message, type OrgSettings } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { DOW_LONG, addDays, fmtDay, localParts } from "@/lib/time";
import { sendMessage } from "@/whatsapp/send";
import { wa, type OutboundPayload } from "@/whatsapp/types";
import { decideApproval, requestApproval } from "./approvals";
import { calendarLines, messageForModel, recentHistory } from "./context";
import { MODEL_MAIN, hasLLM, mainModel, withRetry } from "./llm";
import { activeMemories, describeShift, firstName, getOrg, orgOutlets, orgWorkers, planningCycle, saveMemory } from "./ops";
import { audit } from "./runs";
import { structuredId } from "./structured";

export async function handleManagerTurn(conv: Conversation, pending: Message[]) {
  const org = await getOrg(conv.orgId);
  const reply = (p: OutboundPayload) => sendMessage({ orgId: conv.orgId, conversationId: conv.id, payload: p, privacy: { purpose: "manager" } });
  const rest: Message[] = [];
  for (const m of pending) {
    const id = structuredId(m);
    if (id?.startsWith("approval:")) {
      const [, action, approvalId, optionId] = id.split(":");
      if (action === "details") {
        const ap = await db.query.approvals.findFirst({ where: eq(approvals.id, approvalId) });
        if (ap) await reply(wa.text(`*${ap.title}*\n\n${ap.summary}\n\nRisk: ${ap.risk} · ${ap.policyReason}\nFull plan and audit trail are on the dashboard.`));
        continue;
      }
      const r = await decideApproval(approvalId, action === "reject" ? "rejected" : "approved", { by: org.managerName, channel: "whatsapp", optionId: action === "choose" ? optionId : undefined });
      await reply(wa.text(r.ok ? (action === "reject" ? "Got it, I won't go ahead with that. ❌" : "Approved ✅ On it.") : "That one was already decided."));
      await sendMessage({ orgId: conv.orgId, conversationId: conv.id, payload: wa.reaction(m.id, action === "reject" ? "👌" : "👍"), privacy: { purpose: "manager" } });
      continue;
    }
    rest.push(m);
  }
  if (!rest.length) return;
  if (!hasLLM()) {
    await reply(wa.text("I need an OpenAI key to chat. Approvals and buttons still work."));
    return;
  }
  await runCopilot(conv, rest);
}

async function snapshot(orgId: string) {
  const t = await now(orgId);
  const local = localParts(t);
  const os = await orgOutlets(orgId);
  const today = await db.select().from(shifts).where(and(eq(shifts.orgId, orgId), eq(shifts.date, local.date)));
  const covers = await db.select().from(coverRequests).where(and(eq(coverRequests.orgId, orgId), inArray(coverRequests.status, ["searching", "offered", "escalated"])));
  const pend = await db.select().from(approvals).where(and(eq(approvals.orgId, orgId), eq(approvals.status, "pending"))).orderBy(desc(approvals.createdAt));
  const cycle = await planningCycle(orgId);
  return {
    now: `${DOW_LONG[local.dow]} ${local.date} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
    outletsToday: os.map((o) => {
      const s = today.filter((x) => x.outletId === o.id && x.status !== "cancelled");
      const filled = s.filter((x) => x.workerId || x.status === "covered").length;
      return `${o.code} ${o.name}: ${filled}/${s.length} filled`;
    }),
    openCovers: covers.length,
    pendingApprovals: pend.map((p) => ({ id: p.id, title: p.title, options: p.options?.map((o) => ({ id: o.id, label: o.label })) })),
    planning: cycle ? { weekStart: cycle.weekStart, status: cycle.status } : null,
  };
}

async function runCopilot(conv: Conversation, msgs: Message[]) {
  const org = await getOrg(conv.orgId);
  const orgId = org.id;
  const t = await now(orgId);
  const local = localParts(t, org.timezone);
  const os = await orgOutlets(orgId);
  const ws = await orgWorkers(orgId);
  const byName = (q: string) => {
    const s = q.toLowerCase().trim();
    return ws.find((w) => w.name.toLowerCase() === s) ?? ws.find((w) => firstName(w.name).toLowerCase() === s) ?? ws.find((w) => w.name.toLowerCase().includes(s));
  };
  let sent = 0;
  const used: string[] = [];
  const log = async (name: string, input: unknown) => {
    used.push(name);
    await audit(orgId, { kind: "tool_call", actor: "agent", title: `Copilot: ${name}`, detail: { input: input as Record<string, unknown> } });
  };

  const tools = {
    ops_snapshot: tool({
      description: "Today's coverage per outlet, open cover searches, pending approvals and planning status.",
      inputSchema: z.object({}),
      execute: async () => {
        await log("ops_snapshot", {});
        return snapshot(orgId);
      },
    }),
    who_is_working: tool({
      description: "Who is rostered on a date (YYYY-MM-DD), optionally at one outlet.",
      inputSchema: z.object({ date: z.string(), outletCode: z.string().optional() }),
      execute: async ({ date, outletCode }) => {
        await log("who_is_working", { date, outletCode });
        const o = outletCode ? os.find((x) => x.code.toLowerCase() === outletCode.toLowerCase() || x.name.toLowerCase().includes(outletCode.toLowerCase())) : null;
        const rows = await db
          .select({ s: shifts, name: workers.name })
          .from(shifts)
          .leftJoin(workers, eq(workers.id, shifts.workerId))
          .where(and(eq(shifts.orgId, orgId), eq(shifts.date, date), o ? eq(shifts.outletId, o.id) : undefined))
          .orderBy(asc(shifts.startsAt));
        const om = new Map(os.map((x) => [x.id, x]));
        return rows.map((r) => ({ shiftId: r.s.id, when: describeShift(r.s, om.get(r.s.outletId)), who: r.name ?? "(open)", status: r.s.status, why: r.s.explanation?.reasons }));
      },
    }),
    find_worker: tool({
      description: "Profile, memory, stats and upcoming shifts for a team member.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        await log("find_worker", { name });
        const w = byName(name);
        if (!w) return { error: "No match" };
        const up = await db
          .select()
          .from(shifts)
          .where(and(eq(shifts.workerId, w.id), gte(shifts.date, local.date), lte(shifts.date, addDays(local.date, 14))))
          .orderBy(asc(shifts.startsAt));
        const om = new Map(os.map((x) => [x.id, x]));
        return {
          name: w.name,
          occupation: w.occupation,
          skills: w.skills,
          hours: `${w.desiredHours}h desired / ${w.maxHours}h max`,
          reliability: w.persona.reliability,
          stats: w.stats,
          memory: (await activeMemories(orgId, w.id, local.date)).map((m) => m.content),
          upcoming: up.map((s) => `${describeShift(s, om.get(s.outletId))} (${s.status})`),
        };
      },
    }),
    start_weekly_planning: tool({
      description: "Start planning next week's roster with the manager's goal. Pauses for approval before messaging anyone.",
      inputSchema: z.object({ goal: z.string() }),
      execute: async ({ goal }) => {
        await log("start_weekly_planning", { goal });
        const { startWeeklyPlanning } = await import("./workflows/weekly");
        const r = await startWeeklyPlanning({ orgId, goal });
        return { ...r, note: r.existing ? "That week is already being planned." : "Started. An approval request has been sent to the manager before anyone is messaged." };
      },
    }),
    decide_approval: tool({
      description: "Approve or reject a pending approval (optionally choosing one of its options).",
      inputSchema: z.object({ approvalId: z.string(), decision: z.enum(["approved", "rejected"]), optionId: z.string().optional() }),
      execute: async (i) => {
        await log("decide_approval", i);
        return decideApproval(i.approvalId, i.decision, { by: org.managerName, channel: "whatsapp", optionId: i.optionId });
      },
    }),
    report_absence_for: tool({
      description: "The manager says a worker can't make a shift (e.g. called the store). Releases it and starts finding cover.",
      inputSchema: z.object({ workerName: z.string(), date: z.string().describe("YYYY-MM-DD"), type: z.enum(["sick", "emergency", "leave", "no_show"]) }),
      execute: async (i) => {
        await log("report_absence_for", i);
        const w = byName(i.workerName);
        if (!w) return { error: "No such worker" };
        const s = await db.query.shifts.findFirst({ where: and(eq(shifts.workerId, w.id), eq(shifts.date, i.date), inArray(shifts.status, ["assigned", "confirmed"])) });
        if (!s) return { error: `${w.name} has no shift on ${i.date}` };
        const { reportAbsence } = await import("./workflows/cover");
        return reportAbsence({ shiftId: s.id, type: i.type, reason: "reported by manager", by: "manager" });
      },
    }),
    add_memory: tool({
      description: "Save something the manager wants the agent to remember about a worker (or the business if no name).",
      inputSchema: z.object({ workerName: z.string().optional(), content: z.string(), kind: z.enum(["fact", "preference", "constraint", "relationship", "behaviour"]) }),
      execute: async (i) => {
        await log("add_memory", i);
        const w = i.workerName ? byName(i.workerName) : null;
        await saveMemory({ orgId, workerId: w?.id ?? null, kind: i.kind, content: i.content, createdBy: "manager" });
        return { saved: true, about: w?.name ?? "the business" };
      },
    }),
    update_policy: tool({
      description: "Change an agent policy setting.",
      inputSchema: z.object({
        key: z.enum(["incentiveCapPerHour", "waveSize", "urgentWaveSize", "offerTimeoutSameDayMin", "offerTimeoutFutureMin", "broadcastApprovalThreshold", "autoApproveSwaps", "requireMcPhoto"]),
        value: z.union([z.number(), z.boolean()]),
      }),
      execute: async (i) => {
        await log("update_policy", i);
        const settings = { ...org.settings, [i.key]: i.value } as OrgSettings;
        await db.update((await import("@/db/schema")).orgs).set({ settings }).where(eq((await import("@/db/schema")).orgs.id, orgId));
        await emit(orgId, "approval.decided", {});
        return { ok: true, [i.key]: i.value };
      },
    }),
    send_announcement: tool({
      description: "Draft an announcement to outlet group(s). It is only sent after the manager approves.",
      inputSchema: z.object({ outletCodes: z.array(z.string()).describe("['ALL'] for every outlet"), text: z.string() }),
      execute: async (i) => {
        await log("send_announcement", i);
        const targets = i.outletCodes.includes("ALL") ? os : os.filter((o) => i.outletCodes.some((c) => c.toLowerCase() === o.code.toLowerCase()));
        await requestApproval({
          orgId,
          kind: "announcement",
          title: `Announcement to ${targets.map((o) => o.code).join(", ")}`,
          summary: i.text,
          action: { type: "announcement.send", outletIds: targets.map((o) => o.id), text: i.text },
          risk: "low",
          policyReason: "Group announcements are sent only after approval",
        });
        sent++;
        return { ok: true, note: "Approval card sent to the manager with Approve / Reject buttons." };
      },
    }),
    send_reply: tool({
      description: "Reply to the manager. Up to 3 messages.",
      inputSchema: z.object({
        messages: z
          .array(
            z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("text"), text: z.string() }),
              z.object({ kind: z.literal("buttons"), text: z.string(), buttons: z.array(z.object({ id: z.string(), title: z.string() })).min(1).max(3) }),
            ]),
          )
          .min(1)
          .max(3),
      }),
      execute: async ({ messages: ms }) => {
        for (const m of ms) {
          const r = await sendMessage({ orgId, conversationId: conv.id, payload: m.kind === "text" ? wa.text(m.text) : wa.buttons(m.text, m.buttons), privacy: { purpose: "manager" } });
          if (!r.ok) return { error: r.error };
          sent++;
        }
        return { sent: ms.length };
      },
    }),
  };

  const instructions = `You are ShiftPilot, the AI shift manager for ${org.name}. You're chatting with ${org.managerName}, the manager, on WhatsApp. Be concise and specific, like a sharp ops lead reporting to their boss. Use *bold* for key numbers. Use tools for facts; never guess numbers.
You can: summarise operations, say who's working, explain why someone was picked (shift explanations), start weekly planning from a goal, approve/reject pending approvals when the manager says so, release a shift when the manager reports an absence, remember things, change policy, and draft announcements (which need their approval).
Finish with send_reply.

Now: ${DOW_LONG[local.dow]} ${local.date} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")} (Singapore).
Calendar:
${calendarLines(local.date, 10)}
Outlets: ${os.map((o) => `${o.code}=${o.name}`).join(", ")}. Team: ${ws.length} part-timers.`;

  const history = (await recentHistory(conv.id, 16)).filter((m) => !msgs.some((x) => x.id === m.id));
  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.direction === "in" ? ("user" as const) : ("assistant" as const), content: messageForModel(m) })),
    { role: "user", content: msgs.map(messageForModel).join("\n") },
  ];
  const t0 = Date.now();
  try {
    const result = await withRetry(() => generateText({ model: mainModel(), instructions, messages, tools, stopWhen: isStepCount(8), reasoning: "low" }), 2);
    if (!sent && result.text.trim()) await sendMessage({ orgId, conversationId: conv.id, payload: wa.text(result.text.trim()), privacy: { purpose: "manager" } });
    await audit(orgId, { kind: "llm", title: "Answered the manager", detail: { model: MODEL_MAIN, tools: used }, latencyMs: Date.now() - t0, tokens: result.usage?.totalTokens });
  } catch (e) {
    await audit(orgId, { kind: "error", title: "Copilot failed to answer", detail: { error: String(e) } });
    await sendMessage({ orgId, conversationId: conv.id, payload: wa.text("Sorry, I hit an error answering that. Try again in a moment?"), privacy: { purpose: "manager" } });
  }
}

export { fmtDay };
