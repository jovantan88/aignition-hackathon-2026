/**
 * Finding cover when someone drops a shift: release it, rank replacements,
 * offer in waves (first yes wins), time out, escalate with options.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { coverRequests, offers, shifts, workers, type CoverRequest, type Offer, type Shift, type Worker } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { fmtDay, fmtShiftRange, hoursBetween, localParts, relativeDay } from "@/lib/time";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { requestApproval, type ApprovalOption } from "../approvals";
import { cancelJobs, schedule } from "../jobs";
import { describeShift, dmFor, firstName, getOrg, getWorker, groupConv, notifyManager, outletMap, saveMemory } from "../ops";
import { rankCandidates, type Candidate } from "../ranking";
import { addRunMetric, advanceTo, audit, finishRun, setStep, startRun } from "../runs";

const TYPE_LABEL: Record<CoverRequest["type"], string> = {
  sick: "called in sick",
  emergency: "has an emergency",
  leave: "needs leave",
  timetable: "has a timetable clash",
  no_show: "didn't show up",
  swap: "asked to swap",
  shortage: "unfilled gap",
};

export async function getCover(id: string) {
  return db.query.coverRequests.findFirst({ where: eq(coverRequests.id, id) });
}

/** Release a shift and start looking for cover */
export async function reportAbsence(o: {
  shiftId: string;
  type: CoverRequest["type"];
  reason?: string | null;
  sourceMessageId?: string | null;
  by: "worker" | "manager" | "system";
}) {
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, o.shiftId) });
  if (!shift) throw new Error("shift not found");
  const existing = await db.query.coverRequests.findFirst({
    where: and(eq(coverRequests.shiftId, shift.id), inArray(coverRequests.status, ["searching", "offered", "escalated"])),
  });
  if (existing) return { coverRequestId: existing.id, runId: existing.runId, alreadyOpen: true };

  const t = await now(shift.orgId);
  const hoursAway = hoursBetween(t, shift.startsAt);
  const urgent = hoursAway < 14;
  const outlet = (await outletMap(shift.orgId)).get(shift.outletId);
  const original = shift.workerId ? await getWorker(shift.workerId) : null;
  const who = original ? firstName(original.name) : "Someone";

  const runId = await startRun({
    orgId: shift.orgId,
    kind: "cover",
    title: `Cover · ${outlet?.code} ${relativeDay(shift.date, localParts(t).date)} ${fmtShiftRange(shift.startsAt, shift.endsAt)}`,
    goal: `${who} ${TYPE_LABEL[o.type]}. Find someone for ${describeShift(shift, outlet)}.`,
    steps: [`Release ${who}'s shift`, "Rank replacements", "Offer to the best matches", "Wait for a yes", "Confirm and tell the team"],
    subjectId: shift.id,
  });

  const id = newId("cov");
  await db.insert(coverRequests).values({
    id,
    orgId: shift.orgId,
    shiftId: shift.id,
    originalWorkerId: shift.workerId,
    type: o.type,
    reason: o.reason ?? null,
    urgency: urgent ? "urgent" : "normal",
    status: "searching",
    runId,
    createdAt: t,
  });
  await db.update(shifts).set({ status: "cover_needed", workerId: null }).where(eq(shifts.id, shift.id));
  await db.update(workers).set({ stats: sql`jsonb_set(${workers.stats}, '{lateCancellations90d}', to_jsonb(coalesce((${workers.stats}->>'lateCancellations90d')::int,0) + ${hoursAway < 24 ? 1 : 0}))` }).where(eq(workers.id, shift.workerId ?? ""));
  await setStep(runId, 1, "done", `${describeShift(shift, outlet)} is open${urgent ? " (urgent: starts in " + Math.max(0, Math.round(hoursAway)) + "h)" : ""}`);
  await audit(shift.orgId, {
    runId,
    kind: "decision",
    actor: o.by === "worker" ? "worker" : "agent",
    title: `Released ${describeShift(shift, outlet)}: ${who} ${TYPE_LABEL[o.type]}`,
    detail: { coverRequestId: id, urgent, reasonPrivate: Boolean(o.reason) },
  });
  await emit(shift.orgId, "shift.updated", { shiftId: shift.id });
  await emit(shift.orgId, "cover.updated", { coverRequestId: id });
  await emit(shift.orgId, "pulse", { outletId: shift.outletId, kind: "alert" });

  await schedule(shift.orgId, "cover.search", t, { coverRequestId: id }, `cover:${id}:search:1`);
  // Kick the queue right away rather than waiting for the next heartbeat
  void import("../jobs").then((m) => m.tick(shift.orgId));
  return { coverRequestId: id, runId, alreadyOpen: false, urgent };
}

