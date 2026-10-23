/**
 * Inbound messages from workers (or the manager) arrive here, exactly as a
 * Cloud API webhook would deliver them, then the agent processes them.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, type Conversation } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { flushHeld } from "@/whatsapp/send";
import { payloadToText, type InboundPayload } from "@/whatsapp/types";
import { audit } from "./runs";

export async function receiveInbound(conversationId: string, payload: InboundPayload, opts?: { senderWorkerId?: string }) {
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  if (!conv) throw new Error("conversation not found");
  const t = await now(conv.orgId);
  const id = newId("msg");
  const sender = conv.kind === "manager_dm" ? "manager" : "worker";
  const text = payloadToText(payload as Record<string, unknown>);
  const contextId = "context" in payload && payload.context ? payload.context.id : null;

  await db.insert(messages).values({
    id,
    orgId: conv.orgId,
    conversationId,
    direction: "in",
    sender,
    senderWorkerId: opts?.senderWorkerId ?? conv.workerId ?? null,
    type: payload.type,
    payload: payload as Record<string, unknown>,
    text,
    status: "delivered",
    contextMessageId: contextId,
    createdAt: t,
    // Reactions don't need agent processing
    processedAt: payload.type === "reaction" ? t : null,
  });

  if (payload.type !== "reaction") {
    await db
      .update(conversations)
      .set({ lastInboundAt: t, lastMessageAt: t, lastMessagePreview: text.slice(0, 120) })
      .where(eq(conversations.id, conversationId));
  }
  await emit(conv.orgId, "message.created", { conversationId, messageId: id, workerId: conv.workerId, kind: conv.kind, direction: "in" });
  await audit(conv.orgId, {
    kind: "message_received",
    actor: sender === "manager" ? "manager" : "worker",
    title: `${conv.title}: ${text.slice(0, 80) || payload.type}`,
    detail: { conversationId, messageId: id, type: payload.type },
  });

  // Opening the 24h window releases anything held behind a template
  if (conv.kind === "worker_dm") await flushHeld(conv.orgId, conversationId);
  return { id, conv };
}

/** Mark the business's messages as read by the user (blue ticks on the business side) */
export async function markReadByUser(conv: Conversation) {
  const r = await db
    .update(messages)
    .set({ status: "read" })
    .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, "out"), eq(messages.status, "delivered")))
    .returning({ id: messages.id });
  if (r.length) await emit(conv.orgId, "message.updated", { conversationId: conv.id, read: r.length });
  return r.length;
}

/** Agent read the user's messages (blue ticks on the user's side) */
export async function markReadByAgent(conv: Conversation) {
  const r = await db
    .update(messages)
    .set({ status: "read" })
    .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, "in"), eq(messages.status, "delivered")))
    .returning({ id: messages.id });
  if (r.length) await emit(conv.orgId, "message.updated", { conversationId: conv.id, read: r.length });
}
