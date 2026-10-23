import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";

export async function GET(_req: Request, ctx: RouteContext<"/api/media/[id]">) {
  const { id } = await ctx.params;
  const row = await db.query.media.findFirst({ where: eq(media.id, id) });
  if (!row) return new Response("not found", { status: 404 });
  return new Response(Buffer.from(row.data, "base64"), {
    headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=3600" },
  });
}
