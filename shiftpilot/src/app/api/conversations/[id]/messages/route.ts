import { after } from "next/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, workers } from "@/db/schema";
import { receiveInbound } from "@/agent/inbound";
import { processConversation } from "@/agent/conversation";
import type { InboundPayload } from "@/whatsapp/types";

export const maxDuration = 120;

export async function GET(req: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const includeQueued = url.searchParams.get("queued") === "1";
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  const rows = await db
    .select()
    .from(messages)
    .where(includeQueued ? eq(messages.conversationId, id) : and(eq(messages.conversationId, id), ne(messages.status, "queued")))
    .orderBy(asc(messages.createdAt), asc(messages.realCreatedAt));
  const senderIds = [...new Set(rows.map((r) => r.senderWorkerId).filter(Boolean) as string[])];
  const people = senderIds.length
    ? await db.select({ id: workers.id, name: workers.name, avatarHue: workers.avatarHue }).from(workers).where(inArray(workers.id, senderIds))
    : [];
  return Response.json({ conversation: conv, messages: rows, people });
}

/** Inbound message from the simulated phone (worker or manager) */
export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { payload: InboundPayload; senderWorkerId?: string };
  const { id: messageId, conv } = await receiveInbound(id, body.payload, { senderWorkerId: body.senderWorkerId });
  if (body.payload.type !== "reaction" && conv.kind !== "outlet_group") {
    // A person driving the demo should not wait for the persona burst debounce.
    after(() => processConversation(id, { noDebounce: true }).catch((e) => console.error("[agent] processConversation failed", e)));
  }
  return Response.json({ ok: true, messageId });
}
