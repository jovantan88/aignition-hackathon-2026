/**
 * Processes inbound messages for one conversation: debounce bursts, lock,
 * read receipts + typing, deterministic handling of structured replies, and
 * the LLM agent loop for everything else.
 */
import { generateText, isStepCount, type ModelMessage } from "ai";
import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, media, type Conversation, type Message } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { sendMessage, setTyping } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { markReadByAgent } from "./inbound";
import { MODEL_MAIN, hasLLM, mainModel, sleep, withRetry } from "./llm";
import { getWorker, notifyManager } from "./ops";
import { audit } from "./runs";
import { handleStructured } from "./structured";
import { messageForModel, recentHistory, workerContext, workerInstructions } from "./context";
import { buildWorkerTools, type TurnState } from "./tools/worker-tools";
import { reviewMc, transcribeVoice } from "./media";
import { schedule } from "./jobs";

const LOCK_MS = 120_000;

export async function processConversation(conversationId: string, opts?: { noDebounce?: boolean }) {
  if (!opts?.noDebounce) await sleep(1600);
  const lockUntil = new Date(Date.now() + LOCK_MS);
  const locked = await db
    .update(conversations)
    .set({ processingLockUntil: lockUntil })
    .where(and(eq(conversations.id, conversationId), or(isNull(conversations.processingLockUntil), lt(conversations.processingLockUntil, new Date()))))
    .returning();
  const conv = locked[0];
  if (!conv) return; // another worker holds the lock and will pick these up
  try {
    for (let round = 0; round < 5; round++) {
      const pending = await db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "in"), isNull(messages.processedAt)))
        .orderBy(asc(messages.createdAt));
      if (!pending.length) break;
      const fresh = (await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) }))!;
      if (fresh.agentPaused) {
        await markProcessed(pending);
        break;
      }
      await markReadByAgent(conv);
      await setTyping(conv.orgId, conv.id, true);
      try {
        if (conv.kind === "manager_dm") {
          const { handleManagerTurn } = await import("./copilot");
          await handleManagerTurn(conv, pending);
        } else if (conv.kind === "worker_dm") {
          await handleWorkerTurn(conv, pending);
        }
      } finally {
        await markProcessed(pending);
        await setTyping(conv.orgId, conv.id, false);
      }
    }
  } finally {
    await db.update(conversations).set({ processingLockUntil: null }).where(eq(conversations.id, conversationId));
  }
}

async function markProcessed(ms: Message[]) {
  if (!ms.length) return;
  const t = await now(ms[0].orgId);
  for (const m of ms) await db.update(messages).set({ processedAt: t }).where(eq(messages.id, m.id));
}

async function annotate(m: Message, a: Message["annotation"]) {
  await db.update(messages).set({ annotation: { ...(m.annotation ?? {}), ...a } }).where(eq(messages.id, m.id));
  await emit(m.orgId, "message.updated", { conversationId: m.conversationId, messageId: m.id });
}

