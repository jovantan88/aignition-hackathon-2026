import type * as s from "./schema";
import type { OutletSeed, TemplateSeed } from "./seed-data";
import type { SolverSlot } from "@/agent/solver";
import { BLOCKS, toMinutes } from "@/lib/time";

/** Expand the ground-truth persona pattern into availability windows for a week */
export function patternAvailability(workerId: string, p: s.Persona["pattern"], dates: string[], rand: () => number, cycleId: string, createdAt: Date) {
  const rows: (typeof s.availability.$inferInsert)[] = [];
  dates.forEach((date, dow) => {
    const blocks = p[String(dow)] ?? [];
    if (!blocks.length) return;
    // 8% chance they drop a day this week, for realism
    if (rand() < 0.08) return;
    const sorted = [...blocks].sort((a, b) => BLOCKS[a].start - BLOCKS[b].start);
    // merge contiguous blocks
    let cur = { start: BLOCKS[sorted[0]].start, end: BLOCKS[sorted[0]].end };
    const merged: { start: number; end: number }[] = [];
    for (const b of sorted.slice(1)) {
      if (BLOCKS[b].start <= cur.end) cur.end = Math.max(cur.end, BLOCKS[b].end);
      else {
        merged.push(cur);
        cur = { start: BLOCKS[b].start, end: BLOCKS[b].end };
      }
    }
    merged.push(cur);
    for (const m of merged) {
      rows.push({
        id: `avl_${workerId.slice(4)}_${date}_${m.start}`,
        workerId,
        cycleId,
        date,
        startMin: m.start,
        endMin: m.end,
        kind: rand() < 0.2 ? "preferred" : "available",
        source: "flow",
        confidence: 1,
        createdAt,
      });
    }
  });
  return rows;
}

export function templateSlots(outlets: (OutletSeed & { id: string })[], templates: TemplateSeed[], dates: string[]): SolverSlot[] {
  const slots: SolverSlot[] = [];
  for (const o of outlets) {
    dates.forEach((date, dow) => {
      for (const t of templates) {
        if (!t.dows.includes(dow)) continue;
        if (t.onlyCbd && !o.cbd) continue;
        const n = o.busy && t.busyHeadcount ? t.busyHeadcount : t.headcount;
        for (let i = 0; i < n; i++) {
          slots.push({
            id: `slot_${o.code}_${date}_${t.label.replace(/\s+/g, "")}_${i}`,
            outletId: o.id,
            date,
            startMin: toMinutes(t.start),
            endMin: toMinutes(t.end),
            label: t.label,
            skill: t.skill,
          });
        }
      }
    });
  }
  return slots;
}

