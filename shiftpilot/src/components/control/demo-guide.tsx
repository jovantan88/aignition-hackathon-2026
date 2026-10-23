"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Clapperboard, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";
import type { OpsData } from "./hooks";

type Step = {
  title: string;
  proves: string;
  say: string;
  cta: string;
  href?: string;
  external?: boolean;
  approvals?: boolean;
  status?: { label: string; tone: "ok" | "signal" | "info" } | null;
};

/** The six beats of the challenge's suggested demonstration flow, mapped onto this app */
function stepsFor(ops: OpsData | undefined): Step[] {
  const cycle = ops?.cycle;
  const waiting = (ops?.approvals.length ?? 0) > 0;
  return [
    {
      title: "Show the frustration",
      proves: "Who has the problem",
      say: "A café manager loses hours every week to group chats and Excel: asking, chasing, building and sending rosters, then phoning around for every sick call. The Impact page puts a number on it.",
      cta: "Open the before and after",
      href: "/impact#before-after",
    },
    {
      title: "Give the agent a goal",
      proves: "Goal-driven",
      say: "Type next week’s goal in plain English. It includes a promo and a closure, so the agent has to plan, not just answer.",
      cta: "Go to Home",
      href: "/",
      status: cycle ? { label: "Goal given", tone: "ok" } : null,
    },
    {
      title: "Show the plan and the action",
      proves: "Plans the work · Uses tools · Keeps context",
      say: "The plan is visible step by step. On the stage, phones receive the availability form and replies are read in Singlish, 中文, Melayu or voice notes.",
      cta: cycle?.runId ? "Open the live plan" : "Open the agent page",
      href: cycle?.runId ? `/agent/${cycle.runId}` : "/agent",
      status: cycle ? { label: "Plan running", tone: "info" } : null,
    },
    {
      title: "Introduce a surprise",
      proves: "Handles change",
      say: "On the stage, hit Sick call, or Break the LLM. The agent finds cover in waves, or recovers with a holding reply and a retry. Both are in the audit trail.",
      cta: "Open the stage",
      href: "/stage",
      external: true,
      status: (ops?.covers.length ?? 0) > 0 ? { label: "Cover search live", tone: "info" } : null,
    },
    {
      title: "Hit an approval gate",
      proves: "Requests approval",
      say: "The agent stops before messaging the team and before publishing. Show what it is asking and why, then approve.",
      cta: waiting ? "Review the approval" : "Open approvals",
      approvals: true,
      status: waiting ? { label: "Waiting for you", tone: "signal" } : null,
    },
    {
      title: "Prove the outcome",
      proves: "Audit trail · Proves value",
      say: "Hours handed back, steps removed, errors recovered, parse accuracy. Export the run’s audit trail as evidence.",
      cta: "Open Impact",
      href: "/impact",
    },
  ];
}

export function DemoGuide({ open, onOpenChange, ops, onOpenApprovals }: { open: boolean; onOpenChange: (open: boolean) => void; ops: OpsData | undefined; onOpenApprovals: () => void }) {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const steps = stepsFor(ops);
  const reset = async () => {
    if (!confirm("Reset all demo data? This wipes every chat, run and roster change and reseeds both businesses.")) return;
    setResetting(true);
    try {
      await api("/api/demo/reset", { method: "POST" });
      toast("Demo data reset", { description: "Fresh week, clock back to now." });
      await qc.invalidateQueries();
    } finally {
      setResetting(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="manager-theme w-full gap-0 border-l border-rule bg-paper p-0 shadow-sm sm:max-w-[520px]">
        <div className="guide-head">
          <div className="guide-badge">
            <Clapperboard className="size-5" aria-hidden />
          </div>
          <div className="eyebrow">Recording guide</div>
          <SheetTitle className="guide-title">Run of show</SheetTitle>
          <p className="guide-lede">Six beats, in the order the challenge asks judges to see them. Each one says what to show and where to go.</p>
        </div>
        <div className="guide-body">
          <section className="guide-prep" aria-label="Before you record">
            <h3 className="guide-sub">Before you hit record</h3>
            <ul>
              <li>
                <strong>Start clean.</strong> Reset the demo for a fresh week and an empty activity feed.
                <button type="button" className="btn btn-sm guide-reset" onClick={reset} disabled={resetting}>
                  <RotateCcw className="size-4" aria-hidden /> {resetting ? "Resetting…" : "Reset demo data"}
                </button>
              </li>
              <li>
                <strong>Open the stage in a second window.</strong> It has the phones and the surprise buttons.
                <Link href="/stage" target="_blank" className="btn btn-sm guide-reset">
                  Open stage <ArrowUpRight className="size-4" aria-hidden />
                </Link>
              </li>
              <li>
                <strong>Smooth, clean capture.</strong> Use a 1920×1080 window at 100% zoom. Visit each page once first, or run <code>npm run build</code> then <code>npm start</code>, so nothing compiles on camera.
              </li>
            </ul>
          </section>
          <ol className="guide-steps">
            {steps.map((s, i) => (
              <li key={s.title} className="guide-step">
                <div className="guide-step-top">
                  <span className="guide-num">{i + 1}</span>
                  <h3 className="guide-step-title">{s.title}</h3>
                  {s.status && <span className={cn("chip", s.status.tone === "ok" && "chip-ok", s.status.tone === "signal" && "chip-signal", s.status.tone === "info" && "chip-info")}>{s.status.label}</span>}
                </div>
                <div className="guide-proves">{s.proves}</div>
                <p className="guide-say">{s.say}</p>
                {s.approvals ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenApprovals();
                    }}
                  >
                    {s.cta}
                  </button>
                ) : (
                  <Link href={s.href ?? "/"} target={s.external ? "_blank" : undefined} onClick={() => !s.external && onOpenChange(false)} className="btn btn-sm">
                    {s.cta}
                    {s.external && <ArrowUpRight className="size-4" aria-hidden />}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </div>
      </SheetContent>
    </Sheet>
  );
}
