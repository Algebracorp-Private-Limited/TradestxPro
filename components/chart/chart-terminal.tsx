"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PriceChart, type ActiveIndicator, type ChartStyle } from "./price-chart";
import { useBars } from "./use-bars";
import { SymbolSearch } from "./symbol-search";
import { IndicatorChips, IndicatorPicker } from "./indicator-picker";
import { XScriptLab, type AppliedScript } from "./xscript-lab";
import type { ChartEngine, Drawing, DrawingTool } from "./engine";
import { defaultParams } from "@/lib/ta/catalog";
import { runXScript, XScriptError, type XInput, type XResult } from "@/lib/xscript/xscript";

const EOD_TFS = ["1D", "1W", "1M"];
const LIVE_TFS = ["1m", "5m", "15m", "30m", "1h", "4h", "1D", "1W"];
const STYLES: { id: ChartStyle; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "heikin", label: "Heikin-Ashi" },
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
];
const TOOLS: { id: DrawingTool; label: string; icon: string }[] = [
  { id: "trend", label: "Trend line", icon: "╱" },
  { id: "hline", label: "Horizontal line", icon: "―" },
  { id: "rect", label: "Rectangle", icon: "▭" },
  { id: "fib", label: "Fibonacci retracement", icon: "≡" },
];

type Layout = { indicators: ActiveIndicator[]; drawings: Drawing[]; style: ChartStyle };
const DEFAULT_LAYOUT: Layout = {
  indicators: [
    { uid: "d1", id: "ema", params: { length: 20 } },
    { uid: "d2", id: "ema", params: { length: 50 } },
    { uid: "d3", id: "volume", params: { length: 20 } },
    { uid: "d4", id: "rsi", params: { length: 14 } },
  ],
  drawings: [],
  style: "candles",
};

function loadLayout(symbol: string): Layout {
  try {
    const raw = localStorage.getItem(`txp.layout.${symbol}`) ?? localStorage.getItem("txp.layout.default");
    if (raw) {
      const l = JSON.parse(raw) as Partial<Layout>;
      return { indicators: l.indicators ?? DEFAULT_LAYOUT.indicators, drawings: localStorage.getItem(`txp.layout.${symbol}`) ? l.drawings ?? [] : [], style: l.style ?? "candles" };
    }
  } catch {}
  return DEFAULT_LAYOUT;
}

