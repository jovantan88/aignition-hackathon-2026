/**
 * Pre-approved message templates (category UTILITY). Outside the 24-hour
 * customer service window WhatsApp only allows template messages, so every
 * proactive message has a template form.
 */
import type { OutboundPayload } from "./types";

type TemplateButton = { type: "quick_reply"; text: string } | { type: "flow"; text: string };

export type TemplateDef = {
  name: string;
  category: "UTILITY";
  header?: { type: "text"; text: string } | { type: "image" };
  body: string;
  footer?: string;
  buttons?: TemplateButton[];
};

export const TEMPLATES: Record<string, TemplateDef> = {
  weekly_availability: {
    name: "weekly_availability",
    category: "UTILITY",
    header: { type: "text", text: "Availability · {{1}}" },
    body: "Hi {{1}}! I'm planning the {{2}} roster for {{3}}. Tap *Fill availability* or just reply in your own words, e.g. \"Mon–Wed after 5, Sat whole day\". Please reply by {{4}} 🙏",
    footer: "ShiftPilot",
    buttons: [{ type: "flow", text: "Fill availability" }],
  },
  availability_reminder: {
    name: "availability_reminder",
    category: "UTILITY",
    body: "Hi {{1}}, gentle reminder: I still need your availability for {{2}}. It takes 30 seconds. Deadline is {{3}}.",
    buttons: [{ type: "flow", text: "Fill availability" }, { type: "quick_reply", text: "Not working that week" }],
  },
  shift_offer: {
    name: "shift_offer",
    category: "UTILITY",
    header: { type: "text", text: "Shift available" },
    body: "Hi {{1}}, a shift opened up that fits your availability:\n\n*{{2}}*\n📍 {{3}}\n🕒 {{4}}\n{{5}}\nWould you like it?",
    footer: "First to accept gets it",
    buttons: [{ type: "quick_reply", text: "Yes, I'll take it" }, { type: "quick_reply", text: "Can't, sorry" }],
  },
  urgent_cover: {
    name: "urgent_cover",
    category: "UTILITY",
    header: { type: "text", text: "⚡ Urgent: cover needed" },
    body: "Hi {{1}}, {{2}} needs someone *{{3}}* ({{4}}). {{5}}\nCan you make it?",
    footer: "Offer closes in {{1}} min",
    buttons: [{ type: "quick_reply", text: "Yes, I can go" }, { type: "quick_reply", text: "Can't" }],
  },
  roster_published: {
    name: "roster_published",
    category: "UTILITY",
    header: { type: "image" },
    body: "Hi {{1}}, your shifts for {{2}}:\n\n{{3}}\n\nTap *Confirm* so the team knows you've seen it.",
    footer: "Reply anytime to swap or ask",
    buttons: [{ type: "quick_reply", text: "Confirm ✅" }, { type: "quick_reply", text: "Problem with a shift" }],
  },
  roster_none: {
    name: "roster_none",
    category: "UTILITY",
    body: "Hi {{1}}, no shifts for you in {{2}} this time. {{3}} I'll message you first if something opens up 🙏",
    buttons: [{ type: "quick_reply", text: "Put me on standby" }, { type: "quick_reply", text: "OK, thanks" }],
  },
  shift_reminder: {
    name: "shift_reminder",
    category: "UTILITY",
    body: "Reminder for {{1}}: *{{2}}* at *{{3}}*, {{4}}. See you there!",
    buttons: [{ type: "quick_reply", text: "👍 I'll be there" }, { type: "quick_reply", text: "Can't make it" }],
  },
  approval_request: {
    name: "approval_request",
    category: "UTILITY",
    header: { type: "text", text: "Approval needed" },
    body: "*{{1}}*\n\n{{2}}",
    footer: "ShiftPilot waits for you before acting",
    buttons: [{ type: "quick_reply", text: "Approve" }, { type: "quick_reply", text: "Reject" }, { type: "quick_reply", text: "Details" }],
  },
  update_available: {
    name: "update_available",
    category: "UTILITY",
    body: "Hi {{1}}, ShiftPilot has an update about your shifts. Tap below to see it.",
    buttons: [{ type: "quick_reply", text: "Show me" }],
  },
};

