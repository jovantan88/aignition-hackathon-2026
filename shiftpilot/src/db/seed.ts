import { sql } from "drizzle-orm";
import { firstName } from "@/lib/names";
import { db } from "./index";
import * as s from "./schema";
import {
  AREAS,
  DEFAULT_SETTINGS,
  KOPI,
  KOPI_OUTLETS,
  KOPI_TEMPLATES,
  KOPI_WORKERS,
  SUNNY,
  SUNNY_OUTLETS,
  SUNNY_TEMPLATES,
  SUNNY_WORKERS,
  pattern,
  type OutletSeed,
  type TemplateSeed,
  type WorkerSeed,
} from "./seed-data";
import { solve, type SolverAvailability, type SolverWorker } from "@/agent/solver";
import { patternAvailability, templateSlots } from "./seed-avail";
import { addDays, atLocal, fmtDay, fmtRange12, fmtShortDate, isoWeek, localParts, weekDates, weekStartOf } from "@/lib/time";
import { templatePayload } from "@/whatsapp/templates";
import { wa } from "@/whatsapp/types";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}



export function displayFirst(name: string) {
  // "Tan Ah Kow" -> "Uncle Tan" style is handled by persona; keep simple here
  return firstName(name);
}

function statsFor(w: WorkerSeed, rand: () => number): s.WorkerStats {
  const offersReceived = 3 + Math.floor(rand() * 6);
  return {
    repliesMedianMin: Math.round(4 + (1 - w.resp) * 150 + rand() * 10),
    availabilityResponseRate: Math.min(1, 0.55 + w.resp * 0.45),
    offersReceived,
    offersAccepted: Math.min(offersReceived, Math.round(offersReceived * (0.25 + w.rel * 0.5))),
    lateCancellations90d: w.rel < 0.82 ? 1 : 0,
    lateArrivals90d: w.late90 ?? (w.rel < 0.8 ? 1 : 0),
    coverPickups90d: w.pickups90 ?? Math.floor(rand() * 3),
    shifts90d: Math.round((w.desired / 5.5) * 12 * (0.8 + rand() * 0.3)),
  };
}

export async function seedDemo(now = new Date()) {
  // SSE cursors survive a reset in open phones. Never reuse an event ID.
  await db.execute(sql`TRUNCATE orgs, outlets, workers, shift_templates, planning_cycles, availability, recurring_constraints, shifts, cover_requests, offers, conversations, messages, media, memories, agent_runs, audit_events, approvals, jobs, events, sim_clock CONTINUE IDENTITY`);
  await seedOrg(KOPI, KOPI_OUTLETS, KOPI_TEMPLATES, KOPI_WORKERS, now, 7);
  await seedOrg(SUNNY, SUNNY_OUTLETS, SUNNY_TEMPLATES, SUNNY_WORKERS, now, 11);
  await db.insert(s.events).values({ orgId: "*", topic: "demo.reset", payload: {} });
}

