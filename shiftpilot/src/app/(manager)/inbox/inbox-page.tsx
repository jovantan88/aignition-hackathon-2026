"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Hand, Search, SendHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { WorkerContext } from "@/components/control/worker-context";
import { BusinessAvatar, GroupAvatar, PersonAvatar } from "@/components/wa/avatar";
import { ChatView } from "@/components/wa/chat-view";
import { api, useTyping } from "@/lib/live";
import { cn } from "@/lib/utils";

type InboxConv = {
  id: string;
  orgId: string;
  kind: "worker_dm" | "manager_dm" | "outlet_group";
  workerId: string | null;
  title: string;
  agentPaused: boolean;
  needsAttention: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  workerName: string | null;
  hue: number | null;
  autopilot: boolean | null;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs you" },
  { id: "stage", label: "Stage" },
  { id: "groups", label: "Groups" },
] as const;

function Row({ c, active, onClick }: { c: InboxConv; active: boolean; onClick: () => void }) {
  const typing = useTyping(c.id);
  return (
    <button type="button" onClick={onClick} aria-current={active ? "true" : undefined} className={cn("inbox-row", active && "is-active")}>
      {c.kind === "outlet_group" ? <GroupAvatar label={c.title.split(" ").slice(-2, -1)[0]?.slice(0, 3).toUpperCase() ?? "GRP"} size={42} /> : c.kind === "manager_dm" ? <BusinessAvatar size={42} /> : <PersonAvatar name={c.workerName ?? c.title} hue={c.hue ?? 20} size={42} />}
      <div className="min-w-0 flex-1">
        <div className="inbox-row-top">
          <span className="inbox-row-name">
            {c.kind === "manager_dm" ? "You ↔ ShiftPilot" : c.title}
            {c.autopilot === false && <span className="chip chip-signal">Stage</span>}
          </span>
          <span className="inbox-row-time num">{c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" }) : ""}</span>
        </div>
        <div className="inbox-row-preview">{typing ? <span className="text-ok">typing…</span> : <span className="truncate">{c.lastMessagePreview}</span>}</div>
      </div>
      {c.needsAttention && <span className="inbox-dot" aria-label="Needs attention" />}
      {c.agentPaused && <Hand className="size-4 shrink-0 text-warn" aria-label="You took over" />}
    </button>
  );
}

export function InboxPage() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["inbox"], queryFn: () => api<{ conversations: InboxConv[] }>("/api/inbox") });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const [annotations, setAnnotations] = useState(true);
  const [draft, setDraft] = useState("");
  const list = useMemo(
    () =>
      (data?.conversations ?? []).filter((c) => {
        if (q && !`${c.title} ${c.lastMessagePreview}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (filter === "attention") return c.needsAttention || c.agentPaused;
        if (filter === "groups") return c.kind === "outlet_group";
        if (filter === "stage") return c.autopilot === false || c.kind === "manager_dm";
        return true;
      }),
    [data, filter, q],
  );
  const selectedId = params.get("c") ?? list[0]?.id ?? null;
  const conv = data?.conversations.find((c) => c.id === selectedId);

  const toggle = async () => {
    if (!conv) return;
    await api(`/api/conversations/${conv.id}/takeover`, { json: { paused: !conv.agentPaused } });
    toast(conv.agentPaused ? "Handed back to ShiftPilot" : "You've taken over. ShiftPilot won't reply in this chat.");
    await qc.invalidateQueries({ queryKey: ["inbox"] });
  };
  const send = async () => {
    if (!conv || !draft.trim()) return;
    const text = draft;
    setDraft("");
    await api(`/api/conversations/${conv.id}/send`, { json: { text } });
  };

  return (
    <div className="inbox">
      <aside className="inbox-list" aria-label="Conversations">
        <div className="inbox-list-head">
          <h1 className="inbox-title">Inbox</h1>
          <p className="inbox-sub">Every WhatsApp chat ShiftPilot is part of.</p>
          <label className="outlet-search">
            <Search className="size-4" aria-hidden />
            <input aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" />
          </label>
          <div className="inbox-filters" role="group" aria-label="Filter chats">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)} className="filter-chip" aria-pressed={filter === f.id}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="inbox-rows">
          {list.map((c) => (
            <Row key={c.id} c={c} active={c.id === selectedId} onClick={() => router.replace(`/inbox?c=${c.id}`)} />
          ))}
          {!list.length && <div className="empty-state">No chats match.</div>}
        </div>
      </aside>

      <section className="inbox-chat">
        {conv ? (
          <>
            <div className="inbox-chat-head">
              <div className="min-w-0">
                <div className="inbox-chat-title">{conv.kind === "manager_dm" ? "You ↔ ShiftPilot (copilot)" : conv.title}</div>
                <div className="inbox-chat-state">
                  {conv.agentPaused ? (
                    <span className="text-warn">You&apos;re handling this chat</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-ok">
                      <Bot className="size-4" aria-hidden /> ShiftPilot is handling this chat
                    </span>
                  )}
                </div>
              </div>
              <div className="inbox-chat-actions">
                <button type="button" onClick={() => setAnnotations(!annotations)} className="filter-chip" aria-pressed={annotations}>
                  <Sparkles className="size-4" aria-hidden /> What it understood
                </button>
                {conv.kind === "worker_dm" && (
                  <button type="button" onClick={toggle} className={cn("btn btn-sm", conv.agentPaused ? "btn-primary" : "")}>
                    {conv.agentPaused ? "Hand back to agent" : "Take over"}
                  </button>
                )}
              </div>
            </div>
            <div className="whatsapp-demo min-h-0 flex-1">
              <ChatView
                key={conv.id}
                conversationId={conv.id}
                perspective={conv.kind === "manager_dm" ? "user" : "business"}
                orgId={conv.orgId}
                showAnnotations={annotations}
                headerOverride={<></>}
                composerOverride={
                  conv.kind === "manager_dm" ? undefined : conv.agentPaused ? (
                    <div className="flex items-center gap-2 border-t border-rule bg-white px-3 py-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && send()}
                        placeholder={`Reply to ${conv.title} as ${conv.kind === "outlet_group" ? "the business" : "the manager"}…`}
                        className="flex-1 bg-transparent text-[15px] outline-none"
                        aria-label="Reply"
                      />
                      <button type="button" onClick={send} className="flex size-10 items-center justify-center rounded-full bg-[#1DAA61] text-white" aria-label="Send">
                        <SendHorizontal className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="border-t border-rule bg-white px-4 py-3 text-center text-[14px] text-ink-soft">Read-only while ShiftPilot handles it. Take over to reply yourself.</div>
                  )
                }
              />
            </div>
          </>
        ) : (
          <div className="empty-state">Pick a conversation</div>
        )}
      </section>

      <aside className="inbox-context" aria-label="About this chat">
        {conv?.workerId ? <WorkerContext workerId={conv.workerId} /> : <div className="p-5 text-[14.5px] leading-relaxed text-ink-soft">{conv?.kind === "outlet_group" ? "Outlet group chat. ShiftPilot posts rosters and cover updates here." : "Your own chat with the copilot."}</div>}
      </aside>
    </div>
  );
}
