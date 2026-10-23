import { inbox } from "@/lib/dashboard";
import { activeOrgId } from "@/lib/org";

export async function GET(req: Request) {
  return Response.json({ conversations: await inbox(await activeOrgId(req)) });
}
