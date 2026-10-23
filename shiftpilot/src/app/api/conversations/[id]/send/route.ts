import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";

/** The manager types as the business from the inbox */
export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[id]/send">) {
  const { id } = await ctx.params;
  const { text } = (await req.json()) as { text: string };
  const c = await db.query.conversations.findFirst({ where: eq(conversations.id, id) });
  if (!c) return Response.json({ error: "not found" }, { status: 404 });
  const r = await sendMessage({ orgId: c.orgId, conversationId: id, payload: wa.text(text), sender: "manager", privacy: { purpose: "manager" }, auditTitle: `Manager replied to ${c.title}` });
  return Response.json(r);
}
