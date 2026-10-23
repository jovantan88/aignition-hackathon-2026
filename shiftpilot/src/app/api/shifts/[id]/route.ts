import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { audit } from "@/agent/runs";
import { rankCandidates } from "@/agent/ranking";
import { emit } from "@/lib/events";

/** Ranked candidates for a shift, with reasons */
export async function GET(_req: Request, ctx: RouteContext<"/api/shifts/[id]">) {
  const { id } = await ctx.params;
  const s = await db.query.shifts.findFirst({ where: eq(shifts.id, id) });
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const ranked = await rankCandidates(s, { exclude: s.workerId ? [s.workerId] : [], urgent: false });
  return Response.json({ shift: s, candidates: ranked.slice(0, 12) });
}

/** Manual roster edits: { action: "assign", workerId } | { action: "unassign" } | { action: "release" } */
export async function POST(req: Request, ctx: RouteContext<"/api/shifts/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { action: "assign" | "unassign" | "release"; workerId?: string };
  const s = await db.query.shifts.findFirst({ where: eq(shifts.id, id) });
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  if (body.action === "release") {
    const { reportAbsence } = await import("@/agent/workflows/cover");
    return Response.json(await reportAbsence({ shiftId: id, type: "leave", reason: "Released by manager", by: "manager" }));
  }
  const draft = s.status === "draft" || s.status === "open";
  await db
    .update(shifts)
    .set(body.action === "assign" ? { workerId: body.workerId!, status: draft ? "draft" : "assigned", source: "manual" } : { workerId: null, status: "open", source: "manual" })
    .where(eq(shifts.id, id));
  await audit(s.orgId, {
    kind: "decision",
    actor: "manager",
    title: `Manager ${body.action === "assign" ? "assigned" : "cleared"} ${s.label} on ${s.date}`,
    detail: { shiftId: id, workerId: body.workerId },
  });
  await emit(s.orgId, "shift.updated", { shiftId: id });
  return Response.json({ ok: true });
}
