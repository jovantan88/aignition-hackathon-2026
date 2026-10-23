import { runDetail } from "@/lib/dashboard";

export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  const { id } = await ctx.params;
  const r = await runDetail(id);
  if (!r) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(r);
}
