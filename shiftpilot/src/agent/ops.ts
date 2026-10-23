/** Shared data operations used by tools, button handlers and workflows */
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { firstName } from "@/lib/names";
import { db } from "@/db";
import {
  availability,
  conversations,
  memories,
  orgs,
  outlets,
  planningCycles,
  recurringConstraints,
  shifts,
  workers,
  type Memory,
  type Outlet,
  type Shift,
} from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { fmtDay, fmtShiftRange, localParts, weekStartOf } from "@/lib/time";
import { sendMessage } from "@/whatsapp/send";
import { wa, type OutboundPayload } from "@/whatsapp/types";
import { audit } from "./runs";

export { firstName };

export async function getOrg(orgId: string) {
  const o = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  if (!o) throw new Error(`org ${orgId} not found`);
  return o;
}

export async function getWorker(id: string) {
  return db.query.workers.findFirst({ where: eq(workers.id, id) });
}

export async function orgWorkers(orgId: string) {
  return db.select().from(workers).where(and(eq(workers.orgId, orgId), eq(workers.active, true)));
}

export async function orgOutlets(orgId: string) {
  return db.select().from(outlets).where(eq(outlets.orgId, orgId)).orderBy(asc(outlets.code));
}

export async function outletMap(orgId: string) {
  return new Map((await orgOutlets(orgId)).map((o) => [o.id, o]));
}

export function describeShift(s: Pick<Shift, "date" | "startsAt" | "endsAt" | "label">, outlet?: Pick<Outlet, "name"> | null) {
  return `${fmtDay(s.date)}, ${fmtShiftRange(s.startsAt, s.endsAt)} · ${outlet?.name ?? "?"} (${s.label})`;
}

export async function workerShifts(workerId: string, from: Date, to: Date, statuses = ["assigned", "confirmed", "covered", "draft"]) {
  return db
    .select()
    .from(shifts)
    .where(and(eq(shifts.workerId, workerId), gte(shifts.endsAt, from), lte(shifts.startsAt, to), inArray(shifts.status, statuses as Shift["status"][])))
    .orderBy(asc(shifts.startsAt));
}

export async function dmFor(workerId: string) {
  return db.query.conversations.findFirst({ where: and(eq(conversations.workerId, workerId), eq(conversations.kind, "worker_dm")) });
}

export async function managerConv(orgId: string) {
  return db.query.conversations.findFirst({ where: and(eq(conversations.orgId, orgId), eq(conversations.kind, "manager_dm")) });
}

export async function groupConv(outletId: string) {
  return db.query.conversations.findFirst({ where: and(eq(conversations.outletId, outletId), eq(conversations.kind, "outlet_group")) });
}

/** Message the manager on WhatsApp (and flag the inbox) */
export async function notifyManager(orgId: string, message: string | OutboundPayload, opts?: { runId?: string | null; attention?: boolean; manualMinutes?: number }) {
  const conv = await managerConv(orgId);
  if (!conv) return;
  const payload = typeof message === "string" ? wa.text(message) : message;
  const r = await sendMessage({ orgId, conversationId: conv.id, payload, runId: opts?.runId, privacy: { purpose: "manager" }, auditTitle: "Updated the manager on WhatsApp", manualMinutes: opts?.manualMinutes });
  if (opts?.attention) await db.update(conversations).set({ needsAttention: true }).where(eq(conversations.id, conv.id));
  return r;
}

export async function activeMemories(orgId: string, workerId: string | null, today: string) {
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.orgId, orgId), workerId ? eq(memories.workerId, workerId) : sql`${memories.workerId} is null`, eq(memories.active, true)))
    .orderBy(desc(memories.createdAt));
  return rows.filter((m) => !m.expiresAt || m.expiresAt >= today);
}

