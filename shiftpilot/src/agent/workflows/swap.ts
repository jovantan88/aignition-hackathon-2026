/** Shift swaps between coworkers. Like-for-like swaps are auto-approved by policy. */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, shifts, type Offer, type Shift, type Worker } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { fmtDay, fmtShiftRange } from "@/lib/time";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { schedule } from "../jobs";
import { dmFor, firstName, getOrg, getWorker, notifyManager, orgWorkers, outletMap } from "../ops";
import { rankCandidates } from "../ranking";
import { audit } from "../runs";

export async function requestSwap(o: { shift: Shift; requester: Worker; withName?: string }) {
  const ranked = await rankCandidates(o.shift, { exclude: [o.requester.id], urgent: false });
  const eligible = ranked.filter((r) => r.eligible && !r.flags.overtime);
  if (!o.withName) {
    return { needsChoice: true, suggestions: eligible.slice(0, 5).map((r) => ({ name: r.name, why: r.reasons.slice(0, 2).join(", ") })) };
  }
  const ws = await orgWorkers(o.shift.orgId);
  const q = o.withName.toLowerCase().trim();
  const target = ws.find((w) => w.name.toLowerCase() === q) ?? ws.find((w) => firstName(w.name).toLowerCase() === q) ?? ws.find((w) => w.name.toLowerCase().includes(q));
  if (!target) return { error: `No one called ${o.withName} on the team.`, suggestions: eligible.slice(0, 3).map((r) => r.name) };
  const cand = ranked.find((r) => r.workerId === target.id);
  if (!cand?.eligible) return { error: `${firstName(target.name)} can't take it: ${cand?.blockReason ?? "not eligible"}.`, suggestions: eligible.slice(0, 3).map((r) => r.name) };
  if (cand.flags.overtime) return { error: `${firstName(target.name)} would go over their weekly hours cap, so that needs the manager.`, suggestions: eligible.slice(0, 3).map((r) => r.name) };

  const t = await now(o.shift.orgId);
  const outlet = (await outletMap(o.shift.orgId)).get(o.shift.outletId)!;
  const offer: Offer = {
    id: newId("ofr"),
    orgId: o.shift.orgId,
    coverRequestId: null,
    shiftId: o.shift.id,
    workerId: target.id,
    wave: 1,
    kind: "swap",
    incentive: 0,
    status: "pending",
    rankScore: cand.score,
    rankReasons: cand.reasons,
    sentAt: t,
    respondedAt: null,
    expiresAt: new Date(t.getTime() + 6 * 3600_000),
    messageId: null,
  };
  await db.insert(offers).values(offer);
  const conv = await dmFor(target.id);
  if (conv) {
    const when = `${fmtDay(o.shift.date)}, ${fmtShiftRange(o.shift.startsAt, o.shift.endsAt)}`;
    const r = await sendMessage({
      orgId: o.shift.orgId,
      conversationId: conv.id,
      payload: wa.buttons(`Hi ${firstName(target.name)}! ${firstName(o.requester.name)} asked if you could take their shift:\n\n*${when}*\n📍 ${outlet.name} (${o.shift.label})\n\nCan you?`, [
        { id: `offer:accept:${offer.id}`, title: "Yes, I'll take it" },
        { id: `offer:decline:${offer.id}`, title: "Can't, sorry" },
      ]),
      template: { name: "shift_offer", params: { body: [firstName(target.name), when, outlet.name, o.shift.label, `(swap for ${firstName(o.requester.name)})`], buttonPayloads: [`offer:accept:${offer.id}`, `offer:decline:${offer.id}`] } },
      privacy: { purpose: "offer", protectedNames: [] },
      proactive: true,
      auditTitle: `Asked ${target.name} to swap with ${o.requester.name}`,
    });
    if (r.ok) await db.update(offers).set({ messageId: r.messageId }).where(eq(offers.id, offer.id));
  }
  if (target.autopilot) await schedule(o.shift.orgId, "persona.offer", new Date(t.getTime() + (30 + Math.random() * 120) * 1000), { offerId: offer.id }, `persona:offer:${offer.id}`);
  return { asked: target.name, note: `Asked ${firstName(target.name)}. You'll keep the shift until they say yes.` };
}

export async function respondToSwap(offer: Offer, accept: boolean) {
  const t = await now(offer.orgId);
  const shift = (await db.query.shifts.findFirst({ where: eq(shifts.id, offer.shiftId) }))!;
  const target = (await getWorker(offer.workerId))!;
  const requester = shift.workerId ? await getWorker(shift.workerId) : null;
  const outlet = (await outletMap(offer.orgId)).get(shift.outletId)!;
  const org = await getOrg(offer.orgId);
  const dmT = await dmFor(target.id);
  const dmR = requester ? await dmFor(requester.id) : null;
  const when = `${fmtDay(shift.date)}, ${fmtShiftRange(shift.startsAt, shift.endsAt)}`;
  if (!accept) {
    await db.update(offers).set({ status: "declined", respondedAt: t }).where(eq(offers.id, offer.id));
    if (dmT) await sendMessage({ orgId: offer.orgId, conversationId: dmT.id, payload: wa.text("No worries, thanks for letting me know 🙏") });
    if (dmR) await sendMessage({ orgId: offer.orgId, conversationId: dmR.id, payload: wa.text(`${firstName(target.name)} can't take your ${when} shift. Want me to ask someone else? Just say who, or "anyone".`) });
    return { ok: true, message: "declined" };
  }
  const moved = await db
    .update(shifts)
    .set({ workerId: target.id, status: "confirmed", source: "manual", confirmedAt: t })
    .where(and(eq(shifts.id, shift.id), eq(shifts.workerId, requester?.id ?? "")))
    .returning({ id: shifts.id });
  if (!moved.length) {
    await db.update(offers).set({ status: "lost", respondedAt: t }).where(eq(offers.id, offer.id));
    if (dmT) await sendMessage({ orgId: offer.orgId, conversationId: dmT.id, payload: wa.text("Thanks! That shift has already been sorted out, so nothing changes for you 🙌") });
    return { ok: false, message: "already sorted" };
  }
  await db.update(offers).set({ status: "accepted", respondedAt: t }).where(eq(offers.id, offer.id));
  if (dmT) await sendMessage({ orgId: offer.orgId, conversationId: dmT.id, payload: wa.text(`Swap done ✅ You're on *${when}* at ${outlet.name}. Thank you!`) });
  if (dmR) await sendMessage({ orgId: offer.orgId, conversationId: dmR.id, payload: wa.text(`Swap done ✅ ${firstName(target.name)} is taking your *${when}* shift. You're free that day!`) });
  await notifyManager(offer.orgId, `🔁 Swap auto-approved (same skill, within hours): ${outlet.code} ${when}: ${requester?.name} → ${target.name}`, { manualMinutes: org.settings.baselines.swap });
  await audit(offer.orgId, { kind: "decision", title: `Swap applied: ${requester?.name} → ${target.name} (${outlet.code} ${fmtDay(shift.date)})`, manualMinutes: org.settings.baselines.swap });
  await emit(offer.orgId, "shift.updated", { shiftId: shift.id });
  return { ok: true, message: "swapped" };
}
