/** Native volatility and volume indicators (see define.ts). */
import { defineNative, histo, len, line, num, out, sel, K } from "./define.ts";

const { ema, sma, map, lag, highest, lowest, rolling, reducer, sum, src, atr, trueRange } = K;
const hi = src("high"), lo = src("low"), cl = src("close"), op = src("open"), vol = src("volume");
const ANN = "Annualised as σ·√P·100, where P (periods per year) is a parameter: 252 for daily bars by default; set it for your bar size (e.g. 252·375 for NSE 1-minute bars).";
const periods = num("periods", 252, "Periods per year", 1, 1_000_000, 1);
const bandsOf = (x: K.NodeDef, n: number, m: number) => {
  const mid = sma(x, n), sd = K.stdev(x, n);
  return { mid, up: map(`plus*${m}`, [mid, sd], ([a, b]) => a + m * b), dn: map(`minus*${m}`, [mid, sd], ([a, b]) => a - m * b) };
};
/** Sample variance (n−1) of the window. */
const sampleVar = (get: (d: number, k: number) => number, n: number, d = 0) => {
  let mean = 0;
  for (let k = 0; k < n; k++) mean += get(d, k);
  mean /= n;
  let s = 0;
  for (let k = 0; k < n; k++) s += (get(d, k) - mean) ** 2;
  return s / (n - 1);
};

