/**
 * Tools the worker-facing agent can call. Each one is a real action against
 * the database or the messaging pipeline, and is audited.
 */
import { tool } from "ai";
import { z } from "zod";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, coverRequests, offers, recurringConstraints, shifts, workers, type Message } from "@/db/schema";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { addDays, fmtDay, fmtShiftRange, localParts, toMinutes, weekStartOf } from "@/lib/time";
import { availabilityFlow, leaveFlow, preferencesFlow } from "@/whatsapp/flows";
import { sendMessage } from "@/whatsapp/send";
import { wa, type OutboundPayload } from "@/whatsapp/types";
import type { WorkerCtx } from "../context";
import { describeShift, firstName, notifyManager, saveMemory, weekHours, writeAvailability } from "../ops";
import { audit } from "../runs";
import { reportAbsence, respondToOffer } from "../workflows/cover";

export type TurnState = {
  sent: number;
  replySent?: boolean;
  intent?: string;
  summary?: string;
  confidence?: number;
  tools: string[];
  lastInbound: Message;
  extracted?: unknown;
};

const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function buildWorkerTools(c: WorkerCtx, turn: TurnState) {
  const orgId = c.org.id;
  const w = c.worker;
  const convId = c.conv.id;
  const b = c.org.settings.baselines;

  const log = async (name: string, input: unknown, result: unknown, manualMinutes = 0) => {
    turn.tools.push(name);
    await audit(orgId, {
      kind: "tool_call",
      title: `${name} · ${w.name}`,
      detail: { conversationId: convId, input: input as Record<string, unknown>, result: result as Record<string, unknown> },
      manualMinutes,
    });
  };

  const myShift = (id: string) => c.upcoming.find((s) => s.id === id);

  const flowPayload = (kind: "availability" | "leave" | "preferences", text: string): OutboundPayload => {
    if (kind === "availability" && c.cycle) {
      const dates = Array.from({ length: 7 }, (_, i) => addDays(c.cycle!.weekStart, i));
      const data = { weekLabel: `week of ${fmtDay(c.cycle.weekStart).slice(4)}`, dates, outlets: c.outlets.map((o) => ({ id: o.code, title: o.name })) };
      availabilityFlow(data);
      return wa.flow(text, "Fill availability", "flow_availability", `avail:${c.cycle.id}:${w.id}`, "DAYS", data);
    }
    if (kind === "leave") {
      const data = {
        today: c.local.date,
        shifts: c.upcoming.filter((s) => s.startsAt > c.t).slice(0, 8).map((s) => ({ id: s.id, title: `${fmtDay(s.date)} ${s.label}`, description: `${fmtShiftRange(s.startsAt, s.endsAt)} · ${c.outletById.get(s.outletId)?.name}` })),
      };
      leaveFlow(data);
      return wa.flow(text, "Report absence", "flow_leave", `leave:${w.id}`, "LEAVE", data);
    }
    const data = { outlets: c.outlets.map((o) => ({ id: o.code, title: o.name })), coworkers: [] as { id: string; title: string }[] };
    preferencesFlow(data);
    return wa.flow(text, "Set preferences", "flow_preferences", `prefs:${w.id}`, "PREFS", data);
  };

  return {
    note_understanding: tool({
      description: "Record what the latest message(s) mean. Call this in your first step, alongside other tools.",
      inputSchema: z.object({
        intent: z.enum([
          "availability",
          "absence_sick",
          "absence_other",
          "late",
          "timetable_change",
          "offer_response",
          "swap",
          "extra_shifts",
          "question_schedule",
          "question_policy",
          "preference",
          "confirmation",
          "small_talk",
          "complaint",
          "other",
        ]),
        summary: z.string().describe("One line, e.g. 'Free Mon–Wed after 5pm, Sat all day; not Sun'"),
        confidence: z.number().min(0).max(1),
      }),
      execute: async (input) => {
        turn.intent = input.intent;
        turn.summary = input.summary;
        turn.confidence = input.confidence;
        return { ok: true };
      },
    }),

    get_my_shifts: tool({
      description: "List this worker's shifts from now for the next N days (default 14).",
      inputSchema: z.object({ days: z.number().int().min(1).max(30).optional() }),
      execute: async ({ days }) => {
        const until = c.t.getTime() + (days ?? 14) * 86400_000;
        const rows = c.upcoming.filter((s) => s.startsAt.getTime() < until);
        const out = rows.map((s) => ({ shiftId: s.id, when: describeShift(s, c.outletById.get(s.outletId)), status: s.status }));
        await log("get_my_shifts", { days }, { count: out.length });
        return out;
      },
    }),

    get_coworkers: tool({
      description: "First names of who else is working during one of this worker's shifts.",
      inputSchema: z.object({ shiftId: z.string() }),
      execute: async ({ shiftId }) => {
        const s = myShift(shiftId);
        if (!s) return { error: "Not one of their shifts" };
        const rows = await db
          .select({ name: workers.name, label: shifts.label })
          .from(shifts)
          .innerJoin(workers, eq(workers.id, shifts.workerId))
          .where(and(eq(shifts.outletId, s.outletId), eq(shifts.date, s.date), sql`${shifts.id} <> ${s.id}`, inArray(shifts.status, ["assigned", "confirmed", "covered"])));
        const out = rows.map((r) => `${firstName(r.name)} (${r.label})`);
        await log("get_coworkers", { shiftId }, out);
        return { coworkers: out, outletLead: c.outletById.get(s.outletId)?.leadName };
      },
    }),

    lookup_policy: tool({
      description: "Look up company policy (pay, MC, dress code, breaks, swaps, lateness) and outlet info.",
      inputSchema: z.object({ question: z.string() }),
      execute: async ({ question }) => {
        await log("lookup_policy", { question }, {}, b.question);
        return { faq: c.org.settings.faq, outlets: c.outlets.map((o) => ({ code: o.code, name: o.name, address: o.address, hours: `${o.openTime}–${o.closeTime}` })) };
      },
    }),

    submit_availability: tool({
      description: "Save the worker's availability for the week being planned. Times are HH:MM 24h, local Singapore time.",
      inputSchema: z.object({
        entries: z
          .array(
            z.object({
              date: z.string().describe("YYYY-MM-DD"),
              start: z.string().describe("HH:MM"),
              end: z.string().describe("HH:MM"),
              kind: z.enum(["available", "preferred", "maybe", "unavailable"]),
              note: z.string().optional(),
            }),
          )
          .describe("One entry per continuous window; whole-day unavailability is 07:00–23:00 unavailable"),
        replaceWholeWeek: z.boolean().describe("true if this is their full answer for the week, false if it only changes some days"),
        maxHours: z.number().int().optional(),
        notes: z.string().optional(),
        confidence: z.number().min(0).max(1),
      }),
      execute: async (input) => {
        if (!c.cycle) return { error: "No week is being planned right now. Save it with remember() instead." };
        const ws = c.cycle.weekStart;
        const we = addDays(ws, 6);
        const valid = input.entries.filter((e) => e.date >= ws && e.date <= we);
        const ignored = input.entries.length - valid.length;
        const entries = valid.map((e) => ({ date: e.date, startMin: toMinutes(e.start), endMin: Math.max(toMinutes(e.end), toMinutes(e.start) + 30), kind: e.kind, note: e.note }));
        await writeAvailability({
          orgId,
          workerId: w.id,
          cycleId: c.cycle.id,
          entries,
          replaceDates: input.replaceWholeWeek ? "all" : [...new Set(entries.map((e) => e.date))],
          source: "text",
          confidence: input.confidence,
          sourceMessageId: turn.lastInbound.id,
        });
        if (input.maxHours) {
          await saveMemory({ orgId, workerId: w.id, kind: "constraint", content: `Max ${input.maxHours}h in the week of ${fmtDay(ws)}`, expiresAt: we, createdBy: "agent", evidenceMessageId: turn.lastInbound.id });
        }
        turn.extracted = entries;
        const { onAvailabilitySubmitted } = await import("../workflows/weekly");
        await onAvailabilitySubmitted(c.cycle.id, w.id, "text");
        const result = { saved: entries.length, ignoredOutsideWeek: ignored, week: `${ws} to ${we}` };
        await log("submit_availability", input, result, b.availabilityParse);
        return result;
      },
    }),

    report_absence: tool({
      description: "The worker can't make one of their shifts. Releases it and immediately starts finding cover.",
      inputSchema: z.object({
        shiftId: z.string(),
        type: z.enum(["sick", "emergency", "leave", "timetable"]),
        privateReason: z.string().describe("Short private note for the manager. No medical details beyond 'unwell'."),
      }),
      execute: async (input) => {
        const s = myShift(input.shiftId);
        if (!s) return { error: "That shift isn't one of theirs. Check get_my_shifts." };
        if (s.endsAt < c.t) return { error: "That shift is already over." };
        const r = await reportAbsence({ shiftId: s.id, type: input.type, reason: input.privateReason, sourceMessageId: turn.lastInbound.id, by: "worker" });
        const result = {
          ok: true,
          released: describeShift(s, c.outletById.get(s.outletId)),
          alreadyBeingCovered: r.alreadyOpen,
          note: "Cover search has started automatically. Reassure them they don't need to find a replacement.",
          askForMc: input.type === "sick" && c.org.settings.requireMcPhoto,
        };
        await log("report_absence", input, result);
        return result;
      },
    }),

    report_late: tool({
      description: "The worker is running late for a shift. Tells the outlet lead and manager.",
      inputSchema: z.object({ shiftId: z.string(), etaMinutes: z.number().int().min(1).max(240), reason: z.string().optional() }),
      execute: async (input) => {
        const s = myShift(input.shiftId);
        if (!s) return { error: "Not one of their shifts" };
        const outlet = c.outletById.get(s.outletId);
        const eta = new Date(Math.max(s.startsAt.getTime(), c.t.getTime()) + input.etaMinutes * 60_000);
        const etaTxt = eta.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: c.org.timezone });
        await notifyManager(orgId, `⏰ ${w.name} is running ~${input.etaMinutes} min late for ${outlet?.code} ${s.label} (ETA ${etaTxt}). ${outlet?.leadName ?? "The lead"} has been told.`);
        await db.update(workers).set({ stats: sql`jsonb_set(${workers.stats}, '{lateArrivals90d}', to_jsonb(coalesce((${workers.stats}->>'lateArrivals90d')::int,0) + 1))` }).where(eq(workers.id, w.id));
        await saveMemory({ orgId, workerId: w.id, kind: "behaviour", content: `Ran ${input.etaMinutes} min late on ${fmtDay(s.date)} (told us ahead)`, createdBy: "agent", evidenceMessageId: turn.lastInbound.id });
        const result = { ok: true, eta: etaTxt, leadNotified: outlet?.leadName };
        await log("report_late", input, result, 3);
        return result;
      },
    }),

    update_recurring_availability: tool({
      description: "Save a recurring change, e.g. a new school timetable. Returns upcoming shifts that clash.",
      inputSchema: z.object({
        description: z.string().describe("e.g. 'Classes Tue & Thu 9am–1pm (new term)'"),
        days: z.array(z.enum(DAY_CODES)),
        start: z.string().describe("HH:MM"),
        end: z.string().describe("HH:MM"),
        kind: z.enum(["unavailable", "preferred"]),
        validFrom: z.string().optional().describe("YYYY-MM-DD"),
        validTo: z.string().optional().describe("YYYY-MM-DD"),
      }),
      execute: async (input) => {
        const dows = input.days.map((d) => DAY_CODES.indexOf(d));
        const startMin = toMinutes(input.start);
        const endMin = toMinutes(input.end);
        await db.insert(recurringConstraints).values({
          id: newId("rc"),
          workerId: w.id,
          description: input.description,
          dows,
          startMin,
          endMin,
          kind: input.kind,
          validFrom: input.validFrom ?? c.local.date,
          validTo: input.validTo ?? null,
          sourceMessageId: turn.lastInbound.id,
          createdAt: c.t,
        });
        await emit(orgId, "memory.updated", { workerId: w.id });
        const from = input.validFrom ?? c.local.date;
        const clashes =
          input.kind === "unavailable"
            ? c.upcoming.filter((s) => {
                if (s.date < from || (input.validTo && s.date > input.validTo)) return false;
                const p = localParts(s.startsAt).dow;
                const sm = localParts(s.startsAt).minutes;
                const em = localParts(s.endsAt).minutes || 1440;
                return dows.includes(p) && sm < endMin && em > startMin;
              })
            : [];
        const result = { saved: true, clashingShifts: clashes.map((s) => ({ shiftId: s.id, when: describeShift(s, c.outletById.get(s.outletId)) })) };
        await log("update_recurring_availability", input, result, 4);
        return result;
      },
    }),

    respond_to_offer: tool({
      description: "Accept or decline a shift offer they replied to in text. This also messages them the outcome.",
      inputSchema: z.object({ offerId: z.string(), accept: z.boolean() }),
      execute: async (input) => {
        const r = await respondToOffer(input.offerId, input.accept, "text");
        turn.sent++;
        await log("respond_to_offer", input, r);
        return { ...r, alreadyMessagedWorker: true };
      },
    }),

    get_open_shifts: tool({
      description: "Shifts in the next 10 days that need someone and that this worker could do.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await db
          .select()
          .from(shifts)
          .where(and(eq(shifts.orgId, orgId), inArray(shifts.status, ["open", "cover_needed"]), gte(shifts.startsAt, c.t), lte(shifts.startsAt, new Date(c.t.getTime() + 10 * 86400_000))));
        const busyDates = new Set(c.upcoming.map((s) => s.date));
        const out = rows
          .filter((s) => w.skills.includes(s.skill) && !busyDates.has(s.date))
          .slice(0, 10)
          .map((s) => ({ shiftId: s.id, when: describeShift(s, c.outletById.get(s.outletId)) }));
        await log("get_open_shifts", {}, { count: out.length });
        return out;
      },
    }),

    claim_open_shift: tool({
      description: "Give an open shift to this worker after they said they want it.",
      inputSchema: z.object({ shiftId: z.string() }),
      execute: async ({ shiftId }) => {
        const s = await db.query.shifts.findFirst({ where: eq(shifts.id, shiftId) });
        if (!s || !["open", "cover_needed"].includes(s.status)) return { error: "That shift is no longer open." };
        if (!w.skills.includes(s.skill)) return { error: `They aren't trained as ${s.skill}.` };
        if (c.upcoming.some((u) => u.date === s.date)) return { error: "They already work that day." };
        const hrs = await weekHours(w.id, s.date);
        const len = (s.endsAt.getTime() - s.startsAt.getTime()) / 3_600_000;
        if (hrs + len > w.maxHours) return { error: `That would put them at ${(hrs + len).toFixed(0)}h, over their ${w.maxHours}h cap. Needs manager approval: escalate.` };
        const cover = await db.query.coverRequests.findFirst({ where: and(eq(coverRequests.shiftId, s.id), inArray(coverRequests.status, ["searching", "offered", "escalated"])) });
        if (cover) {
          const id = newId("ofr");
          await db.insert(offers).values({ id, orgId, coverRequestId: cover.id, shiftId: s.id, workerId: w.id, wave: cover.wave || 1, kind: "cover", incentive: 0, status: "pending", sentAt: c.t, expiresAt: new Date(c.t.getTime() + 3600_000) });
          const r = await respondToOffer(id, true, "text");
          turn.sent++;
          await log("claim_open_shift", { shiftId }, r);
          return { ...r, alreadyMessagedWorker: true };
        }
        await db.update(shifts).set({ workerId: w.id, status: "confirmed", source: "manual", confirmedAt: c.t }).where(eq(shifts.id, s.id));
        await emit(orgId, "shift.updated", { shiftId: s.id });
        const result = { ok: true, shift: describeShift(s, c.outletById.get(s.outletId)) };
        await log("claim_open_shift", { shiftId }, result, b.coverSearch / 2);
        return result;
      },
    }),

    request_swap: tool({
      description: "The worker wants to swap one of their shifts, optionally with a named coworker.",
      inputSchema: z.object({ shiftId: z.string(), withName: z.string().optional() }),
      execute: async (input) => {
        const s = myShift(input.shiftId);
        if (!s) return { error: "Not one of their shifts" };
        const { requestSwap } = await import("../workflows/swap");
        const r = await requestSwap({ shift: s, requester: w, withName: input.withName });
        await log("request_swap", input, r, b.swap / 2);
        return r;
      },
    }),

    save_preference: tool({
      description: "Save a lasting preference.",
      inputSchema: z.object({
        kind: z.enum(["likes_working_with", "avoid_working_with", "preferred_outlet", "avoid_outlet", "preferred_times", "avoid_times", "other"]),
        value: z.string().describe("e.g. 'Aisha', 'Tampines', 'no closing shifts'"),
        note: z.string().optional(),
      }),
      execute: async (input) => {
        const text: Record<string, string> = {
          likes_working_with: `Likes working with ${input.value}`,
          avoid_working_with: `Prefers not to work with ${input.value}`,
          preferred_outlet: `Prefers the ${input.value} outlet`,
          avoid_outlet: `Would rather not work at ${input.value}`,
          preferred_times: `Prefers ${input.value}`,
          avoid_times: `Avoid ${input.value}`,
          other: input.value,
        };
        const content = `${text[input.kind]}${input.note ? ` (${input.note})` : ""}`;
        const id = await saveMemory({
          orgId,
          workerId: w.id,
          kind: input.kind.includes("working_with") ? "relationship" : "preference",
          content,
          createdBy: "agent",
          evidenceMessageId: turn.lastInbound.id,
        });
        await log("save_preference", input, { saved: Boolean(id), content });
        return { saved: true, content };
      },
    }),

    remember: tool({
      description: "Remember a useful long-term fact about this worker (exams, commitments, travel). Never health details.",
      inputSchema: z.object({
        content: z.string(),
        kind: z.enum(["fact", "constraint", "preference"]),
        expiresOn: z.string().optional().describe("YYYY-MM-DD when it stops being relevant"),
      }),
      execute: async (input) => {
        if (/\b(sick|fever|flu|covid|mc\b|medical|hospital|clinic|pregnan|injur)/i.test(input.content)) return { error: "Health details are not stored in memory." };
        await saveMemory({ orgId, workerId: w.id, kind: input.kind, content: input.content, expiresAt: input.expiresOn ?? null, createdBy: "agent", evidenceMessageId: turn.lastInbound.id });
        await log("remember", input, { saved: true });
        return { saved: true };
      },
    }),

    escalate_to_manager: tool({
      description: "Hand something to the human manager (complaints, pay issues, anything outside your rules).",
      inputSchema: z.object({ summary: z.string(), urgency: z.enum(["low", "normal", "high"]) }),
      execute: async (input) => {
        await notifyManager(orgId, `${input.urgency === "high" ? "🔴" : "🟠"} *${w.name}* needs you: ${input.summary}`, { attention: true });
        await db.update(conversations).set({ needsAttention: true }).where(eq(conversations.id, convId));
        await emit(orgId, "conversation.updated", { conversationId: convId });
        await log("escalate_to_manager", input, { ok: true }, b.escalationPrep);
        return { ok: true, note: "Tell them the manager has been told and will follow up." };
      },
    }),

    send_reply: tool({
      description: "Send your reply on WhatsApp. Up to 3 messages, sent in order.",
      inputSchema: z.object({
        messages: z
          .array(
            z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("text"), text: z.string() }),
              z.object({
                kind: z.literal("buttons"),
                text: z.string(),
                buttons: z.array(z.object({ id: z.string(), title: z.string().describe("≤ 20 chars") })).min(1).max(3),
                header: z.string().optional(),
                footer: z.string().optional(),
              }),
              z.object({
                kind: z.literal("list"),
                text: z.string(),
                buttonLabel: z.string().describe("≤ 20 chars, e.g. 'Pick a shift'"),
                rows: z.array(z.object({ id: z.string(), title: z.string().describe("≤ 24 chars"), description: z.string().optional() })).min(1).max(10),
              }),
              z.object({ kind: z.literal("availability_form"), text: z.string() }),
              z.object({ kind: z.literal("leave_form"), text: z.string() }),
              z.object({ kind: z.literal("preferences_form"), text: z.string() }),
              z.object({ kind: z.literal("location_request"), text: z.string() }),
              z.object({ kind: z.literal("outlet_location"), outletCode: z.string() }),
              z.object({ kind: z.literal("react"), emoji: z.string() }),
            ]),
          )
          .min(1)
          .max(3),
      }),
      execute: async ({ messages: msgs }) => {
        const results: string[] = [];
        for (const m of msgs) {
          let payload: OutboundPayload;
          switch (m.kind) {
            case "text":
              payload = wa.text(m.text);
              break;
            case "buttons":
              payload = wa.buttons(m.text, m.buttons, { header: m.header, footer: m.footer });
              break;
            case "list":
              payload = wa.list(m.text, m.buttonLabel, [{ rows: m.rows }]);
              break;
            case "availability_form":
              if (!c.cycle) return { error: "No week is being planned, so there's no availability form to send." };
              payload = flowPayload("availability", m.text);
              break;
            case "leave_form":
              payload = flowPayload("leave", m.text);
              break;
            case "preferences_form":
              payload = flowPayload("preferences", m.text);
              break;
            case "location_request":
              payload = wa.locationRequest(m.text);
              break;
            case "outlet_location": {
              const o = c.outlets.find((x) => x.code.toLowerCase() === m.outletCode.toLowerCase()) ?? c.outlets.find((x) => x.name.toLowerCase().includes(m.outletCode.toLowerCase()));
              if (!o) return { error: `Unknown outlet ${m.outletCode}` };
              payload = wa.location(o.lat, o.lng, `${c.org.name} ${o.name}`, o.address);
              break;
            }
            case "react":
              payload = wa.reaction(turn.lastInbound.id, m.emoji);
              break;
          }
          const r = await sendMessage({ orgId, conversationId: convId, payload });
          if (!r.ok) return { error: r.error, sentSoFar: results.length, hint: "Fix the message and call send_reply again with only the unsent messages." };
          results.push(r.messageId);
          turn.sent++;
          if (results.length < msgs.length) await new Promise((res) => setTimeout(res, 200));
        }
        turn.replySent = true;
        return { sent: results.length };
      },
    }),
  };
}

export { weekStartOf };
