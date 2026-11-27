// Plain ES modules: no bundler. The package's ESM build is loaded straight from node_modules.
import { createChart, IndicatorWorkerClient, XCHART_VERSION } from "./node_modules/@tradestxpro/xchart/dist/esm/index.js";

// Synthetic data (deterministic random walk): replace with your own market-data adapter.
function candles(n) {
  let s = 7, p = 100;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => {
    const o = p, c = Math.max(1, o + (rnd() - 0.49) * 2);
    p = c;
    return { time: 1704067200 + i * 86400, open: o, high: Math.max(o, c) + rnd(), low: Math.min(o, c) - rnd(), close: c, volume: 1000 + Math.round(rnd() * 9000) };
  });
}

const chart = createChart(document.getElementById("chart"), { theme: "dark" });
const series = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
const data = candles(300);
series.setData(data);
chart.addIndicator("ema", { length: 20, color: "#38bdf8" });
chart.addIndicator("rsi");

// Full-history work in a module Web Worker (falls back to the main thread where unavailable).
const client = new IndicatorWorkerClient();
const cols = { time: data.map((d) => d.time), open: data.map((d) => d.open), high: data.map((d) => d.high), low: data.map((d) => d.low), close: data.map((d) => d.close), volume: data.map((d) => d.volume) };
const r = await client.computeIndicators(cols, [{ id: "rsi", params: { length: 14 } }], { datasetVersion: 1 });
client.terminate();
window.result = { version: XCHART_VERSION, worker: r.worker, rsiLast: r.results[0].outputs.rsi.at(-1) };
document.getElementById("status").textContent = `XChart ${XCHART_VERSION} · worker: ${r.worker ? "yes" : "fallback"}`;
window.ready = true;
