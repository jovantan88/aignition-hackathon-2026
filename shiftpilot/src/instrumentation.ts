export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __spTicker?: ReturnType<typeof setInterval> };
  if (g.__spTicker) return;
  // Background heartbeat for the virtual-clock job queue (reminders, timeouts, persona replies).
  // It calls the tick route rather than importing the queue, so dev hot reloads always run fresh code.
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/agent/tick`;
  g.__spTicker = setInterval(() => {
    fetch(url, { method: "POST" }).catch(() => {});
  }, 2500);
}
