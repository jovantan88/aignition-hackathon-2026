/**
 * Deterministic handling of structured replies (button taps, list picks, Flow
 * submissions, shared locations). No LLM needed: faster and safer.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { shifts, type Conversation, type Message, type Worker } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { haversineKm } from "@/lib/geo";
import { BLOCKS, addDays, fmtDay, fmtRange12, fmtShiftRange, toMinutes, type BlockKey } from "@/lib/time";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { describeShift, firstName, getOrg, outletMap, saveMemory, workerShifts, writeAvailability } from "./ops";
import { audit } from "./runs";
import { reportAbsence, respondToOffer } from "./workflows/cover";

export type StructuredResult = { handled: boolean; intent?: string; summary?: string; llmNote?: string };

export function structuredId(m: Message): string | null {
  const p = m.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (m.type === "button") return p.button?.payload ?? null;
  if (m.type === "interactive") {
    const i = p.interactive;
    if (i.type === "button_reply") return i.button_reply.id;
    if (i.type === "list_reply") return i.list_reply.id;
  }
  return null;
}

export async function handleStructured(conv: Conversation, worker: Worker, m: Message): Promise<StructuredResult> {
  const orgId = conv.orgId;
  const reply = (text: string) => sendMessage({ orgId, conversationId: conv.id, payload: wa.text(text) });
  const react = (emoji = "👍") => sendMessage({ orgId, conversationId: conv.id, payload: wa.reaction(m.id, emoji) });
  const id = structuredId(m);
  const org = await getOrg(orgId);

  if (id) {
    const [kind, action, ref] = id.split(":");
    if (kind === "offer" && (action === "accept" || action === "decline")) {
      await respondToOffer(ref, action === "accept", "button");
      return { handled: true, intent: "offer_response", summary: action === "accept" ? "Accepted the shift offer" : "Declined the shift offer" };
    }
    if (kind === "roster" && action === "confirm") {
      const t = await now(orgId);
      const mine = await db.select().from(shifts).where(and(eq(shifts.workerId, worker.id), eq(shifts.cycleId, ref), inArray(shifts.status, ["assigned"])));
      if (mine.length) await db.update(shifts).set({ status: "confirmed", confirmedAt: t }).where(inArray(shifts.id, mine.map((s) => s.id)));
      await react("👍");
      await emit(orgId, "shift.updated", { workerId: worker.id });
      await audit(orgId, { kind: "tool_result", actor: "worker", title: `${worker.name} confirmed their roster (${mine.length} shifts)`, manualMinutes: org.settings.baselines.confirmChase });
      return { handled: true, intent: "confirmation", summary: `Confirmed ${mine.length} shifts` };
    }
    if (kind === "roster" && (action === "standby" || action === "ok")) {
      if (action === "standby") {
        await saveMemory({ orgId, workerId: worker.id, kind: "preference", content: "Wants to be on standby for extra shifts", createdBy: "agent", evidenceMessageId: m.id });
        await reply("You're on my standby list ✅ I'll message you first when something opens up.");
      } else await react("🙏");
      return { handled: true, intent: "confirmation", summary: action === "standby" ? "Joined standby list" : "Acknowledged" };
    }
    if (kind === "shift" && action === "confirm") {
      const t = await now(orgId);
      await db.update(shifts).set({ status: "confirmed", confirmedAt: t }).where(and(eq(shifts.id, ref), eq(shifts.workerId, worker.id)));
      await react("👍");
      await emit(orgId, "shift.updated", { shiftId: ref });
      return { handled: true, intent: "confirmation", summary: "Confirmed they'll be there" };
    }
    if (kind === "window" && action === "open") {
      await react("👍");
      return { handled: true, intent: "other", summary: "Opened the chat to see an update" };
    }
    if (kind === "avail" && action === "none") {
      const { onAvailabilitySubmitted } = await import("./workflows/weekly");
      const cyc = await db.query.planningCycles.findFirst({ where: (c, { eq }) => eq(c.id, ref) });
      if (cyc) {
        const entries = Array.from({ length: 7 }, (_, i) => ({ date: addDays(cyc.weekStart, i), startMin: 7 * 60, endMin: 23 * 60, kind: "unavailable" as const }));
        await writeAvailability({ orgId, workerId: worker.id, cycleId: ref, entries, replaceDates: "all", source: "flow", confidence: 1, sourceMessageId: m.id });
        await onAvailabilitySubmitted(ref, worker.id, "flow");
      }
      await reply("Noted, no shifts for you that week. Thanks for telling me! 🙏");
      return { handled: true, intent: "availability", summary: "Not working that week" };
    }
  }

  // WhatsApp Flow submissions
  if (m.type === "interactive" && (m.payload as Record<string, any>).interactive?.type === "nfm_reply") { // eslint-disable-line @typescript-eslint/no-explicit-any
    let resp: Record<string, unknown> = {};
    try {
      resp = JSON.parse((m.payload as Record<string, any>).interactive.nfm_reply.response_json); // eslint-disable-line @typescript-eslint/no-explicit-any
    } catch {
      return { handled: false };
    }
    const token = String(resp.flow_token ?? "");
    if (token.startsWith("avail:")) return handleAvailabilityFlow(conv, worker, m, token.split(":")[1], resp);
    if (token.startsWith("leave:")) return handleLeaveFlow(conv, worker, m, resp);
    if (token.startsWith("prefs:")) {
      const outlets = await outletMap(orgId);
      const byCode = new Map([...outlets.values()].map((o) => [o.code, o.name]));
      const parts: string[] = [];
      for (const t of (resp.times as string[]) ?? []) parts.push(`Prefers ${t} shifts`);
      for (const o of (resp.outlets as string[]) ?? []) parts.push(`Prefers the ${byCode.get(o) ?? o} outlet`);
      for (const p of parts) await saveMemory({ orgId, workerId: worker.id, kind: "preference", content: p, createdBy: "agent", evidenceMessageId: m.id });
      await reply(`Saved your preferences ✨ (${parts.length ? parts.join(", ").toLowerCase() : "nothing changed"})`);
      return { handled: !resp.notes, intent: "preference", summary: parts.join("; "), llmNote: resp.notes ? `Preferences form note: ${resp.notes}` : undefined };
    }
  }

  // Shared location: check in if they have a shift starting soon
  if (m.type === "location") {
    const p = (m.payload as Record<string, any>).location; // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = await now(orgId);
    const near = (await workerShifts(worker.id, new Date(t.getTime() - 8 * 3600_000), new Date(t.getTime() + 90 * 60_000))).find(
      (s) => s.startsAt.getTime() - 90 * 60_000 <= t.getTime() && s.endsAt > t,
    );
    if (near) {
      const outlet = (await outletMap(orgId)).get(near.outletId)!;
      const meters = haversineKm({ lat: p.latitude, lng: p.longitude }, outlet) * 1000;
      if (meters <= 200) {
        await db.update(shifts).set({ checkedInAt: t }).where(eq(shifts.id, near.id));
        const late = t.getTime() > near.startsAt.getTime() + 5 * 60_000;
        await reply(`Checked in at ${outlet.name}, ${t.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: org.timezone })} ✅${late ? "" : " Right on time."} Have a good shift ${firstName(worker.name)}!`);
        await emit(orgId, "shift.updated", { shiftId: near.id });
        await emit(orgId, "pulse", { outletId: outlet.id, kind: "ok" });
        await audit(orgId, { kind: "tool_result", actor: "worker", title: `${worker.name} checked in at ${outlet.name} (${Math.round(meters)} m away)` });
        return { handled: true, intent: "confirmation", summary: `Checked in (${Math.round(meters)} m from outlet)` };
      }
      await reply(`Hmm, that location is about ${(meters / 1000).toFixed(1)} km from ${outlet.name}. Are you on the way? If you'll be late, just tell me your ETA.`);
      return { handled: true, intent: "late", summary: `Shared location ${(meters / 1000).toFixed(1)} km away from outlet` };
    }
  }
  return { handled: false };
}

async function handleAvailabilityFlow(conv: Conversation, worker: Worker, m: Message, cycleId: string, resp: Record<string, unknown>): Promise<StructuredResult> {
  const cyc = await db.query.planningCycles.findFirst({ where: (c, { eq }) => eq(c.id, cycleId) });
  if (!cyc) return { handled: false };
  const entries: { date: string; startMin: number; endMin: number; kind: "available" }[] = [];
  const lines: string[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(cyc.weekStart, i);
    const blocks = ((resp[`day_${date}`] as string[]) ?? []).filter((b): b is BlockKey => b in BLOCKS).sort((a, b) => BLOCKS[a].start - BLOCKS[b].start);
    if (!blocks.length) continue;
    let cur = { start: BLOCKS[blocks[0]].start, end: BLOCKS[blocks[0]].end };
    const merged: typeof cur[] = [];
    for (const b of blocks.slice(1)) {
      if (BLOCKS[b].start <= cur.end) cur.end = BLOCKS[b].end;
      else {
        merged.push(cur);
        cur = { start: BLOCKS[b].start, end: BLOCKS[b].end };
      }
    }
    merged.push(cur);
    for (const x of merged) entries.push({ date, startMin: x.start, endMin: x.end, kind: "available" });
    lines.push(`${fmtDay(date).slice(0, 3)} ${merged.map((x) => fmtRange12(x.start, x.end)).join(", ")}`);
  }
  await writeAvailability({ orgId: conv.orgId, workerId: worker.id, cycleId, entries, replaceDates: "all", source: "flow", confidence: 1, sourceMessageId: m.id });
  if (resp.max_hours) {
    await saveMemory({ orgId: conv.orgId, workerId: worker.id, kind: "constraint", content: `Max ${resp.max_hours}h in the week of ${fmtDay(cyc.weekStart)}`, expiresAt: addDays(cyc.weekStart, 6), createdBy: "agent", evidenceMessageId: m.id });
  }
  const { onAvailabilitySubmitted } = await import("./workflows/weekly");
  await onAvailabilitySubmitted(cycleId, worker.id, "flow");
  await sendMessage({
    orgId: conv.orgId,
    conversationId: conv.id,
    payload: wa.text(entries.length ? `Got it, thanks ${firstName(worker.name)}! ✅\n${lines.join("\n")}\n\nI'll send your roster once it's confirmed.` : "Got it, no availability that week. Thanks for letting me know! 🙏"),
  });
  const org = await getOrg(conv.orgId);
  await audit(conv.orgId, { kind: "tool_result", actor: "worker", title: `${worker.name} submitted the availability form (${entries.length} windows)`, manualMinutes: org.settings.baselines.availabilityParse });
  const notes = String(resp.notes ?? "").trim();
  return {
    handled: !notes,
    intent: "availability",
    summary: lines.join("; ") || "No availability",
    llmNote: notes ? `They also wrote this note in the availability form (adjust their availability if needed): "${notes}"` : undefined,
  };
}

async function handleLeaveFlow(conv: Conversation, worker: Worker, m: Message, resp: Record<string, unknown>): Promise<StructuredResult> {
  const shiftId = String(resp.shift ?? "");
  const s = await db.query.shifts.findFirst({ where: and(eq(shifts.id, shiftId), eq(shifts.workerId, worker.id)) });
  if (!s) return { handled: false };
  const reason = String(resp.reason ?? "other");
  const type = reason === "sick" ? "sick" : reason === "emergency" ? "emergency" : reason === "school" ? "timetable" : "leave";
  await reportAbsence({ shiftId, type, reason: String(resp.notes ?? reason), sourceMessageId: m.id, by: "worker" });
  const outlet = (await outletMap(conv.orgId)).get(s.outletId);
  const photos = (resp.mc_photo as { media_id: string }[] | undefined) ?? [];
  await sendMessage({
    orgId: conv.orgId,
    conversationId: conv.id,
    payload: wa.text(
      `Thanks for telling me. I've released your *${fmtDay(s.date)} ${fmtShiftRange(s.startsAt, s.endsAt)}* shift at ${outlet?.name} and I'm finding cover now, no need to look for a replacement.${type === "sick" ? " Rest well 🙏" : ""}${photos.length ? "\n\nMC received, only the manager can see it." : ""}`,
    ),
  });
  if (photos.length) {
    const { reviewMc } = await import("./media");
    await reviewMc(conv.orgId, worker, photos[0].media_id, s.id);
  }
  return { handled: true, intent: type === "sick" ? "absence_sick" : "absence_other", summary: `Can't make ${describeShift(s, outlet)} (${reason})` };
}

export { toMinutes };
