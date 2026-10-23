import { describe, expect, it } from "vitest";
import { coverageKind, solve, type SolverAvailability, type SolverSlot, type SolverWorker } from "@/agent/solver";
import { patternAvailability, templateSlots } from "@/db/seed-avail";
import { AREAS, KOPI_OUTLETS, KOPI_TEMPLATES, KOPI_WORKERS, pattern } from "@/db/seed-data";
import { weekDates } from "@/lib/time";

const outlet = { id: "o1", name: "Test", lat: 1.3, lng: 103.8 };
const slot = (id: string, date: string, start: number, end: number, skill = "barista"): SolverSlot => ({ id, outletId: "o1", date, startMin: start * 60, endMin: end * 60, label: start < 10 ? "Opening" : "Closing", skill });
const worker = (id: string, extra: Partial<SolverWorker> = {}): SolverWorker => ({
  id,
  name: id,
  skills: ["barista"],
  maxHours: 20,
  desiredHours: 12,
  homeLat: 1.3,
  homeLng: 103.8,
  homeOutletId: "o1",
  reliability: 0.9,
  ...extra,
});
const avail = (workerId: string, date: string, s: number, e: number, kind: SolverAvailability["kind"] = "available"): SolverAvailability => ({ workerId, date, startMin: s * 60, endMin: e * 60, kind });

describe("coverageKind", () => {
  it("needs the whole slot covered, across adjacent windows", () => {
    const s = slot("a", "2026-10-26", 7, 13);
    expect(coverageKind([avail("w", "2026-10-26", 7, 12), avail("w", "2026-10-26", 12, 17)], s)).toBe("available");
    expect(coverageKind([avail("w", "2026-10-26", 8, 17)], s)).toBeNull();
  });
  it("is blocked by any overlapping unavailable window", () => {
    const s = slot("a", "2026-10-26", 7, 13);
    expect(coverageKind([avail("w", "2026-10-26", 7, 23), avail("w", "2026-10-26", 9, 10, "unavailable")], s)).toBeNull();
  });
  it("reports the weakest kind used", () => {
    const s = slot("a", "2026-10-26", 7, 13);
    expect(coverageKind([avail("w", "2026-10-26", 7, 12, "preferred"), avail("w", "2026-10-26", 12, 17, "maybe")], s)).toBe("maybe");
  });
});

describe("solve", () => {
  it("never breaks hard rules: skill, availability, one shift a day, rest, hours cap", () => {
    const date = "2026-10-26";
    const next = "2026-10-27";
    const slots = [slot("close", date, 17, 22), slot("open", next, 7, 13), slot("cash", date, 11, 15, "cashier")];
    const workers = [worker("a", { maxHours: 6 }), worker("b")];
    const availability = [avail("a", date, 7, 23), avail("a", next, 7, 23), avail("b", next, 7, 23)];
    const r = solve({ slots, workers, outlets: [outlet], availability });
    expect(r.stats.hardViolations).toBe(0);
    const by = Object.fromEntries(r.assignments.map((a) => [a.slotId, a.workerId]));
    expect(by.cash).toBeUndefined(); // nobody is a cashier
    expect(by.close).toBe("a");
    expect(by.open).toBe("b"); // a would break 11h rest and the 6h cap
    expect(r.shortages.map((s) => s.slotId)).toEqual(["cash"]);
  });

  it("explains every assignment", () => {
    const r = solve({ slots: [slot("x", "2026-10-26", 7, 13)], workers: [worker("a")], outlets: [outlet], availability: [avail("a", "2026-10-26", 7, 13, "preferred")] });
    expect(r.assignments[0].reasons.length).toBeGreaterThan(0);
    expect(r.assignments[0].reasons.join(" ")).toMatch(/preferred/);
  });

  it("spreads hours fairly instead of giving everything to one person", () => {
    const dates = weekDates("2026-10-26").slice(0, 4);
    const slots = dates.map((d, i) => slot(`s${i}`, d, 7, 13));
    const workers = [worker("a", { desiredHours: 12 }), worker("b", { desiredHours: 12 })];
    const availability = dates.flatMap((d) => [avail("a", d, 7, 23), avail("b", d, 7, 23)]);
    const r = solve({ slots, workers, outlets: [outlet], availability });
    const count = (id: string) => r.assignments.filter((a) => a.workerId === id).length;
    expect(count("a")).toBe(2);
    expect(count("b")).toBe(2);
  });

  it("repairs a gap by moving someone who can be replaced", () => {
    const d = "2026-10-26";
    // a can do both; b can only do the closing. Greedy may put a on closing; repair should fix it.
    const slots = [slot("open", d, 7, 13), slot("close", d, 17, 22)];
    const workers = [worker("a"), worker("b")];
    const availability = [avail("a", d, 7, 23), avail("b", d, 17, 23)];
    const r = solve({ slots, workers, outlets: [outlet], availability });
    expect(r.stats.filled).toBe(2);
  });

  it("solves the real seed week quickly with zero violations", () => {
    const dates = weekDates("2026-10-26");
    const outlets = KOPI_OUTLETS.map((o) => ({ ...o, id: `out_${o.code.toLowerCase()}` }));
    let a = 7;
    const rand = () => ((a = (a * 16807) % 2147483647), a / 2147483647);
    const workers = KOPI_WORKERS.map((w) => worker(`wkr_${w.key}`, { name: w.name, skills: w.skills, maxHours: w.max, desiredHours: w.desired, homeLat: AREAS[w.area].lat, homeLng: AREAS[w.area].lng, homeOutletId: `out_${w.home.toLowerCase()}`, reliability: w.rel }));
    const availability = KOPI_WORKERS.flatMap((w) => patternAvailability(`wkr_${w.key}`, pattern(w.pattern), dates, rand, "c", new Date())) as SolverAvailability[];
    const t0 = Date.now();
    const r = solve({ slots: templateSlots(outlets, KOPI_TEMPLATES, dates), workers, outlets, availability });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.stats.hardViolations).toBe(0);
    expect(r.stats.coverage).toBeGreaterThan(0.85);
  });
});