function offerBody(worker: Worker, shift: Shift, outletName: string, today: string, incentive: number, urgent: boolean) {
  const when = `${relativeDay(shift.date, today) === "today" ? "Today" : relativeDay(shift.date, today) === "tomorrow" ? "Tomorrow" : fmtDay(shift.date)}, ${fmtShiftRange(shift.startsAt, shift.endsAt)}`;
  const extra = incentive > 0 ? `💰 +$${incentive.toFixed(2)}/h on top of your usual rate\n` : "";
  return {
    when,
    text: `${urgent ? "⚡ " : ""}Hi ${firstName(worker.name)}! A shift just opened up that fits you:\n\n*${when}*\n📍 ${outletName} (${shift.label} · ${shift.skill})\n${extra}\nWould you like it?`,
    extra,
  };
}

export async function sendOffer(o: {
  offer: Offer;
  worker: Worker;
  shift: Shift;
  outletName: string;
  urgent: boolean;
  protectedNames: string[];
  runId: string | null;
}) {
  const conv = await dmFor(o.worker.id);
  if (!conv) return;
  const t = await now(o.shift.orgId);
  const today = localParts(t).date;
  const body = offerBody(o.worker, o.shift, o.outletName, today, o.offer.incentive, o.urgent);
  const minsLeft = Math.max(1, Math.round((o.offer.expiresAt.getTime() - t.getTime()) / 60000));
  const res = await sendMessage({
    orgId: o.shift.orgId,
    conversationId: conv.id,
    runId: o.runId,
    payload: wa.buttons(
      body.text,
      [
        { id: `offer:accept:${o.offer.id}`, title: "Yes, I'll take it" },
        { id: `offer:decline:${o.offer.id}`, title: "Can't, sorry" },
      ],
      { header: o.urgent ? "Urgent cover" : "Shift available", footer: `First to accept gets it · closes in ${minsLeft} min` },
    ),
    template: o.urgent
      ? {
          name: "urgent_cover",
          params: {
            body: [firstName(o.worker.name), o.outletName, body.when, `${o.shift.label} · ${o.shift.skill}`, body.extra.trim()],
            footer: [String(minsLeft)],
            buttonPayloads: [`offer:accept:${o.offer.id}`, `offer:decline:${o.offer.id}`],
          },
        }
      : {
          name: "shift_offer",
          params: {
            body: [firstName(o.worker.name), body.when, o.outletName, `${o.shift.label} · ${o.shift.skill}`, body.extra],
            buttonPayloads: [`offer:accept:${o.offer.id}`, `offer:decline:${o.offer.id}`],
          },
        },
    privacy: { purpose: "offer", protectedNames: o.protectedNames },
    urgent: o.urgent,
    proactive: true,
    auditTitle: `Offered ${o.shift.label.toLowerCase()} shift to ${o.worker.name}`,
  });
  if (res.ok) await db.update(offers).set({ messageId: res.messageId }).where(eq(offers.id, o.offer.id));
  await db
    .update(workers)
    .set({ stats: sql`jsonb_set(${workers.stats}, '{offersReceived}', to_jsonb(coalesce((${workers.stats}->>'offersReceived')::int,0) + 1))` })
    .where(eq(workers.id, o.worker.id));
  return res;
}

