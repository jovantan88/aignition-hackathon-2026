/**
 * The single outbound pipeline: validate against Cloud API limits, run the
 * privacy guard, respect the 24-hour window and quiet hours, then store and
 * broadcast. Every step is audited.
 */
import { and, asc, eq } from "drizzle-orm";
import { firstName } from "@/lib/names";
import { db } from "@/db";
import { conversations, messages, orgs } from "@/db/schema";
import { checkPrivacy, type PrivacyContext } from "@/agent/privacy";
import { audit } from "@/agent/runs";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { addDays, atLocal, localParts, toMinutes } from "@/lib/time";
import { templatePayload, templateToText, type TemplateParams } from "./templates";
import { outboundSchema, payloadToText, type OutboundPayload } from "./types";

const WINDOW_MS = 24 * 3600 * 1000;

/** Every string the recipient will see, for the privacy guard */
export function visibleText(p: OutboundPayload): string {
  switch (p.type) {
    case "text":
      return p.text.body;
    case "interactive": {
      const i = p.interactive as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      const parts = [i.header?.text, i.body?.text, i.footer?.text];
      if (i.type === "button") parts.push(...i.action.buttons.map((b: { reply: { title: string } }) => b.reply.title));
      if (i.type === "list")
        for (const s of i.action.sections) for (const r of s.rows) parts.push(r.title, r.description);
      return parts.filter(Boolean).join("\n");
    }
    case "template":
      return templateToText(p as { template: { name: string; components: Record<string, unknown>[] } });
    case "image":
    case "document":
      return (p.type === "image" ? p.image.caption : p.document.caption) ?? "";
    default:
      return "";
  }
}

export type SendOptions = {
  orgId: string;
  conversationId: string;
  payload: OutboundPayload;
  runId?: string | null;
  sender?: "agent" | "manager" | "system";
  privacy?: PrivacyContext;
  /** Used when the 24-hour window is closed */
  template?: { name: string; params: TemplateParams };
  urgent?: boolean;
  /** Proactive messages respect quiet hours; replies do not */
  proactive?: boolean;
  auditTitle?: string;
  manualMinutes?: number;
  /** Skip the delivered tick animation (bulk seeding) */
  instant?: boolean;
};

export type SendResult = { ok: true; messageId: string; viaTemplate: boolean; queued: boolean; deliverAt: Date } | { ok: false; error: string; issues?: string[] };

