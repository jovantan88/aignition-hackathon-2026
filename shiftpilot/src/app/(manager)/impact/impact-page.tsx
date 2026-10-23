"use client";

import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useOps } from "@/components/control/hooks";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";

type Impact = {
  baselines: Record<string, number>;
  minutesSaved: number;
  messagesHandled: number;
  sent: number;
  received: number;
  toolCalls: number;
  approvalsDecided: number;
  privacyBlocks: number;
  errors: number;
  recoveries: number;
  covers: { total: number; filled: number; medianMinutes: number | null; escalated: number };
  runs: { total: number; weekly: number; cover: number };
  avgLatencyMs: number | null;
  parseEval: { messages: number; dayChecks: number; accuracy: number | null };
  byDay: { date: string; minutes: number }[];
};

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
const dur = (m: number) => (m >= 60 ? hm(m) : `${Math.round(m)}m`);

const BASELINE_LABEL: Record<string, string> = {
  availabilityAsk: "Ask one person for availability (and chase)",
  availabilityParse: "Read one reply and type it into Excel",
  reminder: "Send one reminder",
  rosterBuildPerOutlet: "Build one outlet's roster by hand",
  rosterPublishPerPerson: "Send one person their shifts",
  coverSearch: "Find cover for one sick call",
  question: "Answer one question",
  escalationPrep: "Prepare an escalation",
  swap: "Arrange one swap",
  confirmChase: "Chase one confirmation",
};

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-SG", { weekday: "short", timeZone: "UTC" });

