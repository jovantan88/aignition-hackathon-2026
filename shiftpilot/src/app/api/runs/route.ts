import { runsList } from "@/lib/dashboard";
import { activeOrgId } from "@/lib/org";

export async function GET(req: Request) {
  return Response.json({ runs: await runsList(await activeOrgId(req)) });
}