export async function sendMessage(o: SendOptions): Promise<SendResult> {
  // 1. Cloud API limits
  const parsed = outboundSchema.safeParse(o.payload);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    await audit(o.orgId, { runId: o.runId, kind: "error", title: "Message rejected: breaks WhatsApp limits", detail: { error } });
    return { ok: false, error };
  }
  const payload = parsed.data as OutboundPayload;

  const conv = await db.query.conversations.findFirst({ where: eq(conversations.id, o.conversationId) });
  if (!conv) return { ok: false, error: "conversation not found" };

  // 2. Privacy guard
  const text = visibleText(payload);
  const privacy = o.privacy ?? { purpose: conv.kind === "manager_dm" ? "manager" : "reply" };
  const check = checkPrivacy(text, privacy);
  if (!check.ok) {
    await audit(o.orgId, { runId: o.runId, kind: "privacy_check", title: "Privacy guard blocked a message", detail: { issues: check.issues, text } });
    return { ok: false, error: `Privacy guard: ${check.issues.join("; ")}. Rephrase without these details.`, issues: check.issues };
  }
  if (privacy.purpose !== "reply" && privacy.purpose !== "manager") {
    await audit(o.orgId, { runId: o.runId, kind: "privacy_check", title: "Privacy check passed", detail: { purpose: privacy.purpose } });
  }

  const t = await now(o.orgId);
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, o.orgId) });

  // 3. Quiet hours for proactive, non-urgent messages: hold until the morning
  let queued = false;
  let deliverAt = t;
  if (o.proactive && !o.urgent && org && conv.kind === "worker_dm") {
    const lp = localParts(t, org.timezone);
    const m = lp.minutes;
    const qs = toMinutes(org.settings.quietStart);
    const qe = toMinutes(org.settings.quietEnd);
    const inQuiet = qs > qe ? m >= qs || m < qe : m >= qs && m < qe;
    if (inQuiet) {
      queued = true;
      deliverAt = atLocal(m >= qe && qs > qe ? addDays(lp.date, 1) : lp.date, org.settings.quietEnd, org.timezone);
    }
  }

  // 4. 24-hour customer service window (worker DMs only)
  let finalPayload: OutboundPayload = payload;
  let viaTemplate = payload.type === "template";
  let held: OutboundPayload | null = null;
  const windowOpen = conv.lastInboundAt && t.getTime() - conv.lastInboundAt.getTime() < WINDOW_MS;
  if (conv.kind === "worker_dm" && !windowOpen && payload.type !== "template" && payload.type !== "reaction") {
    if (o.template) {
      finalPayload = templatePayload(o.template.name, o.template.params);
    } else {
      // Send a generic opener and hold the real message until they reply
      const worker = conv.workerId ? await db.query.workers.findFirst({ where: (w, { eq }) => eq(w.id, conv.workerId!) }) : null;
      finalPayload = templatePayload("update_available", {
        body: [worker ? firstName(worker.name) : "there"],
        buttonPayloads: ["window:open"],
      });
      held = payload;
    }
    viaTemplate = true;
  }

  const id = newId("msg");
  const status = queued ? "queued" : "sent";
  const textSummary = finalPayload.type === "template" ? templateToText(finalPayload as never) : payloadToText(finalPayload as Record<string, unknown>);
  await db.insert(messages).values({
    id,
    orgId: o.orgId,
    conversationId: o.conversationId,
    direction: "out",
    sender: o.sender ?? "agent",
    type: finalPayload.type,
    payload: finalPayload as Record<string, unknown>,
    text: textSummary,
    status,
    annotation: queued ? { held: "quiet" } : null,
    contextMessageId: "context" in finalPayload && finalPayload.context ? finalPayload.context.message_id : null,
    runId: o.runId ?? null,
    template: finalPayload.type === "template" ? finalPayload.template.name : null,
    createdAt: t,
  });
  if (held) {
    await db.insert(messages).values({
      id: newId("msg"),
      orgId: o.orgId,
      conversationId: o.conversationId,
      direction: "out",
      sender: o.sender ?? "agent",
      type: held.type,
      payload: held as Record<string, unknown>,
      text: payloadToText(held as Record<string, unknown>),
      status: "queued",
      annotation: { held: "window" },
      runId: o.runId ?? null,
      createdAt: new Date(t.getTime() + 1),
    });
  }
  if (queued) {
    const { schedule } = await import("@/agent/jobs");
    await schedule(o.orgId, "message.release", deliverAt, { conversationId: o.conversationId }, `release:${o.conversationId}:${deliverAt.toISOString()}`);
  }
  if (finalPayload.type !== "reaction") {
    await db
      .update(conversations)
      .set({ lastMessageAt: t, lastMessagePreview: textSummary.slice(0, 120) })
      .where(eq(conversations.id, o.conversationId));
  }
  await emit(o.orgId, "message.created", { conversationId: o.conversationId, messageId: id, workerId: conv.workerId, kind: conv.kind, direction: "out", queued });

  if (!queued && !o.instant) {
    setTimeout(() => {
      void db
        .update(messages)
        .set({ status: "delivered" })
        .where(and(eq(messages.id, id), eq(messages.status, "sent")))
        .then(() => emit(o.orgId, "message.updated", { conversationId: o.conversationId, messageId: id }));
    }, 500);
  }

  await audit(o.orgId, {
    runId: o.runId,
    kind: "message_sent",
    title: o.auditTitle ?? `Messaged ${conv.title}${viaTemplate ? " (template)" : ""}${queued ? " (queued for morning)" : ""}`,
    detail: { conversationId: o.conversationId, messageId: id, type: finalPayload.type, template: viaTemplate ? (finalPayload as { template?: { name: string } }).template?.name : undefined, preview: textSummary.slice(0, 200) },
    manualMinutes: o.manualMinutes ?? 0,
  });

  return { ok: true, messageId: id, viaTemplate, queued, deliverAt };
}

/** Release held messages: all of them when the worker writes in, or only quiet-hours ones in the morning */
export async function flushHeld(orgId: string, conversationId: string, only?: "quiet") {
  const held = (
    await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.status, "queued")))
      .orderBy(asc(messages.createdAt))
  ).filter((m) => !only || m.annotation?.held === only);
  if (!held.length) return 0;
  const t = await now(orgId);
  for (const [i, m] of held.entries()) {
    await db
      .update(messages)
      .set({ status: "delivered", createdAt: new Date(t.getTime() + i) })
      .where(eq(messages.id, m.id));
  }
  await db.update(conversations).set({ lastMessageAt: t, lastMessagePreview: held[held.length - 1].text.slice(0, 120) }).where(eq(conversations.id, conversationId));
  await emit(orgId, "message.created", { conversationId, flushed: held.length });
  return held.length;
}

export async function setTyping(orgId: string, conversationId: string, on: boolean) {
  await emit(orgId, "typing", { conversationId, on });
}
