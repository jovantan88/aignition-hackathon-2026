/**
 * Parse-accuracy eval: sends real-world availability messages (Singlish, Chinese,
 * Malay, typos) through the full agent pipeline and checks what it saved.
 * Uses the demo database, then resets it.  Run: npm run eval:parse
 */
import { config } from "dotenv";

config({ path: ".env.local" });

type Expect = { free?: number[]; off?: number[]; windows?: Record<number, [number, number]> };
// Day index 0 = Monday of the week being planned. Windows are [startHour, endHour], checked with ±1h tolerance.
const FIXTURES: { msg: string; expect: Expect }[] = [
  { msg: "mon to wed after 5 can, thurs cannot, sat whole day", expect: { free: [0, 1, 2, 5], off: [3], windows: { 0: [17, 23], 5: [7, 23] } } },
  { msg: "weekends only this week, exams 😭", expect: { free: [5, 6], off: [0, 1, 2, 3, 4] } },
  { msg: "can do tues n thurs morning, fri night", expect: { free: [1, 3, 4], windows: { 1: [7, 12], 4: [17, 23] } } },
  { msg: "anytime except sunday", expect: { free: [0, 1, 2, 3, 4, 5], off: [6] } },
  { msg: "Hi! Can do Wed & Fri evenings and Sat morning. Thanks!", expect: { free: [2, 4, 5], windows: { 2: [17, 23], 5: [7, 12] } } },
  { msg: "not working this week, going back to KL 🙏", expect: { off: [0, 1, 2, 3, 4, 5, 6] } },
  { msg: "mon wed fri afternoon ok", expect: { free: [0, 2, 4], windows: { 0: [12, 17] } } },
  { msg: "sat sun can, weekdays after 6pm only", expect: { free: [0, 1, 2, 3, 4, 5, 6], windows: { 0: [18, 23], 5: [7, 23] } } },
  { msg: "星期一到三早上可以，周末不行", expect: { free: [0, 1, 2], off: [5, 6], windows: { 0: [7, 12] } } },
  { msg: "boleh kerja isnin dan selasa petang, sabtu pagi", expect: { free: [0, 1, 5], windows: { 0: [12, 17], 5: [7, 12] } } },
  { msg: "only fri, the whole day", expect: { free: [4], off: [0] } },
  { msg: "mon 9-3, tue 12-6, thu 5-10", expect: { free: [0, 1, 3], windows: { 0: [9, 15], 1: [12, 18], 3: [17, 22] } } },
  { msg: "free from tues onwards, but sun need to leave by 4", expect: { free: [1, 2, 3, 4, 5, 6], windows: { 6: [7, 16] } } },
  { msg: "maybe sat if really needed, otherwise thurs evening", expect: { free: [3, 5], windows: { 3: [17, 23] } } },
  { msg: "cannot mon tue, rest ok", expect: { free: [2, 3, 4, 5, 6], off: [0, 1] } },
  { msg: "Hello, I'm available on Monday, Wednesday and Friday from 10am to 4pm.", expect: { free: [0, 2, 4], windows: { 0: [10, 16], 4: [10, 16] } } },
  { msg: "wkday mornings ok, wkend no", expect: { free: [0, 1, 2, 3, 4], off: [5, 6], windows: { 2: [7, 12] } } },
  { msg: "this wk can only do sun lunch time", expect: { free: [6], off: [0] } },
  { msg: "after sch tues thurs, sat sun anytime", expect: { free: [1, 3, 5, 6], windows: { 5: [7, 23] } } },
  { msg: "next week got class mon-thu till 2pm, can work after that. fri sat sun free", expect: { free: [0, 1, 2, 3, 4, 5, 6], windows: { 0: [14, 23], 4: [7, 23] } } },
  { msg: "Sorry late reply! Tue and Thu after 7 can", expect: { free: [1, 3], windows: { 1: [19, 23] } } },
  { msg: "Mon off. Tue-Fri closing shifts ok. Weekend morning only", expect: { free: [1, 2, 3, 4, 5, 6], off: [0], windows: { 1: [17, 23], 5: [7, 12] } } },
  { msg: "anytime 👍", expect: { free: [0, 1, 2, 3, 4, 5, 6] } },
  { msg: "tmr onwards I can do whole week except wed", expect: { free: [0, 1, 3, 4, 5, 6], off: [2] } },
];

