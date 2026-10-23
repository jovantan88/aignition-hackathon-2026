"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";
import type { OpsData } from "./hooks";
import { PlanStepper, type Step } from "./plan";

const PHASES = [
  { key: "draft", label: "Goal" },
  { key: "collecting", label: "Collect" },
  { key: "solving", label: "Solve" },
  { key: "negotiating", label: "Negotiate" },
  { key: "awaiting_approval", label: "Approve" },
  { key: "published", label: "Publish" },
];

/** Example goals are built from the active business, so they never mention an outlet that isn't there */
function examples(data: OpsData) {
  const names = data.outlets.map((o) => o.name.split(" ")[0]);
  if (names.length < 3) {
    return [
      { label: "Promo and a closure", goal: "Plan next week. We have a Saturday promo so we need 2 extra on the afternoon. We are closed Monday for renovation." },
      { label: "Busy Friday", goal: "Plan next week. We expect a busy Friday, so add 1 extra person on every shift." },
      { label: "Just plan it", goal: "Plan next week." },
    ];
  }
  const [, promo, closed] = names;
  return [
    { label: "Promo and a closure", goal: `Plan next week for all outlets. ${promo} has a Saturday promo so we need 2 extra on the afternoon. ${closed} is closed Monday for renovation.` },
    { label: "Busy Friday", goal: `Plan next week for all outlets. ${names[0]} expects a busy Friday, so add 1 extra person on every shift there.` },
    { label: "Just plan it", goal: "Plan next week for all outlets." },
  ];
}

export function MissionCard({ data }: { data: OpsData }) {
  const c = data.cycle;
  return c ? <Tracker data={data} /> : <GoalForm data={data} />;
}

function GoalForm({ data }: { data: OpsData }) {
  const qc = useQueryClient();
  const ex = useMemo(() => examples(data), [data]);
  const [goal, setGoal] = useState(ex[0].goal);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await api("/api/plan", { json: { goal } });
      toast("Planning started", { description: "ShiftPilot is reading your goal. It will ask before messaging anyone." });
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mission card" aria-labelledby="mission-title">
      <div className="mission-main">
        <div className="eyebrow">Give ShiftPilot a goal</div>
        <h2 id="mission-title" className="mission-title">
          What should we take off your plate this week?
        </h2>
        <label htmlFor="goal" className="sr-only">
          Your goal for next week
        </label>
        <textarea id="goal" className="field mission-input" rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} />
        <div className="mission-examples" role="group" aria-label="Example goals">
          <span>Try:</span>
          {ex.map((e) => (
            <button key={e.label} type="button" className="filter-chip" aria-pressed={goal === e.goal} onClick={() => setGoal(e.goal)}>
              {e.label}
            </button>
          ))}
        </div>
        <div className="mission-cta">
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || !goal.trim()} onClick={start}>
            {busy ? "Reading your goal…" : "Plan next week"} <ArrowRight className="size-4" aria-hidden />
          </button>
          <span className="mission-safe">
            <ShieldCheck className="size-4" aria-hidden /> Nothing is sent or published until you approve.
          </span>
        </div>
      </div>
      <aside className="mission-aside" aria-label="How it works">
        <div className="eyebrow">What happens next</div>
        <ol className="how-steps">
          <li>
            <span className="how-num">1</span>
            <span>
              <strong>It plans the week.</strong> Turns your goal into shifts for every outlet.
            </span>
          </li>
          <li>
            <span className="how-num">2</span>
            <span>
              <strong>It asks your team on WhatsApp.</strong> Reads replies in Singlish, 中文, Melayu and voice notes.
            </span>
          </li>
          <li>
            <span className="how-num">3</span>
            <span>
              <strong>It fills gaps and handles surprises.</strong> Sick calls, swaps, no-shows.
            </span>
          </li>
          <li>
            <span className="how-num is-gate">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            <span>
              <strong>You approve the big moves.</strong> Messaging the team, publishing, overtime.
            </span>
          </li>
        </ol>
      </aside>
    </section>
  );
}

