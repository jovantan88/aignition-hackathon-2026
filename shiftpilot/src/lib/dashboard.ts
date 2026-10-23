/** Read models for the manager dashboard */
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentRuns,
  approvals,
  auditEvents,
  availability,
  conversations,
  coverRequests,
  memories,
  messages,
  offers,
  orgs,
  outlets,
  planningCycles,
  recurringConstraints,
  shifts,
  workers,
} from "@/db/schema";
import { now } from "@/lib/clock";
import { addDays, isoWeek, localParts, weekStartOf } from "@/lib/time";

export async function opsSnapshot(orgId: string) {
  const org = (await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }))!;
  const t = await now(orgId);
  const local = localParts(t, org.timezone);
  const os = await db.select().from(outlets).where(eq(outlets.orgId, orgId)).orderBy(asc(outlets.code));
  const weekStart = weekStartOf(local.date);
  const [weekShifts, ws, covers, pendingApprovals, cycle, ticker] = await Promise.all([
    db
      .select({ s: shifts, name: workers.name, hue: workers.avatarHue })
      .from(shifts)
      .leftJoin(workers, eq(workers.id, shifts.workerId))
      .where(and(eq(shifts.orgId, orgId), gte(shifts.date, local.date), lte(shifts.date, addDays(local.date, 6)))),
    db.select({ id: workers.id, name: workers.name, homeLat: workers.homeLat, homeLng: workers.homeLng, autopilot: workers.autopilot }).from(workers).where(eq(workers.orgId, orgId)),
    db.select().from(coverRequests).where(and(eq(coverRequests.orgId, orgId), inArray(coverRequests.status, ["searching", "offered", "escalated"]))),
    db.select().from(approvals).where(and(eq(approvals.orgId, orgId), eq(approvals.status, "pending"))).orderBy(desc(approvals.createdAt)),
    db.query.planningCycles.findFirst({ where: and(eq(planningCycles.orgId, orgId), ne(planningCycles.status, "published")), orderBy: desc(planningCycles.createdAt) }),
    db.select().from(auditEvents).where(eq(auditEvents.orgId, orgId)).orderBy(desc(auditEvents.realCreatedAt)).limit(40),
  ]);
  const coverOffers = covers.length ? await db.select().from(offers).where(inArray(offers.coverRequestId, covers.map((c) => c.id))) : [];
  const live = (s: (typeof weekShifts)[number]["s"]) => s.status !== "cancelled" && s.status !== "draft";

  const outletsOut = os.map((o) => {
    const today = weekShifts.filter((x) => x.s.outletId === o.id && x.s.date === local.date && live(x.s));
    const week = weekShifts.filter((x) => x.s.outletId === o.id && live(x.s));
    const filled = (arr: typeof today) => arr.filter((x) => x.s.workerId || x.s.status === "covered").length;
    const gapsToday = today.filter((x) => !x.s.workerId && x.s.status !== "covered");
    const coverage = today.length ? filled(today) / today.length : 1;
    const weekCoverage = week.length ? filled(week) / week.length : 1;
    const activeCover = covers.filter((c) => week.some((x) => x.s.id === c.shiftId));
    return {
      id: o.id,
      code: o.code,
      name: o.name,
      lat: o.lat,
      lng: o.lng,
      address: o.address,
      lead: o.leadName,
      coverage,
      weekCoverage,
      status: gapsToday.length || activeCover.some((c) => c.status === "escalated") ? "short" : activeCover.length || weekCoverage < 0.95 ? "risk" : "ok",
      today: today
        .sort((a, b) => a.s.startsAt.getTime() - b.s.startsAt.getTime())
        .map((x) => ({
          id: x.s.id,
          label: x.s.label,
          startsAt: x.s.startsAt,
          endsAt: x.s.endsAt,
          status: x.s.status,
          worker: x.name,
          hue: x.hue,
          checkedIn: Boolean(x.s.checkedInAt),
          onNow: x.s.startsAt <= t && x.s.endsAt > t,
        })),
      openThisWeek: week.filter((x) => !x.s.workerId && x.s.status !== "covered").length,
      activeCovers: activeCover.length,
      byHour: hourly(week.map((x) => x.s), local.date, org.timezone),
    };
  });

  const wkById = new Map(ws.map((w) => [w.id, w]));
  const arcs = coverOffers
    .filter((o) => o.status === "pending" || o.status === "accepted")
    .map((o) => {
      const w = wkById.get(o.workerId);
      const cov = covers.find((c) => c.id === o.coverRequestId);
      const sh = weekShifts.find((x) => x.s.id === cov?.shiftId)?.s;
      const out = os.find((x) => x.id === sh?.outletId);
      return w && out ? { id: o.id, from: { lat: w.homeLat, lng: w.homeLng }, to: { lat: out.lat, lng: out.lng }, state: o.status === "accepted" ? "filled" : "offered", name: w.name } : null;
    })
    .filter(Boolean);

  const allToday = outletsOut.flatMap((o) => o.today);
  const responders = cycle ? await db.selectDistinct({ w: availability.workerId }).from(availability).where(and(eq(availability.cycleId, cycle.id), inArray(availability.source, ["flow", "text"]))) : [];
  const weekMinutes = await db
    .select({ m: sql<number>`coalesce(sum(${auditEvents.manualMinutes}),0)` })
    .from(auditEvents)
    .where(and(eq(auditEvents.orgId, orgId), gte(auditEvents.createdAt, new Date(t.getTime() - 7 * 86400_000))));

  return {
    org: { id: org.id, name: org.name, managerName: org.managerName, timezone: org.timezone, outletCount: os.length },
    now: t.toISOString(),
    local,
    week: isoWeek(local.date),
    weekStart,
    outlets: outletsOut,
    arcs,
    kpis: {
      coverageToday: allToday.length ? allToday.filter((x) => x.worker || x.status === "covered").length / allToday.length : 1,
      shiftsToday: allToday.length,
      onNow: allToday.filter((x) => x.onNow).length,
      openThisWeek: outletsOut.reduce((n, o) => n + o.openThisWeek, 0),
      activeCovers: covers.length,
      pendingApprovals: pendingApprovals.length,
      minutesSaved7d: Math.round(Number(weekMinutes[0]?.m ?? 0)),
      team: ws.length,
    },
    cycle: cycle
      ? { id: cycle.id, weekStart: cycle.weekStart, week: isoWeek(cycle.weekStart), status: cycle.status, replied: responders.length, total: ws.length, runId: cycle.runId, deadlineAt: cycle.deadlineAt }
      : null,
    covers: covers.map((c) => ({ ...c, offers: coverOffers.filter((o) => o.coverRequestId === c.id).map((o) => ({ ...o, name: wkById.get(o.workerId)?.name })) })),
    approvals: pendingApprovals,
    ticker: ticker.map((a) => ({ id: a.id, kind: a.kind, actor: a.actor, title: a.title, at: a.createdAt, runId: a.runId })),
  };
}

