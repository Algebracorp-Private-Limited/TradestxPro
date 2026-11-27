/** Native trend and momentum indicators (see define.ts). */
import { defineNative, histo, len, line, num, out, K } from "./define.ts";

const { ema, sma, wma, rma, map, lag, highest, lowest, rolling, reducer, sum, src, atr, trueRange } = K;
const hi = src("high"), lo = src("low"), cl = src("close"), op = src("open");
const chain = (x: K.NodeDef, n: number, k: number) => {
  const out: K.NodeDef[] = [];
  let c = x;
  for (let i = 0; i < k; i++) out.push((c = ema(c, n)));
  return out;
};
const rsiNode = (x: K.NodeDef, n: number) => {
  const mv = K.moves(x);
  return map("rsi", [rma(mv, n), rma(K.aux(mv), n)], ([u, d]) => (Number.isNaN(u) || Number.isNaN(d) ? NaN : d === 0 ? (u === 0 ? 50 : 100) : 100 - 100 / (1 + u / d)));
};
const stochOf = (x: K.NodeDef, n: number, id: string) => map(`stochOf:${id}`, [x, highest(x, n), lowest(x, n)], ([v, h, l]) => (h === l ? 50 : (100 * (v - l)) / (h - l)));
const rocNode = (x: K.NodeDef, n: number) => map("rocpct", [x, lag(x, n)], ([a, b]) => (b !== 0 ? ((a - b) / b) * 100 : NaN));

