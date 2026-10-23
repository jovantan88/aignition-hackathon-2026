import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./brief.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-brief-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-brief-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-brief-serif" });

const TITLE = "ShiftPilot · One-page brief · Team TIP";
const SUMMARY =
  "ShiftPilot is an AI shift manager that plans a part-time team's weekly roster over WhatsApp and asks the manager before anything consequential. One-page solution brief by Team TIP for AIGNITION 2026, One Less Thing.";

export const metadata: Metadata = {
  title: TITLE,
  description: SUMMARY,
  openGraph: { title: TITLE, description: SUMMARY, type: "website" },
};

type Pair = { label: string; value: string; note: string };

const GLANCE: Pair[] = [
  { label: "Goal", value: "One sentence", note: "typed in plain English" },
  { label: "Plan", value: "11 steps", note: "about 111 shifts across 6 outlets" },
  { label: "Approvals", value: "2 gates", note: "before messaging, before publishing" },
  { label: "Manager time", value: "~11 h → ~3 min", note: "per weekly roster (estimate)" },
];

const AUDIENCE: Pair[] = [
  { label: "Part-time workers", value: "188,200", note: "resident part-time employees in Singapore (MOM, 2025)" },
  { label: "F&B entrants", value: "49.8%", note: "of new local entrants start part-time (MOM)" },
  { label: "WhatsApp reach", value: "80.1%", note: "of Singapore internet users, every month (Digital 2025)" },
  { label: "Demo team", value: "46 people", note: "across 6 cafés (Kopi Lab, a fictional chain)" },
];

const MEASURES: Pair[] = [
  { label: "Time saved", value: "99% less", note: "about 11 h down to about 3 min of manager time" },
  { label: "Steps removed", value: "3 left", note: "type the goal, approve the messages, approve the roster" },
  { label: "Errors reduced", value: "No double-booking", note: "hard scheduling rules, plus a privacy guard" },
  { label: "Accessibility", value: "5 ways to reply", note: "English, Singlish, 中文, Bahasa Melayu, voice notes" },
];

/** Minutes a manager spends by hand, per action. These are the same baselines the Impact page uses. */
const BY_HAND = [
  { label: "Message 46 people one by one", min: 138 },
  { label: "Type replies into Excel", min: 92 },
  { label: "Chase the ~14 who don't reply", min: 42 },
  { label: "Build 6 outlet rosters", min: 270 },
  { label: "Screenshot and send everyone their shifts", min: 46 },
  { label: "Phone around for 2 sick calls", min: 70 },
];
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
const BY_HAND_TOTAL = BY_HAND.reduce((s, x) => s + x.min, 0);
const BY_HAND_MAX = Math.max(...BY_HAND.map((x) => x.min));

const COMPARE = [
  { step: "Give the goal", hand: "—", pilot: "1m" },
  { step: "Ask 46 people for availability", hand: "2h 18m", pilot: "12s to approve" },
  { step: "Read replies into Excel", hand: "1h 32m", pilot: "automatic" },
  { step: "Chase people who don't reply", hand: "42m", pilot: "automatic" },
  { step: "Build 6 outlet rosters", hand: "4h 30m", pilot: "1m to approve" },
  { step: "Send everyone their shifts", hand: "46m", pilot: "automatic" },
  { step: "Two sick calls", hand: "1h 10m", pilot: "30s if nobody can cover" },
];

type Row = { name: string; chip?: string; text: string };
const STACK: { group: string; rows: Row[] }[] = [
  {
    group: "Agent",
    rows: [
      { name: "OpenAI models", chip: "Vercel AI SDK", text: "Tool calling for the chat agent, vision to read MC photos, speech-to-text for voice notes." },
      { name: "Constraint solver", chip: "custom", text: "Skills, availability, hours cap and 11-hour rest are never broken. Every assignment comes with a reason." },
    ],
  },
  {
    group: "Channel",
    rows: [{ name: "WhatsApp", chip: "simulated", text: "In-app phones with Cloud-API-shaped messages: buttons, list pickers, forms, templates, photos, voice notes." }],
  },
  {
    group: "App and data",
    rows: [
      { name: "Next.js 16", chip: "React 19", text: "Dashboard, roster, inbox, audit trail and impact pages, updated live over server-sent events." },
      { name: "Neon Postgres", chip: "Drizzle", text: "Rosters, conversations, learned memories and an append-only audit log." },
      { name: "Mapbox GL", chip: "deck.gl", text: "Outlet map with cover arcs showing shifts moving between outlets." },
    ],
  },
  {
    group: "Guardrails and checks",
    rows: [
      { name: "Approval policy", text: "Messaging more than 5 people, publishing, overtime, bonuses above the cap and escalations all wait for the manager." },
      { name: "Privacy guard", text: "Blocks messages that reveal who is sick or why, or that share phone numbers." },
      { name: "Tests", chip: "Vitest", text: "Unit tests for the solver, ranking and privacy guard, a Singlish, Chinese and Malay parsing eval, and an end-to-end script." },
    ],
  },
];

