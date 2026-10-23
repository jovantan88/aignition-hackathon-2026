import { after } from "next/server";
import { runScenario } from "@/agent/scenarios";
import { activeOrgId } from "@/lib/org";

export const maxDuration = 120;

export async function POST(req: Request, ctx: RouteContext<"/api/scenarios/[name]">) {
  const { name } = await ctx.params;
  const orgId = await activeOrgId(req);
  const body = (await req.json().catch(() => ({}))) as { workerId?: string };
  const p = runScenario(orgId, name, body);
  after(() => p.then(() => undefined).catch((e) => console.error("[scenario]", e)));
  const r = await Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), 3000))]);
  return Response.json(r ?? { ok: true, running: true });
}
