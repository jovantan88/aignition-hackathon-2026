import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveEvent } from "@/lib/live-server";

const live = vi.hoisted(() => ({
  latestEventId: vi.fn(async () => 10),
  eventsSince: vi.fn(async () => []),
  listener: undefined as ((event: LiveEvent) => void) | undefined,
  unsubscribe: vi.fn(),
}));

vi.mock("@/lib/org", () => ({ DEFAULT_ORG: "org_kopilab" }));
vi.mock("@/lib/live-server", () => ({
  latestEventId: live.latestEventId,
  eventsSince: live.eventsSince,
  subscribe: (listener: (event: LiveEvent) => void) => {
    live.listener = listener;
    return live.unsubscribe;
  },
}));

import { GET } from "@/app/api/live/route";

describe("live phone updates after a demo reset", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("recovers a reconnect cursor ahead of the database, then delivers new replies", async () => {
    const response = await GET(new Request("http://localhost/api/live?org=all", { headers: { "Last-Event-ID": "500" } }));
    const reader = response.body!.getReader();
    const read = async () => new TextDecoder().decode((await reader.read()).value);
    expect(await read()).toContain("retry:");
    const reset = await read();
    expect(reset).toContain("demo.reset");
    expect(reset).toContain("id: 10");
    expect(live.eventsSince).not.toHaveBeenCalled();
    live.listener!({ id: 11, orgId: "org_kopilab", topic: "message.created", payload: { direction: "out", conversationId: "ravi" } });
    expect(await read()).toContain("message.created");
    await reader.cancel();
    expect(live.unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a reset with a lower ID on an already open connection", async () => {
    const response = await GET(new Request("http://localhost/api/live?org=all"));
    const reader = response.body!.getReader();
    const read = async () => new TextDecoder().decode((await reader.read()).value);
    await read();
    live.listener!({ id: 1, orgId: "*", topic: "demo.reset", payload: {} });
    expect(await read()).toContain("demo.reset");
    live.listener!({ id: 2, orgId: "org_kopilab", topic: "typing", payload: { conversationId: "ravi", on: true } });
    expect(await read()).toContain('"on":true');
    await reader.cancel();
  });
});
