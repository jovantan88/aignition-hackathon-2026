"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Bot, Building2, CalendarDays, ChartNoAxesCombined, CheckCheck, ChevronDown, ChevronRight, Clapperboard, House, Menu, MessageSquareText, Settings2, ShieldCheck, Smartphone, Sparkles, Theater, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChatView } from "@/components/wa/chat-view";
import { api, useLive, useLiveConnected } from "@/lib/live";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./approvals";
import { DemoClock } from "./demo-clock";
import { DemoGuide } from "./demo-guide";
import { orgSlug, useOps } from "./hooks";

type NavItem = { href: string; label: string; icon: LucideIcon };

const HOME: NavItem = { href: "/", label: "Home", icon: House };
const GROUPS: { caption: string; items: NavItem[] }[] = [
  { caption: "Agent", items: [{ href: "/agent", label: "Plans & audit trail", icon: Bot }] },
  {
    caption: "People & shifts",
    items: [
      { href: "/roster", label: "Roster", icon: CalendarDays },
      { href: "/inbox", label: "Inbox", icon: MessageSquareText },
      { href: "/team", label: "Team", icon: Users },
    ],
  },
  { caption: "Results", items: [{ href: "/impact", label: "Impact", icon: ChartNoAxesCombined }] },
];
const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: Settings2 };
const ALL_NAV = [HOME, ...GROUPS.flatMap((g) => g.items), SETTINGS];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

const ORGS = [
  { id: "org_kopilab", name: "Kopi Lab", sub: "6 outlets" },
  { id: "org_sunnyside", name: "Sunny Side Bakery", sub: "1 outlet" },
];

