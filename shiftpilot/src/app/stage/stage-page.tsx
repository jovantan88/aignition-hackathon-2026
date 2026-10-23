"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Zap } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand";
import { ApprovalCard } from "@/components/control/approvals";
import { DemoClock } from "@/components/control/demo-clock";
import { orgSlug, useOps } from "@/components/control/hooks";
import { PlanStepper, type Step } from "@/components/control/plan";
import { Ticker } from "@/components/control/widgets";
import { Phone } from "@/components/wa/phone";
import { api, useLiveConnected } from "@/lib/live";
import { cn } from "@/lib/utils";
import "./stage.css";

const OpsMap = dynamic(() => import("@/components/map/ops-map").then((m) => m.OpsMap), { ssr: false, loading: () => <div className="h-full animate-pulse bg-panel" /> });

const SCENARIOS = [
  { name: "kickoff_week", label: "Plan next week", hint: (n: number) => `Goal, approval, then ask ${n} people` },
  { name: "sick_call", label: "Sick call", hint: () => "Mei can't make her next shift" },
  { name: "mid_shift_emergency", label: "Leaves mid-shift", hint: () => "Family emergency, urgent cover" },
  { name: "running_late", label: "Running late", hint: () => "ETA to the lead, saved to memory" },
  { name: "timetable_change", label: "Timetable change", hint: () => "Recurring constraint and clashes" },
  { name: "swap_request", label: "Swap request", hint: () => "Aisha and Kavitha trade shifts" },
  { name: "no_show", label: "No-show", hint: () => "Missed check-in, urgent cover" },
  { name: "tool_failure", label: "Break the LLM", hint: () => "Next reply fails. Watch it recover" },
] as const;

type Run = { id: string; title: string; status: string; plan: Step[]; startedAt: string };

export function StagePage() {
  const { data } = useOps();
  const connected = useLiveConnected();
  const { data: team } = useQuery({ queryKey: ["team"], queryFn: () => api<{ workers: { id: string; name: string; autopilot: boolean }[] }>("/api/team") });
  const { data: runs } = useQuery({ queryKey: ["runs"], queryFn: () => api<{ runs: Run[] }>("/api/runs") });
  const [phones, setPhones] = useState<string[]>(["wkr_mei", "wkr_ravi", "mgr_kopilab"]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"plan" | "activity">("plan");
  const live = useMemo(() => (runs?.runs ?? []).find((r) => r.status === "running" || r.status === "waiting") ?? runs?.runs[0], [runs]);
  const options = useMemo(() => {
    const ws = [...(team?.workers ?? [])].sort((a, b) => Number(a.autopilot) - Number(b.autopilot) || a.name.localeCompare(b.name));
    return [{ id: `mgr_${orgSlug(data?.org.id)}`, name: `${data?.org.managerName ?? "Manager"} (manager)` }, ...ws.map((w) => ({ id: w.id, name: `${w.name}${w.autopilot ? "" : " ★"}` }))];
  }, [team, data]);

  // Keep the virtual-clock job queue moving while the stage is open
  useEffect(() => {
    const t = setInterval(() => void fetch("/api/agent/tick", { method: "POST" }).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  const fire = async (name: string) => {
    const r = await api<{ error?: string }>(`/api/scenarios/${name}`, { method: "POST", json: {} });
    if (r?.error) toast.error(r.error);
    else toast(`Scenario: ${SCENARIOS.find((s) => s.name === name)?.label}`, { description: "Injected through the real WhatsApp pipeline." });
  };

  return (
    <div className="stage">
      <header className="stage-bar">
        <Link href="/" className="stage-brand">
          <BrandMark size={22} />
          <span>ShiftPilot</span>
        </Link>
        <span className="stage-where">Presenter stage · {data?.org.name}</span>
        <div className="stage-bar-right">
          <DemoClock orgId={data?.org.id} appearance="workspace" />
          <span className={cn("stage-live", connected && "is-on")}>
            <i /> {connected ? "Live" : "Reconnecting…"}
          </span>
          <Link href="/" className="btn btn-sm">
            Dashboard <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      <section className="stage-director" aria-label="Inject a surprise">
        <div className="stage-director-title">
          <Zap className="size-4" aria-hidden /> Inject a surprise
        </div>
        <div className="stage-scenarios">
          {SCENARIOS.map((s) => (
            <button key={s.name} type="button" onClick={() => fire(s.name)} className="stage-scenario" title={s.hint(data?.kpis.team ?? 46)}>
              <span className="stage-scenario-label">{s.label}</span>
              <span className="stage-scenario-hint">{s.hint(data?.kpis.team ?? 46)}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="stage-main">
        <div className="stage-left">
          <div className="stage-map">
            {data && <OpsMap data={data} selected={selected} onSelect={setSelected} className="h-full" fit />}
            {data && data.approvals[0] && (
              <div className="stage-approval">
                <ApprovalCard a={data.approvals[0]} compact />
              </div>
            )}
          </div>
          <div className="stage-info">
            <div className="stage-tabs" role="group" aria-label="Show the plan or the agent activity">
              <button type="button" onClick={() => setTab("plan")} className="filter-chip" aria-pressed={tab === "plan"}>
                The plan
              </button>
              <button type="button" onClick={() => setTab("activity")} className="filter-chip" aria-pressed={tab === "activity"}>
                Agent activity
              </button>
            </div>
            <div className="stage-panels">
              <section className="stage-panel" data-active={tab === "plan"} aria-label="The plan">
                <h2 className="stage-panel-title">{live ? live.title : "The plan"}</h2>
                {live ? <PlanStepper plan={live.plan} compact /> : <p className="text-ink-soft">No plan yet. Hit “Plan next week”.</p>}
              </section>
              <section className="stage-panel" data-active={tab === "activity"} aria-label="Agent activity">
                <h2 className="stage-panel-title">Agent activity</h2>
                {data && <Ticker items={data.ticker} limit={14} />}
              </section>
            </div>
          </div>
        </div>
        <div className="stage-phones">
          {phones.map((id, i) => (
            <div key={i} className="stage-phone">
              <select value={id} onChange={(e) => setPhones((p) => p.map((x, j) => (j === i ? e.target.value : x)))} className="field field-sm" aria-label={`Phone ${i + 1}`}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <Phone phoneId={id} className="h-auto max-h-none min-h-0 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
