/**
 * Deterministic chart annotations from daily bars (no language model):
 *   - swing pivots (k bars each side) clustered within 0.5 ATR into support/resistance levels, with the
 *     number of touches and the last touch date as evidence;
 *   - demand/supply zones: the last base candle before an impulse (true range ≥ 1.8 ATR with a close in
 *     the move's direction), kept while price has not closed through the zone since;
 *   - the ±1 ATR×√horizon expected-range band from the last close (a volatility measure, not a forecast);
 *   - trade-plan levels from the equity setup engine (entry zone, stop, targets), when one exists.
 */
import * as ta from "../../ta/indicators.ts";
import type { EquitySetup } from "../equity/setup.ts";
import type { ChartSpec, Element, IndicatorEl, LevelEl, ZoneEl } from "./spec.ts";
import { SPEC_VERSION } from "./spec.ts";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
const r2 = (v: number) => Math.round(v * 100) / 100;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

export function pivots(bars: Bar[], k = 3): { highs: { i: number; p: number }[]; lows: { i: number; p: number }[] } {
  const highs: { i: number; p: number }[] = [], lows: { i: number; p: number }[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isH = false;
      if (bars[j].l <= bars[i].l) isL = false;
    }
    if (isH) highs.push({ i, p: bars[i].h });
    if (isL) lows.push({ i, p: bars[i].l });
  }
  return { highs, lows };
}

/** Clusters pivot prices within `tol`; returns level price (mean), touches and last index. */
export function clusterLevels(points: { i: number; p: number }[], tol: number) {
  const sorted = [...points].sort((a, b) => a.p - b.p);
  const out: { price: number; touches: number; last: number }[] = [];
  let cur: { i: number; p: number }[] = [];
  const flush = () => { if (cur.length) out.push({ price: cur.reduce((a, x) => a + x.p, 0) / cur.length, touches: cur.length, last: Math.max(...cur.map((x) => x.i)) }); cur = []; };
  for (const pt of sorted) {
    if (cur.length && pt.p - cur[0].p > tol) flush();
    cur.push(pt);
  }
  flush();
  return out;
}

/**
 * Indicator selection by setup (rule table, at most 4 per chart). Each indicator states why it is
 * deployed. Option-specific measures (IV, Greeks, premium momentum) live in the option workspaces, not
 * on the underlying's price chart; intraday tools (VWAP, opening range) need intraday bars, which the
 * platform does not store, so they are never selected here.
 */
export function selectIndicators(setup: string | null, regime: { primary: string; flags: string[] } | null): IndicatorEl[] {
  const ind = (id: string, indicator: string, params: Record<string, number>, label: string, why: string): IndicatorEl => ({ id: `ind-${id}`, kind: "indicator", source: "engine", indicator, params, label, evidence: why });
  const s = (setup ?? "").toLowerCase();
  const trend = /trend|pullback|breakout/.test(s) || /trend/i.test(regime?.primary ?? "");
  const meanRev = s.includes("mean reversion") || /range/i.test(regime?.primary ?? "");
  const volExp = regime?.flags.includes("Volatility expansion") ?? false;
  if (s.includes("breakout")) return [
    ind("ema20", "ema", { length: 20 }, "EMA 20", "Breakout setup: shows whether price holds above the short-term trend after the break."),
    ind("vol", "volume", { length: 20 }, "Volume (20-day average)", "Breakouts are judged against volume: the engine checks relative volume on the breakout bar."),
    ind("atr", "atr", { length: 14 }, "ATR 14", "Stop and targets are sized in ATR multiples; ATR shows the volatility they are based on."),
  ];
  if (meanRev) return [
    ind("bb", "bb", { length: 20, mult: 2 }, "Bollinger Bands 20, 2", "Mean-reversion setup: distance from the 20-day mean in standard deviations."),
    ind("rsi", "rsi", { length: 14 }, "RSI 14", "Mean-reversion setup: shows stretched momentum readings at the band extremes."),
  ];
  if (trend) return [
    ind("ema20", "ema", { length: 20 }, "EMA 20", "Trend setup: the pullback zone is measured from the 20-day EMA."),
    ind("ema50", "ema", { length: 50 }, "EMA 50", "Trend setup: the intermediate trend that the pullback must respect."),
    ind("adx", "adx", { length: 14 }, "ADX 14", "Trend strength: the regime engine treats ADX ≥ 20 as a trending market."),
    ...(volExp ? [ind("atr", "atr", { length: 14 }, "ATR 14", "Volatility is expanding: ATR shows how far stops and targets moved apart.")] : []),
  ];
  return [ind("ema50", "ema", { length: 50 }, "EMA 50", "No qualifying setup: the 50-day EMA shows the prevailing trend for context only.")];
}