/** Offer the shift to the next wave of candidates */
export async function coverSearch(coverRequestId: string, opts?: { incentive?: number; forceWorkerIds?: string[]; note?: string }) {
  const cover = await getCover(coverRequestId);
  if (!cover || cover.status === "filled" || cover.status === "cancelled" || cover.status === "unfilled") return;
  const shift = await db.query.shifts.findFirst({ where: eq(shifts.id, cover.shiftId) });
  if (!shift) return;
  const org = await getOrg(cover.orgId);
  const outlets = await outletMap(cover.orgId);
  const outlet = outlets.get(shift.outletId)!;
  const urgent = cover.urgency === "urgent";
  const t = await now(cover.orgId);

  const already = await db.select().from(offers).where(eq(offers.coverRequestId, cover.id));
  const exclude = [cover.originalWorkerId, ...already.map((o) => o.workerId)].filter(Boolean) as string[];
  if (cover.runId) await advanceTo(cover.runId, 2, "Scoring everyone on availability, hours, travel, reliability and fairness");

  const ranked = await rankCandidates(shift, { exclude, urgent });
  const wave = cover.wave + 1;
  const size = urgent ? org.settings.urgentWaveSize : org.settings.waveSize;
  let picks: Candidate[];
  if (opts?.forceWorkerIds?.length) {
    const all = await rankCandidates(shift, { exclude: [cover.originalWorkerId ?? ""], urgent });
    picks = all.filter((c) => opts.forceWorkerIds!.includes(c.workerId));
  } else {
    picks = ranked.filter((c) => c.eligible && !c.flags.overtime && c.score > 20).slice(0, size);
  }

  await audit(cover.orgId, {
    runId: cover.runId,
    kind: "decision",
    title: `Ranked ${ranked.filter((c) => c.eligible).length} possible replacements (wave ${wave})`,
    detail: {
      top: ranked.slice(0, 10).map((c) => ({ name: c.name, score: c.score, eligible: c.eligible, reasons: c.reasons, blocked: c.blockReason, overtime: c.flags.overtime })),
    },
  });

  if (!picks.length || wave > org.settings.maxWaves + (opts?.forceWorkerIds || opts?.incentive ? 2 : 0)) {
    await escalateCover(cover.id, ranked);
    return;
  }
  if (cover.runId) await setStep(cover.runId, 2, "done", picks.map((p) => `${firstName(p.name)} (${p.score})`).join(", "));

  const expiresAt = new Date(t.getTime() + (urgent ? org.settings.offerTimeoutSameDayMin : org.settings.offerTimeoutFutureMin) * 60_000);
  const original = cover.originalWorkerId ? await getWorker(cover.originalWorkerId) : null;
  for (const c of picks) {
    const w = await getWorker(c.workerId);
    if (!w) continue;
    const offer: Offer = {
      id: newId("ofr"),
      orgId: cover.orgId,
      coverRequestId: cover.id,
      shiftId: shift.id,
      workerId: w.id,
      wave,
      kind: c.flags.overtime ? "cover" : "cover",
      incentive: opts?.incentive ?? 0,
      status: "pending",
      rankScore: c.score,
      rankReasons: c.reasons,
      sentAt: t,
      respondedAt: null,
      expiresAt,
      messageId: null,
    };
    await db.insert(offers).values(offer);
    await sendOffer({ offer, worker: w, shift, outletName: outlet.name, urgent, protectedNames: original ? [original.name] : [], runId: cover.runId });
    await emit(cover.orgId, "arc", { from: { lat: w.homeLat, lng: w.homeLng }, to: { lat: outlet.lat, lng: outlet.lng }, workerId: w.id, coverRequestId: cover.id, state: "offered" });
    if (w.autopilot) {
      const resp = w.persona.responsiveness;
      const delaySec = urgent ? 25 + (1 - resp) * 150 + Math.random() * 40 : 40 + (1 - resp) * 300 + Math.random() * 90;
      await schedule(cover.orgId, "persona.offer", new Date(t.getTime() + delaySec * 1000), { offerId: offer.id }, `persona:offer:${offer.id}`);
    }
  }
  await db.update(coverRequests).set({ status: "offered", wave }).where(eq(coverRequests.id, cover.id));
  await schedule(cover.orgId, "cover.timeout", expiresAt, { coverRequestId: cover.id, wave }, `cover:${cover.id}:timeout:${wave}`);
  if (cover.runId) {
    await setStep(cover.runId, 3, "done", `Wave ${wave}: ${picks.map((p) => firstName(p.name)).join(", ")}${opts?.incentive ? ` (+$${opts.incentive}/h)` : ""}`);
    await setStep(cover.runId, 4, "waiting", `Offers close at ${expiresAt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: org.timezone })}`);
    await addRunMetric(cover.runId, "offersSent", picks.length);
  }
  await emit(cover.orgId, "cover.updated", { coverRequestId: cover.id });
  await emit(cover.orgId, "offer.updated", { coverRequestId: cover.id });
}

