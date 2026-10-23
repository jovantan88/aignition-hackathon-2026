import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, type Job } from "@/db/schema";

type Handler = (job: Job) => Promise<void>;
const p = <T = string>(j: Job, k: string) => j.payload[k] as T;

export const handlers: Record<string, Handler> = {
  "cover.search": async (j) => {
    const { coverSearch } = await import("./workflows/cover");
    await coverSearch(p(j, "coverRequestId"));
  },
  "cover.timeout": async (j) => {
    const { coverTimeout } = await import("./workflows/cover");
    await coverTimeout(p(j, "coverRequestId"), p<number>(j, "wave"));
  },
  "availability.reminder": async (j) => {
    const { sendReminders } = await import("./workflows/weekly");
    await sendReminders(p(j, "cycleId"), p<number>(j, "n"));
  },
  "cycle.deadline": async (j) => {
    const { solveCycle } = await import("./workflows/weekly");
    await solveCycle(p(j, "cycleId"));
  },
  "cycle.chase": async (j) => {
    const { chaseConfirmations } = await import("./workflows/weekly");
    await chaseConfirmations(p(j, "cycleId"));
  },
  "negotiate.close": async (j) => {
    const { closeNegotiation } = await import("./workflows/negotiate");
    await closeNegotiation(p(j, "cycleId"));
  },
  "persona.availability": async (j) => {
    const { personaRespondToAvailability } = await import("./personas");
    await personaRespondToAvailability(p(j, "cycleId"), p(j, "workerId"));
  },
  "persona.offer": async (j) => {
    const { personaRespondToOffer } = await import("./personas");
    await personaRespondToOffer(p(j, "offerId"));
  },
  "persona.confirm": async (j) => {
    const { personaConfirm } = await import("./personas");
    await personaConfirm(p(j, "cycleId"), p(j, "workerId"));
  },
  "conversation.retry": async (j) => {
    const messageId = p(j, "messageId");
    if (messageId) await db.update(messages).set({ processedAt: null }).where(eq(messages.id, messageId));
    const { processConversation } = await import("./conversation");
    await processConversation(p(j, "conversationId"), { noDebounce: true });
  },
  "message.release": async (j) => {
    const { flushHeld } = await import("@/whatsapp/send");
    await flushHeld(j.orgId, p(j, "conversationId"), "quiet");
  },
  "shift.reminder": async (j) => {
    const { sendShiftReminder } = await import("./workflows/checkin");
    await sendShiftReminder(p(j, "shiftId"));
  },
  "checkin.check": async (j) => {
    const { checkNoShow } = await import("./workflows/checkin");
    await checkNoShow(p(j, "shiftId"));
  },
};
