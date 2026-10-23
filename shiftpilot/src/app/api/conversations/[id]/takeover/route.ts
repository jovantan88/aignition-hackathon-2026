import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { audit } from "@/agent/runs";
import { emit } from "@/lib/events";

/** The manager takes over a chat (agent paused) or hands it back */
export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[id]/takeover">) {
  const { id } = await ctx.params;
  const { paused } = (await req.json()) as { paused: boolean };
  const [c] = await db.update(conversations).set({ agentPaused: paused, needsAttention: false }).where(eq(conversations.id, id)).returning();
  if (c) {
    await audit(c.orgId, { kind: "decision", actor: "manager", title: paused ? `Manager took over the chat with ${c.title}` : `Manager handed ${c.title} back to the agent` });
    await emit(c.orgId, "conversation.updated", { conversationId: id });
  }
  return Response.json({ ok: true });
}
