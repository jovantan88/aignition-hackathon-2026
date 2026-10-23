/**
 * Virtual demo clock. now() = real time + per-org offset, so time keeps flowing
 * normally and the presenter can jump ahead to trigger reminders and deadlines.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { simClock } from "@/db/schema";

const cache = new Map<string, { offset: number; at: number }>();

export async function clockOffset(orgId: string) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 1500) return hit.offset;
  const row = await db.query.simClock.findFirst({ where: eq(simClock.orgId, orgId) });
  const offset = row?.offsetMs ?? 0;
  cache.set(orgId, { offset, at: Date.now() });
  return offset;
}

export async function now(orgId: string) {
  return new Date(Date.now() + (await clockOffset(orgId)));
}

export async function advanceClock(orgId: string, ms: number) {
  const current = await clockOffset(orgId);
  const offsetMs = Math.max(0, current + ms);
  await db
    .insert(simClock)
    .values({ orgId, offsetMs })
    .onConflictDoUpdate({ target: simClock.orgId, set: { offsetMs, updatedAt: new Date() } });
  cache.set(orgId, { offset: offsetMs, at: Date.now() });
  return new Date(Date.now() + offsetMs);
}

/** Jump so the virtual clock reads `target` */
export async function setClockTo(orgId: string, target: Date) {
  const offsetMs = Math.max(0, target.getTime() - Date.now());
  await db
    .insert(simClock)
    .values({ orgId, offsetMs })
    .onConflictDoUpdate({ target: simClock.orgId, set: { offsetMs, updatedAt: new Date() } });
  cache.set(orgId, { offset: offsetMs, at: Date.now() });
  return new Date(Date.now() + offsetMs);
}

export function invalidateClock(orgId?: string) {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}
