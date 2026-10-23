/**
 * After solving: ask specific people to fill gaps (including moving someone
 * from another outlet), and nudge people who ended up with too few hours.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { offers, shifts, type Offer } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { fmtDay, fmtShiftRange } from "@/lib/time";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { schedule } from "../jobs";
import { dmFor, firstName, getOrg, getWorker, orgOutlets } from "../ops";
import { rankCandidates } from "../ranking";
import { addRunMetric, audit, setStep } from "../runs";
import { getCycle, requestPublish } from "./weekly";

const NEGOTIATION_WINDOW_MIN = 45;

export async function startNegotiation(cycleId: string) {
  const c = (await getCycle(cycleId))!;
  const org = await getOrg(c.orgId);
  const t = await now(c.orgId);
  const os = new Map((await orgOutlets(c.orgId)).map((o) => [o.id, o]));
  if (c.runId) await setStep(c.runId, 9, "running", "Working out who to ask…");

  const gaps = await db.select().from(shifts).where(and(eq(shifts.cycleId, cycleId), eq(shifts.status, "open"), isNull(shifts.workerId)));
  const asked = new Set<string>();
  let crossOutlet = 0;
  let incentives = 0;
  const lines: string[] = [];

  for (const gap of gaps.slice(0, 8)) {
    const ranked = await rankCandidates(gap, { urgent: false });
    const ok = (r: (typeof ranked)[number]) => r.eligible && !r.flags.overtime && !asked.has(r.workerId) && r.score > 5;
    // Prefer people who told us their availability; only guess about the rest if nobody fits
    const pick = ranked.find((r) => ok(r) && !r.flags.unknownAvailability) ?? ranked.find(ok);
    if (!pick) continue;
    const w = (await getWorker(pick.workerId))!;
    asked.add(w.id);
    const outlet = os.get(gap.outletId)!;
    const transfer = w.homeOutletId !== gap.outletId;
    // A small bonus within policy when they didn't list this time as free
    const incentive = pick.reasons.some((r) => r.includes("didn't list") || r.includes("maybe")) ? Math.min(1, org.settings.incentiveCapPerHour) : 0;
    if (transfer) crossOutlet++;
    if (incentive) incentives++;
    const offer: Offer = {
      id: newId("ofr"),
      orgId: c.orgId,
      coverRequestId: null,
      shiftId: gap.id,
      workerId: w.id,
      wave: 1,
      kind: transfer ? "transfer" : "shortage",
      incentive,
      status: "pending",
      rankScore: pick.score,
      rankReasons: pick.reasons,
      sentAt: t,
      respondedAt: null,
      expiresAt: new Date(t.getTime() + NEGOTIATION_WINDOW_MIN * 60_000),
      messageId: null,
    };
    await db.insert(offers).values(offer);
    const conv = await dmFor(w.id);
    const when = `${fmtDay(gap.date)}, ${fmtShiftRange(gap.startsAt, gap.endsAt)}`;
    const homeName = w.homeOutletId ? os.get(w.homeOutletId)?.name : null;
    const text = transfer
      ? `Hi ${firstName(w.name)}! Planning next week: *${outlet.name}* is short on *${when}* (${gap.label}). It's about ${pick.flags.travelMin} min from you${homeName ? `, a change from ${homeName}` : ""}. Could you help out?${incentive ? `\n💰 +$${incentive}/h for this one` : ""}`
      : `Hi ${firstName(w.name)}! Planning next week: we still need someone for *${when}* at ${outlet.name} (${gap.label}). Could I add you?${incentive ? `\n💰 +$${incentive}/h for this one` : ""}`;
    if (conv) {
      const r = await sendMessage({
        orgId: c.orgId,
        conversationId: conv.id,
        runId: c.runId,
        payload: wa.buttons(text, [
          { id: `offer:accept:${offer.id}`, title: "Yes, add me" },
          { id: `offer:decline:${offer.id}`, title: "Can't that day" },
        ]),
        template: { name: "shift_offer", params: { body: [firstName(w.name), when, outlet.name, gap.label, incentive ? `💰 +$${incentive}/h` : ""], buttonPayloads: [`offer:accept:${offer.id}`, `offer:decline:${offer.id}`] } },
        privacy: { purpose: "offer" },
        proactive: true,
        auditTitle: `Asked ${w.name} to fill ${outlet.code} ${fmtDay(gap.date)} ${gap.label}${transfer ? " (cross-outlet)" : ""}`,
      });
      if (r.ok) await db.update(offers).set({ messageId: r.messageId }).where(eq(offers.id, offer.id));
    }
    lines.push(`${firstName(w.name)} → ${outlet.code} ${fmtDay(gap.date).slice(0, 3)} ${gap.label}${transfer ? " ↔" : ""}`);
    if (transfer) await emit(c.orgId, "arc", { from: { lat: w.homeLat, lng: w.homeLng }, to: { lat: outlet.lat, lng: outlet.lng }, workerId: w.id, state: "offered", kind: "transfer" });
    if (w.autopilot) {
      const delay = 20 + (1 - w.persona.responsiveness) * 200 + Math.random() * 60;
      await schedule(c.orgId, "persona.offer", new Date(t.getTime() + delay * 1000), { offerId: offer.id }, `persona:offer:${offer.id}`);
    }
  }

  // Spare hours: people well under what they asked for
  const summary = (c.solveSummary ?? {}) as { surplus?: { name: string; assigned: number; desired: number }[] };
  const under = (summary.surplus ?? []).slice(0, 4);
  for (const s of under) {
    const ws = await db.query.workers.findFirst({ where: (w, { and, eq }) => and(eq(w.orgId, c.orgId), eq(w.name, s.name)) });
    if (!ws || asked.has(ws.id)) continue;
    const conv = await dmFor(ws.id);
    if (!conv) continue;
    await sendMessage({
      orgId: c.orgId,
      conversationId: conv.id,
      runId: c.runId,
      payload: wa.buttons(
        `Hi ${firstName(ws.name)}, heads up: next week is quieter for you, ${Math.round(s.assigned)}h so far (you usually want ~${s.desired}h). Want me to put you first in line for extra shifts?`,
        [
          { id: `roster:standby:${cycleId}`, title: "Yes, standby" },
          { id: `roster:ok:${cycleId}`, title: "That's fine" },
        ],
      ),
      template: { name: "update_available", params: { body: [firstName(ws.name)], buttonPayloads: ["window:open"] } },
      proactive: true,
      auditTitle: `Told ${ws.name} about spare hours`,
    });
  }

  if (c.runId) {
    await setStep(c.runId, 9, "running", `${asked.size} asks for ${gaps.length} gaps${crossOutlet ? ` (${crossOutlet} cross-outlet)` : ""}${incentives ? `, ${incentives} with a small bonus` : ""}; ${under.length} people under their hours. ${lines.join(" · ")}`);
    await addRunMetric(c.runId, "negotiationAsks", asked.size);
  }
  await audit(c.orgId, { runId: c.runId, kind: "decision", title: `Negotiating: ${asked.size} targeted asks for ${gaps.length} gaps`, detail: { asks: lines } });
  await schedule(c.orgId, "negotiate.close", new Date(t.getTime() + NEGOTIATION_WINDOW_MIN * 60_000), { cycleId }, `cycle:${cycleId}:negotiate`);
  if (!asked.size) await requestPublish(cycleId);
}

/** Answer to a negotiation (non-cover) offer */
export async function respondToNegotiation(offer: Offer, accept: boolean) {
  const t = await now(offer.orgId);
  const w = (await getWorker(offer.workerId))!;
  const conv = await dmFor(w.id);
  const shift = (await db.query.shifts.findFirst({ where: eq(shifts.id, offer.shiftId) }))!;
  const os = new Map((await orgOutlets(offer.orgId)).map((o) => [o.id, o]));
  const outlet = os.get(shift.outletId)!;
  const reply = (text: string) => conv && sendMessage({ orgId: offer.orgId, conversationId: conv.id, payload: wa.text(text) });
  const cycle = shift.cycleId ? await getCycle(shift.cycleId) : null;

  if (!accept) {
    await db.update(offers).set({ status: "declined", respondedAt: t }).where(eq(offers.id, offer.id));
    await reply("No problem at all, thanks for letting me know! 🙏");
    await emit(offer.orgId, "arc", { workerId: w.id, state: "declined" });
  } else {
    const claimed = await db
      .update(shifts)
      .set({ workerId: w.id, status: cycle?.status === "published" ? "confirmed" : "draft", source: "negotiation" })
      .where(and(eq(shifts.id, shift.id), isNull(shifts.workerId), inArray(shifts.status, ["open"])))
      .returning({ id: shifts.id });
    if (!claimed.length) {
      await db.update(offers).set({ status: "lost", respondedAt: t }).where(eq(offers.id, offer.id));
      await reply("Thank you! Someone already filled that one, but I really appreciate it 🙌");
    } else {
      await db.update(offers).set({ status: "accepted", respondedAt: t }).where(eq(offers.id, offer.id));
      await reply(`Amazing, thank you! I've pencilled you in for *${fmtDay(shift.date)}, ${fmtShiftRange(shift.startsAt, shift.endsAt)}* at ${outlet.name}. It'll be in your roster when it's published ✅`);
      await emit(offer.orgId, "arc", { from: { lat: w.homeLat, lng: w.homeLng }, to: { lat: outlet.lat, lng: outlet.lng }, workerId: w.id, state: "filled", kind: offer.kind });
      await audit(offer.orgId, { runId: cycle?.runId, kind: "decision", title: `${w.name} agreed to ${outlet.code} ${fmtDay(shift.date)} ${shift.label}${offer.kind === "transfer" ? " (cross-outlet)" : ""}` });
    }
  }
  await emit(offer.orgId, "shift.updated", { shiftId: shift.id });
  await emit(offer.orgId, "offer.updated", { offerId: offer.id });
  if (cycle && cycle.status === "negotiating") {
    const pending = await db.select().from(offers).where(and(eq(offers.status, "pending"), inArray(offers.kind, ["shortage", "transfer"]), isNull(offers.coverRequestId)));
    const mine = [];
    for (const p of pending) {
      const s = await db.query.shifts.findFirst({ where: eq(shifts.id, p.shiftId) });
      if (s?.cycleId === cycle.id) mine.push(p);
    }
    if (!mine.length) await requestPublish(cycle.id);
  }
}

export async function closeNegotiation(cycleId: string) {
  const c = await getCycle(cycleId);
  if (!c || c.status !== "negotiating") return;
  const t = await now(c.orgId);
  const pending = await db.select().from(offers).where(and(eq(offers.status, "pending"), isNull(offers.coverRequestId)));
  for (const p of pending) {
    const s = await db.query.shifts.findFirst({ where: eq(shifts.id, p.shiftId) });
    if (s?.cycleId === cycleId) await db.update(offers).set({ status: "expired", respondedAt: t }).where(eq(offers.id, p.id));
  }
  await requestPublish(cycleId);
}
