"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, Bot } from "lucide-react";
import { PersonAvatar } from "@/components/wa/avatar";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";

type TeamRow = {
  id: string;
  name: string;
  occupation: string;
  homeArea: string;
  skills: string[];
  desiredHours: number;
  maxHours: number;
  language: string;
  autopilot: boolean;
  avatarHue: number;
  outletName: string | null;
  outletCode: string | null;
  persona: { reliability: number; responsiveness: number };
  stats: { repliesMedianMin: number; offersReceived: number; offersAccepted: number; coverPickups90d: number; lateArrivals90d: number };
};

const SORTS = {
  name: (a: TeamRow, b: TeamRow) => a.name.localeCompare(b.name),
  reliability: (a: TeamRow, b: TeamRow) => b.persona.reliability - a.persona.reliability,
  pickups: (a: TeamRow, b: TeamRow) => b.stats.coverPickups90d - a.stats.coverPickups90d,
  reply: (a: TeamRow, b: TeamRow) => a.stats.repliesMedianMin - b.stats.repliesMedianMin,
};

export function TeamPage() {
  const { data } = useQuery({ queryKey: ["team"], queryFn: () => api<{ workers: TeamRow[] }>("/api/team") });
  const [sort, setSort] = useState<keyof typeof SORTS>("name");
  const [outlet, setOutlet] = useState<string>("ALL");
  const outlets = useMemo(() => [...new Set((data?.workers ?? []).map((w) => w.outletCode).filter(Boolean))] as string[], [data]);
  const rows = useMemo(() => [...(data?.workers ?? [])].filter((w) => outlet === "ALL" || w.outletCode === outlet).sort(SORTS[sort]), [data, sort, outlet]);
  const head = (k: keyof typeof SORTS, label: string) => (
    <th scope="col" aria-sort={sort === k ? (k === "name" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort(k)} className={cn("th-sort", sort === k && "is-sorted")}>
        {label} <ArrowDownUp className="size-3.5" aria-hidden />
      </button>
    </th>
  );
  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <div className="eyebrow">{rows.length} part-timers</div>
            <h1 className="page-title">Team</h1>
            <p className="page-lede">What ShiftPilot knows about each person: how reliable they are, how fast they reply, how often they help out, and what it has learned in chat.</p>
          </div>
        </header>
        <div className="outlet-toolbar" role="group" aria-label="Filter by outlet">
          {["ALL", ...outlets].map((o) => (
            <button key={o} type="button" onClick={() => setOutlet(o)} className="filter-chip" aria-pressed={outlet === o}>
              {o === "ALL" ? "All outlets" : o}
            </button>
          ))}
        </div>
        <div className="card table-wrap">
          <table className="data-table team-table">
            <thead>
              <tr>
                {head("name", "Name")}
                <th scope="col">Outlet</th>
                <th scope="col" className="hide-md">
                  Skills
                </th>
                <th scope="col" className="hide-md">
                  Hours
                </th>
                {head("reliability", "Reliability")}
                {head("reply", "Median reply")}
                <th scope="col" className="hide-sm">
                  Accepts cover
                </th>
                {head("pickups", "Pickups, 90 days")}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Link href={`/team/${w.id}`} className="person-link">
                      <PersonAvatar name={w.name} hue={w.avatarHue} size={38} />
                      <span>
                        <span className="person-name">
                          {w.name}
                          {w.autopilot ? (
                            <span className="person-tag" title="Replies on its own when you aren't driving">
                              <Bot className="size-3.5" aria-hidden /> Autopilot
                            </span>
                          ) : (
                            <span className="chip chip-signal" title="A character the presenter drives on stage">
                              Stage
                            </span>
                          )}
                        </span>
                        <span className="person-sub">{w.occupation}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="num">{w.outletCode}</td>
                  <td className="hide-md">{w.skills.join(", ")}</td>
                  <td className="hide-md num">
                    {w.desiredHours}–{w.maxHours}h
                  </td>
                  <td>
                    <div className="reliability">
                      <div className="progress-track is-thin">
                        <div className={cn("progress-fill", w.persona.reliability >= 0.9 ? "is-ok" : w.persona.reliability < 0.8 && "is-warn")} style={{ width: `${w.persona.reliability * 100}%` }} />
                      </div>
                      <span className="num">{Math.round(w.persona.reliability * 100)}%</span>
                    </div>
                  </td>
                  <td className="num">{w.stats.repliesMedianMin} min</td>
                  <td className="hide-sm num">
                    {w.stats.offersAccepted}/{w.stats.offersReceived}
                  </td>
                  <td className="num">{w.stats.coverPickups90d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
