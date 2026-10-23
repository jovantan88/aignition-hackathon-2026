"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Ban, CalendarDays, Check, ChevronRight, List, MapPin, Search, ShieldCheck, X } from "lucide-react";
import { ApprovalCard } from "@/components/control/approvals";
import { useOps, type OpsData } from "@/components/control/hooks";
import { MissionCard } from "@/components/control/mission-card";
import { CoverList, DayTimeline, Kpi, Ticker } from "@/components/control/widgets";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { OrgSettings } from "@/db/schema";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";

const OpsMap = dynamic(() => import("@/components/map/ops-map").then((m) => m.OpsMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-panel" />,
});

type Impact = { minutesSaved: number; messagesHandled: number; toolCalls: number; approvalsDecided: number; errors: number; recoveries: number };

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
const sgTime = (iso: string) => new Date(iso).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" });

function OutletPanel({ data, outletId, onClose }: { data: OpsData; outletId: string; onClose: () => void }) {
  const o = data.outlets.find((x) => x.id === outletId);
  if (!o) return null;
  return (
    <div className="outlet-panel">
      <div className="outlet-panel-head">
        <div>
          <div className="eyebrow">
            {o.code} · Lead {o.lead}
          </div>
          <h2 className="outlet-panel-title">{o.name}</h2>
          <div className="outlet-panel-address">{o.address}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close outlet details" className="icon-button">
          <X className="size-5" />
        </button>
      </div>
      <div className="outlet-panel-kpis">
        <Kpi label="Today" value={`${Math.round(o.coverage * 100)}%`} tone={o.coverage < 1 ? "signal" : "ok"} />
        <Kpi label="This week" value={`${Math.round(o.weekCoverage * 100)}%`} />
        <Kpi label="Open shifts" value={String(o.openThisWeek)} tone={o.openThisWeek ? "warn" : undefined} />
      </div>
      <div className="outlet-panel-body">
        <h3 className="outlet-panel-sub">Today&apos;s timeline</h3>
        {o.today.length ? <DayTimeline outlet={o} nowIso={data.now} /> : <p className="text-ink-soft">No shifts today.</p>}
        <h3 className="outlet-panel-sub mt-7">Crew today</h3>
        <ul className="crew-list">
          {o.today.map((s) => (
            <li key={s.id}>
              <span className={cn(!s.worker && s.status !== "covered" && "font-semibold text-signal")}>{s.worker ?? (s.status === "covered" ? "Lead covering" : "Open")}</span>
              <span className="num text-ink-soft">
                {s.label} · {sgTime(s.startsAt)}
                {s.onNow ? " · on now" : ""}
                {s.checkedIn ? " ✓" : ""}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/roster" className="btn btn-quiet mt-6">
          <CalendarDays className="size-4" aria-hidden /> Open the week roster
        </Link>
      </div>
    </div>
  );
}

/** The trust model, in plain words and driven by the real policy settings */
function Boundaries() {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api<{ org: { settings: OrgSettings } }>("/api/settings") });
  const s = data?.org.settings;
  const own = [
    "Reads replies in Singlish, 中文, Melayu and voice notes",
    "Reminds people who haven’t replied",
    "Fills gaps with targeted asks",
    s?.autoApproveCoverOffers ? `Offers cover within hours caps and a $${s.incentiveCapPerHour}/h bonus` : null,
    s?.autoApproveSwaps ? "Applies like-for-like swaps" : null,
    "Logs every action in the audit trail",
  ].filter(Boolean) as string[];
  const asks = [
    s ? `Messaging more than ${s.broadcastApprovalThreshold} people at once` : "Messaging a large group",
    "Publishing a roster",
    s ? `Overtime, or a bonus above $${s.incentiveCapPerHour}/h` : "Overtime or large bonuses",
    "Running short when nobody can cover",
    s && !s.autoApproveCoverOffers ? "Offering cover to people" : null,
    s && !s.autoApproveSwaps ? "Swapping shifts" : null,
  ].filter(Boolean) as string[];
  const never = ["Reveals who is sick, or why", "Shares phone numbers or health details", "Messages people in quiet hours, unless urgent", "Breaks WhatsApp’s 24-hour rule (templates only outside it)"];
  return (
    <section className="section" aria-labelledby="bounds-title">
      <div className="section-head">
        <div>
          <h2 id="bounds-title" className="section-title">
            What ShiftPilot can and can&apos;t do without you
          </h2>
          <p className="section-sub">The agent works inside these boundaries. Anything outside them stops and asks.</p>
        </div>
        <Link href="/settings" className="btn btn-quiet btn-sm">
          Edit in Settings
        </Link>
      </div>
      <div className="bounds card">
        <div className="bound">
          <h3 className="bound-title">
            <span className="bound-icon is-ok">
              <Check className="size-4" aria-hidden />
            </span>
            Does on its own
          </h3>
          <ul>{own.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="bound">
          <h3 className="bound-title">
            <span className="bound-icon is-signal">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            Always asks you first
          </h3>
          <ul>{asks.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div className="bound">
          <h3 className="bound-title">
            <span className="bound-icon is-ink">
              <Ban className="size-4" aria-hidden />
            </span>
            Never does
          </h3>
          <ul>{never.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}

export function OpsPage() {
  const { data, isError, refetch } = useOps();
  const { data: impact } = useQuery({ queryKey: ["impact"], queryFn: () => api<Impact>("/api/impact"), refetchInterval: 15000 });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [search, setSearch] = useState("");
  const [needsCover, setNeedsCover] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    // Next.js hides cached pages with Activity. Unmount the map on cleanup so
    // its markers never reconnect to a Mapbox instance that was destroyed.
    let active = true;
    queueMicrotask(() => { if (active) setMapReady(true); });
    return () => { active = false; setMapReady(false); };
  }, []);
  if (!data)
    return (
      <div className="page">
        <div className="empty-state">
          <Activity className={cn("size-7 text-ink", !isError && "animate-pulse")} />
          <strong>{isError ? "Unable to load your workspace" : "Getting your workspace ready…"}</strong>
          {isError && (
            <button type="button" className="btn" onClick={() => void refetch()}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  const date = new Date(data.now).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Singapore" });
  const k = data.kpis;
  const first = data.org.managerName.split(" ")[0];
  const staffed = k.coverageToday >= 1;
  const outlets = data.outlets.filter((o) => `${o.name} ${o.code} ${o.lead}`.toLowerCase().includes(search.toLowerCase()) && (!needsCover || o.coverage < 1 || o.openThisWeek > 0));
  const selectedOutlet = data.outlets.find((o) => o.id === selected);
  const needsYou = data.approvals.length > 0 || data.covers.length > 0;
  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <div className="eyebrow">
              {date} · Week {data.week}
            </div>
            <h1 className="page-title">Welcome back, {first}.</h1>
            <p className={cn("page-lede", !staffed && "is-alert")}>
              {staffed ? `Today is fully staffed: ${k.shiftsToday} shifts across ${data.org.outletCount} outlet${data.org.outletCount === 1 ? "" : "s"}.` : "Some shifts today still need cover."} ShiftPilot is watching for call-outs.
            </p>
          </div>
          <Link href="/roster" className="btn">
            <CalendarDays className="size-4" aria-hidden /> View roster
          </Link>
        </header>

        <MissionCard data={data} />

        {needsYou && (
          <section id="needs-you" className="section needs-you" aria-labelledby="attention-title">
            <div className="section-head">
              <div>
                <h2 id="attention-title" className="section-title">
                  Needs you
                </h2>
                <p className="section-sub">
                  {data.approvals.length > 0 ? "ShiftPilot has paused and is waiting for your decision." : "Active cover searches."}
                </p>
              </div>
              <span className="chip chip-signal">
                {data.approvals.length} approval{data.approvals.length === 1 ? "" : "s"} · {data.covers.length} cover search{data.covers.length === 1 ? "" : "es"}
              </span>
            </div>
            <div className="grid gap-4">
              {data.approvals.map((a) => (
                <ApprovalCard key={a.id} a={a} />
              ))}
              {data.covers.length > 0 && <CoverList data={data} onSelect={setSelected} />}
            </div>
          </section>
        )}

        <div className="home-split">
          <section className="section" aria-labelledby="activity-title">
            <div className="section-head">
              <h2 id="activity-title" className="section-title">
                What it just did
              </h2>
              <Link href="/agent" className="link-arrow">
                Full audit trail <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <div className="card pad">{data.ticker.length ? <Ticker items={data.ticker} limit={7} /> : <p className="text-ink-soft">Activity will appear here as ShiftPilot works.</p>}</div>
          </section>
          <section className="section" aria-labelledby="proof-title">
            <div className="section-head">
              <h2 id="proof-title" className="section-title">
                Time handed back
              </h2>
            </div>
            <div className="card pad proof">
              <div className="eyebrow">Last 14 days</div>
              <div className="proof-hero">{impact ? hm(impact.minutesSaved) : "—"}</div>
              <p className="proof-sub">of manager time, measured against doing it by hand.</p>
              <dl className="proof-list">
                <div>
                  <dt>Messages handled</dt>
                  <dd>{impact?.messagesHandled ?? "—"}</dd>
                </div>
                <div>
                  <dt>Steps removed</dt>
                  <dd>{impact ? impact.toolCalls + impact.approvalsDecided : "—"}</dd>
                </div>
                <div>
                  <dt>Errors recovered</dt>
                  <dd>{impact ? `${impact.recoveries}/${impact.errors || impact.recoveries}` : "—"}</dd>
                </div>
              </dl>
              <Link href="/impact" className="btn btn-quiet btn-sm btn-block">
                See the before and after
              </Link>
            </div>
          </section>
        </div>

        <Boundaries />

        <section className="section" aria-labelledby="outlets-title">
          <div className="section-head">
            <div>
              <h2 id="outlets-title" className="section-title">
                Outlets today
              </h2>
              <p className="section-sub">
                {Math.round(k.coverageToday * 100)}% covered · {k.onNow} on shift now · {k.openThisWeek} open this week
              </p>
            </div>
            <div className="view-switch" role="group" aria-label="Outlet view">
              <button type="button" onClick={() => setView("list")} aria-pressed={view === "list"}>
                <List className="size-4" aria-hidden />
                List
              </button>
              <button type="button" onClick={() => setView("map")} aria-pressed={view === "map"}>
                <MapPin className="size-4" aria-hidden />
                Map
              </button>
            </div>
          </div>
          {view === "list" ? (
            <>
              <div className="outlet-toolbar">
                <label className="outlet-search">
                  <Search className="size-4" aria-hidden />
                  <input aria-label="Search outlets" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search outlets" />
                </label>
                <button type="button" className="filter-chip" aria-pressed={needsCover} onClick={() => setNeedsCover(!needsCover)}>
                  Needs cover
                </button>
              </div>
              <div className="card table-wrap">
                <table className="data-table">
                  <caption className="sr-only">Outlet staffing today and open shifts this week</caption>
                  <thead>
                    <tr>
                      <th scope="col">Outlet</th>
                      <th scope="col">Shifts today</th>
                      <th scope="col">Coverage</th>
                      <th scope="col" className="hide-sm">
                        Open this week
                      </th>
                      <th scope="col" className="hide-md">
                        Outlet lead
                      </th>
                      <th scope="col">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {outlets.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <button type="button" className="outlet-name-button" onClick={() => setSelected(o.id)} aria-label={`View ${o.name} details`}>
                            <span className="outlet-code">{o.code}</span>
                            <span>{o.name}</span>
                          </button>
                        </td>
                        <td className="num">{o.today.length}</td>
                        <td>
                          <span className={cn("coverage-status", o.coverage < 1 && "is-short")}>
                            <i />
                            {Math.round(o.coverage * 100)}%
                          </span>
                        </td>
                        <td className="hide-sm">{o.openThisWeek ? <span className="chip chip-warn">{o.openThisWeek} open</span> : <span className="text-ink-soft">None</span>}</td>
                        <td className="hide-md text-ink-soft">{o.lead ?? "—"}</td>
                        <td>
                          <button type="button" className="icon-button" onClick={() => setSelected(o.id)} aria-label={`Open ${o.name} details`}>
                            <ChevronRight className="size-5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!outlets.length && (
                  <div className="empty-state">
                    <Search className="size-6" />
                    <strong>No outlets match your filters</strong>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        setSearch("");
                        setNeedsCover(false);
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
              <p className="section-footnote">
                <span>
                  Showing {outlets.length} of {data.org.outletCount} outlets
                </span>
                <Link href="/team" className="link-arrow">
                  {k.team} team members <ArrowRight className="size-4" aria-hidden />
                </Link>
              </p>
            </>
          ) : (
            <div className="card map-wrap">
              <div className="dashboard-map">{mapReady && <OpsMap key={data.org.id} data={data} selected={selected} onSelect={setSelected} className="h-full" showScrubber={data.outlets.length > 1} appearance="workspace" />}</div>
              <div className="map-legend">
                <span>
                  <i className="bg-ok" />
                  Covered
                </span>
                <span>
                  <i className="bg-warn" />
                  At risk
                </span>
                <span>
                  <i className="bg-signal" />
                  Short staffed
                </span>
                <span className="ml-auto">Select an outlet for details</span>
              </div>
            </div>
          )}
        </section>

        <p className="dashboard-footer">
          <ShieldCheck className="size-4" aria-hidden /> Your team&apos;s details stay private. Every action is logged.
        </p>
      </div>
      <Sheet
        open={!!selectedOutlet}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent side="right" showCloseButton={false} className="manager-theme w-full gap-0 border-l border-rule bg-paper p-0 shadow-sm sm:max-w-[480px]">
          <SheetTitle className="sr-only">{selectedOutlet?.name} outlet details</SheetTitle>
          {selectedOutlet && <OutletPanel data={data} outletId={selectedOutlet.id} onClose={() => setSelected(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
