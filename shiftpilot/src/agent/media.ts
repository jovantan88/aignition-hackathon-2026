/** Voice notes (transcription) and MC photos (vision check) */
import { generateText, Output, transcribe } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media, type Worker } from "@/db/schema";
import { fmtDay } from "@/lib/time";
import { fastModel, hasLLM, mainModel, transcriptionModel, withRetry } from "./llm";
import { describeShift, notifyManager, outletMap, saveMemory } from "./ops";
import { audit } from "./runs";

export async function transcribeVoice(orgId: string, mediaId: string) {
  const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
  if (!row || !hasLLM()) return null;
  const t0 = Date.now();
  try {
    const r = await withRetry(() =>
      transcribe({
        model: transcriptionModel(),
        audio: Buffer.from(row.data, "base64"),
        providerOptions: { openai: { prompt: "Singapore English / Singlish WhatsApp voice note to a shift manager about work shifts." } },
      }),
    );
    await db.update(media).set({ meta: { ...(row.meta ?? {}), transcript: r.text } }).where(eq(media.id, mediaId));
    await audit(orgId, { kind: "tool_result", title: "Transcribed a voice note", detail: { mediaId, transcript: r.text }, latencyMs: Date.now() - t0 });
    return r.text;
  } catch (e) {
    await audit(orgId, { kind: "error", title: "Couldn't transcribe a voice note", detail: { error: String(e) } });
    return null;
  }
}

/** Read an MC photo: who, which dates, which clinic. Only the dates are kept outside the restricted image. */
export async function reviewMc(orgId: string, worker: Worker, mediaId: string, shiftId?: string) {
  const row = await db.query.media.findFirst({ where: eq(media.id, mediaId) });
  if (!row) return null;
  await db.update(media).set({ restricted: true }).where(eq(media.id, mediaId));
  if (!hasLLM()) return null;
  const t0 = Date.now();
  try {
    const { output } = await withRetry(() =>
      generateText({
        model: mainModel(),
        reasoning: "low",
        output: Output.object({
          schema: z.object({
            isMedicalCertificate: z.boolean(),
            patientName: z.string().nullable(),
            clinic: z.string().nullable(),
            unfitFrom: z.string().nullable().describe("YYYY-MM-DD"),
            unfitTo: z.string().nullable().describe("YYYY-MM-DD"),
            nameMatches: z.boolean().describe(`Does the patient name plausibly match "${worker.name}"?`),
            looksAltered: z.boolean(),
          }),
        }),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Extract the key fields from this medical certificate. Do not output any diagnosis.` },
              { type: "file", mediaType: "image", data: Buffer.from(row.data, "base64") },
            ],
          },
        ],
      }),
    );
    if (!output) return null;
    await db.update(media).set({ meta: { ...(row.meta ?? {}), mc: output } }).where(eq(media.id, mediaId));
    const shift = shiftId ? await db.query.shifts.findFirst({ where: (s, { eq }) => eq(s.id, shiftId) }) : null;
    const outlet = shift ? (await outletMap(orgId)).get(shift.outletId) : null;
    const span = output.unfitFrom ? `${fmtDay(output.unfitFrom)}${output.unfitTo && output.unfitTo !== output.unfitFrom ? ` – ${fmtDay(output.unfitTo)}` : ""}` : "dates unclear";
    const covers = shift && output.unfitFrom && output.unfitTo ? shift.date >= output.unfitFrom && shift.date <= output.unfitTo : null;
    await notifyManager(
      orgId,
      output.isMedicalCertificate
        ? `🩺 MC received from *${worker.name}*: ${span}${output.clinic ? ` · ${output.clinic}` : ""}.${covers === true ? ` Covers ${shift ? describeShift(shift, outlet) : "the shift"} ✅` : covers === false ? " ⚠️ Doesn't cover the shift date" : ""}${!output.nameMatches ? " ⚠️ Name doesn't match" : ""}${output.looksAltered ? " ⚠️ Looks edited" : ""}\n_The photo is only visible to you in the dashboard._`
        : `📷 ${worker.name} sent a photo, but it doesn't look like an MC. You may want to check it in the dashboard.`,
    );
    if (output.isMedicalCertificate) {
      await saveMemory({ orgId, workerId: worker.id, kind: "fact", content: `MC provided for ${span}`, createdBy: "agent", expiresAt: output.unfitTo ?? null });
    }
    await audit(orgId, {
      kind: "tool_result",
      title: output.isMedicalCertificate ? `Checked ${worker.name}'s MC (${span})` : `Photo from ${worker.name} is not an MC`,
      detail: { mediaId, ...output, patientName: undefined },
      latencyMs: Date.now() - t0,
      manualMinutes: 3,
    });
    return output;
  } catch (e) {
    await audit(orgId, { kind: "error", title: "Couldn't read the MC photo", detail: { error: String(e) } });
    return null;
  }
}

export { fastModel };
