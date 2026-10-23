import { after } from "next/server";
import { decideApproval } from "@/agent/approvals";

export const maxDuration = 300;

/** Decide from the dashboard: { decision: "approved" | "rejected", optionId? } */
export async function POST(req: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { decision: "approved" | "rejected"; optionId?: string };
  // Executing can take a while (e.g. messaging the whole team), so keep it running after we respond
  const run = decideApproval(id, body.decision, { by: "Manager (dashboard)", channel: "dashboard", optionId: body.optionId });
  after(() => run.then(() => undefined).catch((e) => console.error("[approval]", e)));
  const r = await Promise.race([run, new Promise<null>((res) => setTimeout(() => res(null), 1500))]);
  return Response.json(r && !r.ok ? { ok: false, error: r.error } : { ok: true });
}
