"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clock3, FastForward, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useClock } from "@/components/wa/phone";
import { api } from "@/lib/live";
import { SplitFlap } from "./split-flap";

const JUMPS: { label: string; body: Record<string, unknown> }[] = [
  { label: "+15 min", body: { action: "advance", minutes: 15 } },
  { label: "+1 hour", body: { action: "advance", minutes: 60 } },
  { label: "+12 hours", body: { action: "advance", minutes: 720 } },
  { label: "+1 day", body: { action: "advance", minutes: 1440 } },
  { label: "Next 07:00", body: { action: "next", dow: -1, time: "07:00" } },
  { label: "Sat 07:30", body: { action: "next", dow: 5, time: "07:30" } },
  { label: "Sun 18:00", body: { action: "next", dow: 6, time: "18:00" } },
  { label: "Mon 09:00", body: { action: "next", dow: 0, time: "09:00" } },
];

export function DemoClock({ orgId, appearance }: { orgId?: string; appearance?: "workspace" }) {
  const { data } = useClock(orgId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const jump = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const b = { ...body };
      if (b.dow === -1) {
        const local = data?.local;
        b.dow = local ? (local.minutes < 7 * 60 ? local.dow : (local.dow + 1) % 7) : 0;
      }
      const r = await api<{ label: string }>(`/api/clock?org=${orgId}`, { json: b });
      toast(`Clock → ${r.label}`, { description: "Anything due (reminders, timeouts, replies) runs now." });
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };
  const label = data?.label ?? "WK -- · --- --:--";
  const [wk, rest] = label.split(" · ");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button type="button" className={cn("group flex items-center gap-2 hover:bg-panel", appearance === "workspace" ? "min-h-[28px] rounded-md border border-rule bg-card px-2.5 shadow-xs" : "px-2 py-1")} title="Demo clock: jump ahead in time">
            {appearance === "workspace" ? (
              <>
                <Clock3 className="size-[15px] text-ink-soft" />
                <span className="num text-[13px] font-medium text-ink">{wk?.replace("WK ", "Week ")} · {rest}</span>
              </>
            ) : (
              <>
                <span className="label-mono hidden text-ink xl:inline">{wk}</span>
                <SplitFlap text={rest ?? ""} className="text-[13px]" />
              </>
            )}
            {data && data.offsetMs > 60_000 && <FastForward className="size-4 text-signal" aria-label="Clock is ahead of real time" />}
          </button>
        }
      />
      <PopoverContent align="end" className={cn("w-72 border bg-card p-0 ring-0", appearance === "workspace" ? "manager-theme overflow-hidden rounded-lg border-rule shadow-[var(--shadow-pop)]" : "rounded-none border-ink shadow-none")}>
        <div className="border-b border-rule px-3.5 py-2.5">
          <div className="text-[13.5px] font-semibold text-ink">Demo clock</div>
          <div className="mt-0.5 text-[12.5px] leading-snug text-ink-soft">Time keeps running. Jump ahead to trigger reminders, deadlines and offer timeouts.</div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-rule">
          {JUMPS.map((j) => (
            <button key={j.label} type="button" disabled={busy} onClick={() => jump(j.body)} className="bg-card px-3.5 py-2.5 text-left text-[13px] font-medium hover:bg-panel disabled:opacity-50">
              {j.label}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => jump({ action: "reset" })} className="flex w-full items-center gap-2 border-t border-rule px-3.5 py-2.5 text-[13px] font-medium text-ink-soft hover:bg-panel hover:text-ink">
          <RotateCcw className="size-4" /> Back to real time
        </button>
      </PopoverContent>
    </Popover>
  );
}
