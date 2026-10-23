# ShiftPilot

An AI shift manager for part-time teams, working over WhatsApp. It plans the whole chain's weekly roster from one goal, asks every part-timer privately for their availability and reads their replies (Singlish, Chinese, Malay, voice notes), fills gaps by negotiating, and finds cover when someone calls in sick. It pauses for the manager before anything consequential and logs everything it does.

Built for the AIGNITION "ONE LESS THING" challenge.

## What's in the box

| | |
|---|---|
| **Home** (`/`) | Goal first. Type the week's goal and a live mission card tracks it (Goal, Collect, Solve, Negotiate, Approve, Publish) beside the visible step-by-step plan. Pending approvals sit directly underneath, then what the agent just did, time handed back, and a plain-words panel of what it does on its own, what it always asks first, and what it never does (driven by the Settings policy). Outlets are below, as a table or the live Mapbox map with cover arcs and a week time-lapse. |
| **Roster** (`/roster`) | Week grid across outlets, all seven days in one view. Click a shift to see why that person was picked and a live ranking of alternatives, and to reassign or release it. CSV export is there too. |
| **Inbox** (`/inbox`) | WhatsApp-Web-style view of every chat, with chips showing what the agent understood (intent, confidence, transcript). *Take over* pauses the agent in a chat and *Hand back* resumes it. A side panel shows the person's memory and stats. |
| **Team** (`/team`) | Reliability, reply time, cover pickups, and an availability heatmap. Profiles also show editable memory cards learned from chats. |
| **Plans & audit trail** (`/agent`) | Every run's visible plan, approval gates, and the full audit trail (tool calls, messages, privacy checks, errors and recoveries), filterable by type. The audit can be exported as markdown. |
| **Impact** (`/impact`) | The before/after comparison first (group chat and Excel against ShiftPilot), then what was measured: time saved, steps removed, errors reduced and accessibility improved. |
| **Recording guide** (sidebar) | A run of show that follows the challenge's six-beat demonstration flow, with live status, a reset button and capture tips. |
| **Phones** (`/phone`, `/phone/[id]`) | A faithful WhatsApp simulator for every worker and for the manager. It supports reply buttons, list pickers, Flows (full-screen forms), templates, reactions, quoted replies, location sharing, photos (including a sample MC) and voice notes. Works on a real phone browser too. |
| **Stage** (`/stage`) | Presenter view: a map framed on every outlet, three live phones, the current plan, and a scenario director that injects surprises through the real pipeline. |

### How it maps to the challenge

| Requirement | Where to see it |
|---|---|
| Goal-driven | Home: the goal box, and the agent's own reading of it ("Understood: …") |
| Plans the work | Home and Plans & audit trail: the 11-step plan with live status |
| Uses tools | Audit trail: WhatsApp sends, availability, solver, ranking, vision and transcription calls |
| Takes action, with evidence | Phones and Inbox: real messages in real chats. Audit trail: every action |
| Keeps context | Team profiles: memory learned from chats that changes ranking |
| Handles change | Stage: Sick call, No-show, Break the LLM. Audit trail filter: Errors and recovery |
| Requests approval | Approvals panel and Home: risk, the policy that triggered it, and what yes will cause |
| Audit trail | Plans & audit trail, with markdown export |
| Proves value | Impact: time saved, steps removed, errors reduced, accessibility improved |

### How the agent works

- **Goal-driven weekly run** (`src/agent/workflows/weekly.ts`): it parses the goal into demand overrides, builds demand, and checks memory. It asks for approval before broadcasting, then sends Flow forms (or templates when the 24h window is closed), collects replies, and sends reminders. Then it solves, negotiates (targeted asks, cross-outlet moves, small bonuses within policy), asks for approval, and publishes with roster image cards before chasing confirmations.
- **Conversation agent** (`src/agent/conversation.ts`, `tools/worker-tools.ts`): uses OpenAI tool calling through the Vercel AI SDK. Its tools save availability, release a shift, report lateness, save timetable changes, accept offers, request swaps, claim open shifts, save preferences and memories, escalate, and reply with any WhatsApp message type. Button taps and Flow submissions are handled deterministically without the LLM. Voice notes are transcribed, and MC photos are checked with vision.
- **Cover** (`src/agent/workflows/cover.ts`, `ranking.ts`): replacements are ranked with reasons (availability, hours headroom, travel, reliability, fairness, ask fatigue, memory). Offers go out in waves and the first yes wins, through an atomic claim. Offers time out, and when nobody can take the shift the agent escalates with concrete options (overtime, bonus, borrow from another outlet, ask the lead, run short) for the manager to pick, on the dashboard or from WhatsApp.
- **Solver** (`src/agent/solver.ts`): hard constraints (skill, availability, hours cap, 11h rest, one shift a day, travel radius) are never broken. Soft scoring covers fairness, preferences, reliability on openings and coworker affinity. A repair pass closes gaps. Every assignment comes with an explanation.
- **Guardrails** (`src/whatsapp/send.ts`, `src/agent/privacy.ts`):
  - WhatsApp limits are enforced.
  - A privacy guard stops messages that would reveal who is sick or why, or share phone numbers or health details.
  - The 24h customer-service window is respected (templates only outside it).
  - Quiet hours apply, with a morning release.
