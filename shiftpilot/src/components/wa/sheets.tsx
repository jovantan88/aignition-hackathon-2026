"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Camera, Check, ChevronDown, Home, MapPin, MoreVertical, Store, X } from "lucide-react";
import { flowDefFor, type FlowComponent } from "@/whatsapp/flows";
import { cn } from "@/lib/utils";
import type { ClientMessage, Place } from "./types";

export function Backdrop({ onClose }: { onClose: () => void }) {
  return <motion.div className="absolute inset-0 z-30 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />;
}

function SheetShell({ children, onClose, full }: { children: React.ReactNode; onClose: () => void; full?: boolean }) {
  return (
    <>
      <Backdrop onClose={onClose} />
      <motion.div
        className={cn("absolute inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl bg-white", full ? "top-6" : "max-h-[80%]")}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
      >
        {children}
      </motion.div>
    </>
  );
}

export function ListSheet({ m, onClose, onSelect }: { m: ClientMessage; onClose: () => void; onSelect: (row: { id: string; title: string; description?: string }) => void }) {
  const i = m.payload.interactive;
  const [sel, setSel] = useState<string | null>(null);
  const rows = (i.action.sections as { title?: string; rows: { id: string; title: string; description?: string }[] }[]).flatMap((s) => s.rows);
  return (
    <SheetShell onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-[#E9EDEF] px-4 py-3.5">
        <button type="button" onClick={onClose} className="text-[#54656F]">
          <X className="size-5" />
        </button>
        <div className="flex-1 text-center text-[16px] font-medium text-[#111B21]">{i.action.button}</div>
        <span className="w-5" />
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {(i.action.sections as { title?: string; rows: { id: string; title: string; description?: string }[] }[]).map((s, si) => (
          <div key={si}>
            {s.title && <div className="px-5 pt-3 pb-1 text-[13px] font-medium text-[#008069]">{s.title}</div>}
            {s.rows.map((r) => (
              <button key={r.id} type="button" onClick={() => setSel(r.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#F5F6F6]">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] text-[#111B21]">{r.title}</div>
                  {r.description && <div className="text-[13px] text-[#667781]">{r.description}</div>}
                </div>
                <span className={cn("flex size-5 items-center justify-center rounded-full border-2", sel === r.id ? "border-[#1DAA61]" : "border-[#8696A0]")}>
                  {sel === r.id && <span className="size-2.5 rounded-full bg-[#1DAA61]" />}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-[#E9EDEF] p-3">
        <button
          type="button"
          disabled={!sel}
          onClick={() => {
            const row = rows.find((r) => r.id === sel);
            if (row) onSelect(row);
          }}
          className="w-full rounded-full bg-[#1DAA61] py-2.5 text-[15px] font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </SheetShell>
  );
}

type Answers = Record<string, string | string[] | { media_id: string; file_name: string }[] | undefined>;

export function FlowSheet({
  flow,
  orgId,
  onClose,
  onSubmit,
}: {
  flow: { flowId: string; flowToken: string; screen: string; data?: Record<string, unknown> };
  orgId: string;
  onClose: () => void;
  onSubmit: (response: Record<string, unknown>) => void;
}) {
  const def = useMemo(() => flowDefFor(flow.flowId, flow.data ?? {}), [flow]);
  const [screenIdx, setScreenIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  if (!def) return null;
  const screen = def.screens[screenIdx];
  const set = (name: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [name]: v }));
  const missing = screen.components.some(
    (c) => "required" in c && c.required && "name" in c && (answers[c.name] == null || (Array.isArray(answers[c.name]) && !(answers[c.name] as unknown[]).length)),
  );

  const next = () => {
    if (screen.footer.next) {
      const idx = def.screens.findIndex((s) => s.id === screen.footer.next);
      setScreenIdx(idx);
      return;
    }
    setBusy(true);
    onSubmit({ flow_token: flow.flowToken, flow_id: flow.flowId, ...answers });
  };

  return (
    <SheetShell onClose={onClose} full>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button type="button" onClick={screenIdx > 0 ? () => setScreenIdx(screenIdx - 1) : onClose} className="text-[#54656F]">
          {screenIdx > 0 ? <ArrowLeft className="size-5" /> : <X className="size-5" />}
        </button>
        <div className="flex-1 text-center text-[16px] font-medium text-[#111B21]">{screen.title}</div>
        <MoreVertical className="size-5 text-[#54656F]" />
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 pt-2 pb-6">
        {screen.components.map((c, i) => (
          <FlowField key={i} c={c} value={"name" in c ? answers[c.name] : undefined} set={set} orgId={orgId} />
        ))}
      </div>
      <div className="border-t border-[#E9EDEF] px-5 py-3">
        <button type="button" disabled={missing || busy} onClick={next} className="w-full rounded-full bg-[#1DAA61] py-2.5 text-[15px] font-medium text-white disabled:opacity-40">
          {busy ? "Sending…" : screen.footer.label}
        </button>
        <div className="mt-2 text-center text-[11px] text-[#8696A0]">Managed by the business. Learn more</div>
      </div>
    </SheetShell>
  );
}

function FlowField({ c, value, set, orgId }: { c: FlowComponent; value: Answers[string]; set: (n: string, v: Answers[string]) => void; orgId: string }) {
  const label = (t: string) => <div className="mb-2 text-[14px] font-medium text-[#111B21]">{t}</div>;
  switch (c.type) {
    case "TextHeading":
      return <div className="text-[20px] font-semibold text-[#111B21]">{c.text}</div>;
    case "TextBody":
      return <div className="text-[14.5px] text-[#3B4A54]">{c.text}</div>;
    case "TextCaption":
      return <div className="-mt-3 text-[12.5px] text-[#667781]">{c.text}</div>;
    case "ChipsSelector": {
      const v = (value as string[]) ?? [];
      return (
        <div>
          {label(c.label)}
          <div className="flex flex-wrap gap-2">
            {c.options.map((o) => {
              const on = v.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => set(c.name, on ? v.filter((x) => x !== o.id) : [...v, o.id])}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors",
                    on ? "border-[#1DAA61] bg-[#E7F8EE] text-[#0A7A42]" : "border-[#D1D7DB] text-[#3B4A54]",
                  )}
                >
                  {on && <Check className="size-3.5" />}
                  {o.title}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "CheckboxGroup": {
      const v = (value as string[]) ?? [];
      return (
        <div>
          {label(c.label)}
          <div className="divide-y divide-[#F0F2F5] rounded-lg border border-[#E9EDEF]">
            {c.options.map((o) => {
              const on = v.includes(o.id);
              return (
                <button key={o.id} type="button" onClick={() => set(c.name, on ? v.filter((x) => x !== o.id) : [...v, o.id])} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                  <span className={cn("flex size-[18px] items-center justify-center rounded-[4px] border-2", on ? "border-[#1DAA61] bg-[#1DAA61]" : "border-[#8696A0]")}>
                    {on && <Check className="size-3 text-white" strokeWidth={3} />}
                  </span>
                  <span className="text-[14.5px] text-[#111B21]">{o.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "RadioButtonsGroup":
      return (
        <div>
          {label(c.label)}
          <div className="divide-y divide-[#F0F2F5] rounded-lg border border-[#E9EDEF]">
            {c.options.map((o) => (
              <button key={o.id} type="button" onClick={() => set(c.name, o.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                <span className={cn("flex size-5 items-center justify-center rounded-full border-2", value === o.id ? "border-[#1DAA61]" : "border-[#8696A0]")}>
                  {value === o.id && <span className="size-2.5 rounded-full bg-[#1DAA61]" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] text-[#111B21]">{o.title}</span>
                  {o.description && <span className="block text-[12.5px] text-[#667781]">{o.description}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    case "Dropdown":
      return (
        <div>
          {label(c.label)}
          <div className="relative">
            <select
              value={(value as string) ?? ""}
              onChange={(e) => set(c.name, e.target.value)}
              className="w-full appearance-none rounded-lg border border-[#D1D7DB] bg-white px-3 py-2.5 text-[14.5px] text-[#111B21] outline-none focus:border-[#1DAA61]"
            >
              <option value="" disabled>
                Select
              </option>
              {c.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[#54656F]" />
          </div>
        </div>
      );
    case "DatePicker":
      return (
        <div>
          {label(c.label)}
          <input
            type="date"
            min={c.minDate}
            max={c.maxDate}
            value={(value as string) ?? ""}
            onChange={(e) => set(c.name, e.target.value)}
            className="w-full rounded-lg border border-[#D1D7DB] px-3 py-2.5 text-[14.5px] outline-none focus:border-[#1DAA61]"
          />
        </div>
      );
    case "TextArea":
    case "TextInput":
      return (
        <div>
          {label(c.label)}
          {c.type === "TextArea" ? (
            <textarea
              rows={3}
              value={(value as string) ?? ""}
              onChange={(e) => set(c.name, e.target.value)}
              placeholder={c.helper}
              className="w-full resize-none rounded-lg border border-[#D1D7DB] px-3 py-2.5 text-[14.5px] outline-none placeholder:text-[#8696A0] focus:border-[#1DAA61]"
            />
          ) : (
            <input
              value={(value as string) ?? ""}
              onChange={(e) => set(c.name, e.target.value)}
              placeholder={c.helper}
              className="w-full rounded-lg border border-[#D1D7DB] px-3 py-2.5 text-[14.5px] outline-none focus:border-[#1DAA61]"
            />
          )}
        </div>
      );
    case "PhotoPicker": {
      const v = (value as { media_id: string; file_name: string }[]) ?? [];
      return (
        <div>
          {label(c.label)}
          {c.description && <div className="-mt-1 mb-2 text-[12.5px] text-[#667781]">{c.description}</div>}
          <div className="flex items-center gap-2">
            {v.map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f.media_id} src={`/api/media/${f.media_id}`} alt="" className="size-16 rounded-md object-cover" />
            ))}
            <label className="flex size-16 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-[#8696A0] text-[#54656F]">
              <Camera className="size-5" />
              <span className="text-[10px]">Add</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const id = await uploadImage(f, orgId);
                  set(c.name, [...v, { media_id: id, file_name: f.name }]);
                }}
              />
            </label>
          </div>
        </div>
      );
    }
  }
}

/** Downscale and upload an image, returning the media id */
export async function uploadImage(file: File | Blob, orgId: string) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const res = await fetch("/api/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, kind: "image", mime: "image/jpeg", data: dataUrl.split(",")[1] }),
  });
  return ((await res.json()) as { id: string }).id;
}

export function LocationSheet({ places, onClose, onPick }: { places: Place[]; onClose: () => void; onPick: (p: Place) => void }) {
  return (
    <SheetShell onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-[#E9EDEF] px-4 py-3.5">
        <button type="button" onClick={onClose} className="text-[#54656F]">
          <X className="size-5" />
        </button>
        <div className="flex-1 text-[16px] font-medium text-[#111B21]">Send location</div>
      </div>
      <div className="overflow-y-auto py-1">
        <div className="px-5 pt-2 pb-1 text-[12.5px] text-[#667781]">Simulated GPS: pick where this phone is right now</div>
        {places.map((p) => (
          <button key={p.label} type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#F5F6F6]">
            <span className="flex size-10 items-center justify-center rounded-full bg-[#1DAA61] text-white">
              {p.kind === "outlet" ? <Store className="size-5" /> : <Home className="size-5" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] text-[#111B21]">{p.label}</span>
              <span className="block truncate text-[12.5px] text-[#667781]">{p.address}</span>
            </span>
            <MapPin className="ml-auto size-4 text-[#8696A0]" />
          </button>
        ))}
      </div>
    </SheetShell>
  );
}

export function ReactionBar({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="absolute inset-0 z-30" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="absolute top-1/3 left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-full bg-white px-3 py-2 shadow-lg"
      >
        {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)} className="text-[26px] transition-transform hover:scale-125">
            {e}
          </button>
        ))}
      </motion.div>
    </>
  );
}
