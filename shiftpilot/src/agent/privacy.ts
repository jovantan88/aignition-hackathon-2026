/**
 * Outbound privacy guard. Runs on every message before it is sent.
 * Offers and announcements must never reveal who dropped a shift or why,
 * and nobody's phone number goes out without manager approval.
 */
import { firstName } from "@/lib/names";

const PHONE = /(\+?65[\s-]?)?[689]\d{3}[\s-]?\d{4}\b/;
const HEALTH = /\b(sick|fever|flu|covid|mc\b|medical|hospital|clinic|diarrh|vomit|injur|pregnan|period cramps|migraine|surgery)\w*/i;
const PERSONAL = /\b(family emergency|passed away|funeral|break ?up|divorce|police)\b/i;

export type PrivacyContext = {
  purpose: "reply" | "offer" | "broadcast" | "reminder" | "notify" | "manager";
  /** Names of people whose absence must not be disclosed to others */
  protectedNames?: string[];
  /** The recipient may see their own details */
  recipientIsSubject?: boolean;
  allowPhone?: boolean;
};

export type PrivacyResult = { ok: boolean; issues: string[] };

export function checkPrivacy(text: string, ctx: PrivacyContext): PrivacyResult {
  const issues: string[] = [];
  if (ctx.purpose === "manager") return { ok: true, issues };
  if (!ctx.allowPhone && PHONE.test(text)) issues.push("contains a phone number");
  const toOthers = ctx.purpose === "offer" || ctx.purpose === "broadcast" || (ctx.purpose === "notify" && !ctx.recipientIsSubject);
  if (toOthers) {
    if (HEALTH.test(text)) issues.push("mentions health details in a message to other staff");
    if (PERSONAL.test(text)) issues.push("mentions someone's personal circumstances");
    for (const name of ctx.protectedNames ?? []) {
      const first = firstName(name).split(" ")[0];
      if (first.length > 2 && new RegExp(`\\b${first}\\b`, "i").test(text)) issues.push(`names ${first}, whose absence is private`);
    }
  }
  return { ok: issues.length === 0, issues };
}