function Tracker({ data }: { data: OpsData }) {
  const c = data.cycle!;
  const qc = useQueryClient();
  const { data: run } = useQuery({
    queryKey: ["run", c.runId],
    queryFn: () => api<{ run: { title: string; goal: string | null; plan: Step[] } }>(`/api/runs/${c.runId}`),
    enabled: !!c.runId,
  });
  const plan = run?.run.plan ?? [];
  const current = plan.find((s) => s.status === "waiting" || s.status === "running");
  const understood = plan[0]?.status === "done" ? plan[0].detail : undefined;
  // The plan knows it is paused before the approvals list refreshes, so trust either
  const waitingOnYou = data.approvals.length > 0 || plan.some((s) => s.status === "waiting");
  const idx = Math.max(0, PHASES.findIndex((s) => s.key === c.status));
  const pct = c.total ? c.replied / c.total : 0;
  const sentence = waitingOnYou
    ? "Paused. Waiting for your approval."
    : c.status === "draft"
      ? "Reading your goal and getting ready."
      : c.status === "collecting"
        ? `Collecting availability: ${c.replied} of ${c.total} have replied.`
        : c.status === "solving"
          ? "Building the roster from everyone's replies."
          : c.status === "negotiating"
            ? "Asking specific people to fill the last gaps."
            : c.status === "awaiting_approval"
              ? "The roster is ready."
              : "Working on it.";
  return (
    <section className="mission card" aria-labelledby="mission-title">
      <div className="mission-main">
        <div className="mission-top">
          <div className="eyebrow">Current mission · Week {c.week}</div>
          <span className={cn("chip", waitingOnYou ? "chip-signal" : "chip-ink")}>{waitingOnYou ? "Waiting for you" : "Working"}</span>
        </div>
        <h2 id="mission-title" className="mission-title">
          Week {c.week} roster
        </h2>
        <p className="mission-now" aria-live="polite">
          {sentence}
        </p>
        {run?.run.goal && <blockquote className="mission-goal">“{run.run.goal}”</blockquote>}
        {understood && (
          <div className="mission-understood">
            <Check className="size-4" aria-hidden />
            <span>
              <strong>Understood:</strong> {understood}
            </span>
          </div>
        )}
        <ol className="phases" aria-label="Progress">
          {PHASES.map((s, i) => (
            <li key={s.key} className={cn("phase", i < idx && "is-done", i === idx && "is-current")} aria-current={i === idx ? "step" : undefined}>
              <span className="phase-bar" />
              <span className="phase-label">{s.label}</span>
            </li>
          ))}
        </ol>
        {(c.status === "collecting" || c.status === "draft") && !waitingOnYou && (
          <div className="mission-progress">
            <div className="mission-progress-head">
              <span>Availability replies</span>
              <span className="num">
                {c.replied}/{c.total}
              </span>
            </div>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={c.total} aria-valuenow={c.replied} aria-label="Availability replies">
              <motion.div className="progress-fill" initial={false} animate={{ width: `${pct * 100}%` }} transition={{ type: "spring", damping: 20 }} />
            </div>
          </div>
        )}
        <div className="mission-cta">
          {waitingOnYou && (
            <a href="#needs-you" className="btn btn-signal">
              Review what I&apos;m approving <ArrowRight className="size-4" aria-hidden />
            </a>
          )}
          {c.status === "collecting" && !waitingOnYou && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await api(`/api/cycles/${c.id}`, { json: { action: "solve" } });
                toast("Solving now with the replies so far");
                await qc.invalidateQueries();
              }}
            >
              Stop waiting and solve now
            </button>
          )}
          {c.runId && (
            <Link href={`/agent/${c.runId}`} className="btn btn-quiet">
              Open plan and audit trail
            </Link>
          )}
        </div>
        {current && !waitingOnYou && (
          <p className="mission-step">
            <strong>Now:</strong> {current.title}
            {current.detail ? ` · ${current.detail}` : ""}
          </p>
        )}
      </div>
      <aside className="mission-aside" aria-label="The plan">
        <div className="eyebrow">The plan · {plan.length ? `${plan.filter((s) => s.status === "done").length} of ${plan.length} steps` : "loading"}</div>
        {plan.length > 0 ? <PlanStepper plan={plan} compact /> : <div className="mission-loading">Loading the plan…</div>}
      </aside>
    </section>
  );
}
