"use client";

import { motion } from "motion/react";
import { Check, Pause, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = { id: string; title: string; status: string; detail?: string; startedAt?: string; endedAt?: string };

const stamp = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-SG", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }) : "");

/** A plan step that stops for a person is a gate: the agent never crosses it on its own */
export const isGate = (title: string) => /approval/i.test(title);

export function StepIcon({ status }: { status: string }) {
  if (status === "done")
    return (
      <span className="step-icon is-done" role="img" aria-label="Done">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  if (status === "running")
    return (
      <span className="step-icon is-running" role="img" aria-label="In progress">
        <span className="step-pulse" />
        <span className="size-2 rounded-full bg-white" />
      </span>
    );
  if (status === "waiting")
    return (
      <span className="step-icon is-waiting" role="img" aria-label="Waiting for you">
        <Pause className="size-3" fill="currentColor" />
      </span>
    );
  if (status === "blocked" || status === "failed")
    return (
      <span className="step-icon is-blocked" role="img" aria-label="Blocked">
        <X className="size-3.5" strokeWidth={3} />
      </span>
    );
  return <span className="step-icon is-pending" role="img" aria-label="Not started" />;
}

export function PlanStepper({ plan, compact }: { plan: Step[]; compact?: boolean }) {
  return (
    <ol className={cn("plan", compact && "is-compact")}>
      {plan.map((s, i) => (
        <motion.li key={s.id} layout className={cn("plan-step", `is-${s.status}`)}>
          {i < plan.length - 1 && <span className={cn("plan-line", s.status === "done" && "is-done")} aria-hidden />}
          <span className="plan-icon">
            <StepIcon status={s.status} />
          </span>
          <div className="plan-text">
            <div className="plan-title">
              <span className="plan-num num">{String(i + 1).padStart(2, "0")}</span>
              <span>{s.title}</span>
              {isGate(s.title) && (
                <span className="chip chip-signal plan-gate">
                  <ShieldCheck className="size-3.5" aria-hidden /> You decide
                </span>
              )}
            </div>
            {s.detail && <div className={cn("plan-detail", (s.status === "blocked" || s.status === "waiting") && "is-alert")}>{s.detail}</div>}
            {!compact && (s.startedAt || s.endedAt) && <div className="plan-time">{stamp(s.endedAt ?? s.startedAt)}</div>}
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
