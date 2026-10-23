"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, MessageCircle, MoreVertical, Phone as PhoneIcon, Search, Users, CircleDashed } from "lucide-react";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";
import { BusinessAvatar, GroupAvatar } from "./avatar";
import { ChatListRow, ChatView } from "./chat-view";
import type { ClientConversation, Place } from "./types";

export type PhoneData = {
  identity: {
    kind: "worker" | "manager";
    id: string;
    name: string;
    orgId: string;
    orgName: string;
    avatarHue: number;
    subtitle: string;
    phone: string;
    language?: string;
    autopilot?: boolean;
  };
  places?: Place[];
  chats: ClientConversation[];
};

export type ClockData = { now: string; offsetMs: number; local: { date: string; minutes: number; dow: number }; week: number; label: string };

export function useClock(orgId: string | undefined) {
  return useQuery({
    queryKey: ["clock", orgId],
    queryFn: () => api<ClockData>(`/api/clock?org=${orgId}`),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
}

export function usePhone(phoneId: string) {
  return useQuery({ queryKey: ["conversations", "phone", phoneId], queryFn: () => api<PhoneData>(`/api/phone/${phoneId}`) });
}

function fmtListTime(iso: string | null, nowIso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }) === new Date(nowIso ?? Date.now()).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
  return sameDay
    ? d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" })
    : d.toLocaleDateString("en-SG", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Asia/Singapore" });
}

export function StatusBar({ time, dark }: { time: string; dark?: boolean }) {
  return (
    <div className={cn("relative z-20 flex h-11 shrink-0 items-center justify-between px-7 text-[14px] font-semibold", dark ? "text-white" : "text-[#111B21]")}>
      <span className="font-sans tabular-nums">{time}</span>
      <span className="absolute top-2.5 left-1/2 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
      <span className="flex items-center gap-1.5">
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
          <rect x="0" y="7" width="3" height="4" rx="0.7" />
          <rect x="4.5" y="5" width="3" height="6" rx="0.7" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="0.7" />
          <rect x="13.5" y="0" width="3" height="11" rx="0.7" />
        </svg>
        <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
          <path d="M7.5 2.2c2.1 0 4 .8 5.5 2.1l1.1-1.2A9.5 9.5 0 0 0 7.5.5 9.5 9.5 0 0 0 .9 3.1L2 4.3a7.9 7.9 0 0 1 5.5-2.1zm0 3.3c1.2 0 2.3.4 3.2 1.2l1.1-1.2a6.4 6.4 0 0 0-8.6 0l1.1 1.2c.9-.8 2-1.2 3.2-1.2zm0 3.2c.4 0 .8.1 1.1.4L7.5 10.4 6.4 9.1c.3-.3.7-.4 1.1-.4z" />
        </svg>
        <span className="flex h-[11px] w-[23px] items-center rounded-[3px] border border-current/50 p-[1.5px]">
          <span className="h-full w-[70%] rounded-[1.5px] bg-current" />
        </span>
      </span>
    </div>
  );
}

export function Phone({ phoneId, framed = true, autoOpen = true, className }: { phoneId: string; framed?: boolean; autoOpen?: boolean; className?: string }) {
  const { data } = usePhone(phoneId);
  const { data: clock } = useClock(data?.identity.orgId);
  // Which chat is open, remembered per phone; by default the ShiftPilot DM, where the action is
  const [sel, setSel] = useState<{ phone: string; conv: string | null } | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "groups">("all");
  const dmId = data?.chats.find((c) => c.kind !== "outlet_group")?.id ?? null;
  const open = sel?.phone === phoneId ? sel.conv : autoOpen ? dmId : null;
  const setOpen = (conv: string | null) => setSel({ phone: phoneId, conv });

  const time = clock ? new Date(clock.now).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }) : "--:--";
  const openConv = data?.chats.find((c) => c.id === open);

  const screen = (
    <div className="relative flex h-full flex-col overflow-hidden bg-white font-[system-ui,-apple-system,'Segoe_UI',Roboto,Helvetica,Arial,sans-serif]">
      <StatusBar time={time} />
      {!data ? (
        <div className="flex flex-1 items-center justify-center text-[13px] text-[#8696A0]">Loading…</div>
      ) : openConv ? (
        <div className="min-h-0 flex-1">
          <ChatView
            conversationId={openConv.id}
            perspective="user"
            meWorkerId={data.identity.kind === "worker" ? data.identity.id : null}
            orgId={data.identity.orgId}
            places={data.places}
            onBack={() => setOpen(null)}
            clockNow={clock?.now}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-4 pt-1 pb-2">
            <span className="text-[24px] font-semibold tracking-tight text-[#1DAA61]">WhatsApp</span>
            <span className="flex items-center gap-4 text-[#111B21]">
              <Camera className="size-5" />
              <MoreVertical className="size-5" />
            </span>
          </div>
          <div className="mx-4 mb-2 flex items-center gap-3 rounded-full bg-[#F0F2F5] px-4 py-2 text-[15px] text-[#8696A0]">
            <Search className="size-4" /> Ask Meta AI or Search
          </div>
          <div className="mb-1 flex gap-2 px-4">
            {(["all", "unread", "groups"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn("rounded-full px-3 py-1 text-[13.5px] capitalize", filter === f ? "bg-[#D9FDD3] text-[#0A7A42]" : "bg-[#F0F2F5] text-[#54656F]")}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {data.chats
              .filter((c) => (filter === "unread" ? (c.unread ?? 0) > 0 : filter === "groups" ? c.kind === "outlet_group" : true))
              .map((c) => (
                <ChatListRow
                  key={c.id}
                  title={c.kind === "outlet_group" ? c.title : "ShiftPilot"}
                  verified={c.kind !== "outlet_group"}
                  preview={c.lastMessagePreview ?? ""}
                  time={fmtListTime(c.lastMessageAt, clock?.now)}
                  unread={c.unread}
                  onClick={() => setOpen(c.id)}
                  avatar={c.kind === "outlet_group" ? <GroupAvatar label={c.title.split(" ").slice(-2, -1)[0]?.slice(0, 3).toUpperCase() ?? "GRP"} size={48} /> : <BusinessAvatar size={48} />}
                />
              ))}
          </div>
          <div className="grid shrink-0 grid-cols-4 border-t border-[#E9EDEF] pt-2 pb-5 text-center text-[11.5px] text-[#54656F]">
            <span className="flex flex-col items-center gap-1">
              <span className="rounded-full bg-[#D9FDD3] px-4 py-1 text-[#0A7A42]">
                <MessageCircle className="size-5" />
              </span>
              <b className="font-semibold text-[#111B21]">Chats</b>
            </span>
            <span className="flex flex-col items-center gap-1 pt-1">
              <CircleDashed className="size-5" />
              Updates
            </span>
            <span className="flex flex-col items-center gap-1 pt-1">
              <Users className="size-5" />
              Communities
            </span>
            <span className="flex flex-col items-center gap-1 pt-1">
              <PhoneIcon className="size-5" />
              Calls
            </span>
          </div>
        </div>
      )}
    </div>
  );

  if (!framed) return <div className={cn("h-dvh w-full", className)}>{screen}</div>;

  return (
    <div className={cn("relative aspect-[9/19.2] h-full max-h-[820px] min-h-[560px] rounded-[48px] bg-[#16130F] p-[10px] shadow-[0_0_0_1px_#3a352e,0_30px_60px_-30px_rgba(22,19,15,.5)]", className)}>
      <div className="h-full overflow-hidden rounded-[38px]">{screen}</div>
    </div>
  );
}
