"use client";

import { useEffect, useRef, useState } from "react";
import type { CandlestickData, ChartApi, SeriesApi } from "@/lib/xchart-sdk";

/** Deterministic random walk so the demo looks the same on every load. */
function syntheticCandles(n: number, start: number, step: number): CandlestickData[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: CandlestickData[] = [];
  let price = 1000;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = Math.max(1, open + (rnd() - 0.48) * 14);
    const high = Math.max(open, close) + rnd() * 6;
    const low = Math.min(open, close) - rnd() * 6;
    out.push({ time: start + i * step, open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2), volume: Math.round(50_000 + rnd() * 150_000) });
    price = close;
  }
  return out;
}

function sma(data: CandlestickData[], len: number) {
  const out: { time: number; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= len) sum -= data[i - len].close;
    if (i >= len - 1) out.push({ time: data[i].time, value: +(sum / len).toFixed(2) });
  }
  return out;
}

const STEP = 300; // 5-minute bars
const START = Date.UTC(2026, 10, 23, 3, 45) / 1000; // 09:15 IST, canonical UTC seconds

type Refs = { chart: ChartApi; candles: SeriesApi<"candlestick">; ma: SeriesApi<"line">; volume: SeriesApi<"histogram"> };

export function XChartDemo() {
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<Refs | null>(null);
  const data = useRef<CandlestickData[]>([]);
  const [hover, setHover] = useState<string>("Move the pointer over the chart.");
  const [log, setLog] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [logScale, setLogScale] = useState(false);
  const note = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString("en-IN")} · ${m}`, ...l].slice(0, 8));

  // 1–3. Create the chart, load history, add an overlay and a histogram (browser only).
  useEffect(() => {
    if (!mounted || !box.current) return;
    let disposed = false;
    let unsub: (() => void) | null = null;
    import("@/lib/xchart-sdk").then(({ createChart }) => {
      if (disposed || !box.current) return;
      const chart = createChart(box.current, { theme, autoSize: true, crosshair: true, priceScale: { precision: 2 } });
      const candles = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444" });
      const ma = chart.addLineSeries({ color: "#f59e0b", lineWidth: 2, title: "SMA 20" });
      const volume = chart.addHistogramSeries({ colorMode: "candle", opacity: 0.6, title: "Volume", precision: 0 });
      const history = syntheticCandles(300, START, STEP);
      data.current = history;
      candles.setData(history);
      ma.setData(sma(history, 20));
      volume.setData(history.map((c) => ({ time: c.time, value: c.volume ?? 0 })));
      // 7. Crosshair subscription
      unsub = chart.subscribeCrosshairMove((e) => {
        if (e.time === null) return setHover("Pointer left the chart.");
        const c = e.seriesData.get(candles) as CandlestickData | undefined;
        const m = e.seriesData.get(ma) as { value: number } | undefined;
        const t = new Date((e.time + 19800) * 1000).toISOString().slice(0, 16).replace("T", " ");
        setHover(
          `${t} IST · price ${e.price?.toFixed(2) ?? "—"}` +
            (c ? ` · O ${c.open} H ${c.high} L ${c.low} C ${c.close} V ${c.volume?.toLocaleString("en-IN")}` : " · no candle") +
            (m ? ` · SMA ${m.value}` : ""),
        );
      });
      refs.current = { chart, candles, ma, volume };
      note("Chart created with 300 synthetic 5-minute candles, SMA 20 overlay and volume histogram.");
    });
    return () => {
      // 9. Cleanup: unsubscribe and remove the chart (canvas, observers and listeners).
      disposed = true;
      unsub?.();
      refs.current?.chart.remove();
      refs.current = null;
    };
    // theme changes are applied with applyOptions below; recreate only on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // 5. Update the latest candle
  const updateLast = () => {
    const r = refs.current;
    if (!r) return;
    const d = data.current;
    const last = d[d.length - 1];
    const close = +(last.close + (Math.random() - 0.5) * 8).toFixed(2);
    const next = { ...last, close, high: Math.max(last.high, close), low: Math.min(last.low, close), volume: (last.volume ?? 0) + 2500 };
    d[d.length - 1] = next;
    r.candles.update(next);
    r.volume.update({ time: next.time, value: next.volume });
    const s = sma(d.slice(-20), 20)[0];
    if (s) r.ma.update(s);
    return next;
  };
  // 6. Add a new candle
  const addCandle = () => {
    const r = refs.current;
    if (!r) return;
    const d = data.current;
    const last = d[d.length - 1];
    const open = last.close;
    const close = +(open + (Math.random() - 0.5) * 10).toFixed(2);
    const c: CandlestickData = { time: last.time + STEP, open, high: +(Math.max(open, close) + 2).toFixed(2), low: +(Math.min(open, close) - 2).toFixed(2), close, volume: 80_000 };
    d.push(c);
    r.candles.update(c);
    r.volume.update({ time: c.time, value: c.volume ?? 0 });
    const s = sma(d.slice(-20), 20)[0];
    if (s) r.ma.update(s);
    note(`New candle at ${new Date((c.time + 19800) * 1000).toISOString().slice(11, 16)} IST.`);
  };

  // Live simulation: a tick every 250 ms, a new candle every 12 ticks.
  useEffect(() => {
    if (!live) return;
    let n = 0;
    const id = setInterval(() => {
      if (++n % 12 === 0) addCandle();
      else updateLast();
    }, 250);
    return () => clearInterval(id);
    // updateLast/addCandle only read refs, so the interval does not need to restart on re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const r = () => refs.current;
  const btn = "rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-40";
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={!mounted} onClick={() => { const c = updateLast(); if (c) note(`Updated latest candle: close ${c.close}.`); }}>Update latest candle</button>
        <button className={btn} disabled={!mounted} onClick={addCandle}>Add new candle</button>
        <button className={`${btn} ${live ? "border-up/50 text-up" : ""}`} disabled={!mounted} onClick={() => { setLive((v) => !v); note(live ? "Live simulation stopped." : "Live simulation started (4 ticks/s)."); }}>{live ? "■ Stop live ticks" : "▶ Simulate live ticks"}</button>
        <span className="mx-1 w-px bg-line" />
        <button className={btn} disabled={!mounted} onClick={() => r()?.chart.zoom(1.5)}>Zoom in</button>
        <button className={btn} disabled={!mounted} onClick={() => r()?.chart.zoom(1 / 1.5)}>Zoom out</button>
        <button className={btn} disabled={!mounted} onClick={() => { r()?.chart.fitContent(); note("fitContent()"); }}>Fit content</button>
        <button className={btn} disabled={!mounted} onClick={() => {
          const d = data.current;
          r()?.chart.setVisibleRange({ from: d[d.length - 36].time, to: d[d.length - 1].time });
          const v = r()?.chart.getVisibleRange();
          note(`setVisibleRange(last 3 hours) → getVisibleRange() = ${v ? `${v.from}–${v.to}` : "null"}`);
        }}>Last 3 hours</button>
        <button className={btn} disabled={!mounted} onClick={() => r()?.chart.scrollToRealTime()}>Scroll to real time</button>
        <span className="mx-1 w-px bg-line" />
        <button className={btn} disabled={!mounted} onClick={() => { const t = theme === "dark" ? "light" : "dark"; setTheme(t); r()?.chart.applyOptions({ theme: t }); }}>Theme: {theme}</button>
        <button className={btn} disabled={!mounted} onClick={() => { setLogScale((v) => !v); r()?.chart.applyOptions({ priceScale: { mode: logScale ? "normal" : "logarithmic" } }); }}>Scale: {logScale ? "log" : "linear"}</button>
        <button className={`${btn} ${mounted ? "text-rose-300" : ""}`} onClick={() => { setLive(false); setMounted((m) => !m); note(mounted ? "chart.remove(): canvas, observers and listeners released." : "Chart re-created."); }}>{mounted ? "Remove chart" : "Re-create chart"}</button>
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        {mounted ? <div ref={box} className="h-[460px] w-full" data-testid="xchart-demo" /> : <div className="grid h-[460px] place-items-center text-sm text-muted">Chart removed. No canvas is left in the page.</div>}
      </div>
      <p className="min-h-5 font-mono text-xs text-soft" aria-live="polite" data-testid="crosshair">{hover}</p>
      <ol className="space-y-0.5 font-mono text-[11px] text-muted" data-testid="log">
        {log.map((l, i) => <li key={i}>{l}</li>)}
      </ol>
    </section>
  );
}