export const TREND = [
  defineNative({
    id: "dema", name: "Double Exponential Moving Average", category: "Trend", pane: "overlay", source: true, params: [len("length", 20)],
    description: "Mulloy's DEMA: an EMA with part of its lag removed.", outputs: [line("dema", "DEMA", "#38bdf8")],
    meta: { formula: "DEMA = 2·EMA(x,n) − EMA(EMA(x,n),n); EMAs seeded with an SMA of the first n values." },
    build: (p, x) => { const [e1, e2] = chain(x, Number(p.length), 2); return [out("dema", map("dema", [e1, e2], ([a, b]) => 2 * a - b))]; },
  }),
  defineNative({
    id: "tema", name: "Triple Exponential Moving Average", category: "Trend", pane: "overlay", source: true, params: [len("length", 20)],
    description: "Mulloy's TEMA.", outputs: [line("tema", "TEMA", "#a78bfa")],
    meta: { formula: "TEMA = 3·E1 − 3·E2 + E3, E1 = EMA(x,n), E2 = EMA(E1,n), E3 = EMA(E2,n)." },
    build: (p, x) => { const [a, b, c] = chain(x, Number(p.length), 3); return [out("tema", map("tema", [a, b, c], ([e1, e2, e3]) => 3 * e1 - 3 * e2 + e3))]; },
  }),
  defineNative({
    id: "kama", name: "Kaufman Adaptive Moving Average", category: "Trend", pane: "overlay", source: true, params: [len("length", 10), len("fast", 2, "Fast"), len("slow", 30, "Slow")],
    description: "Moving average whose speed follows the efficiency ratio.", outputs: [line("kama", "KAMA", "#f59e0b")],
    meta: { formula: "ER = |x − x[n]| / Σ|Δx| (n bars); SC = (ER·(2/(fast+1) − 2/(slow+1)) + 2/(slow+1))²; KAMA = KAMA[1] + SC·(x − KAMA[1]).", conventions: "Seeded with x at the bar before the first efficiency ratio (bar n−1); ER = 0 when Σ|Δx| = 0." },
    build: (p, x) => {
      const n = Number(p.length), f = 2 / (Number(p.fast) + 1), s = 2 / (Number(p.slow) + 1);
      const er = K.rolling(`er`, [x], n + 1, (g, m) => { let v = 0; for (let k = 0; k < m - 1; k++) v += Math.abs(g(0, k) - g(0, k + 1)); return v === 0 ? 0 : Math.abs(g(0, 0) - g(0, m - 1)) / v; });
      return [out("kama", reducer(`kama:${f}:${s}`, [x, er, lag(x, 1)], () => ({ prev: NaN }), (st, _i, _r, [v, e, p1]) => {
        if (Number.isNaN(e)) return NaN;
        if (Number.isNaN(st.prev)) st.prev = p1;
        const sc = (e * (f - s) + s) ** 2;
        st.prev = st.prev + sc * (v - st.prev);
        return st.prev;
      }, (st) => ({ ...st })))];
    },
  }),
  defineNative({
    id: "alma", name: "Arnaud Legoux Moving Average", category: "Trend", pane: "overlay", source: true, params: [len("length", 9), num("offset", 0.85, "Offset", 0, 1, 0.01), num("sigma", 6, "Sigma", 0.1, 50)],
    description: "Gaussian-weighted moving average.", outputs: [line("alma", "ALMA", "#34d399")],
    meta: { formula: "w_k = exp(−(k − m)² / (2s²)), m = offset·(n−1), s = n/σ, k = 0 (oldest) … n−1; ALMA = Σ w_k·x_k / Σ w_k." },
    build: (p, x) => {
      const n = Number(p.length), m = Number(p.offset) * (n - 1), sg = n / Number(p.sigma);
      const w = Array.from({ length: n }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * sg * sg)));
      const ws = w.reduce((a, b) => a + b, 0);
      return [out("alma", rolling(`alma:${p.offset}:${p.sigma}`, [x], n, (g) => { let v = 0; for (let k = 0; k < n; k++) v += w[k] * g(0, n - 1 - k); return v / ws; }))];
    },
  }),
  defineNative({
    id: "t3", name: "Tillson T3 Moving Average", category: "Trend", pane: "overlay", source: true, params: [len("length", 5), num("vfactor", 0.7, "Volume factor", 0, 1, 0.05)],
    description: "Six chained EMAs combined with the volume factor.", outputs: [line("t3", "T3", "#fb923c")],
    meta: { formula: "e1…e6 = chained EMA(n); T3 = c1·e6 + c2·e5 + c3·e4 + c4·e3 with c1 = −v³, c2 = 3v² + 3v³, c3 = −6v² − 3v − 3v³, c4 = 1 + 3v + v³ + 3v²." },
    build: (p, x) => {
      const v = Number(p.vfactor), e = chain(x, Number(p.length), 6);
      const c1 = -(v ** 3), c2 = 3 * v * v + 3 * v ** 3, c3 = -6 * v * v - 3 * v - 3 * v ** 3, c4 = 1 + 3 * v + v ** 3 + 3 * v * v;
      return [out("t3", map(`t3:${v}`, [e[5], e[4], e[3], e[2]], ([a, b, c, d]) => c1 * a + c2 * b + c3 * c + c4 * d))];
    },
  }),
  defineNative({
    id: "trima", name: "Triangular Moving Average", category: "Trend", pane: "overlay", source: true, params: [len("length", 20)],
    description: "SMA of an SMA (triangular weights).", outputs: [line("trima", "TRIMA", "#60a5fa")],
    meta: { formula: "TRIMA = SMA(SMA(x, ⌈n/2⌉), ⌊n/2⌋ + 1)." },
    build: (p, x) => { const n = Number(p.length); return [out("trima", sma(sma(x, Math.ceil(n / 2)), Math.floor(n / 2) + 1))]; },
  }),
  defineNative({
    id: "zlema", name: "Zero-Lag EMA", category: "Trend", pane: "overlay", source: true, params: [len("length", 20)],
    description: "EMA of a de-lagged series.", outputs: [line("zlema", "ZLEMA", "#f472b6")],
    meta: { formula: "lag = ⌊(n−1)/2⌋; ZLEMA = EMA(x + (x − x[lag]), n)." },
    build: (p, x) => { const n = Number(p.length), L = Math.floor((n - 1) / 2); return [out("zlema", ema(map("delag", [x, lag(x, L)], ([a, b]) => a + (a - b)), n))]; },
  }),
  defineNative({
    id: "vidya", name: "Variable Index Dynamic Average", category: "Trend", pane: "overlay", source: true, params: [len("length", 14), len("cmo", 9, "CMO length")],
    description: "Chande's VIDYA: EMA whose speed scales with |CMO|.", outputs: [line("vidya", "VIDYA", "#22d3ee")],
    meta: { formula: "α = 2/(n+1); k = |CMO(x, m)|/100; VIDYA = α·k·x + (1 − α·k)·VIDYA[1].", conventions: "Seeded with x at the first bar where the CMO exists." },
    build: (p, x) => {
      const a = 2 / (Number(p.length) + 1), m = Number(p.cmo);
      const cmo = cmoNode(x, m);
      return [out("vidya", reducer(`vidya:${a}`, [x, cmo], () => ({ prev: NaN }), (st, _i, _r, [v, c]) => {
        if (Number.isNaN(c)) return NaN;
        const k = (Math.abs(c) / 100) * a;
        st.prev = Number.isNaN(st.prev) ? v : k * v + (1 - k) * st.prev;
        return st.prev;
      }, (st) => ({ ...st })))];
    },
  }),
  defineNative({
    id: "mcginley", name: "McGinley Dynamic", category: "Trend", pane: "overlay", source: true, params: [len("length", 14)],
    description: "Self-adjusting moving average.", outputs: [line("md", "McGinley", "#eab308")],
    meta: { formula: "MD = MD[1] + (x − MD[1]) / (n · (x / MD[1])⁴); seeded with EMA(x, n) at its first value." },
    build: (p, x) => {
      const n = Number(p.length);
      return [out("md", reducer(`mcg:${n}`, [x, ema(x, n)], () => ({ prev: NaN }), (st, _i, _r, [v, e]) => {
        if (Number.isNaN(st.prev)) { st.prev = e; return e; }
        st.prev = st.prev + (v - st.prev) / (n * (v / st.prev) ** 4);
        return st.prev;
      }, (st) => ({ ...st })))];
    },
  }),
  defineNative({
    id: "aroon", name: "Aroon", category: "Trend", pane: "separate", params: [len("length", 14)], range: [0, 100], levels: [70, 30],
    description: "Bars since the n-bar high / low, scaled 0–100.", outputs: [line("up", "Aroon Up", "#22c55e"), line("down", "Aroon Down", "#ef4444")],
    meta: { formula: "Up = 100·(n − bars since highest high of the last n+1 bars)/n; Down likewise with the lowest low.", conventions: "Ties: the most recent extreme counts." },
    build: (p) => {
      const n = Number(p.length);
      const since = (x: K.NodeDef, max: boolean) => rolling(`since:${max}`, [x], n + 1, (g) => { let best = 0; for (let k = 1; k <= n; k++) if (max ? g(0, k) > g(0, best) : g(0, k) < g(0, best)) best = k; return (100 * (n - best)) / n; });
      return [out("up", since(hi, true)), out("down", since(lo, false))];
    },
  }),
  defineNative({
    id: "aroonosc", name: "Aroon Oscillator", category: "Trend", pane: "separate", params: [len("length", 14)], range: [-100, 100], levels: [0],
    description: "Aroon Up − Aroon Down.", outputs: [histo("osc", "Aroon Osc", "#38bdf8")],
    meta: { formula: "Aroon Up − Aroon Down (see Aroon)." },
    build: (p) => {
      const n = Number(p.length);
      const since = (x: K.NodeDef, max: boolean) => rolling(`since:${max}`, [x], n + 1, (g) => { let best = 0; for (let k = 1; k <= n; k++) if (max ? g(0, k) > g(0, best) : g(0, k) < g(0, best)) best = k; return (100 * (n - best)) / n; });
      return [out("osc", map("sub", [since(hi, true), since(lo, false)], ([a, b]) => a - b))];
    },
  }),
  defineNative({
    id: "vortex", name: "Vortex Indicator", category: "Trend", pane: "separate", params: [len("length", 14)], levels: [1],
    description: "Positive and negative trend movement relative to true range.", outputs: [line("plus", "VI+", "#22c55e"), line("minus", "VI−", "#ef4444")],
    meta: { formula: "VM+ = |H − L[1]|, VM− = |L − H[1]|; VI± = Σ VM± / Σ TR over n bars." },
    build: (p) => {
      const n = Number(p.length), tr = trueRange(true);
      const vmp = map("vmp", [hi, lag(lo, 1)], ([h, l1]) => Math.abs(h - l1)), vmm = map("vmm", [lo, lag(hi, 1)], ([l, h1]) => Math.abs(l - h1));
      const st = sum(tr, n);
      return [out("plus", map("div", [sum(vmp, n), st], ([a, b]) => a / b)), out("minus", map("div", [sum(vmm, n), st], ([a, b]) => a / b))];
    },
  }),
  defineNative({
    id: "ckstop", name: "Chande Kroll Stop", category: "Trend", pane: "overlay", params: [len("p", 10, "ATR length"), num("x", 1, "ATR multiplier", 0.1, 10), len("q", 9, "Stop length")],
    description: "Volatility stops for long and short positions.", outputs: [line("long", "Stop long", "#22c55e"), line("short", "Stop short", "#ef4444")],
    meta: { formula: "fh = HH(p) − x·ATR(p), fl = LL(p) + x·ATR(p); stop short = HH(fh, q); stop long = LL(fl, q)." },
    build: (p) => {
      const P = Number(p.p), X = Number(p.x), Q = Number(p.q), a = atr(P);
      const fh = map(`ckh:${X}`, [highest(hi, P), a], ([h, v]) => h - X * v), fl = map(`ckl:${X}`, [lowest(lo, P), a], ([l, v]) => l + X * v);
      return [out("long", lowest(fl, Q)), out("short", highest(fh, Q))];
    },
  }),
  defineNative({
    id: "chandelier", name: "Chandelier Exit", category: "Trend", pane: "overlay", params: [len("length", 22), num("mult", 3, "ATR multiplier", 0.1, 10)],
    description: "ATR trailing exits from the highest high / lowest low.", outputs: [line("long", "Exit long", "#22c55e"), line("short", "Exit short", "#ef4444")],
    meta: { formula: "Long = HH(n) − m·ATR(n); Short = LL(n) + m·ATR(n)." },
    build: (p) => {
      const n = Number(p.length), m = Number(p.mult), a = atr(n);
      return [out("long", map(`ce-:${m}`, [highest(hi, n), a], ([h, v]) => h - m * v)), out("short", map(`ce+:${m}`, [lowest(lo, n), a], ([l, v]) => l + m * v))];
    },
  }),
  defineNative({
    id: "trix", name: "TRIX", category: "Trend", pane: "separate", source: true, params: [len("length", 15)], levels: [0],
    description: "Rate of change of a triple-smoothed EMA.", outputs: [line("trix", "TRIX", "#a78bfa")],
    meta: { formula: "E3 = EMA(EMA(EMA(x,n),n),n); TRIX = 100·(E3 − E3[1]) / E3[1]." },
    build: (p, x) => { const e3 = chain(x, Number(p.length), 3)[2]; return [out("trix", rocNode(e3, 1))]; },
  }),
  defineNative({
    id: "envelopes", name: "Moving Average Envelopes", category: "Trend", pane: "overlay", source: true, params: [len("length", 20), num("percent", 2.5, "Percent", 0.01, 50, 0.1)],
    description: "SMA with bands a fixed percentage above and below.", outputs: [line("upper", "Upper", "#38bdf8"), line("mid", "Mid", "#f59e0b"), line("lower", "Lower", "#38bdf8")],
    meta: { formula: "Mid = SMA(x,n); Upper = Mid·(1 + p/100); Lower = Mid·(1 − p/100)." },
    build: (p, x) => { const m = sma(x, Number(p.length)), k = Number(p.percent) / 100; return [out("upper", map(`env+${k}`, [m], ([v]) => v * (1 + k))), out("mid", m), out("lower", map(`env-${k}`, [m], ([v]) => v * (1 - k)))]; },
  }),
  defineNative({
    id: "smma", name: "Smoothed Moving Average (RMA)", category: "Trend", pane: "overlay", source: true, params: [len("length", 14)],
    description: "Wilder's smoothing.", outputs: [line("smma", "SMMA", "#94a3b8")],
    meta: { formula: "SMMA = (SMMA[1]·(n−1) + x)/n, seeded with SMA(x,n)." },
    build: (p, x) => [out("smma", rma(x, Number(p.length)))],
  }),
];

