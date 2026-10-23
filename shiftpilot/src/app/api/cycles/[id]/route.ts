import { after } from "next/server";
import { solveCycle } from "@/agent/workflows/weekly";

export const maxDuration = 120;

/** { action: "solve" } stops collecting early and solves now */
export async function POST(req: Request, ctx: RouteContext<"/api/cycles/[id]">) {
  const { id } = await ctx.params;
  const { action } = (await req.json()) as { action: "solve" };
  if (action === "solve") after(() => solveCycle(id).catch((e) => console.error("[solve]", e)));
  return Response.json({ ok: true });
}
