/**
 * Jobs scheduled on the virtual clock: reminders, offer timeouts, persona
 * replies, deadlines. tick() claims due jobs atomically and runs them.
 */
import { and, eq, inArray, like, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, orgs, type Job } from "@/db/schema";
import { now } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { audit } from "./runs";

export async function schedule(orgId: string, kind: string, runAt: Date, payload: Record<string, unknown>, dedupeKey?: string) {
  const id = newId("job");
  await db
    .insert(jobs)
    .values({ id, orgId, kind, runAt, payload, status: "pending", dedupeKey: dedupeKey ?? null })
    .onConflictDoNothing({ target: jobs.dedupeKey });
  return id;
}

/** Cancel pending jobs whose dedupe key starts with a prefix */
export async function cancelJobs(prefix: string) {
  await db
    .update(jobs)
    .set({ status: "cancelled" })
    .where(and(eq(jobs.status, "pending"), like(jobs.dedupeKey, `${prefix}%`)));
}

const ticking = new Set<string>();

export async function tick(orgId?: string): Promise<number> {
  const orgIds = orgId ? [orgId] : (await db.select({ id: orgs.id }).from(orgs)).map((o) => o.id);
  let ran = 0;
  for (const id of orgIds) {
    if (ticking.has(id)) continue;
    ticking.add(id);
    try {
      ran += await tickOrg(id);
    } finally {
      ticking.delete(id);
    }
  }
  return ran;
}

const lastEnsure = new Map<string, number>();

async function tickOrg(orgId: string) {
  if (Date.now() - (lastEnsure.get(orgId) ?? 0) > 30_000) {
    lastEnsure.set(orgId, Date.now());
    const { ensureShiftJobs } = await import("./workflows/checkin");
    await ensureShiftJobs(orgId).catch((e) => console.error("[jobs] ensureShiftJobs", e));
  }
  const t = await now(orgId);
  const claimed = (await db.execute(sql`
    update ${jobs} set status = 'running', attempts = attempts + 1
    where id in (
      select id from ${jobs}
      where org_id = ${orgId} and status = 'pending' and run_at <= ${t.toISOString()}
      order by run_at asc limit 30
      for update skip locked
    )
    returning id`)) as unknown as { rows: { id: string }[] };
  const ids = claimed.rows.map((r) => r.id);
  if (!ids.length) return 0;
  const rows = (await db.select().from(jobs).where(inArray(jobs.id, ids))).sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
  const { handlers } = await import("./job-handlers");
  const run = async (job: Job) => {
    const fn = handlers[job.kind];
    try {
      if (!fn) throw new Error(`no handler for ${job.kind}`);
      await fn(job);
      await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, job.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[job] ${job.kind} failed`, e);
      const retry = job.attempts < 3;
      await db
        .update(jobs)
        .set({ status: retry ? "pending" : "failed", lastError: msg, runAt: new Date(t.getTime() + 60_000 * job.attempts) })
        .where(eq(jobs.id, job.id));
      await audit(orgId, { kind: retry ? "recovery" : "error", title: retry ? `Retrying ${job.kind} after an error` : `Gave up on ${job.kind}`, detail: { error: msg, jobId: job.id } });
    }
  };

  // Strict time order; consecutive persona replies run side by side
  let batch: Job[] = [];
  const flush = async () => {
    for (let i = 0; i < batch.length; i += 4) await Promise.all(batch.slice(i, i + 4).map(run));
    batch = [];
  };
  for (const j of rows) {
    if (j.kind.startsWith("persona.")) batch.push(j);
    else {
      await flush();
      await run(j);
    }
  }
  await flush();
  return rows.length;
}

export async function pendingJobs(orgId: string, kindPrefix?: string) {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), eq(jobs.status, "pending"), kindPrefix ? like(jobs.kind, `${kindPrefix}%`) : sql`true`, lte(jobs.runAt, new Date(8640000000000000))));
}
