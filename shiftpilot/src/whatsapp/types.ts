/**
 * WhatsApp Cloud API message shapes. Outbound payloads are what we would POST to
 * /{phone-number-id}/messages (minus the messaging_product/to envelope); inbound
 * payloads mirror the webhook `messages[]` objects. Limits match Meta's docs.
 */
import { z } from "zod";

const replyButton = z.object({
  type: z.literal("reply"),
  reply: z.object({
    id: z.string().min(1).max(256),
    title: z.string().min(1).max(20, "Button titles must be 20 characters or fewer"),
  }),
});

const header = z
  .union([
    z.object({ type: z.literal("text"), text: z.string().max(60) }),
    z.object({ type: z.literal("image"), image: z.object({ link: z.string() }) }),
  ])
  .optional();

const body = z.object({ text: z.string().min(1).max(1024) });
const footer = z.object({ text: z.string().max(60) }).optional();

export const buttonInteractive = z.object({
  type: z.literal("button"),
  header,
  body,
  footer,
  action: z.object({ buttons: z.array(replyButton).min(1).max(3, "At most 3 reply buttons") }),
});

const listRow = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(24, "List row titles must be 24 characters or fewer"),
  description: z.string().max(72).optional(),
});

export const listInteractive = z
  .object({
    type: z.literal("list"),
    header: z.object({ type: z.literal("text"), text: z.string().max(60) }).optional(),
    body: z.object({ text: z.string().min(1).max(4096) }),
    footer,
    action: z.object({
      button: z.string().min(1).max(20),
      sections: z
        .array(z.object({ title: z.string().max(24).optional(), rows: z.array(listRow).min(1) }))
        .min(1)
        .max(10),
    }),
  })
  .refine((l) => l.action.sections.reduce((n, s) => n + s.rows.length, 0) <= 10, "A list can have at most 10 rows in total");

export const flowInteractive = z.object({
  type: z.literal("flow"),
  header: z.object({ type: z.literal("text"), text: z.string().max(60) }).optional(),
  body,
  footer,
  action: z.object({
    name: z.literal("flow"),
    parameters: z.object({
      flow_message_version: z.literal("3"),
      flow_id: z.string(),
      flow_cta: z.string().min(1).max(30),
      flow_token: z.string(),
      flow_action: z.literal("navigate"),
      flow_action_payload: z.object({ screen: z.string(), data: z.record(z.string(), z.unknown()).optional() }),
    }),
  }),
});

export const ctaUrlInteractive = z.object({
  type: z.literal("cta_url"),
  header,
  body,
  footer,
  action: z.object({
    name: z.literal("cta_url"),
    parameters: z.object({ display_text: z.string().min(1).max(20), url: z.string() }),
  }),
});

export const locationRequestInteractive = z.object({
  type: z.literal("location_request_message"),
  body,
  action: z.object({ name: z.literal("send_location") }),
});

export const interactiveSchema = z.union([
  buttonInteractive,
  listInteractive,
  flowInteractive,
  ctaUrlInteractive,
  locationRequestInteractive,
]);

const context = z.object({ message_id: z.string() }).optional();

export const outboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.object({ body: z.string().min(1).max(4096), preview_url: z.boolean().optional() }), context }),
  z.object({ type: z.literal("interactive"), interactive: interactiveSchema, context }),
  z.object({
    type: z.literal("template"),
    template: z.object({
      name: z.string(),
      language: z.object({ code: z.string() }),
      components: z.array(z.record(z.string(), z.unknown())),
    }),
  }),
  z.object({ type: z.literal("image"), image: z.object({ link: z.string(), caption: z.string().max(1024).optional() }), context }),
  z.object({
    type: z.literal("document"),
    document: z.object({ link: z.string(), filename: z.string(), caption: z.string().max(1024).optional() }),
    context,
  }),
  z.object({
    type: z.literal("location"),
    location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() }),
    context,
  }),
  z.object({ type: z.literal("reaction"), reaction: z.object({ message_id: z.string(), emoji: z.string() }) }),
]);

export type OutboundPayload = z.infer<typeof outboundSchema>;
export type Interactive = z.infer<typeof interactiveSchema>;

// ---------- inbound (webhook) shapes ----------

