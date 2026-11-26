/** Native statistical and market-structure indicators (see define.ts). */
import { defineNative, len, line, num, out, sel, K } from "./define.ts";

const { map, lag, highest, lowest, rolling, reducer, src } = K;
const hi = src("high"), lo = src("low"), cl = src("close"), op = src("open"), bench = src("benchmark");
const ANN = "Returns are simple 1-bar returns r = x/x[1] − 1. Annualisation uses P periods per year (parameter; 252 for daily bars).";
const periods = num("periods", 252, "Periods per year", 1, 1_000_000, 1);
const rf = num("rf", 0, "Risk-free rate (% per year)", -100, 100, 0.1);
const ret = (x: K.NodeDef) => map("ret", [x, lag(x, 1)], ([a, b]) => a / b - 1);

/** Least squares of the window against bar position t = 0 (oldest) … n−1 (current). */
function regress(g: (d: number, k: number) => number, n: number) {
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let t = 0; t < n; t++) {
    const y = g(0, n - 1 - t);
    sx += t; sy += y; sxx += t * t; sxy += t * y;
  }
  const den = n * sxx - sx * sx;
  const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  let ssr = 0, sst = 0;
  const mean = sy / n;
  for (let t = 0; t < n; t++) {
    const y = g(0, n - 1 - t), f = intercept + slope * t;
    ssr += (y - f) ** 2;
    sst += (y - mean) ** 2;
  }
  return { slope, intercept, end: intercept + slope * (n - 1), ssr, sst };
}
const moments = (g: (d: number, k: number) => number, n: number, d = 0) => {
  let m = 0;
  for (let k = 0; k < n; k++) m += g(d, k);
  m /= n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (let k = 0; k < n; k++) {
    const e = g(d, k) - m;
    m2 += e * e; m3 += e ** 3; m4 += e ** 4;
  }
  return { mean: m, m2: m2 / n, m3: m3 / n, m4: m4 / n };
};
const sorted = (g: (d: number, k: number) => number, n: number) => Array.from({ length: n }, (_, k) => g(0, k)).sort((a, b) => a - b);
/** Linear-interpolation percentile (rank (n−1)·q). */
const pctile = (s: number[], q: number) => {
  const r = (s.length - 1) * q, lo2 = Math.floor(r), hi2 = Math.ceil(r);
  return s[lo2] + (s[hi2] - s[lo2]) * (r - lo2);
};
const pairStats = (g: (d: number, k: number) => number, n: number) => {
  let ma = 0, mb = 0;
  for (let k = 0; k < n; k++) { ma += g(0, k); mb += g(1, k); }
  ma /= n; mb /= n;
  let cab = 0, va = 0, vb = 0;
  for (let k = 0; k < n; k++) { const a = g(0, k) - ma, b = g(1, k) - mb; cab += a * b; va += a * a; vb += b * b; }
  return { ma, mb, cov: cab / (n - 1), va: va / (n - 1), vb: vb / (n - 1) };
};
const benchMeta = "Requires a benchmark series: call chart.setBenchmarkSeries(series) first. Bars where the benchmark has no value are skipped by the window (a missing value restarts it).";
const mode = sel("mode", "returns", "Compute on", ["returns", "prices"]);
const pairInputs = (p: Record<string, unknown>, x: K.NodeDef) => (p.mode === "prices" ? [x, bench] : [ret(x), ret(bench)]);

