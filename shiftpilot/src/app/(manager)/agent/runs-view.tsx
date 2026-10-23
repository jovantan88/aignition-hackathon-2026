"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Download } from "lucide-react";
import { ApprovalCard } from "@/components/control/approvals";
import type { ApprovalRow } from "@/components/control/hooks";
import { PlanStepper, type Step } from "@/components/control/plan";
import { humanize } from "@/components/control/widgets";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";

type Run = { id: string; kind: string; title: string; goal: string | null; status: string; plan: Step[]; summary: string | null; metrics: Record<string, number>; startedAt: string; finishedAt: string | null };
type Ev = { id: string; kind: string; actor: string; title: string; detail: Record<string, unknown> | null; latencyMs: number | null; tokens: number | null; manualMinutes: number; createdAt: string };

const t = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-SG", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }) : "");

const STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: "Running", cls: "chip-signal" },
  waiting: { label: "Waiting for you", cls: "chip-warn" },
  done: { label: "Done", cls: "chip-ok" },
  failed: { label: "Failed", cls: "chip-danger" },
};

const RUN_KIND: Record<string, string> = { weekly: "Weekly roster", cover: "Cover search", swap: "Shift swap" };
const runKind = (k: string) => RUN_KIND[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

const KIND_LABEL: Record<string, { label: string; cls?: string }> = {
  plan: { label: "Plan" },
  step: { label: "Step" },
  tool_call: { label: "Tool call" },
  tool_result: { label: "Result" },
  decision: { label: "Decision" },
  message_sent: { label: "Sent", cls: "chip-info" },
  message_received: { label: "Received", cls: "chip-info" },
  approval_requested: { label: "Asked you", cls: "chip-signal" },
  approval_decided: { label: "You decided", cls: "chip-signal" },
  error: { label: "Error", cls: "chip-danger" },
  recovery: { label: "Recovered", cls: "chip-ok" },
  privacy_check: { label: "Privacy check", cls: "chip-ok" },
  memory: { label: "Memory" },
  llm: { label: "AI call" },
};

type Filter = "all" | "work" | "messages" | "approvals" | "problems" | "privacy";
const FILTERS: { id: Filter; label: string; match: (kind: string) => boolean }[] = [
  { id: "all", label: "Everything", match: () => true },
  { id: "work", label: "Decisions and tools", match: (k) => ["plan", "step", "tool_call", "tool_result", "decision", "memory", "llm"].includes(k) },
  { id: "messages", label: "Messages", match: (k) => k === "message_sent" || k === "message_received" },
  { id: "approvals", label: "Approvals", match: (k) => k.startsWith("approval") },
  { id: "problems", label: "Errors and recovery", match: (k) => k === "error" || k === "recovery" },
  { id: "privacy", label: "Privacy checks", match: (k) => k === "privacy_check" },
];

function EventRow({ e }: { e: Ev }) {
  const [open, setOpen] = useState(false);
  const kind = KIND_LABEL[e.kind] ?? { label: e.kind };
  return (
    <li className="audit-item">
      <button type="button" onClick={() => e.detail && setOpen(!open)} className={cn("audit-row", !e.detail && "is-static")} aria-expanded={e.detail ? open : undefined}>
        <span className="audit-time num">{t(e.createdAt)}</span>
        <span className={cn("chip audit-kind", kind.cls)}>{kind.label}</span>
        <span className="audit-main">
          <span className="audit-title">{humanize(e.title)}</span>
          {!!(e.latencyMs || e.tokens || e.manualMinutes) && (
            <span className="audit-meta">
              {e.latencyMs ? <span>{(e.latencyMs / 1000).toFixed(1)}s</span> : null}
              {e.tokens ? <span>{e.tokens} tokens</span> : null}
              {e.manualMinutes ? <span className="text-ok">+{Math.round(e.manualMinutes)} min saved</span> : null}
            </span>
          )}
        </span>
        {e.detail && <ChevronRight className={cn("audit-chevron size-4", open && "is-open")} aria-hidden />}
      </button>
      {open && e.detail && <pre className="audit-raw">{JSON.stringify(e.detail, null, 2)}</pre>}
    </li>
  );
}

function RunDetail({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["run", id], queryFn: () => api<{ run: Run; events: Ev[]; approvals: ApprovalRow[] }>(`/api/runs/${id}`) });
  const [filter, setFilter] = useState<Filter>("all");
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, (data?.events ?? []).filter((e) => f.match(e.kind)).length])) as Record<Filter, number>, [data]);
  if (!data) return <div className="run-loading">Loading the plan and audit trail…</div>;
  const { run, events, approvals } = data;
  const saved = events.reduce((s, e) => s + e.manualMinutes, 0);
  const shown = events.filter((e) => FILTERS.find((f) => f.id === filter)!.match(e.kind));
  const st = STATUS[run.status] ?? { label: run.status, cls: "" };
  const exportMd = () => {
    const md = [
      `# ${run.title}`,
      ``,
      `Status: ${run.status} · Started ${t(run.startedAt)}${run.finishedAt ? ` · Finished ${t(run.finishedAt)}` : ""}`,
      run.goal ? `\n> ${run.goal}` : "",
      `\n## Plan`,
      ...run.plan.map((s, i) => `${i + 1}. [${s.status}] ${s.title}${s.detail ? ` — ${s.detail}` : ""}`),
      `\n## Approvals`,
      ...approvals.map((a) => `- ${a.title}: ${a.status}${a.channel ? ` (via ${a.channel})` : ""}`),
      `\n## Audit trail`,
      ...events.map((e) => `- ${t(e.createdAt)} · ${e.kind} · ${e.actor}: ${e.title}`),
      run.summary ? `\n## Outcome\n${run.summary}` : "",
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${run.id}.md`;
    a.click();
  };
  return (
    <div className="run-detail">
      <header className="run-head">
        <div className="min-w-0">
          <div className="run-meta">
            <span className="eyebrow">{runKind(run.kind)}</span>
            <span className={cn("chip", st.cls)}>{st.label}</span>
          </div>
          <h2 className="run-title">{run.title}</h2>
          {run.goal && (
            <blockquote className="run-goal">
              <span className="eyebrow">The goal</span>
              <span>“{run.goal}”</span>
            </blockquote>
          )}
        </div>
        <button type="button" onClick={exportMd} className="btn">
          <Download className="size-4" aria-hidden /> Export audit trail
        </button>
      </header>

      {run.summary && (
        <div className="run-outcome">
          <span className="run-outcome-icon">
            <Check className="size-4" strokeWidth={3} aria-hidden />
          </span>
          <div>
            <div className="eyebrow">Outcome</div>
            <p>{run.summary}</p>
          </div>
        </div>
      )}

      <div className="stat-grid run-stats">
        <div className="stat">
          <div className="stat-label">Started</div>
          <div className="run-stat-value">{t(run.startedAt)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Finished</div>
          <div className="run-stat-value">{run.finishedAt ? t(run.finishedAt) : "Still running"}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Actions logged</div>
          <div className="run-stat-value">{events.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Manager time saved</div>
          <div className="run-stat-value is-ok">{Math.round(saved)} min</div>
        </div>
      </div>

      <div className="run-cols">
        <section aria-labelledby="plan-h">
          <h3 id="plan-h" className="run-h">
            The plan
          </h3>
          <PlanStepper plan={run.plan} />
          {approvals.length > 0 && (
            <div className="run-gates">
              <h3 className="run-h">Approval gates</h3>
              <div className="grid gap-3">
                {approvals.map((a) => (
                  <ApprovalCard key={a.id} a={a} />
                ))}
              </div>
            </div>
          )}
        </section>
        <section aria-labelledby="audit-h" className="min-w-0">
          <h3 id="audit-h" className="run-h">
            Audit trail
          </h3>
          <p className="run-h-sub">Every action ShiftPilot took. Select a row to see the raw data behind it.</p>
          <div className="audit-filters" role="group" aria-label="Filter the audit trail">
            {FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0).map((f) => (
              <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span className="audit-count">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <ol className="audit-list">
            {shown.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

export function RunsView({ runId }: { runId?: string }) {
  const { data } = useQuery({ queryKey: ["runs"], queryFn: () => api<{ runs: Run[] }>("/api/runs") });
  const runs = data?.runs ?? [];
  const sel = runId ?? runs[0]?.id;
  return (
    <div className="runs">
      <aside className="runs-list" aria-label="Agent runs">
        <div className="runs-list-head">
          <h1>Plans &amp; audit trail</h1>
          <p>Every goal ShiftPilot works on: its plan, each tool call, message and approval, and the outcome.</p>
        </div>
        <ul>
          {runs.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, cls: "" };
            const done = r.plan.filter((p) => p.status === "done").length;
            return (
              <li key={r.id}>
                <Link href={`/agent/${r.id}`} className={cn("run-item", sel === r.id && "is-selected")} aria-current={sel === r.id ? "page" : undefined}>
                  <div className="run-item-top">
                    <span className="run-item-kind">{runKind(r.kind)}</span>
                    <span className={cn("chip", st.cls)}>{st.label}</span>
                  </div>
                  <div className="run-item-title">{r.title}</div>
                  <div className="run-item-meta">
                    {t(r.startedAt)} · {done} of {r.plan.length} steps
                  </div>
                  <div className="progress-track is-thin" aria-hidden>
                    <div className={cn("progress-fill", r.status === "done" && "is-ok")} style={{ width: `${r.plan.length ? (done / r.plan.length) * 100 : 0}%` }} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="runs-detail">{sel ? <RunDetail id={sel} /> : <div className="run-loading">No runs yet. Give ShiftPilot a goal on Home.</div>}</section>
    </div>
  );
}
