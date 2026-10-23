"use client";

import Link from "next/link";
import { firstName } from "@/lib/names";
import { motion } from "motion/react";
import { ArrowRight, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpsData, OpsOutlet } from "./hooks";

export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "signal" | "ok" | "warn" }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={cn("kpi-value", tone && `is-${tone}`)}>{value}</div>
    </div>
  );
}

const KIND_COLOR: Record<string, string> = {
  message_sent: "bg-info",
  message_received: "bg-ink-soft",
  tool_call: "bg-ink",
  tool_result: "bg-ink",
  decision: "bg-signal",
  approval_requested: "bg-warn",
  approval_decided: "bg-ok",
  error: "bg-destructive",
  recovery: "bg-ok",
  privacy_check: "bg-ok",
  memory: "bg-info",
  llm: "bg-ink",
  plan: "bg-signal",
  step: "bg-signal",
};

/** Audit titles sometimes carry a raw tool name ("escalate_to_manager · Ravi Kumar"). Say it like a person would. */
export function humanize(title: string) {
  return title.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (m) => {
    const s = m.replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
}

export function Ticker({ items, limit = 18 }: { items: OpsData["ticker"]; limit?: number }) {
  return (
    <ol className="activity-list">
      {items.slice(0, limit).map((e, i) => (
        <motion.li key={e.id} initial={i === 0 ? { opacity: 0, y: -6 } : false} animate={{ opacity: 1, y: 0 }} className="activity-item">
          <span className="activity-time num">{new Date(e.at).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" })}</span>
          <span className={cn("activity-dot", KIND_COLOR[e.kind] ?? "bg-ink-soft")} aria-hidden />
          <span className="activity-text">
            {e.runId ? (
              <Link href={`/agent/${e.runId}`} className="hover:underline">
                {humanize(e.title)}
              </Link>
            ) : (
              humanize(e.title)
            )}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

export function CoverList({ data, onSelect }: { data: OpsData; onSelect: (outletId: string) => void }) {
  if (!data.covers.length) return <div className="text-[14px] text-ink-soft">No active cover searches.</div>;
  const shiftById = new Map(data.outlets.flatMap((o) => o.today.map((s) => [s.id, { ...s, outlet: o }])));
  return (
    <div className="grid gap-3">
      {data.covers.map((c) => {
        const s = shiftById.get(c.shiftId);
        const type = c.type.replace(/_/g, " ");
        return (
          <div key={c.id} className="cover-card">
            <div className="cover-head">
              <span className="cover-title">
                <CircleDot className={cn("size-4", c.status === "escalated" ? "text-signal" : "animate-pulse text-warn")} aria-hidden />
                {type.charAt(0).toUpperCase() + type.slice(1)} · wave {c.wave}
              </span>
              <span className={cn("chip", c.status === "escalated" || c.urgency === "urgent" ? "chip-signal" : "chip-warn")}>{c.status}</span>
            </div>
            {s && (
              <button type="button" onClick={() => onSelect(s.outlet.id)} className="cover-shift">
                {s.outlet.name} · {s.label}
              </button>
            )}
            {c.offers.length > 0 && (
              <div className="cover-offers" aria-label="Who has been asked">
                {c.offers.map((o) => (
                  <span key={o.id} className={cn("chip", o.status === "pending" && "chip-signal", o.status === "accepted" && "chip-ok", o.status === "declined" && "line-through")}>
                    {o.name ? firstName(o.name) : "Someone"}
                    {o.status === "pending" ? " · asked" : o.status === "accepted" ? " · yes ✓" : o.status === "declined" ? " · no" : o.status === "lost" ? " · too late" : o.status === "expired" ? " · no reply" : ""}
                  </span>
                ))}
              </div>
            )}
            {c.runId && (
              <Link href={`/agent/${c.runId}`} className="approval-link">
                Plan and audit trail <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal day timeline 06:00–23:00 */
export function DayTimeline({ outlet, nowIso }: { outlet: OpsOutlet; nowIso: string }) {
  const start = 6 * 60;
  const end = 23 * 60;
  const span = end - start;
  const mins = (iso: string) => {
    const d = new Date(iso);
    const p = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).split(":").map(Number);
    return p[0] * 60 + p[1];
  };
  const nowM = mins(nowIso);
  return (
    <div className="relative">
      <div className="flex justify-between text-[12.5px] text-ink-soft">
        {[6, 9, 12, 15, 18, 21].map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}:00</span>
        ))}
      </div>
      <div className="relative mt-2 space-y-1.5">
        {outlet.today.map((s) => {
          const a = Math.max(0, mins(s.startsAt) - start);
          const b = Math.min(span, mins(s.endsAt) - start);
          const open = !s.worker && s.status !== "covered";
          return (
            <div key={s.id} className="relative h-9">
              <div
                className={cn("absolute inset-y-0 flex items-center gap-1.5 overflow-hidden rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap", open ? "border border-dashed border-signal bg-signal-soft text-signal" : s.onNow ? "bg-ink text-paper" : "bg-panel text-ink")}
                style={{ left: `${(a / span) * 100}%`, width: `${((b - a) / span) * 100}%` }}
              >
                {s.checkedIn && <span className="size-2 rounded-full bg-ok" title="Checked in" />}
                <span className="truncate">{open ? `Open · ${s.label}` : `${firstName(s.worker ?? "")} · ${s.label}`}</span>
              </div>
            </div>
          );
        })}
        {nowM >= start && nowM <= end && <div className="absolute inset-y-0 w-0.5 bg-signal" style={{ left: `${((nowM - start) / span) * 100}%` }} />}
      </div>
    </div>
  );
}
