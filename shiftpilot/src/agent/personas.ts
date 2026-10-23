/**
 * Persona simulator: workers not driven by a human on stage reply on their own,
 * in their own voice, through the exact same inbound pipeline as real people.
 */
import { generateText } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { messages, offers, type Worker } from "@/db/schema";
import { BLOCKS, DOW_SHORT, addDays, dowOf, fmtShortDate } from "@/lib/time";
import { receiveInbound } from "./inbound";
import { fastModel, hasLLM } from "./llm";
import { dmFor, firstName, getWorker } from "./ops";
import type { InboundPayload } from "@/whatsapp/types";

function seeded(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

async function deliver(conversationId: string, payload: InboundPayload) {
  await receiveInbound(conversationId, payload);
  const { processConversation } = await import("./conversation");
  try {
    after(() => processConversation(conversationId).catch((e) => console.error("[persona] process failed", e)));
  } catch {
    // Outside a request scope (e.g. background tick): run directly
    void processConversation(conversationId).catch((e) => console.error("[persona] process failed", e));
  }
}

async function personaText(w: Worker, task: string) {
  if (!hasLLM()) return null;
  try {
    const r = await generateText({
      model: fastModel(),
      reasoning: "none",
      instructions: `You are role-playing ${w.name}, a part-timer at a Singapore café. ${w.persona.bio} You are a ${w.occupation}. Your texting style: ${w.persona.style}.
You're replying on WhatsApp to the café's shift bot. Write ONLY the message, exactly as you'd thumb-type it on your phone: short, casual, real. Follow your texting style closely (lowercase, Singlish, abbreviations, emojis, typos, if that's you). Group days the way people do ("mon-wed", "weekdays", "weekends", "tues n thurs"), use everyday words ("after school", "after 5", "morning", "whole day", "can", "cannot") instead of exact clock ranges, and don't list every day you can't do unless it's natural. Never sound like a form or a bot.
Examples of the vibe (don't copy): "mon tues after 5 can, wed cannot, sat whole day 👍" / "Hi! Can do Wed & Fri evenings and Sat morning. Thanks!" / "weekends only this wk, exams 😭" / "可以 星期一到三早上".${w.language === "zh" ? " Write mostly in simple Chinese." : ""}`,
      prompt: task,
    });
    return r.text.trim().replace(/^"|"$/g, "");
  } catch {
    return null;
  }
}

export async function personaRespondToAvailability(cycleId: string, workerId: string) {
  const w = await getWorker(workerId);
  const conv = await dmFor(workerId);
  if (!w || !conv || !w.autopilot) return;
  const cyc = await db.query.planningCycles.findFirst({ where: (c, { eq }) => eq(c.id, cycleId) });
  if (!cyc || cyc.status !== "collecting") return;
  // Real people answer once: skip if they've already replied since the ask
  const { responders, wroteSinceKickoff } = await import("./workflows/weekly");
  if ((await responders(cycleId)).has(workerId) || (await wroteSinceKickoff(cyc)).has(workerId)) return;
  const rand = seeded(`${cycleId}:${workerId}`);

  // Ground truth this week: their usual pattern, with some life happening
  const truth: Record<string, string[]> = {};
  for (let i = 0; i < 7; i++) {
    const date = addDays(cyc.weekStart, i);
    let blocks = [...(w.persona.pattern[String(dowOf(date))] ?? [])];
    if (blocks.length && rand() < 0.12) blocks = [];
    else if (!blocks.length && rand() < 0.08) blocks = ["evening"];
    if (blocks.length) truth[date] = blocks;
  }

  // Organised / fast people tend to use the form, others just type
  const useForm = !hasLLM() || rand() < 0.35 + w.persona.responsiveness * 0.2;
  const lastAsk = await db.query.messages.findFirst({
    where: and(eq(messages.conversationId, conv.id), eq(messages.direction, "out")),
    orderBy: desc(messages.createdAt),
  });
  if (useForm) {
    const response: Record<string, unknown> = { flow_token: `avail:${cycleId}:${workerId}`, flow_id: "flow_availability", max_hours: String(w.desiredHours) };
    for (const [date, blocks] of Object.entries(truth)) response[`day_${date}`] = blocks;
    await deliver(conv.id, {
      type: "interactive",
      interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify(response) } },
      context: lastAsk ? { id: lastAsk.id } : undefined,
    });
    return;
  }
  const lines = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(cyc.weekStart, i);
    const b = truth[d];
    return `${DOW_SHORT[i]} ${fmtShortDate(d)}: ${b ? b.map((x) => `${x} (${BLOCKS[x as keyof typeof BLOCKS].label.split("(")[1].replace(")", "")})`).join(" + ") : "can't work"}`;
  }).join("\n");
  const text =
    (await personaText(
      w,
      `The bot asked for your availability for the week of ${fmtShortDate(cyc.weekStart)}. Your real availability:\n${lines}\nReply with your availability in your own words (you can group days, e.g. "mon-wed after 5"). Don't invent days that differ from this.`,
    )) ?? Object.entries(truth).map(([d, b]) => `${DOW_SHORT[dowOf(d)]} ${b.join("+")}`).join(", ");
  await deliver(conv.id, { type: "text", text: { body: text } });
  // Keep the truth next to the message for parse-accuracy evals
  const latest = await db.query.messages.findFirst({ where: and(eq(messages.conversationId, conv.id), eq(messages.direction, "in")), orderBy: desc(messages.createdAt) });
  if (latest) await db.update(messages).set({ payload: { ...(latest.payload as object), _truth: truth } }).where(eq(messages.id, latest.id));
}

