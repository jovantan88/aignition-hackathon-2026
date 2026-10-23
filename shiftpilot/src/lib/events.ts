/**
 * Realtime bus: append-only `events` table, tailed by /api/live (SSE).
 * Topics are dotted, e.g. "message.created", "typing", "shift.updated".
 */
import { db } from "@/db";
import { events } from "@/db/schema";

export type LiveTopic =
  | "message.created"
  | "message.updated"
  | "typing"
  | "conversation.updated"
  | "shift.updated"
  | "cover.updated"
  | "offer.updated"
  | "approval.created"
  | "approval.decided"
  | "run.updated"
  | "audit.created"
  | "memory.updated"
  | "cycle.updated"
  | "availability.updated"
  | "clock.changed"
  | "arc"
  | "pulse"
  | "toast"
  | "demo.reset";

export async function emit(orgId: string, topic: LiveTopic, payload: Record<string, unknown> = {}) {
  try {
    await db.insert(events).values({ orgId, topic, payload });
  } catch (e) {
    // Realtime is best-effort; never fail the action because of it
    console.error("[events] emit failed", topic, e);
  }
}