export const VOLATILITY = [
  defineNative({
    id: "bbw", name: "Bollinger Bandwidth", category: "Volatility", pane: "separate", source: true, params: [len("length", 20), num("mult", 2, "Multiplier", 0.1, 10)],
    description: "Width of the Bollinger Bands relative to the middle band.", outputs: [line("bbw", "BBW", "#3b82f6")],
    meta: { formula: "BBW = (Upper − Lower)/Middle, bands = SMA ± m·σ (population σ)." },
    build: (p, x) => { const b = bandsOf(x, Number(p.length), Number(p.mult)); return [out("bbw", map("bbw", [b.up, b.dn, b.mid], ([u, l, m]) => (u - l) / m))]; },
  }),
  defineNative({
    id: "bbpb", name: "Bollinger %B", category: "Volatility", pane: "separate", source: true, params: [len("length", 20), num("mult", 2, "Multiplier", 0.1, 10)], levels: [1, 0.5, 0],
    description: "Position of the price within the Bollinger Bands.", outputs: [line("pb", "%B", "#3b82f6")],
    meta: { formula: "%B = (x − Lower)/(Upper − Lower) (NaN when the bands coincide)." },
    build: (p, x) => { const b = bandsOf(x, Number(p.length), Number(p.mult)); return [out("pb", map("pctb", [x, b.up, b.dn], ([v, u, l]) => (u === l ? NaN : (v - l) / (u - l))))]; },
  }),
  defineNative({
    id: "natr", name: "Normalized ATR", category: "Volatility", pane: "separate", params: [len("length", 14)],
    description: "ATR as a percentage of the close.", outputs: [line("natr", "NATR", "#fb923c")],
    meta: { formula: "NATR = 100·ATR(n)/C (Wilder ATR)." },
    build: (p) => [out("natr", map("pctOf", [atr(Number(p.length)), cl], ([a, c]) => (100 * a) / c))],
  }),
  defineNative({
    id: "hv", name: "Historical Volatility", category: "Volatility", pane: "separate", params: [len("length", 20), periods],
    description: "Annualised standard deviation of log returns.", outputs: [line("hv", "HV %", "#f472b6")],
    meta: { formula: "r = ln(C/C[1]); HV = sd(r, n; sample, n−1)·√P·100.", conventions: ANN },
    build: (p) => { const P = Number(p.periods); return [out("hv", rolling(`hv:${P}`, [map("logret", [cl, lag(cl, 1)], ([c, c1]) => Math.log(c / c1))], Number(p.length), (g, n) => Math.sqrt(sampleVar(g, n)) * Math.sqrt(P) * 100))]; },
  }),
  defineNative({
    id: "parkinson", name: "Parkinson Volatility", category: "Volatility", pane: "separate", params: [len("length", 20), periods],
    description: "High-low range volatility estimator.", outputs: [line("vol", "Parkinson %", "#f472b6")],
    meta: { formula: "σ² = Σ ln(H/L)² / (4·n·ln 2); annualised σ·√P·100.", conventions: ANN },
    build: (p) => { const P = Number(p.periods); return [out("vol", rolling(`park:${P}`, [map("lnhl2", [hi, lo], ([h, l]) => Math.log(h / l) ** 2)], Number(p.length), (g, n) => { let s = 0; for (let k = 0; k < n; k++) s += g(0, k); return Math.sqrt(s / (4 * n * Math.log(2))) * Math.sqrt(P) * 100; }))]; },
  }),
  defineNative({
    id: "garmanklass", name: "Garman-Klass Volatility", category: "Volatility", pane: "separate", params: [len("length", 20), periods],
    description: "OHLC volatility estimator.", outputs: [line("vol", "GK %", "#f472b6")],
    meta: { formula: "σ² = (1/n)·Σ[0.5·ln(H/L)² − (2 ln 2 − 1)·ln(C/O)²]; annualised.", conventions: ANN, limitations: "Assumes no drift and no opening gaps." },
    build: (p) => { const P = Number(p.periods); const t = map("gk", [hi, lo, cl, op], ([h, l, c, o]) => 0.5 * Math.log(h / l) ** 2 - (2 * Math.log(2) - 1) * Math.log(c / o) ** 2); return [out("vol", rolling(`gk:${P}`, [t], Number(p.length), (g, n) => { let s = 0; for (let k = 0; k < n; k++) s += g(0, k); return Math.sqrt(Math.max(0, s / n)) * Math.sqrt(P) * 100; }))]; },
  }),
  defineNative({
    id: "rogerssatchell", name: "Rogers-Satchell Volatility", category: "Volatility", pane: "separate", params: [len("length", 20), periods],
    description: "Drift-independent OHLC volatility estimator.", outputs: [line("vol", "RS %", "#f472b6")],
    meta: { formula: "σ² = (1/n)·Σ[ln(H/C)·ln(H/O) + ln(L/C)·ln(L/O)]; annualised.", conventions: ANN },
    build: (p) => { const P = Number(p.periods); const t = map("rs", [hi, lo, cl, op], ([h, l, c, o]) => Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o)); return [out("vol", rolling(`rs:${P}`, [t], Number(p.length), (g, n) => { let s = 0; for (let k = 0; k < n; k++) s += g(0, k); return Math.sqrt(Math.max(0, s / n)) * Math.sqrt(P) * 100; }))]; },
  }),
  defineNative({
    id: "yangzhang", name: "Yang-Zhang Volatility", category: "Volatility", pane: "separate", params: [len("length", 20, "Length", 2), periods],
    description: "Combines overnight, open-to-close and Rogers-Satchell variances.", outputs: [line("vol", "YZ %", "#f472b6")],
    meta: { formula: "σ² = σo² + k·σc² + (1 − k)·σrs², k = 0.34/(1.34 + (n+1)/(n−1)); σo² = sample var of ln(O/C[1]); σc² = sample var of ln(C/O); σrs² = mean RS term.", conventions: ANN },
    build: (p) => {
      const P = Number(p.periods), n = Number(p.length), k = 0.34 / (1.34 + (n + 1) / (n - 1));
      const on = map("lnoc1", [op, lag(cl, 1)], ([o, c1]) => Math.log(o / c1)), oc = map("lnco", [cl, op], ([c, o]) => Math.log(c / o));
      const rs = map("rs", [hi, lo, cl, op], ([h, l, c, o]) => Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o));
      return [out("vol", rolling(`yz:${P}`, [on, oc, rs], n, (g, m) => { let r = 0; for (let j = 0; j < m; j++) r += g(2, j); const v = sampleVar(g, m, 0) + k * sampleVar(g, m, 1) + (1 - k) * (r / m); return Math.sqrt(Math.max(0, v)) * Math.sqrt(P) * 100; }))];
    },
  }),
  defineNative({
    id: "stddev", name: "Standard Deviation", category: "Volatility", pane: "separate", source: true, params: [len("length", 20)],
    description: "Population standard deviation of the source.", outputs: [line("sd", "StdDev", "#94a3b8")],
    meta: { formula: "σ = √(Σ(x − mean)²/n) (population, same convention as Bollinger Bands)." },
    build: (p, x) => [out("sd", K.stdev(x, Number(p.length)))],
  }),
  defineNative({
    id: "chop", name: "Choppiness Index", category: "Volatility", pane: "separate", params: [len("length", 14, "Length", 2)], range: [0, 100], levels: [61.8, 38.2],
    description: "Trendiness versus sideways movement.", outputs: [line("chop", "CHOP", "#a78bfa")],
    meta: { formula: "CHOP = 100·log10(Σ TR / (HH − LL)) / log10(n) over n bars (TR of the first bar = H − L)." },
    build: (p) => { const n = Number(p.length); return [out("chop", map(`chop:${n}`, [sum(trueRange(false), n), highest(hi, n), lowest(lo, n)], ([s, h, l]) => (h === l ? NaN : (100 * Math.log10(s / (h - l))) / Math.log10(n))))]; },
  }),
  defineNative({
    id: "massindex", name: "Mass Index", category: "Volatility", pane: "separate", params: [len("ema", 9, "EMA length"), len("length", 25, "Sum length")], levels: [27, 26.5],
    description: "Range expansion via the ratio of single to double EMA of the range.", outputs: [line("mi", "Mass", "#38bdf8")],
    meta: { formula: "R = EMA(H − L, 9)/EMA(EMA(H − L, 9), 9); MI = Σ R over 25 bars." },
    build: (p) => { const e = Number(p.ema), r = map("sub", [hi, lo], ([a, b]) => a - b), e1 = ema(r, e); return [out("mi", sum(map("div", [e1, ema(e1, e)], ([a, b]) => a / b), Number(p.length)))]; },
  }),
  defineNative({
    id: "ulcer", name: "Ulcer Index", category: "Volatility", pane: "separate", source: true, params: [len("length", 14)],
    description: "Depth and duration of drawdowns from the n-bar high.", outputs: [line("ui", "Ulcer", "#ef4444")],
    meta: { formula: "D = 100·(x − HH(x,n))/HH(x,n); UI = √(Σ D²/n)." },
    build: (p, x) => { const n = Number(p.length); return [out("ui", rolling("ulcer", [map("ddpct", [x, highest(x, n)], ([v, h]) => (100 * (v - h)) / h)], n, (g, m) => { let s = 0; for (let k = 0; k < m; k++) s += g(0, k) ** 2; return Math.sqrt(s / m); }))]; },
  }),
  defineNative({
    id: "chaikinvol", name: "Chaikin Volatility", category: "Volatility", pane: "separate", params: [len("ema", 10, "EMA length"), len("roc", 10, "ROC length")], levels: [0],
    description: "Rate of change of the EMA of the high-low range.", outputs: [line("cv", "ChVol", "#fb923c")],
    meta: { formula: "E = EMA(H − L, n); CV = 100·(E − E[m])/E[m]." },
    build: (p) => { const e = ema(map("sub", [hi, lo], ([a, b]) => a - b), Number(p.ema)), m = Number(p.roc); return [out("cv", map("rocpct", [e, lag(e, m)], ([a, b]) => (b !== 0 ? ((a - b) / b) * 100 : NaN)))]; },
  }),
  defineNative({
    id: "rvol", name: "Relative Volatility Index", category: "Volatility", pane: "separate", source: true, params: [len("std", 10, "StdDev length"), len("length", 14, "Smoothing")], range: [0, 100], levels: [50],
    description: "RSI-style index of up- versus down-move volatility (Dorsey).", outputs: [line("rvi", "RVI", "#22c55e")],
    meta: { formula: "u = σ(x,10) if x > x[1] else 0; d = σ(x,10) if x < x[1] else 0; RVI = 100·EMA(u,14)/(EMA(u,14) + EMA(d,14)).", conventions: "Population σ; EMA smoothing (Dorsey 1993); 50 when both averages are 0." },
    build: (p, x) => {
      const sd = K.stdev(x, Number(p.std)), x1 = lag(x, 1), n = Number(p.length);
      const u = ema(map("rviU", [x, x1, sd], ([a, b, s]) => (Number.isNaN(s) || Number.isNaN(b) ? NaN : a > b ? s : 0)), n), d = ema(map("rviD", [x, x1, sd], ([a, b, s]) => (Number.isNaN(s) || Number.isNaN(b) ? NaN : a < b ? s : 0)), n);
      return [out("rvi", map("rvi", [u, d], ([a, b]) => (a + b === 0 ? 50 : (100 * a) / (a + b))))];
    },
  }),
];