async function seedOrg(
  org: typeof KOPI,
  outletSeeds: OutletSeed[],
  templates: TemplateSeed[],
  workerSeeds: WorkerSeed[],
  now: Date,
  seed: number,
) {
  const rand = rng(seed);
  const tz = "Asia/Singapore";
  const today = localParts(now, tz).date;
  const weekStart = weekStartOf(today);
  const dates = weekDates(weekStart);
  const publishedAt = atLocal(addDays(weekStart, -1), "18:00");
  const kickoffAt = atLocal(addDays(weekStart, -4), "18:00");

  await db.insert(s.orgs).values({
    id: org.id,
    name: org.name,
    slug: org.slug,
    timezone: tz,
    brandColor: org.brandColor,
    managerName: org.managerName,
    managerPhone: org.managerPhone,
    settings: DEFAULT_SETTINGS,
  });
  await db.insert(s.simClock).values({ orgId: org.id, offsetMs: 0 });

  const outlets = outletSeeds.map((o) => ({ ...o, id: `out_${o.code.toLowerCase()}` }));
  await db.insert(s.outlets).values(
    outlets.map((o) => ({
      id: o.id,
      orgId: org.id,
      name: o.name,
      code: o.code,
      address: o.address,
      lat: o.lat,
      lng: o.lng,
      openTime: o.open,
      closeTime: o.close,
      leadName: o.lead,
    })),
  );
  const outletByCode = new Map(outlets.map((o) => [o.code, o]));

  const tplRows: (typeof s.shiftTemplates.$inferInsert)[] = [];
  for (const o of outlets) {
    for (const t of templates) {
      if (t.onlyCbd && !o.cbd) continue;
      for (const dow of t.dows) {
        tplRows.push({
          id: `tpl_${o.code.toLowerCase()}_${dow}_${t.label.replace(/\s+/g, "").toLowerCase()}`,
          outletId: o.id,
          dow,
          label: t.label,
          startTime: t.start,
          endTime: t.end,
          skill: t.skill,
          headcount: o.busy && t.busyHeadcount ? t.busyHeadcount : t.headcount,
        });
      }
    }
  }
  await db.insert(s.shiftTemplates).values(tplRows);

  const keyToId = (k: string) => `wkr_${k}`;
  const workerRows: (typeof s.workers.$inferInsert)[] = workerSeeds.map((w, i) => {
    const area = AREAS[w.area] ?? AREAS["Toa Payoh"];
    const jitter = () => (rand() - 0.5) * 0.012;
    return {
      id: keyToId(w.key),
      orgId: org.id,
      name: w.name,
      phone: `+65 ${8 + (i % 2)}${String(1000 + Math.floor(rand() * 8999))} ${String(1000 + Math.floor(rand() * 8999))}`,
      homeArea: w.area,
      homeLat: area.lat + jitter(),
      homeLng: area.lng + jitter(),
      homeOutletId: outletByCode.get(w.home)?.id ?? null,
      skills: w.skills,
      desiredHours: w.desired,
      maxHours: w.max,
      hourlyRate: w.rate,
      language: w.language,
      occupation: w.occupation,
      persona: {
        bio: w.bio,
        style: w.style,
        reliability: w.rel,
        responsiveness: w.resp,
        pattern: pattern(w.pattern),
        quirks: w.quirks,
      },
      stats: statsFor(w, rand),
      autopilot: !w.stage,
      avatarHue: Math.floor(rand() * 360),
      joinedAt: new Date(now.getTime() - (30 + Math.floor(rand() * 500)) * 86400000),
    };
  });
  await db.insert(s.workers).values(workerRows);

  // Memories (worker + org level)
  const memRows: (typeof s.memories.$inferInsert)[] = [];
  for (const w of workerSeeds) {
    for (const m of w.memories ?? []) {
      memRows.push({
        id: `mem_${w.key}_${memRows.length}`,
        orgId: org.id,
        workerId: keyToId(w.key),
        kind: m.kind,
        content: m.content,
        expiresAt: m.expires ?? null,
        createdBy: "seed",
        confidence: 0.9,
        createdAt: new Date(now.getTime() - (5 + Math.floor(rand() * 60)) * 86400000),
      });
    }
  }
  if (org.id === KOPI.id) {
    memRows.push(
      { id: "mem_org_1", orgId: org.id, workerId: null, kind: "fact", content: "Jurong East Saturday afternoons are the busiest of the week (JEM foot traffic)", createdBy: "seed", confidence: 0.9, createdAt: now },
      { id: "mem_org_2", orgId: org.id, workerId: null, kind: "fact", content: "Weekday opening shifts are hardest to fill: most students have class", createdBy: "seed", confidence: 0.9, createdAt: now },
      { id: "mem_org_3", orgId: org.id, workerId: null, kind: "preference", content: "Priya prefers to approve any overtime personally, even 1 hour", createdBy: "seed", confidence: 0.9, createdAt: now },
    );
  }
  if (memRows.length) await db.insert(s.memories).values(memRows);

  // Conversations
  const convRows: (typeof s.conversations.$inferInsert)[] = [
    ...workerSeeds.map((w) => ({
      id: `cnv_${w.key}`,
      orgId: org.id,
      kind: "worker_dm" as const,
      workerId: keyToId(w.key),
      title: w.name,
    })),
    ...outlets.map((o) => ({
      id: `cnv_grp_${o.code.toLowerCase()}`,
      orgId: org.id,
      kind: "outlet_group" as const,
      outletId: o.id,
      title: `${org.name} ${o.name} crew`,
    })),
    { id: `cnv_mgr_${org.slug}`, orgId: org.id, kind: "manager_dm" as const, title: org.managerName },
  ];
  await db.insert(s.conversations).values(convRows);

  // Current week: availability from ground-truth patterns, solved roster
  const cycleId = `cyc_${org.slug}_${weekStart.replace(/-/g, "")}`;
  const availRows = workerRows.flatMap((w) => patternAvailability(w.id!, (w.persona as s.Persona).pattern, dates, rand, cycleId, kickoffAt));
  const slots = templateSlots(outlets, templates, dates);
  const memByWorker = new Map<string, WorkerSeed>(workerSeeds.map((w) => [keyToId(w.key), w]));
  const solverWorkers: SolverWorker[] = workerRows.map((w) => {
    const seedW = memByWorker.get(w.id!)!;
    return {
      id: w.id!,
      name: w.name,
      skills: w.skills,
      maxHours: w.maxHours,
      desiredHours: w.desiredHours,
      homeLat: w.homeLat,
      homeLng: w.homeLng,
      homeOutletId: w.homeOutletId ?? null,
      reliability: seedW.rel,
      likes: seedW.likes?.map(keyToId),
      avoids: seedW.avoids?.map(keyToId),
    };
  });
  const result = solve({
    slots,
    workers: solverWorkers,
    outlets: outlets.map((o) => ({ id: o.id, name: o.name, lat: o.lat, lng: o.lng })),
    availability: availRows as SolverAvailability[],
  });

  await db.insert(s.planningCycles).values({
    id: cycleId,
    orgId: org.id,
    weekStart,
    status: "published",
    goal: `Staff week ${isoWeek(weekStart)} across all outlets`,
    kickoffAt,
    deadlineAt: atLocal(addDays(weekStart, -2), "21:00"),
    publishedAt,
    solveSummary: { ...result.stats, shortages: result.shortages.length, surplus: result.surplus.length },
  });
  for (let i = 0; i < availRows.length; i += 500) await db.insert(s.availability).values(availRows.slice(i, i + 500));

  const bySlot = new Map(result.assignments.map((a) => [a.slotId, a]));
  const shiftRows: (typeof s.shifts.$inferInsert)[] = slots.map((slot) => {
    const a = bySlot.get(slot.id);
    const startsAt = atLocal(slot.date, slot.startMin);
    const endsAt = atLocal(slot.date, slot.endMin);
    const past = endsAt.getTime() < now.getTime();
    return {
      id: `shf_${slot.id.slice(5).toLowerCase()}`,
      orgId: org.id,
      cycleId,
      outletId: slot.outletId,
      date: slot.date,
      startsAt,
      endsAt,
      label: slot.label,
      skill: slot.skill,
      status: a ? (past ? "completed" : "confirmed") : past ? "cancelled" : "open",
      workerId: a?.workerId ?? null,
      explanation: a ? { score: a.score, reasons: a.reasons, alternatives: a.alternatives } : null,
      source: "solver",
      confirmedAt: a ? new Date(publishedAt.getTime() + 3600_000) : null,
      checkedInAt: a && past ? new Date(startsAt.getTime() - 5 * 60_000) : null,
    };
  });
  for (let i = 0; i < shiftRows.length; i += 500) await db.insert(s.shifts).values(shiftRows.slice(i, i + 500));

  // Messages: roster published on Sunday, confirmations, a few mid-week chats
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const msgRows: (typeof s.messages.$inferInsert)[] = [];
  const convUpdates = new Map<string, { lastInboundAt?: Date; lastMessageAt: Date; preview: string }>();
  let seq = 0;
  const push = (conversationId: string, m: Omit<typeof s.messages.$inferInsert, "id" | "orgId" | "conversationId">) => {
    const id = `msg_${org.slug.slice(0, 5)}${String(seq++).padStart(5, "0")}`;
    msgRows.push({ id, orgId: org.id, conversationId, ...m });
    const prev = convUpdates.get(conversationId);
    const at = m.createdAt as Date;
    convUpdates.set(conversationId, {
      lastInboundAt: m.direction === "in" ? at : prev?.lastInboundAt,
      lastMessageAt: at,
      preview: (m.text as string) || prev?.preview || "",
    });
    return id;
  };

  const weekLabel = `week of ${fmtShortDate(weekStart)}`;
  workerSeeds.forEach((w, i) => {
    const wid = keyToId(w.key);
    const mine = shiftRows.filter((r) => r.workerId === wid).sort((a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime());
    const at = new Date(publishedAt.getTime() + i * 7000);
    const lines = mine.map(
      (r) => `• ${fmtDay(r.date)}, ${fmtRange12(localParts(r.startsAt as Date).minutes, localParts(r.endsAt as Date).minutes)} · ${outletName.get(r.outletId)} (${r.label})`,
    );
    const payload = mine.length
      ? templatePayload("roster_published", {
          headerImage: `/api/og/roster?worker=${wid}&week=${weekStart}`,
          body: [firstName(w.name), weekLabel, lines.join("\n")],
          buttonPayloads: [`roster:confirm:${cycleId}`, `roster:problem:${cycleId}`],
        })
      : templatePayload("roster_none", {
          body: [firstName(w.name), weekLabel, "It was a busy week for requests."],
          buttonPayloads: [`roster:standby:${cycleId}`, `roster:ok:${cycleId}`],
        });
    const outId = push(`cnv_${w.key}`, {
      direction: "out",
      sender: "agent",
      type: "template",
      template: (payload as { template: { name: string } }).template.name,
      payload: payload as Record<string, unknown>,
      text: mine.length ? `Your shifts for ${weekLabel}` : `No shifts for ${weekLabel}`,
      status: "read",
      createdAt: at,
    });
    if (mine.length) {
      const replyAt = new Date(at.getTime() + (3 + Math.floor((1 - w.resp) * 90 + rand() * 20)) * 60_000);
      const inId = push(`cnv_${w.key}`, {
        direction: "in",
        sender: "worker",
        type: "button",
        payload: { type: "button", button: { payload: `roster:confirm:${cycleId}`, text: "Confirm ✅" }, context: { id: outId } },
        text: "Confirm ✅",
        status: "read",
        contextMessageId: outId,
        processedAt: replyAt,
        createdAt: replyAt,
      });
      push(`cnv_${w.key}`, {
        direction: "out",
        sender: "agent",
        type: "reaction",
        payload: wa.reaction(inId, "👍") as Record<string, unknown>,
        text: "",
        status: "read",
        createdAt: new Date(replyAt.getTime() + 20_000),
      });
    }

    // A mid-week question for the human-driven characters
    if (w.stage && mine.length) {
      const next = mine.find((r) => (r.startsAt as Date).getTime() > now.getTime()) ?? mine[mine.length - 1];
      const askAt = new Date(now.getTime() - (20 + i * 13) * 60_000 - 3 * 3600_000);
      if (askAt.getTime() > publishedAt.getTime()) {
        const q = w.key === "mei" ? "hello what time my next shift ah 😅" : w.key === "ravi" ? "Hi! Just checking, what's my next shift?" : "Hi, may i know my next shift ya";
        push(`cnv_${w.key}`, { direction: "in", sender: "worker", type: "text", payload: { type: "text", text: { body: q } }, text: q, status: "read", processedAt: askAt, createdAt: askAt });
        const ans = `Hi ${firstName(w.name)}! Your next shift is *${fmtDay(next.date)}, ${fmtRange12(localParts(next.startsAt as Date).minutes, localParts(next.endsAt as Date).minutes)}* at ${outletName.get(next.outletId)} (${next.label}) ☕`;
        push(`cnv_${w.key}`, { direction: "out", sender: "agent", type: "text", payload: wa.text(ans) as Record<string, unknown>, text: ans, status: "read", createdAt: new Date(askAt.getTime() + 9_000) });
      }
    }
  });

  // Outlet group roster posts
  for (const o of outlets) {
    const crew = [...new Set(shiftRows.filter((r) => r.outletId === o.id && r.workerId).map((r) => r.workerId!))];
    const names = crew.map((id) => firstName(workerRows.find((w) => w.id === id)!.name));
    const text = `📋 Roster for ${weekLabel} is out!\n\n${o.name} crew this week: ${names.join(", ")}.\n\nCheck your DMs for your own shifts. Swaps and questions → message me directly 🙏`;
    push(`cnv_grp_${o.code.toLowerCase()}`, { direction: "out", sender: "agent", type: "text", payload: wa.text(text) as Record<string, unknown>, text, status: "read", createdAt: new Date(publishedAt.getTime() + 60_000) });
  }

  // Manager summary
  const mgrText = `Week ${isoWeek(weekStart)} roster is published ✅\n\n• ${result.stats.filled}/${result.stats.slots} shifts filled (${Math.round(result.stats.coverage * 100)}%)\n• ${workerRows.length} part-timers asked, ${workerRows.length - 2} replied\n• ${result.shortages.length} gaps left open${result.shortages.length ? ", I'll keep trying to fill them" : ""}\n\nI'll handle swaps and sick calls as they come in.`;
  push(`cnv_mgr_${org.slug}`, { direction: "out", sender: "agent", type: "text", payload: wa.text(mgrText) as Record<string, unknown>, text: mgrText, status: "read", createdAt: new Date(publishedAt.getTime() + 120_000) });

  for (let i = 0; i < msgRows.length; i += 400) await db.insert(s.messages).values(msgRows.slice(i, i + 400));
  for (const [id, u] of convUpdates) {
    await db
      .update(s.conversations)
      .set({ lastInboundAt: u.lastInboundAt ?? null, lastMessageAt: u.lastMessageAt, lastMessagePreview: u.preview.slice(0, 120) })
      .where(sql`${s.conversations.id} = ${id}`);
  }

  // Last week's run, so the audit trail and impact page have history
  const runId = `run_${org.slug}_w${isoWeek(weekStart)}`;
  const steps: s.PlanStep[] = [
    "Understand goal and build demand",
    "Ask everyone for availability",
    "Collect and read replies",
    "Remind people who haven't replied",
    "Solve the roster",
    "Negotiate gaps",
    "Get approval to publish",
    "Publish and collect confirmations",
  ].map((title, i) => ({ id: `s${i + 1}`, title, status: "done" as const }));
  await db.insert(s.agentRuns).values({
    id: runId,
    orgId: org.id,
    kind: "weekly",
    title: `Weekly roster · Week ${isoWeek(weekStart)}`,
    goal: `Staff week ${isoWeek(weekStart)} across all outlets`,
    status: "done",
    plan: steps,
    summary: `${result.stats.filled}/${result.stats.slots} shifts filled, ${result.shortages.length} gaps.`,
    subjectId: cycleId,
    metrics: { messagesSent: workerRows.length * 2, repliesParsed: workerRows.length - 2, shiftsFilled: result.stats.filled },
    startedAt: kickoffAt,
    finishedAt: publishedAt,
  });
  const b = DEFAULT_SETTINGS.baselines;
  const audits: (typeof s.auditEvents.$inferInsert)[] = [
    { title: `Sent availability requests to ${workerRows.length} part-timers`, kind: "message_sent", manualMinutes: workerRows.length * b.availabilityAsk, at: kickoffAt },
    { title: `Read ${workerRows.length - 2} availability replies`, kind: "tool_result", manualMinutes: (workerRows.length - 2) * b.availabilityParse, at: new Date(kickoffAt.getTime() + 86400000) },
    { title: `Built roster for ${outlets.length} outlet${outlets.length > 1 ? "s" : ""}`, kind: "decision", manualMinutes: outlets.length * b.rosterBuildPerOutlet, at: new Date(publishedAt.getTime() - 3600_000) },
    { title: "Manager approved publishing the roster", kind: "approval_decided", manualMinutes: 0, at: new Date(publishedAt.getTime() - 600_000), actor: "manager" as const },
    { title: `Published roster to ${workerRows.length} people`, kind: "message_sent", manualMinutes: workerRows.length * b.rosterPublishPerPerson, at: publishedAt },
  ].map((a, i) => ({
    id: `aud_seed_${org.slug}_${i}`,
    orgId: org.id,
    runId,
    kind: a.kind as s.AuditEvent["kind"],
    actor: a.actor ?? "agent",
    title: a.title,
    manualMinutes: a.manualMinutes,
    createdAt: a.at,
  }));
  await db.insert(s.auditEvents).values(audits);

  return { cycleId, stats: result.stats, shortages: result.shortages.length };
}
