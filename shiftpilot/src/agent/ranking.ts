/**
 * Ranks replacement candidates for one shift. scoreCandidate() is pure and
 * unit-tested; rankCandidates() gathers the data. Every score comes with the
 * reasons a manager would want to see.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { availability, memories, offers, recurringConstraints, shifts, type Availability, type RecurringConstraint, type Shift, type Worker } from "@/db/schema";
import { haversineKm, travelMinutes } from "@/lib/geo";
import { addDays, dowOf, localParts, weekStartOf } from "@/lib/time";
import { now } from "@/lib/clock";
import { cycleForDate, orgOutlets, orgWorkers } from "./ops";

export type CandidateInput = {
  worker: Pick<Worker, "id" | "name" | "skills" | "maxHours" | "desiredHours" | "homeLat" | "homeLng" | "homeOutletId" | "persona" | "stats">;
  shift: { outletId: string; date: string; startMin: number; endMin: number; skill: string; startsAt: Date; endsAt: Date };
  outlet: { lat: number; lng: number };
  /** Their other shifts around that date */
  nearbyShifts: { startsAt: Date; endsAt: Date }[];
  weekHours: number;
  /** null = never submitted availability for that week */
  availability: Pick<Availability, "date" | "startMin" | "endMin" | "kind">[] | null;
  recurring: Pick<RecurringConstraint, "dows" | "startMin" | "endMin" | "kind" | "description" | "validFrom" | "validTo">[];
  memoryText: string[];
  offersLast7d: number;
  acceptedLast14d: number;
  urgent: boolean;
};

export type Candidate = {
  workerId: string;
  name: string;
  score: number;
  eligible: boolean;
  blockReason?: string;
  reasons: string[];
  flags: { overtime: boolean; unknownAvailability: boolean; partial: boolean; travelMin: number };
};

