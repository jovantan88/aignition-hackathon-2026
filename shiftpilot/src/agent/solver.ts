/**
 * Roster solver. Pure functions, no DB access.
 *
 * Fills the hardest slots first (fewest eligible people), scores candidates on
 * fairness, preference, travel and reliability, then runs a repair pass that
 * moves people between slots to fill shortages.
 */
import { haversineKm, travelMinutes } from "@/lib/geo";
import { firstName } from "@/lib/names";
import { daysBetween } from "@/lib/time";

export type SolverSlot = {
  id: string;
  outletId: string;
  date: string;
  startMin: number;
  endMin: number;
  label: string;
  skill: string;
};

export type SolverWorker = {
  id: string;
  name: string;
  skills: string[];
  maxHours: number;
  desiredHours: number;
  homeLat: number;
  homeLng: number;
  homeOutletId: string | null;
  reliability: number; // 0..1
  /** Hours already committed outside this solve (e.g. kept shifts) */
  committedHours?: number;
  likes?: string[];
  avoids?: string[];
  preferredOutletIds?: string[];
  avoidOutletIds?: string[];
  maxTravelKm?: number;
  /** Local minutes after which they cannot finish (e.g. last bus) */
  latestEndMin?: number;
};

export type SolverAvailability = {
  workerId: string;
  date: string;
  startMin: number;
  endMin: number;
  kind: "available" | "preferred" | "maybe" | "unavailable";
};

export type SolverOutlet = { id: string; name: string; lat: number; lng: number };

export type Assignment = {
  slotId: string;
  workerId: string;
  score: number;
  reasons: string[];
  alternatives: { workerId: string; name: string; score: number }[];
};

export type Shortage = { slotId: string; reason: string; nearMisses: { workerId: string; name: string; why: string }[] };

export type Surplus = { workerId: string; name: string; assignedHours: number; desiredHours: number; spareHours: number };

export type SolveResult = {
  assignments: Assignment[];
  shortages: Shortage[];
  surplus: Surplus[];
  stats: { slots: number; filled: number; coverage: number; repairs: number; hardViolations: number };
};

const MIN_REST_MIN = 11 * 60;
const DEFAULT_MAX_TRAVEL_KM = 18;

type Ctx = {
  slots: SolverSlot[];
  slotById: Map<string, SolverSlot>;
  workers: Map<string, SolverWorker>;
  outlets: Map<string, SolverOutlet>;
  avail: Map<string, SolverAvailability[]>;
};

type State = {
  bySlot: Map<string, string>; // slotId -> workerId
  byWorker: Map<string, SolverSlot[]>;
  hours: Map<string, number>;
  byOutletDate: Map<string, Set<string>>; // outletId|date -> slotIds
};

const odKey = (s: SolverSlot) => `${s.outletId}|${s.date}`;

const slotHours = (s: SolverSlot) => (s.endMin - s.startMin) / 60;

/** How the worker's availability covers the slot: best kind that covers it fully, or null. */
export function coverageKind(avail: SolverAvailability[] | undefined, slot: SolverSlot) {
  if (!avail) return null;
  const sameDay = avail.filter((a) => a.date === slot.date);
  // Hard block if any unavailable window overlaps
  if (sameDay.some((a) => a.kind === "unavailable" && a.startMin < slot.endMin && a.endMin > slot.startMin)) return null;
  // Merge positive windows (any kind) and check full cover; report weakest kind used
  const positive = sameDay.filter((a) => a.kind !== "unavailable").sort((a, b) => a.startMin - b.startMin);
  let cursor = slot.startMin;
  let weakest: "preferred" | "available" | "maybe" = "preferred";
  const rank = { preferred: 2, available: 1, maybe: 0 } as const;
  for (const a of positive) {
    if (a.endMin <= cursor) continue;
    if (a.startMin > cursor) break;
    const k = a.kind as "preferred" | "available" | "maybe";
    if (rank[k] < rank[weakest]) weakest = k;
    cursor = Math.max(cursor, a.endMin);
    if (cursor >= slot.endMin) return weakest;
  }
  return null;
}

