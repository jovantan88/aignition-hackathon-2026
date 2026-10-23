"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, Check, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";
import type { ApprovalRow } from "./hooks";

/** What each approval gate means in plain words, so the manager knows what saying yes will cause */
const KIND: Record<string, { label: string; effect: string }> = {
  broadcast: { label: "Send messages", effect: "ShiftPilot will message people on WhatsApp." },
  publish_roster: { label: "Publish roster", effect: "Everyone will see their shifts." },
  escalation: { label: "Decision needed", effect: "Overtime, a bonus or running short is your call." },
  cover: { label: "Offer cover", effect: "ShiftPilot will ask people to take the shift." },
  swap: { label: "Approve swap", effect: "Two people's shifts will change." },
};

const RISK: Record<string, { label: string; cls: string }> = {
  low: { label: "Low risk", cls: "chip-ok" },
  medium: { label: "Medium risk", cls: "chip-warn" },
  high: { label: "High risk", cls: "chip-signal" },
};

export function ApprovalCard({ a, compact }: { a: ApprovalRow; compact?: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (decision: "approved" | "rejected", optionId?: string) => {
    setBusy(optionId ?? decision);
    try {
      const r = await api<{ ok: boolean; error?: string }>(`/api/approvals/${a.id}`, { json: { decision, optionId } });
      if (!r.ok) toast.error(r.error ?? "Couldn't decide");
      else toast.success(decision === "approved" ? "Approved. ShiftPilot is on it." : "Rejected. Nothing will be sent.");
      await qc.invalidateQueries({ queryKey: ["approvals"] });
      await qc.invalidateQueries({ queryKey: ["ops"] });
    } finally {
      setBusy(null);
    }
  };
  const pending = a.status === "pending";
  const kind = KIND[a.kind] ?? { label: a.kind.replace(/_/g, " "), effect: "" };
  const risk = RISK[a.risk] ?? RISK.medium;
  return (
    <article className={cn("approval", pending ? "is-pending" : "is-decided", compact && "is-compact")} aria-label={`Approval: ${a.title}`}>
      <header className="approval-head">
        <span className="approval-kind">
          <ShieldAlert className="size-4" aria-hidden />
          {pending ? "Needs your approval" : kind.label}
        </span>
        <span className={cn("chip", risk.cls)}>{risk.label}</span>
      </header>
      <div className="approval-body">
        <div className="approval-eyebrow">{kind.label}</div>
        <h3 className="approval-title">{a.title}</h3>
        <p className="approval-summary">{a.summary}</p>
        <div className="approval-policy">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>
            <strong>Why you&apos;re being asked:</strong> {a.policyReason.replace(/\.$/, "")}.
            {pending && kind.effect && <> {kind.effect}</>}
          </span>
        </div>
        {pending &&
          (a.options?.length ? (
            <div className="approval-options">
              {a.options.map((o) => (
                <button key={o.id} type="button" disabled={!!busy} onClick={() => decide("approved", o.id)} className="approval-option">
                  <span className="approval-option-check">
                    <Check className="size-3.5" aria-hidden />
                  </span>
                  <span>
                    <span className="approval-option-label">{busy === o.id ? "Working…" : o.label}</span>
                    <span className="approval-option-detail">{o.detail}</span>
                  </span>
                </button>
              ))}
              <button type="button" disabled={!!busy} onClick={() => decide("rejected")} className="btn btn-quiet btn-sm btn-block">
                None of these. I&apos;ll handle it
              </button>
            </div>
          ) : (
            <div className="approval-actions">
              <button type="button" disabled={!!busy} onClick={() => decide("approved")} className="btn btn-primary">
                <Check className="size-4" aria-hidden /> {busy === "approved" ? "Approving…" : "Approve"}
              </button>
              <button type="button" disabled={!!busy} onClick={() => decide("rejected")} className="btn">
                <X className="size-4" aria-hidden /> {busy === "rejected" ? "Rejecting…" : "Reject"}
              </button>
            </div>
          ))}
        {!pending && (
          <div className="approval-result">
            <span className={cn("chip", a.status === "approved" ? "chip-ok" : "chip-warn")}>{a.status.replace(/_/g, " ")}</span>
            {a.channel && <span>via {a.channel}</span>}
          </div>
        )}
        {a.runId && (
          <Link href={`/agent/${a.runId}`} className="approval-link">
            See the plan behind this <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </article>
  );
}