/** Turn remembered constraints into hard blocks or penalties. Returns a block reason, or a penalty. */
export function memoryRules(memoryText: string[], shift: CandidateInput["shift"]): { block?: string; penalty?: { t: string; w: number } } {
  const dow = dowOf(shift.date);
  const weekend = dow >= 5;
  const hours = (shift.endMin - shift.startMin) / 60;
  for (const raw of memoryText) {
    const m = raw.toLowerCase();
    if (weekend && /\b(doesn'?t|don'?t|no|not|never|can'?t)\b[^.]*weekend/.test(m) && !/weekends? only/.test(m)) return { block: `memory: ${raw}` };
    if (!weekend && /weekends? only/.test(m)) return { block: `memory: ${raw}` };
    const maxLen = m.match(/no shifts? longer than (\d+)/);
    if (maxLen && hours > Number(maxLen[1])) return { block: `memory: ${raw}` };
    if (/(avoid|no|not|rather not)[^.]*closing/.test(m) && shift.endMin >= 21 * 60) return { penalty: { t: `remembered: ${raw}`, w: -15 } };
    if (/(avoid|no|not|rather not)[^.]*opening/.test(m) && shift.startMin <= 8 * 60) return { penalty: { t: `remembered: ${raw}`, w: -15 } };
  }
  return {};
}

export function scoreCandidate(c: CandidateInput): Candidate {
  const reasons: { t: string; w: number }[] = [];
  const base = { workerId: c.worker.id, name: c.worker.name };
  const hours = (c.shift.endMin - c.shift.startMin) / 60;
  const km = haversineKm({ lat: c.worker.homeLat, lng: c.worker.homeLng }, c.outlet);
  const travelMin = travelMinutes(km);
  const flags = { overtime: false, unknownAvailability: false, partial: false, travelMin };
  const block = (why: string): Candidate => ({ ...base, score: -999, eligible: false, blockReason: why, reasons: [why], flags });

  if (!c.worker.skills.includes(c.shift.skill)) return block(`not trained as ${c.shift.skill}`);
  for (const s of c.nearbyShifts) {
    if (s.startsAt < c.shift.endsAt && s.endsAt > c.shift.startsAt) return block("already working then");
    const gapH = Math.min(Math.abs(c.shift.startsAt.getTime() - s.endsAt.getTime()), Math.abs(s.startsAt.getTime() - c.shift.endsAt.getTime())) / 3_600_000;
    if (gapH < (c.urgent ? 8 : 11)) return block("not enough rest between shifts");
  }
  const dow = dowOf(c.shift.date);
  for (const r of c.recurring) {
    if (r.kind !== "unavailable" || !r.dows.includes(dow)) continue;
    if (r.validFrom && c.shift.date < r.validFrom) continue;
    if (r.validTo && c.shift.date > r.validTo) continue;
    if (r.startMin < c.shift.endMin && r.endMin > c.shift.startMin) return block(r.description);
  }

  const mem = memoryRules(c.memoryText, c.shift);
  if (mem.block) return block(mem.block);

  let score = 50;
  if (mem.penalty) {
    score += mem.penalty.w;
    reasons.push(mem.penalty);
  }
  if (c.availability === null) {
    flags.unknownAvailability = true;
    score -= 6;
    reasons.push({ t: "hasn't shared availability for that week", w: -6 });
  } else {
    const day = c.availability.filter((a) => a.date === c.shift.date);
    if (day.some((a) => a.kind === "unavailable" && a.startMin < c.shift.endMin && a.endMin > c.shift.startMin)) return block("said they can't that day");
    const positive = day.filter((a) => a.kind !== "unavailable");
    const covered = positive.filter((a) => a.startMin <= c.shift.startMin && a.endMin >= c.shift.endMin);
    if (covered.length) {
      const pref = covered.some((a) => a.kind === "preferred");
      const maybe = covered.every((a) => a.kind === "maybe");
      const w = pref ? 30 : maybe ? 8 : 24;
      score += w;
      reasons.push({ t: pref ? "said it's a preferred time" : maybe ? "said 'maybe' for this time" : "said they're free then", w });
    } else if (positive.some((a) => a.startMin < c.shift.endMin && a.endMin > c.shift.startMin)) {
      flags.partial = true;
      score += 4;
      reasons.push({ t: "free for part of it", w: 4 });
    } else {
      score -= 14;
      reasons.push({ t: "didn't list this time as free", w: -14 });
    }
  }

  const headroom = c.worker.maxHours - c.weekHours - hours;
  if (headroom < 0) {
    flags.overtime = true;
    score -= 25;
    reasons.push({ t: `would go ${Math.abs(headroom).toFixed(0)}h over their ${c.worker.maxHours}h cap`, w: -25 });
  } else if (c.weekHours < c.worker.desiredHours) {
    const w = ((c.worker.desiredHours - c.weekHours) / c.worker.desiredHours) * 12;
    score += w;
    reasons.push({ t: `wants more hours (${c.weekHours.toFixed(0)}/${c.worker.desiredHours}h)`, w });
  }

  const tw = travelMin * (c.urgent ? 0.6 : 0.3);
  score -= tw;
  reasons.push({ t: `${travelMin} min away`, w: -tw });
  if (c.worker.homeOutletId === c.shift.outletId) {
    score += 6;
    reasons.push({ t: "home outlet", w: 6 });
  }

  const rel = c.worker.persona.reliability;
  const rw = (rel - 0.75) * 40;
  score += rw;
  if (rel >= 0.9) reasons.push({ t: `${Math.round(rel * 100)}% reliable`, w: rw });
  else if (rel < 0.8) reasons.push({ t: "patchy reliability lately", w: rw });

  const st = c.worker.stats;
  if (st.offersReceived > 0) {
    const ar = st.offersAccepted / st.offersReceived;
    score += ar * 10;
    if (ar >= 0.6) reasons.push({ t: `accepts most cover requests (${st.offersAccepted}/${st.offersReceived})`, w: ar * 10 });
  }
  if (c.memoryText.some((m) => /pick up|last-minute|extra shifts/i.test(m))) {
    score += 8;
    reasons.push({ t: "happy to pick up extra shifts", w: 8 });
  }
  if (c.offersLast7d > 0) {
    score -= c.offersLast7d * 3;
    reasons.push({ t: `already asked ${c.offersLast7d}× this week`, w: -c.offersLast7d * 3 });
  }
  if (c.acceptedLast14d > 0) {
    score -= c.acceptedLast14d * 4;
    reasons.push({ t: "covered recently, spreading the load", w: -c.acceptedLast14d * 4 });
  }

  const top = [...reasons].sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 4).map((r) => r.t);
  return { ...base, score: Math.round(score), eligible: true, reasons: top, flags };
}

/** Rank everyone in the org for a given shift */
export async function rankCandidates(shift: Shift, opts: { exclude?: string[]; urgent: boolean }) {
  const orgId = shift.orgId;
  const [ws, os] = await Promise.all([orgWorkers(orgId), orgOutlets(orgId)]);
  const outlet = os.find((o) => o.id === shift.outletId)!;
  const ids = ws.filter((w) => !opts.exclude?.includes(w.id)).map((w) => w.id);
  if (!ids.length) return [];
  const t = await now(orgId);
  const from = addDays(shift.date, -1);
  const to = addDays(shift.date, 1);
  const weekStart = weekStartOf(shift.date);
  const cycle = await cycleForDate(orgId, shift.date);

  const [around, weekRows, avail, recs, mems, recentOffers] = await Promise.all([
    db
      .select()
      .from(shifts)
      .where(and(inArray(shifts.workerId, ids), gte(shifts.date, from), lte(shifts.date, to), inArray(shifts.status, ["assigned", "confirmed", "covered", "draft"]))),
    db
      .select()
      .from(shifts)
      .where(and(inArray(shifts.workerId, ids), gte(shifts.date, weekStart), lte(shifts.date, addDays(weekStart, 6)), inArray(shifts.status, ["assigned", "confirmed", "covered", "completed", "draft"]))),
    cycle ? db.select().from(availability).where(and(eq(availability.cycleId, cycle.id), inArray(availability.workerId, ids))) : Promise.resolve([]),
    db.select().from(recurringConstraints).where(inArray(recurringConstraints.workerId, ids)),
    db.select().from(memories).where(and(inArray(memories.workerId, ids), eq(memories.active, true))),
    db.select().from(offers).where(and(inArray(offers.workerId, ids), gte(offers.sentAt, new Date(t.getTime() - 14 * 86400_000)))),
  ]);

  const startMin = localParts(shift.startsAt).minutes;
  const endMin = localParts(shift.endsAt).minutes || 1440;
  const submitted = new Set(avail.map((a) => a.workerId));

  return ws
    .filter((w) => ids.includes(w.id))
    .map((w) =>
      scoreCandidate({
        worker: w,
        shift: { outletId: shift.outletId, date: shift.date, startMin, endMin, skill: shift.skill, startsAt: shift.startsAt, endsAt: shift.endsAt },
        outlet,
        nearbyShifts: around.filter((s) => s.workerId === w.id && s.id !== shift.id),
        weekHours: weekRows.filter((s) => s.workerId === w.id && s.id !== shift.id).reduce((h, s) => h + (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000, 0),
        availability: submitted.has(w.id) ? avail.filter((a) => a.workerId === w.id) : null,
        recurring: recs.filter((r) => r.workerId === w.id),
        memoryText: mems.filter((m) => m.workerId === w.id).map((m) => m.content),
        offersLast7d: recentOffers.filter((o) => o.workerId === w.id && o.sentAt.getTime() > t.getTime() - 7 * 86400_000).length,
        acceptedLast14d: recentOffers.filter((o) => o.workerId === w.id && o.status === "accepted").length,
        urgent: opts.urgent,
      }),
    )
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}