export const STATISTICS = [
  defineNative({
    id: "linreg", name: "Linear Regression", category: "Statistics", pane: "overlay", source: true, params: [len("length", 20, "Length", 2)],
    description: "End point of the least-squares line over the window.", outputs: [line("lr", "LinReg", "#f59e0b")],
    meta: { formula: "Fit y = a + b·t to the last n values (t = 0 oldest … n−1 current); LinReg = a + b·(n−1)." },
    build: (p, x) => [out("lr", rolling("lrEnd", [x], Number(p.length), (g, n) => regress(g, n).end))],
  }),
  defineNative({
    id: "lrslope", name: "Linear Regression Slope", category: "Statistics", pane: "separate", source: true, params: [len("length", 20, "Length", 2)], levels: [0],
    description: "Slope of the least-squares line (price units per bar).", outputs: [line("slope", "Slope", "#f59e0b")],
    meta: { formula: "b = (nΣty − ΣtΣy)/(nΣt² − (Σt)²)." },
    build: (p, x) => [out("slope", rolling("lrSlope", [x], Number(p.length), (g, n) => regress(g, n).slope))],
  }),
  defineNative({
    id: "lrintercept", name: "Linear Regression Intercept", category: "Statistics", pane: "overlay", source: true, params: [len("length", 20, "Length", 2)],
    description: "Value of the least-squares line at the OLDEST bar of the window.", outputs: [line("icpt", "Intercept", "#f59e0b")],
    meta: { formula: "a = (Σy − b·Σt)/n with t = 0 at the oldest bar.", conventions: "The intercept is anchored at the start of the window (t = 0), not at the current bar." },
    build: (p, x) => [out("icpt", rolling("lrIcpt", [x], Number(p.length), (g, n) => regress(g, n).intercept))],
  }),
  defineNative({
    id: "lrchannel", name: "Linear Regression Channel", category: "Statistics", pane: "overlay", source: true, params: [len("length", 50, "Length", 3), num("mult", 2, "Deviations", 0.1, 10)],
    description: "Regression end point ± k residual standard deviations.", outputs: [line("upper", "Upper", "#38bdf8"), line("mid", "Mid", "#f59e0b"), line("lower", "Lower", "#38bdf8")],
    meta: { formula: "Mid = LinReg; σ = √(Σresidual²/n); Upper/Lower = Mid ± k·σ." },
    build: (p, x) => {
      const n = Number(p.length), m = Number(p.mult);
      const mid = rolling("lrEnd", [x], n, (g, w) => regress(g, w).end), sd = rolling("lrResSd", [x], n, (g, w) => Math.sqrt(regress(g, w).ssr / w));
      return [out("upper", map(`plus*${m}`, [mid, sd], ([a, b]) => a + m * b)), out("mid", mid), out("lower", map(`minus*${m}`, [mid, sd], ([a, b]) => a - m * b))];
    },
  }),
  defineNative({
    id: "r2", name: "Coefficient of Determination", category: "Statistics", pane: "separate", source: true, params: [len("length", 20, "Length", 3)], range: [0, 1],
    description: "R² of the linear fit over the window.", outputs: [line("r2", "R²", "#22c55e")],
    meta: { formula: "R² = 1 − SSres/SStot (NaN when SStot = 0)." },
    build: (p, x) => [out("r2", rolling("r2", [x], Number(p.length), (g, n) => { const r = regress(g, n); return r.sst === 0 ? NaN : 1 - r.ssr / r.sst; }))],
  }),
  defineNative({
    id: "stderr", name: "Standard Error of Regression", category: "Statistics", pane: "separate", source: true, params: [len("length", 20, "Length", 3)],
    description: "Standard error of the estimate of the linear fit.", outputs: [line("se", "Std error", "#94a3b8")],
    meta: { formula: "SE = √(SSres/(n − 2))." },
    build: (p, x) => [out("se", rolling("stderr", [x], Number(p.length), (g, n) => Math.sqrt(regress(g, n).ssr / (n - 2))))],
  }),
  defineNative({
    id: "variance", name: "Rolling Variance", category: "Statistics", pane: "separate", source: true, params: [len("length", 20, "Length", 2)],
    description: "Population variance of the window.", outputs: [line("var", "Variance", "#94a3b8")],
    meta: { formula: "Var = Σ(x − mean)²/n (population)." },
    build: (p, x) => [out("var", rolling("var", [x], Number(p.length), (g, n) => moments(g, n).m2))],
  }),
  defineNative({
    id: "zscore", name: "Rolling Z-Score", category: "Statistics", pane: "separate", source: true, params: [len("length", 20, "Length", 2)], levels: [2, 0, -2],
    description: "Distance from the rolling mean in standard deviations.", outputs: [line("z", "Z", "#38bdf8")],
    meta: { formula: "Z = (x − mean)/σ, population σ over n bars (NaN when σ = 0)." },
    build: (p, x) => [out("z", rolling("z", [x], Number(p.length), (g, n) => { const m = moments(g, n); return m.m2 === 0 ? NaN : (g(0, 0) - m.mean) / Math.sqrt(m.m2); }))],
  }),
  defineNative({
    id: "median", name: "Rolling Median", category: "Statistics", pane: "overlay", source: true, params: [len("length", 20)],
    description: "Median of the window.", outputs: [line("median", "Median", "#eab308")],
    meta: { formula: "Middle value of the sorted window (mean of the two middle values for even n)." },
    build: (p, x) => [out("median", rolling("median", [x], Number(p.length), (g, n) => pctile(sorted(g, n), 0.5)))],
  }),
  defineNative({
    id: "percentile", name: "Rolling Percentile", category: "Statistics", pane: "overlay", source: true, params: [len("length", 20), num("q", 90, "Percentile", 0, 100, 1)],
    description: "Percentile of the window.", outputs: [line("pct", "Percentile", "#eab308")],
    meta: { formula: "Linear interpolation between order statistics at rank (n − 1)·q/100." },
    build: (p, x) => { const q = Number(p.q) / 100; return [out("pct", rolling(`pctile:${q}`, [x], Number(p.length), (g, n) => pctile(sorted(g, n), q)))]; },
  }),
  defineNative({
    id: "skew", name: "Rolling Skewness", category: "Statistics", pane: "separate", source: true, params: [len("length", 30, "Length", 3)], levels: [0],
    description: "Moment-based skewness of the window.", outputs: [line("skew", "Skew", "#a78bfa")],
    meta: { formula: "g1 = m3/m2^1.5 (population moments; NaN when m2 = 0)." },
    build: (p, x) => [out("skew", rolling("skew", [x], Number(p.length), (g, n) => { const m = moments(g, n); return m.m2 === 0 ? NaN : m.m3 / m.m2 ** 1.5; }))],
  }),
  defineNative({
    id: "kurtosis", name: "Rolling Kurtosis", category: "Statistics", pane: "separate", source: true, params: [len("length", 30, "Length", 4)], levels: [0],
    description: "Excess kurtosis of the window.", outputs: [line("kurt", "Kurtosis", "#a78bfa")],
    meta: { formula: "g2 = m4/m2² − 3 (population moments; NaN when m2 = 0)." },
    build: (p, x) => [out("kurt", rolling("kurt", [x], Number(p.length), (g, n) => { const m = moments(g, n); return m.m2 === 0 ? NaN : m.m4 / m.m2 ** 2 - 3; }))],
  }),
  defineNative({
    id: "correl", name: "Rolling Correlation", category: "Statistics", pane: "separate", source: true, requires: ["benchmark"], params: [len("length", 20, "Length", 3), mode], range: [-1, 1], levels: [0],
    description: "Pearson correlation with the benchmark.", outputs: [line("corr", "Correlation", "#38bdf8")],
    meta: { formula: "ρ = cov(a, b)/(σa·σb) over n bars of returns (or prices).", conventions: `${ANN} ${benchMeta}` },
    build: (p, x) => [out("corr", rolling("corr", pairInputs(p, x), Number(p.length), (g, n) => { const s = pairStats(g, n); return s.va === 0 || s.vb === 0 ? NaN : s.cov / Math.sqrt(s.va * s.vb); }))],
  }),
  defineNative({
    id: "covar", name: "Rolling Covariance", category: "Statistics", pane: "separate", source: true, requires: ["benchmark"], params: [len("length", 20, "Length", 3), mode],
    description: "Sample covariance with the benchmark.", outputs: [line("cov", "Covariance", "#38bdf8")],
    meta: { formula: "cov = Σ(a − ā)(b − b̄)/(n − 1).", conventions: `${ANN} ${benchMeta}` },
    build: (p, x) => [out("cov", rolling("cov", pairInputs(p, x), Number(p.length), (g, n) => pairStats(g, n).cov))],
  }),
  defineNative({
    id: "beta", name: "Rolling Beta", category: "Statistics", pane: "separate", source: true, requires: ["benchmark"], params: [len("length", 60, "Length", 3)], levels: [1],
    description: "Sensitivity of returns to benchmark returns.", outputs: [line("beta", "Beta", "#f59e0b")],
    meta: { formula: "β = cov(r, rb)/var(rb) over n returns.", conventions: `${ANN} ${benchMeta}` },
    build: (p, x) => [out("beta", rolling("beta", [ret(x), ret(bench)], Number(p.length), (g, n) => { const s = pairStats(g, n); return s.vb === 0 ? NaN : s.cov / s.vb; }))],
  }),
  defineNative({
    id: "alpha", name: "Rolling Alpha (Jensen)", category: "Statistics", pane: "separate", source: true, requires: ["benchmark"], params: [len("length", 60, "Length", 3), rf, periods], levels: [0],
    description: "Annualised excess return not explained by beta.", outputs: [line("alpha", "Alpha %", "#22c55e")],
    meta: { formula: "α = [mean(r − rf/P) − β·mean(rb − rf/P)]·P·100.", conventions: `${ANN} ${benchMeta}` },
    build: (p, x) => {
      const P = Number(p.periods), rfp = Number(p.rf) / 100 / P;
      return [out("alpha", rolling(`alpha:${P}:${rfp}`, [ret(x), ret(bench)], Number(p.length), (g, n) => { const s = pairStats(g, n); if (s.vb === 0) return NaN; const b = s.cov / s.vb; return (s.ma - rfp - b * (s.mb - rfp)) * P * 100; }))];
    },
  }),
  defineNative({
    id: "maxdd", name: "Rolling Maximum Drawdown", category: "Statistics", pane: "separate", source: true, params: [len("length", 252, "Length", 2, 5000)],
    description: "Largest peak-to-trough decline within the window (%).", outputs: [line("mdd", "Max DD %", "#ef4444")],
    meta: { formula: "MDD = min over the window of 100·(x_t / max_{s≤t} x_s − 1), peaks taken inside the window." },
    build: (p, x) => [out("mdd", rolling("maxdd", [x], Number(p.length), (g, n) => { let peak = -Infinity, dd = 0; for (let k = n - 1; k >= 0; k--) { const v = g(0, k); peak = Math.max(peak, v); dd = Math.min(dd, 100 * (v / peak - 1)); } return dd; }))],
  }),
  defineNative({
    id: "sharpe", name: "Rolling Sharpe Ratio", category: "Statistics", pane: "separate", source: true, params: [len("length", 252, "Length", 3, 5000), rf, periods], levels: [0],
    description: "Annualised mean excess return per unit of volatility.", outputs: [line("sharpe", "Sharpe", "#22c55e")],
    meta: { formula: "S = mean(r − rf/P)/sd(r)·√P (sample sd, n − 1).", conventions: ANN },
    build: (p, x) => {
      const P = Number(p.periods), rfp = Number(p.rf) / 100 / P;
      return [out("sharpe", rolling(`sharpe:${P}:${rfp}`, [ret(x)], Number(p.length), (g, n) => { let m = 0; for (let k = 0; k < n; k++) m += g(0, k); m /= n; let v = 0; for (let k = 0; k < n; k++) v += (g(0, k) - m) ** 2; const sd = Math.sqrt(v / (n - 1)); return sd === 0 ? NaN : ((m - rfp) / sd) * Math.sqrt(P); }))];
    },
  }),
  defineNative({
    id: "sortino", name: "Rolling Sortino Ratio", category: "Statistics", pane: "separate", source: true, params: [len("length", 252, "Length", 3, 5000), rf, periods], levels: [0],
    description: "Annualised mean excess return per unit of downside deviation.", outputs: [line("sortino", "Sortino", "#22c55e")],
    meta: { formula: "So = mean(r − rf/P)/DD·√P, DD = √(Σ min(r − rf/P, 0)²/n).", conventions: ANN },
    build: (p, x) => {
      const P = Number(p.periods), rfp = Number(p.rf) / 100 / P;
      return [out("sortino", rolling(`sortino:${P}:${rfp}`, [ret(x)], Number(p.length), (g, n) => { let m = 0, d = 0; for (let k = 0; k < n; k++) { const e = g(0, k) - rfp; m += e; d += Math.min(e, 0) ** 2; } const dd = Math.sqrt(d / n); return dd === 0 ? NaN : (m / n / dd) * Math.sqrt(P); }))];
    },
  }),
  defineNative({
    id: "hurst", name: "Rolling Hurst Exponent", category: "Statistics", pane: "separate", source: true, params: [len("length", 128, "Length", 32, 2000)], range: [0, 1], levels: [0.5],
    description: "Rescaled-range estimate of persistence of log returns.", outputs: [line("h", "Hurst", "#a78bfa")],
    meta: { formula: "For chunk sizes s = 8, 16, 32, … ≤ n/2: average R/S over non-overlapping chunks of the window's log returns; H = slope of log(R/S) on log(s).", limitations: "Classic R/S without small-sample (Anis-Lloyd) correction; noisy for short windows." },
    build: (p, x) => [out("h", rolling("hurst", [map("logret", [x, lag(x, 1)], ([a, b]) => Math.log(a / b))], Number(p.length), (g, n) => {
      const r = Array.from({ length: n }, (_, k) => g(0, n - 1 - k));
      const xs: number[] = [], ys: number[] = [];
      for (let s = 8; s <= n / 2; s *= 2) {
        let acc = 0, cnt = 0;
        for (let st = 0; st + s <= n; st += s) {
          let m = 0;
          for (let k = st; k < st + s; k++) m += r[k];
          m /= s;
          let cum = 0, mx = -Infinity, mn = Infinity, sd = 0;
          for (let k = st; k < st + s; k++) { cum += r[k] - m; mx = Math.max(mx, cum); mn = Math.min(mn, cum); sd += (r[k] - m) ** 2; }
          sd = Math.sqrt(sd / s);
          if (sd > 0) { acc += (mx - mn) / sd; cnt++; }
        }
        if (cnt) { xs.push(Math.log(s)); ys.push(Math.log(acc / cnt)); }
      }
      if (xs.length < 2) return NaN;
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, den = 0;
      xs.forEach((v, i) => { num += (v - mx) * (ys[i] - my); den += (v - mx) ** 2; });
      return num / den;
    }))],
  }),
  defineNative({
    id: "autocorr", name: "Rolling Autocorrelation", category: "Statistics", pane: "separate", source: true, params: [len("length", 30, "Length", 4), len("lag", 1, "Lag", 1, 100)], range: [-1, 1], levels: [0],
    description: "Correlation of returns with their own lagged values.", outputs: [line("ac", "Autocorr", "#38bdf8")],
    meta: { formula: "Pearson correlation of (r_t, r_{t−L}) over the last n pairs of returns.", conventions: ANN },
    build: (p, x) => { const r = ret(x); return [out("ac", rolling("autocorr", [r, lag(r, Number(p.lag))], Number(p.length), (g, n) => { const s = pairStats(g, n); return s.va === 0 || s.vb === 0 ? NaN : s.cov / Math.sqrt(s.va * s.vb); }))]; },
  }),
  defineNative({
    id: "er", name: "Efficiency Ratio", category: "Statistics", pane: "separate", source: true, params: [len("length", 10)], range: [0, 1],
    description: "Kaufman's net change over total path length.", outputs: [line("er", "ER", "#f59e0b")],
    meta: { formula: "ER = |x − x[n]| / Σ|x_k − x_{k−1}| over n changes (0 when there is no movement)." },
    build: (p, x) => [out("er", K.rolling("er", [x], Number(p.length) + 1, (g, m) => { let v = 0; for (let k = 0; k < m - 1; k++) v += Math.abs(g(0, k) - g(0, k + 1)); return v === 0 ? 0 : Math.abs(g(0, 0) - g(0, m - 1)) / v; }))],
  }),
  defineNative({
    id: "meandev", name: "Mean Absolute Deviation", category: "Statistics", pane: "separate", source: true, params: [len("length", 20)],
    description: "Average absolute distance from the rolling mean.", outputs: [line("mad", "MAD", "#94a3b8")],
    meta: { formula: "MAD = Σ|x − mean|/n." },
    build: (p, x) => [out("mad", rolling("mad", [x], Number(p.length), (g, n) => { const m = moments(g, n).mean; let s = 0; for (let k = 0; k < n; k++) s += Math.abs(g(0, k) - m); return s / n; }))],
  }),
];

