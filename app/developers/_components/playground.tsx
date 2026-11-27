"use client";

/**
 * Controlled playground: every change goes through the public SDK with validated inputs (controls,
 * or a layout JSON applied with chart.loadLayout, which validates and is atomic). No user-supplied
 * code is executed: there is no eval, Function constructor or script injection.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChartApi, IndicatorDefinition } from "@/lib/xchart-sdk";
import { synthetic } from "./data";

type SDK = typeof import("@/lib/xchart-sdk");
const DATASETS = {
  daily: { label: "Daily, 2 years (trend)", make: () => synthetic(500, { seed: 7 }) },
  intraday: { label: "5-minute, 5 sessions", make: () => synthetic(375, { seed: 12, step: 300, start: Date.UTC(2026, 0, 5, 3, 45) / 1000, vol: 0.003 }) },
  volatile: { label: "Daily, high volatility", make: () => synthetic(400, { seed: 99, vol: 0.03 }) },
} as const;
type DatasetId = keyof typeof DATASETS;
const TYPES = ["candles", "hollow-candles", "bars", "heikin-ashi", "line", "area", "baseline", "renko", "kagi", "point-and-figure", "line-break", "range-bars"] as const;
const MAX_INDICATORS = 6;

export function Playground() {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const sdkRef = useRef<SDK | null>(null);
  const [catalog, setCatalog] = useState<IndicatorDefinition[]>([]);
  const [dataset, setDataset] = useState<DatasetId>("daily");
  const [type, setType] = useState<(typeof TYPES)[number]>("candles");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mode, setMode] = useState<"normal" | "logarithmic" | "percentage">("normal");
  const [selected, setSelected] = useState<string[]>(["ema", "rsi"]);
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  // (Re)build the chart from the controls.
  useEffect(() => {
    let disposed = false;
    import("@/lib/xchart-sdk").then((sdk) => {
      if (disposed || !box.current) return;
      sdkRef.current = sdk;
      chartRef.current?.remove();
      const c = sdk.createChart(box.current, { theme });
      chartRef.current = c;
      setCatalog(c.listIndicators());
      c.addCandlestickSeries().setData(DATASETS[dataset].make());
      for (const id of selected) {
        try {
          c.addIndicator(id);
        } catch (e) {
          setMsg({ tone: "err", text: `${id}: ${(e as Error).message}` });
        }
      }
      try {
        c.priceScale("right").applyOptions({ mode });
        c.setChartType(type);
      } catch (e) {
        setMsg({ tone: "err", text: (e as Error).message });
      }
    });
    return () => {
      disposed = true;
    };
  }, [dataset, type, theme, mode, selected, version]);
  useEffect(() => () => chartRef.current?.remove(), []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((d) => !q || d.id.includes(q) || d.name.toLowerCase().includes(q) || (d.category ?? "").toLowerCase().includes(q)).slice(0, 60);
  }, [catalog, query]);

  const toggle = (id: string) => {
    setMsg(null);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_INDICATORS ? s : [...s, id]));
  };

  const code = [
    `const chart = createChart(el, { theme: "${theme}" });`,
    `chart.addCandlestickSeries().setData(data); // ${DATASETS[dataset].label} (synthetic)`,
    ...selected.map((id) => `chart.addIndicator("${id}");`),
    mode !== "normal" ? `chart.priceScale("right").applyOptions({ mode: "${mode}" });` : "",
    type !== "candles" ? `chart.setChartType("${type}");` : "",
  ].filter(Boolean).join("\n");

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3 text-xs">
          <label className="block space-y-1">
            <span className="text-muted">Data</span>
            <select className="w-full rounded-lg border border-line bg-panel px-2 py-1.5" value={dataset} onChange={(e) => setDataset(e.target.value as DatasetId)}>
              {Object.entries(DATASETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted">Chart type</span>
            <select className="w-full rounded-lg border border-line bg-panel px-2 py-1.5" value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <label className="flex-1 space-y-1">
              <span className="text-muted">Theme</span>
              <select className="w-full rounded-lg border border-line bg-panel px-2 py-1.5" value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}><option>dark</option><option>light</option></select>
            </label>
            <label className="flex-1 space-y-1">
              <span className="text-muted">Price scale</span>
              <select className="w-full rounded-lg border border-line bg-panel px-2 py-1.5" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option>normal</option><option>logarithmic</option><option>percentage</option></select>
            </label>
          </div>
          <div className="space-y-1">
            <span className="text-muted">Indicators ({selected.length}/{MAX_INDICATORS}) — {catalog.length} available</span>
            <input className="w-full rounded-lg border border-line bg-panel px-2 py-1.5" placeholder="Search (e.g. vwap, Volatility)…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search indicators" />
            <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
              {matches.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-white/5">
                    <input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} disabled={!selected.includes(d.id) && selected.length >= MAX_INDICATORS} />
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto text-[10px] text-muted">{d.category}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-2">
          <div ref={box} className="h-[440px] w-full overflow-hidden rounded-xl border border-line" data-testid="playground-chart" />
          <pre className="overflow-x-auto rounded-xl border border-line bg-panel p-3 font-mono text-[12px] text-soft"><code>{code}</code></pre>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-muted">Layout JSON: save the current chart, edit it, and load it back. Loading is validated and atomic: an invalid layout changes nothing.</p>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5" onClick={() => { setLayout(JSON.stringify(chartRef.current?.saveLayout(), null, 1)); setMsg(null); }}>Save layout</button>
          <button className="rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5 disabled:opacity-40" disabled={!layout} onClick={() => {
            try {
              const r = chartRef.current!.loadLayout(layout);
              setMsg({ tone: "ok", text: `Loaded: ${r.indicatorsAdded} indicator(s), ${r.drawings} drawing(s)${r.indicatorsSkipped.length ? `; skipped ${r.indicatorsSkipped.join(", ")}` : ""}.` });
            } catch (e) {
              setMsg({ tone: "err", text: `Rejected (nothing changed): ${(e as Error).message}` });
            }
          }}>Load layout</button>
          <button className="rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5" onClick={() => { setMsg(null); setVersion((v) => v + 1); }}>Reset</button>
        </div>
        <textarea className="h-40 w-full rounded-lg border border-line bg-panel p-2 font-mono text-[11px]" value={layout} onChange={(e) => setLayout(e.target.value)} aria-label="Layout JSON" spellCheck={false} />
        {msg && <p role="status" className={`text-xs ${msg.tone === "ok" ? "text-up" : "text-amber-300"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
