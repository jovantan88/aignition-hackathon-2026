/**
 * Agent runs carry a visible plan (steps with live status) and an audit trail.
 * Everything the agent observes, decides and does is written here.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, auditEvents, type AgentRun, type AuditEvent, type PlanStep } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";

export async function startRun(opts: {
  orgId: string;
  kind: AgentRun["kind"];
  title: string;
  goal?: string;
  steps?: string[];
  subjectId?: string;
}) {
  const id = newId("run");
  const t = await now(opts.orgId);
  const plan: PlanStep[] = (opts.steps ?? []).map((title, i) => ({ id: `s${i + 1}`, title, status: "pending" }));
  await db.insert(agentRuns).values({
    id,
    orgId: opts.orgId,
    kind: opts.kind,
    title: opts.title,
    goal: opts.goal ?? null,
    status: "running",
    plan,
    subjectId: opts.subjectId ?? null,
    startedAt: t,
  });
  if (plan.length) await audit(opts.orgId, { runId: id, kind: "plan", title: `Plan: ${opts.title}`, detail: { steps: plan.map((p) => p.title) } });
  await emit(opts.orgId, "run.updated", { runId: id });
  return id;
}

export async function getRun(runId: string) {
  return db.query.agentRuns.findFirst({ where: eq(agentRuns.id, runId) });
}

/** Update one plan step by index (1-based) or id */
export async function setStep(runId: string, step: number | string, status: PlanStep["status"], detail?: string) {
  const run = await getRun(runId);
  if (!run) return;
  const t = (await now(run.orgId)).toISOString();
  const plan = run.plan.map((p, i) => {
    const match = typeof step === "number" ? i === step - 1 : p.id === step;
    if (!match) return p;
    return {
      ...p,
      status,
      detail: detail ?? p.detail,
      startedAt: p.startedAt ?? (status === "running" || status === "waiting" ? t : p.startedAt),
      endedAt: status === "done" || status === "failed" || status === "skipped" ? t : p.endedAt,
    };
  });
  await db.update(agentRuns).set({ plan }).where(eq(agentRuns.id, runId));
  await emit(run.orgId, "run.updated", { runId, step, status });
}

/** Mark every step before `step` done and `step` running */
export async function advanceTo(runId: string, step: number, detail?: string) {
  const run = await getRun(runId);
  if (!run) return;
  const t = (await now(run.orgId)).toISOString();
  const plan = run.plan.map((p, i): PlanStep => {
    if (i < step - 1 && p.status !== "done" && p.status !== "skipped") return { ...p, status: "done", endedAt: p.endedAt ?? t };
    if (i === step - 1) return { ...p, status: "running", detail: detail ?? p.detail, startedAt: p.startedAt ?? t };
    return p;
  });
  await db.update(agentRuns).set({ plan, status: "running" }).where(eq(agentRuns.id, runId));
  await emit(run.orgId, "run.updated", { runId, step });
}

export async function setRunStatus(runId: string, status: AgentRun["status"], summary?: string) {
  const run = await getRun(runId);
  if (!run) return;
  const done = status === "done" || status === "failed";
  await db
    .update(agentRuns)
    .set({ status, summary: summary ?? run.summary, finishedAt: done ? await now(run.orgId) : null })
    .where(eq(agentRuns.id, runId));
  await emit(run.orgId, "run.updated", { runId, status });
}

export async function finishRun(runId: string, summary: string, status: "done" | "failed" = "done") {
  const run = await getRun(runId);
  if (!run) return;
  const t = (await now(run.orgId)).toISOString();
  const plan = run.plan.map((p): PlanStep =>
    status === "done" && (p.status === "pending" || p.status === "running" || p.status === "waiting") ? { ...p, status: "done", endedAt: t } : p,
  );
  await db.update(agentRuns).set({ plan, status, summary, finishedAt: new Date(t) }).where(eq(agentRuns.id, runId));
  await emit(run.orgId, "run.updated", { runId, status });
}

export async function addRunMetric(runId: string, key: string, delta = 1) {
  await db
    .update(agentRuns)
    .set({ metrics: sql`jsonb_set(${agentRuns.metrics}, ${`{${key}}`}, to_jsonb(coalesce((${agentRuns.metrics}->>${key})::numeric, 0) + ${delta}))` })
    .where(eq(agentRuns.id, runId));
}

export async function audit(
  orgId: string,
  e: {
    runId?: string | null;
    kind: AuditEvent["kind"];
    title: string;
    actor?: AuditEvent["actor"];
    detail?: Record<string, unknown>;
    latencyMs?: number;
    tokens?: number;
    manualMinutes?: number;
  },
) {
  const id = newId("aud");
  await db.insert(auditEvents).values({
    id,
    orgId,
    runId: e.runId ?? null,
    kind: e.kind,
    actor: e.actor ?? "agent",
    title: e.title,
    detail: e.detail ?? null,
    latencyMs: e.latencyMs ?? null,
    tokens: e.tokens ?? null,
    manualMinutes: e.manualMinutes ?? 0,
    createdAt: await now(orgId),
  });
  await emit(orgId, "audit.created", { id, runId: e.runId ?? null, kind: e.kind, title: e.title });
  return id;
}
