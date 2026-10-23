"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/live";

export type OpsOutlet = {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  lead: string | null;
  coverage: number;
  weekCoverage: number;
  status: "ok" | "risk" | "short";
  today: { id: string; label: string; startsAt: string; endsAt: string; status: string; worker: string | null; hue: number | null; checkedIn: boolean; onNow: boolean }[];
  openThisWeek: number;
  activeCovers: number;
  byHour: { t: number; need: number; have: number }[];
};

export type OpsData = {
  org: { id: string; name: string; managerName: string; timezone: string; outletCount: number };
  now: string;
  local: { date: string; minutes: number; dow: number; hour: number; minute: number };
  week: number;
  weekStart: string;
  outlets: OpsOutlet[];
  arcs: { id: string; from: { lat: number; lng: number }; to: { lat: number; lng: number }; state: "offered" | "filled"; name: string }[];
  kpis: { coverageToday: number; shiftsToday: number; onNow: number; openThisWeek: number; activeCovers: number; pendingApprovals: number; minutesSaved7d: number; team: number };
  cycle: { id: string; weekStart: string; week: number; status: string; replied: number; total: number; runId: string | null; deadlineAt: string | null } | null;
  covers: {
    id: string;
    shiftId: string;
    type: string;
    status: string;
    urgency: string;
    runId: string | null;
    wave: number;
    createdAt: string;
    offers: { id: string; workerId: string; status: string; name?: string; rankScore: number | null }[];
  }[];
  approvals: ApprovalRow[];
  ticker: { id: string; kind: string; actor: string; title: string; at: string; runId: string | null }[];
};

export type ApprovalRow = {
  id: string;
  runId: string | null;
  kind: string;
  title: string;
  summary: string;
  action: { type: string };
  options: { id: string; label: string; detail: string }[] | null;
  risk: "low" | "medium" | "high";
  policyReason: string;
  status: string;
  createdAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  channel?: string | null;
};

export function useOps() {
  return useQuery({ queryKey: ["ops"], queryFn: () => api<OpsData>("/api/ops"), refetchInterval: 20_000 });
}

export const orgSlug = (orgId?: string) => (orgId ?? "org_kopilab").replace(/^org_/, "");