/** Save a memory unless a near-identical one exists */
export async function saveMemory(m: {
  orgId: string;
  workerId: string | null;
  kind: Memory["kind"];
  content: string;
  evidenceMessageId?: string | null;
  expiresAt?: string | null;
  createdBy: Memory["createdBy"];
  confidence?: number;
  runId?: string | null;
}) {
  const existing = await db
    .select()
    .from(memories)
    .where(and(eq(memories.orgId, m.orgId), m.workerId ? eq(memories.workerId, m.workerId) : sql`${memories.workerId} is null`, eq(memories.active, true)));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (existing.some((e) => norm(e.content) === norm(m.content))) return null;
  const id = newId("mem");
  await db.insert(memories).values({
    id,
    orgId: m.orgId,
    workerId: m.workerId,
    kind: m.kind,
    content: m.content,
    evidenceMessageId: m.evidenceMessageId ?? null,
    expiresAt: m.expiresAt ?? null,
    createdBy: m.createdBy,
    confidence: m.confidence ?? 0.8,
    createdAt: await now(m.orgId),
  });
  await audit(m.orgId, { runId: m.runId, kind: "memory", title: `Remembered: ${m.content}`, detail: { workerId: m.workerId, kind: m.kind, memoryId: id } });
  await emit(m.orgId, "memory.updated", { workerId: m.workerId });
  return id;
}

/** The cycle that is currently collecting / planning, if any */
export async function planningCycle(orgId: string) {
  return db.query.planningCycles.findFirst({
    where: and(eq(planningCycles.orgId, orgId), inArray(planningCycles.status, ["draft", "collecting", "solving", "negotiating", "awaiting_approval"])),
    orderBy: desc(planningCycles.createdAt),
  });
}

export async function cycleForWeek(orgId: string, weekStart: string) {
  return db.query.planningCycles.findFirst({ where: and(eq(planningCycles.orgId, orgId), eq(planningCycles.weekStart, weekStart)) });
}

export async function cycleForDate(orgId: string, date: string) {
  return cycleForWeek(orgId, weekStartOf(date));
}

export async function workerAvailability(workerId: string, cycleId: string) {
  return db.select().from(availability).where(and(eq(availability.workerId, workerId), eq(availability.cycleId, cycleId))).orderBy(asc(availability.date), asc(availability.startMin));
}

/** Replace a worker's availability for the given dates (or the whole cycle) */
export async function writeAvailability(opts: {
  orgId: string;
  workerId: string;
  cycleId: string;
  entries: { date: string; startMin: number; endMin: number; kind: "available" | "preferred" | "maybe" | "unavailable"; note?: string }[];
  replaceDates?: string[] | "all";
  source: "flow" | "text" | "recurring" | "manager";
  confidence: number;
  sourceMessageId?: string | null;
}) {
  if (opts.replaceDates === "all") {
    await db.delete(availability).where(and(eq(availability.workerId, opts.workerId), eq(availability.cycleId, opts.cycleId)));
  } else if (opts.replaceDates?.length) {
    await db
      .delete(availability)
      .where(and(eq(availability.workerId, opts.workerId), eq(availability.cycleId, opts.cycleId), inArray(availability.date, opts.replaceDates)));
  }
  const t = await now(opts.orgId);
  if (opts.entries.length) {
    await db.insert(availability).values(
      opts.entries.map((e) => ({
        id: newId("avl"),
        workerId: opts.workerId,
        cycleId: opts.cycleId,
        date: e.date,
        startMin: e.startMin,
        endMin: e.endMin,
        kind: e.kind,
        source: opts.source,
        confidence: opts.confidence,
        note: e.note ?? null,
        sourceMessageId: opts.sourceMessageId ?? null,
        createdAt: t,
      })),
    );
  }
  await emit(opts.orgId, "availability.updated", { workerId: opts.workerId, cycleId: opts.cycleId });
}

export async function recurringFor(workerId: string) {
  return db.select().from(recurringConstraints).where(eq(recurringConstraints.workerId, workerId));
}

/** Hours rostered for a worker in the week containing `date` */
export async function weekHours(workerId: string, date: string, excludeShiftId?: string) {
  const ws = weekStartOf(date);
  const rows = await db
    .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt, id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.workerId, workerId),
        gte(shifts.date, ws),
        lte(shifts.date, sql`(${ws}::date + 6)::text`),
        inArray(shifts.status, ["assigned", "confirmed", "covered", "completed", "draft"]),
        excludeShiftId ? ne(shifts.id, excludeShiftId) : sql`true`,
      ),
    );
  return rows.reduce((s, r) => s + (r.endsAt.getTime() - r.startsAt.getTime()) / 3_600_000, 0);
}

export async function localToday(orgId: string) {
  return localParts(await now(orgId)).date;
}
