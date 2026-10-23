import { describe, expect, it } from "vitest";
import { checkPrivacy } from "@/agent/privacy";
import { firstName } from "@/lib/names";
import { addDays, atLocal, dowOf, isoWeek, localParts, weekStartOf } from "@/lib/time";
import { renderTemplate, templatePayload } from "@/whatsapp/templates";
import { outboundSchema, wa } from "@/whatsapp/types";

describe("WhatsApp limits", () => {
  it("accepts valid interactive messages", () => {
    expect(outboundSchema.safeParse(wa.buttons("Take it?", [{ id: "y", title: "Yes" }, { id: "n", title: "No" }])).success).toBe(true);
  });
  it("rejects more than 3 buttons or long titles", () => {
    const four = wa.buttons("x", [1, 2, 3, 4].map((i) => ({ id: String(i), title: `B${i}` })));
    expect(outboundSchema.safeParse(four).success).toBe(false);
    expect(outboundSchema.safeParse(wa.buttons("x", [{ id: "a", title: "This title is far too long" }])).success).toBe(false);
  });
  it("rejects lists with more than 10 rows in total", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` }));
    expect(outboundSchema.safeParse(wa.list("Pick", "Options", [{ rows }])).success).toBe(false);
    expect(outboundSchema.safeParse(wa.list("Pick", "Options", [{ rows: rows.slice(0, 10) }])).success).toBe(true);
  });
  it("renders templates with parameters and button payloads", () => {
    const p = templatePayload("shift_offer", { body: ["Mei", "Sat 31 Oct, 8am–2pm", "Jurong East", "Opening", ""], buttonPayloads: ["offer:accept:1", "offer:decline:1"] });
    const r = renderTemplate(p as never);
    expect(r.body).toContain("Hi Mei");
    expect(r.buttons.map((b) => b.payload)).toEqual(["offer:accept:1", "offer:decline:1"]);
  });
});

describe("privacy guard", () => {
  it("blocks health details and the absent person's name in offers", () => {
    const r = checkPrivacy("Mei has a fever, can you cover?", { purpose: "offer", protectedNames: ["Mei Lin Tan"] });
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBe(2);
  });
  it("allows the same words in a reply to the person themself", () => {
    expect(checkPrivacy("Rest well and get better soon, send your MC when you can", { purpose: "reply" }).ok).toBe(true);
  });
  it("blocks phone numbers", () => {
    expect(checkPrivacy("call him at 9123 4567", { purpose: "reply" }).ok).toBe(false);
  });
});

describe("time helpers (Singapore)", () => {
  it("resolves local dates, weeks and day-of-week", () => {
    const d = atLocal("2026-10-22", "23:30");
    expect(localParts(d).date).toBe("2026-10-22");
    expect(localParts(d).minutes).toBe(23 * 60 + 30);
    expect(dowOf("2026-10-22")).toBe(3); // Thursday
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19");
    expect(isoWeek("2026-10-22")).toBe(43);
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("names", () => {
  it("uses the name people are called by", () => {
    expect(firstName("Ho Siew Ling")).toBe("Siew Ling");
    expect(firstName("Mei Lin Tan")).toBe("Mei Lin");
    expect(firstName("Nur Syafiqah")).toBe("Syafiqah");
    expect(firstName("Ravi Kumar")).toBe("Ravi");
  });
});