async function main() {
  const { db } = await import("../src/db/index");
  const s = await import("../src/db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { receiveInbound } = await import("../src/agent/inbound");
  const { processConversation } = await import("../src/agent/conversation");
  const { now } = await import("../src/lib/clock");
  const { addDays, localParts, weekStartOf } = await import("../src/lib/time");
  const { newId } = await import("../src/lib/ids");
  const { seedDemo } = await import("../src/db/seed");
  const { sendMessage } = await import("../src/whatsapp/send");
  const { wa } = await import("../src/whatsapp/types");

  await seedDemo();
  const orgId = "org_kopilab";
  const weekStart = addDays(weekStartOf(localParts(await now(orgId)).date), 7);
  const cycleId = newId("cyc");
  await db.insert(s.planningCycles).values({ id: cycleId, orgId, weekStart, status: "collecting", goal: "eval", demandOverrides: [], deadlineAt: new Date(Date.now() + 86400_000) });
  const workers = (await db.select().from(s.workers).where(eq(s.workers.orgId, orgId))).slice(0, FIXTURES.length);
  console.log(`Planning week ${weekStart}. Running ${FIXTURES.length} messages through the agent…\n`);

  let dayChecks = 0;
  let dayCorrect = 0;
  let winChecks = 0;
  let winCorrect = 0;
  const run = async (i: number) => {
    const f = FIXTURES[i];
    const w = workers[i];
    const conv = (await db.query.conversations.findFirst({ where: and(eq(s.conversations.workerId, w.id), eq(s.conversations.kind, "worker_dm")) }))!;
    // Realistic context: the agent has just asked for availability
    await sendMessage({ orgId, conversationId: conv.id, payload: wa.text(`Hi! I'm planning the roster for the week of ${weekStart}. When can you work? You can reply in your own words.`), instant: true });
    await db.update(s.conversations).set({ lastInboundAt: new Date() }).where(eq(s.conversations.id, conv.id));
    const { id } = await receiveInbound(conv.id, { type: "text", text: { body: f.msg } });
    await processConversation(conv.id, { noDebounce: true });
    const rows = await db.select().from(s.availability).where(and(eq(s.availability.cycleId, cycleId), eq(s.availability.workerId, w.id)));
    const lines: string[] = [];
    const freeOn = (d: number) => rows.some((r) => r.date === addDays(weekStart, d) && r.kind !== "unavailable");
    for (const d of f.expect.free ?? []) {
      dayChecks++;
      if (freeOn(d)) dayCorrect++;
      else lines.push(`  ✗ expected day ${d} free`);
    }
    for (const d of f.expect.off ?? []) {
      dayChecks++;
      if (!freeOn(d)) dayCorrect++;
      else lines.push(`  ✗ expected day ${d} off`);
    }
    for (const [d, [a, b]] of Object.entries(f.expect.windows ?? {})) {
      winChecks++;
      const r = rows.filter((x) => x.date === addDays(weekStart, Number(d)) && x.kind !== "unavailable");
      const ok = r.some((x) => Math.abs(x.startMin / 60 - a) <= 1 && Math.abs(x.endMin / 60 - b) <= 1);
      if (ok) winCorrect++;
      else lines.push(`  ✗ day ${d}: expected ${a}–${b}h, got ${r.map((x) => `${x.startMin / 60}–${x.endMin / 60}`).join(", ") || "nothing"}`);
    }
    console.log(`${lines.length ? "✗" : "✓"} ${f.msg}`);
    for (const l of lines) console.log(l);
    void id;
  };
  for (let i = 0; i < FIXTURES.length; i += 6) await Promise.all(Array.from({ length: Math.min(6, FIXTURES.length - i) }, (_, k) => run(i + k)));

  const dayAcc = dayCorrect / dayChecks;
  const winAcc = winCorrect / Math.max(1, winChecks);
  console.log(`\nDays: ${dayCorrect}/${dayChecks} (${(dayAcc * 100).toFixed(1)}%) · Time windows: ${winCorrect}/${winChecks} (${(winAcc * 100).toFixed(1)}%)`);
  console.log(dayAcc >= 0.9 ? "PASS (target ≥ 90%)" : "BELOW TARGET (90%)");
  await seedDemo();
  console.log("Demo data reset.");
  void inArray;
  process.exit(dayAcc >= 0.9 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