- **Approval policy** (Settings): broadcasts to more than 5 people, publishing, overtime, bonuses above the cap, escalations and announcements all wait for the manager.
- **Memory**: facts, preferences, constraints and behaviour are learned from chats, each linked to the message it came from. They are editable, and they really change ranking ("doesn't work weekends" blocks weekend offers). Health details are never stored.
- **Personas**: workers not driven on stage reply on their own, in their own voice, through the same inbound pipeline.
- **Realtime**: an append-only `events` table is tailed by a single in-process poller and fanned out over SSE (`/api/live`).
- **Virtual demo clock**: jump ahead to fire reminders, deadlines and offer timeouts. Jobs run strictly in time order.

## Setup

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL` (Neon), `OPENAI_API_KEY` and `NEXT_PUBLIC_MAPBOX_TOKEN`.

```bash
npm run db:reset
```

```bash
npm run dev
```

Then open http://localhost:3000. `npm run db:reset` creates the tables and seeds both businesses.

The seed contains **Kopi Lab**, a fictional café chain with 6 outlets across Singapore and 46 part-timers with personas, memories and history, and **Sunny Side Bakery**, which has a single outlet. Switch between them in the header.

## Recording checklist

The sidebar's **Recording guide** has the same list with live status and a reset button.

1. **Start clean.** Settings, then *Reset demo data* (or the button in the Recording guide). This gives a fresh week, an empty activity feed and the clock back to now.
2. **Run a production build** so nothing compiles on camera: `npm run build`, then `npm start`. In dev, visit every page once first.
3. **Frame it.** Use a 1920×1080 window at 100% browser zoom. The dev toolbar badge is already hidden.
4. **Two windows.** The dashboard in one, the Stage (`/stage`) in the other. Phones and the surprise buttons live on the Stage.
5. **Follow the six beats** in the Recording guide. They follow the challenge's suggested demonstration flow.

## Demo script (about 6 minutes)

1. **The old way:** the Impact page's before/after panel (group chat plus Excel).
2. **Give a goal:** on Home, use *Plan next week* with the default goal. The mission card shows what the agent understood. Open the plan (Plans & audit trail) and show the parsed demand and the memory check.
3. **Approval gate:** approve *Ask 46 part-timers* (or from the manager's phone in `/stage`).
4. **Collection:** in `/stage`, Mei's and Ravi's phones get the availability Flow. Fill one in, and type free text in Singlish on the other. The persona crowd replies on its own. Use the clock menu to jump **+1 day**: reminders go out and more replies arrive.
5. **Solve and negotiate:** jump past the deadline. The solver fills about 92%, and the agent sends targeted asks (arcs fly across the map). Approve publishing, and roster cards land on the phones.
6. **Surprise:** use *Sick call* in the scenario bar (or type it on Mei's phone, or send a voice note). The agent is kind, releases the shift and asks for an MC; send the sample MC from 📎 and it reads the dates. Offers go out in waves. Decline on one phone and accept on another to see first-yes-wins, and the crew and the manager are told without the reason.
7. **Recovery:** try *Break the LLM* followed by a message: you get a holding reply and a retry. *No-show* leads to an urgent cover and an escalation with options. Approve one from the manager's WhatsApp.
8. **Prove it:** the Impact page and the run's audit trail (filter to *Errors and recovery*, then export it).

## Checks

```bash
npm test
```

Unit tests for the solver, ranking and memory rules, WhatsApp limits, the privacy guard, time and names.

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run eval:parse
```

Parse accuracy on Singlish, Chinese and Malay availability messages through the full agent. It uses the database and resets it afterwards.

```bash
npm run e2e
```

The full story against a running dev server, with assertions.

## Tech

Next.js 16 (App Router, Cache Components), React 19, Tailwind v4, shadcn/ui (Base UI), Neon Postgres and Drizzle, Vercel AI SDK 7 with OpenAI (`gpt-6.1-sol` for the agent and copilot; `gpt-6-luna` for personas; transcription and TTS models), Mapbox GL with deck.gl, and TanStack Query with SSE.
