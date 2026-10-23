"use client";

import { useRef, useState } from "react";
import { CornerUpLeft, ExternalLink, FileText, List, MapPin, Pause, Play, Reply, SmilePlus } from "lucide-react";
import { renderTemplate } from "@/whatsapp/templates";
import { cn } from "@/lib/utils";
import { WaText } from "./format";
import type { ClientMessage, WaActions } from "./types";

const fmtHM = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" });

export function Ticks({ status }: { status: ClientMessage["status"] }) {
  if (status === "queued")
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" className="text-[#8696A0]" aria-label="Queued">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 4.5V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  const read = status === "read";
  const double = status === "delivered" || read;
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" aria-label={status} className={read ? "text-[#53BDEB]" : "text-[#8696A0]"}>
      {double ? (
        <>
          <path d="M11.07.65 4.6 8.6 1.6 5.9.5 7.1l4.2 3.8L12.3 1.6z" fill="currentColor" />
          <path d="M15.07.65 8.6 8.6l-.95-.86-1.07 1.3 2.13 1.86L16.3 1.6z" fill="currentColor" />
        </>
      ) : (
        <path d="M13.07.65 6.6 8.6 3.6 5.9 2.5 7.1l4.2 3.8L14.3 1.6z" fill="currentColor" />
      )}
    </svg>
  );
}

function Meta({ m, mine, onDark }: { m: ClientMessage; mine: boolean; onDark?: boolean }) {
  return (
    <span className={cn("float-right ml-2 mt-1 inline-flex translate-y-1 items-center gap-1 text-[11px] leading-none", onDark ? "text-white/90" : "text-[#667781]")}>
      {m.template && <span className="mr-0.5 rounded-sm border border-current/30 px-1 text-[9px] tracking-wide uppercase opacity-80">tmpl</span>}
      {fmtHM(m.createdAt)}
      {mine && <Ticks status={m.status} />}
    </span>
  );
}

function ActionRow({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 border-t border-black/[0.07] py-2.5 text-[14px] font-medium text-[#027EB5] enabled:hover:bg-black/[0.03] enabled:active:bg-black/[0.06] disabled:cursor-default"
    >
      {icon}
      {label}
    </button>
  );
}

function VoiceNote({ src, seconds, mine }: { src: string; seconds?: number; mine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bars = Array.from({ length: 28 }, (_, i) => 4 + Math.abs(Math.sin(i * 1.7 + src.length)) * 14);
  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(src);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) audioRef.current.pause();
    else void audioRef.current.play();
    setPlaying(!playing);
  };
  return (
    <div className="flex w-[240px] items-center gap-2.5 py-1">
      <button type="button" onClick={toggle} className="text-[#54656F]">
        {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
      </button>
      <div className="flex h-6 flex-1 items-center gap-[2px]">
        {bars.map((h, i) => (
          <span key={i} className={cn("w-[3px] rounded-full", mine ? "bg-[#7DB58C]" : "bg-[#B4BCC0]")} style={{ height: h }} />
        ))}
      </div>
      <span className="text-[11px] text-[#667781]">{seconds ? `0:${String(Math.round(seconds)).padStart(2, "0")}` : "0:05"}</span>
    </div>
  );
}

function LocationCard({ lat, lng, name, address }: { lat: number; lng: number; name?: string; address?: string }) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const img = token
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+ff4f1a(${lng},${lat})/${lng},${lat},15,0/280x140@2x?access_token=${token}&logo=false&attribution=false`
    : null;
  return (
    <div className="-mx-1 -mt-1 mb-1 w-[262px] overflow-hidden rounded-md">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="h-[130px] w-full object-cover" />
      ) : (
        <div className="relative h-[130px] w-full bg-[#E8E3D6]">
          <svg className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 260 130" preserveAspectRatio="none">
            <path d="M0 90 Q60 70 120 85 T260 60" stroke="#fff" strokeWidth="9" fill="none" />
            <path d="M80 0 L95 130" stroke="#fff" strokeWidth="6" />
            <path d="M0 30 L260 45" stroke="#fff" strokeWidth="4" />
          </svg>
          <MapPin className="absolute top-1/2 left-1/2 size-7 -translate-x-1/2 -translate-y-full fill-[#FF4F1A] text-[#9a2a0a]" />
        </div>
      )}
      <div className="px-1 pt-1.5">
        {name && <div className="text-[13.5px] font-medium text-[#111B21]">{name}</div>}
        {address && <div className="text-[12px] text-[#667781]">{address}</div>}
      </div>
    </div>
  );
}

function Quote({ quoted, mine, nameOf }: { quoted: ClientMessage; mine: boolean; nameOf: (m: ClientMessage) => string }) {
  const color = quoted.direction === "out" ? "#06CF9C" : "#7F66FF";
  return (
    <div className={cn("-mx-0.5 mb-1 flex overflow-hidden rounded-md", mine ? "bg-[#D1F4CC]" : "bg-[#F5F6F6]")}>
      <span className="w-1 shrink-0" style={{ background: color }} />
      <div className="min-w-0 px-2 py-1.5">
        <div className="text-[12.5px] font-medium" style={{ color }}>
          {nameOf(quoted)}
        </div>
        <div className="line-clamp-2 text-[12.5px] text-[#667781]">{(quoted.text || quoted.type).replace(/[*_~`]/g, "")}</div>
      </div>
    </div>
  );
}

