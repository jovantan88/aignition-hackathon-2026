import type { MessageAnnotation } from "@/db/schema";

export type ClientMessage = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  sender: "agent" | "worker" | "manager" | "system";
  senderWorkerId: string | null;
  type: string;
  payload: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
  status: "queued" | "sent" | "delivered" | "read" | "failed";
  contextMessageId: string | null;
  annotation: MessageAnnotation | null;
  template: string | null;
  createdAt: string;
  processedAt?: string | null;
};

export type ClientConversation = {
  id: string;
  orgId: string;
  kind: "worker_dm" | "manager_dm" | "outlet_group";
  workerId: string | null;
  outletId: string | null;
  title: string;
  agentPaused: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  needsAttention: boolean;
  unread?: number;
};

export type Place = { label: string; name: string; address: string; lat: number; lng: number; kind: "outlet" | "home" };

/** What the phone owner can do with interactive elements */
export type WaActions = {
  reply: (payload: Record<string, unknown>) => Promise<void> | void;
  openList: (m: ClientMessage) => void;
  openFlow: (m: ClientMessage, flow: { flowId: string; flowToken: string; screen: string; data?: Record<string, unknown> }) => void;
  requestLocation: (m: ClientMessage) => void;
  react: (m: ClientMessage) => void;
  quote: (m: ClientMessage) => void;
};
