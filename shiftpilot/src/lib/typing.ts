// Start locally on send, then let the server's reply/turn events finish it.
// Match the conversation processing timeout so a slow turn doesn't go silent.
const TYPING_TIMEOUT_MS = 120_000;

export function createTypingStore() {
  const active = new Map<string, ReturnType<typeof setTimeout>>();
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((subscriber) => subscriber());

  const set = (id: string, on: boolean) => {
    clearTimeout(active.get(id));
    active.delete(id);
    if (on) {
      const timer = setTimeout(() => {
        active.delete(id);
        notify();
      }, TYPING_TIMEOUT_MS);
      active.set(id, timer);
      notify();
      // A failed send must not cancel typing for a newer message/agent turn.
      return () => {
        if (active.get(id) === timer) set(id, false);
      };
    }
    notify();
    return () => {};
  };

  return {
    set,
    get: (id: string | null | undefined) => !!id && active.has(id),
    subscribe: (callback: () => void) => {
      subscribers.add(callback);
      return () => { subscribers.delete(callback); };
    },
    handleEvent: ({ topic, payload }: { topic: string; payload: Record<string, unknown> }) => {
      if (topic === "demo.reset") {
        active.forEach(clearTimeout);
        active.clear();
        notify();
        return;
      }
      const id = payload.conversationId;
      if (typeof id !== "string") return;
      if (topic === "typing") set(id, payload.on === true);
      // Incoming messages and held broadcasts are not an agent reply.
      if (topic === "message.created" && payload.direction === "out" && payload.queued !== true) set(id, false);
    },
  };
}

export const typingStore = createTypingStore();
