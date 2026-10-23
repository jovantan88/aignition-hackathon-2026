/** Builds what the agent knows about a worker at the moment it replies */
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db";
import { messages, offers, shifts, type Conversation, type Message, type Worker } from "@/db/schema";
import { now } from "@/lib/clock";
import { DOW_LONG, addDays, dowOf, fmtDay, fmtShiftRange, fmtShortDate, localParts, weekStartOf } from "@/lib/time";
import { renderTemplate } from "@/whatsapp/templates";
import { activeMemories, describeShift, firstName, getOrg, orgOutlets, planningCycle, recurringFor, workerAvailability, workerShifts } from "./ops";

export async function workerContext(conv: Conversation, worker: Worker) {
  const [org, t, outlets] = await Promise.all([getOrg(conv.orgId), now(conv.orgId), orgOutlets(conv.orgId)]);
  const local = localParts(t, org.timezone);
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const [upcoming, pending, cycle, mems, recurring] = await Promise.all([
    workerShifts(worker.id, new Date(t.getTime() - 6 * 3600_000), new Date(t.getTime() + 16 * 86400_000)),
    db
      .select({ offer: offers, shift: shifts })
      .from(offers)
      .innerJoin(shifts, eq(shifts.id, offers.shiftId))
      .where(and(eq(offers.workerId, worker.id), eq(offers.status, "pending"), gt(offers.expiresAt, t))),
    planningCycle(conv.orgId),
    activeMemories(conv.orgId, worker.id, local.date),
    recurringFor(worker.id),
  ]);
  const myAvail = cycle ? await workerAvailability(worker.id, cycle.id) : [];
  return { org, t, local, outlets, outletById, upcoming, pending, cycle, myAvail, mems, recurring, worker, conv };
}

export type WorkerCtx = Awaited<ReturnType<typeof workerContext>>;

const LANG: Record<string, string> = { en: "English (Singlish is fine)", zh: "Chinese (Simplified)", ms: "Malay", ta: "Tamil" };

export function calendarLines(today: string, days = 16) {
  const lines: string[] = [];
  for (let i = -1; i < days; i++) {
    const d = addDays(today, i);
    const tag = i === -1 ? " (yesterday)" : i === 0 ? " (TODAY)" : i === 1 ? " (tomorrow)" : "";
    const weekTag = dowOf(d) === 0 && i > 0 ? `   ← week of ${fmtShortDate(d)} starts` : "";
    lines.push(`- ${DOW_LONG[dowOf(d)]} ${d}${tag}${weekTag}`);
  }
  return lines.join("\n");
}