const LIMITS = [
  { title: "Can't create staff", text: "If nobody's free, it escalates with options like overtime or a bonus. Priya picks." },
  { title: "Only knows what it's told", text: "Team dynamics and judgement calls stay with the manager, who can override any shift." },
  { title: "Bound by WhatsApp's rules", text: "Meta API simulator for now. Going live needs verification, templates and per-message fees." },
  { title: "Approvals mean waiting", text: "If Priya's busy, the roster waits. Safety over speed, on purpose." },
];

const NEXT: { group: string; rows: Row[] }[] = [
  {
    group: "Next steps",
    rows: [
      { name: "Pilot one real outlet", chip: "next", text: "Live WhatsApp Business with the manager's own team." },
      { name: "Measure real baselines", chip: "next", text: "Time a manager doing it by hand, then replace our estimates." },
      { name: "Connect payroll and HR", chip: "next", text: "Export approved rosters to the tools managers already use." },
    ],
  },
];

function Facts({ items }: { items: Pair[] }) {
  return (
    <dl className="brief-meta">
      {items.map((p) => (
        <div key={p.label} className="brief-pair">
          <dt>{p.label}</dt>
          <dd>
            <div>{p.value}</div>
            <div className="brief-sub">{p.note}</div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Rows({ groups }: { groups: { group: string; rows: Row[] }[] }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.group}>
          <h3 className="brief-subhead">{g.group}</h3>
          <ul className="brief-rows">
            {g.rows.map((r) => (
              <li key={r.name}>
                <div className="brief-row-name">
                  <span>{r.name}</span>
                  {r.chip && <span className="brief-chip">{r.chip}</span>}
                </div>
                <p>{r.text}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function Node({ chip, title, note, gate }: { chip: string; title: string; note: string; gate?: boolean }) {
  return (
    <div className={`brief-node${gate ? " is-gate" : ""}`}>
      <span className="brief-chip">{chip}</span>
      <div className="brief-node-title">{title}</div>
      <div className="brief-cap">{note}</div>
    </div>
  );
}

function Link2({ label }: { label: string }) {
  return (
    <div className="brief-link" aria-hidden>
      <span>{label}</span>
    </div>
  );
}

export default function Page() {
  return (
    <div className={`brief ${sans.variable} ${mono.variable} ${serif.variable}`}>
      <header className="brief-measure brief-header">
        <a className="brief-mark" href="#top">
          ShiftPilot
        </a>
        <nav className="brief-nav" aria-label="Sections">
          <a href="#problem">Problem</a>
          <a href="#how">How it works</a>
          <a href="#impact">Impact</a>
          <a href="#limits">Limits</a>
        </nav>
      </header>

      <main id="top">
        <article>
          <div className="brief-measure brief-essay">
            <h1>ShiftPilot runs a part-time team&apos;s roster over WhatsApp</h1>
            <p className="brief-byline">Team TIP · AIGNITION 2026 · One Less Thing</p>
            <p>
              ShiftPilot is an AI shift manager for teams of part-timers. The manager types one goal. It plans the week, collects availability over WhatsApp, builds and negotiates the roster,
              finds cover when someone calls in sick, and pauses for the manager&apos;s approval before anything consequential.
            </p>
            <p>
              In our demo, a six-café chain with 46 part-timers, it turns about 11 hours of weekly rostering into about 3 minutes. <a href="#how">How it works</a> shows the workflow, and{" "}
              <Link href="/">the app</Link> is the working prototype.
            </p>
          </div>

          <div className="brief-measure brief-block">
            <Facts items={GLANCE} />
          </div>

          <section id="problem" className="brief-section" aria-labelledby="h-problem">
            <div className="brief-measure brief-essay">
              <h2 id="h-problem">The problem</h2>
              <p>
                Rostering a part-time team is a week of copy-paste. The manager posts in a group chat, then messages people one by one anyway. Replies come back in Singlish, Chinese, Malay and voice notes
                and get typed into Excel by hand.
              </p>
              <p>
                Then comes chasing the people who didn&apos;t reply, building each outlet&apos;s roster, screenshotting it to everyone, and phoning around when someone calls in sick. With that much copy-paste,
                double-bookings and missed messages are easy.
              </p>
            </div>
            <div className="brief-figure brief-block">
              <h3 className="brief-subhead">Where the 11 hours go</h3>
              <ul className="brief-bars">
                {BY_HAND.map((x) => (
                  <li key={x.label}>
                    <span>{x.label}</span>
                    <span className="brief-bar" aria-hidden>
                      <span style={{ width: `${(x.min / BY_HAND_MAX) * 100}%` }} />
                    </span>
                    <span className="brief-num">{hm(x.min)}</span>
                  </li>
                ))}
              </ul>
              <p className="brief-note">
                total {hm(BY_HAND_TOTAL)} a week · our estimate: per-action baselines × 46 people, 6 outlets, 2 sick calls
              </p>
            </div>
          </section>

          <section id="users" className="brief-section" aria-labelledby="h-users">
            <div className="brief-measure brief-essay">
              <h2 id="h-users">Who it&apos;s for</h2>
              <p>
                Shift managers who run part-time-heavy crews: cafés and restaurants first, then retail, events and warehouses, anywhere the crew changes every week.
              </p>
              <p>The other user is the part-timer, who stays in the WhatsApp they already use and has nothing to install or learn.</p>
            </div>
            <div className="brief-figure brief-block">
              <Facts items={AUDIENCE} />
            </div>
          </section>

          <section id="how" className="brief-section" aria-labelledby="h-how">
            <div className="brief-measure brief-essay">
              <h2 id="h-how">How it works</h2>
              <p>
                The manager gives one goal, like &ldquo;Saturday promo at Jurong, Orchard closed Monday.&rdquo; ShiftPilot turns it into a visible 11-step plan and runs it, stopping twice for the
                manager to decide. Everything it does lands in an audit trail.
              </p>
            </div>
            <div className="brief-figure brief-block">
              <figure className="brief-wash" aria-label="Workflow diagram">
                <div className="brief-flow">
                  <Node chip="goal" title="“Saturday promo at Jurong, Orchard closed Monday”" note="typed in plain English · the agent says back what it understood" />
                  <Link2 label="understood" />
                  <Node chip="plan" title="11 steps, about 111 shifts" note="6 outlets · memory check: exams, last bus home" />
                  <Link2 label="approval gate" />
                  <Node gate chip="you decide" title="Message all 46 people?" note="shows exactly what it will send and why it is asking" />
                  <Link2 label="WhatsApp" />
                  <Node chip="collect" title="Availability" note="private form, or free text in Singlish, Chinese, Malay or voice · reminders chase the rest" />
                  <Link2 label="replies" />
                  <Node chip="solve" title="Build and negotiate the roster" note="hard rules never broken · targeted asks, moves between outlets" />
                  <Link2 label="approval gate" />
                  <Node gate chip="you decide" title="Publish the roster?" note="asked on the manager's own WhatsApp: filled, open, what yes does" />

                  <svg className="brief-split" viewBox="0 0 448 44" aria-hidden>
                    <path d="M224 0 V8 C224 26 108 22 108 44" />
                    <path d="M224 0 V8 C224 26 340 22 340 44" />
                  </svg>
                  <div className="brief-branch">
                    <span>as planned</span>
                    <span>something changes</span>
                  </div>
                  <div className="brief-pairnodes">
                    <Node chip="publish" title="Roster cards sent" note="everyone gets their shifts privately" />
                    <Node chip="adapt" title="Cover, swap, retry" note="sick call: ranked offers in waves, first yes wins · AI failure: holding reply, then retry" />
                  </div>
                  <svg className="brief-split" viewBox="0 0 448 44" aria-hidden>
                    <path d="M108 0 C108 22 224 18 224 36 V44" />
                    <path d="M340 0 C340 22 224 18 224 36 V44" />
                  </svg>
                  <Node chip="prove" title="Audit trail and Impact" note="every tool call, message, privacy check and approval · exportable" />
                </div>
              </figure>
            </div>
          </section>

          <section id="stack" className="brief-section" aria-labelledby="h-stack">
            <div className="brief-measure brief-essay">
              <h2 id="h-stack">What it&apos;s built with</h2>
              <p>A real agent on a simulated channel. The tools, models and rules that make the plan and the actions possible.</p>
            </div>
            <div className="brief-figure brief-block">
              <Rows groups={STACK} />
            </div>
          </section>

          <section id="impact" className="brief-section" aria-labelledby="h-impact">
            <div className="brief-measure brief-essay">
              <h2 id="h-impact">Expected impact</h2>
              <p>
                For the demo team, a week of rostering goes from about 11 hours of the manager&apos;s time to about 3 minutes: type the goal, approve the messages, approve the roster.
              </p>
              <p>
                The by-hand times are our own per-action estimates, not a time-and-motion study. The Impact page in the app logs every action the agent takes against the same baselines.
              </p>
            </div>
            <div className="brief-figure brief-block">
              <div className="brief-table-wrap">
                <table className="brief-table">
                  <caption className="sr-only">One week of rostering for 46 part-timers, by hand and with ShiftPilot</caption>
                  <thead>
                    <tr>
                      <th scope="col">Step</th>
                      <th scope="col">By hand</th>
                      <th scope="col">With ShiftPilot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE.map((r) => (
                      <tr key={r.step}>
                        <td>{r.step}</td>
                        <td>{r.hand}</td>
                        <td>{r.pilot}</td>
                      </tr>
                    ))}
                    <tr className="is-total">
                      <td>Total manager time</td>
                      <td>{hm(BY_HAND_TOTAL)}</td>
                      <td>~3m</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="brief-figure brief-block">
              <Facts items={MEASURES} />
            </div>
          </section>

          <section id="limits" className="brief-section" aria-labelledby="h-limits">
            <div className="brief-measure brief-essay">
              <p className="brief-byline">Key limitations</p>
              <h2 id="h-limits">
                It has <em>real limits.</em>
              </h2>
              <p>It works end to end on a simulated channel and a fictional chain (seeded data, our own by-hand estimates, no real-manager pilot yet).</p>
            </div>
            <div className="brief-figure brief-block">
              <ol className="brief-cards">
                {LIMITS.map((l, i) => (
                  <li key={l.title}>
                    <h3>
                      <span className="brief-chip">{String(i + 1).padStart(2, "0")}</span>
                      {l.title}
                    </h3>
                    <p>{l.text}</p>
                  </li>
                ))}
              </ol>
              <Rows groups={NEXT} />
            </div>
          </section>
        </article>
      </main>

      <footer className="brief-measure brief-footer">
        <p>ShiftPilot was built by Team TIP for AIGNITION 2026, One Less Thing.</p>
        <nav className="brief-foot-links" aria-label="More">
          <Link href="/">Open the app</Link>
          <Link href="/impact">Impact</Link>
          <Link href="/agent">Audit trail</Link>
        </nav>
        <p className="brief-sources">
          Sources:{" "}
          <a href="https://stats.mom.gov.sg/iMAS_PdfLibrary/mrsd-labour-force-in-singapore-advance-release-2025.pdf">MOM, Labour Force in Singapore 2025</a> ·{" "}
          <a href="https://www.mom.gov.sg/newsroom/parliament-questions-and-replies/2026/0505-written-answer-to-pq-on-entrants-to-food-n-beverage-sector">MOM, written answer on F&amp;B entrants</a> ·{" "}
          <a href="https://lbbonline.com/news/digital-2025-singaporeans-use-more-than-seven-social-media-platforms-a-month">Digital 2025: Singapore</a>
        </p>
        <p className="brief-sources">© 2026 Team TIP</p>
      </footer>
    </div>
  );
}
