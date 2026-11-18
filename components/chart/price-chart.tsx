"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChartEngine, type ChartData, type ChartType, type CrosshairInfo, type Drawing, type DrawingTool, type PaneSpec, type PlotSeries } from "./engine";
import { INDICATOR_BY_ID, heikinAshi, type Bar } from "@/lib/ta/catalog";
import type { XResult } from "@/lib/xscript/xscript";

export type ActiveIndicator = { uid: string; id: string; params: Record<string, number> };
export type ChartStyle = ChartType | "heikin";

type Props = {
  bars: Bar[];
  style: ChartStyle;
  indicators: ActiveIndicator[];
  scripts?: XResult[];
  intraday?: boolean;
  tool?: DrawingTool;
  onToolDone?: () => void;
  drawings?: Drawing[];
  onDrawingsChange?: (d: Drawing[]) => void;
  className?: string;
  engineRef?: React.MutableRefObject<ChartEngine | null>;
};

const fmt = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(v) >= 1 || v === 0 ? 2 : 5 }) : "—";

export function PriceChart({ bars, style, indicators, scripts = [], intraday, tool = "none", onToolDone, drawings, onDrawingsChange, className = "", engineRef }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const engine = useRef<ChartEngine | null>(null);
  const [cross, setCross] = useState<CrosshairInfo>(null);
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
    });
    engine.current = e;
    if (engineRef) engineRef.current = e;
    return () => {
      e.destroy();
      engine.current = null;
      if (engineRef) engineRef.current = null;
    };
  }, [engineRef]);

  const data: ChartData = useMemo(() => {
    const shown = style === "heikin" ? heikinAshi(bars) : bars;
    const overlays: PlotSeries[] = [];
    const panes: PaneSpec[] = [];
    for (const ind of indicators) {
      const def = INDICATOR_BY_ID[ind.id];
      if (!def) continue;
      const outs = def.compute(bars, ind.params).map((o) => ({ label: o.label, values: o.values, color: o.color, style: o.style }));
      if (def.pane === "overlay") overlays.push(...outs);
      else panes.push({ id: ind.uid, title: def.short, series: outs, levels: def.levels, range: def.range });
    }
    const markers = [];
    for (const s of scripts) {
      const series = s.plots.map((p) => ({ label: p.title, values: p.values, color: p.color, style: p.style }));
      if (s.overlay) overlays.push(...series);
      else if (series.length || s.hlines.length) panes.push({ id: "xs-" + s.title, title: s.title, series, levels: s.hlines.map((h) => h.value) });
      markers.push(...s.markers);
    }
    return { bars: shown, type: style === "heikin" ? "candles" : style, overlays, panes, markers, intraday };
  }, [bars, style, indicators, scripts, intraday]);

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

  const bar = cross?.bar ?? bars[bars.length - 1];
  const prev = bars[(cross?.index ?? bars.length - 1) - 1];
  const chg = bar && prev ? ((bar.c - prev.c) / prev.c) * 100 : NaN;
  const values = cross?.values ?? data.overlays.concat(data.panes.flatMap((p) => p.series)).map((s) => ({ label: s.label, color: s.color, value: s.values[s.values.length - 1] }));

  return (
    <div className={`relative min-h-0 ${className}`}>
      <div ref={box} className="absolute inset-0" />
      {bar && (
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 max-w-[calc(100%-90px)] font-mono text-[11px] leading-5">
          <div className="flex flex-wrap gap-x-2.5">
            {(["o", "h", "l", "c"] as const).map((k) => (
              <span key={k} className="text-muted">
                {k.toUpperCase()} <span className={bar.c >= bar.o ? "text-up" : "text-down"}>{fmt(bar[k])}</span>
              </span>
            ))}
            {Number.isFinite(chg) && <span className={chg >= 0 ? "text-up" : "text-down"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}
            {bar.v > 0 && <span className="text-muted">V <span className="text-soft">{bar.v.toLocaleString("en-IN")}</span></span>}
          </div>
          <div className="flex flex-wrap gap-x-2.5">
            {values.slice(0, 14).map((v, i) => (
              <span key={i} style={{ color: v.color }}>
                {v.label} {fmt(v.value)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
