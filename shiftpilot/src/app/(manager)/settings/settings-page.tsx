"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import type { OrgSettings } from "@/db/schema";
import { api } from "@/lib/live";
import { DOW_SHORT } from "@/lib/time";

type SettingsData = {
  org: { id: string; name: string; managerName: string; settings: OrgSettings };
  outlets: { id: string; code: string; name: string; address: string; leadName: string | null; openTime: string; closeTime: string }[];
  templates: { id: string; outletId: string; dow: number; label: string; startTime: string; endTime: string; skill: string; headcount: number }[];
};

const NUMBERS: { key: keyof OrgSettings; label: string; hint: string; unit: string }[] = [
  { key: "broadcastApprovalThreshold", label: "Ask before messaging more than", hint: "Bigger broadcasts need your approval", unit: "people" },
  { key: "incentiveCapPerHour", label: "Bonus the agent may offer on its own", hint: "Anything above needs approval", unit: "$/h" },
  { key: "waveSize", label: "People per cover wave", hint: "Asked at the same time; first yes wins", unit: "people" },
  { key: "urgentWaveSize", label: "People per urgent wave", hint: "Same-day cover", unit: "people" },
  { key: "maxWaves", label: "Waves before escalating", hint: "Then you get options", unit: "waves" },
  { key: "offerTimeoutSameDayMin", label: "Same-day offers close after", hint: "Then the next wave goes out", unit: "min" },
  { key: "offerTimeoutFutureMin", label: "Future offers close after", hint: "", unit: "min" },
];

const TOGGLES: { key: keyof OrgSettings; label: string; hint: string }[] = [
  { key: "autoApproveCoverOffers", label: "Offer cover without asking me", hint: "Only within everyone's hours caps and the bonus limit" },
  { key: "autoApproveSwaps", label: "Apply like-for-like swaps automatically", hint: "Same skill, no overtime" },
  { key: "requireMcPhoto", label: "Ask for an MC photo on sick calls", hint: "Read by the agent, visible only to you" },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => api<SettingsData>("/api/settings") });
  const [resetting, setResetting] = useState(false);
  if (!data?.org) return <div className="page"><div className="empty-state"><strong>Loading…</strong></div></div>;
  const s = data.org.settings;
  const save = async (patch: Partial<OrgSettings>) => {
    await api("/api/settings", { method: "PATCH", json: patch });
    toast("Policy updated");
    await qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const reset = async () => {
    if (!confirm("Reset all demo data? This wipes every chat, run and roster change and reseeds both businesses.")) return;
    setResetting(true);
    try {
      await api("/api/demo/reset", { method: "POST" });
      toast("Demo data reset");
      await qc.invalidateQueries();
    } finally {
      setResetting(false);
    }
  };
  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <div className="eyebrow">{data.org.name}</div>
            <h1 className="page-title">Settings</h1>
            <p className="page-lede">These are the boundaries ShiftPilot works within. Anything outside them stops and asks you.</p>
          </div>
        </header>
        <div className="settings-grid">
          <section className="card pad" aria-labelledby="rules-h">
            <h2 id="rules-h" className="card-h">
              Approval rules
            </h2>
            <ul className="setting-list">
              {TOGGLES.map((t) => (
                <li key={t.key}>
                  <div>
                    <div className="setting-label">{t.label}</div>
                    <div className="setting-hint">{t.hint}</div>
                  </div>
                  <Switch checked={Boolean(s[t.key])} onCheckedChange={(v) => save({ [t.key]: v } as Partial<OrgSettings>)} aria-label={t.label} />
                </li>
              ))}
              {NUMBERS.map((n) => (
                <li key={n.key}>
                  <div>
                    <div className="setting-label">{n.label}</div>
                    {n.hint && <div className="setting-hint">{n.hint}</div>}
                  </div>
                  <div className="setting-input">
                    <input
                      type="number"
                      aria-label={n.label}
                      defaultValue={Number(s[n.key])}
                      onBlur={(e) => Number(e.target.value) !== Number(s[n.key]) && save({ [n.key]: Number(e.target.value) } as Partial<OrgSettings>)}
                      className="field field-sm num"
                    />
                    <span>{n.unit}</span>
                  </div>
                </li>
              ))}
              <li>
                <div>
                  <div className="setting-label">Quiet hours</div>
                  <div className="setting-hint">Non-urgent messages wait until morning</div>
                </div>
                <div className="setting-input">
                  <input type="time" aria-label="Quiet hours start" defaultValue={s.quietStart} onBlur={(e) => save({ quietStart: e.target.value })} className="field field-sm" />
                  <span>to</span>
                  <input type="time" aria-label="Quiet hours end" defaultValue={s.quietEnd} onBlur={(e) => save({ quietEnd: e.target.value })} className="field field-sm" />
                </div>
              </li>
            </ul>
            <h2 className="card-h mt-8">Voice</h2>
            <p className="setting-hint mb-2">How ShiftPilot sounds when it messages your team.</p>
            <textarea aria-label="Voice" defaultValue={s.tone} onBlur={(e) => e.target.value !== s.tone && save({ tone: e.target.value })} rows={3} className="field" />
            <h2 className="card-h mt-8">What the agent tells staff (FAQ)</h2>
            <ul className="faq-list">
              {s.faq.map((f) => (
                <li key={f.q}>
                  <div className="font-semibold">{f.q}</div>
                  <div className="text-ink-soft">{f.a}</div>
                </li>
              ))}
            </ul>
          </section>
          <div className="grid content-start gap-6">
            <section className="card pad" aria-labelledby="outlets-h">
              <h2 id="outlets-h" className="card-h">
                Outlets ({data.outlets.length})
              </h2>
              <ul className="outlet-settings">
                {data.outlets.map((o) => (
                  <li key={o.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="setting-label">
                        <span className="outlet-code mr-2">{o.code}</span>
                        {o.name}
                      </span>
                      <span className="num text-[14px] text-ink-soft">
                        {o.openTime}–{o.closeTime}
                      </span>
                    </div>
                    <div className="setting-hint">
                      {o.address} · lead {o.leadName}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[...new Map(data.templates.filter((t) => t.outletId === o.id).map((t) => [`${t.label}${t.startTime}${t.headcount}`, t])).values()].map((t) => {
                        const dows = data.templates.filter((x) => x.outletId === o.id && x.label === t.label && x.startTime === t.startTime && x.headcount === t.headcount).map((x) => x.dow);
                        return (
                          <span key={t.id} className="chip">
                            {dows.length === 7 ? "Daily" : dows.length === 5 && !dows.includes(5) ? "Mon–Fri" : dows.map((d) => DOW_SHORT[d]).join("/")} · {t.label} {t.startTime}–{t.endTime} · {t.headcount}× {t.skill}
                          </span>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card pad demo-reset" aria-labelledby="demo-h">
              <div className="eyebrow">Demo</div>
              <h2 id="demo-h" className="card-h">
                Start again from a clean week
              </h2>
              <p className="setting-hint">Reset both businesses to the starting point: this week&apos;s roster, chats and memories, with the clock back to now. Use it before every recording.</p>
              <button type="button" disabled={resetting} onClick={reset} className="btn btn-signal mt-4">
                <RotateCcw className="size-4" aria-hidden /> {resetting ? "Resetting…" : "Reset demo data"}
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
