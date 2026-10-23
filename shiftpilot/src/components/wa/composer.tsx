"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Camera, FileHeart, Image as ImageIcon, MapPin, Mic, Paperclip, SendHorizontal, Smile, Square, Trash2, Type, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadImage } from "./sheets";
import type { ClientMessage } from "./types";

const EMOJIS = ["😅", "🙏", "😭", "👍", "🙂", "😂", "🥲", "🤒", "🤧", "😷", "🏥", "🚌", "⏰", "✅", "❌", "☕", "🧋", "💪", "🙌", "❤️", "😴", "📚", "🤞", "😬"];

async function blobToBase64(b: Blob) {
  const buf = await b.arrayBuffer();
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function Composer({
  orgId,
  quoting,
  clearQuote,
  nameOf,
  onSend,
  onOpenLocation,
  disabled,
  sampleMcUrl,
}: {
  orgId: string;
  quoting: ClientMessage | null;
  clearQuote: () => void;
  nameOf: (m: ClientMessage) => string;
  onSend: (payload: Record<string, unknown>) => Promise<void> | void;
  onOpenLocation: () => void;
  disabled?: boolean;
  sampleMcUrl?: string;
}) {
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [attach, setAttach] = useState(false);
  const [rec, setRec] = useState<{ start: number; mr: MediaRecorder; chunks: Blob[] } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [voiceType, setVoiceType] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - rec.start) / 1000)), 250);
    return () => clearInterval(t);
  }, [rec]);

  const ctx = quoting ? { context: { id: quoting.id } } : {};

  const sendText = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    clearQuote();
    await onSend({ type: "text", text: { body }, ...ctx });
    inputRef.current?.focus();
  };

  const sendImage = async (file: File | Blob, caption?: string) => {
    setBusy(true);
    try {
      const id = await uploadImage(file, orgId);
      await onSend({ type: "image", image: { id, mime_type: "image/jpeg", ...(caption ? { caption } : {}) }, ...ctx });
      clearQuote();
    } finally {
      setBusy(false);
    }
  };

  const sendSampleMc = async () => {
    setAttach(false);
    const res = await fetch(sampleMcUrl ?? "/api/og/mc");
    await sendImage(await res.blob());
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.start();
      setElapsed(0);
      setRec({ start: Date.now(), mr, chunks });
    } catch {
      // No microphone (e.g. embedded browser): type what you'd say instead
      setVoiceType(true);
    }
  };

  const stopRec = async (send: boolean) => {
    if (!rec) return;
    const { mr, chunks, start } = rec;
    const done = new Promise<void>((r) => (mr.onstop = () => r()));
    mr.stop();
    mr.stream.getTracks().forEach((t) => t.stop());
    await done;
    setRec(null);
    if (!send) return;
    setBusy(true);
    try {
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      const data = await blobToBase64(blob);
      const r = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, kind: "voice", mime: blob.type, data, meta: { seconds: (Date.now() - start) / 1000 } }),
      });
      const { id } = (await r.json()) as { id: string };
      await onSend({ type: "audio", audio: { id, mime_type: blob.type, voice: true, seconds: Math.round((Date.now() - start) / 1000) } });
    } finally {
      setBusy(false);
    }
  };

  const sendTypedVoice = async () => {
    const words = voiceText.trim();
    if (!words) return;
    setBusy(true);
    try {
      const r = await fetch("/api/media/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, text: words }) });
      if (!r.ok) throw new Error(await r.text());
      const { id, seconds, mime } = (await r.json()) as { id: string; seconds: number; mime: string };
      await onSend({ type: "audio", audio: { id, mime_type: mime, voice: true, seconds } });
      setVoiceType(false);
      setVoiceText("");
    } catch (e) {
      alert(`Voice note failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0 px-1.5 pt-1 pb-2">
      <AnimatePresence>
        {(emoji || attach) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute right-2 bottom-full left-2 z-20 mb-1 rounded-2xl bg-white p-3 shadow-lg"
          >
            {emoji && (
              <div className="grid grid-cols-8 gap-1">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" className="rounded-md p-1 text-[22px] hover:bg-[#F0F2F5]" onClick={() => setText((t) => t + e)}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            {attach && (
              <div className="grid grid-cols-4 gap-3 text-center text-[11.5px] text-[#54656F]">
                <AttachBtn color="#7F66FF" icon={<ImageIcon className="size-5" />} label="Photo" onClick={() => (setAttach(false), fileRef.current?.click())} />
                <AttachBtn color="#1DAA61" icon={<MapPin className="size-5" />} label="Location" onClick={() => (setAttach(false), onOpenLocation())} />
                <AttachBtn color="#FF2E74" icon={<FileHeart className="size-5" />} label="Sample MC" onClick={sendSampleMc} />
                <AttachBtn color="#0795DC" icon={<Type className="size-5" />} label="Voice (type)" onClick={() => (setAttach(false), setVoiceType(true))} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {voiceType && (
        <div className="absolute right-2 bottom-full left-2 z-20 mb-1 rounded-2xl bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between text-[13px] font-medium text-[#111B21]">
            <span>🎤 Voice note: type what you&apos;d say</span>
            <button type="button" onClick={() => setVoiceType(false)}>
              <X className="size-4 text-[#54656F]" />
            </button>
          </div>
          <textarea
            autoFocus
            rows={2}
            value={voiceText}
            onChange={(e) => setVoiceText(e.target.value)}
            placeholder="sorry ah i cannot come tmr, got fever since last night"
            className="w-full resize-none rounded-lg border border-[#D1D7DB] px-2.5 py-2 text-[14px] outline-none focus:border-[#1DAA61]"
          />
          <div className="mt-1 text-[11px] text-[#8696A0]">Turned into real speech, sent as audio, transcribed by the agent.</div>
          <button type="button" disabled={busy} onClick={sendTypedVoice} className="mt-2 w-full rounded-full bg-[#1DAA61] py-2 text-[14px] font-medium text-white disabled:opacity-50">
            {busy ? "Recording…" : "Send voice note"}
          </button>
        </div>
      )}

      {quoting && (
        <div className="mx-1 mb-1 flex items-start gap-2 rounded-t-xl bg-white px-2 pt-2">
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-md bg-[#F0F2F5]">
            <span className="w-1 shrink-0 bg-[#06CF9C]" />
            <div className="min-w-0 px-2 py-1.5">
              <div className="text-[12.5px] font-medium text-[#06CF9C]">{nameOf(quoting)}</div>
              <div className="truncate text-[12.5px] text-[#667781]">{quoting.text}</div>
            </div>
          </div>
          <button type="button" onClick={clearQuote}>
            <X className="size-4 text-[#54656F]" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {rec ? (
          <div className="flex h-[46px] flex-1 items-center gap-3 rounded-full bg-white px-4 text-[15px]">
            <button type="button" onClick={() => stopRec(false)}>
              <Trash2 className="size-5 text-[#54656F]" />
            </button>
            <span className="size-2.5 animate-pulse rounded-full bg-[#F15C6D]" />
            <span className="font-mono text-[#54656F]">0:{String(elapsed).padStart(2, "0")}</span>
            <span className="flex-1 text-[13px] text-[#8696A0]">Recording…</span>
          </div>
        ) : (
          <div className={cn("flex min-h-[46px] flex-1 items-end gap-1 rounded-[23px] bg-white px-2 py-1.5", quoting && "rounded-t-none")}>
            <button type="button" onClick={() => (setEmoji(!emoji), setAttach(false))} className="p-1.5 text-[#54656F]">
              <Smile className="size-[22px]" />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendText();
                }
              }}
              onFocus={() => (setEmoji(false), setAttach(false))}
              placeholder="Message"
              className="max-h-28 min-h-[22px] flex-1 resize-none bg-transparent py-1.5 text-[15px] text-[#111B21] outline-none placeholder:text-[#8696A0]"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            <button type="button" onClick={() => (setAttach(!attach), setEmoji(false))} className="p-1.5 text-[#54656F]">
              <Paperclip className="size-[21px] -rotate-45" />
            </button>
            {!text && (
              <button type="button" onClick={() => fileRef.current?.click()} className="p-1.5 text-[#54656F]">
                <Camera className="size-[21px]" />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => (rec ? stopRec(true) : text.trim() ? sendText() : startRec())}
          className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-[#1DAA61] text-white shadow-sm active:scale-95 disabled:opacity-60"
        >
          {rec ? <Square className="size-4 fill-current" /> : text.trim() ? <SendHorizontal className="size-5" /> : <Mic className="size-5" />}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void sendImage(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function AttachBtn({ color, icon, label, onClick }: { color: string; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1">
      <span className="flex size-12 items-center justify-center rounded-full text-white" style={{ background: color }}>
        {icon}
      </span>
      {label}
    </button>
  );
}