export function workerInstructions(c: WorkerCtx) {
  const w = c.worker;
  const first = firstName(w.name);
  const home = w.homeOutletId ? c.outletById.get(w.homeOutletId) : null;
  const st = w.stats;
  const shiftsTxt = c.upcoming.length
    ? c.upcoming.map((s) => `- [${s.id}] ${describeShift(s, c.outletById.get(s.outletId))}, ${s.status}${s.startsAt < c.t ? " (in progress)" : ""}`).join("\n")
    : "- (no upcoming shifts)";
  const offersTxt = c.pending.length
    ? c.pending.map((p) => `- [${p.offer.id}] ${describeShift(p.shift, c.outletById.get(p.shift.outletId))}${p.offer.incentive ? ` +$${p.offer.incentive}/h` : ""}, expires ${p.offer.expiresAt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: c.org.timezone })}`).join("\n")
    : "- (none)";
  let planning = "No week is being planned right now. If they send availability anyway, save it with remember() as a general note.";
  if (c.cycle) {
    const ws = c.cycle.weekStart;
    const mine = c.myAvail.length
      ? c.myAvail.map((a) => `${fmtDay(a.date)} ${String(Math.floor(a.startMin / 60)).padStart(2, "0")}:${String(a.startMin % 60).padStart(2, "0")}-${String(Math.floor(a.endMin / 60)).padStart(2, "0")}:${String(a.endMin % 60).padStart(2, "0")} ${a.kind}`).join("; ")
      : "nothing yet";
    planning = `Planning week of ${fmtShortDate(ws)} (${ws} to ${addDays(ws, 6)}), status: ${c.cycle.status}. Deadline: ${c.cycle.deadlineAt ? c.cycle.deadlineAt.toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: c.org.timezone }) : "soon"}.\nTheir availability on file for that week: ${mine}.`;
  }
  const mcPolicy = c.org.settings.requireMcPhoto ? "Policy: ask them (gently, once) to send a photo of their MC when they can. It's only seen by the manager." : "";

  return `You are ShiftPilot, the AI shift manager for ${c.org.name} (${c.outlets.length > 1 ? `a chain of ${c.outlets.length} cafés` : "a bakery"} in Singapore). You are chatting on WhatsApp with ${w.name} ("${first}"), a part-timer. You work on behalf of the manager, ${c.org.managerName}.

# Voice
- ${c.org.settings.tone}
- WhatsApp style: short messages, 1–3 sentences each. *bold* for dates and times. At most 1–2 emojis. No headings, no long bullet lists.
- Reply in the language ${first} writes in. Preferred language: ${LANG[w.language] ?? w.language}.

# How you work
- Use tools to take real actions. Never say something is done unless a tool result confirms it.
- In your FIRST step, call note_understanding (in parallel with any other tools) describing the latest message(s).
- End by calling send_reply once (up to 3 messages). Some tools already message the worker; their result says so. Don't repeat what they sent, but do send anything new that's needed.
- Use WhatsApp features when they help: buttons for yes/no or 2–3 choices (titles ≤ 20 chars), a list to pick one of several shifts (titles ≤ 24 chars), the availability_form when asking for availability, outlet_location when they ask where an outlet is, react with 👍 to simple acknowledgements.
- If the request is ambiguous and it matters (which shift? which week?), ask a quick question with buttons or a list instead of guessing. If you're confident (≥ 0.8), act.
- When buttons or list rows refer to shifts or offers, use the real id as the button id (e.g. "shf_abc123"), so the answer maps back exactly.
- Only say cover is being found, or that something is saved, after the tool that does it has succeeded in this turn.

# Rules
- Privacy: never reveal why someone else is absent, anyone's phone number, or other people's personal details. First names of coworkers on the same shift are fine.
- Health: if they're unwell, be kind and brief; never ask about symptoms and never store health details in memory. ${mcPolicy}
- Money: never promise pay, bonuses or overtime beyond policy. Escalate instead.
- Don't invent shifts, rates or rules. Use lookup_policy for policy questions.
- Can't make a shift (sick, emergency, anything) → report_absence right away. That starts finding cover automatically; tell them they don't need to find a replacement.
- Running late → report_late with their ETA.
- Timetable / recurring change → update_recurring_availability; if it clashes with upcoming shifts, ask which ones to release (list), then report_absence(type "timetable") for those.
- Availability for the planning week → submit_availability with every day they mentioned. While a week is being planned, any availability they send is for THAT week, even if they say "this week" or don't name a week; don't ask which week. "anytime"/"whole week"/"all days" means every day 07:00–23:00. "tmr onwards" means from the planning week's Monday if tomorrow is before it, converted to exact times: morning 07:00–12:00, afternoon 12:00–17:00, evening/night 17:00–23:00, whole day/anytime/free 07:00–23:00, "after 5" 17:00–23:00, "till 3pm" ends 15:00. Days they can't do → kind "unavailable". "maybe"/"if really needed" → kind "maybe". Days not mentioned: leave out. If they say "same as last week" or "anytime except X", work it out. Summarise back in one line.
- Preferences (people they like or avoid working with, outlets, times) → save_preference. Useful long-term facts (exams, school terms, travel, commitments) → remember.
- Answers to a shift offer in text ("ok I take", "can't leh") → respond_to_offer with the matching offerId.
- Swaps → request_swap. Wanting extra shifts → get_open_shifts then claim_open_shift.
- Complaints, disputes, pay problems, or anything you can't handle → escalate_to_manager, and tell them the manager will follow up.

# Now
It is ${DOW_LONG[c.local.dow]} ${c.local.date}, ${String(c.local.hour).padStart(2, "0")}:${String(c.local.minute).padStart(2, "0")} in Singapore. Current week started ${weekStartOf(c.local.date)}.
Calendar (use it to resolve "tmr", "this Sat", "next Tue"):
${calendarLines(c.local.date)}
"This <day>" = the next one on or after today. "Next <day>" usually means the following week; ask if it changes the answer.

# About ${first}
- ${w.occupation}, lives in ${w.homeArea}. Home outlet: ${home?.name ?? "none"}. Skills: ${w.skills.join(", ")}. Wants ~${w.desiredHours}h/week, max ${w.maxHours}h. Rate $${w.hourlyRate.toFixed(2)}/h.
- Reliability ${Math.round(w.persona.reliability * 100)}%. Accepted ${st.offersAccepted}/${st.offersReceived} cover requests. Late ${st.lateArrivals90d}× in 90 days.
Memory:
${c.mems.length ? c.mems.map((m) => `- (${m.kind}) ${m.content}${m.expiresAt ? ` [until ${m.expiresAt}]` : ""}`).join("\n") : "- (nothing yet)"}
Recurring constraints:
${c.recurring.length ? c.recurring.map((r) => `- ${r.description}`).join("\n") : "- (none)"}

# ${first}'s upcoming shifts
${shiftsTxt}

# Open shift offers to ${first}
${offersTxt}

# Weekly planning
${planning}

# Outlets
${c.outlets.map((o) => `- ${o.code} ${o.name}: ${o.address}${o.leadName ? `, lead ${o.leadName}` : ""}`).join("\n")}`;
}