/** Coverage per hour across the week for the time-lapse (filled/needed per hour slot) */
function hourly(rows: (typeof shifts.$inferSelect)[], fromDate: string, tz: string) {
  const out: { t: number; need: number; have: number }[] = [];
  const start = new Date(`${fromDate}T00:00:00+08:00`).getTime();
  for (let h = 0; h < 7 * 24; h++) {
    const ts = start + h * 3600_000;
    const active = rows.filter((s) => s.startsAt.getTime() <= ts && s.endsAt.getTime() > ts);
    if (!active.length) continue;
    out.push({ t: ts, need: active.length, have: active.filter((s) => s.workerId || s.status === "covered").length });
  }
  void tz;
  return out;
}

export async function rosterWeek(orgId: string, weekStart: string) {
  const os = await db.select().from(outlets).where(eq(outlets.orgId, orgId)).orderBy(asc(outlets.code));
  const rows = await db
    .select({ s: shifts, name: workers.name, hue: workers.avatarHue })
    .from(shifts)
    .leftJoin(workers, eq(workers.id, shifts.workerId))
    .where(and(eq(shifts.orgId, orgId), gte(shifts.date, weekStart), lte(shifts.date, addDays(weekStart, 6)), ne(shifts.status, "cancelled")))
    .orderBy(asc(shifts.startsAt));
  const cycle = await db.query.planningCycles.findFirst({ where: and(eq(planningCycles.orgId, orgId), eq(planningCycles.weekStart, weekStart)) });
  const cycles = await db.select({ weekStart: planningCycles.weekStart, status: planningCycles.status }).from(planningCycles).where(eq(planningCycles.orgId, orgId)).orderBy(asc(planningCycles.weekStart));
  const ws = await db.select({ id: workers.id, name: workers.name, hue: workers.avatarHue, skills: workers.skills, desiredHours: workers.desiredHours, maxHours: workers.maxHours }).from(workers).where(eq(workers.orgId, orgId)).orderBy(asc(workers.name));
  return {
    weekStart,
    week: isoWeek(weekStart),
    cycle,
    cycles,
    outlets: os,
    shifts: rows.map((r) => ({ ...r.s, workerName: r.name, hue: r.hue })),
    workers: ws,
  };
}

