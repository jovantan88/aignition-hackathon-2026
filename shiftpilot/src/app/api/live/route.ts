import { eventsSince, latestEventId, subscribe, type LiveEvent } from "@/lib/live-server";
import { DEFAULT_ORG } from "@/lib/org";

export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org") ?? DEFAULT_ORG;
  const lastHeader = req.headers.get("last-event-id");
  const since = Number(lastHeader ?? url.searchParams.get("since") ?? 0);
  const enc = new TextEncoder();
  let stop: () => void = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let lastId = since;
      let unsub: () => void = () => {};
      const timers: { ping?: ReturnType<typeof setInterval>; recycle?: ReturnType<typeof setTimeout> } = {};
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(timers.ping);
        clearTimeout(timers.recycle);
        unsub();
        try {
          controller.close();
        } catch {}
      };
      // Every write is guarded: the client can vanish at any moment
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          stop();
        }
      };
      const send = (e: LiveEvent) => {
        if (closed || (e.id <= lastId && e.topic !== "demo.reset")) return;
        if (orgId !== "all" && e.orgId !== orgId && e.orgId !== "*") return;
        lastId = e.id;
        write(`id: ${e.id}\ndata: ${JSON.stringify({ topic: e.topic, orgId: e.orgId, payload: e.payload })}\n\n`);
      };
      req.signal.addEventListener("abort", () => stop());
      write(`retry: 1000\n\n`);
      // Replay anything missed since the client's last event, then go live
      const latest = await latestEventId();
      if (since > latest) send({ id: latest, orgId: "*", topic: "demo.reset", payload: {} });
      else if (since > 0) for (const e of await eventsSince(since, orgId)) send(e);
      else lastId = latest;
      if (closed) return;
      unsub = subscribe(send);
      timers.ping = setInterval(() => write(`: ping\n\n`), 15_000);
      // Recycle the connection before platform timeouts; EventSource reconnects
      timers.recycle = setTimeout(() => stop(), 280_000);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