function absMin(slot: { date: string; startMin: number; endMin: number }, base: string) {
  const day = daysBetween(base, slot.date);
  return { start: day * 1440 + slot.startMin, end: day * 1440 + slot.endMin };
}

/** Hard constraints: skill, availability, hours cap, one shift per day, rest, travel radius. Returns reason or null. */
export function hardBlock(ctx: Ctx, st: State, w: SolverWorker, slot: SolverSlot): string | null {
  if (!w.skills.includes(slot.skill)) return `no ${slot.skill} skill`;
  const kind = coverageKind(ctx.avail.get(w.id), slot);
  if (!kind) return "not available";
  const outlet = ctx.outlets.get(slot.outletId);
  if (outlet) {
    const km = haversineKm({ lat: w.homeLat, lng: w.homeLng }, outlet);
    if (km > (w.maxTravelKm ?? DEFAULT_MAX_TRAVEL_KM)) return `too far (${km.toFixed(0)} km)`;
  }
  if (w.avoidOutletIds?.includes(slot.outletId)) return "asked not to work at this outlet";
  if (w.latestEndMin != null && slot.endMin > w.latestEndMin) return "ends too late for them";
  const hrs = (st.hours.get(w.id) ?? 0) + (w.committedHours ?? 0) + slotHours(slot);
  if (hrs > w.maxHours + 1e-6) return `would exceed ${w.maxHours}h cap`;
  const mine = st.byWorker.get(w.id) ?? [];
  const base = slot.date;
  const s = absMin(slot, base);
  for (const other of mine) {
    if (other.date === slot.date) return "already working that day";
    const o = absMin(other, base);
    const gap = s.start >= o.end ? s.start - o.end : o.start - s.end;
    if (gap < MIN_REST_MIN) return "needs 11h rest between shifts";
  }
  return null;
}

export function scoreCandidate(ctx: Ctx, st: State, w: SolverWorker, slot: SolverSlot) {
  const reasons: { text: string; weight: number }[] = [];
  let score = 50;
  const kind = coverageKind(ctx.avail.get(w.id), slot);
  if (kind === "preferred") {
    score += 12;
    reasons.push({ text: "said this is a preferred time", weight: 12 });
  } else if (kind === "maybe") {
    score -= 18;
    reasons.push({ text: "only a 'maybe' for this time", weight: -18 });
  }

  const assigned = (st.hours.get(w.id) ?? 0) + (w.committedHours ?? 0);
  const deficit = Math.max(0, w.desiredHours - assigned);
  const fair = (deficit / Math.max(1, w.desiredHours)) * 30;
  score += fair;
  if (fair > 12) reasons.push({ text: `below their target hours (${assigned.toFixed(0)}/${w.desiredHours}h)`, weight: fair });
  if (assigned + slotHours(slot) > w.desiredHours) {
    score -= 10;
    reasons.push({ text: "would go above their desired hours", weight: -10 });
  }

  const outlet = ctx.outlets.get(slot.outletId);
  if (outlet) {
    const km = haversineKm({ lat: w.homeLat, lng: w.homeLng }, outlet);
    const pen = km * 1.3;
    score -= pen;
    reasons.push({ text: `${travelMinutes(km)} min from home`, weight: -pen });
  }
  if (w.homeOutletId === slot.outletId) {
    score += 8;
    reasons.push({ text: "their home outlet", weight: 8 });
  }
  if (w.preferredOutletIds?.includes(slot.outletId)) {
    score += 6;
    reasons.push({ text: "prefers this outlet", weight: 6 });
  }

  const relW = slot.label.toLowerCase().includes("open") ? 20 : 10;
  const rel = (w.reliability - 0.7) * relW;
  score += rel;
  if (w.reliability >= 0.9) reasons.push({ text: `very reliable (${Math.round(w.reliability * 100)}%)`, weight: rel });
  if (w.reliability < 0.7) reasons.push({ text: "less reliable recently", weight: rel });

  // Coworker affinity with people already on overlapping slots at the same outlet
  for (const sid of st.byOutletDate.get(odKey(slot)) ?? []) {
    const other = ctx.slotById.get(sid);
    const wid = st.bySlot.get(sid);
    if (!other || !wid || wid === w.id) continue;
    if (other.startMin >= slot.endMin || other.endMin <= slot.startMin) continue;
    const ow = ctx.workers.get(wid);
    if (w.likes?.includes(wid)) {
      score += 6;
      reasons.push({ text: `works well with ${firstName(ow?.name ?? "")}`, weight: 6 });
    }
    if (w.avoids?.includes(wid) || ow?.avoids?.includes(w.id)) {
      score -= 14;
      reasons.push({ text: `prefers not to pair with ${firstName(ow?.name ?? "")}`, weight: -14 });
    }
  }
  return { score, reasons };
}

