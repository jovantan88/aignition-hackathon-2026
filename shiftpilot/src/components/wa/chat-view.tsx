"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { ArrowLeft, MoreVertical, Phone, Video } from "lucide-react";
import { api, useTyping } from "@/lib/live";
import { typingStore } from "@/lib/typing";
import { cn } from "@/lib/utils";
import { BusinessAvatar, GroupAvatar, PersonAvatar, VerifiedBadge } from "./avatar";
import { MessageBubble } from "./bubble";
import { Composer } from "./composer";
import { FlowSheet, ListSheet, LocationSheet, ReactionBar } from "./sheets";
import type { ClientConversation, ClientMessage, Place, WaActions } from "./types";

export const WALLPAPER =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cg fill='none' stroke='%23d9d1c3' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round' opacity='.75'%3E%3Cpath d='M14 22h16v10a8 8 0 0 1-16 0z M30 25h3a3 3 0 0 1 0 6h-3'/%3E%3Ccircle cx='98' cy='26' r='9'/%3E%3Cpath d='M98 20v6l4 3'/%3E%3Cpath d='M60 64l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z'/%3E%3Cpath d='M112 78c-6-8-16-2-10 6l10 9 10-9c6-8-4-14-10-6z'/%3E%3Cpath d='M20 98c10-8 22 0 18 12-12 2-20-4-18-12z M22 100l14 9'/%3E%3Crect x='76' y='108' width='18' height='14' rx='2'/%3E%3Cpath d='M76 113h18 M81 108v-3 M89 108v-3'/%3E%3Cpath d='M44 124l6-10 6 10z'/%3E%3C/g%3E%3C/svg%3E\")";

type MessagesResponse = { conversation: ClientConversation; messages: ClientMessage[]; people: { id: string; name: string; avatarHue: number }[] };