async function handleWorkerTurn(conv: Conversation, pending: Message[]) {
  const worker = await getWorker(conv.workerId!);
  if (!worker) return;

  // Voice notes → text first
  for (const m of pending) {
    if (m.type === "audio") {
      const id = (m.payload as { audio?: { id?: string } }).audio?.id;
      const transcript = id ? await transcribeVoice(conv.orgId, id) : null;
      m.annotation = { ...(m.annotation ?? {}), transcript: transcript ?? undefined };
      await annotate(m, { transcript: transcript ?? "(couldn't transcribe)" });
    }
  }

  // Structured replies are handled without the LLM
  const forLlm: Message[] = [];
  const notes: string[] = [];
  for (const m of pending) {
    const r = await handleStructured(conv, worker, m);
    if (r.intent) await annotate(m, { intent: r.intent, summary: r.summary, confidence: 1 });
    if (r.llmNote) notes.push(r.llmNote);
    if (!r.handled) forLlm.push(m);
  }
  if (!forLlm.length && !notes.length) return;
  const target = forLlm[forLlm.length - 1] ?? pending[pending.length - 1];

  // MC photos get a vision check in the background
  for (const m of forLlm) {
    if (m.type === "image") {
      const mid = (m.payload as { image?: { id?: string } }).image?.id;
      if (mid) void reviewMc(conv.orgId, worker, mid);
    }
  }

  if (!hasLLM()) {
    await sendMessage({ orgId: conv.orgId, conversationId: conv.id, payload: wa.text("Thanks! I've passed this to the manager, they'll get back to you soon 🙏") });
    await audit(conv.orgId, { kind: "error", title: "No OPENAI_API_KEY set: forwarded the message to the manager" });
    return;
  }

  const [ctx, recent] = await Promise.all([workerContext(conv, worker), recentHistory(conv.id, 24)]);
  const instructions = workerInstructions(ctx);
  const pendingIds = new Set(pending.map((p) => p.id));
  const history = recent.filter((m) => !pendingIds.has(m.id));
  const modelMessages: ModelMessage[] = history.map((m) => ({
    role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
    content: `[${m.createdAt.toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ctx.org.timezone })}] ${messageForModel(m)}`,
  }));
  const parts: Exclude<ModelMessage["content"], string> = [];
  for (const m of forLlm) {
    (parts as { type: "text"; text: string }[]).push({ type: "text", text: messageForModel(m) });
    if (m.type === "image") {
      const mid = (m.payload as { image?: { id?: string } }).image?.id;
      const row = mid ? await db.query.media.findFirst({ where: eq(media.id, mid) }) : null;
      if (row) (parts as unknown[]).push({ type: "file", mediaType: "image", data: Buffer.from(row.data, "base64") });
    }
  }
  for (const n of notes) (parts as { type: "text"; text: string }[]).push({ type: "text", text: `[system note] ${n}` });
  modelMessages.push({ role: "user", content: parts as never });

  const turn: TurnState = { sent: 0, tools: [], lastInbound: target };
  const tools = buildWorkerTools(ctx, turn);
  const t0 = Date.now();
  try {
    const { consumeInjectedFailure } = await import("./scenarios");
    if (consumeInjectedFailure()) throw new Error("Injected failure for the demo: model provider timed out");
    const result = await withRetry(
      () =>
        generateText({
          model: mainModel(),
          instructions,
          messages: modelMessages,
          tools,
          // Once the reply tool succeeds, don't spend another model round on a
          // response the worker has already received (or block their next turn).
          stopWhen: [isStepCount(8), () => turn.replySent === true],
          reasoning: "low",
        }),
      2,
    );
    if (turn.sent === 0 && result.text.trim()) {
      await sendMessage({ orgId: conv.orgId, conversationId: conv.id, payload: wa.text(result.text.trim()) });
    }
    await annotate(target, {
      intent: turn.intent,
      summary: turn.summary,
      confidence: turn.confidence,
      tools: turn.tools,
      extracted: turn.extracted,
    });
    await audit(conv.orgId, {
      kind: "llm",
      title: `Replied to ${worker.name}${turn.intent ? ` (${turn.intent.replace(/_/g, " ")})` : ""}`,
      detail: { conversationId: conv.id, model: MODEL_MAIN, steps: result.steps.length, tools: turn.tools, summary: turn.summary, confidence: turn.confidence },
      latencyMs: Date.now() - t0,
      tokens: result.usage?.totalTokens,
      manualMinutes: ctx.org.settings.baselines.question,
    });
  } catch (e) {
    console.error("[agent] LLM turn failed", e);
    await audit(conv.orgId, { kind: "error", title: `Agent failed to reply to ${worker.name}`, detail: { error: String(e) } });
    await sendMessage({ orgId: conv.orgId, conversationId: conv.id, payload: wa.text("Got it, give me a moment. I'll get back to you shortly 🙏") });
    await notifyManager(conv.orgId, `⚠️ I had trouble replying to ${worker.name}. I sent a holding message and will retry in 2 minutes.`, { attention: true });
    await audit(conv.orgId, { kind: "recovery", title: `Sent a holding message to ${worker.name} and scheduled a retry` });
    // The retry job re-opens this message and runs the turn again
    await schedule(conv.orgId, "conversation.retry", new Date((await now(conv.orgId)).getTime() + 120_000), { conversationId: conv.id, messageId: target.id }, `retry:${target.id}`);
  }
}