export function MessageBubble({
  m,
  mine,
  first,
  quoted,
  reactions,
  actions,
  interactive,
  senderName,
  senderHue,
  nameOf,
  showAnnotation,
}: {
  m: ClientMessage;
  mine: boolean;
  first: boolean;
  quoted?: ClientMessage;
  reactions?: string[];
  actions?: WaActions;
  interactive: boolean;
  senderName?: string;
  senderHue?: number;
  nameOf: (m: ClientMessage) => string;
  showAnnotation?: boolean;
}) {
  const p = m.payload;
  const bg = mine ? "bg-[#D9FDD3]" : "bg-white";
  let body: React.ReactNode = null;
  let rows: React.ReactNode = null;
  let wide = false;

  const flowFromInteractive = () => {
    const prm = p.interactive.action.parameters;
    return { flowId: prm.flow_id, flowToken: prm.flow_token, screen: prm.flow_action_payload?.screen, data: prm.flow_action_payload?.data };
  };

  switch (m.type) {
    case "text":
      body = <WaText text={p.text?.body ?? ""} />;
      break;
    case "interactive": {
      const i = p.interactive;
      if (i.type === "button_reply" || i.type === "list_reply") {
        body = <WaText text={i.button_reply?.title ?? i.list_reply?.title} />;
        break;
      }
      if (i.type === "nfm_reply") {
        body = (
          <div className="flex items-center gap-2 py-0.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-[#1DAA61]/15 text-[#1DAA61]">✓</span>
            <div>
              <div className="text-[13.5px] font-medium">Response sent</div>
              <div className="text-[12px] text-[#667781]">Form submitted</div>
            </div>
          </div>
        );
        break;
      }
      body = (
        <>
          {i.header?.type === "text" && <div className="mb-0.5 text-[14.5px] font-semibold">{i.header.text}</div>}
          <WaText text={i.body?.text ?? ""} />
          {i.footer?.text && <div className="mt-1 text-[12.5px] text-[#667781]">{i.footer.text}</div>}
        </>
      );
      if (i.type === "button") {
        rows = i.action.buttons.map((b: { reply: { id: string; title: string } }) => (
          <ActionRow
            key={b.reply.id}
            icon={<CornerUpLeft className="size-4" />}
            label={b.reply.title}
            disabled={!interactive}
            onClick={() => actions?.reply({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: b.reply.id, title: b.reply.title } }, context: { id: m.id } })}
          />
        ));
      } else if (i.type === "list") {
        rows = <ActionRow icon={<List className="size-4" />} label={i.action.button} disabled={!interactive} onClick={() => actions?.openList(m)} />;
      } else if (i.type === "flow") {
        rows = <ActionRow icon={<ExternalLink className="size-4" />} label={i.action.parameters.flow_cta} disabled={!interactive} onClick={() => actions?.openFlow(m, flowFromInteractive())} />;
      } else if (i.type === "cta_url") {
        rows = <ActionRow icon={<ExternalLink className="size-4" />} label={i.action.parameters.display_text} onClick={() => window.open(i.action.parameters.url, "_blank")} />;
      } else if (i.type === "location_request_message") {
        rows = <ActionRow icon={<MapPin className="size-4" />} label="Send location" disabled={!interactive} onClick={() => actions?.requestLocation(m)} />;
      }
      break;
    }
    case "button":
      body = <WaText text={p.button?.text ?? ""} />;
      break;
    case "template": {
      const r = renderTemplate(p as never);
      wide = r.header?.type === "image";
      body = (
        <>
          {r.header?.type === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.header.link} alt="" className="-mx-1 -mt-1 mb-1.5 block w-[calc(100%+8px)] max-w-none rounded-md bg-[#F3EFE6]" />
          )}
          {r.header?.type === "text" && <div className="mb-0.5 text-[14.5px] font-semibold">{r.header.text}</div>}
          <WaText text={r.body} />
          {r.footer && <div className="mt-1 text-[12.5px] text-[#667781]">{r.footer}</div>}
        </>
      );
      rows = r.buttons.map((b, idx) =>
        b.type === "flow" ? (
          <ActionRow key={idx} icon={<ExternalLink className="size-4" />} label={b.text} disabled={!interactive || !b.flow} onClick={() => b.flow && actions?.openFlow(m, b.flow)} />
        ) : (
          <ActionRow
            key={idx}
            icon={<CornerUpLeft className="size-4" />}
            label={b.text}
            disabled={!interactive}
            onClick={() => actions?.reply({ type: "button", button: { payload: b.payload ?? b.text, text: b.text }, context: { id: m.id } })}
          />
        ),
      );
      break;
    }
    case "image": {
      const src = p.image?.link ?? (p.image?.id ? `/api/media/${p.image.id}` : "");
      wide = true;
      body = (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="-mx-1 -mt-1 mb-1 block max-h-[320px] w-[calc(100%+8px)] max-w-none rounded-md object-cover" />
          {p.image?.caption && <WaText text={p.image.caption} />}
        </>
      );
      break;
    }
    case "document":
      body = (
        <div className="flex items-center gap-2 rounded-md bg-black/[0.04] p-2">
          <FileText className="size-8 text-[#E25B4E]" />
          <div className="text-[13.5px]">{p.document?.filename}</div>
        </div>
      );
      break;
    case "audio":
      body = <VoiceNote src={`/api/media/${p.audio?.id}`} seconds={p.audio?.seconds} mine={mine} />;
      break;
    case "location":
      body = <LocationCard lat={p.location.latitude} lng={p.location.longitude} name={p.location.name} address={p.location.address} />;
      break;
    default:
      body = <span className="text-[#667781] italic">{m.text || m.type}</span>;
  }

  return (
    <div className={cn("group flex w-full px-[6%]", mine ? "justify-end" : "justify-start", first ? "mt-2" : "mt-[2px]")}>
      <div className={cn("relative max-w-[82%]", wide && "w-[270px]")}>
        {first && (
          <svg
            viewBox="0 0 8 13"
            width="8"
            height="13"
            className={cn("absolute top-0", mine ? "-right-2 text-[#D9FDD3]" : "-left-2 text-white")}
            style={{ transform: mine ? undefined : "scaleX(-1)" }}
          >
            <path fill="currentColor" d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
          </svg>
        )}
        <div className={cn("relative rounded-lg px-2 pt-1.5 pb-2 text-[14.2px] leading-[19px] text-[#111B21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]", bg, first && (mine ? "rounded-tr-none" : "rounded-tl-none"))}>
          {senderName && !mine && (
            <div className="mb-0.5 text-[12.8px] font-medium" style={{ color: `oklch(0.55 0.15 ${senderHue ?? 200})` }}>
              {senderName}
            </div>
          )}
          {quoted && <Quote quoted={quoted} mine={mine} nameOf={nameOf} />}
          <div className="break-words">
            {body}
            <Meta m={m} mine={mine} />
          </div>
          {rows && <div className="-mx-2 mt-2 -mb-2">{rows}</div>}
          {interactive && actions && m.type !== "reaction" && (
            <div className={cn("absolute top-1/2 hidden -translate-y-1/2 gap-1 group-hover:flex", mine ? "-left-16" : "-right-16")}>
              <button type="button" onClick={() => actions.react(m)} className="rounded-full bg-white/90 p-1 text-[#54656F] shadow-sm hover:bg-white" title="React">
                <SmilePlus className="size-4" />
              </button>
              <button type="button" onClick={() => actions.quote(m)} className="rounded-full bg-white/90 p-1 text-[#54656F] shadow-sm hover:bg-white" title="Reply">
                <Reply className="size-4" />
              </button>
            </div>
          )}
        </div>
        {reactions && reactions.length > 0 && (
          <div className={cn("relative z-10 -mt-1.5 flex", mine ? "justify-end pr-2" : "justify-start pl-2")}>
            <span className="rounded-full border border-[#E9EDEF] bg-white px-1.5 py-[1px] text-[13px] shadow-sm">{reactions.join("")}</span>
          </div>
        )}
        {showAnnotation && m.annotation && (m.annotation.intent || m.annotation.summary) && (
          <div className={cn("mt-1 flex flex-wrap gap-1 font-mono text-[10px] leading-tight", mine ? "justify-end" : "justify-start")}>
            {m.annotation.intent && <span className="rounded-sm bg-[#16130F] px-1.5 py-0.5 text-[#F3EFE6] uppercase">{m.annotation.intent}</span>}
            {m.annotation.confidence != null && (
              <span className={cn("rounded-sm px-1.5 py-0.5", m.annotation.confidence >= 0.8 ? "bg-[#DCE8D6] text-[#2F6B3A]" : "bg-[#F5E6C4] text-[#8a5e05]")}>
                conf {m.annotation.confidence.toFixed(2)}
              </span>
            )}
            {m.annotation.transcript && <span className="rounded-sm bg-white/80 px-1.5 py-0.5 text-[#54656F]">🎤 “{m.annotation.transcript}”</span>}
            {m.annotation.summary && <span className="max-w-[320px] rounded-sm bg-white/80 px-1.5 py-0.5 text-[#54656F]">{m.annotation.summary}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
