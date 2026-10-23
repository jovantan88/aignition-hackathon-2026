import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTypingStore } from "@/lib/typing";

describe("phone reply typing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("stays visible when the sent message arrives, and clears on the reply", () => {
    const store = createTypingStore();
    store.set("ravi", true);
    expect(store.get("ravi")).toBe(true);
    store.handleEvent({ topic: "message.created", payload: { conversationId: "ravi", direction: "in" } });
    expect(store.get("ravi")).toBe(true);
    store.handleEvent({ topic: "message.created", payload: { conversationId: "ravi", direction: "out" } });
    expect(store.get("ravi")).toBe(false);
  });

  it("ignores replies in another chat and messages still queued for delivery", () => {
    const store = createTypingStore();
    store.set("ravi", true);
    store.handleEvent({ topic: "message.created", payload: { conversationId: "mei", direction: "out" } });
    store.handleEvent({ topic: "message.created", payload: { conversationId: "ravi", direction: "out", queued: true } });
    expect(store.get("ravi")).toBe(true);
    store.handleEvent({ topic: "typing", payload: { conversationId: "ravi", on: false } });
    expect(store.get("ravi")).toBe(false);
  });

  it("clears a failed send without cancelling a newer send's indicator", () => {
    const store = createTypingStore();
    const cancelFirst = store.set("ravi", true);
    const cancelSecond = store.set("ravi", true);
    cancelFirst();
    expect(store.get("ravi")).toBe(true);
    cancelSecond();
    expect(store.get("ravi")).toBe(false);
  });

  it("keeps typing during longer turns, but expires if completion events are lost", () => {
    const store = createTypingStore();
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.set("ravi", true);
    vi.advanceTimersByTime(30_000);
    expect(store.get("ravi")).toBe(true);
    store.handleEvent({ topic: "typing", payload: { conversationId: "ravi", on: true } });
    vi.advanceTimersByTime(90_000);
    expect(store.get("ravi")).toBe(true);
    changed.mockClear();
    vi.advanceTimersByTime(30_000);
    expect(store.get("ravi")).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("clears all indicators and expiry timers when the demo is reset", () => {
    const store = createTypingStore();
    store.set("ravi", true);
    store.set("mei", true);
    store.handleEvent({ topic: "demo.reset", payload: {} });
    expect(store.get("ravi")).toBe(false);
    expect(store.get("mei")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