/** A worker answered an offer (button, text or persona) */
export async function respondToOffer(offerId: string, accept: boolean, via: "button" | "text" | "persona") {
  const offer = await db.query.offers.findFirst({ where: eq(offers.id, offerId) });
  if (!offer) return { ok: false, message: "That offer doesn't exist anymore." };
  if (!offer.coverRequestId && offer.kind !== "swap" && offer.status === "pending") {
    const { respondToNegotiation } = await import("./negotiate");
    await respondToNegotiation(offer, accept);
    return { ok: true, message: accept ? "accepted" : "declined" };
  }
  if (offer.kind === "swap" && offer.status === "pending") {
    const { respondToSwap } = await import("./swap");
    return respondToSwap(offer, accept);
  }
  const worker = (await getWorker(offer.workerId))!;
  const conv = await dmFor(worker.id);
  const shift = (await db.query.shifts.findFirst({ where: eq(shifts.id, offer.shiftId) }))!;
  const outlet = (await outletMap(offer.orgId)).get(shift.outletId)!;
  const cover = offer.coverRequestId ? await getCover(offer.coverRequestId) : null;
  const t = await now(offer.orgId);
  const reply = async (text: string) => {
    if (conv) await sendMessage({ orgId: offer.orgId, conversationId: conv.id, payload: wa.text(text), runId: cover?.runId });
  };

  if (offer.status !== "pending") {
    const msg =
      offer.status === "accepted"
        ? `You've already got this one ✅ ${describeShift(shift, outlet)}`
        : offer.status === "lost"
          ? "Someone else took that shift already, thank you for offering though! 🙏"
          : "That offer has closed, but thank you! I'll keep you in mind.";
    await reply(msg);
    return { ok: false, message: msg };
  }

  if (!accept) {
    await db.update(offers).set({ status: "declined", respondedAt: t }).where(eq(offers.id, offer.id));
    await audit(offer.orgId, { runId: cover?.runId, kind: "tool_result", actor: "worker", title: `${worker.name} declined the offer`, detail: { offerId, via } });
    await emit(offer.orgId, "arc", { workerId: worker.id, coverRequestId: offer.coverRequestId, state: "declined" });
    await emit(offer.orgId, "offer.updated", { offerId });
    if (via !== "text") await reply("No worries, thanks for letting me know quickly! 🙏");
    if (cover) {
      const pending = await db.select().from(offers).where(and(eq(offers.coverRequestId, cover.id), eq(offers.wave, offer.wave), eq(offers.status, "pending")));
      if (!pending.length) {
        await cancelJobs(`cover:${cover.id}:timeout:${offer.wave}`);
        await audit(offer.orgId, { runId: cover.runId, kind: "decision", title: `Everyone in wave ${offer.wave} said no, moving to the next people` });
        await schedule(offer.orgId, "cover.search", t, { coverRequestId: cover.id }, `cover:${cover.id}:search:${offer.wave + 1}`);
        void import("../jobs").then((m) => m.tick(offer.orgId));
      }
    }
    return { ok: true, message: "declined" };
  }

  // First yes wins: atomic claim on the cover request
  if (cover) {
    const claimed = await db
      .update(coverRequests)
      .set({ status: "filled", filledBy: worker.id, filledAt: t })
      .where(and(eq(coverRequests.id, cover.id), inArray(coverRequests.status, ["searching", "offered", "escalated"])))
      .returning({ id: coverRequests.id });
    if (!claimed.length) {
      await db.update(offers).set({ status: "lost", respondedAt: t }).where(eq(offers.id, offer.id));
      const msg = "Ah, someone grabbed it just a moment ago. Thank you so much for saying yes, I'll come to you first next time 🙏";
      await reply(msg);
      await audit(offer.orgId, { runId: cover.runId, kind: "decision", title: `${worker.name} said yes but the shift was already taken (first yes wins)` });
      return { ok: false, message: msg };
    }
  }

  await db.update(offers).set({ status: "accepted", respondedAt: t }).where(eq(offers.id, offer.id));
  await db.update(shifts).set({ workerId: worker.id, status: "confirmed", source: "cover", confirmedAt: t }).where(eq(shifts.id, shift.id));
  await db
    .update(workers)
    .set({
      stats: sql`jsonb_set(jsonb_set(${workers.stats}, '{offersAccepted}', to_jsonb(coalesce((${workers.stats}->>'offersAccepted')::int,0) + 1)), '{coverPickups90d}', to_jsonb(coalesce((${workers.stats}->>'coverPickups90d')::int,0) + 1))`,
    })
    .where(eq(workers.id, worker.id));

  const orgRow = await getOrg(offer.orgId);
  const today = localParts(t, orgRow.timezone).date;
  await reply(
    `You're confirmed ✅\n\n*${relativeDay(shift.date, today) === "today" ? "Today" : relativeDay(shift.date, today) === "tomorrow" ? "Tomorrow" : fmtDay(shift.date)}, ${fmtShiftRange(shift.startsAt, shift.endsAt)}*\n📍 ${outlet.name}\n\nThank you ${firstName(worker.name)}, you're a lifesaver! 🙌`,
  );
  if (worker.homeOutletId !== outlet.id && conv) {
    await sendMessage({ orgId: offer.orgId, conversationId: conv.id, payload: wa.location(outlet.lat, outlet.lng, `${orgRow.name} ${outlet.name}`, outlet.address), runId: cover?.runId });
  }

  if (cover) {
    await cancelJobs(`cover:${cover.id}:timeout`);
    const others = await db.select().from(offers).where(and(eq(offers.coverRequestId, cover.id), eq(offers.status, "pending")));
    for (const o of others) {
      await db.update(offers).set({ status: "lost" }).where(eq(offers.id, o.id));
      const oc = await dmFor(o.workerId);
      if (oc) await sendMessage({ orgId: offer.orgId, conversationId: oc.id, payload: wa.text("Update: that shift has been filled. Thanks for being around, I'll keep you in mind! 🙌"), runId: cover.runId });
      await emit(offer.orgId, "arc", { workerId: o.workerId, coverRequestId: cover.id, state: "withdrawn" });
    }
    const asked = (await db.select().from(offers).where(eq(offers.coverRequestId, cover.id))).length;
    const minutes = Math.max(1, Math.round((t.getTime() - cover.createdAt.getTime()) / 60000));
    const original = cover.originalWorkerId ? await getWorker(cover.originalWorkerId) : null;
    const org = orgRow;

    // Tell the person who dropped out, the crew and the manager
    if (original) {
      const oc = await dmFor(original.id);
      if (oc)
        await sendMessage({
          orgId: offer.orgId,
          conversationId: oc.id,
          payload: wa.text(`Good news: your ${fmtDay(shift.date)} shift is covered, so no need to worry. ${cover.type === "sick" ? "Rest well and get better soon 🙏" : "Take care 🙏"}`),
          runId: cover.runId,
          privacy: { purpose: "notify", recipientIsSubject: true },
        });
    }
    const grp = await groupConv(outlet.id);
    if (grp)
      await sendMessage({
        orgId: offer.orgId,
        conversationId: grp.id,
        payload: wa.text(`Heads up crew 👋 ${firstName(worker.name)} is on *${shift.label}* ${relativeDay(shift.date, today)} (${fmtShiftRange(shift.startsAt, shift.endsAt)}). See you there!`),
        runId: cover.runId,
        privacy: { purpose: "broadcast", protectedNames: original ? [original.name] : [] },
      });
    await notifyManager(
      offer.orgId,
      `✅ *Covered:* ${outlet.code} ${describeShift(shift, outlet)}\n${original ? `${original.name} ${TYPE_LABEL[cover.type]}. ` : ""}${worker.name} took it.\n\n⏱ ${minutes} min · ${asked} ${asked === 1 ? "person" : "people"} asked · no calls needed`,
      { runId: cover.runId, manualMinutes: org.settings.baselines.coverSearch },
    );
    await saveMemory({
      orgId: offer.orgId,
      workerId: worker.id,
      kind: "behaviour",
      content: `Covered a ${outlet.name} ${shift.label.toLowerCase()} shift at short notice (${fmtDay(shift.date)})`,
      createdBy: "agent",
      runId: cover.runId,
    });
    await emit(offer.orgId, "arc", { from: { lat: worker.homeLat, lng: worker.homeLng }, to: { lat: outlet.lat, lng: outlet.lng }, workerId: worker.id, coverRequestId: cover.id, state: "filled" });
    if (cover.runId) {
      await setStep(cover.runId, 4, "done", `${worker.name} said yes after ${minutes} min`);
      await addRunMetric(cover.runId, "minutesToFill", minutes);
      await finishRun(cover.runId, `${worker.name} is covering ${describeShift(shift, outlet)}. Filled in ${minutes} min after asking ${asked} ${asked === 1 ? "person" : "people"}.`);
    }
    await audit(offer.orgId, {
      runId: cover.runId,
      kind: "decision",
      title: `Cover found: ${worker.name} for ${describeShift(shift, outlet)}`,
      manualMinutes: org.settings.baselines.coverSearch,
      detail: { minutes, asked },
    });
  }
  await emit(offer.orgId, "shift.updated", { shiftId: shift.id });
  await emit(offer.orgId, "cover.updated", { coverRequestId: offer.coverRequestId });
  await emit(offer.orgId, "offer.updated", { offerId });
  await emit(offer.orgId, "pulse", { outletId: outlet.id, kind: "ok" });
  return { ok: true, message: "accepted" };
}

