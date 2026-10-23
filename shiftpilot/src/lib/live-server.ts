/**
 * One poller per server process tails the `events` table and fans rows out to
 * every open SSE connection, so N browser tabs cost one query per tick.
 */
import { asc, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";

export type LiveEvent = { id: number; orgId: string; topic: string; payload: Record<string, unknown> };
type Listener = (e: LiveEvent) => void;

type Hub = { listeners: Set<Listener>; cursor: number; running: boolean };

const g = globalThis as unknown as { __spLiveHub?: Hub };
const hub: Hub = g.__spLiveHub ?? { listeners: new Set(), cursor: -1, running: false };
g.__spLiveHub = hub;

export async function latestEventId() {
  const r = await db.select({ max: sql<number>`coalesce(max(${events.id}), 0)` }).from(events);
  return Number(r[0]?.max ?? 0);
}

function broadcast(event: LiveEvent) {
  for (const listener of hub.listeners) {
    try {
      listener(event);
    } catch {
      // One broken connection must not stop the stream for everyone else.
      hub.listeners.delete(listener);
    }
  }
}

async function recoverCursor() {
  const cursor = hub.cursor;
  const latest = await latestEventId();
  if (latest < cursor && hub.cursor === cursor) {
    hub.cursor = latest;
    broadcast({ id: latest, orgId: "*", topic: "demo.reset", payload: {} });
  }
}

async function loop() {
  if (hub.running) return;
  hub.running = true;
  try {
    if (hub.cursor < 0) hub.cursor = await latestEventId();
    let checkedCursorAt = 0;
    while (hub.listeners.size > 0) {
      let rows: LiveEvent[] = [];
      try {
        rows = (await db.select().from(events).where(gt(events.id, hub.cursor)).orderBy(asc(events.id)).limit(500)) as LiveEvent[];
        // Recover open demos previously reset with RESTART IDENTITY. Otherwise
        // the hub can wait forever for IDs from the old database contents.
        if (!rows.length && Date.now() - checkedCursorAt > 5000) {
          checkedCursorAt = Date.now();
          await recoverCursor();
        }
      } catch (e) {
        console.error("[live] poll failed", e);
      }
      for (const r of rows) {
        hub.cursor = Math.max(hub.cursor, r.id);
        broadcast(r);
      }
      await new Promise((res) => setTimeout(res, rows.length ? 60 : 350));
    }
  } finally {
    hub.running = false;
  }
}

export function subscribe(l: Listener) {
  hub.listeners.add(l);
  // Also repair a shared hub retained across a development hot reload.
  void recoverCursor().then(loop).catch((error) => console.error("[live] connect failed", error));
  return () => hub.listeners.delete(l);
}

/** Events after `since` for one org (used to replay on reconnect) */
export async function eventsSince(since: number, orgId: string) {
  const rows = (await db
    .select()
    .from(events)
    .where(orgId === "all" ? gt(events.id, since) : sql`${events.id} > ${since} and (${events.orgId} = ${orgId} or ${events.orgId} = '*')`)
    .orderBy(asc(events.id))
    .limit(500)) as LiveEvent[];
  return rows;
}
