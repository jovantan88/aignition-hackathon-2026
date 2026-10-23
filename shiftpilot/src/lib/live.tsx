"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { typingStore } from "./typing";

export type LiveMessage = { topic: string; orgId: string; payload: Record<string, unknown> };
type Handler = (m: LiveMessage) => void;

type LiveApi = { subscribe: (h: Handler) => () => void; connected: boolean };
const LiveCtx = createContext<LiveApi | null>(null);

/** Which query-key prefixes each topic invalidates */
const INVALIDATE: Record<string, string[][]> = {
  "message.created": [["messages"], ["conversations"], ["inbox"]],
  "message.updated": [["messages"]],
  "conversation.updated": [["conversations"], ["inbox"]],
  "shift.updated": [["shifts"], ["roster"], ["ops"], ["me"], ["worker"]],
  "cover.updated": [["ops"], ["covers"], ["roster"]],
  "offer.updated": [["ops"], ["covers"], ["me"]],
  "approval.created": [["approvals"], ["ops"]],
  "approval.decided": [["approvals"], ["ops"]],
  "run.updated": [["runs"], ["run"], ["ops"]],
  "audit.created": [["audit"], ["ops"], ["impact"], ["run"]],
  "memory.updated": [["worker"], ["memories"]],
  "cycle.updated": [["cycle"], ["ops"], ["roster"]],
  "availability.updated": [["cycle"], ["ops"], ["worker"]],
};

function LiveBridge({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const handlers = useRef(new Set<Handler>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    // Busy moments emit many events a second; cancelling the in-flight refetch on each one
    // means slow queries never resolve, so batch them and let running fetches finish first.
    const pending = new Map<string, string[]>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      for (const [id, queryKey] of [...pending]) {
        if (qc.isFetching({ queryKey })) continue;
        pending.delete(id);
        void qc.invalidateQueries({ queryKey }, { cancelRefetch: false });
      }
      if (pending.size) flushTimer = setTimeout(flush, 300);
    };
    const invalidate = (keys: string[][]) => {
      for (const k of keys) pending.set(k.join("/"), k);
      flushTimer ??= setTimeout(flush, 250);
    };
    const connect = () => {
      es = new EventSource(`/api/live?org=all`);
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        // EventSource retries on its own; if it closed hard, reopen
        if (es?.readyState === EventSource.CLOSED && !stopped) retry = setTimeout(connect, 1500);
      };
      es.onmessage = (ev) => {
        let msg: LiveMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        typingStore.handleEvent(msg);
        if (msg.topic === "clock.changed" || msg.topic === "demo.reset") {
          void qc.invalidateQueries();
        } else {
          invalidate(INVALIDATE[msg.topic] ?? []);
        }
        handlers.current.forEach((h) => h(msg));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(flushTimer);
      es?.close();
    };
  }, [qc]);

  const subscribe = useCallback((h: Handler) => {
    handlers.current.add(h);
    return () => {
      handlers.current.delete(h);
    };
  }, []);
  const value = useMemo<LiveApi>(() => ({ subscribe, connected }), [subscribe, connected]);

  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 4_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <LiveBridge>{children}</LiveBridge>
    </QueryClientProvider>
  );
}

export function useLiveConnected() {
  return useContext(LiveCtx)?.connected ?? false;
}

/** Subscribe to live events, optionally filtered by topic */
export function useLive(topics: string | string[] | null, handler: Handler) {
  const ctx = useContext(LiveCtx);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const key = Array.isArray(topics) ? topics.join("|") : topics;
  useEffect(() => {
    if (!ctx) return;
    const list = key ? key.split("|") : null;
    return ctx.subscribe((m) => {
      if (!list || list.includes(m.topic)) ref.current(m);
    });
  }, [ctx, key]);
}

export function useTyping(conversationId: string | null | undefined) {
  return useSyncExternalStore(
    typingStore.subscribe,
    () => typingStore.get(conversationId),
    () => false,
  );
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}
