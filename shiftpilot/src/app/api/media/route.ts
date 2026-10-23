import { db } from "@/db";
import { media } from "@/db/schema";
import { newId } from "@/lib/ids";

const MAX_BYTES = 2_000_000;

/** Upload a voice note / photo from the phone simulator (base64 JSON) */
export async function POST(req: Request) {
  const body = (await req.json()) as { orgId: string; kind: "voice" | "image" | "document"; mime: string; data: string; meta?: Record<string, unknown> };
  const bytes = Math.floor((body.data.length * 3) / 4);
  if (bytes > MAX_BYTES) return Response.json({ error: "File too large (2 MB max)" }, { status: 413 });
  const id = newId("med");
  await db.insert(media).values({
    id,
    orgId: body.orgId,
    kind: body.kind,
    mime: body.mime,
    data: body.data,
    bytes,
    restricted: body.kind === "image",
    meta: body.meta ?? null,
  });
  return Response.json({ id });
}