// ---------- market structure ----------
const periodParam = sel("period", "day", "Period (IST)", ["day", "week", "month"]);
type Prev = { key: string; cur: { o: number; h: number; l: number; c: number } | null; prev: { o: number; h: number; l: number; c: number } | null };
/** Previous completed period's OHLC (IST calendar). Multi-output via aux encoding is avoided: one node per field. */
const prevField = (period: string, f: "o" | "h" | "l" | "c") => reducer(`prevPeriod:${period}:${f}`, [], (): Prev => ({ key: "", cur: null, prev: null }), (st, _i, r) => {
  const k = K.periodKey(r.t, period as "day");
  if (k !== st.key) {
    if (st.cur) st.prev = st.cur;
    st.cur = { o: r.o, h: r.h, l: r.l, c: r.c };
    st.key = k;
  } else if (st.cur) {
    st.cur.h = Math.max(st.cur.h, r.h);
    st.cur.l = Math.min(st.cur.l, r.l);
    st.cur.c = r.c;
  }
  return st.prev ? st.prev[f] : NaN;
}, (st) => ({ key: st.key, cur: st.cur && { ...st.cur }, prev: st.prev && { ...st.prev } }));
const pivotMeta = { missing: "Uses the previous COMPLETED period (IST calendar day/week/month); NaN until one period has finished.", conventions: "Periods follow the India Standard Time calendar, matching the VWAP anchors." };
const pivotOutputs = (keys: string[]) => keys.map((k, i) => line(k, k.toUpperCase(), k.startsWith("r") ? "#ef4444" : k.startsWith("s") ? "#22c55e" : "#f59e0b", { width: i === 0 ? 1.5 : 1 }));
function pivots(id: string, name: string, formula: string, keys: string[], f: (o: number, h: number, l: number, c: number) => number[]) {
  return defineNative({
    id, name, category: "Structure", pane: "overlay", params: [periodParam], requires: ["time"], description: `${name} from the previous period's prices.`, outputs: pivotOutputs(keys),
    meta: { formula, ...pivotMeta },
    build: (p) => {
      const P = String(p.period), deps = (["o", "h", "l", "c"] as const).map((k) => prevField(P, k));
      return keys.map((k, i) => out(k, map(`${id}:${i}`, deps, ([o, h, l, c]) => f(o, h, l, c)[i])));
    },
  });
}

