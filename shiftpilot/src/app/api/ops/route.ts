import { opsSnapshot } from "@/lib/dashboard";
import { activeOrgId } from "@/lib/org";

export async function GET(req: Request) {
  return Response.json(await opsSnapshot(await activeOrgId(req)));
}
