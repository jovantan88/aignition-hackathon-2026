"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Bot, Search, UserRound } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { PersonAvatar } from "@/components/wa/avatar";
import { api } from "@/lib/live";

type TeamWorker = {
  id: string;
  name: string;
  occupation: string;
  homeArea: string;
  skills: string[];
  autopilot: boolean;
  avatarHue: number;
  outletName: string | null;
  outletCode: string | null;
  language: string;
};

export function PhonePicker() {
  const [q, setQ] = useState("");
  const [org, setOrg] = useState("org_kopilab");
  const { data } = useQuery({ queryKey: ["team", org], queryFn: () => api<{ workers: TeamWorker[] }>(`/api/team?org=${org}`) });
  const list = useMemo(
    () => (data?.workers ?? []).filter((w) => !q || `${w.name} ${w.outletName} ${w.homeArea}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(a.autopilot) - Number(b.autopilot)),
    [data, q],
  );
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 text-[15px] sm:px-8">
      <Link href="/" className="link-arrow">
        <ArrowLeft className="size-4" aria-hidden /> Back to the dashboard
      </Link>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-6 border-b border-rule pb-7">
        <div>
          <Wordmark />
          <h1 className="mt-5 font-display text-[52px] leading-none tracking-tight">Pick a phone.</h1>
          <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-ink-soft">
            Every part-timer has a WhatsApp chat with ShiftPilot. Open anyone&apos;s phone to talk to the agent as them. People marked <strong className="text-ink">Autopilot</strong> reply on their own when you&apos;re not driving; <strong className="text-ink">Stage</strong> characters are yours to play.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Business">
          {[
            { id: "org_kopilab", label: "Kopi Lab · 6 outlets" },
            { id: "org_sunnyside", label: "Sunny Side · 1 outlet" },
          ].map((o) => (
            <button key={o.id} type="button" onClick={() => setOrg(o.id)} className="filter-chip" aria-pressed={org === o.id}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <label className="outlet-search mt-6">
        <Search className="size-4" aria-hidden />
        <input aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, outlet, area" />
      </label>
      <Link href={`/phone/mgr_${org === "org_kopilab" ? "kopilab" : "sunnyside"}`} className="card group mt-4 flex items-center gap-4 px-5 py-4 transition-colors hover:bg-panel">
        <span className="flex size-11 items-center justify-center rounded-full bg-signal text-white">
          <UserRound className="size-5" />
        </span>
        <div className="flex-1">
          <div className="text-[17px] font-semibold">Manager&apos;s phone</div>
          <div className="text-[14.5px] text-ink-soft">Approve from WhatsApp, ask the copilot anything</div>
        </div>
        <ArrowUpRight className="size-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </Link>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((w) => (
          <Link key={w.id} href={`/phone/${w.id}`} className="card group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-panel">
            <PersonAvatar name={w.name} hue={w.avatarHue} size={44} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-semibold">{w.name}</div>
              <div className="truncate text-[14px] text-ink-soft">
                {w.outletCode ?? "—"} · {w.occupation}
              </div>
            </div>
            {w.autopilot ? (
              <span className="chip">
                <Bot className="size-3.5" aria-hidden /> Autopilot
              </span>
            ) : (
              <span className="chip chip-signal">Stage</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