export function ManagerShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: ops } = useOps();
  const connected = useLiveConnected();
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const orgId = ops?.org.id;
  const pending = ops?.approvals ?? [];

  useEffect(() => {
    const t = setInterval(() => void fetch("/api/agent/tick", { method: "POST" }).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCopilotOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  useLive("approval.created", (m) => {
    if (m.orgId !== orgId) return;
    toast("ShiftPilot needs your approval", { description: "It paused and is waiting for you.", action: { label: "Review", onClick: () => setApprovalsOpen(true) } });
  });

  const switchOrg = async (id: string) => {
    await api("/api/org", { json: { orgId: id } });
    await qc.invalidateQueries();
    router.refresh();
  };

  const sidebar = (
    <>
      <Link href="/" className="workspace-brand" onClick={() => setNavOpen(false)}>
        <BrandMark size={22} />
        <span>ShiftPilot</span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button type="button" className="workspace-switcher" aria-label="Switch workspace">
              <span className="workspace-avatar">
                <Building2 className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="workspace-switcher-name">{ops?.org.name ?? "Your workspace"}</span>
                <span className="workspace-switcher-sub">{ops ? `${ops.org.outletCount} outlet${ops.org.outletCount === 1 ? "" : "s"}` : "Loading workspace…"}</span>
              </span>
              <ChevronDown className="size-4 text-ink-soft" />
            </button>
          }
        />
        <DropdownMenuContent align="start" className="manager-theme w-64 rounded-xl border border-rule bg-card p-1.5 shadow-sm ring-0">
          {ORGS.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => switchOrg(o.id)} className="rounded-md py-2.5">
              <Building2 className="size-[18px] text-ink-soft" />
              <span className="flex-1">
                <span className="block text-[14.5px] font-medium">{o.name}</span>
                <span className="block text-[13px] text-ink-soft">{o.sub}</span>
              </span>
              {orgId === o.id && <CheckCheck className="size-4 text-ok" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Suspense fallback={<div className="h-[330px]" />}>
        <Nav
          approvals={pending.length}
          attention={!!ops?.covers.length}
          onNavigate={() => setNavOpen(false)}
          onOpenApprovals={() => {
            setNavOpen(false);
            setApprovalsOpen(true);
          }}
        />
      </Suspense>

      <div className="px-1 pt-4 md:hidden">
        <DemoClock orgId={orgId} appearance="workspace" />
      </div>

      <div className="sidebar-bottom">
        <div className="nav-caption">Demo</div>
        <div className="sidebar-demo">
          <button
            type="button"
            onClick={() => {
              setNavOpen(false);
              setGuideOpen(true);
            }}
          >
            <Clapperboard className="size-[18px]" />
            Recording guide
          </button>
          <Link href="/stage" target="_blank">
            <Theater className="size-[18px]" />
            Stage view
            <ArrowUpRight className="ml-auto size-4" />
          </Link>
          <Link href="/phone" target="_blank">
            <Smartphone className="size-[18px]" />
            Worker phones
            <ArrowUpRight className="ml-auto size-4" />
          </Link>
        </div>
        <div className="workspace-user">
          <span className="user-avatar">{(ops?.org.managerName ?? "M").split(" ").map((s) => s[0]).slice(0, 2).join("")}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{ops?.org.managerName ?? "Manager"}</div>
            <div className="agent-status">
              <span className={cn("size-2 rounded-full", connected ? "bg-ok" : "bg-warn")} />
              {connected ? "Live" : "Reconnecting…"}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="manager-theme workspace-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="workspace-sidebar" aria-label="Workspace sidebar">
        {sidebar}
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <button type="button" onClick={() => setNavOpen(true)} className="icon-button mobile-nav-toggle" aria-label="Open navigation">
            <Menu className="size-5" />
          </button>
          <Suspense fallback={<span className="text-ink-soft">Workspace</span>}>
            <WorkspaceBreadcrumb orgName={ops?.org.name} />
          </Suspense>
          <div className="topbar-actions">
            <div className="topbar-clock">
              <DemoClock orgId={orgId} appearance="workspace" />
            </div>
            <button type="button" onClick={() => setApprovalsOpen(true)} className={cn("approvals-button", pending.length > 0 && "has-approvals")} aria-label={pending.length ? `Review ${pending.length} pending approvals` : "Approvals"}>
              <ShieldCheck className="size-[18px]" aria-hidden />
              <span className="approvals-label">Approvals</span>
              <span className="approval-count">{pending.length}</span>
            </button>
            <button type="button" onClick={() => setCopilotOpen(true)} className="copilot-button" aria-label="Open Copilot">
              <Sparkles className="size-4" />
              <span>Copilot</span>
              <kbd className="hidden lg:inline">⌘K</kbd>
            </button>
          </div>
        </header>
        <main className="workspace-main" id="main-content">
          {children}
        </main>
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="manager-theme mobile-sidebar w-[290px] gap-0 border-r border-rule bg-sidebar p-0 shadow-sm">
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <Sheet open={approvalsOpen} onOpenChange={setApprovalsOpen}>
        <SheetContent side="right" className="manager-theme w-full gap-0 border-l border-rule bg-paper p-0 shadow-sm sm:max-w-[500px]">
          <div className="sheet-head">
            <div className="sheet-icon">
              <ShieldCheck className="size-5" />
            </div>
            <SheetTitle className="sheet-title">Approvals</SheetTitle>
            <p className="sheet-lede">ShiftPilot stops here before anything consequential: messaging the team, publishing a roster, overtime and bonuses.</p>
          </div>
          <div className="sheet-body">
            {pending.length ? (
              pending.map((a) => <ApprovalCard key={a.id} a={a} />)
            ) : (
              <div className="empty-state">
                <CheckCheck className="size-8 text-ok" />
                <strong>You’re all caught up</strong>
                <span>ShiftPilot isn’t waiting on you. New requests will appear here.</span>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={copilotOpen} onOpenChange={setCopilotOpen}>
        <SheetContent side="right" showCloseButton={false} className="manager-theme w-full gap-0 border-l border-rule bg-paper p-0 shadow-sm sm:max-w-[440px]">
          <SheetTitle className="sr-only">Copilot</SheetTitle>
          <div className="sheet-bar">
            <div>
              <div className="sheet-bar-title">
                <Sparkles className="size-[18px] text-signal" />
                Copilot
              </div>
              <div className="sheet-bar-sub">Your WhatsApp conversation with ShiftPilot</div>
            </div>
            <button type="button" onClick={() => setCopilotOpen(false)} className="icon-button" aria-label="Close Copilot">
              <X className="size-5" />
            </button>
          </div>
          <div className="whatsapp-demo min-h-0 flex-1">{orgId && <ChatView conversationId={`cnv_mgr_${orgSlug(orgId)}`} perspective="user" orgId={orgId} />}</div>
        </SheetContent>
      </Sheet>
      <DemoGuide open={guideOpen} onOpenChange={setGuideOpen} ops={ops} onOpenApprovals={() => setApprovalsOpen(true)} />
    </div>
  );
}

function WorkspaceBreadcrumb({ orgName }: { orgName?: string }) {
  const pathname = usePathname();
  const page = [...ALL_NAV].reverse().find((n) => isActive(pathname, n.href));
  return (
    <div className="workspace-breadcrumb">
      <span>{orgName ?? "Workspace"}</span>
      <ChevronRight className="size-4" />
      <span>{page?.label ?? "Workspace"}</span>
    </div>
  );
}

function Nav({ approvals, attention, onNavigate, onOpenApprovals }: { approvals: number; attention: boolean; onNavigate: () => void; onOpenApprovals: () => void }) {
  const pathname = usePathname();
  const link = (n: NavItem) => {
    const active = isActive(pathname, n.href);
    return (
      <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("workspace-nav-link", active && "is-active")}>
        <n.icon className="size-5" strokeWidth={1.7} />
        <span>{n.label}</span>
        {n.href === "/inbox" && attention && <span className="nav-dot" aria-label="Needs attention" />}
      </Link>
    );
  };
  return (
    <nav aria-label="Main navigation" className="workspace-nav">
      {link(HOME)}
      {GROUPS.map((g) => (
        <div key={g.caption} className="nav-group">
          <div className="nav-caption">{g.caption}</div>
          {g.caption === "Agent" && (
            <button type="button" onClick={onOpenApprovals} className="workspace-nav-link">
              <ShieldCheck className="size-5" strokeWidth={1.7} />
              <span>Approvals</span>
              {approvals > 0 && <span className="nav-badge">{approvals}</span>}
            </button>
          )}
          {g.items.map(link)}
        </div>
      ))}
      <div className="nav-group nav-settings">{link(SETTINGS)}</div>
    </nav>
  );
}