export async function coverTimeout(coverRequestId: string, wave: number) {
  const cover = await getCover(coverRequestId);
  if (!cover || cover.status === "filled" || cover.wave !== wave) return;
  const t = await now(cover.orgId);
  const expired = await db
    .update(offers)
    .set({ status: "expired", respondedAt: t })
    .where(and(eq(offers.coverRequestId, cover.id), eq(offers.wave, wave), eq(offers.status, "pending")))
    .returning();
  for (const o of expired) await emit(cover.orgId, "arc", { workerId: o.workerId, coverRequestId: cover.id, state: "expired" });
  await audit(cover.orgId, { runId: cover.runId, kind: "decision", title: `Wave ${wave} timed out (${expired.length} no reply), trying the next people` });
  await coverSearch(cover.id);
}

/** Nobody can take it within the rules: ask the manager, with concrete options */
export async function escalateCover(coverRequestId: string, ranked?: Candidate[]) {
  const cover = await getCover(coverRequestId);
  if (!cover || cover.status === "escalated" || cover.status === "filled") return;
  const shift = (await db.query.shifts.findFirst({ where: eq(shifts.id, cover.shiftId) }))!;
  const outlets = await outletMap(cover.orgId);
  const outlet = outlets.get(shift.outletId)!;
  const org = await getOrg(cover.orgId);
  ranked ??= await rankCandidates(shift, { exclude: [cover.originalWorkerId ?? ""], urgent: cover.urgency === "urgent" });
  const all = await db.select().from(offers).where(eq(offers.coverRequestId, cover.id));
  const declined = all.filter((o) => o.status === "declined").length;
  const silent = all.filter((o) => o.status === "expired").length;
  const asked = new Set(all.map((o) => o.workerId));

  const options: ApprovalOption[] = [];
  const ot = ranked.find((c) => c.eligible && c.flags.overtime && !asked.has(c.workerId));
  if (ot) {
    options.push({
      id: "overtime",
      label: `Overtime: ${firstName(ot.name)}`,
      detail: `${ot.reasons.find((r) => r.includes("cap")) ?? "Over weekly cap"}. ${ot.flags.travelMin} min away.`,
      action: { type: "cover.offer_direct", coverRequestId: cover.id, workerIds: [ot.workerId], note: "overtime approved" },
    });
  }
  const bonus = Math.max(2, org.settings.incentiveCapPerHour * 3);
  options.push({
    id: "incentive",
    label: `Offer +$${bonus}/h bonus`,
    detail: `Re-ask the top ${org.settings.urgentWaveSize} with a $${bonus}/h incentive (above your $${org.settings.incentiveCapPerHour}/h cap)`,
    action: { type: "cover.incentive", coverRequestId: cover.id, amount: bonus },
  });
  const far = ranked.filter((c) => c.eligible && !c.flags.overtime && !asked.has(c.workerId) && c.flags.travelMin > 40).slice(0, 2);
  if (far.length) {
    options.push({
      id: "borrow",
      label: `Borrow from other outlets`,
      detail: `Ask ${far.map((f) => firstName(f.name)).join(" & ")} (further away, ~${far[0].flags.travelMin} min), travel claim allowed`,
      action: { type: "cover.offer_direct", coverRequestId: cover.id, workerIds: far.map((f) => f.workerId), note: "cross-outlet" },
    });
  }
  options.push({
    id: "lead",
    label: `Ask ${outlet.leadName?.split(" ")[0] ?? "lead"} to extend`,
    detail: `Outlet lead ${outlet.leadName ?? ""} stays on longer; I'll mark it covered`,
    action: { type: "cover.lead", coverRequestId: cover.id },
  });
  options.push({
    id: "short",
    label: "Run short-staffed",
    detail: "Leave it empty and give the crew a heads-up",
    action: { type: "cover.run_short", coverRequestId: cover.id },
  });

  await db.update(coverRequests).set({ status: "escalated", escalatedAt: await now(cover.orgId) }).where(eq(coverRequests.id, cover.id));
  const summary = `Nobody has taken ${describeShift(shift, outlet)} yet. I asked ${asked.size} ${asked.size === 1 ? "person" : "people"}: ${declined} said no, ${silent} didn't reply in time. Everyone else is either unavailable, already working, or would break the hours cap.`;
  if (cover.runId) await setStep(cover.runId, 4, "blocked", "Ran out of people within the rules. Asked the manager");
  await requestApproval({
    orgId: cover.orgId,
    runId: cover.runId,
    kind: "escalation",
    title: `Can't fill ${outlet.code} ${fmtDay(shift.date)} ${fmtShiftRange(shift.startsAt, shift.endsAt)}`,
    summary,
    action: { type: "cover.none" },
    options,
    risk: cover.urgency === "urgent" ? "high" : "medium",
    policyReason: "Overtime, bonuses and running short need a manager decision",
  });
  await emit(cover.orgId, "cover.updated", { coverRequestId: cover.id });
  await emit(cover.orgId, "pulse", { outletId: outlet.id, kind: "alert" });
}