export const STRUCTURE = [
  pivots("pivots", "Standard Pivot Points", "P = (H+L+C)/3; R1 = 2P − L; S1 = 2P − H; R2 = P + (H − L); S2 = P − (H − L); R3 = H + 2(P − L); S3 = L − 2(H − P).", ["p", "r1", "s1", "r2", "s2", "r3", "s3"], (_o, h, l, c) => { const P = (h + l + c) / 3; return [P, 2 * P - l, 2 * P - h, P + (h - l), P - (h - l), h + 2 * (P - l), l - 2 * (h - P)]; }),
  pivots("fibpivots", "Fibonacci Pivot Points", "P = (H+L+C)/3; R/Sₖ = P ± {0.382, 0.618, 1}·(H − L).", ["p", "r1", "s1", "r2", "s2", "r3", "s3"], (_o, h, l, c) => { const P = (h + l + c) / 3, R = h - l; return [P, P + 0.382 * R, P - 0.382 * R, P + 0.618 * R, P - 0.618 * R, P + R, P - R]; }),
  pivots("camarilla", "Camarilla Pivot Points", "R/Sₖ = C ± 1.1·(H − L)/{12, 6, 4, 2}; P = (H+L+C)/3.", ["p", "r1", "s1", "r2", "s2", "r3", "s3", "r4", "s4"], (_o, h, l, c) => { const R = h - l; return [(h + l + c) / 3, c + (1.1 * R) / 12, c - (1.1 * R) / 12, c + (1.1 * R) / 6, c - (1.1 * R) / 6, c + (1.1 * R) / 4, c - (1.1 * R) / 4, c + (1.1 * R) / 2, c - (1.1 * R) / 2]; }),
  pivots("woodie", "Woodie Pivot Points", "P = (H + L + 2C)/4; R1 = 2P − L; S1 = 2P − H; R2 = P + (H − L); S2 = P − (H − L).", ["p", "r1", "s1", "r2", "s2"], (_o, h, l, c) => { const P = (h + l + 2 * c) / 4; return [P, 2 * P - l, 2 * P - h, P + (h - l), P - (h - l)]; }),
  pivots("demark", "DeMark Pivot Points", "X = 2H + L + C if C > O; H + 2L + C if C < O; H + L + 2C otherwise; P = X/4; R1 = X/2 − L; S1 = X/2 − H.", ["p", "r1", "s1"], (o, h, l, c) => { const X = c > o ? 2 * h + l + c : c < o ? h + 2 * l + c : h + l + 2 * c; return [X / 4, X / 2 - l, X / 2 - h]; }),
  pivots("cpr", "Central Pivot Range", "Pivot = (H+L+C)/3; BC = (H+L)/2; TC = 2·Pivot − BC.", ["pivot", "bc", "tc"], (_o, h, l, c) => { const P = (h + l + c) / 3, bc = (h + l) / 2; return [P, bc, 2 * P - bc]; }),
  pivots("prevhl", "Previous Period High/Low", "Previous completed period's high, low and close.", ["high", "low", "close"], (_o, h, l, c) => [h, l, c]),
  defineNative({
    id: "highesthigh", name: "Highest High", category: "Structure", pane: "overlay", params: [len("length", 20)],
    description: "Highest high of the last n bars (including the current bar).", outputs: [line("hh", "HH", "#22c55e")],
    meta: { formula: "HH = max(H, n)." },
    build: (p) => [out("hh", highest(hi, Number(p.length)))],
  }),
  defineNative({
    id: "lowestlow", name: "Lowest Low", category: "Structure", pane: "overlay", params: [len("length", 20)],
    description: "Lowest low of the last n bars (including the current bar).", outputs: [line("ll", "LL", "#ef4444")],
    meta: { formula: "LL = min(L, n)." },
    build: (p) => [out("ll", lowest(lo, Number(p.length)))],
  }),
  defineNative({
    id: "pricechannel", name: "Price Channel", category: "Structure", pane: "overlay", params: [len("length", 20)],
    description: "Highest high / lowest low of the PREVIOUS n bars (breakout channel).", outputs: [line("upper", "Upper", "#22c55e"), line("lower", "Lower", "#ef4444")],
    meta: { formula: "Upper = max(H[1…n]); Lower = min(L[1…n]) — the current bar is excluded so a breakout can be seen." },
    build: (p) => { const n = Number(p.length); return [out("upper", lag(highest(hi, n), 1)), out("lower", lag(lowest(lo, n), 1))]; },
  }),
  defineNative({
    id: "fractals", name: "Fractal Highs and Lows", category: "Structure", pane: "overlay", params: [len("bars", 2, "Bars each side", 1, 20)],
    description: "Williams fractals, plotted on the bar that CONFIRMS them (n bars later).", outputs: [{ key: "up", label: "Fractal high", type: "dots", color: "#22c55e" }, { key: "down", label: "Fractal low", type: "dots", color: "#ef4444" }],
    meta: { formula: "A high H[n] strictly greater than the n highs on each side is a fractal high; shown at the current bar with value H[n]. Lows likewise.", repaint: "Never repaints: a fractal appears only once the n bars after it exist, on the confirming bar." },
    build: (p) => {
      const n = Number(p.bars);
      const f = (x: K.NodeDef, max: boolean) => rolling(`fractal:${max}`, [x], 2 * n + 1, (g) => { const c = g(0, n); for (let k = 0; k <= 2 * n; k++) if (k !== n && (max ? g(0, k) >= c : g(0, k) <= c)) return NaN; return c; });
      return [out("up", f(hi, true)), out("down", f(lo, false))];
    },
  }),
  defineNative({
    id: "swings", name: "Swing Highs and Lows", category: "Structure", pane: "overlay", params: [len("left", 5, "Left bars", 1, 50), len("right", 5, "Right bars", 1, 50)],
    description: "Pivot highs/lows with separate left/right strength; the last confirmed level is carried.", outputs: [line("high", "Swing high", "#22c55e"), line("low", "Swing low", "#ef4444")],
    meta: { formula: "A bar is a swing high when its high exceeds the `left` highs before and the `right` highs after it; the level is carried forward from the confirming bar.", repaint: "Never repaints: levels change only on the bar that confirms a new swing (`right` bars later)." },
    build: (p) => {
      const L = Number(p.left), R = Number(p.right);
      const piv = (x: K.NodeDef, max: boolean) => rolling(`swing:${max}:${L}`, [x], L + R + 1, (g) => { const c = g(0, R); for (let k = 0; k <= L + R; k++) if (k !== R && (max ? g(0, k) >= c : g(0, k) <= c)) return NaN; return c; });
      const carry = (x: K.NodeDef, id: string) => reducer(`carry:${id}`, [x], () => ({ v: NaN }), (st, _i, _r, [v]) => (Number.isNaN(v) ? st.v : (st.v = v)), (st) => ({ ...st }));
      return [out("high", carry(piv(hi, true), "h")), out("low", carry(piv(lo, false), "l"))];
    },
  }),
  defineNative({
    id: "zigzag", name: "Zig Zag", category: "Structure", pane: "overlay", params: [num("deviation", 5, "Deviation %", 0.01, 100, 0.1)],
    description: "Swings of at least the given percentage, as non-repainting levels.", outputs: [line("confirmed", "Last confirmed swing", "#f59e0b", { width: 2 }), { key: "provisional", label: "Provisional extreme", type: "dots", color: "#94a3b8" }],
    meta: {
      formula: "Tracks the running extreme of the current leg; a swing is confirmed when price reverses by the deviation % from that extreme.",
      repaint: "The classic Zig Zag repaints its last leg. Here `confirmed` only changes when a swing is confirmed (never rewritten) and `provisional` shows the current leg's extreme, which may still move.",
      conventions: "Uses highs for up-legs and lows for down-legs; the first leg direction is set by the first deviation-sized move from the first close.",
    },
    build: (p) => {
      const dev = Number(p.deviation) / 100;
      const zz = reducer(`zigzag:${dev}`, [], () => ({ dir: 0, ext: NaN, base: NaN, conf: NaN }), (st, _i, r) => {
        if (Number.isNaN(st.base)) { st.base = r.c; return st.conf; }
        if (st.dir === 0) {
          if (r.h >= st.base * (1 + dev)) { st.dir = 1; st.ext = r.h; st.conf = st.base; }
          else if (r.l <= st.base * (1 - dev)) { st.dir = -1; st.ext = r.l; st.conf = st.base; }
          return st.conf;
        }
        if (st.dir === 1) {
          if (r.h > st.ext) st.ext = r.h;
          else if (r.l <= st.ext * (1 - dev)) { st.conf = st.ext; st.dir = -1; st.ext = r.l; }
        } else {
          if (r.l < st.ext) st.ext = r.l;
          else if (r.h >= st.ext * (1 + dev)) { st.conf = st.ext; st.dir = 1; st.ext = r.h; }
        }
        return st.conf;
      }, (st) => ({ ...st }));
      return [out("confirmed", zz), out("provisional", reducer(`zigzagExt:${dev}`, [zz], () => ({ dir: 0, ext: NaN, base: NaN }), (st, _i, r) => {
        // Mirrors the leg extreme of the main node (kept separately so both outputs are plain values).
        if (Number.isNaN(st.base)) { st.base = r.c; return NaN; }
        if (st.dir === 0) {
          if (r.h >= st.base * (1 + dev)) { st.dir = 1; st.ext = r.h; } else if (r.l <= st.base * (1 - dev)) { st.dir = -1; st.ext = r.l; }
          return st.ext;
        }
        if (st.dir === 1) { if (r.h > st.ext) st.ext = r.h; else if (r.l <= st.ext * (1 - dev)) { st.dir = -1; st.ext = r.l; } }
        else { if (r.l < st.ext) st.ext = r.l; else if (r.h >= st.ext * (1 + dev)) { st.dir = 1; st.ext = r.h; } }
        return st.ext;
      }, (st) => ({ ...st })))];
    },
  }),
  defineNative({
    id: "openingrange", name: "Opening Range", category: "Structure", pane: "overlay", requires: ["time"], params: [len("minutes", 15, "Minutes", 1, 600)],
    description: "High/low of the first N minutes of each IST session (intraday data).", outputs: [line("high", "OR high", "#22c55e"), line("low", "OR low", "#ef4444")],
    meta: { formula: "From the session's first bar until first-bar time + N minutes: running high/low (provisional while the range is forming); afterwards the final range is carried for the rest of the session.", missing: "On daily or longer bars every bar is its own session, so the range equals the bar's own high/low.", repaint: "Values during the first N minutes are provisional (the range is still forming); they never change once the window has passed." },
    build: (p) => {
      const span = Number(p.minutes) * 60;
      const node = (f: "h" | "l") => reducer(`orange:${span}:${f}`, [], () => ({ key: "", start: 0, h: NaN, l: NaN }), (st, _i, r) => {
        const k = K.periodKey(r.t, "day");
        if (k !== st.key) { st.key = k; st.start = r.t; st.h = r.h; st.l = r.l; }
        else if (r.t < st.start + span) { st.h = Math.max(st.h, r.h); st.l = Math.min(st.l, r.l); }
        return f === "h" ? st.h : st.l;
      }, (st) => ({ ...st }));
      return [out("high", node("h")), out("low", node("l"))];
    },
  }),
];
void op; void cl;
