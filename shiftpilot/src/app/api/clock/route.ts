import { after } from "next/server";
import { advanceClock, clockOffset, now, setClockTo } from "@/lib/clock";
import { emit } from "@/lib/events";
import { activeOrgId } from "@/lib/org";
import { DOW_SHORT, atLocal, addDays, isoWeek, localParts } from "@/lib/time";
import { tick } from "@/agent/jobs";
import { audit } from "@/agent/runs";

async function info(orgId: string) {
  const t = await now(orgId);
  const local = localParts(t);
  return {
    now: t.toISOString(),
    offsetMs: await clockOffset(orgId),
    local,
    week: isoWeek(local.date),
    label: `WK ${isoWeek(local.date)} · ${DOW_SHORT[local.dow].toUpperCase()} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
  };
}

export async function GET(req: Request) {
  return Response.json(await info(await activeOrgId(req)));
}

/**
 * Demo time controls.
 * { action: "advance", minutes } | { action: "next", dow, time } (next occurrence) | { action: "reset" }
 */
export async function POST(req: Request) {
  const orgId = await activeOrgId(req);
  const body = (await req.json()) as { action: "advance" | "next" | "reset" | "set"; minutes?: number; dow?: number; time?: string; iso?: string };
  const before = await now(orgId);
  if (body.action === "advance") await advanceClock(orgId, (body.minutes ?? 60) * 60_000);
  if (body.action === "reset") await setClockTo(orgId, new Date());
  if (body.action === "set" && body.iso) await setClockTo(orgId, new Date(body.iso));
  if (body.action === "next" && body.dow != null) {
    const local = localParts(before);
    let days = (body.dow - local.dow + 7) % 7;
    const target0 = atLocal(addDays(local.date, days), body.time ?? "09:00");
    if (target0.getTime() <= before.getTime()) days += 7;
    await setClockTo(orgId, atLocal(addDays(local.date, days), body.time ?? "09:00"));
  }
  const after_ = await now(orgId);
  await audit(orgId, {
    kind: "decision",
    actor: "manager",
    title: `Demo clock moved ${Math.round((after_.getTime() - before.getTime()) / 60000)} min forward`,
    detail: { from: before.toISOString(), to: after_.toISOString() },
  });
  await emit(orgId, "clock.changed", { now: after_.toISOString() });
  // Anything that came due runs right away
  after(() => tick(orgId).catch((e) => console.error("[tick]", e)));
  return Response.json(await info(orgId));
}