export async function inbox(orgId: string) {
  const rows = await db
    .select({ c: conversations, name: workers.name, hue: workers.avatarHue, autopilot: workers.autopilot, outletId: workers.homeOutletId })
    .from(conversations)
    .leftJoin(workers, eq(workers.id, conversations.workerId))
    .where(eq(conversations.orgId, orgId))
    .orderBy(desc(conversations.lastMessageAt));
  return rows.map((r) => ({ ...r.c, workerName: r.name, hue: r.hue, autopilot: r.autopilot, homeOutletId: r.outletId }));
}

export async function workerProfile(workerId: string) {
  const w = await db.query.workers.findFirst({ where: eq(workers.id, workerId) });
  if (!w) return null;
  const t = await now(w.orgId);
  const today = localParts(t).date;
  const [mems, recs, upcoming, recentOffers, home, avail, conv] = await Promise.all([
    db.select().from(memories).where(and(eq(memories.workerId, workerId), eq(memories.active, true))).orderBy(desc(memories.createdAt)),
    db.select().from(recurringConstraints).where(eq(recurringConstraints.workerId, workerId)),
    db
      .select({ s: shifts, outlet: outlets.name, code: outlets.code })
      .from(shifts)
      .innerJoin(outlets, eq(outlets.id, shifts.outletId))
      .where(and(eq(shifts.workerId, workerId), gte(shifts.date, addDays(today, -7)), lte(shifts.date, addDays(today, 14))))
      .orderBy(asc(shifts.startsAt)),
    db.select().from(offers).where(eq(offers.workerId, workerId)).orderBy(desc(offers.sentAt)).limit(10),
    w.homeOutletId ? db.query.outlets.findFirst({ where: eq(outlets.id, w.homeOutletId) }) : Promise.resolve(null),
    db
      .select({ a: availability, weekStart: planningCycles.weekStart })
      .from(availability)
      .innerJoin(planningCycles, eq(planningCycles.id, availability.cycleId))
      .where(eq(availability.workerId, workerId))
      .orderBy(desc(planningCycles.weekStart)),
    db.query.conversations.findFirst({ where: and(eq(conversations.workerId, workerId), eq(conversations.kind, "worker_dm")) }),
  ]);
  return { worker: w, home, memories: mems, recurring: recs, shifts: upcoming.map((u) => ({ ...u.s, outlet: u.outlet, code: u.code })), offers: recentOffers, availability: avail.map((x) => ({ ...x.a, weekStart: x.weekStart })), conversationId: conv?.id ?? null, today };
}

export async function runsList(orgId: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.orgId, orgId)).orderBy(desc(agentRuns.startedAt)).limit(60);
}

export async function runDetail(runId: string) {
  const run = await db.query.agentRuns.findFirst({ where: eq(agentRuns.id, runId) });
  if (!run) return null;
  const events = await db.select().from(auditEvents).where(eq(auditEvents.runId, runId)).orderBy(asc(auditEvents.realCreatedAt));
  const aps = await db.select().from(approvals).where(eq(approvals.runId, runId)).orderBy(asc(approvals.createdAt));
  return { run, events, approvals: aps };
}

