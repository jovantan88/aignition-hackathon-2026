"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, NavigationControl, useControl, type MapRef } from "react-map-gl/mapbox";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import { Pause, Play } from "lucide-react";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";
import type { OpsData, OpsOutlet } from "@/components/control/hooks";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type Arc = {
  key: string;
  from: [number, number];
  to: [number, number];
  state: "offered" | "filled" | "declined" | "expired" | "withdrawn";
  born: number;
  ended?: number;
  kind?: string;
};

function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

function lightPresetFor(hour: number) {
  if (hour < 6 || hour >= 20) return "night";
  if (hour < 8) return "dawn";
  if (hour >= 18) return "dusk";
  return "day";
}

const STATUS_COLOR = { ok: "#2F6B3A", risk: "#C98A0B", short: "#FF4F1A" } as const;

export function Beacon({ o, coverage, status, selected, pulse, onClick, compact, labelAbove, appearance }: { o: OpsOutlet; coverage: number; status: OpsOutlet["status"]; selected?: boolean; pulse?: "alert" | "ok" | null; onClick?: () => void; compact?: boolean; labelAbove?: boolean; appearance?: "workspace" }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const color = appearance === "workspace" ? { ok: "#2b6a3c", risk: "#b07a12", short: "#c4400c" }[status] : STATUS_COLOR[status];
  return (
    <button type="button" onClick={onClick} aria-label={`${o.name}, ${Math.round(coverage * 100)}% covered`} className={cn("group relative flex items-center", labelAbove ? "flex-col-reverse" : "flex-col")} style={{ transform: selected ? "scale(1.12)" : undefined }}>
      {(status !== "ok" || pulse) && (
        <span className="absolute top-[3px] left-1/2 size-[44px] -translate-x-1/2 animate-pulse-ring rounded-full" style={{ background: pulse === "ok" ? "#2F6B3A55" : `${color}55` }} />
      )}
      <svg width="50" height="50" viewBox="0 0 50 50" className="relative drop-shadow-[0_1px_0_rgba(22,19,15,0.15)]">
        <circle cx="25" cy="25" r="23" fill="#F8F5EE" stroke="#16130F" strokeWidth={selected ? 2 : 1} />
        <circle cx="25" cy="25" r={r} fill="none" stroke="#D6CFC2" strokeWidth="4" />
        <circle
          cx="25"
          cy="25"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${c * Math.max(0.02, coverage)} ${c}`}
          transform="rotate(-90 25 25)"
          style={{ transition: "stroke-dasharray .6s cubic-bezier(.2,.7,.2,1), stroke .3s" }}
        />
        <text x="25" y="28.5" textAnchor="middle" fontFamily="var(--font-geist-mono)" fontSize="10.5" fontWeight="600" fill="#16130F">
          {o.code}
        </text>
      </svg>
      {!compact && (
        <span className={cn("border border-ink bg-paper px-1.5 py-[1px] font-mono text-[10px] whitespace-nowrap text-ink", labelAbove ? "mb-0.5" : "mt-0.5")}>
          {o.name} · <span style={{ color }}>{Math.round(coverage * 100)}%</span>
        </span>
      )}
    </button>
  );
}

export function OpsMap({
  data,
  selected,
  onSelect,
  className,
  interactive = true,
  showScrubber = true,
  appearance,
  fit,
}: {
  data: OpsData;
  selected: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  interactive?: boolean;
  showScrubber?: boolean;
  appearance?: "workspace";
  /** Frame every outlet whatever the pane size (the stage's pane is narrower than the map was tuned for) */
  fit?: boolean;
}) {
  const mapRef = useRef<MapRef>(null);
  const [liveArcs, setLiveArcs] = useState<Arc[]>([]);
  const [pulses, setPulses] = useState<Record<string, { kind: "alert" | "ok"; until: number }>>({});
  const [now, setNow] = useState(() => Date.now());
  const [scrub, setScrub] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const hour = data.local.hour;

  // Arcs for active cover offers come from the server; live events add and fade their own
  // (born = 0: already fully drawn, no grow-in animation)
  const dbArcs = useMemo<Arc[]>(
    () => data.arcs.map((a) => ({ key: `db:${a.id}`, from: [a.from.lng, a.from.lat], to: [a.to.lng, a.to.lat], state: a.state, born: 0 })),
    [data.arcs],
  );

  useLive(["arc", "pulse"], (m) => {
    if (m.orgId !== data.org.id) return;
    const p = m.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (m.topic === "pulse") {
      setPulses((s) => ({ ...s, [p.outletId]: { kind: p.kind, until: Date.now() + 6000 } }));
      return;
    }
    const key = `live:${p.workerId}:${p.coverRequestId ?? p.kind ?? ""}`;
    setLiveArcs((all) => {
      // Drop arcs that have finished fading
      const prev = all.filter((a) => !a.ended || Date.now() - a.ended < (a.state === "filled" ? 25000 : 2500));
      const existing = prev.find((a) => a.key === key || (a.key.startsWith("db:") && p.from && a.from[0] === p.from.lng && a.from[1] === p.from.lat));
      if (p.from && p.to) {
        const arc: Arc = { key, from: [p.from.lng, p.from.lat], to: [p.to.lng, p.to.lat], state: p.state, born: existing?.born ?? Date.now(), kind: p.kind, ended: p.state === "filled" ? Date.now() : undefined };
        return [...prev.filter((a) => a !== existing), arc];
      }
      // declined / expired / withdrawn: fade out the matching arc
      return prev.map((a) => (a.key === key || (existing && a === existing) ? { ...a, state: p.state, ended: Date.now() } : a));
    });
  });

  // Animation clock for arc growth / pulsing
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);


  // Time-lapse playback
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setScrub((s) => (s == null || s >= 7 * 24 - 1 ? 0 : s + 1)), 120);
    return () => clearInterval(t);
  }, [playing]);

  const dayStart = useMemo(() => new Date(`${data.local.date}T00:00:00+08:00`).getTime(), [data.local.date]);
  const coverageAt = useCallback(
    (o: OpsOutlet) => {
      if (scrub == null) return { coverage: o.coverage, status: o.status };
      const ts = dayStart + scrub * 3600_000;
      const slot = o.byHour.find((b) => b.t === ts);
      if (!slot) return { coverage: 1, status: "ok" as const, closed: true };
      const cov = slot.have / slot.need;
      return { coverage: cov, status: cov >= 0.999 ? ("ok" as const) : cov >= 0.5 ? ("risk" as const) : ("short" as const) };
    },
    [scrub, dayStart],
  );

  const layers = useMemo(() => {
    const liveFroms = new Set(liveArcs.map((a) => `${a.from[0]},${a.from[1]}`));
    const arcs = [...dbArcs.filter((a) => !liveFroms.has(`${a.from[0]},${a.from[1]}`)), ...liveArcs].filter(
      (a) => !a.ended || now - a.ended < (a.state === "filled" ? 25000 : 2500),
    );
    const visible = arcs.map((a) => {
      const age = now - a.born;
      const grow = Math.min(1, age / 1100);
      const ease = 1 - Math.pow(1 - grow, 3);
      const target: [number, number] = [a.from[0] + (a.to[0] - a.from[0]) * ease, a.from[1] + (a.to[1] - a.from[1]) * ease];
      const fade = a.ended && a.state !== "filled" ? Math.max(0, 1 - (now - a.ended) / 2500) : a.ended ? Math.max(0.15, 1 - (now - a.ended) / 25000) : 1;
      const pulse = a.state === "offered" ? 0.55 + 0.45 * Math.sin(now / 260) : 1;
      return { ...a, target, alpha: Math.round(255 * fade * pulse) };
    });
    const color = (a: (typeof visible)[number]): [number, number, number, number] =>
      a.state === "filled" ? [47, 107, 58, a.alpha] : a.state === "offered" ? [255, 79, 26, a.alpha] : [107, 101, 92, a.alpha];
    return [
      new ArcLayer({
        id: "cover-arcs",
        data: visible,
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.target,
        getSourceColor: (d) => color(d),
        getTargetColor: (d) => color(d),
        getWidth: (d) => (d.state === "filled" ? 4 : 2.5),
        getHeight: 0.6,
        greatCircle: false,
        updateTriggers: { getTargetPosition: now, getSourceColor: now, getTargetColor: now },
      }),
      new ScatterplotLayer({
        id: "arc-homes",
        data: visible,
        getPosition: (d) => d.from,
        getRadius: 120,
        radiusMinPixels: 4,
        getFillColor: (d) => color(d),
        getLineColor: [22, 19, 15, 255],
        stroked: true,
        lineWidthMinPixels: 1,
        updateTriggers: { getFillColor: now },
      }),
    ];
  }, [dbArcs, liveArcs, now]);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    try {
      map.setConfig("basemap", { theme: "monochrome", lightPreset: appearance === "workspace" ? "day" : lightPresetFor(hour), showPointOfInterestLabels: false, showTransitLabels: false, showRoadLabels: false });
    } catch {}
    if ((appearance === "workspace" || fit) && data.outlets.length > 1) map.fitBounds([
      [Math.min(...data.outlets.map((o) => o.lng)), Math.min(...data.outlets.map((o) => o.lat))],
      [Math.max(...data.outlets.map((o) => o.lng)), Math.max(...data.outlets.map((o) => o.lat))],
    ], { padding: { top: 55, bottom: 95, left: 65, right: 65 }, maxZoom: 11.6, pitch: appearance === "workspace" ? 0 : 38, bearing: appearance === "workspace" ? 0 : -8, duration: 0 });
  }, [hour, appearance, fit, data.outlets]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.isStyleLoaded()) return;
    try {
      map.setConfigProperty("basemap", "lightPreset", appearance === "workspace" ? "day" : lightPresetFor(scrub != null ? Math.floor(scrub % 24) : hour));
    } catch {}
  }, [hour, scrub, appearance]);

  // Fly to the selected outlet
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const o = data.outlets.find((x) => x.id === selected);
    if (appearance === "workspace") {
      if (o) map.flyTo({ center: [o.lng, o.lat], zoom: 13.5, pitch: 0, bearing: 0, duration: 700 });
      else if (data.outlets.length > 1) map.fitBounds([
        [Math.min(...data.outlets.map((x) => x.lng)), Math.min(...data.outlets.map((x) => x.lat))],
        [Math.max(...data.outlets.map((x) => x.lng)), Math.max(...data.outlets.map((x) => x.lat))],
      ], { padding: { top: 55, bottom: 95, left: 65, right: 65 }, maxZoom: 11.6, pitch: 0, bearing: 0, duration: 700 });
      return;
    }
    if (o) map.flyTo({ center: [o.lng, o.lat], zoom: 15.6, pitch: 62, bearing: -20, duration: 1800, essential: true });
    else if (data.outlets.length > 1 && fit) map.fitBounds([
      [Math.min(...data.outlets.map((x) => x.lng)), Math.min(...data.outlets.map((x) => x.lat))],
      [Math.max(...data.outlets.map((x) => x.lng)), Math.max(...data.outlets.map((x) => x.lat))],
    ], { padding: { top: 55, bottom: 95, left: 65, right: 65 }, maxZoom: 11.6, pitch: 38, bearing: -8, duration: 1400 });
    else if (data.outlets.length > 1) map.flyTo({ center: [103.835, 1.352], zoom: 10.7, pitch: 38, bearing: -8, duration: 1400 });
  }, [selected, data.outlets, appearance, fit]);

  if (!TOKEN) {
    return (
      <div className={cn("flex items-center justify-center bg-panel hatch-ink", className)}>
        <div className="max-w-xs border border-ink bg-card p-4 text-center text-[13px]">Add NEXT_PUBLIC_MAPBOX_TOKEN to .env.local to see the live map.</div>
      </div>
    );
  }

  const single = data.outlets.length === 1;
  const init = single
    ? { longitude: data.outlets[0].lng, latitude: data.outlets[0].lat, zoom: 15.4, pitch: 58, bearing: -18 }
    : { longitude: 103.835, latitude: 1.352, zoom: 10.7, pitch: 38, bearing: -8 };

  return (
    <div className={cn("relative overflow-hidden bg-[#E9E5DC]", className)}>
      <MapGL
        ref={mapRef}
        mapboxAccessToken={TOKEN}
        initialViewState={appearance === "workspace" ? { ...init, pitch: 0, bearing: 0 } : init}
        mapStyle="mapbox://styles/mapbox/standard"
        onLoad={onLoad}
        interactive={interactive}
        attributionControl={false}
        style={{ width: "100%", height: "100%" }}
        onClick={() => onSelect(null)}
      >
        {interactive && <NavigationControl position="bottom-right" showCompass visualizePitch />}
        <DeckOverlay layers={layers} />
        {data.outlets.map((o) => {
          const c = coverageAt(o);
          const pulse = pulses[o.id] && pulses[o.id].until > now ? pulses[o.id].kind : null;
          // Flip the label above when another outlet sits just below this one
          const labelAbove = data.outlets.some((x) => x.id !== o.id && x.lat < o.lat && o.lat - x.lat < 0.04 && Math.abs(x.lng - o.lng) < 0.04);
          return (
            <Marker key={o.id} longitude={o.lng} latitude={o.lat} anchor={labelAbove ? "bottom" : "top"} offset={[0, labelAbove ? 25 : -25]}>
              <Beacon
                appearance={appearance}
                o={o}
                coverage={c.coverage}
                status={c.status}
                selected={selected === o.id}
                pulse={pulse}
                labelAbove={labelAbove}
                onClick={() => onSelect(selected === o.id ? null : o.id)}
              />
            </Marker>
          );
        })}
      </MapGL>

      {showScrubber && (
        <div className={cn("absolute inset-x-3 bottom-3 flex items-center gap-3 border border-ink bg-paper/95 px-3 py-2 sm:right-14", appearance === "workspace" && "workspace-map-scrubber")}>
          <button type="button" onClick={() => (setPlaying(!playing), scrub == null && setScrub(0))} className="flex size-7 items-center justify-center bg-ink text-paper" title="Play the week">
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
          </button>
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min={0}
              max={7 * 24 - 1}
              value={scrub ?? data.local.hour}
              onChange={(e) => {
                setPlaying(false);
                setScrub(Number(e.target.value));
              }}
              className="w-full accent-[#FF4F1A]"
              aria-label="Scrub through the week"
            />
            <div className="flex justify-between font-mono text-[9.5px] tracking-wider text-ink-soft uppercase">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i}>{new Date(dayStart + i * 86400_000).toLocaleDateString("en-SG", { weekday: "short", timeZone: "Asia/Singapore" })}</span>
              ))}
            </div>
          </div>
          <div className="w-[118px] text-right">
            <div className="label-mono">{scrub == null ? "Now" : "Time-lapse"}</div>
            <div className="num font-mono text-[12.5px]">
              {scrub == null
                ? new Date(data.now).toLocaleTimeString("en-SG", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" })
                : new Date(dayStart + scrub * 3600_000).toLocaleString("en-SG", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Singapore" })}
            </div>
          </div>
          {scrub != null && (
            <button type="button" onClick={() => (setScrub(null), setPlaying(false))} className="font-mono text-[10.5px] tracking-wide text-ink-soft uppercase hover:text-ink">
              Live
            </button>
          )}
        </div>
      )}
    </div>
  );
}
