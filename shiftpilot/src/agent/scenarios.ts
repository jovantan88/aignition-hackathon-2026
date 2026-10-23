/**
 * Demo scenarios ("introduce a surprise"). Each one injects a realistic message
 * from a real worker through the normal inbound pipeline: nothing is faked
 * downstream of the message itself.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { shifts, workers } from "@/db/schema";
import { now } from "@/lib/clock";
import { localParts, relativeDay } from "@/lib/time";
import type { InboundPayload } from "@/whatsapp/types";
import { receiveInbound } from "./inbound";
import { dmFor, getWorker } from "./ops";
import { audit } from "./runs";

const g = globalThis as unknown as { __spFailNextLlm?: boolean };
export const consumeInjectedFailure = () => {
  const v = Boolean(g.__spFailNextLlm);
  g.__spFailNextLlm = false;
  return v;
};

async function inject(workerId: string, payload: InboundPayload) {
  const conv = await dmFor(workerId);
  if (!conv) throw new Error("no conversation");
  await receiveInbound(conv.id, payload);
  const { processConversation } = await import("./conversation");
  void processConversation(conv.id).catch((e) => console.error("[scenario]", e));
  return conv.id;
}

async function nextShiftFor(orgId: string, opts: { workerId?: string; withinHours: number; stageOnly?: boolean; inProgress?: boolean }) {
  const t = await now(orgId);
  const rows = await db
    .select({ s: shifts, autopilot: workers.autopilot })
    .from(shifts)
    .innerJoin(workers, eq(workers.id, shifts.workerId))
    .where(
      and(
        eq(shifts.orgId, orgId),
        inArray(shifts.status, ["assigned", "confirmed"]),
        opts.inProgress ? lte(shifts.startsAt, new Date(t.getTime() + 30 * 60_000)) : gte(shifts.startsAt, t),
        opts.inProgress ? gte(shifts.endsAt, new Date(t.getTime() + 30 * 60_000)) : lte(shifts.startsAt, new Date(t.getTime() + opts.withinHours * 3600_000)),
        opts.workerId ? eq(shifts.workerId, opts.workerId) : undefined,
        opts.stageOnly ? eq(workers.autopilot, false) : undefined,
      ),
    )
    .orderBy(asc(shifts.startsAt));
  return rows[0]?.s ?? null;
}

export async function runScenario(orgId: string, name: string, opts: { workerId?: string; voice?: boolean } = {}) {
  const t = await now(orgId);
  const today = localParts(t).date;
  const say = (body: string): InboundPayload => ({ type: "text", text: { body } });
  const log = (title: string) => audit(orgId, { kind: "decision", actor: "system", title: `Demo scenario: ${title}` });

  switch (name) {
    case "kickoff_week": {
      const { startWeeklyPlanning } = await import("./workflows/weekly");
      await log("weekly planning kicked off");
      return startWeeklyPlanning({ orgId, goal: "Plan next week for all outlets. Jurong has a Saturday promo so we need 2 extra on the afternoon. Orchard is closed on Monday for renovation." });
    }
    case "sick_call": {
      const s =
        (opts.workerId ? await nextShiftFor(orgId, { workerId: opts.workerId, withinHours: 72 }) : null) ??
        (await nextShiftFor(orgId, { workerId: "wkr_mei", withinHours: 72 })) ??
        (await nextShiftFor(orgId, { withinHours: 36, stageOnly: true })) ??
        (await nextShiftFor(orgId, { withinHours: 36 })) ??
        (await nextShiftFor(orgId, { withinHours: 24 * 7 }));
      if (!s) return { error: "No upcoming shift found to call in sick for" };
      const day = relativeDay(s.date, today);
      const when = day === "today" ? "today" : day === "tomorrow" ? "tmr" : `on ${day.slice(0, 3).toLowerCase()}`;
      await log(`${(await getWorker(s.workerId!))?.name} calls in sick`);
      return { conversationId: await inject(s.workerId!, say(`hi sorry ah i cannot make it ${when}, got fever since last night 🤒 so sorry`)) };
    }
    case "mid_shift_emergency": {
      const s = (await nextShiftFor(orgId, { withinHours: 2, inProgress: true })) ?? (await nextShiftFor(orgId, { withinHours: 4 }));
      if (!s) return { error: "Nobody is on shift right now. Jump the clock to a weekday 9am first." };
      await log(`${(await getWorker(s.workerId!))?.name} has to leave mid-shift`);
      return { conversationId: await inject(s.workerId!, say("Very sorry, my mum just called, family emergency. I need to leave the outlet now 😢")) };
    }
    case "timetable_change":
      await log("Jun Wei's uni timetable changed");
      return { conversationId: await inject("wkr_junwei", say("hey my uni timetable changed, now got class tue and thu mornings 9-1 until end nov. can still do afternoons")) };
    case "swap_request": {
      const s = await nextShiftFor(orgId, { workerId: "wkr_aisha", withinHours: 24 * 7 });
      await log("Aisha asks for a swap");
      return { conversationId: await inject("wkr_aisha", say(s ? `Hi, can I swap my ${relativeDay(s.date, today) === "tomorrow" ? "tomorrow" : "next"} shift with Kavitha? My son has a school event` : "Hi, can I swap one of my shifts with Kavitha?")) };
    }
    case "running_late": {
      const s = (await nextShiftFor(orgId, { withinHours: 3, stageOnly: true })) ?? (await nextShiftFor(orgId, { withinHours: 3 }));
      if (!s) return { error: "No shift starting in the next 3 hours" };
      await log("someone is running late");
      return { conversationId: await inject(s.workerId!, say("omw but running abt 15 min late, bus broke down 😭")) };
    }
    case "no_show": {
      const s = (await nextShiftFor(orgId, { withinHours: 1, inProgress: true })) ?? (await nextShiftFor(orgId, { withinHours: 6 }));
      if (!s) return { error: "No shift in progress to miss" };
      const { checkNoShow } = await import("./workflows/checkin");
      await log(`${(await getWorker(s.workerId!))?.name} doesn't show up`);
      await checkNoShow(s.id, { force: true });
      return { shiftId: s.id };
    }
    case "tool_failure": {
      g.__spFailNextLlm = true;
      await log("the next LLM call will fail (to show recovery)");
      return { armed: true };
    }
    case "question":
      return { conversationId: await inject(opts.workerId ?? "wkr_ravi", say("Hey! Is Sunday paid 1.5x? And who am I working with this weekend?")) };
    default:
      return { error: `Unknown scenario ${name}` };
  }
}
