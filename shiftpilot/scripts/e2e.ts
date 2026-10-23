/**
 * End-to-end story against a running dev server (npm run dev), using only the
 * public API, the same way the dashboard and phones do:
 *   reset → goal → approve broadcast → replies → reminders → solve →
 *   negotiate → approve publish → sick call → cover found (or escalation decided)
 * Run: npm run e2e   (BASE_URL defaults to http://localhost:3000)
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function call<T = any>(path: string, body?: unknown, method?: string): Promise<T> {  // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${BASE}${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: body !== undefined ? { "Content-Type": "application/json", Cookie: "sp_org=org_kopilab" } : { Cookie: "sp_org=org_kopilab" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(ok: boolean, msg: string) {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
}
async function until<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutS = 120): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) {
    const v = await fn();
    if (v) return v;
    await call("/api/agent/tick", {});
    await sleep(3000);
  }
  console.log(`  (timed out waiting for ${label})`);
  return null;
}
const pending = async (kind: string) => (await call<{ approvals: { id: string; kind: string; options: { id: string }[] | null }[] }>("/api/approvals?status=pending")).approvals.find((a) => a.kind === kind);

async function main() {
  console.log(`E2E against ${BASE}\n`);
  await call("/api/demo/reset", {});
  // Make sure it's daytime (quiet hours would hold the broadcast until 07:30)
  const clock = await call("/api/clock?org=org_kopilab");
  if (clock.local.minutes < 8 * 60) await call("/api/clock?org=org_kopilab", { action: "next", dow: clock.local.dow, time: "10:00" });
  else if (clock.local.minutes >= 21 * 60) await call("/api/clock?org=org_kopilab", { action: "next", dow: (clock.local.dow + 1) % 7, time: "10:00" });
  check(true, `Demo reset, clock at ${(await call("/api/clock?org=org_kopilab")).label}`);

  await call("/api/plan", { goal: "Plan next week for all outlets. Jurong has a Saturday promo so we need 2 extra on the afternoon. Orchard is closed on Monday for renovation." });
  const broadcast = await until("broadcast approval", () => pending("broadcast"));
  check(Boolean(broadcast), "Agent understood the goal and paused for approval before messaging the team");
  const ops0 = await call("/api/ops");
  check(ops0.cycle?.status === "draft", "Nothing was sent before approval");

  await call(`/api/approvals/${broadcast!.id}`, { decision: "approved" });
  const collecting = await until("first replies", async () => {
    const o = await call("/api/ops");
    return o.cycle?.replied >= 10 && o.cycle;
  }, 180);
  check(Boolean(collecting), `Replies are coming in (${collecting?.replied}/${collecting?.total})`);

  await call("/api/clock?org=org_kopilab", { action: "advance", minutes: 24 * 60 + 5 });
  await sleep(45_000);
  await call("/api/clock?org=org_kopilab", { action: "advance", minutes: 16 * 60 });
  await sleep(40_000);
  const afterReminders = await call("/api/ops");
  check(afterReminders.cycle?.replied >= afterReminders.cycle?.total * 0.8, `Reminders worked: ${afterReminders.cycle?.replied}/${afterReminders.cycle?.total} replied`);

  await call("/api/clock?org=org_kopilab", { action: "advance", minutes: 5 * 60 });
  await until("negotiation", async () => ["negotiating", "awaiting_approval"].includes((await call("/api/ops")).cycle?.status), 150);
  await call("/api/clock?org=org_kopilab", { action: "advance", minutes: 60 });
  const publish = await until("publish approval", () => pending("publish_roster"), 150);
  check(Boolean(publish), "Solved, negotiated, and paused for approval before publishing");
  await call(`/api/approvals/${publish!.id}`, { decision: "approved" });
  await sleep(30_000);
  const runs = await call<{ runs: { kind: string; status: string; summary: string | null }[] }>("/api/runs");
  const weekly = runs.runs.find((r) => r.kind === "weekly" && r.summary?.includes("published"));
  check(Boolean(weekly), `Roster published: ${weekly?.summary}`);
  const filled = Number(weekly?.summary?.match(/(\d+)\/(\d+)/)?.[1] ?? 0);
  const total = Number(weekly?.summary?.match(/(\d+)\/(\d+)/)?.[2] ?? 1);
  check(filled / total >= 0.85, `Coverage ${Math.round((filled / total) * 100)}% (target ≥ 85%)`);

  // Surprise: a sick call
  const sc = await call<{ conversationId?: string; error?: string }>("/api/scenarios/sick_call", {});
  check(!sc.error, `Sick call injected through WhatsApp${sc.error ? `: ${sc.error}` : ""}`);
  const cover = await until("cover search", async () => {
    const r = await call<{ runs: { kind: string; status: string; summary: string | null }[] }>("/api/runs");
    return r.runs.find((x) => x.kind === "cover");
  }, 90);
  check(Boolean(cover), "Agent released the shift and started a cover search");
  const resolved = await until(
    "cover resolution",
    async () => {
      const r = await call<{ runs: { kind: string; status: string; summary: string | null }[] }>("/api/runs");
      const c = r.runs.find((x) => x.kind === "cover");
      if (c?.status === "done") return c;
      const esc = await pending("escalation");
      if (esc) {
        await call(`/api/approvals/${esc.id}`, { decision: "approved", optionId: esc.options?.find((o) => o.id === "lead")?.id ?? esc.options?.[0]?.id });
        return { status: "escalated → manager chose", summary: "escalation decided" };
      }
      return null;
    },
    300,
  );
  check(Boolean(resolved), `Cover resolved: ${resolved?.summary ?? "no"}`);

  const impact = await call("/api/impact");
  check(impact.minutesSaved > 0, `Impact logged: ${impact.minutesSaved} manager-minutes saved, ${impact.messagesHandled} messages handled`);
  check(impact.errors - impact.recoveries <= 0, `No unrecovered errors (${impact.errors} errors, ${impact.recoveries} recoveries)`);

  console.log(`\n${failures ? `${failures} check(s) failed` : "All checks passed"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