const mfv = map("mfv", [cl, hi, lo, vol], ([c, h, l, v]) => (h === l ? 0 : ((c - l - (h - c)) / (h - l)) * v));
const cumulative = (id: string, deps: K.NodeDef[], f: (x: number[], i: number) => number) => reducer(`cum:${id}`, deps, () => ({ acc: 0 }), (st, i, _r, x) => (st.acc += f(x, i)), (st) => ({ ...st }));
const adl = cumulative("adl", [mfv], ([m]) => m);

export const VOLUME = [
  defineNative({
    id: "avwap", name: "Anchored VWAP", category: "Volume", pane: "overlay", requires: ["volume", "time"], params: [num("anchor", 0, "Anchor time (UTC seconds, 0 = first bar)", 0, 1e11, 1)],
    description: "Volume-weighted average of the typical price from an anchor time onward.", outputs: [line("avwap", "AVWAP", "#a855f7")],
    meta: { formula: "AVWAP = Σ(hlc3·V)/ΣV from the first bar at or after the anchor; the typical price while ΣV = 0.", missing: "Zero-volume bars add no weight; before the anchor the value is NaN." },
    build: (p) => { const a = Number(p.anchor); return [out("avwap", reducer(`avwap:${a}`, [src("hlc3")], () => ({ pv: 0, v: 0 }), (st, _i, r, [tp]) => { if (r.t < a) return NaN; const w = r.v > 0 ? r.v : 0; st.pv += tp * w; st.v += w; return st.v > 0 ? st.pv / st.v : tp; }, (st) => ({ ...st })))]; },
  }),
  defineNative({
    id: "cmf", name: "Chaikin Money Flow", category: "Volume", pane: "separate", requires: ["volume"], params: [len("length", 20)], levels: [0],
    description: "Money-flow volume over volume.", outputs: [line("cmf", "CMF", "#22c55e")],
    meta: { formula: "MFM = ((C − L) − (H − C))/(H − L) (0 when H = L); CMF = Σ(MFM·V)/ΣV over n bars (NaN when ΣV = 0)." },
    build: (p) => { const n = Number(p.length); return [out("cmf", map("divNz", [sum(mfv, n), sum(vol, n)], ([a, b]) => (b === 0 ? NaN : a / b)))]; },
  }),
  defineNative({
    id: "adl", name: "Accumulation/Distribution", category: "Volume", pane: "separate", requires: ["volume"],
    description: "Cumulative money-flow volume.", outputs: [line("adl", "A/D", "#38bdf8")],
    meta: { formula: "A/D = Σ MFM·V since the first bar.", limitations: "Cumulative: the level depends on where the history starts." },
    build: () => [out("adl", adl)],
  }),
  defineNative({
    id: "chaikinosc", name: "Chaikin Oscillator", category: "Volume", pane: "separate", requires: ["volume"], params: [len("fast", 3, "Fast"), len("slow", 10, "Slow")], levels: [0],
    description: "MACD of the Accumulation/Distribution line.", outputs: [histo("co", "Chaikin Osc", "#22c55e")],
    meta: { formula: "CO = EMA(A/D, 3) − EMA(A/D, 10)." },
    build: (p) => [out("co", map("sub", [ema(adl, Number(p.fast)), ema(adl, Number(p.slow))], ([a, b]) => a - b))],
  }),
  defineNative({
    id: "fi", name: "Force Index", category: "Volume", pane: "separate", requires: ["volume"], params: [len("length", 13)], levels: [0],
    description: "Price change times volume, smoothed.", outputs: [line("fi", "Force", "#fb923c")],
    meta: { formula: "FI = EMA((C − C[1])·V, n)." },
    build: (p) => [out("fi", ema(map("force", [cl, lag(cl, 1), vol], ([c, c1, v]) => (c - c1) * v), Number(p.length)))],
  }),
  defineNative({
    id: "eom", name: "Ease of Movement", category: "Volume", pane: "separate", requires: ["volume"], params: [len("length", 14), num("divisor", 10000, "Volume divisor", 1, 1e12, 1)], levels: [0],
    description: "Price movement per unit of volume.", outputs: [line("eom", "EOM", "#38bdf8")],
    meta: { formula: "EMV = (hl2 − hl2[1]) / ((V/div)/(H − L)); EOM = SMA(EMV, n). A bar with V = 0 or H = L gives 0." },
    build: (p) => { const d = Number(p.divisor), m = src("hl2"); return [out("eom", sma(map(`emv:${d}`, [m, lag(m, 1), vol, hi, lo], ([a, b, v, h, l]) => (v === 0 || h === l ? 0 : (a - b) / (v / d / (h - l)))), Number(p.length)))]; },
  }),
  defineNative({
    id: "volosc", name: "Volume Oscillator", category: "Volume", pane: "separate", requires: ["volume"], params: [len("fast", 5, "Fast"), len("slow", 10, "Slow")], levels: [0],
    description: "Percentage difference of two volume EMAs.", outputs: [line("vo", "VO %", "#a78bfa")],
    meta: { formula: "VO = 100·(EMA(V,f) − EMA(V,s))/EMA(V,s)." },
    build: (p) => [out("vo", map("ppo", [ema(vol, Number(p.fast)), ema(vol, Number(p.slow))], ([a, b]) => (100 * (a - b)) / b))],
  }),
  defineNative({
    id: "pvo", name: "Percentage Volume Oscillator", category: "Volume", pane: "separate", requires: ["volume"], params: [len("fast", 12, "Fast"), len("slow", 26, "Slow"), len("signal", 9, "Signal")], levels: [0],
    description: "PPO applied to volume.", outputs: [histo("hist", "Hist", "#22c55e"), line("pvo", "PVO", "#2962ff"), line("signal", "Signal", "#ff9800")],
    meta: { formula: "PVO = 100·(EMA(V,12) − EMA(V,26))/EMA(V,26); Signal = EMA(PVO,9); Hist = PVO − Signal." },
    build: (p) => { const pv = map("ppo", [ema(vol, Number(p.fast)), ema(vol, Number(p.slow))], ([a, b]) => (100 * (a - b)) / b), s = ema(pv, Number(p.signal)); return [out("hist", map("sub", [pv, s], ([a, b]) => a - b)), out("pvo", pv), out("signal", s)]; },
  }),
  defineNative({
    id: "pvt", name: "Price Volume Trend", category: "Volume", pane: "separate", requires: ["volume"],
    description: "Cumulative volume weighted by percentage price change.", outputs: [line("pvt", "PVT", "#38bdf8")],
    meta: { formula: "PVT = Σ V·(C − C[1])/C[1] (first bar contributes 0)." },
    build: () => [out("pvt", cumulative("pvt", [cl, lag(cl, 1), vol], ([c, c1, v], i) => (i === 0 ? 0 : (v * (c - c1)) / c1)))],
  }),
  defineNative({
    id: "nvi", name: "Negative Volume Index", category: "Volume", pane: "separate", requires: ["volume"], params: [num("start", 1000, "Start value", 1, 1e9, 1)],
    description: "Changes only on bars whose volume falls.", outputs: [line("nvi", "NVI", "#ef4444")],
    meta: { formula: "NVI = NVI[1]·(1 + (C − C[1])/C[1]) when V < V[1], else NVI[1]; starts at 1000." },
    build: (p) => { const s0 = Number(p.start); return [out("nvi", reducer(`nvi:${s0}`, [cl, lag(cl, 1), vol, lag(vol, 1)], () => ({ x: s0 }), (st, i, _r, [c, c1, v, v1]) => { if (i > 0 && v < v1) st.x = st.x * (1 + (c - c1) / c1); return st.x; }, (st) => ({ ...st })))]; },
  }),
  defineNative({
    id: "pvi", name: "Positive Volume Index", category: "Volume", pane: "separate", requires: ["volume"], params: [num("start", 1000, "Start value", 1, 1e9, 1)],
    description: "Changes only on bars whose volume rises.", outputs: [line("pvi", "PVI", "#22c55e")],
    meta: { formula: "PVI = PVI[1]·(1 + (C − C[1])/C[1]) when V > V[1], else PVI[1]; starts at 1000." },
    build: (p) => { const s0 = Number(p.start); return [out("pvi", reducer(`pvi:${s0}`, [cl, lag(cl, 1), vol, lag(vol, 1)], () => ({ x: s0 }), (st, i, _r, [c, c1, v, v1]) => { if (i > 0 && v > v1) st.x = st.x * (1 + (c - c1) / c1); return st.x; }, (st) => ({ ...st })))]; },
  }),
  defineNative({
    id: "kvo", name: "Klinger Volume Oscillator", category: "Volume", pane: "separate", requires: ["volume"], params: [len("fast", 34, "Fast"), len("slow", 55, "Slow"), len("signal", 13, "Signal")], levels: [0],
    description: "Volume force trend oscillator.", outputs: [line("kvo", "KVO", "#22c55e"), line("signal", "Signal", "#ef4444")],
    meta: { formula: "trend = +1 if hlc3 > hlc3[1] else −1; dm = H − L; cm = cm[1] + dm if trend = trend[1] else dm[1] + dm; VF = V·|2·dm/cm − 1|·trend·100; KVO = EMA(VF,34) − EMA(VF,55); Signal = EMA(KVO,13).", conventions: "VF is 0 when cm = 0; the first bar starts with cm = dm." },
    build: (p) => {
      const vf = reducer("klingerVF", [src("hlc3"), hi, lo, vol], () => ({ tp: NaN, trend: 0, dm: NaN, cm: NaN }), (st, _i, _r, [tp, h, l, v]) => {
        const dm = h - l;
        const trend = Number.isNaN(st.tp) ? 0 : tp > st.tp ? 1 : -1;
        const cm = Number.isNaN(st.cm) ? dm : trend === st.trend ? st.cm + dm : st.dm + dm;
        st.tp = tp; st.trend = trend; st.dm = dm; st.cm = cm;
        if (trend === 0) return NaN;
        return cm === 0 ? 0 : v * Math.abs(2 * (dm / cm) - 1) * trend * 100;
      }, (st) => ({ ...st }));
      const k = map("sub", [ema(vf, Number(p.fast)), ema(vf, Number(p.slow))], ([a, b]) => a - b);
      return [out("kvo", k), out("signal", ema(k, Number(p.signal)))];
    },
  }),
  defineNative({
    id: "vroc", name: "Volume Rate of Change", category: "Volume", pane: "separate", requires: ["volume"], params: [len("length", 14)], levels: [0],
    description: "Percentage change of volume over n bars.", outputs: [line("vroc", "VROC", "#a78bfa")],
    meta: { formula: "VROC = 100·(V − V[n])/V[n] (NaN when V[n] = 0)." },
    build: (p) => [out("vroc", map("rocpct", [vol, lag(vol, Number(p.length))], ([a, b]) => (b !== 0 ? ((a - b) / b) * 100 : NaN)))],
  }),
  defineNative({
    id: "vwma", name: "Volume-Weighted Moving Average", category: "Volume", pane: "overlay", requires: ["volume"], source: true, params: [len("length", 20)],
    description: "Moving average weighted by volume.", outputs: [line("vwma", "VWMA", "#22d3ee")],
    meta: { formula: "VWMA = Σ(x·V)/ΣV over n bars (NaN when ΣV = 0)." },
    build: (p, x) => { const n = Number(p.length); return [out("vwma", map("divNz", [sum(map("mul", [x, vol], ([a, b]) => a * b), n), sum(vol, n)], ([a, b]) => (b === 0 ? NaN : a / b)))]; },
  }),
];
void sel;
