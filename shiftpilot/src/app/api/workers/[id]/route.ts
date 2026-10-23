import { workerProfile } from "@/lib/dashboard";

export async function GET(_req: Request, ctx: RouteContext<"/api/workers/[id]">) {
  const { id } = await ctx.params;
  const p = await workerProfile(id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(p);
}
