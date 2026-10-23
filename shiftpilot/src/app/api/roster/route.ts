import { rosterWeek } from "@/lib/dashboard";
import { now } from "@/lib/clock";
import { activeOrgId } from "@/lib/org";
import { localParts, weekStartOf } from "@/lib/time";

export async function GET(req: Request) {
  const orgId = await activeOrgId(req);
  const week = new URL(req.url).searchParams.get("week") ?? weekStartOf(localParts(await now(orgId)).date);
  return Response.json(await rosterWeek(orgId, weekStartOf(week)));
}
