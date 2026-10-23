"use client";

import { useMemo, useState } from "react";
import { firstName } from "@/lib/names";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/wa/avatar";
import { api } from "@/lib/live";
import { DOW_SHORT, addDays, dowOf, fmtRange12 } from "@/lib/time";
import { cn } from "@/lib/utils";

type RShift = {
  id: string;
  outletId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  label: string;
  skill: string;
  status: string;
  workerId: string | null;
  workerName: string | null;
  hue: number | null;
  explanation: { score: number; reasons: string[]; alternatives?: { workerId: string; name: string; score: number }[] } | null;
  source: string;
  confirmedAt: string | null;
  checkedInAt: string | null;
};

type RosterData = {
  weekStart: string;
  week: number;
  cycle: { id: string; status: string; runId: string | null } | null;
  cycles: { weekStart: string; status: string }[];
  outlets: { id: string; code: string; name: string }[];
  shifts: RShift[];
  workers: { id: string; name: string; hue: number; skills: string[] }[];
};

type Candidate = { workerId: string; name: string; score: number; eligible: boolean; blockReason?: string; reasons: string[]; flags: { overtime: boolean; travelMin: number } };

const mins = (iso: string) => {
  const p = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).split(":").map(Number);
  return p[0] * 60 + p[1];
};

const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "UTC" });

const period = (start: number) => (start < 11 * 60 ? "morning" : start < 15 * 60 ? "midday" : "evening");

