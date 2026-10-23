import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { markReadByUser } from "@/agent/inbound";

/** The phone opened this chat: business messages become read (blue ticks) */
export async function POST(_req: Request, ctx: RouteContext<"/api/conversations/[id]/read">) {
  const { id } = await ctx.params;
  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
  if (!conv) return Response.json({ error: "not found" }, { status: 404 });
  const n = await markReadByUser(conv);
  return Response.json({ ok: true, read: n });
}
