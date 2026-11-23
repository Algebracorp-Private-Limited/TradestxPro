"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChartEngine, fmtPrice, fmtValue, type ChartData, type ChartType, type CrosshairInfo, type Drawing, type DrawingTool, type PaneBox, type PaneSpec, type PlotSeries, type ScaleState } from "./engine";
import { INDICATOR_BY_ID, heikinAshi, type Bar } from "@/lib/ta/catalog";
import { ALL_VISIBLE, inputSummary, resolveIndicator, tfBucket, type ActiveIndicator } from "@/lib/ta/indicator-settings";
import type { XResult } from "@/lib/xscript/xscript";
import { IndicatorSettingsDialog } from "./indicator-settings";

export type { ActiveIndicator };
export type ChartStyle = ChartType | "heikin";

type Props = {
  bars: Bar[];
  style: ChartStyle;
  indicators: ActiveIndicator[];
  onIndicatorsChange?: (items: ActiveIndicator[]) => void;
  scripts?: XResult[];
  intraday?: boolean;
  tf?: string;
  tool?: DrawingTool;
  onToolDone?: () => void;
  drawings?: Drawing[];
  onDrawingsChange?: (d: Drawing[]) => void;
  className?: string;
  engineRef?: React.MutableRefObject<ChartEngine | null>;
};

const fmt = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? fmtPrice(v) : "—");
const fmtLegend = (v: number | undefined, precision?: number) => (v !== undefined && Number.isFinite(v) ? fmtValue(v, precision) : "—");

type Group = { uid: string; title: string; series: PlotSeries[]; pane: string; indicator?: ActiveIndicator };

