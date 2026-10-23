import { saveMemory } from "@/agent/ops";
import type { Memory } from "@/db/schema";
import { activeOrgId } from "@/lib/org";

export async function POST(req: Request) {
  const orgId = await activeOrgId(req);
  const b = (await req.json()) as { workerId: string | null; content: string; kind: Memory["kind"]; expiresAt?: string };
  const id = await saveMemory({ orgId, workerId: b.workerId, kind: b.kind, content: b.content, expiresAt: b.expiresAt ?? null, createdBy: "manager" });
  return Response.json({ id });
}
