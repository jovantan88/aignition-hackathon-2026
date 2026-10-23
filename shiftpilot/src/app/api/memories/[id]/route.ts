import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { audit } from "@/agent/runs";
import { emit } from "@/lib/events";

export async function PATCH(req: Request, ctx: RouteContext<"/api/memories/[id]">) {
  const { id } = await ctx.params;
  const b = (await req.json()) as { content?: string; active?: boolean; pinned?: boolean };
  const [m] = await db.update(memories).set(b).where(eq(memories.id, id)).returning();
  if (m) {
    await audit(m.orgId, { kind: "memory", actor: "manager", title: b.active === false ? `Manager removed a memory: ${m.content}` : `Manager edited a memory: ${m.content}` });
    await emit(m.orgId, "memory.updated", { workerId: m.workerId });
  }
  return Response.json({ ok: Boolean(m) });
}