function dayLabel(iso: string, todayIso: string) {
  const d = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const t = new Date(todayIso).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  const diff = Math.round((Date.parse(t) - Date.parse(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return new Date(iso).toLocaleDateString("en-SG", { weekday: "long", timeZone: "Asia/Singapore" });
  return new Date(iso).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Singapore" });
}

export function useMessages(conversationId: string | null, awaitingReply = false) {
  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => api<MessagesResponse>(`/api/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    // SSE is primary; recover a missed reply without making the user reload.
    refetchInterval: awaitingReply ? 1000 : 15_000,
  });
}

export function ChatView({
  conversationId,
  perspective,
  meWorkerId,
  orgId,
  places = [],
  onBack,
  showAnnotations,
  headerOverride,
  composerOverride,
  clockNow,
}: {
  conversationId: string;
  /** "user": the phone owner (worker/manager) is the right-hand side. "business": the shop is. */
  perspective: "user" | "business";
  meWorkerId?: string | null;
  orgId: string;
  places?: Place[];
  onBack?: () => void;
  showAnnotations?: boolean;
  headerOverride?: React.ReactNode;
  composerOverride?: React.ReactNode;
  clockNow?: string;
}) {
  const qc = useQueryClient();
  const typing = useTyping(conversationId);
  const { data } = useMessages(conversationId, typing);
  const awaitingMessages = useRef(new Map<string, { messageId?: string }>());
  const [listMsg, setListMsg] = useState<ClientMessage | null>(null);
  const [flow, setFlow] = useState<{ flowId: string; flowToken: string; screen: string; data?: Record<string, unknown>; msgId: string } | null>(null);
  const [locFor, setLocFor] = useState<ClientMessage | "attach" | null>(null);
  const [reactTo, setReactTo] = useState<ClientMessage | null>(null);
  const [quoting, setQuoting] = useState<ClientMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const conv = data?.conversation;
  const msgs = useMemo(() => data?.messages ?? [], [data]);
  const isGroup = conv?.kind === "outlet_group";

  useEffect(() => {
    const id = awaitingMessages.current.get(conversationId)?.messageId;
    if (!id) return;
    const inbound = msgs.find((message) => message.id === id);
    if (inbound?.processedAt) {
      awaitingMessages.current.delete(conversationId);
      typingStore.set(conversationId, false);
    }
  }, [conversationId, msgs]);

  const mineOf = useCallback(
    (m: ClientMessage) => {
      if (perspective === "business") return m.direction === "out";
      if (isGroup) return m.direction === "in" && m.senderWorkerId === meWorkerId;
      return m.direction === "in";
    },
    [perspective, isGroup, meWorkerId],
  );

  const peopleById = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data]);
  const nameOf = useCallback(
    (m: ClientMessage) => {
      if (mineOf(m)) return "You";
      if (m.direction === "out") return m.sender === "manager" ? "Manager" : "ShiftPilot";
      return peopleById.get(m.senderWorkerId ?? "")?.name ?? conv?.title ?? "Them";
    },
    [mineOf, peopleById, conv],
  );

  const { visible, reactions, byId } = useMemo(() => {
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const reactions = new Map<string, string[]>();
    const visible: ClientMessage[] = [];
    for (const m of msgs) {
      if (m.type === "reaction") {
        const target = m.payload.reaction?.message_id;
        if (target) reactions.set(target, [...(reactions.get(target) ?? []).filter((e) => e !== m.payload.reaction.emoji), m.payload.reaction.emoji].filter(Boolean));
      } else visible.push(m);
    }
    return { visible, reactions, byId };
  }, [msgs]);

  // Stick to the newest message, including when images finish loading, unless the user scrolled up
  const stick = useRef(true);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    const inner = contentRef.current;
    if (!el || !inner) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    };
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll);
    ro.observe(inner);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [conversationId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible.length, typing]);

  // Opening the chat on the phone marks business messages read
  const unread = msgs.some((m) => m.direction === "out" && m.status === "delivered");
  useEffect(() => {
    if (perspective !== "user" || !unread) return;
    const t = setTimeout(() => void api(`/api/conversations/${conversationId}/read`, { method: "POST" }), 600);
    return () => clearTimeout(t);
  }, [perspective, unread, conversationId, msgs.length]);

  const send = useCallback(
    async (payload: Record<string, unknown>) => {
      const cancelTyping = payload.type !== "reaction" && conv && !isGroup && !conv.agentPaused
        ? typingStore.set(conversationId, true)
        : undefined;
      const attempt: { messageId?: string } | undefined = cancelTyping ? {} : undefined;
      if (attempt) awaitingMessages.current.set(conversationId, attempt);
      try {
        const result = await api<{ messageId: string }>(`/api/conversations/${conversationId}/messages`, { json: { payload, senderWorkerId: isGroup ? meWorkerId : undefined } });
        if (attempt) attempt.messageId = result.messageId;
      } catch (error) {
        if (awaitingMessages.current.get(conversationId) === attempt) awaitingMessages.current.delete(conversationId);
        cancelTyping?.();
        throw error;
      }
      await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    },
    [conversationId, conv, isGroup, meWorkerId, qc],
  );

  const interactive = perspective === "user";
  const actions: WaActions = {
    reply: send,
    openList: setListMsg,
    openFlow: (m, f) => setFlow({ ...f, msgId: m.id }),
    requestLocation: (m) => setLocFor(m),
    react: setReactTo,
    quote: setQuoting,
  };

  const today = clockNow ?? new Date().toISOString();

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#EFEAE2]" style={{ backgroundImage: WALLPAPER }}>
      {headerOverride ?? (
        <div className="z-10 flex shrink-0 items-center gap-2 bg-white px-2 py-2 shadow-[0_1px_0_rgba(0,0,0,.06)]">
          {onBack && (
            <button type="button" onClick={onBack} className="p-1 text-[#54656F]">
              <ArrowLeft className="size-5" />
            </button>
          )}
          {isGroup ? <GroupAvatar label={conv?.title.split(" ").slice(-2, -1)[0]?.slice(0, 3).toUpperCase() ?? "GRP"} size={38} /> : <BusinessAvatar size={38} />}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center gap-1 truncate text-[16px] font-medium text-[#111B21]">
              <span className="truncate">{isGroup ? conv?.title : "ShiftPilot"}</span>
              {!isGroup && <VerifiedBadge />}
            </div>
            <div className={cn("truncate text-[12.5px]", typing ? "text-[#1DAA61]" : "text-[#667781]")}>
              {typing ? "typing…" : isGroup ? "ShiftPilot, crew" : "Business account"}
            </div>
          </div>
          <Video className="mx-1.5 size-5 text-[#54656F]" />
          <Phone className="mx-1.5 size-[18px] text-[#54656F]" />
          <MoreVertical className="ml-1 size-5 text-[#54656F]" />
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={contentRef} className="pt-2 pb-3">
        {!isGroup && perspective === "user" && (
          <div className="mx-auto my-2 w-[86%] rounded-lg bg-[#FFEECD] px-3 py-2 text-center text-[12px] leading-snug text-[#54656F]">
            🔒 This business uses a secure service from Meta to manage this chat. Tap to learn more.
          </div>
        )}
        {visible.map((m, i) => {
          const prev = visible[i - 1];
          const newDay = !prev || dayLabel(prev.createdAt, today) !== dayLabel(m.createdAt, today);
          const mine = mineOf(m);
          const first = newDay || !prev || mineOf(prev) !== mine || prev.senderWorkerId !== m.senderWorkerId || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > 5 * 60_000;
          const sender = isGroup && !mine && m.direction === "in" ? peopleById.get(m.senderWorkerId ?? "") : null;
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="my-2 flex justify-center">
                  <span className="rounded-lg bg-white px-3 py-1 text-[12px] font-medium text-[#54656F] uppercase shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                    {dayLabel(m.createdAt, today)}
                  </span>
                </div>
              )}
              <MessageBubble
                m={m}
                mine={mine}
                first={first}
                quoted={m.contextMessageId ? byId.get(m.contextMessageId) : undefined}
                reactions={reactions.get(m.id)}
                actions={actions}
                interactive={interactive}
                senderName={first && sender ? sender.name : first && isGroup && !mine && m.direction === "out" ? "ShiftPilot" : undefined}
                senderHue={sender?.avatarHue}
                nameOf={nameOf}
                showAnnotation={showAnnotations}
              />
            </Fragment>
          );
        })}
        {typing && (
          <div role="status" aria-label="ShiftPilot is typing" className="mt-2 flex px-[6%]">
            <div className="flex items-center gap-1 rounded-lg rounded-tl-none bg-white px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
              <span className="mr-1.5 text-[12px] text-[#667781]">typing…</span>
              {[0, 1, 2].map((i) => (
                <span aria-hidden="true" key={i} className="size-1.5 animate-bounce rounded-full bg-[#8696A0] motion-reduce:animate-none" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {composerOverride ??
        (interactive && (
          <Composer
            orgId={orgId}
            quoting={quoting}
            clearQuote={() => setQuoting(null)}
            nameOf={nameOf}
            onSend={send}
            onOpenLocation={() => setLocFor("attach")}
            sampleMcUrl={`/api/og/mc?conv=${conversationId}`}
          />
        ))}

      <AnimatePresence>
        {listMsg && (
          <ListSheet
            key="list"
            m={listMsg}
            onClose={() => setListMsg(null)}
            onSelect={(row) => {
              setListMsg(null);
              void send({ type: "interactive", interactive: { type: "list_reply", list_reply: row }, context: { id: listMsg.id } });
            }}
          />
        )}
        {flow && (
          <FlowSheet
            key="flow"
            flow={flow}
            orgId={orgId}
            onClose={() => setFlow(null)}
            onSubmit={(response) => {
              const msgId = flow.msgId;
              setFlow(null);
              void send({
                type: "interactive",
                interactive: { type: "nfm_reply", nfm_reply: { name: "flow", body: "Sent", response_json: JSON.stringify(response) } },
                context: { id: msgId },
              });
            }}
          />
        )}
        {locFor && (
          <LocationSheet
            key="loc"
            places={places}
            onClose={() => setLocFor(null)}
            onPick={(p) => {
              const ctx = locFor !== "attach" ? { context: { id: locFor.id } } : {};
              setLocFor(null);
              void send({ type: "location", location: { latitude: p.lat, longitude: p.lng, name: p.name, address: p.address }, ...ctx });
            }}
          />
        )}
        {reactTo && (
          <ReactionBar
            key="react"
            onClose={() => setReactTo(null)}
            onPick={(emoji) => {
              const id = reactTo.id;
              setReactTo(null);
              void send({ type: "reaction", reaction: { message_id: id, emoji } });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChatListRow({
  title,
  preview,
  time,
  unread,
  avatar,
  verified,
  onClick,
  active,
}: {
  title: string;
  preview: string;
  time: string;
  unread?: number;
  avatar: React.ReactNode;
  verified?: boolean;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F5F6F6]", active && "bg-[#F0F2F5]")}>
      {avatar}
      <div className="min-w-0 flex-1 border-b border-[#F0F2F5] pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate text-[16px] text-[#111B21]">
            <span className="truncate">{title}</span>
            {verified && <VerifiedBadge size={14} />}
          </span>
          <span className={cn("shrink-0 text-[12px]", unread ? "font-medium text-[#1DAA61]" : "text-[#667781]")}>{time}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[14px] text-[#667781]">{preview}</span>
          {!!unread && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#1DAA61] px-1.5 text-[11.5px] font-medium text-white">{unread}</span>}
        </div>
      </div>
    </button>
  );
}

export { PersonAvatar };