export type TemplateParams = {
  header?: string[];
  headerImage?: string;
  body: string[];
  footer?: string[];
  /** One payload per quick_reply button, in order; flow buttons get a flow token */
  buttonPayloads?: (string | { flowId: string; flowToken: string; screen: string; data?: Record<string, unknown> })[];
};

const fill = (s: string, params: string[] = []) => s.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");

/** Build the Cloud API template payload */
export function templatePayload(name: keyof typeof TEMPLATES | string, p: TemplateParams): OutboundPayload {
  const def = TEMPLATES[name];
  if (!def) throw new Error(`Unknown template ${name}`);
  const components: Record<string, unknown>[] = [];
  if (def.header?.type === "text" && p.header) {
    components.push({ type: "header", parameters: p.header.map((text) => ({ type: "text", text })) });
  }
  if (def.header?.type === "image" && p.headerImage) {
    components.push({ type: "header", parameters: [{ type: "image", image: { link: p.headerImage } }] });
  }
  components.push({ type: "body", parameters: p.body.map((text) => ({ type: "text", text })) });
  if (p.footer) components.push({ type: "footer_params", parameters: p.footer });
  (def.buttons ?? []).forEach((b, index) => {
    const payload = p.buttonPayloads?.[index];
    if (b.type === "quick_reply" && typeof payload === "string") {
      components.push({ type: "button", sub_type: "quick_reply", index: String(index), parameters: [{ type: "payload", payload }] });
    }
    if (b.type === "flow" && payload && typeof payload === "object") {
      components.push({
        type: "button",
        sub_type: "flow",
        index: String(index),
        parameters: [{ type: "action", action: { flow_token: payload.flowToken, flow_id: payload.flowId, flow_action_data: { screen: payload.screen, ...payload.data } } }],
      });
    }
  });
  return { type: "template", template: { name: def.name, language: { code: "en" }, components } };
}

export type RenderedTemplate = {
  header?: { type: "text"; text: string } | { type: "image"; link: string };
  body: string;
  footer?: string;
  buttons: { type: "quick_reply" | "flow"; text: string; payload?: string; flow?: { flowId: string; flowToken: string; screen: string; data?: Record<string, unknown> } }[];
};

/** Resolve a stored template payload into displayable parts */
export function renderTemplate(payload: { template: { name: string; components: Record<string, unknown>[] } }): RenderedTemplate {
  const def = TEMPLATES[payload.template.name];
  const comps = payload.template.components as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const params = (type: string) => (comps.find((c) => c.type === type)?.parameters ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: RenderedTemplate = { body: "", buttons: [] };
  if (!def) return { body: `[${payload.template.name}]`, buttons: [] };
  if (def.header?.type === "text") out.header = { type: "text", text: fill(def.header.text, params("header").map((p) => p.text)) };
  if (def.header?.type === "image") {
    const link = params("header")[0]?.image?.link;
    if (link) out.header = { type: "image", link };
  }
  out.body = fill(def.body, params("body").map((p) => p.text));
  if (def.footer) out.footer = fill(def.footer, (comps.find((c) => c.type === "footer_params")?.parameters as string[]) ?? []);
  out.buttons = (def.buttons ?? []).map((b, index) => {
    const c = comps.find((x) => x.type === "button" && x.index === String(index));
    if (b.type === "flow") {
      const a = c?.parameters?.[0]?.action;
      return {
        type: "flow" as const,
        text: b.text,
        flow: a ? { flowId: a.flow_id, flowToken: a.flow_token, screen: a.flow_action_data?.screen, data: a.flow_action_data } : undefined,
      };
    }
    return { type: "quick_reply" as const, text: b.text, payload: c?.parameters?.[0]?.payload };
  });
  return out;
}

export function templateToText(payload: { template: { name: string; components: Record<string, unknown>[] } }) {
  const r = renderTemplate(payload);
  return [r.header?.type === "text" ? r.header.text : "", r.body].filter(Boolean).join("\n");
}