export function ImpactPage() {
  const { data } = useQuery({ queryKey: ["impact"], queryFn: () => api<Impact>("/api/impact"), refetchInterval: 15000 });
  const { data: ops } = useOps();
  if (!data) return <div className="page"><div className="empty-state"><strong>Measuring…</strong></div></div>;
  const max = Math.max(30, ...data.byDay.map((d) => d.minutes));
  const outlets = ops?.org.outletCount ?? 6;
  const team = ops?.kpis.team ?? 46;
  const b = data.baselines;
  const before = [
    { step: `Post in the group chat, then message ${team} people one by one`, min: team * b.availabilityAsk },
    { step: "Read every reply and type it into Excel", min: team * b.availabilityParse },
    { step: `Chase the ~${Math.round(team * 0.3)} who don't reply`, min: Math.round(team * 0.3) * b.reminder * 2 },
    { step: `Build ${outlets} outlet roster${outlets > 1 ? "s" : ""} by hand`, min: outlets * b.rosterBuildPerOutlet },
    { step: "Screenshot and send everyone their shifts", min: team * b.rosterPublishPerPerson },
    { step: "Each sick call: phone around until someone says yes", min: b.coverSearch * 2 },
  ];
  const after = [
    { step: "Type the week's goal", min: 1 },
    { step: "Approve messaging the team", min: 0.2 },
    { step: "Approve the roster", min: 1 },
    { step: "Pick an option when nobody can cover (rare)", min: 0.5 },
  ];
  const bt = before.reduce((s, x) => s + x.min, 0);
  const at = after.reduce((s, x) => s + x.min, 0);
  const bmax = Math.max(...before.map((x) => x.min));
  const cut = bt ? Math.floor((1 - at / bt) * 100) : 0;
  const accuracy = data.parseEval.accuracy != null ? `${Math.round(data.parseEval.accuracy * 100)}%` : "—";

  const groups: { title: string; ask: string; rows: { label: string; value: string; note?: string; tone?: "ok" }[] }[] = [
    {
      title: "Time saved",
      ask: "How much manager time did this give back?",
      rows: [
        { label: "Manager time handed back", value: hm(data.minutesSaved), tone: "ok", note: "Each action logged against what it costs by hand" },
        { label: "Median time to find cover", value: data.covers.medianMinutes != null ? `${Math.round(data.covers.medianMinutes)} min` : "—", note: `vs about ${b.coverSearch} min of phone calls · ${data.covers.filled} of ${data.covers.total} filled automatically` },
        { label: "Agent reply time", value: data.avgLatencyMs ? `${(data.avgLatencyMs / 1000).toFixed(1)}s` : "—", note: "To understand, act and reply" },
      ],
    },
    {
      title: "Steps removed",
      ask: "How much work no longer needs a person?",
      rows: [
        { label: "Steps removed", value: String(data.toolCalls + data.approvalsDecided), note: `${data.toolCalls} actions taken by the agent · ${data.approvalsDecided} decisions left to you` },
        { label: "Messages handled", value: String(data.messagesHandled), note: `${data.received} in · ${data.sent} out, zero typed by the manager` },
        { label: "Runs completed", value: String(data.runs.total), note: `${data.runs.weekly} weekly plans · ${data.runs.cover} cover searches` },
      ],
    },
    {
      title: "Errors reduced",
      ask: "What went wrong, and was it caught?",
      rows: [
        { label: "Errors recovered", value: `${data.recoveries}/${data.errors || data.recoveries}`, note: "Failures retried or handled with a holding message" },
        { label: "Privacy guard catches", value: String(data.privacyBlocks), note: "Messages stopped before they leaked who was sick, or a phone number" },
        { label: "Availability read correctly", value: accuracy, note: data.parseEval.dayChecks ? `${data.parseEval.dayChecks} day-checks from ${data.parseEval.messages} free-text replies, scored against ground truth` : "Scored once people reply in free text" },
      ],
    },
  ];

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head is-stack">
          <div className="eyebrow">Impact · last 14 days</div>
          <h1 className="impact-title">
            <span className="text-signal">{hm(data.minutesSaved)}</span> of manager time handed back.
          </h1>
          <p className="page-lede">Every action ShiftPilot takes is logged with what it would have cost a manager to do by hand. Nothing here is estimated after the fact.</p>
        </header>

        <section id="before-after" className="section" aria-labelledby="ba-title">
          <div className="section-head">
            <div>
              <h2 id="ba-title" className="section-title">
                One week of rostering, before and after
              </h2>
              <p className="section-sub">
                For {team} part-timers across {outlets} outlet{outlets > 1 ? "s" : ""}.
              </p>
            </div>
            <span className="chip chip-ok impact-cut">{cut}% less manager time</span>
          </div>
          <div className="compare">
            <div className="compare-col is-before card">
              <div className="compare-head">
                <div>
                  <div className="eyebrow">Before</div>
                  <h3>Group chat + Excel</h3>
                </div>
                <div className="compare-total is-before">{hm(bt)}</div>
              </div>
              <ul>
                {before.map((x) => (
                  <li key={x.step}>
                    <div className="compare-row">
                      <span>{x.step}</span>
                      <span className="num">{dur(x.min)}</span>
                    </div>
                    <div className="compare-bar" aria-hidden>
                      <span style={{ width: `${(x.min / bmax) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="compare-col is-after card">
              <div className="compare-head">
                <div>
                  <div className="eyebrow">After</div>
                  <h3>With ShiftPilot</h3>
                </div>
                <div className="compare-total is-after">{Math.ceil(at)}m</div>
              </div>
              <ul>
                {after.map((x) => (
                  <li key={x.step}>
                    <div className="compare-row">
                      <span className="compare-you">
                        <Check className="size-4" aria-hidden /> {x.step}
                      </span>
                      <span className="num">{x.min < 1 ? `${Math.round(x.min * 60)}s` : `${x.min}m`}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="compare-note">Everything else (asking, chasing, reading Singlish, solving, negotiating, finding cover, reminding) runs on its own and is visible in the audit trail.</p>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="measure-title">
          <div className="section-head">
            <div>
              <h2 id="measure-title" className="section-title">
                What we measured
              </h2>
              <p className="section-sub">Time saved, steps removed, errors reduced, and who can use it.</p>
            </div>
          </div>
          <div className="measure-grid">
            {groups.map((g) => (
              <article key={g.title} className="card measure">
                <h3 className="measure-title">{g.title}</h3>
                <p className="measure-ask">{g.ask}</p>
                <dl>
                  {g.rows.map((r) => (
                    <div key={r.label} className="measure-row">
                      <dt>{r.label}</dt>
                      <dd className={cn(r.tone === "ok" && "is-ok")}>{r.value}</dd>
                      {r.note && <dd className="measure-note">{r.note}</dd>}
                    </div>
                  ))}
                </dl>
              </article>
            ))}
            <article className="card measure">
              <h3 className="measure-title">Accessibility improved</h3>
              <p className="measure-ask">Who can use it without training?</p>
              <dl>
                <div className="measure-row">
                  <dt>Reply the way they already talk</dt>
                  <dd className="measure-chips">
                    {["English", "Singlish", "中文", "Bahasa Melayu", "Voice notes"].map((l) => (
                      <span key={l} className="chip">
                        {l}
                      </span>
                    ))}
                  </dd>
                  <dd className="measure-note">Free-text and voice replies are read by the agent, no forms to learn.</dd>
                </div>
                <div className="measure-row">
                  <dt>Nothing new to install</dt>
                  <dd className="measure-note">Part-timers stay in the WhatsApp they already use. Tap-to-reply buttons and simple in-chat forms for anyone who prefers them.</dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <section className="section" aria-labelledby="chart-title">
          <div className="section-head">
            <h2 id="chart-title" className="section-title">
              Minutes saved per day
            </h2>
          </div>
          <div className="card pad">
            <div className="bars" role="img" aria-label="Minutes of manager time saved each day over the last 14 days">
              {data.byDay.map((d, i) => (
                <div key={d.date} className="bar-col">
                  <span className="bar-value num">{d.minutes || ""}</span>
                  <div className={cn("bar", i === data.byDay.length - 1 && "is-today")} style={{ height: `${(d.minutes / max) * 150}px`, minHeight: d.minutes ? 3 : 0 }} />
                  <span className="bar-label">
                    {weekday(d.date)}
                    <br />
                    <span className="num">{d.date.slice(8)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="base-title">
          <div className="section-head">
            <div>
              <h2 id="base-title" className="section-title">
                How we value each action
              </h2>
              <p className="section-sub">The time a manager would spend doing it by hand. These are the baselines every saving is measured against.</p>
            </div>
          </div>
          <ul className="card baselines">
            {Object.entries(b).map(([k, v]) => (
              <li key={k}>
                <span>{BASELINE_LABEL[k] ?? k}</span>
                <span className="num">{v} min</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
