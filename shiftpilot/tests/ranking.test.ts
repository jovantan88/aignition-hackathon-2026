import { describe, expect, it } from "vitest";
import { memoryRules, scoreCandidate, type CandidateInput } from "@/agent/ranking";

const shift = (date = "2026-10-27", start = 7, end = 13): CandidateInput["shift"] => ({
  outletId: "o1",
  date,
  startMin: start * 60,
  endMin: end * 60,
  skill: "barista",
  startsAt: new Date(`${date}T${String(start).padStart(2, "0")}:00:00+08:00`),
  endsAt: new Date(`${date}T${String(end).padStart(2, "0")}:00:00+08:00`),
});

const base = (over: Partial<CandidateInput> = {}): CandidateInput => ({
  worker: {
    id: "w",
    name: "Test Person",
    skills: ["barista"],
    maxHours: 24,
    desiredHours: 16,
    homeLat: 1.33,
    homeLng: 103.74,
    homeOutletId: "o1",
    persona: { bio: "", style: "", reliability: 0.9, responsiveness: 0.8, pattern: {} },
    stats: { repliesMedianMin: 10, availabilityResponseRate: 1, offersReceived: 4, offersAccepted: 3, lateCancellations90d: 0, lateArrivals90d: 0, coverPickups90d: 1, shifts90d: 30 },
  },
  shift: shift(),
  outlet: { lat: 1.333, lng: 103.743 },
  nearbyShifts: [],
  weekHours: 6,
  availability: [{ date: "2026-10-27", startMin: 7 * 60, endMin: 23 * 60, kind: "available" }],
  recurring: [],
  memoryText: [],
  offersLast7d: 0,
  acceptedLast14d: 0,
  urgent: false,
  ...over,
});

describe("scoreCandidate", () => {
  it("blocks people without the skill, already working, or short on rest", () => {
    expect(scoreCandidate(base({ worker: { ...base().worker, skills: ["cashier"] } })).eligible).toBe(false);
    const s = shift();
    expect(scoreCandidate(base({ nearbyShifts: [{ startsAt: s.startsAt, endsAt: s.endsAt }] })).blockReason).toBe("already working then");
    const late = { startsAt: new Date("2026-10-26T17:00:00+08:00"), endsAt: new Date("2026-10-26T22:00:00+08:00") };
    expect(scoreCandidate(base({ nearbyShifts: [late] })).blockReason).toMatch(/rest/);
    // urgent cover relaxes rest to 8h
    expect(scoreCandidate(base({ nearbyShifts: [late], urgent: true })).eligible).toBe(true);
  });

  it("respects what they said and recurring constraints", () => {
    expect(scoreCandidate(base({ availability: [{ date: "2026-10-27", startMin: 0, endMin: 1440, kind: "unavailable" }] })).eligible).toBe(false);
    const rec = [{ dows: [1], startMin: 9 * 60, endMin: 13 * 60, kind: "unavailable" as const, description: "Class Tue 9–1", validFrom: null, validTo: null }];
    expect(scoreCandidate(base({ recurring: rec })).blockReason).toBe("Class Tue 9–1");
  });

  it("flags overtime instead of hiding it", () => {
    const c = scoreCandidate(base({ weekHours: 22 }));
    expect(c.eligible).toBe(true);
    expect(c.flags.overtime).toBe(true);
  });

  it("prefers available, nearby, reliable people who haven't been asked a lot", () => {
    const good = scoreCandidate(base());
    const asked = scoreCandidate(base({ offersLast7d: 3 }));
    const far = scoreCandidate(base({ worker: { ...base().worker, homeLat: 1.37, homeLng: 103.95, homeOutletId: "o2" } }));
    const unknown = scoreCandidate(base({ availability: null }));
    expect(good.score).toBeGreaterThan(asked.score);
    expect(good.score).toBeGreaterThan(far.score);
    expect(good.score).toBeGreaterThan(unknown.score);
    expect(unknown.flags.unknownAvailability).toBe(true);
  });
});

describe("memoryRules", () => {
  it("turns remembered constraints into blocks", () => {
    expect(memoryRules(["Doesn't work weekends (family time)"], shift("2026-10-31")).block).toBeTruthy();
    expect(memoryRules(["Doesn't work weekends (family time)"], shift("2026-10-27")).block).toBeUndefined();
    expect(memoryRules(["A-level papers until 20 Nov: weekends only"], shift("2026-10-27")).block).toBeTruthy();
    expect(memoryRules(["A-level papers until 20 Nov: weekends only"], shift("2026-10-31")).block).toBeUndefined();
    expect(memoryRules(["Knee issue: no shifts longer than 6 hours"], shift("2026-10-27", 7, 14)).block).toBeTruthy();
  });
  it("penalises softer preferences", () => {
    expect(memoryRules(["Avoids closing shifts – last bus"], shift("2026-10-27", 17, 22)).penalty?.w).toBeLessThan(0);
  });
});
