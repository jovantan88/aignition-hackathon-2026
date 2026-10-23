import { generateSpeech } from "ai";
import { db } from "@/db";
import { media } from "@/db/schema";
import { hasLLM, speechModel } from "@/agent/llm";
import { newId } from "@/lib/ids";

/** "Voice note by typing": synthesise real speech so the agent transcribes a real audio file */
export async function POST(req: Request) {
  if (!hasLLM()) return new Response("Voice notes need OPENAI_API_KEY", { status: 400 });
  const { orgId, text } = (await req.json()) as { orgId: string; text: string };
  const r = await generateSpeech({
    model: speechModel(),
    text,
    voice: "coral",
    outputFormat: "mp3",
    instructions: "A casual young Singaporean recording a quick WhatsApp voice note.",
  });
  const bytes = r.audio.uint8Array;
  const id = newId("med");
  const seconds = Math.max(2, Math.round(text.split(/\s+/).length / 2.6));
  await db.insert(media).values({ id, orgId, kind: "voice", mime: "audio/mpeg", data: Buffer.from(bytes).toString("base64"), bytes: bytes.length, meta: { seconds, synthetic: true } });
  return Response.json({ id, seconds, mime: "audio/mpeg" });
}
