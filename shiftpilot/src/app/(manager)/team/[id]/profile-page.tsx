"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { MemoryList, StatBar, useProfile } from "@/components/control/worker-context";
import { PersonAvatar } from "@/components/wa/avatar";
import { api } from "@/lib/live";
import { DOW_SHORT, fmtDay, fmtRange12 } from "@/lib/time";
import { cn } from "@/lib/utils";

const BLOCK_RANGE: Record<string, [number, number]> = { morning: [7, 12], afternoon: [12, 17], evening: [17, 23] };
const HOURS = Array.from({ length: 17 }, (_, i) => 6 + i);

const mins = (iso: string) => {
  const p = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).split(":").map(Number);
  return p[0] * 60 + p[1];
};

export function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { data: p } = useProfile(id);
  const qc = useQueryClient();
  const [memo, setMemo] = useState("");
  if (!p) return <div className="page"><div className="empty-state"><strong>Loading…</strong></div></div>;
  const w = p.worker;
  const add = async () => {
    if (!memo.trim()) return;
    await api("/api/memories", { json: { workerId: w.id, content: memo, kind: "fact" } });
    setMemo("");
    await qc.invalidateQueries({ queryKey: ["worker", w.id] });
  };
  const usual = (dow: number, h: number) => (w.persona.pattern[String(dow)] ?? []).some((b) => h >= BLOCK_RANGE[b][0] && h < BLOCK_RANGE[b][1]);
  const latestWeek = p.availability[0]?.weekStart;
  const latest = p.availability.filter((a) => a.weekStart === latestWeek);
  return (
    <div className="page">
      <div className="page-inner">
        <Link href="/team" className="link-arrow back-link">
          <ArrowLeft className="size-4" aria-hidden /> All team members
        </Link>
        <header className="profile-head">
          <PersonAvatar name={w.name} hue={w.avatarHue} size={84} />
          <div className="min-w-0 flex-1">
            <h1 className="page-title">{w.name}</h1>
            <p className="page-lede">
              {w.occupation} · lives in {w.homeArea} · home outlet {p.home?.name ?? "—"}
            </p>
            <div className="profile-tags">
              {w.skills.map((s) => (
                <span key={s} className="chip">
                  {s}
                </span>
              ))}
              <span className="chip">
                {w.desiredHours}–{w.maxHours}h a week
              </span>
              <span className="chip">${w.hourlyRate.toFixed(2)}/h</span>
              <span className={cn("chip", !w.autopilot && "chip-signal")}>{w.autopilot ? "Autopilot persona" : "Stage character"}</span>
            </div>
          </div>
          <div className="profile-actions">
            {p.conversationId && (
              <Link href={`/inbox?c=${p.conversationId}`} className="btn">
                Open chat
              </Link>
            )}
            <a href={`/phone/${w.id}`} target="_blank" rel="noreferrer" className="btn btn-primary">
              Open their phone
            </a>
          </div>
        </header>
        <div className="profile-grid">
          <section className="card pad" aria-labelledby="beh-h">
            <h2 id="beh-h" className="card-h">
              Behaviour, last 90 days
            </h2>
            <div className="grid gap-4">
              <StatBar label="Reliability" value={w.persona.reliability} fmt={(v) => `${Math.round(v * 100)}%`} />
              <StatBar label="Replies to availability asks" value={w.stats.availabilityResponseRate} fmt={(v) => `${Math.round(v * 100)}%`} />
              <StatBar label="Median reply time" value={Math.max(0, 180 - w.stats.repliesMedianMin)} max={180} fmt={() => `${w.stats.repliesMedianMin} min`} />
              <StatBar label="Cover requests accepted" value={w.stats.offersReceived ? w.stats.offersAccepted / w.stats.offersReceived : 0} fmt={() => `${w.stats.offersAccepted}/${w.stats.offersReceived}`} />
              <StatBar label="Shifts picked up for others" value={w.stats.coverPickups90d} max={8} />
              <StatBar label="Late arrivals" value={w.stats.lateArrivals90d} max={5} />
              <StatBar label="Late cancellations" value={w.stats.lateCancellations90d} max={5} />
            </div>
            <p className="setting-hint mt-5">These feed the replacement ranking: reliable, responsive people who haven&apos;t been asked much recently go first.</p>
          </section>
          <section className="card pad" aria-labelledby="mem-h">
            <h2 id="mem-h" className="card-h">
              What ShiftPilot remembers
            </h2>
            <MemoryList p={p} />
            <div className="memory-add">
              <input value={memo} onChange={(e) => setMemo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add something ShiftPilot should know" aria-label="Add a memory" className="field field-sm" />
              <button type="button" onClick={add} className="btn btn-primary btn-sm" aria-label="Add memory">
                <Plus className="size-4" />
              </button>
            </div>
            <p className="setting-hint mt-3">The agent learns these from chats. Health details are never stored here.</p>
          </section>
          <section className="card pad" aria-labelledby="avail-h">
            <h2 id="avail-h" className="card-h">
              Usual availability
            </h2>
            <div className="heat" role="img" aria-label="Usual weekly availability by hour">
              <span />
              {DOW_SHORT.map((d) => (
                <span key={d} className="heat-dow">
                  {d[0]}
                </span>
              ))}
              {HOURS.map((h) => (
                <div key={h} className="contents">
                  <span className="heat-hour">{h % 3 === 0 ? `${h}` : ""}</span>
                  {DOW_SHORT.map((_, dow) => (
                    <span key={dow} className={cn("heat-cell", usual(dow, h) && "is-on")} />
                  ))}
                </div>
              ))}
            </div>
            {latestWeek && (
              <div className="mt-5">
                <h3 className="panel-sub">Submitted for the week of {latestWeek}</h3>
                <ul className="submitted">
                  {latest.map((a, i) => (
                    <li key={i} className={cn(a.kind === "unavailable" && "is-off")}>
                      {fmtDay(a.date)} · {fmtRange12(a.startMin, a.endMin)} · {a.kind} <span className="text-ink-soft">({a.source})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
        <section className="section" aria-labelledby="shifts-h">
          <div className="section-head">
            <h2 id="shifts-h" className="section-title">
              Shifts, last week to the next two
            </h2>
          </div>
          <div className="shift-grid">
            {p.shifts.map((s) => (
              <div key={s.id} className={cn("shift-card", s.date < p.today && "is-past")}>
                <div className="shift-card-day">{fmtDay(s.date)}</div>
                <div className="shift-card-time">
                  {fmtRange12(mins(s.startsAt), mins(s.endsAt) || 1440)} · {s.code} {s.label}
                </div>
                <span className={cn("chip", s.status === "confirmed" && "chip-ok")}>{s.status.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