export function ChartTerminal() {
  const router = useRouter();
  const params = useSearchParams();
  const symbol = params.get("symbol") || "NSEIDX:NIFTY 50";
  const isLive = symbol.startsWith("DELTA:");
  const tf = params.get("tf") ?? (isLive ? "1h" : "1D");
  const data = useBars(symbol, tf);
  const tfs = data.tfs.length ? data.tfs : isLive ? LIVE_TFS : EOD_TFS;

  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawingTool>("none");
  const [picker, setPicker] = useState(false);
  const [lab, setLab] = useState(false);
  const [applied, setApplied] = useState<AppliedScript[]>([]);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);

  useEffect(() => {
    const l = loadLayout(symbol);
    let labOpen = false;
    try {
      localStorage.setItem("txp.chart.last", symbol);
      labOpen = localStorage.getItem("txp.lab.open") === "1";
    } catch {}
    Promise.resolve().then(() => {
      setLayout(l);
      setLoadedFor(symbol);
      setLab(labOpen);
    });
  }, [symbol]);

  useEffect(() => {
    if (loadedFor !== symbol) return;
    try { localStorage.setItem(`txp.layout.${symbol}`, JSON.stringify(layout)); } catch {}
  }, [layout, symbol, loadedFor]);

  const nav = (next: { symbol?: string; tf?: string }) => {
    const q = new URLSearchParams({ symbol: next.symbol ?? symbol, tf: next.tf ?? tf });
    if (next.symbol && next.symbol.startsWith("DELTA:") !== isLive) q.delete("tf");
    router.replace(`/charts?${q}`);
  };

  const { results, status } = useMemo(() => {
    const results: XResult[] = [];
    const status: Record<string, { error?: string; inputs?: XInput[]; ms?: number; title?: string }> = {};
    if (!data.bars.length) return { results, status };
    for (const s of applied) {
      try {
        const r = runXScript(s.code, data.bars, s.inputs);
        results.push(r);
        status[s.uid] = { inputs: r.inputs, ms: r.ms, title: r.title };
      } catch (e) {
        status[s.uid] = { error: e instanceof XScriptError ? e.message : `Script failed: ${(e as Error).message}` };
      }
    }
    return { results, status };
  }, [applied, data.bars]);

  const setIndicators = (indicators: ActiveIndicator[]) => setLayout((l) => ({ ...l, indicators }));

  return (
    <div className="-m-4 flex h-[calc(100dvh-53px-64px)] flex-col sm:-m-6 lg:h-[calc(100dvh-53px)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <SymbolSearch symbol={symbol} name={data.name} onPick={(s) => nav({ symbol: s })} />
        <div role="group" aria-label="Timeframe" className="flex rounded-md border border-line p-0.5">
          {tfs.map((t) => (
            <button key={t} onClick={() => nav({ tf: t })} aria-pressed={tf === t} className={`rounded px-2 py-1 font-mono text-xs ${tf === t ? "bg-white text-slate-950" : "text-soft hover:text-white"}`}>{t}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="chart-style">Chart type</label>
        <select id="chart-style" value={layout.style} onChange={(e) => setLayout((l) => ({ ...l, style: e.target.value as ChartStyle }))} className="rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-soft">
          {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button onClick={() => setPicker(true)} className="rounded-md border border-line px-2.5 py-1.5 text-xs hover:bg-white/5">ƒx Indicators</button>
        <button
          onClick={() => {
            setLab((v) => {
              try { localStorage.setItem("txp.lab.open", v ? "0" : "1"); } catch {}
              return !v;
            });
          }}
          aria-pressed={lab}
          className={`rounded-md border px-2.5 py-1.5 text-xs ${lab ? "border-accent/60 bg-accent/10 text-accent" : "border-line hover:bg-white/5"}`}
        >
          {"{}"} XScript Lab
        </button>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />
        <div role="group" aria-label="Drawing tools" className="flex gap-0.5">
          {TOOLS.map((t) => (
            <button key={t.id} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(tool === t.id ? "none" : t.id)}
              className={`h-7 w-7 rounded-md text-sm ${tool === t.id ? "bg-gold/20 text-gold" : "text-soft hover:bg-white/5"}`}>
              {t.icon}
            </button>
          ))}
          <button title="Undo last drawing" aria-label="Undo last drawing" disabled={!layout.drawings.length} onClick={() => setLayout((l) => ({ ...l, drawings: l.drawings.slice(0, -1) }))} className="h-7 w-7 rounded-md text-sm text-soft hover:bg-white/5 disabled:opacity-30">↶</button>
          <button title="Clear drawings" aria-label="Clear drawings" disabled={!layout.drawings.length} onClick={() => setLayout((l) => ({ ...l, drawings: [] }))} className="h-7 w-7 rounded-md text-sm text-soft hover:bg-white/5 disabled:opacity-30">⌫</button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button aria-label="Zoom in" onClick={() => engineRef.current?.zoom(1.25)} className="h-7 w-7 rounded-md text-soft hover:bg-white/5">＋</button>
          <button aria-label="Zoom out" onClick={() => engineRef.current?.zoom(0.8)} className="h-7 w-7 rounded-md text-soft hover:bg-white/5">－</button>
          <button aria-label="Reset view" onClick={() => engineRef.current?.fit()} className="h-7 rounded-md px-2 text-xs text-soft hover:bg-white/5">Reset</button>
          <button
            onClick={() => {
              try {
                localStorage.setItem("txp.layout.default", JSON.stringify({ indicators: layout.indicators, style: layout.style }));
                setSavedNote("Saved as default layout");
                setTimeout(() => setSavedNote(null), 2000);
              } catch {}
            }}
            className="h-7 rounded-md px-2 text-xs text-soft hover:bg-white/5"
          >
            Save layout
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ink px-3 py-1.5">
        <span className="max-w-[40ch] truncate text-xs text-soft" title={data.name}>{data.name}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${data.delayed ? "bg-gold/15 text-gold" : "bg-up/15 text-up"}`}>{data.delayed ?? "Live · refreshes 30s"}</span>
        <IndicatorChips items={layout.indicators} onChange={setIndicators} />
        {data.notice && <span className="text-xs text-gold">{data.notice}</span>}
        {tool !== "none" && <span className="text-xs text-gold">{tool === "hline" ? "Click the chart to place a line" : "Click two points on the chart"}</span>}
        {savedNote && <span role="status" className="text-xs text-up">{savedNote}</span>}
      </div>

      <div className={`grid min-h-0 flex-1 ${lab ? "grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-1" : ""}`}>
        <div className="relative min-h-0">
          {data.status === "ready" && data.bars.length > 0 ? (
            <PriceChart
              bars={data.bars}
              style={layout.style}
              indicators={layout.indicators}
              scripts={results}
              intraday={!["1D", "1W", "1M"].includes(tf)}
              tool={tool}
              onToolDone={() => setTool("none")}
              drawings={layout.drawings}
              onDrawingsChange={(d) => setLayout((l) => ({ ...l, drawings: d }))}
              engineRef={engineRef}
              className="h-full"
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted">
              {data.status === "error" ? data.error : data.status === "ready" ? "No price history for this symbol yet." : "Loading chart…"}
            </div>
          )}
        </div>
        {lab && (
          <div className="min-h-0 border-t border-line lg:border-l lg:border-t-0">
            <XScriptLab
              applied={applied}
              status={status}
              onApply={(s) => setApplied((a) => [...a.filter((x) => x.uid !== s.uid), s])}
              onRemove={(uid) => setApplied((a) => a.filter((x) => x.uid !== uid))}
              onInputs={(uid, inputs) => setApplied((a) => a.map((x) => (x.uid === uid ? { ...x, inputs } : x)))}
              onClose={() => {
                setLab(false);
                try { localStorage.setItem("txp.lab.open", "0"); } catch {}
              }}
            />
          </div>
        )}
      </div>

      <p className="border-t border-line bg-panel px-3 py-1 text-[10px] text-muted">
        Source: {data.source || "—"}. Scroll to zoom · drag to pan · double-click to reset. Research tool only, not investment advice.
      </p>

      {picker && (
        <IndicatorPicker
          onClose={() => setPicker(false)}
          onAdd={(def) => {
            setIndicators([...layout.indicators, { uid: `${def.id}-${Date.now()}`, id: def.id, params: defaultParams(def) }]);
            setPicker(false);
          }}
        />
      )}
    </div>
  );
}
