import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvals, type Approval } from "@/db/schema";
import { activeOrgId } from "@/lib/org";

export async function GET(req: Request) {
  const orgId = await activeOrgId(req);
  const status = new URL(req.url).searchParams.get("status") as Approval["status"] | null;
  const rows = await db
    .select()
    .from(approvals)
    .where(status ? and(eq(approvals.orgId, orgId), eq(approvals.status, status)) : eq(approvals.orgId, orgId))
    .orderBy(desc(approvals.createdAt))
    .limit(50);
  return Response.json({ approvals: rows });
}
