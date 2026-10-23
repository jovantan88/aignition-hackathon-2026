import { after } from "next/server";
import { startWeeklyPlanning } from "@/agent/workflows/weekly";
import { activeOrgId } from "@/lib/org";

export const maxDuration = 120;

/** The manager gives the weekly goal from the dashboard */
export async function POST(req: Request) {
  const orgId = await activeOrgId(req);
  const { goal } = (await req.json()) as { goal: string };
  const p = startWeeklyPlanning({ orgId, goal });
  after(() => p.then(() => undefined).catch((e) => console.error("[plan]", e)));
  const r = await Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), 2500))]);
  return Response.json({ ok: true, started: r ?? "in progress" });
}
