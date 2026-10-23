"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Pin, Trash2 } from "lucide-react";
import { PersonAvatar } from "@/components/wa/avatar";
import { api } from "@/lib/live";
import { fmtDay, fmtRange12 } from "@/lib/time";
import { cn } from "@/lib/utils";

export type Profile = {
  worker: {
    id: string;
    orgId: string;
    name: string;
    occupation: string;
    homeArea: string;
    skills: string[];
    desiredHours: number;
    maxHours: number;
    hourlyRate: number;
    language: string;
    autopilot: boolean;
    avatarHue: number;
    phone: string;
    persona: { reliability: number; responsiveness: number; bio: string; style: string; pattern: Record<string, string[]> };
    stats: { repliesMedianMin: number; availabilityResponseRate: number; offersReceived: number; offersAccepted: number; lateCancellations90d: number; lateArrivals90d: number; coverPickups90d: number; shifts90d: number };
  };
  home: { name: string; code: string } | null;
  memories: { id: string; kind: string; content: string; createdBy: string; expiresAt: string | null; pinned: boolean; createdAt: string; evidenceMessageId: string | null }[];
  recurring: { id: string; description: string }[];
  shifts: { id: string; date: string; startsAt: string; endsAt: string; label: string; status: string; outlet: string; code: string }[];
  offers: { id: string; status: string; kind: string; sentAt: string }[];
  availability: { date: string; startMin: number; endMin: number; kind: string; weekStart: string; source: string }[];
  conversationId: string | null;
  today: string;
};

export function useProfile(id: string | null | undefined) {
  return useQuery({ queryKey: ["worker", id], queryFn: () => api<Profile>(`/api/workers/${id}`), enabled: !!id });
}

const mins = (iso: string) => {
  const p = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).split(":").map(Number);
  return p[0] * 60 + p[1];
};

export function StatBar({ label, value, max = 1, fmt }: { label: string; value: number; max?: number; fmt?: (v: number) => string }) {
  return (
    <div>
      <div className="statbar-row">
        <span>{label}</span>
        <span className="num">{fmt ? fmt(value) : value}</span>
      </div>
      <div className="progress-track is-thin">
        <div className="progress-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
    </div>
  );
}

const MEMORY_KIND: Record<string, string> = { behaviour: "is-warn", relationship: "is-signal" };

export function MemoryList({ p, editable = true }: { p: Profile; editable?: boolean }) {
  const qc = useQueryClient();
  const patch = async (id: string, body: Record<string, unknown>) => {
    await api(`/api/memories/${id}`, { method: "PATCH", json: body });
    await qc.invalidateQueries({ queryKey: ["worker", p.worker.id] });
  };
  if (!p.memories.length && !p.recurring.length) return <div className="text-[14px] text-ink-soft">Nothing remembered yet.</div>;
  return (
    <ul className="memory-list">
      {p.recurring.map((r) => (
        <li key={r.id} className="memory is-info">
          <span className="memory-kind">Recurring</span>
          {r.description}
        </li>
      ))}
      {p.memories.map((m) => (
        <li key={m.id} className={cn("memory group", MEMORY_KIND[m.kind])}>
          <div className="flex items-start justify-between gap-2">
            <span>
              <span className="memory-kind">{m.kind}</span>
              {m.content}
            </span>
            {editable && (
              <span className="memory-actions">
                <button type="button" onClick={() => patch(m.id, { pinned: !m.pinned })} title="Pin" aria-label="Pin this memory" className={cn(m.pinned ? "text-signal" : "text-ink-soft hover:text-ink")}>
                  <Pin className="size-4" />
                </button>
                <button type="button" onClick={() => patch(m.id, { active: false })} title="Forget" aria-label="Forget this memory" className="text-ink-soft hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </span>
            )}
          </div>
          <div className="memory-src">
            {m.createdBy === "agent" ? "Learned from chat" : m.createdBy === "manager" ? "Added by you" : "On file"}
            {m.expiresAt ? ` · until ${m.expiresAt}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WorkerContext({ workerId }: { workerId: string }) {
  const { data: p } = useProfile(workerId);
  if (!p) return <div className="p-5 text-[14px] text-ink-soft">Loading…</div>;
  const w = p.worker;
  const upcoming = p.shifts.filter((s) => s.date >= p.today && s.status !== "cancelled").slice(0, 6);
  return (
    <div className="worker-context">
      <div className="flex items-center gap-3.5">
        <PersonAvatar name={w.name} hue={w.avatarHue} size={52} />
        <div className="min-w-0">
          <Link href={`/team/${w.id}`} className="worker-context-name hover:underline">
            {w.name}
          </Link>
          <div className="truncate text-[14px] text-ink-soft">
            {w.occupation} · {p.home?.name ?? w.homeArea}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <StatBar label="Reliability" value={w.persona.reliability} fmt={(v) => `${Math.round(v * 100)}%`} />
        <StatBar label="Accepts cover" value={w.stats.offersReceived ? w.stats.offersAccepted / w.stats.offersReceived : 0} fmt={() => `${w.stats.offersAccepted}/${w.stats.offersReceived}`} />
        <StatBar label="Median reply" value={Math.max(0, 180 - w.stats.repliesMedianMin)} max={180} fmt={() => `${w.stats.repliesMedianMin} min`} />
        <StatBar label="Late (90 days)" value={w.stats.lateArrivals90d} max={5} />
      </div>
      <section>
        <h3 className="panel-sub flex items-center gap-2">
          <Brain className="size-4" aria-hidden /> What ShiftPilot remembers
        </h3>
        <MemoryList p={p} />
      </section>
      <section>
        <h3 className="panel-sub">Upcoming shifts</h3>
        {upcoming.length ? (
          <ul className="upcoming-list">
            {upcoming.map((s) => (
              <li key={s.id}>
                <span>
                  {fmtDay(s.date)} · {s.code}
                </span>
                <span className="num text-ink-soft">
                  {fmtRange12(mins(s.startsAt), mins(s.endsAt) || 1440)} {s.status === "confirmed" ? "✓" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[14px] text-ink-soft">None.</div>
        )}
      </section>
      <div className="grid grid-cols-2 gap-2">
        <a href={`/phone/${w.id}`} target="_blank" rel="noreferrer" className="btn btn-sm">
          Open their phone
        </a>
        <Link href={`/team/${w.id}`} className="btn btn-sm btn-quiet">
          Full profile
        </Link>
      </div>
    </div>
  );
}