export async function impact(orgId: string) {
  const org = (await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }))!;
  const t = await now(orgId);
  const since = new Date(t.getTime() - 14 * 86400_000);
  const ev = await db.select().from(auditEvents).where(and(eq(auditEvents.orgId, orgId), gte(auditEvents.createdAt, since)));
  const minutes = ev.reduce((s, e) => s + e.manualMinutes, 0);
  const sent = ev.filter((e) => e.kind === "message_sent").length;
  const received = ev.filter((e) => e.kind === "message_received").length;
  const toolCalls = ev.filter((e) => e.kind === "tool_call").length;
  const privacyBlocks = ev.filter((e) => e.kind === "privacy_check" && e.title.includes("blocked")).length;
  const approvalsDecided = ev.filter((e) => e.kind === "approval_decided").length;
  const errors = ev.filter((e) => e.kind === "error").length;
  const recoveries = ev.filter((e) => e.kind === "recovery").length;
  const covers = await db.select().from(coverRequests).where(and(eq(coverRequests.orgId, orgId), gte(coverRequests.createdAt, since)));
  const filled = covers.filter((c) => c.status === "filled" && c.filledAt);
  const fillMins = filled.map((c) => (c.filledAt!.getTime() - c.createdAt.getTime()) / 60000).sort((a, b) => a - b);
  const median = fillMins.length ? fillMins[Math.floor(fillMins.length / 2)] : null;
  const runs = await db.select().from(agentRuns).where(and(eq(agentRuns.orgId, orgId), gte(agentRuns.startedAt, since)));
  const llm = ev.filter((e) => e.kind === "llm");
  const avgLatency = llm.length ? llm.reduce((s, e) => s + (e.latencyMs ?? 0), 0) / llm.length : null;
  const parseEval = await parseAccuracy(orgId, since);
  return {
    baselines: org.settings.baselines,
    minutesSaved: Math.round(minutes),
    messagesHandled: sent + received,
    sent,
    received,
    toolCalls,
    approvalsDecided,
    privacyBlocks,
    errors,
    recoveries,
    covers: { total: covers.length, filled: filled.length, medianMinutes: median, escalated: covers.filter((c) => c.status === "escalated" || c.resolution).length },
    runs: { total: runs.length, weekly: runs.filter((r) => r.kind === "weekly").length, cover: runs.filter((r) => r.kind === "cover").length },
    avgLatencyMs: avgLatency,
    parseEval,
    byDay: byDay(ev, t),
  };
}

function byDay(ev: { createdAt: Date; manualMinutes: number }[], t: Date) {
  const out: { date: string; minutes: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = localParts(new Date(t.getTime() - i * 86400_000)).date;
    out.push({ date: d, minutes: Math.round(ev.filter((e) => localParts(e.createdAt).date === d).reduce((s, e) => s + e.manualMinutes, 0)) });
  }
  return out;
}

/** Compare persona ground truth with what the agent parsed from free text */
async function parseAccuracy(orgId: string, since: Date) {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.direction, "in"), eq(messages.type, "text"), gte(messages.createdAt, since), sql`${messages.payload} ? '_truth'`));
  let correct = 0;
  let total = 0;
  for (const m of rows) {
    const truth = (m.payload as { _truth?: Record<string, string[]> })._truth ?? {};
    const parsed = await db.select().from(availability).where(eq(availability.sourceMessageId, m.id));
    if (!parsed.length && !Object.keys(truth).length) continue;
    const dates = new Set([...Object.keys(truth), ...parsed.map((p) => p.date)]);
    for (const d of dates) {
      total++;
      const truthFree = Boolean(truth[d]?.length);
      const parsedFree = parsed.some((p) => p.date === d && p.kind !== "unavailable");
      if (truthFree === parsedFree) correct++;
    }
  }
  return { messages: rows.length, dayChecks: total, accuracy: total ? correct / total : null };
}