function topReasons(reasons: { text: string; weight: number }[]) {
  return [...reasons]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3)
    .map((r) => r.text);
}

function assign(st: State, slot: SolverSlot, workerId: string) {
  st.bySlot.set(slot.id, workerId);
  const k = odKey(slot);
  if (!st.byOutletDate.has(k)) st.byOutletDate.set(k, new Set());
  st.byOutletDate.get(k)!.add(slot.id);
  st.byWorker.set(workerId, [...(st.byWorker.get(workerId) ?? []), slot]);
  st.hours.set(workerId, (st.hours.get(workerId) ?? 0) + slotHours(slot));
}

function unassign(st: State, slot: SolverSlot) {
  const wid = st.bySlot.get(slot.id);
  if (!wid) return;
  st.bySlot.delete(slot.id);
  st.byOutletDate.get(odKey(slot))?.delete(slot.id);
  st.byWorker.set(
    wid,
    (st.byWorker.get(wid) ?? []).filter((s) => s.id !== slot.id),
  );
  st.hours.set(wid, (st.hours.get(wid) ?? 0) - slotHours(slot));
}

export function solve(input: {
  slots: SolverSlot[];
  workers: SolverWorker[];
  outlets: SolverOutlet[];
  availability: SolverAvailability[];
  /** Pre-assigned slotId -> workerId that must be kept */
  locked?: Record<string, string>;
}): SolveResult {
  const avail = new Map<string, SolverAvailability[]>();
  for (const a of input.availability) avail.set(a.workerId, [...(avail.get(a.workerId) ?? []), a]);
  const ctx: Ctx = {
    slots: input.slots,
    slotById: new Map(input.slots.map((x) => [x.id, x])),
    workers: new Map(input.workers.map((w) => [w.id, w])),
    outlets: new Map(input.outlets.map((o) => [o.id, o])),
    avail,
  };
  const st: State = { bySlot: new Map(), byWorker: new Map(), hours: new Map(), byOutletDate: new Map() };
  const meta = new Map<string, Assignment>();

  for (const [slotId, workerId] of Object.entries(input.locked ?? {})) {
    const slot = ctx.slotById.get(slotId);
    if (slot && ctx.workers.has(workerId)) {
      assign(st, slot, workerId);
      meta.set(slotId, { slotId, workerId, score: 100, reasons: ["kept from previous roster"], alternatives: [] });
    }
  }

  const eligibleCount = (slot: SolverSlot) =>
    input.workers.filter((w) => w.skills.includes(slot.skill) && coverageKind(avail.get(w.id), slot)).length;

  const order = input.slots
    .filter((s) => !st.bySlot.has(s.id))
    .map((s) => ({ s, n: eligibleCount(s) }))
    .sort((a, b) => a.n - b.n || a.s.date.localeCompare(b.s.date) || a.s.startMin - b.s.startMin)
    .map((x) => x.s);

  for (const slot of order) {
    const scored = input.workers
      .filter((w) => !hardBlock(ctx, st, w, slot))
      .map((w) => ({ w, ...scoreCandidate(ctx, st, w, slot) }))
      .sort((a, b) => b.score - a.score);
    if (!scored.length) continue;
    const best = scored[0];
    assign(st, slot, best.w.id);
    meta.set(slot.id, {
      slotId: slot.id,
      workerId: best.w.id,
      score: Math.round(best.score),
      reasons: topReasons(best.reasons),
      alternatives: scored.slice(1, 3).map((c) => ({ workerId: c.w.id, name: c.w.name, score: Math.round(c.score) })),
    });
  }

  // Repair: fill an empty slot by moving someone from a slot that another free person can take
  let repairs = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const empty of input.slots.filter((s) => !st.bySlot.has(s.id))) {
      // Only people who could do the empty slot apart from their current load
      const movable = input.workers.filter((w) => w.skills.includes(empty.skill) && coverageKind(avail.get(w.id), empty));
      let done = false;
      for (const w of movable) {
        if (done) break;
        for (const other of [...(st.byWorker.get(w.id) ?? [])]) {
          if (input.locked?.[other.id]) continue;
          unassign(st, other);
          if (hardBlock(ctx, st, w, empty)) {
            assign(st, other, w.id);
            continue;
          }
          assign(st, empty, w.id);
          const replacement = input.workers
            .filter((c) => c.id !== w.id && !hardBlock(ctx, st, c, other))
            .map((c) => ({ c, ...scoreCandidate(ctx, st, c, other) }))
            .sort((a, b) => b.score - a.score)[0];
          if (replacement) {
            assign(st, other, replacement.c.id);
            const prev = meta.get(other.id)!;
            meta.set(empty.id, { ...prev, slotId: empty.id, reasons: [...prev.reasons.slice(0, 2), "moved here to close a gap"] });
            meta.set(other.id, {
              slotId: other.id,
              workerId: replacement.c.id,
              score: Math.round(replacement.score),
              reasons: topReasons(replacement.reasons),
              alternatives: [],
            });
            repairs++;
            done = true;
            break;
          }
          unassign(st, empty);
          assign(st, other, w.id);
        }
      }
    }
  }

  const assignments: Assignment[] = [];
  for (const [slotId, workerId] of st.bySlot) {
    const m = meta.get(slotId)!;
    assignments.push({ ...m, workerId });
  }

  const shortages: Shortage[] = input.slots
    .filter((s) => !st.bySlot.has(s.id))
    .map((slot) => {
      const near = input.workers
        .filter((w) => w.skills.includes(slot.skill))
        .map((w) => ({ w, why: hardBlock(ctx, st, w, slot) }))
        .filter((x) => x.why && x.why !== `no ${slot.skill} skill`)
        .sort((a, b) => {
          const order = (r: string) => (r.startsWith("not available") ? 2 : r.includes("cap") ? 0 : 1);
          return order(a.why!) - order(b.why!);
        })
        .slice(0, 4)
        .map((x) => ({ workerId: x.w.id, name: x.w.name, why: x.why! }));
      const anyAvail = input.workers.some((w) => w.skills.includes(slot.skill) && coverageKind(avail.get(w.id), slot));
      return {
        slotId: slot.id,
        reason: anyAvail ? "everyone available is already at their limit or rostered that day" : "nobody with the right skill said they're free",
        nearMisses: near,
      };
    });

  const surplus: Surplus[] = input.workers
    .map((w) => {
      const assignedHours = (st.hours.get(w.id) ?? 0) + (w.committedHours ?? 0);
      const offered = (avail.get(w.id) ?? [])
        .filter((a) => a.kind !== "unavailable")
        .reduce((s, a) => s + (a.endMin - a.startMin) / 60, 0);
      return { workerId: w.id, name: w.name, assignedHours, desiredHours: w.desiredHours, spareHours: Math.max(0, offered - assignedHours) };
    })
    .filter((s) => s.spareHours >= 5 && s.assignedHours < s.desiredHours * 0.6)
    .sort((a, b) => a.assignedHours / a.desiredHours - b.assignedHours / b.desiredHours);

  // Count hard violations in the final state (should always be 0)
  let hardViolations = 0;
  for (const [slotId, wid] of [...st.bySlot]) {
    if (input.locked?.[slotId]) continue;
    const slot = ctx.slotById.get(slotId)!;
    const w = ctx.workers.get(wid)!;
    unassign(st, slot);
    if (hardBlock(ctx, st, w, slot)) hardViolations++;
    assign(st, slot, wid);
  }

  return {
    assignments,
    shortages,
    surplus,
    stats: {
      slots: input.slots.length,
      filled: assignments.length,
      coverage: input.slots.length ? assignments.length / input.slots.length : 1,
      repairs,
      hardViolations,
    },
  };
}