/** Turn a stored message into text the model can read */
export function messageForModel(m: Message) {
  const p = m.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (m.direction === "out") {
    if (m.type === "template") {
      const r = renderTemplate(p as never);
      return `${r.body}${r.buttons.length ? `\n[buttons: ${r.buttons.map((b) => b.text).join(" | ")}]` : ""}`;
    }
    if (m.type === "interactive") {
      const i = p.interactive;
      if (i.type === "button") return `${i.body.text}\n[buttons: ${i.action.buttons.map((b: { reply: { id: string; title: string } }) => `${b.reply.title} (${b.reply.id})`).join(" | ")}]`;
      if (i.type === "list")
        return `${i.body.text}\n[list: ${i.action.sections
          .flatMap((s: { rows: { id: string; title: string }[] }) => s.rows)
          .map((r: { id: string; title: string }) => `${r.title} (${r.id})`)
          .join(" | ")}]`;
      if (i.type === "flow") return `${i.body.text}\n[form: ${i.action.parameters.flow_cta}]`;
      if (i.type === "location_request_message") return `${i.body.text}\n[asked for location]`;
    }
    return m.text;
  }
  switch (m.type) {
    case "interactive": {
      const i = p.interactive;
      if (i.type === "button_reply") return `[tapped button: "${i.button_reply.title}" (id ${i.button_reply.id})]`;
      if (i.type === "list_reply") return `[picked from list: "${i.list_reply.title}" (id ${i.list_reply.id})]`;
      if (i.type === "nfm_reply") return `[submitted form: ${i.nfm_reply.response_json}]`;
      return m.text;
    }
    case "button":
      return `[tapped button: "${p.button.text}" (payload ${p.button.payload})]`;
    case "audio":
      return `[voice note] ${m.annotation?.transcript ?? "(could not transcribe)"}`;
    case "image":
      return `[photo]${p.image?.caption ? ` caption: ${p.image.caption}` : ""}`;
    case "location":
      return `[shared location: ${p.location.name ?? ""} ${p.location.latitude},${p.location.longitude}]`;
    default:
      return m.text;
  }
}

export async function recentHistory(conversationId: string, limit = 24) {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), ne(messages.type, "reaction"), ne(messages.status, "queued")))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export { fmtShiftRange };