function ShiftChip({ s, onClick, active }: { s: RShift; onClick: () => void; active: boolean }) {
  const open = !s.workerId && s.status !== "covered";
  const cover = s.status === "cover_needed";
  const who = (s.workerName ? firstName(s.workerName) : null) ?? (cover ? "Finding cover" : s.status === "covered" ? "Lead covering" : "Open shift");
  const start = mins(s.startsAt);
  const time = fmtRange12(start, mins(s.endsAt) || 1440);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${who}, ${s.label}, ${time}`}
      title={s.label}
      className={cn("shift-chip", `is-${period(start)}`, active && "is-active", open && "is-open", cover && "is-cover", s.status === "draft" && "is-draft")}
    >
      <span className={cn("shift-chip-dot", open && "is-open")} aria-hidden />
      <span className="shift-chip-text">
        <span className="shift-chip-name">{who}</span>
        <span className="shift-chip-time">{time}</span>
      </span>
    </button>
  );
}

function ShiftPanel({ s, data, onClose }: { s: RShift; data: RosterData; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: cand } = useQuery({ queryKey: ["shifts", "candidates", s.id], queryFn: () => api<{ candidates: Candidate[] }>(`/api/shifts/${s.id}`) });
  const outlet = data.outlets.find((o) => o.id === s.outletId);
  const act = async (body: Record<string, unknown>, msg: string) => {
    await api(`/api/shifts/${s.id}`, { json: body });
    toast(msg);
    await qc.invalidateQueries({ queryKey: ["roster"] });
  };
  return (
    <aside className="shift-panel" aria-label="Shift details">
      <div className="shift-panel-head">
        <div>
          <div className="eyebrow">
            {outlet?.name} · {s.skill}
          </div>
          <h2 className="shift-panel-title">{s.label}</h2>
          <div className="shift-panel-when">
            {DOW_SHORT[dowOf(s.date)]} {shortDate(s.date)} · {fmtRange12(mins(s.startsAt), mins(s.endsAt) || 1440)}
          </div>
          <span className={cn("chip mt-2", s.status === "confirmed" && "chip-ok", s.status === "cover_needed" && "chip-signal")}>{s.status.replace(/_/g, " ")}</span>
        </div>
        <button type="button" onClick={onClose} className="icon-button" aria-label="Close shift details">
          <X className="size-5" />
        </button>
      </div>
      <div className="shift-panel-body">
        {s.workerId ? (
          <section>
            <h3 className="panel-sub">Assigned to</h3>
            <div className="flex items-center gap-3">
              <PersonAvatar name={s.workerName ?? ""} hue={s.hue ?? 20} size={32} />
              <div>
                <Link href={`/team/${s.workerId}`} className="text-[14px] font-semibold hover:text-brand">
                  {s.workerName}
                </Link>
                <div className="text-[12.5px] text-ink-soft">
                  {s.source === "cover" ? "Picked up as cover" : s.source === "negotiation" ? "Agreed after a targeted ask" : s.source === "manual" ? "Set by manager" : "Chosen by the solver"}
                  {s.confirmedAt ? " · confirmed" : ""}
                </div>
              </div>
            </div>
            {s.explanation && (
              <div className="why">
                <div className="why-title">Why them · score {s.explanation.score}</div>
                <ul>
                  {s.explanation.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {s.status !== "draft" && (
              <button type="button" onClick={() => act({ action: "release" }, "Released. ShiftPilot is finding cover.")} className="btn btn-block mt-4">
                Release and find cover
              </button>
            )}
          </section>
        ) : (
          <div className="panel-callout">{s.status === "cover_needed" ? "ShiftPilot is finding cover for this shift right now." : "Nobody is on this shift yet."}</div>
        )}
        <section>
          <h3 className="panel-sub">Best alternatives, ranked live</h3>
          {!cand ? (
            <div className="text-[14px] text-ink-soft">Ranking…</div>
          ) : (
            <ul className="cand-list">
              {cand.candidates.slice(0, 8).map((c) => (
                <li key={c.workerId} className={cn(!c.eligible && "is-blocked")}>
                  <div className="cand-top">
                    <span className="cand-name">{c.name}</span>
                    <span className="cand-right">
                      <span className="num cand-score">{c.eligible ? c.score : "—"}</span>
                      {c.eligible && (
                        <button type="button" onClick={() => act({ action: "assign", workerId: c.workerId }, `Assigned ${c.name}`)} className="btn btn-primary btn-sm">
                          Assign
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="cand-why">{c.eligible ? c.reasons.join(" · ") : c.blockReason}</div>
                  {c.flags.overtime && (
                    <div className="cand-flag">
                      <ShieldAlert className="size-4" aria-hidden /> Overtime: needs your approval
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

export function RosterPage() {
  const [week, setWeek] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ["roster", week], queryFn: () => api<RosterData>(`/api/roster${week ? `?week=${week}` : ""}`) });
  const [sel, setSel] = useState<string | null>(null);
  const days = useMemo(() => (data ? Array.from({ length: 7 }, (_, i) => addDays(data.weekStart, i)) : []), [data]);
  if (!data) return <div className="page"><div className="empty-state"><strong>Loading roster…</strong></div></div>;
  const selShift = data.shifts.find((s) => s.id === sel);
  const filled = (arr: RShift[]) => arr.filter((s) => s.workerId || s.status === "covered").length;
  const openCount = data.shifts.length - filled(data.shifts);

  const exportCsv = () => {
    const rows = [["Date", "Outlet", "Shift", "Start", "End", "Skill", "Worker", "Status"]];
    for (const s of data.shifts) {
      const o = data.outlets.find((x) => x.id === s.outletId);
      rows.push([s.date, o?.name ?? "", s.label, fmtRange12(mins(s.startsAt), 0).split("–")[0], fmtRange12(0, mins(s.endsAt)).split("–")[1], s.skill, s.workerName ?? "", s.status]);
    }
    const blob = new Blob([rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `roster-week-${data.week}.csv`;
    a.click();
  };

  return (
    <div className="roster">
      <div className="roster-main">
        <header className="roster-head">
          <div>
            <div className="roster-meta">
              <span className="eyebrow">Week {data.week}</span>
              <span className={cn("chip", data.cycle?.status === "published" ? "chip-ok" : data.cycle ? "chip-warn" : "")}>{data.cycle ? data.cycle.status.replace(/_/g, " ") : "No plan yet"}</span>
            </div>
            <h1 className="page-title">Weekly roster</h1>
          </div>
          <div className="roster-actions">
            <div className="week-nav">
              <button type="button" onClick={() => setWeek(addDays(data.weekStart, -7))} className="icon-button" aria-label="Previous week">
                <ChevronLeft className="size-5" />
              </button>
              <span className="num">
                {shortDate(data.weekStart)} – {shortDate(addDays(data.weekStart, 6))}
              </span>
              <button type="button" onClick={() => setWeek(addDays(data.weekStart, 7))} className="icon-button" aria-label="Next week">
                <ChevronRight className="size-5" />
              </button>
            </div>
            {data.cycle?.runId && (
              <Link href={`/agent/${data.cycle.runId}`} className="btn btn-sm">
                Plan and audit trail
              </Link>
            )}
            <button type="button" onClick={exportCsv} className="btn btn-sm btn-quiet" title="The old way, if you still need it">
              <Download className="size-4" aria-hidden /> Export CSV
            </button>
          </div>
        </header>
        {!data.shifts.length ? (
          <div className="empty-state">
            <strong>No shifts for this week yet</strong>
            <span>Give ShiftPilot a goal on Home to plan it.</span>
            <Link href="/" className="btn btn-primary btn-sm">
              Go to Home
            </Link>
          </div>
        ) : (
          <>
            <div className="roster-summary">
              <span>
                <strong className="num">{filled(data.shifts)}</strong> of {data.shifts.length} shifts filled
              </span>
              <span className={cn(openCount > 0 && "is-short")}>
                <strong className="num">{openCount}</strong> open
              </span>
              <span>Click any shift to see why that person got it</span>
              <div className="roster-legend" aria-label="Legend">
                <span>
                  <i className="legend-morning" /> Morning
                </span>
                <span>
                  <i className="legend-midday" /> Midday
                </span>
                <span>
                  <i className="legend-evening" /> Evening
                </span>
                <span>
                  <i className="legend-open" /> Open
                </span>
                <span>
                  <i className="legend-draft" /> Draft
                </span>
              </div>
            </div>
            <div className="roster-scroll">
              <table className="roster-table">
                <caption className="sr-only">Shifts by outlet and day for week {data.week}</caption>
                <thead>
                  <tr>
                    <th className="roster-corner" scope="col">
                      Outlet
                    </th>
                    {days.map((d, i) => {
                      const dayShifts = data.shifts.filter((s) => s.date === d);
                      const pct = dayShifts.length ? filled(dayShifts) / dayShifts.length : 1;
                      return (
                        <th key={d} scope="col" className="roster-day">
                          <div className="roster-day-top">
                            <span className="roster-dow">{DOW_SHORT[i]}</span>
                            <span className="roster-date num">{Number(d.slice(8))}</span>
                          </div>
                          <div className={cn("roster-fill", pct < 1 && "is-short")}>
                            <span className="roster-fill-track">
                              <span style={{ width: `${Math.round(pct * 100)}%` }} />
                            </span>
                            <span className={cn("roster-pct num", pct < 1 && "is-short")}>{Math.round(pct * 100)}%</span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.outlets.map((o) => {
                    const outletShifts = data.shifts.filter((s) => s.outletId === o.id);
                    return (
                      <tr key={o.id}>
                        <th scope="row" className="roster-outlet">
                          <div className="roster-outlet-inner">
                            <span>{o.name}</span>
                            <span className="roster-outlet-count">
                              {filled(outletShifts)}/{outletShifts.length} filled
                            </span>
                          </div>
                        </th>
                        {days.map((d) => {
                          const cell = outletShifts.filter((s) => s.date === d);
                          return (
                            <td key={d} className="roster-cell">
                              {cell.length ? (
                                <div className="roster-cell-list">
                                  {cell.map((s) => (
                                    <ShiftChip key={s.id} s={s} active={sel === s.id} onClick={() => setSel(sel === s.id ? null : s.id)} />
                                  ))}
                                </div>
                              ) : (
                                <span className="roster-empty" aria-label="No shifts">
                                  –
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {selShift && <ShiftPanel s={selShift} data={data} onClose={() => setSel(null)} />}
    </div>
  );
}
