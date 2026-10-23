import { cookies } from "next/headers";
import { ORG_COOKIE, ORG_IDS } from "@/lib/org";

export async function POST(req: Request) {
  const { orgId } = (await req.json()) as { orgId: string };
  if (!(ORG_IDS as readonly string[]).includes(orgId)) return Response.json({ error: "unknown org" }, { status: 400 });
  (await cookies()).set(ORG_COOKIE, orgId, { path: "/", maxAge: 60 * 60 * 24 * 30 });
  return Response.json({ ok: true });
}