function cmoNode(x: K.NodeDef, n: number) {
  const mv = K.moves(x);
  return map("cmo", [sum(mv, n), sum(K.aux(mv), n)], ([u, d]) => (u + d === 0 ? 0 : (100 * (u - d)) / (u + d)));
}

export const MOMENTUM = [
  defineNative({
    id: "stochrsi", name: "Stochastic RSI", category: "Momentum", pane: "separate", source: true, params: [len("rsi", 14, "RSI length"), len("stoch", 14, "Stochastic length"), len("k", 3, "%K smoothing"), len("d", 3, "%D length")], range: [0, 100], levels: [80, 20],
    description: "Stochastic oscillator applied to RSI.", outputs: [line("k", "%K", "#38bdf8"), line("d", "%D", "#fb923c")],
    meta: { formula: "S = 100·(RSI − LL(RSI,m))/(HH(RSI,m) − LL(RSI,m)) (50 when the range is 0); %K = SMA(S,k); %D = SMA(%K,d)." },
    build: (p, x) => { const k = sma(stochOf(rsiNode(x, Number(p.rsi)), Number(p.stoch), "rsi"), Number(p.k)); return [out("k", k), out("d", sma(k, Number(p.d)))]; },
  }),
  defineNative({
    id: "mom", name: "Momentum", category: "Momentum", pane: "separate", source: true, params: [len("length", 10)], levels: [0],
    description: "Price difference over n bars.", outputs: [line("mom", "MOM", "#38bdf8")],
    meta: { formula: "MOM = x − x[n]." },
    build: (p, x) => [out("mom", map("sub", [x, lag(x, Number(p.length))], ([a, b]) => a - b))],
  }),
  defineNative({
    id: "uo", name: "Ultimate Oscillator", category: "Momentum", pane: "separate", params: [len("fast", 7, "Fast"), len("mid", 14, "Middle"), len("slow", 28, "Slow")], range: [0, 100], levels: [70, 30],
    description: "Williams' weighted buying pressure over three windows.", outputs: [line("uo", "UO", "#a78bfa")],
    meta: { formula: "BP = C − min(L, C[1]); TR = max(H, C[1]) − min(L, C[1]); A_k = ΣBP/ΣTR (k bars); UO = 100·(4A₁ + 2A₂ + A₃)/7.", conventions: "Starts at the second bar (needs C[1])." },
    build: (p) => {
      const c1 = lag(cl, 1);
      const bp = map("uobp", [cl, lo, c1], ([c, l, p1]) => c - Math.min(l, p1)), tr = map("uotr", [hi, lo, c1], ([h, l, p1]) => Math.max(h, p1) - Math.min(l, p1));
      const avg = (n: number) => map("div", [sum(bp, n), sum(tr, n)], ([a, b]) => a / b);
      return [out("uo", map("uo", [avg(Number(p.fast)), avg(Number(p.mid)), avg(Number(p.slow))], ([a, b, c]) => (100 * (4 * a + 2 * b + c)) / 7))];
    },
  }),
  defineNative({
    id: "ao", name: "Awesome Oscillator", category: "Momentum", pane: "separate", params: [len("fast", 5, "Fast"), len("slow", 34, "Slow")], levels: [0],
    description: "Difference of SMAs of the median price.", outputs: [histo("ao", "AO", "#22c55e")],
    meta: { formula: "AO = SMA(hl2, 5) − SMA(hl2, 34)." },
    build: (p) => { const m = src("hl2"); return [out("ao", map("sub", [sma(m, Number(p.fast)), sma(m, Number(p.slow))], ([a, b]) => a - b))]; },
  }),
  defineNative({
    id: "ac", name: "Accelerator Oscillator", category: "Momentum", pane: "separate", params: [len("fast", 5, "Fast"), len("slow", 34, "Slow"), len("signal", 5, "Signal")], levels: [0],
    description: "AO minus its SMA.", outputs: [histo("ac", "AC", "#22c55e")],
    meta: { formula: "AC = AO − SMA(AO, 5)." },
    build: (p) => { const m = src("hl2"), ao = map("sub", [sma(m, Number(p.fast)), sma(m, Number(p.slow))], ([a, b]) => a - b); return [out("ac", map("sub", [ao, sma(ao, Number(p.signal))], ([a, b]) => a - b))]; },
  }),
  defineNative({
    id: "tsi", name: "True Strength Index", category: "Momentum", pane: "separate", source: true, params: [len("long", 25, "Long"), len("short", 13, "Short"), len("signal", 13, "Signal")], levels: [0],
    description: "Double-smoothed momentum ratio.", outputs: [line("tsi", "TSI", "#38bdf8"), line("signal", "Signal", "#fb923c")],
    meta: { formula: "m = x − x[1]; TSI = 100·EMA(EMA(m,r),s)/EMA(EMA(|m|,r),s); Signal = EMA(TSI, k)." },
    build: (p, x) => {
      const m = map("sub", [x, lag(x, 1)], ([a, b]) => a - b), am = map("abs", [m], ([v]) => Math.abs(v));
      const ds = (v: K.NodeDef) => ema(ema(v, Number(p.long)), Number(p.short));
      const t = map("ratio100", [ds(m), ds(am)], ([a, b]) => (100 * a) / b);
      return [out("tsi", t), out("signal", ema(t, Number(p.signal)))];
    },
  }),
  defineNative({
    id: "rvgi", name: "Relative Vigor Index", category: "Momentum", pane: "separate", params: [len("length", 10)], levels: [0],
    description: "Close-open versus high-low vigor with symmetric weighting.", outputs: [line("rvi", "RVI", "#22c55e"), line("signal", "Signal", "#ef4444")],
    meta: { formula: "num = (co + 2co[1] + 2co[2] + co[3])/6, co = C − O; den likewise with H − L; RVI = Σnum/Σden (n); Signal = (RVI + 2RVI[1] + 2RVI[2] + RVI[3])/6." },
    build: (p) => {
      const sym = (x: K.NodeDef) => rolling("sym6", [x], 4, (g) => (g(0, 0) + 2 * g(0, 1) + 2 * g(0, 2) + g(0, 3)) / 6);
      const num = sym(map("sub", [cl, op], ([a, b]) => a - b)), den = sym(map("sub", [hi, lo], ([a, b]) => a - b));
      const n = Number(p.length), r = map("div", [sum(num, n), sum(den, n)], ([a, b]) => a / b);
      return [out("rvi", r), out("signal", sym(r))];
    },
  }),
  defineNative({
    id: "cmo", name: "Chande Momentum Oscillator", category: "Momentum", pane: "separate", source: true, params: [len("length", 9)], range: [-100, 100], levels: [50, -50],
    description: "Net up-moves over total moves.", outputs: [line("cmo", "CMO", "#38bdf8")],
    meta: { formula: "CMO = 100·(Σup − Σdown)/(Σup + Σdown) over n changes (0 when there is no movement)." },
    build: (p, x) => [out("cmo", cmoNode(x, Number(p.length)))],
  }),
  defineNative({
    id: "dpo", name: "Detrended Price Oscillator", category: "Momentum", pane: "separate", source: true, params: [len("length", 20)], levels: [0],
    description: "Price minus a displaced moving average (non-centred).", outputs: [line("dpo", "DPO", "#a78bfa")],
    meta: { formula: "DPO = x[⌊n/2⌋+1] − SMA(x, n).", conventions: "Causal form: compares the price ⌊n/2⌋+1 bars ago with the current SMA, so no future data is used.", limitations: "The centred textbook DPO looks ahead; this version is shifted to avoid that." },
    build: (p, x) => { const n = Number(p.length); return [out("dpo", map("sub", [lag(x, Math.floor(n / 2) + 1), sma(x, n)], ([a, b]) => a - b))]; },
  }),
  defineNative({
    id: "ppo", name: "Percentage Price Oscillator", category: "Momentum", pane: "separate", source: true, params: [len("fast", 12, "Fast"), len("slow", 26, "Slow"), len("signal", 9, "Signal")], levels: [0],
    description: "MACD expressed as a percentage of the slow EMA.", outputs: [histo("hist", "Hist", "#22c55e"), line("ppo", "PPO", "#2962ff"), line("signal", "Signal", "#ff9800")],
    meta: { formula: "PPO = 100·(EMA(x,f) − EMA(x,s))/EMA(x,s); Signal = EMA(PPO, k); Hist = PPO − Signal." },
    build: (p, x) => {
      const s = ema(x, Number(p.slow)), pp = map("ppo", [ema(x, Number(p.fast)), s], ([a, b]) => (100 * (a - b)) / b), sg = ema(pp, Number(p.signal));
      return [out("hist", map("sub", [pp, sg], ([a, b]) => a - b)), out("ppo", pp), out("signal", sg)];
    },
  }),
  defineNative({
    id: "coppock", name: "Coppock Curve", category: "Momentum", pane: "separate", source: true, params: [len("wma", 10, "WMA length"), len("long", 14, "Long ROC"), len("short", 11, "Short ROC")], levels: [0],
    description: "WMA of two rates of change.", outputs: [histo("cc", "Coppock", "#38bdf8")],
    meta: { formula: "Coppock = WMA(ROC(x, long) + ROC(x, short), w)." },
    build: (p, x) => [out("cc", wma(map("add", [rocNode(x, Number(p.long)), rocNode(x, Number(p.short))], ([a, b]) => a + b), Number(p.wma)))],
  }),
  defineNative({
    id: "fisher", name: "Fisher Transform", category: "Momentum", pane: "separate", params: [len("length", 9)], levels: [0],
    description: "Ehlers' Fisher transform of the normalised median price.", outputs: [line("fisher", "Fisher", "#38bdf8"), line("trigger", "Trigger", "#fb923c")],
    meta: { formula: "v = 0.66·((hl2 − LL)/(HH − LL) − 0.5) + 0.67·v[1], clamped to ±0.999; F = 0.5·ln((1+v)/(1−v)) + 0.5·F[1]; Trigger = F[1].", conventions: "HH = LL gives a normalised value of 0.5 (v carried)." },
    build: (p) => {
      const n = Number(p.length), m = src("hl2");
      const core = reducer("fisher", [m, highest(m, n), lowest(m, n)], () => ({ v: 0, f: 0, started: false }), (st, _i, _r, [x, h, l], ) => {
        if (Number.isNaN(h)) return NaN;
        const norm = h === l ? 0.5 : (x - l) / (h - l);
        let v = 0.66 * (norm - 0.5) + 0.67 * st.v;
        v = Math.max(-0.999, Math.min(0.999, v));
        st.v = v;
        st.f = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * st.f;
        st.started = true;
        return st.f;
      }, (st) => ({ ...st }));
      return [out("fisher", core), out("trigger", lag(core, 1))];
    },
  }),
  defineNative({
    id: "kst", name: "Know Sure Thing", category: "Momentum", pane: "separate", source: true, params: [len("signal", 9, "Signal")], levels: [0],
    description: "Pring's weighted sum of smoothed rates of change (10/15/20/30, smoothed 10/10/10/15).", outputs: [line("kst", "KST", "#22c55e"), line("signal", "Signal", "#ef4444")],
    meta: { formula: "KST = SMA(ROC10,10) + 2·SMA(ROC15,10) + 3·SMA(ROC20,10) + 4·SMA(ROC30,15); Signal = SMA(KST, 9)." },
    build: (p, x) => {
      const r = (a: number, b: number) => sma(rocNode(x, a), b);
      const k = map("kst", [r(10, 10), r(15, 10), r(20, 10), r(30, 15)], ([a, b, c, d]) => a + 2 * b + 3 * c + 4 * d);
      return [out("kst", k), out("signal", sma(k, Number(p.signal)))];
    },
  }),
  defineNative({
    id: "stc", name: "Schaff Trend Cycle", category: "Momentum", pane: "separate", source: true, params: [len("fast", 23, "Fast"), len("slow", 50, "Slow"), len("cycle", 10, "Cycle"), num("factor", 0.5, "Smoothing factor", 0.01, 1, 0.01)], range: [0, 100], levels: [75, 25],
    description: "Double stochastic of MACD with smoothing.", outputs: [line("stc", "STC", "#a78bfa")],
    meta: { formula: "MACD = EMA(f) − EMA(s); F1 = stoch(MACD, c), PF = PF[1] + f·(F1 − PF[1]); F2 = stoch(PF, c); STC = STC[1] + f·(F2 − STC[1]).", conventions: "stoch(v, c) = 100·(v − LL)/(HH − LL); when HH = LL the previous stochastic value is kept. PF and STC are seeded with their first stochastic value." },
    build: (p, x) => {
      const c = Number(p.cycle), f = Number(p.factor);
      const macd = map("sub", [ema(x, Number(p.fast)), ema(x, Number(p.slow))], ([a, b]) => a - b);
      const smooth = (v: K.NodeDef, id: string) => {
        const st = reducer(`stcStoch:${id}`, [v, highest(v, c), lowest(v, c)], () => ({ prev: NaN }), (s2, _i, _r, [y, h, l]) => {
          if (Number.isNaN(h)) return NaN;
          if (h !== l) s2.prev = (100 * (y - l)) / (h - l);
          return Number.isNaN(s2.prev) ? NaN : s2.prev;
        }, (s2) => ({ ...s2 }));
        return reducer(`stcSmooth:${f}:${id}`, [st], () => ({ prev: NaN }), (s2, _i, _r, [z]) => {
          if (Number.isNaN(z)) return NaN;
          s2.prev = Number.isNaN(s2.prev) ? z : s2.prev + f * (z - s2.prev);
          return s2.prev;
        }, (s2) => ({ ...s2 }));
      };
      return [out("stc", smooth(smooth(macd, "1"), "2"))];
    },
  }),
  defineNative({
    id: "bop", name: "Balance of Power", category: "Momentum", pane: "separate", params: [len("smooth", 14, "Smoothing")], range: [-1, 1], levels: [0],
    description: "Close-open relative to the range.", outputs: [line("bop", "BOP", "#38bdf8")],
    meta: { formula: "BOP = SMA((C − O)/(H − L), k); a bar with H = L contributes 0." },
    build: (p) => [out("bop", sma(map("bop", [cl, op, hi, lo], ([c, o, h, l]) => (h === l ? 0 : (c - o) / (h - l))), Number(p.smooth)))],
  }),
  defineNative({
    id: "elderray", name: "Elder Ray Index", category: "Momentum", pane: "separate", params: [len("length", 13)], levels: [0],
    description: "Bull and bear power around an EMA.", outputs: [histo("bull", "Bull power", "#22c55e"), histo("bear", "Bear power", "#ef4444")],
    meta: { formula: "Bull = H − EMA(C, n); Bear = L − EMA(C, n)." },
    build: (p) => { const e = ema(cl, Number(p.length)); return [out("bull", map("sub", [hi, e], ([a, b]) => a - b)), out("bear", map("sub", [lo, e], ([a, b]) => a - b))]; },
  }),
  defineNative({
    id: "crsi", name: "Connors RSI", category: "Momentum", pane: "separate", params: [len("rsi", 3, "RSI length"), len("streak", 2, "Streak RSI length"), len("rank", 100, "Percent-rank length")], range: [0, 100], levels: [90, 10],
    description: "Average of price RSI, streak RSI and percent rank of the 1-bar return.", outputs: [line("crsi", "CRSI", "#a78bfa")],
    meta: { formula: "CRSI = (RSI(C, a) + RSI(streak, b) + PercentRank(ROC(C,1), c))/3; streak = consecutive up (+) / down (−) closes, 0 when unchanged; PercentRank = % of the previous c values below the current one." },
    build: (p) => {
      const streak = reducer("streak", [cl, lag(cl, 1)], () => ({ s: 0 }), (st, i, _r, [c, c1]) => {
        if (i === 0) return 0;
        st.s = c > c1 ? (st.s > 0 ? st.s + 1 : 1) : c < c1 ? (st.s < 0 ? st.s - 1 : -1) : 0;
        return st.s;
      }, (st) => ({ ...st }));
      const r1 = rocNode(cl, 1), m = Number(p.rank);
      const rank = rolling("prank", [r1], m + 1, (g) => { let below = 0; for (let k = 1; k <= m; k++) if (g(0, k) < g(0, 0)) below++; return (100 * below) / m; });
      return [out("crsi", map("avg3", [rsiNode(cl, Number(p.rsi)), rsiNode(streak, Number(p.streak)), rank], ([a, b, c]) => (a + b + c) / 3))];
    },
  }),
  defineNative({
    id: "demarker", name: "DeMarker", category: "Momentum", pane: "separate", params: [len("length", 14)], range: [0, 1], levels: [0.7, 0.3],
    description: "Comparison of highs and lows with the previous bar.", outputs: [line("dem", "DeM", "#38bdf8")],
    meta: { formula: "DeMax = max(H − H[1], 0), DeMin = max(L[1] − L, 0); DeM = SMA(DeMax)/(SMA(DeMax) + SMA(DeMin)) (0.5 when both are 0)." },
    build: (p) => {
      const n = Number(p.length);
      const mx = sma(map("demax", [hi, lag(hi, 1)], ([h, h1]) => Math.max(h - h1, 0)), n), mn = sma(map("demin", [lo, lag(lo, 1)], ([l, l1]) => Math.max(l1 - l, 0)), n);
      return [out("dem", map("dem", [mx, mn], ([a, b]) => (a + b === 0 ? 0.5 : a / (a + b))))];
    },
  }),
];
