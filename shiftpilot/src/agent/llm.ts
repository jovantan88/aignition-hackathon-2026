import { createOpenAI } from "@ai-sdk/openai";

const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const MODEL_MAIN = process.env.OPENAI_MODEL || "gpt-6.1-sol";
export const MODEL_FAST = process.env.OPENAI_MODEL_FAST || "gpt-6-luna";
export const MODEL_TRANSCRIBE = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
export const MODEL_TTS = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";

export const mainModel = () => provider(MODEL_MAIN);
export const fastModel = () => provider(MODEL_FAST);
export const transcriptionModel = () => provider.transcription(MODEL_TRANSCRIBE);
export const speechModel = () => provider.speech(MODEL_TTS);

export const hasLLM = () => Boolean(process.env.OPENAI_API_KEY);

/** Retry transient LLM failures with backoff */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw last;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