export function buildEquitySpec(symbol: string, bars: Bar[], setup: EquitySetup | null, opts: { horizonDays?: number; maxLevels?: number } = {}): ChartSpec {
  const indicators = selectIndicators(setup?.setup ?? null, setup?.regime ? { primary: setup.regime.primary, flags: setup.regime.flags } : null);
  const n = bars.length;
  const window = { from: bars[0]?.t ?? 0, to: bars[n - 1]?.t ?? 0, low: Math.min(...bars.map((b) => b.l)), high: Math.max(...bars.map((b) => b.h)) };
  const spec: ChartSpec = { version: SPEC_VERSION, instrument: symbol, timeframe: "1D", window, elements: [], notes: [] };
  if (n < 30) {
    spec.notes.push("Fewer than 30 daily bars: no levels or zones computed.");
    return spec;
  }
  const h = bars.map((b) => b.h), l = bars.map((b) => b.l), c = bars.map((b) => b.c);
  const atrS = ta.atr(h, l, c, 14);
  const atr = atrS.at(-1) ?? NaN;
  const last = c[n - 1];
  const els: Element[] = [];
  els.push({ id: "last-close", kind: "level", source: "engine", role: "last-close", price: r2(last), label: `Last close ${r2(last)}`, evidence: `Close of ${day(bars[n - 1].t)}` });

  // Support / resistance from clustered pivots (recent 250 bars).
  const start = Math.max(0, n - 250);
  const { highs, lows } = pivots(bars.slice(start), 3);
  const tol = Number.isFinite(atr) ? 0.5 * atr : last * 0.01;
  const levels = clusterLevels([...highs, ...lows].map((x) => ({ i: x.i + start, p: x.p })), tol)
    .filter((x) => x.touches >= 2)
    .map((x) => ({ ...x, role: x.price < last ? ("support" as const) : ("resistance" as const), dist: Math.abs(x.price - last) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, opts.maxLevels ?? 6);
  levels.forEach((x, k) => {
    els.push({ id: `sr-${k}`, kind: "level", source: "engine", role: x.role, price: r2(x.price), label: `${x.role === "support" ? "Support" : "Resistance"} ${r2(x.price)} (${x.touches} touches)`, evidence: `${x.touches} swing points within ±${r2(tol)} (0.5 ATR); last ${day(bars[x.last].t)}` } satisfies LevelEl);
  });

  // Demand / supply zones: base candle before an impulse, still unbroken by closes.
  const zones: ZoneEl[] = [];
  for (let i = Math.max(15, n - 200); i < n - 1 && Number.isFinite(atr); i++) {
    const a = atrS[i - 1];
    if (!Number.isFinite(a)) continue;
    const tr = Math.max(h[i], c[i - 1]) - Math.min(l[i], c[i - 1]);
    if (tr < 1.8 * a) continue;
    const up = c[i] > c[i - 1] && c[i] > bars[i].o, down = c[i] < c[i - 1] && c[i] < bars[i].o;
    if (!up && !down) continue;
    const base = bars[i - 1];
    const low = Math.min(base.l, base.o, base.c), high = Math.max(base.h, base.o, base.c);
    const broken = c.slice(i + 1).some((x) => (up ? x < low : x > high));
    if (broken || high - low <= 0) continue;
    zones.push({ id: `${up ? "dz" : "sz"}-${i}`, kind: "zone", source: "engine", role: up ? "demand" : "supply", from: base.t, to: null, low: r2(low), high: r2(high),
      label: `${up ? "Demand" : "Supply"} zone ${r2(low)}–${r2(high)}`, evidence: `Base candle ${day(base.t)} before a ${r2(tr / a)}× ATR ${up ? "up" : "down"} move on ${day(bars[i].t)}; no close through it since` });
  }
  // Keep the nearest two of each kind.
  for (const role of ["demand", "supply"] as const) els.push(...zones.filter((z) => z.role === role).sort((a, b) => Math.abs((a.low + a.high) / 2 - last) - Math.abs((b.low + b.high) / 2 - last)).slice(0, 2));

  // Expected-range band.
  const hd = opts.horizonDays ?? 10;
  if (Number.isFinite(atr)) {
    const band = atr * Math.sqrt(hd);
    els.push({ id: "range-band", kind: "zone", source: "engine", role: "expected-move", from: bars[n - 1].t, to: bars[n - 1].t + hd * 86400 * 1.4, low: r2(Math.max(last - band, window.low * 0.51)), high: r2(last + band),
      label: `±${r2(band)} range (${hd} sessions)`, evidence: `ATR(14) ${r2(atr)} × √${hd}: a volatility measure, not a forecast` });
  }

  // Trade plan from the equity engine.
  if (setup && setup.entry && setup.stop) {
    const t0 = bars[n - 1].t;
    els.push({ id: "plan-entry", kind: "zone", source: "engine", role: "entry", from: t0, to: t0 + 10 * 86400, low: setup.entry.low, high: setup.entry.high, label: `Entry zone (${setup.status})`, evidence: setup.confirmation ?? "equity setup engine" });
    els.push({ id: "plan-stop", kind: "level", source: "engine", role: "stop", price: setup.stop, label: `Stop ${setup.stop}`, evidence: setup.invalidation ?? "equity setup engine" });
    setup.targets.forEach((t, k) => els.push({ id: `plan-t${k + 1}`, kind: "level", source: "engine", role: "target", price: t.price, label: `Target ${k + 1}: ${t.price}`, evidence: t.label }));
  }
  els.push(...indicators);
  spec.elements = els;
  return spec;
}
