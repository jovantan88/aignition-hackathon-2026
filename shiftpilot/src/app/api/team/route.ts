import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { outlets, workers } from "@/db/schema";
import { activeOrgId } from "@/lib/org";

export async function GET(req: Request) {
  const orgId = await activeOrgId(req);
  const rows = await db
    .select({
      id: workers.id,
      name: workers.name,
      occupation: workers.occupation,
      homeArea: workers.homeArea,
      skills: workers.skills,
      desiredHours: workers.desiredHours,
      maxHours: workers.maxHours,
      language: workers.language,
      autopilot: workers.autopilot,
      avatarHue: workers.avatarHue,
      persona: workers.persona,
      stats: workers.stats,
      outletId: workers.homeOutletId,
      outletName: outlets.name,
      outletCode: outlets.code,
    })
    .from(workers)
    .leftJoin(outlets, eq(outlets.id, workers.homeOutletId))
    .where(eq(workers.orgId, orgId))
    .orderBy(asc(workers.name));
  return Response.json({ orgId, workers: rows });
}