export function PriceChart({ bars, style, indicators, onIndicatorsChange, scripts = [], intraday, tf = "1D", tool = "none", onToolDone, drawings, onDrawingsChange, className = "", engineRef }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const engine = useRef<ChartEngine | null>(null);
  const [cross, setCross] = useState<CrosshairInfo>(null);
  const [panes, setPanes] = useState<PaneBox[]>([]);
  const [scale, setScale] = useState<ScaleState>({ auto: true, log: false });
  const [editing, setEditing] = useState<string | null>(null);
  const cb = useRef({ onToolDone, onDrawingsChange });
  useEffect(() => {
    cb.current = { onToolDone, onDrawingsChange };
  });

  useEffect(() => {
    if (!box.current) return;
    const e = new ChartEngine(box.current, {
      onCrosshair: setCross,
      onDrawingsChange: (d) => cb.current.onDrawingsChange?.(d),
      onToolDone: () => cb.current.onToolDone?.(),
      onLayout: setPanes,
      onScale: setScale,
    });
    engine.current = e;
    if (engineRef) engineRef.current = e;
    return () => {
      e.destroy();
      engine.current = null;
      if (engineRef) engineRef.current = null;
    };
  }, [engineRef]);

  const bucket = tfBucket(tf);

  const { data, groups } = useMemo(() => {
    const shown = style === "heikin" ? heikinAshi(bars) : bars;
    const overlays: PlotSeries[] = [];
    const paneSpecs: PaneSpec[] = [];
    const groups: Group[] = [];
    for (const ind of indicators) {
      const def = INDICATOR_BY_ID[ind.id];
      if (!def) continue;
      const visibleHere = (ind.visibility ?? ALL_VISIBLE)[bucket] !== false;
      const placement = ind.placement ?? def.pane;
      let series: PlotSeries[] = [];
      let resolved: ReturnType<typeof resolveIndicator> = null;
      try {
        resolved = resolveIndicator(ind, bars, { intraday: !!intraday });
        series = resolved?.series ?? [];
      } catch {}
      const paneId = placement === "overlay" ? "main" : ind.uid;
      groups.push({ uid: ind.uid, title: def.short, series, pane: paneId, indicator: ind });
      if (ind.hidden || !visibleHere) continue;
      if (placement === "overlay") overlays.push(...series);
      else paneSpecs.push({ id: ind.uid, title: def.short, series, levels: resolved?.levels, bands: resolved?.bands, range: resolved?.range });
    }
    const markers = [];
    for (const s of scripts) {
      const series = s.plots.map((p) => ({ label: p.title, values: p.values, color: p.color, style: p.style }));
      const id = "xs-" + s.title;
      if (s.overlay) overlays.push(...series);
      else if (series.length || s.hlines.length) paneSpecs.push({ id, title: s.title, series, levels: s.hlines.map((h) => h.value) });
      groups.push({ uid: id, title: s.title, series, pane: s.overlay ? "main" : id });
      markers.push(...s.markers);
    }
    // Space past the last bar that overlays extend into (projected Ichimoku cloud).
    const future = overlays.reduce((m, s) => Math.max(m, s.values.length - shown.length), 0);
    const data: ChartData = { bars: shown, type: style === "heikin" ? "candles" : style, overlays, panes: paneSpecs, markers, intraday, future };
    return { data, groups };
  }, [bars, style, indicators, scripts, intraday, bucket]);

  const barsKey = bars.length ? `${bars[0].t}-${bars.length}` : "0";
  const lastKey = useRef("");
  useEffect(() => {
    const keep = lastKey.current.split("-")[0] === barsKey.split("-")[0];
    engine.current?.setData(data, keep);
    lastKey.current = barsKey;
  }, [data, barsKey]);

  useEffect(() => engine.current?.setTool(tool), [tool]);
  useEffect(() => {
    if (drawings) engine.current?.setDrawings(drawings);
  }, [drawings]);

  const idx = cross?.index ?? bars.length - 1;
  const projected = idx > bars.length - 1;
  const bar = bars[Math.min(idx, bars.length - 1)];
  const prev = bars[Math.min(idx, bars.length - 1) - 1];
  const chg = bar && prev ? ((bar.c - prev.c) / prev.c) * 100 : NaN;
  const update = (next: ActiveIndicator) => onIndicatorsChange?.(indicators.map((i) => (i.uid === next.uid ? next : i)));
  const editingInd = indicators.find((i) => i.uid === editing);

  const legendRow = (g: Group) => {
    const ind = g.indicator;
    const hidden = ind?.hidden;
    return (
      <div key={g.uid} className="group pointer-events-auto flex max-w-full items-center gap-1.5 rounded-md bg-ink/60 px-1.5 backdrop-blur-[2px] hover:bg-panel/90">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: g.series[0]?.hist?.colors[0] ?? g.series[0]?.color ?? "#64748b", opacity: hidden ? 0.3 : 1 }} />
        <button
          onClick={() => ind && setEditing(ind.uid)}
          disabled={!ind}
          className={`truncate text-left font-sans font-medium ${hidden ? "text-muted/60 line-through" : "text-soft"} hover:text-white`}
          title={ind ? "Settings" : g.title}
        >
          {g.title}
          {ind && ind.statusInputs !== false && inputSummary(ind) ? <span className="hidden font-mono font-normal text-muted sm:inline"> {inputSummary(ind)}</span> : null}
        </button>
        {!hidden && (ind?.statusValues ?? true) && g.series.slice(0, 7).map((s, k) => (
          <span key={k} style={{ color: s.hist?.colors[0] ?? s.color }} className="hidden shrink-0 tabular-nums sm:inline" title={s.label}>{fmtLegend(s.values[idx], s.precision)}</span>
        ))}
        {ind && onIndicatorsChange && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
            <button onClick={() => update({ ...ind, hidden: !hidden })} aria-label={hidden ? `Show ${g.title}` : `Hide ${g.title}`} className="rounded px-1 hover:bg-white/10">{hidden ? "◌" : "◉"}</button>
            <button onClick={() => setEditing(ind.uid)} aria-label={`${g.title} settings`} className="rounded px-1 hover:bg-white/10">⚙</button>
            <button onClick={() => onIndicatorsChange(indicators.filter((i) => i.uid !== ind.uid))} aria-label={`Remove ${g.title}`} className="rounded px-1 hover:bg-white/10 hover:text-rose-300">✕</button>
          </span>
        )}
      </div>
    );
  };

  const mainPane = panes.find((p) => p.id === "main");

  return (
    <div className={`relative min-h-0 ${className}`}>
      <div ref={box} className="absolute inset-0" />
      {bar && (
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 max-w-[calc(100%-90px)] space-y-0.5 font-mono text-[11px] leading-5">
          <div className="flex flex-wrap gap-x-2.5">
            {(["o", "h", "l", "c"] as const).map((k) => (
              <span key={k} className={`text-muted ${k === "c" ? "" : "hidden sm:inline"}`}>
                {k.toUpperCase()} <span className={bar.c >= bar.o ? "text-up" : "text-down"}>{fmt(bar[k])}</span>
              </span>
            ))}
            {Number.isFinite(chg) && <span className={chg >= 0 ? "text-up" : "text-down"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}
            {bar.v > 0 && <span className="hidden text-muted sm:inline">V <span className="text-soft">{bar.v.toLocaleString("en-IN")}</span></span>}
            {projected && <span className="rounded bg-accent/15 px-1 font-sans text-[10px] text-accent">Projection · {idx - (bars.length - 1)} bars ahead</span>}
          </div>
          {groups.filter((g) => g.pane === "main").map(legendRow)}
        </div>
      )}
      {panes.filter((p) => p.id !== "main").map((p) => (
        <div key={p.id} className="pointer-events-none absolute left-2 z-10 max-w-[calc(100%-90px)] font-mono text-[11px] leading-5" style={{ top: p.top + 2 }}>
          {groups.filter((g) => g.pane === p.id).map(legendRow)}
        </div>
      ))}
      {mainPane && (
        <div className="absolute z-10 flex gap-1" style={{ right: 76, top: mainPane.top + mainPane.height - 26 }}>
          <button
            onClick={() => engine.current?.setScale({ log: !scale.log })}
            aria-pressed={scale.log}
            title="Logarithmic price scale"
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${scale.log ? "bg-accent/20 text-accent" : "bg-panel/80 text-muted hover:text-white"}`}
          >
            log
          </button>
          <button
            onClick={() => engine.current?.setScale({ auto: !scale.auto })}
            aria-pressed={scale.auto}
            title="Auto-fit price scale to visible data"
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${scale.auto ? "bg-accent/20 text-accent" : "bg-panel/80 text-muted hover:text-white"}`}
          >
            auto
          </button>
        </div>
      )}
      {editingInd && (
        <IndicatorSettingsDialog value={editingInd} bars={bars} onApply={update} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