/** Outcomes of an escalation option */
export async function coverLead(coverRequestId: string) {
  const cover = (await getCover(coverRequestId))!;
  const shift = (await db.query.shifts.findFirst({ where: eq(shifts.id, cover.shiftId) }))!;
  const outlet = (await outletMap(cover.orgId)).get(shift.outletId)!;
  await db.update(coverRequests).set({ status: "filled", filledAt: await now(cover.orgId), resolution: { by: "lead", name: outlet.leadName } }).where(eq(coverRequests.id, cover.id));
  await db.update(shifts).set({ status: "covered", source: "manual" }).where(eq(shifts.id, shift.id));
  await cancelJobs(`cover:${cover.id}`);
  if (cover.runId) await finishRun(cover.runId, `Manager chose: outlet lead ${outlet.leadName} extends. Shift marked covered.`);
  await emit(cover.orgId, "shift.updated", { shiftId: shift.id });
  await emit(cover.orgId, "cover.updated", { coverRequestId });
}

export async function coverRunShort(coverRequestId: string) {
  const cover = (await getCover(coverRequestId))!;
  const shift = (await db.query.shifts.findFirst({ where: eq(shifts.id, cover.shiftId) }))!;
  const outlet = (await outletMap(cover.orgId)).get(shift.outletId)!;
  await db.update(coverRequests).set({ status: "unfilled", resolution: { by: "run_short" } }).where(eq(coverRequests.id, cover.id));
  await db.update(shifts).set({ status: "cancelled" }).where(eq(shifts.id, shift.id));
  await cancelJobs(`cover:${cover.id}`);
  const grp = await groupConv(outlet.id);
  if (grp)
    await sendMessage({
      orgId: cover.orgId,
      conversationId: grp.id,
      payload: wa.text(`Heads up crew: we'll be one short for *${shift.label}* on ${fmtDay(shift.date)} (${fmtShiftRange(shift.startsAt, shift.endsAt)}). ${outlet.leadName?.split(" ")[0] ?? "The lead"} will prioritise the bar. Thanks for holding it down 💪`),
      runId: cover.runId,
      privacy: { purpose: "broadcast", protectedNames: [] },
    });
  if (cover.runId) await finishRun(cover.runId, "Manager chose to run short-staffed. Crew notified.");
  await emit(cover.orgId, "shift.updated", { shiftId: shift.id });
  await emit(cover.orgId, "cover.updated", { coverRequestId });
}
