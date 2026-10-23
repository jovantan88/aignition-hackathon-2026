/**
 * Day-of-shift monitoring: reminder the evening before, location check-in,
 * and no-show detection that escalates into an urgent cover search.
 */
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { shifts, workers } from "@/db/schema";
import { now } from "@/lib/clock";
import { addDays, atLocal, fmtShiftRange, localParts, relativeDay } from "@/lib/time";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { schedule } from "../jobs";
import { dmFor, firstName, getWorker, notifyManager, outletMap } from "../ops";
import { audit } from "../runs";

/** Make sure upcoming shifts of human-driven workers have reminder + check-in jobs */
export async function ensureShiftJobs(orgId: string) {
  const t = await now(orgId);
  const rows = await db
    .select({ s: shifts, autopilot: workers.autopilot })
    .from(shifts)
    .innerJoin(workers, eq(workers.id, shifts.workerId))
    .where(and(eq(shifts.orgId, orgId), inArray(shifts.status, ["assigned", "confirmed"]), gte(shifts.startsAt, t), lte(shifts.startsAt, new Date(t.getTime() + 30 * 3600_000)), eq(workers.autopilot, false)));
  for (const { s } of rows) {
    const eve = atLocal(addDays(s.date, -1), "19:00");
    const remindAt = eve.getTime() > t.getTime() ? eve : new Date(t.getTime() + 5_000);
    if (s.startsAt.getTime() - t.getTime() > 2 * 3600_000) await schedule(orgId, "shift.reminder", remindAt, { shiftId: s.id }, `shift:${s.id}:reminder`);
    await schedule(orgId, "checkin.check", new Date(s.startsAt.getTime() + 10 * 60_000), { shiftId: s.id, n: 1 }, `shift:${s.id}:checkin`);
  }
}

export async function sendShiftReminder(shiftId: string) {
  const s = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
  if (!s || !s.workerId || s.reminderSentAt || !["assigned", "confirmed"].includes(s.status)) return;
  const t = await now(s.orgId);
  // The clock may have jumped past it
  if (t.getTime() > s.startsAt.getTime() - 60 * 60_000) return;
  const w = (await getWorker(s.workerId))!;
  const conv = await dmFor(w.id);
  if (!conv) return;
  const outlet = (await outletMap(s.orgId)).get(s.outletId)!;
  const when = relativeDay(s.date, localParts(t).date);
  await sendMessage({
    orgId: s.orgId,
    conversationId: conv.id,
    payload: wa.buttons(`Reminder for ${when}: *${s.label}* at *${outlet.name}*, ${fmtShiftRange(s.startsAt, s.endsAt)}. See you there ${firstName(w.name)}! ☕`, [
      { id: `shift:confirm:${s.id}`, title: "👍 I'll be there" },
      { id: `shift:cant:${s.id}`, title: "Can't make it" },
    ]),
    template: { name: "shift_reminder", params: { body: [when, s.label, outlet.name, fmtShiftRange(s.startsAt, s.endsAt)], buttonPayloads: [`shift:confirm:${s.id}`, `shift:cant:${s.id}`] } },
    proactive: true,
    auditTitle: `Reminded ${w.name} about ${outlet.code} ${s.label}`,
    manualMinutes: 1,
  });
  await db.update(shifts).set({ reminderSentAt: t }).where(eq(shifts.id, s.id));
}

/** 10 min after start with no check-in: ping. 20 min: treat as a no-show and find urgent cover. */
export async function checkNoShow(shiftId: string, opts?: { force?: boolean }) {
  const s = await db.query.shifts.findFirst({ where: and(eq(shifts.id, shiftId), isNull(shifts.checkedInAt)) });
  if (!s || !s.workerId || !["assigned", "confirmed"].includes(s.status)) return;
  const t = await now(s.orgId);
  // Only act while it still matters (the demo clock can jump past whole shifts)
  if (!opts?.force && (t > s.endsAt || t.getTime() - s.startsAt.getTime() > 90 * 60_000)) return;
  const w = (await getWorker(s.workerId))!;
  const outlet = (await outletMap(s.orgId)).get(s.outletId)!;
  const conv = await dmFor(w.id);
  const pinged = await db.query.messages.findFirst({
    where: (m, { and, eq, like }) => and(eq(m.conversationId, conv?.id ?? ""), like(m.text, "%haven't checked in%")),
  });
  if (!pinged && !opts?.force) {
    if (conv)
      await sendMessage({
        orgId: s.orgId,
        conversationId: conv.id,
        payload: wa.locationRequest(`Hi ${firstName(w.name)}, your ${s.label} shift at ${outlet.name} started at ${fmtShiftRange(s.startsAt, s.endsAt).split("–")[0]} and you haven't checked in yet. Tap below to share your location, or tell me your ETA 🙏`),
        urgent: true,
        auditTitle: `Pinged ${w.name}: no check-in yet`,
      });
    await schedule(s.orgId, "checkin.check", new Date(t.getTime() + 10 * 60_000), { shiftId, n: 2 }, `shift:${s.id}:checkin2`);
    await audit(s.orgId, { kind: "decision", title: `${w.name} hasn't checked in for ${outlet.code} ${s.label}: pinged them` });
    return;
  }
  await notifyManager(s.orgId, `🚨 ${w.name} hasn't shown up or replied for ${outlet.code} ${s.label} (${fmtShiftRange(s.startsAt, s.endsAt)}). I'm treating it as a no-show and finding urgent cover now.`, { attention: true });
  const { reportAbsence } = await import("./cover");
  await reportAbsence({ shiftId: s.id, type: "no_show", reason: "No check-in and no reply", by: "system" });
}