export type InboundPayload =
  | { type: "text"; text: { body: string }; context?: { id: string } }
  | {
      type: "interactive";
      interactive:
        | { type: "button_reply"; button_reply: { id: string; title: string } }
        | { type: "list_reply"; list_reply: { id: string; title: string; description?: string } }
        | { type: "nfm_reply"; nfm_reply: { name: "flow"; body: string; response_json: string } };
      context?: { id: string };
    }
  | { type: "button"; button: { payload: string; text: string }; context?: { id: string } }
  | { type: "location"; location: { latitude: number; longitude: number; name?: string; address?: string } }
  | { type: "image"; image: { id: string; mime_type: string; caption?: string } }
  | { type: "audio"; audio: { id: string; mime_type: string; voice: true; seconds?: number } }
  | { type: "reaction"; reaction: { message_id: string; emoji: string } };

/** Plain-text summary used for previews, search and LLM context */
export function payloadToText(p: Record<string, unknown>): string {
  const t = p.type as string;
  const any = p as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (t) {
    case "text":
      return any.text?.body ?? "";
    case "interactive": {
      const i = any.interactive;
      if (i?.type === "button_reply") return i.button_reply.title;
      if (i?.type === "list_reply") return i.list_reply.title;
      if (i?.type === "nfm_reply") return "[Form submitted]";
      return i?.body?.text ?? "";
    }
    case "button":
      return any.button?.text ?? "";
    case "template":
      return `[Template: ${any.template?.name}]`;
    case "image":
      return any.image?.caption ? `📷 ${any.image.caption}` : "📷 Photo";
    case "document":
      return `📄 ${any.document?.filename ?? "Document"}`;
    case "audio":
      return "🎤 Voice message";
    case "location":
      return `📍 ${any.location?.name ?? "Location"}`;
    case "reaction":
      return `Reacted ${any.reaction?.emoji ?? ""}`;
    default:
      return "";
  }
}

/** Helpers for composing payloads */
export const wa = {
  text: (body: string, contextId?: string): OutboundPayload => ({
    type: "text",
    text: { body },
    ...(contextId ? { context: { message_id: contextId } } : {}),
  }),
  buttons: (bodyText: string, buttons: { id: string; title: string }[], opts?: { header?: string; footer?: string; contextId?: string }): OutboundPayload => ({
    type: "interactive",
    interactive: {
      type: "button",
      ...(opts?.header ? { header: { type: "text" as const, text: opts.header } } : {}),
      body: { text: bodyText },
      ...(opts?.footer ? { footer: { text: opts.footer } } : {}),
      action: { buttons: buttons.map((b) => ({ type: "reply" as const, reply: b })) },
    },
    ...(opts?.contextId ? { context: { message_id: opts.contextId } } : {}),
  }),
  list: (
    bodyText: string,
    button: string,
    sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[],
    opts?: { header?: string; footer?: string },
  ): OutboundPayload => ({
    type: "interactive",
    interactive: {
      type: "list",
      ...(opts?.header ? { header: { type: "text" as const, text: opts.header } } : {}),
      body: { text: bodyText },
      ...(opts?.footer ? { footer: { text: opts.footer } } : {}),
      action: { button, sections },
    },
  }),
  flow: (bodyText: string, cta: string, flowId: string, token: string, screen: string, data?: Record<string, unknown>, opts?: { header?: string; footer?: string }): OutboundPayload => ({
    type: "interactive",
    interactive: {
      type: "flow",
      ...(opts?.header ? { header: { type: "text" as const, text: opts.header } } : {}),
      body: { text: bodyText },
      ...(opts?.footer ? { footer: { text: opts.footer } } : {}),
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_id: flowId,
          flow_cta: cta,
          flow_token: token,
          flow_action: "navigate",
          flow_action_payload: { screen, data },
        },
      },
    },
  }),
  locationRequest: (bodyText: string): OutboundPayload => ({
    type: "interactive",
    interactive: { type: "location_request_message", body: { text: bodyText }, action: { name: "send_location" } },
  }),
  location: (lat: number, lng: number, name: string, address: string): OutboundPayload => ({
    type: "location",
    location: { latitude: lat, longitude: lng, name, address },
  }),
  image: (link: string, caption?: string): OutboundPayload => ({ type: "image", image: { link, ...(caption ? { caption } : {}) } }),
  reaction: (messageId: string, emoji: string): OutboundPayload => ({ type: "reaction", reaction: { message_id: messageId, emoji } }),
};