export async function personaRespondToOffer(offerId: string) {
  const offer = await db.query.offers.findFirst({ where: eq(offers.id, offerId) });
  if (!offer || offer.status !== "pending") return;
  const w = await getWorker(offer.workerId);
  const conv = await dmFor(offer.workerId);
  if (!w || !conv || !w.autopilot) return;
  const rand = seeded(offer.id);
  const reasons = (offer.rankReasons ?? []).join(" ");
  let p = reasons.includes("preferred") ? 0.8 : reasons.includes("free then") ? 0.65 : reasons.includes("maybe") ? 0.4 : reasons.includes("didn't list") ? 0.2 : 0.35;
  p *= 0.6 + w.persona.reliability * 0.5;
  if (offer.incentive > 0) p += 0.15;
  if (offer.kind === "transfer") p -= 0.1;
  const accept = rand() < Math.min(0.95, p);

  // Most people just tap a button; some type
  if (rand() < 0.7 || !hasLLM()) {
    const id = `offer:${accept ? "accept" : "decline"}:${offer.id}`;
    const title = accept ? (offer.kind === "shortage" || offer.kind === "transfer" ? "Yes, add me" : "Yes, I'll take it") : offer.kind === "shortage" || offer.kind === "transfer" ? "Can't that day" : "Can't, sorry";
    await deliver(conv.id, {
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id, title } },
      context: offer.messageId ? { id: offer.messageId } : undefined,
    });
    return;
  }
  const text = await personaText(
    w,
    accept
      ? "The bot offered you an extra shift. You want to take it. Reply briefly saying yes."
      : `The bot offered you an extra shift. You can't take it (make up a plausible everyday reason, e.g. class, family dinner, other job). Reply briefly. Don't mention health.`,
  );
  await deliver(conv.id, { type: "text", text: { body: text ?? (accept ? "ok can, I take" : "sorry cannot") } });
}

export async function personaConfirm(cycleId: string, workerId: string) {
  const w = await getWorker(workerId);
  const conv = await dmFor(workerId);
  if (!w || !conv || !w.autopilot) return;
  if (seeded(`${cycleId}:${workerId}:c`)() < 0.12) return; // a few forget
  await deliver(conv.id, {
    type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: `roster:confirm:${cycleId}`, title: "Confirm ✅" } },
  });
}

export { firstName };
