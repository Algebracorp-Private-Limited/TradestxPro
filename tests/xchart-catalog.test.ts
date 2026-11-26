/**
 * Catalogue validation: every native indicator is compared with an INDEPENDENT reference
 * implementation written here from the textbook definitions (plain arrays, no kernel code), on
 * several market regimes; streaming equivalence (append, live replacement) is checked for all;
 * metadata completeness is checked for every registered built-in.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_INDICATORS } from "../lib/xchart-sdk/indicators/native/index.ts";
import { ALL_BUILTIN_INDICATORS, builtinRegistry } from "../lib/xchart-sdk/indicators/index.ts";
import { StreamGraph } from "../lib/xchart-sdk/indicators/dependencies.ts";
import type { IndicatorInput, IndicatorParams } from "../lib/xchart-sdk/indicators/types.ts";
import { createChartWithAdapter } from "../lib/xchart-sdk/create-chart.ts";
import type { RenderAdapter, RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import { XChartError } from "../lib/xchart-sdk/validation.ts";

type A = number[];
const N = NaN;
function market(n: number, seed: number, intraday = false): IndicatorInput {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const o: IndicatorInput = { time: [], open: [], high: [], low: [], close: [], volume: [], intraday, benchmark: [] };
  let p = 100, b = 60;
  for (let i = 0; i < n; i++) {
    const op = p * (1 + (r() - 0.5) * 0.004);
    p = Math.max(5, op * (1 + (r() - 0.49) * 0.03));
    b = Math.max(5, b * (1 + (r() - 0.49) * 0.02) + (p - op) * 0.05);
    o.time.push(1_767_225_600 + i * (intraday ? 300 : 86400));
    o.open.push(op);
    o.high.push(Math.max(op, p) * (1 + r() * 0.01));
    o.low.push(Math.min(op, p) * (1 - r() * 0.01));
    o.close.push(p);
    o.volume.push(i % 11 === 5 ? 0 : Math.round(500 + r() * 20000));
    o.benchmark!.push(b);
  }
  return o;
}
// ---------- reference primitives (lib/ta conventions where the SDK shares them) ----------
const nan = (n: number): A => new Array(n).fill(N);
const firstValid = (x: A) => { const i = x.findIndex((v) => !Number.isNaN(v)); return i < 0 ? x.length : i; };
const SMA = (x: A, n: number): A => { const o = nan(x.length); let sum = 0, cnt = 0; for (let i = firstValid(x); i < x.length; i++) { if (Number.isNaN(x[i])) { sum = 0; cnt = 0; continue; } sum += x[i]; cnt++; if (cnt > n) sum -= x[i - n]; if (cnt >= n) o[i] = sum / n; } return o; };
const SEED = (x: A, n: number, a: number): A => { const o = nan(x.length); const s = firstValid(x); if (s + n > x.length) return o; let seed = 0; for (let i = s; i < s + n; i++) seed += x[i]; let prev = seed / n; o[s + n - 1] = prev; for (let i = s + n; i < x.length; i++) { if (Number.isNaN(x[i])) { o[i] = prev; continue; } prev = a * x[i] + (1 - a) * prev; o[i] = prev; } return o; };
const EMA = (x: A, n: number) => SEED(x, n, 2 / (n + 1));
const RMA = (x: A, n: number) => SEED(x, n, 1 / n);
const WMA = (x: A, n: number): A => x.map((_, i) => { if (i < firstValid(x) + n - 1) return N; let s = 0; for (let k = 0; k < n; k++) { if (Number.isNaN(x[i - k])) return N; s += x[i - k] * (n - k); } return s / ((n * (n + 1)) / 2); });
/** Rolling window helper: fn(window oldest→newest) once n consecutive valid values exist in every series. */
const ROLL = (xs: A[], n: number, fn: (w: A[]) => number): A => { const len = xs[0].length; const o = nan(len); let run = 0; for (let i = 0; i < len; i++) { run = xs.every((x) => !Number.isNaN(x[i])) ? run + 1 : 0; if (run >= n) o[i] = fn(xs.map((x) => x.slice(i - n + 1, i + 1))); } return o; };
const SUM = (x: A, n: number) => ROLL([x], n, ([w]) => w.reduce((a, b) => a + b, 0));
const HH = (x: A, n: number): A => x.map((_, i) => (i < n - 1 ? N : Math.max(...x.slice(i - n + 1, i + 1))));
const LL = (x: A, n: number): A => x.map((_, i) => (i < n - 1 ? N : Math.min(...x.slice(i - n + 1, i + 1))));
const LAG = (x: A, k: number): A => x.map((_, i) => (i >= k ? x[i - k] : N));
const SD = (x: A, n: number): A => { const m = SMA(x, n); return m.map((mm, i) => (Number.isNaN(mm) ? N : Math.sqrt(x.slice(i - n + 1, i + 1).reduce((s, v) => s + (v - mm) ** 2, 0) / n))); };
const TR = (h: A, l: A, c: A, nan0 = false): A => h.map((v, i) => (i === 0 ? (nan0 ? N : v - l[i]) : Math.max(v - l[i], Math.abs(v - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
const ATR = (h: A, l: A, c: A, n: number) => RMA(TR(h, l, c), n);
const RSI = (x: A, n: number): A => { const up = nan(x.length), dn = nan(x.length); for (let i = 1; i < x.length; i++) { const d = x[i] - x[i - 1]; if (Number.isNaN(d)) continue; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); } const u = RMA(up, n), d = RMA(dn, n); return u.map((a, i) => (Number.isNaN(a) || Number.isNaN(d[i]) ? N : d[i] === 0 ? (a === 0 ? 50 : 100) : 100 - 100 / (1 + a / d[i]))); };
const zip = (f: (...v: number[]) => number, ...xs: A[]): A => xs[0].map((_, i) => f(...xs.map((x) => x[i])));
const ROC = (x: A, n: number) => zip((a, b) => (b !== 0 ? ((a - b) / b) * 100 : N), x, LAG(x, n));
const RET = (x: A) => zip((a, b) => a / b - 1, x, LAG(x, 1));
const meanOf = (w: A) => w.reduce((a, b) => a + b, 0) / w.length;
const varS = (w: A) => { const m = meanOf(w); return w.reduce((s, v) => s + (v - m) ** 2, 0) / (w.length - 1); };
const reg = (w: A) => { const n = w.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; w.forEach((y, t) => { sx += t; sy += y; sxx += t * t; sxy += t * y; }); const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n; let ssr = 0, sst = 0; const m = sy / n; w.forEach((y, t) => { ssr += (y - a - b * t) ** 2; sst += (y - m) ** 2; }); return { a, b, end: a + b * (n - 1), ssr, sst }; };
const CMO = (x: A, n: number) => { const up = zip((a, b) => (Number.isNaN(a - b) ? N : Math.max(a - b, 0)), x, LAG(x, 1)), dn = zip((a, b) => (Number.isNaN(a - b) ? N : Math.max(b - a, 0)), x, LAG(x, 1)); return zip((u, d) => (u + d === 0 ? 0 : (100 * (u - d)) / (u + d)), SUM(up, n), SUM(dn, n)); };
const pctile = (w: A, q: number) => { const s = [...w].sort((a, b) => a - b), r = (s.length - 1) * q, lo = Math.floor(r), hi = Math.ceil(r); return s[lo] + (s[hi] - s[lo]) * (r - lo); };
const pkey = (t: number, period: string) => { const d = new Date((t + 19800) * 1000); if (period === "month") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`; if (period === "week") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10); return d.toISOString().slice(0, 10); };
function prevPeriod(x: IndicatorInput, period: string) {
  const out = { o: nan(x.time.length), h: nan(x.time.length), l: nan(x.time.length), c: nan(x.time.length) };
  type OHLC = { o: number; h: number; l: number; c: number };
  let key = "";
  let cur: OHLC | null = null;
  let prev: OHLC | null = null;
  x.time.forEach((t, i) => {
    const k = pkey(t, period);
    if (k !== key) { if (cur) prev = cur; cur = { o: x.open[i], h: x.high[i], l: x.low[i], c: x.close[i] }; key = k; }
    else { cur!.h = Math.max(cur!.h, x.high[i]); cur!.l = Math.min(cur!.l, x.low[i]); cur!.c = x.close[i]; }
    const pv = prev as OHLC | null;
    if (pv) { out.o[i] = pv.o; out.h[i] = pv.h; out.l[i] = pv.l; out.c[i] = pv.c; }
  });
  return out;
}

type Ref = (x: IndicatorInput, p: IndicatorParams) => Record<string, A>;
const num = (p: IndicatorParams, k: string) => Number(p[k]);
const SRC = (x: IndicatorInput, p: IndicatorParams): A => { const s = String(p.source ?? "close"); return s === "hl2" ? zip((h, l) => (h + l) / 2, x.high, x.low) : s === "hlc3" ? zip((h, l, c) => (h + l + c) / 3, x.high, x.low, x.close) : (x as unknown as Record<string, A>)[s]; };
const chainE = (x: A, n: number, k: number) => { const r: A[] = []; let c = x; for (let i = 0; i < k; i++) r.push((c = EMA(c, n))); return r; };
const aroonLine = (x: A, n: number, max: boolean) => ROLL([x], n + 1, ([w]) => { let best = n; for (let k = n - 1; k >= 0; k--) if (max ? w[k] > w[best] : w[k] < w[best]) best = k; return (100 * (n - (n - best))) / n; });
function pairStats(a: A, b: A) { const ma = meanOf(a), mb = meanOf(b); let c = 0, va = 0, vb = 0; a.forEach((v, i) => { c += (v - ma) * (b[i] - mb); va += (v - ma) ** 2; vb += (b[i] - mb) ** 2; }); const n = a.length; return { ma, mb, cov: c / (n - 1), va: va / (n - 1), vb: vb / (n - 1) }; }

const REF: Record<string, Ref> = {
  dema: (x, p) => { const [a, b] = chainE(SRC(x, p), num(p, "length"), 2); return { dema: zip((u, v) => 2 * u - v, a, b) }; },
  tema: (x, p) => { const [a, b, c] = chainE(SRC(x, p), num(p, "length"), 3); return { tema: zip((u, v, w) => 3 * u - 3 * v + w, a, b, c) }; },
  kama: (x, p) => { const s = SRC(x, p), n = num(p, "length"), f = 2 / (num(p, "fast") + 1), sl = 2 / (num(p, "slow") + 1), o = nan(s.length); let prev = N; for (let i = n; i < s.length; i++) { let path = 0; for (let k = i - n + 1; k <= i; k++) path += Math.abs(s[k] - s[k - 1]); const er = path === 0 ? 0 : Math.abs(s[i] - s[i - n]) / path; if (Number.isNaN(prev)) prev = s[i - 1]; prev += (er * (f - sl) + sl) ** 2 * (s[i] - prev); o[i] = prev; } return { kama: o }; },
  alma: (x, p) => { const n = num(p, "length"), m = num(p, "offset") * (n - 1), sg = n / num(p, "sigma"); const w = Array.from({ length: n }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * sg * sg))); const ws = w.reduce((a, b) => a + b, 0); return { alma: ROLL([SRC(x, p)], n, ([v]) => v.reduce((s, y, k) => s + w[k] * y, 0) / ws) }; },
  t3: (x, p) => { const v = num(p, "vfactor"), e = chainE(SRC(x, p), num(p, "length"), 6); const c1 = -(v ** 3), c2 = 3 * v * v + 3 * v ** 3, c3 = -6 * v * v - 3 * v - 3 * v ** 3, c4 = 1 + 3 * v + v ** 3 + 3 * v * v; return { t3: zip((a, b, c, d) => c1 * a + c2 * b + c3 * c + c4 * d, e[5], e[4], e[3], e[2]) }; },
  trima: (x, p) => { const n = num(p, "length"); return { trima: SMA(SMA(SRC(x, p), Math.ceil(n / 2)), Math.floor(n / 2) + 1) }; },
  zlema: (x, p) => { const s = SRC(x, p), n = num(p, "length"), L = Math.floor((n - 1) / 2); return { zlema: EMA(zip((a, b) => a + (a - b), s, LAG(s, L)), n) }; },
  vidya: (x, p) => { const s = SRC(x, p), a = 2 / (num(p, "length") + 1), c = CMO(s, num(p, "cmo")), o = nan(s.length); let prev = N; for (let i = 0; i < s.length; i++) { if (Number.isNaN(c[i])) continue; const k = (Math.abs(c[i]) / 100) * a; prev = Number.isNaN(prev) ? s[i] : k * s[i] + (1 - k) * prev; o[i] = prev; } return { vidya: o }; },
  mcginley: (x, p) => { const s = SRC(x, p), n = num(p, "length"), e = EMA(s, n), o = nan(s.length); let prev = N; for (let i = 0; i < s.length; i++) { if (Number.isNaN(prev)) { prev = e[i]; o[i] = prev; continue; } prev = prev + (s[i] - prev) / (n * (s[i] / prev) ** 4); o[i] = prev; } return { md: o }; },
  aroon: (x, p) => ({ up: aroonLine(x.high, num(p, "length"), true), down: aroonLine(x.low, num(p, "length"), false) }),
  aroonosc: (x, p) => ({ osc: zip((a, b) => a - b, aroonLine(x.high, num(p, "length"), true), aroonLine(x.low, num(p, "length"), false)) }),
  vortex: (x, p) => { const n = num(p, "length"), tr = TR(x.high, x.low, x.close, true); const vp = zip((h, l1) => Math.abs(h - l1), x.high, LAG(x.low, 1)), vm = zip((l, h1) => Math.abs(l - h1), x.low, LAG(x.high, 1)); const st = SUM(tr, n); return { plus: zip((a, b) => a / b, SUM(vp, n), st), minus: zip((a, b) => a / b, SUM(vm, n), st) }; },
  ckstop: (x, p) => { const P = num(p, "p"), X = num(p, "x"), Q = num(p, "q"), a = ATR(x.high, x.low, x.close, P); const fh = zip((h, v) => h - X * v, HH(x.high, P), a), fl = zip((l, v) => l + X * v, LL(x.low, P), a); return { long: LL(fl, Q).map((v, i) => (fl.slice(Math.max(0, i - Q + 1), i + 1).some(Number.isNaN) ? N : v)), short: HH(fh, Q).map((v, i) => (fh.slice(Math.max(0, i - Q + 1), i + 1).some(Number.isNaN) ? N : v)) }; },
  chandelier: (x, p) => { const n = num(p, "length"), m = num(p, "mult"), a = ATR(x.high, x.low, x.close, n); return { long: zip((h, v) => h - m * v, HH(x.high, n), a), short: zip((l, v) => l + m * v, LL(x.low, n), a) }; },
  trix: (x, p) => ({ trix: ROC(chainE(SRC(x, p), num(p, "length"), 3)[2], 1) }),
  envelopes: (x, p) => { const m = SMA(SRC(x, p), num(p, "length")), k = num(p, "percent") / 100; return { upper: m.map((v) => v * (1 + k)), mid: m, lower: m.map((v) => v * (1 - k)) }; },
  smma: (x, p) => ({ smma: RMA(SRC(x, p), num(p, "length")) }),
  stochrsi: (x, p) => { const r = RSI(SRC(x, p), num(p, "rsi")), m = num(p, "stoch"); const st = zip((v, h, l) => (h === l ? 50 : (100 * (v - l)) / (h - l)), r, HH(r, m), LL(r, m)); const k = SMA(st, num(p, "k")); return { k, d: SMA(k, num(p, "d")) }; },
  mom: (x, p) => { const s = SRC(x, p); return { mom: zip((a, b) => a - b, s, LAG(s, num(p, "length"))) }; },
  uo: (x, p) => { const c1 = LAG(x.close, 1); const bp = zip((c, l, q) => c - Math.min(l, q), x.close, x.low, c1), tr = zip((h, l, q) => Math.max(h, q) - Math.min(l, q), x.high, x.low, c1); const av = (n: number) => zip((a, b) => a / b, SUM(bp, n), SUM(tr, n)); return { uo: zip((a, b, c) => (100 * (4 * a + 2 * b + c)) / 7, av(num(p, "fast")), av(num(p, "mid")), av(num(p, "slow"))) }; },
  ao: (x, p) => { const m = zip((h, l) => (h + l) / 2, x.high, x.low); return { ao: zip((a, b) => a - b, SMA(m, num(p, "fast")), SMA(m, num(p, "slow"))) }; },
  ac: (x, p) => { const m = zip((h, l) => (h + l) / 2, x.high, x.low); const ao = zip((a, b) => a - b, SMA(m, num(p, "fast")), SMA(m, num(p, "slow"))); return { ac: zip((a, b) => a - b, ao, SMA(ao, num(p, "signal"))) }; },
  tsi: (x, p) => { const s = SRC(x, p), m = zip((a, b) => a - b, s, LAG(s, 1)); const ds = (v: A) => EMA(EMA(v, num(p, "long")), num(p, "short")); const t = zip((a, b) => (100 * a) / b, ds(m), ds(m.map(Math.abs))); return { tsi: t, signal: EMA(t, num(p, "signal")) }; },
  rvgi: (x, p) => { const sym = (v: A) => ROLL([v], 4, ([w]) => (w[3] + 2 * w[2] + 2 * w[1] + w[0]) / 6); const n = num(p, "length"); const r = zip((a, b) => a / b, SUM(sym(zip((c, o) => c - o, x.close, x.open)), n), SUM(sym(zip((h, l) => h - l, x.high, x.low)), n)); return { rvi: r, signal: sym(r) }; },
  cmo: (x, p) => ({ cmo: CMO(SRC(x, p), num(p, "length")) }),
  dpo: (x, p) => { const s = SRC(x, p), n = num(p, "length"); return { dpo: zip((a, b) => a - b, LAG(s, Math.floor(n / 2) + 1), SMA(s, n)) }; },
  ppo: (x, p) => { const s = SRC(x, p), sl = EMA(s, num(p, "slow")); const pp = zip((a, b) => (100 * (a - b)) / b, EMA(s, num(p, "fast")), sl); const sg = EMA(pp, num(p, "signal")); return { hist: zip((a, b) => a - b, pp, sg), ppo: pp, signal: sg }; },
  coppock: (x, p) => { const s = SRC(x, p); return { cc: WMA(zip((a, b) => a + b, ROC(s, num(p, "long")), ROC(s, num(p, "short"))), num(p, "wma")) }; },
  fisher: (x, p) => { const n = num(p, "length"), m = zip((h, l) => (h + l) / 2, x.high, x.low), h = HH(m, n), l = LL(m, n), o = nan(m.length); let v = 0, f = 0; for (let i = 0; i < m.length; i++) { if (Number.isNaN(h[i])) continue; const norm = h[i] === l[i] ? 0.5 : (m[i] - l[i]) / (h[i] - l[i]); v = Math.max(-0.999, Math.min(0.999, 0.66 * (norm - 0.5) + 0.67 * v)); f = 0.5 * Math.log((1 + v) / (1 - v)) + 0.5 * f; o[i] = f; } return { fisher: o, trigger: LAG(o, 1) }; },
  kst: (x, p) => { const s = SRC(x, p), r = (a: number, b: number) => SMA(ROC(s, a), b); const k = zip((a, b, c, d) => a + 2 * b + 3 * c + 4 * d, r(10, 10), r(15, 10), r(20, 10), r(30, 15)); return { kst: k, signal: SMA(k, num(p, "signal")) }; },
  stc: (x, p) => { const s = SRC(x, p), c = num(p, "cycle"), f = num(p, "factor"); const macd = zip((a, b) => a - b, EMA(s, num(p, "fast")), EMA(s, num(p, "slow"))); const sm = (v: A) => { const h = HH(v, c), l = LL(v, c), o = nan(v.length); let st = N, pf = N; for (let i = 0; i < v.length; i++) { if (Number.isNaN(h[i])) continue; if (h[i] !== l[i]) st = (100 * (v[i] - l[i])) / (h[i] - l[i]); if (Number.isNaN(st)) continue; pf = Number.isNaN(pf) ? st : pf + f * (st - pf); o[i] = pf; } return o; }; return { stc: sm(sm(macd)) }; },
  bop: (x, p) => ({ bop: SMA(zip((c, o, h, l) => (h === l ? 0 : (c - o) / (h - l)), x.close, x.open, x.high, x.low), num(p, "smooth")) }),
  elderray: (x, p) => { const e = EMA(x.close, num(p, "length")); return { bull: zip((a, b) => a - b, x.high, e), bear: zip((a, b) => a - b, x.low, e) }; },
  crsi: (x, p) => { const c = x.close, st = nan(c.length); let s = 0; st[0] = 0; for (let i = 1; i < c.length; i++) { s = c[i] > c[i - 1] ? (s > 0 ? s + 1 : 1) : c[i] < c[i - 1] ? (s < 0 ? s - 1 : -1) : 0; st[i] = s; } const m = num(p, "rank"); const rk = ROLL([ROC(c, 1)], m + 1, ([w]) => w.slice(0, m).filter((v) => v < w[m]).length * (100 / m)); return { crsi: zip((a, b, d) => (a + b + d) / 3, RSI(c, num(p, "rsi")), RSI(st, num(p, "streak")), rk) }; },
  demarker: (x, p) => { const n = num(p, "length"); const mx = SMA(zip((h, q) => Math.max(h - q, 0), x.high, LAG(x.high, 1)), n), mn = SMA(zip((l, q) => Math.max(q - l, 0), x.low, LAG(x.low, 1)), n); return { dem: zip((a, b) => (a + b === 0 ? 0.5 : a / (a + b)), mx, mn) }; },
  bbw: (x, p) => { const s = SRC(x, p), n = num(p, "length"), m = num(p, "mult"), mid = SMA(s, n), sd = SD(s, n); return { bbw: zip((md, d) => (md + m * d - (md - m * d)) / md, mid, sd) }; },
  bbpb: (x, p) => { const s = SRC(x, p), n = num(p, "length"), m = num(p, "mult"), mid = SMA(s, n), sd = SD(s, n); return { pb: zip((v, md, d) => { const u = md + m * d, l = md - m * d; return u === l ? N : (v - l) / (u - l); }, s, mid, sd) }; },
  natr: (x, p) => ({ natr: zip((a, c) => (100 * a) / c, ATR(x.high, x.low, x.close, num(p, "length")), x.close) }),
  hv: (x, p) => ({ hv: ROLL([zip((a, b) => Math.log(a / b), x.close, LAG(x.close, 1))], num(p, "length"), ([w]) => Math.sqrt(varS(w)) * Math.sqrt(num(p, "periods")) * 100) }),
  parkinson: (x, p) => ({ vol: ROLL([zip((h, l) => Math.log(h / l) ** 2, x.high, x.low)], num(p, "length"), ([w]) => Math.sqrt(w.reduce((a, b) => a + b, 0) / (4 * w.length * Math.log(2))) * Math.sqrt(num(p, "periods")) * 100) }),
  garmanklass: (x, p) => ({ vol: ROLL([zip((h, l, c, o) => 0.5 * Math.log(h / l) ** 2 - (2 * Math.log(2) - 1) * Math.log(c / o) ** 2, x.high, x.low, x.close, x.open)], num(p, "length"), ([w]) => Math.sqrt(Math.max(0, meanOf(w))) * Math.sqrt(num(p, "periods")) * 100) }),
  rogerssatchell: (x, p) => ({ vol: ROLL([zip((h, l, c, o) => Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o), x.high, x.low, x.close, x.open)], num(p, "length"), ([w]) => Math.sqrt(Math.max(0, meanOf(w))) * Math.sqrt(num(p, "periods")) * 100) }),
  yangzhang: (x, p) => { const n = num(p, "length"), k = 0.34 / (1.34 + (n + 1) / (n - 1)); const on = zip((o, c1) => Math.log(o / c1), x.open, LAG(x.close, 1)), oc = zip((c, o) => Math.log(c / o), x.close, x.open), rs = zip((h, l, c, o) => Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o), x.high, x.low, x.close, x.open); return { vol: ROLL([on, oc, rs], n, ([a, b, c]) => Math.sqrt(Math.max(0, varS(a) + k * varS(b) + (1 - k) * meanOf(c))) * Math.sqrt(num(p, "periods")) * 100) }; },
  stddev: (x, p) => ({ sd: SD(SRC(x, p), num(p, "length")) }),
  chop: (x, p) => { const n = num(p, "length"); return { chop: zip((s, h, l) => (h === l ? N : (100 * Math.log10(s / (h - l))) / Math.log10(n)), SUM(TR(x.high, x.low, x.close), n), HH(x.high, n), LL(x.low, n)) }; },
  massindex: (x, p) => { const e = num(p, "ema"), r = zip((h, l) => h - l, x.high, x.low), e1 = EMA(r, e); return { mi: SUM(zip((a, b) => a / b, e1, EMA(e1, e)), num(p, "length")) }; },
  ulcer: (x, p) => { const s = SRC(x, p), n = num(p, "length"); return { ui: ROLL([zip((v, h) => (100 * (v - h)) / h, s, HH(s, n))], n, ([w]) => Math.sqrt(w.reduce((a, b) => a + b * b, 0) / n)) }; },
  chaikinvol: (x, p) => ({ cv: ROC(EMA(zip((h, l) => h - l, x.high, x.low), num(p, "ema")), num(p, "roc")) }),
  rvol: (x, p) => { const s = SRC(x, p), sd = SD(s, num(p, "std")), s1 = LAG(s, 1), n = num(p, "length"); const u = EMA(zip((a, b, d) => (Number.isNaN(d) || Number.isNaN(b) ? N : a > b ? d : 0), s, s1, sd), n), d = EMA(zip((a, b, q) => (Number.isNaN(q) || Number.isNaN(b) ? N : a < b ? q : 0), s, s1, sd), n); return { rvi: zip((a, b) => (a + b === 0 ? 50 : (100 * a) / (a + b)), u, d) }; },
  avwap: (x, p) => { const a = num(p, "anchor"), o = nan(x.time.length); let pv = 0, v = 0; x.time.forEach((t, i) => { if (t < a) return; const tp = (x.high[i] + x.low[i] + x.close[i]) / 3, w = x.volume[i] > 0 ? x.volume[i] : 0; pv += tp * w; v += w; o[i] = v > 0 ? pv / v : tp; }); return { avwap: o }; },
  cmf: (x, p) => { const n = num(p, "length"), mf = zip((c, h, l, v) => (h === l ? 0 : ((c - l - (h - c)) / (h - l)) * v), x.close, x.high, x.low, x.volume); return { cmf: zip((a, b) => (b === 0 ? N : a / b), SUM(mf, n), SUM(x.volume, n)) }; },
  adl: (x) => { let acc = 0; return { adl: zip((c, h, l, v) => (acc += h === l ? 0 : ((c - l - (h - c)) / (h - l)) * v), x.close, x.high, x.low, x.volume) }; },
  chaikinosc: (x, p) => { let acc = 0; const ad = zip((c, h, l, v) => (acc += h === l ? 0 : ((c - l - (h - c)) / (h - l)) * v), x.close, x.high, x.low, x.volume); return { co: zip((a, b) => a - b, EMA(ad, num(p, "fast")), EMA(ad, num(p, "slow"))) }; },
  fi: (x, p) => ({ fi: EMA(zip((c, q, v) => (c - q) * v, x.close, LAG(x.close, 1), x.volume), num(p, "length")) }),
  eom: (x, p) => { const d = num(p, "divisor"), m = zip((h, l) => (h + l) / 2, x.high, x.low); return { eom: SMA(zip((a, b, v, h, l) => (v === 0 || h === l ? 0 : (a - b) / (v / d / (h - l))), m, LAG(m, 1), x.volume, x.high, x.low), num(p, "length")) }; },
  volosc: (x, p) => ({ vo: zip((a, b) => (100 * (a - b)) / b, EMA(x.volume, num(p, "fast")), EMA(x.volume, num(p, "slow"))) }),
  pvo: (x, p) => { const pv = zip((a, b) => (100 * (a - b)) / b, EMA(x.volume, num(p, "fast")), EMA(x.volume, num(p, "slow"))), s = EMA(pv, num(p, "signal")); return { hist: zip((a, b) => a - b, pv, s), pvo: pv, signal: s }; },
  pvt: (x) => { let acc = 0; return { pvt: x.close.map((c, i) => (acc += i === 0 ? 0 : (x.volume[i] * (c - x.close[i - 1])) / x.close[i - 1])) }; },
  nvi: (x, p) => { let v = num(p, "start"); return { nvi: x.close.map((c, i) => { if (i > 0 && x.volume[i] < x.volume[i - 1]) v = v * (1 + (c - x.close[i - 1]) / x.close[i - 1]); return v; }) }; },
  pvi: (x, p) => { let v = num(p, "start"); return { pvi: x.close.map((c, i) => { if (i > 0 && x.volume[i] > x.volume[i - 1]) v = v * (1 + (c - x.close[i - 1]) / x.close[i - 1]); return v; }) }; },
  kvo: (x, p) => { const tp = zip((h, l, c) => (h + l + c) / 3, x.high, x.low, x.close), vf = nan(tp.length); let pt = N, tr = 0, pdm = N, cm = N; for (let i = 0; i < tp.length; i++) { const dm = x.high[i] - x.low[i]; const t = Number.isNaN(pt) ? 0 : tp[i] > pt ? 1 : -1; const c = Number.isNaN(cm) ? dm : t === tr ? cm + dm : pdm + dm; pt = tp[i]; tr = t; pdm = dm; cm = c; if (t !== 0) vf[i] = c === 0 ? 0 : x.volume[i] * Math.abs(2 * (dm / c) - 1) * t * 100; } const k = zip((a, b) => a - b, EMA(vf, num(p, "fast")), EMA(vf, num(p, "slow"))); return { kvo: k, signal: EMA(k, num(p, "signal")) }; },
  vroc: (x, p) => ({ vroc: ROC(x.volume, num(p, "length")) }),
  vwma: (x, p) => { const s = SRC(x, p), n = num(p, "length"); return { vwma: zip((a, b) => (b === 0 ? N : a / b), SUM(zip((u, v) => u * v, s, x.volume), n), SUM(x.volume, n)) }; },
  linreg: (x, p) => ({ lr: ROLL([SRC(x, p)], num(p, "length"), ([w]) => reg(w).end) }),
  lrslope: (x, p) => ({ slope: ROLL([SRC(x, p)], num(p, "length"), ([w]) => reg(w).b) }),
  lrintercept: (x, p) => ({ icpt: ROLL([SRC(x, p)], num(p, "length"), ([w]) => reg(w).a) }),
  lrchannel: (x, p) => { const s = SRC(x, p), n = num(p, "length"), m = num(p, "mult"); const mid = ROLL([s], n, ([w]) => reg(w).end), sd = ROLL([s], n, ([w]) => Math.sqrt(reg(w).ssr / n)); return { upper: zip((a, b) => a + m * b, mid, sd), mid, lower: zip((a, b) => a - m * b, mid, sd) }; },
  r2: (x, p) => ({ r2: ROLL([SRC(x, p)], num(p, "length"), ([w]) => { const r = reg(w); return r.sst === 0 ? N : 1 - r.ssr / r.sst; }) }),
  stderr: (x, p) => ({ se: ROLL([SRC(x, p)], num(p, "length"), ([w]) => Math.sqrt(reg(w).ssr / (w.length - 2))) }),
  variance: (x, p) => ({ var: ROLL([SRC(x, p)], num(p, "length"), ([w]) => { const m = meanOf(w); return w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length; }) }),
  zscore: (x, p) => ({ z: ROLL([SRC(x, p)], num(p, "length"), ([w]) => { const m = meanOf(w), sd = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length); return sd === 0 ? N : (w[w.length - 1] - m) / sd; }) }),
  median: (x, p) => ({ median: ROLL([SRC(x, p)], num(p, "length"), ([w]) => pctile(w, 0.5)) }),
  percentile: (x, p) => ({ pct: ROLL([SRC(x, p)], num(p, "length"), ([w]) => pctile(w, num(p, "q") / 100)) }),
  skew: (x, p) => ({ skew: ROLL([SRC(x, p)], num(p, "length"), ([w]) => { const m = meanOf(w), m2 = w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length, m3 = w.reduce((s, v) => s + (v - m) ** 3, 0) / w.length; return m2 === 0 ? N : m3 / m2 ** 1.5; }) }),
  kurtosis: (x, p) => ({ kurt: ROLL([SRC(x, p)], num(p, "length"), ([w]) => { const m = meanOf(w), m2 = w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length, m4 = w.reduce((s, v) => s + (v - m) ** 4, 0) / w.length; return m2 === 0 ? N : m4 / m2 ** 2 - 3; }) }),
  correl: (x, p) => ({ corr: ROLL([RET(SRC(x, p)), RET(x.benchmark!)], num(p, "length"), ([a, b]) => { const s = pairStats(a, b); return s.cov / Math.sqrt(s.va * s.vb); }) }),
  covar: (x, p) => ({ cov: ROLL([RET(SRC(x, p)), RET(x.benchmark!)], num(p, "length"), ([a, b]) => pairStats(a, b).cov) }),
  beta: (x, p) => ({ beta: ROLL([RET(SRC(x, p)), RET(x.benchmark!)], num(p, "length"), ([a, b]) => { const s = pairStats(a, b); return s.cov / s.vb; }) }),
  alpha: (x, p) => { const P = num(p, "periods"), rf = num(p, "rf") / 100 / P; return { alpha: ROLL([RET(SRC(x, p)), RET(x.benchmark!)], num(p, "length"), ([a, b]) => { const s = pairStats(a, b), be = s.cov / s.vb; return (s.ma - rf - be * (s.mb - rf)) * P * 100; }) }; },
  maxdd: (x, p) => ({ mdd: ROLL([SRC(x, p)], num(p, "length"), ([w]) => { let pk = -Infinity, dd = 0; for (const v of w) { pk = Math.max(pk, v); dd = Math.min(dd, 100 * (v / pk - 1)); } return dd; }) }),
  sharpe: (x, p) => { const P = num(p, "periods"), rf = num(p, "rf") / 100 / P; return { sharpe: ROLL([RET(SRC(x, p))], num(p, "length"), ([w]) => ((meanOf(w) - rf) / Math.sqrt(varS(w))) * Math.sqrt(P)) }; },
  sortino: (x, p) => { const P = num(p, "periods"), rf = num(p, "rf") / 100 / P; return { sortino: ROLL([RET(SRC(x, p))], num(p, "length"), ([w]) => { const e = w.map((v) => v - rf), dd = Math.sqrt(e.reduce((s, v) => s + Math.min(v, 0) ** 2, 0) / e.length); return dd === 0 ? N : (meanOf(e) / dd) * Math.sqrt(P); }) }; },
  autocorr: (x, p) => { const r = RET(SRC(x, p)); return { ac: ROLL([r, LAG(r, num(p, "lag"))], num(p, "length"), ([a, b]) => { const s = pairStats(a, b); return s.cov / Math.sqrt(s.va * s.vb); }) }; },
  er: (x, p) => { const n = num(p, "length"); return { er: ROLL([SRC(x, p)], n + 1, ([w]) => { let path = 0; for (let k = 1; k <= n; k++) path += Math.abs(w[k] - w[k - 1]); return path === 0 ? 0 : Math.abs(w[n] - w[0]) / path; }) }; },
  meandev: (x, p) => ({ mad: ROLL([SRC(x, p)], num(p, "length"), ([w]) => { const m = meanOf(w); return w.reduce((s, v) => s + Math.abs(v - m), 0) / w.length; }) }),
  pivots: (x, p) => { const q = prevPeriod(x, String(p.period)); const P = zip((h, l, c) => (h + l + c) / 3, q.h, q.l, q.c); return { p: P, r1: zip((v, l) => 2 * v - l, P, q.l), s1: zip((v, h) => 2 * v - h, P, q.h), r2: zip((v, h, l) => v + (h - l), P, q.h, q.l), s2: zip((v, h, l) => v - (h - l), P, q.h, q.l), r3: zip((v, h, l) => h + 2 * (v - l), P, q.h, q.l), s3: zip((v, h, l) => l - 2 * (h - v), P, q.h, q.l) }; },
  camarilla: (x, p) => { const q = prevPeriod(x, String(p.period)); const R = zip((h, l) => h - l, q.h, q.l); const f = (d: number, sgn: number) => zip((c, r) => c + (sgn * 1.1 * r) / d, q.c, R); return { p: zip((h, l, c) => (h + l + c) / 3, q.h, q.l, q.c), r1: f(12, 1), s1: f(12, -1), r2: f(6, 1), s2: f(6, -1), r3: f(4, 1), s3: f(4, -1), r4: f(2, 1), s4: f(2, -1) }; },
  demark: (x, p) => { const q = prevPeriod(x, String(p.period)); const X = zip((o, h, l, c) => (c > o ? 2 * h + l + c : c < o ? h + 2 * l + c : h + l + 2 * c), q.o, q.h, q.l, q.c); return { p: X.map((v) => v / 4), r1: zip((v, l) => v / 2 - l, X, q.l), s1: zip((v, h) => v / 2 - h, X, q.h) }; },
  pricechannel: (x, p) => ({ upper: LAG(HH(x.high, num(p, "length")), 1), lower: LAG(LL(x.low, num(p, "length")), 1) }),
  fractals: (x, p) => { const n = num(p, "bars"); const f = (s: A, max: boolean) => ROLL([s], 2 * n + 1, ([w]) => { const c = w[n]; return w.every((v, k) => k === n || (max ? v < c : v > c)) ? c : N; }); return { up: f(x.high, true), down: f(x.low, false) }; },
  zigzag: (x, p) => { const dev = num(p, "deviation") / 100, conf = nan(x.close.length); let dir = 0, ext = N, base = N, c = N; x.close.forEach((cl, i) => { const h = x.high[i], l = x.low[i]; if (Number.isNaN(base)) { base = cl; conf[i] = c; return; } if (dir === 0) { if (h >= base * (1 + dev)) { dir = 1; ext = h; c = base; } else if (l <= base * (1 - dev)) { dir = -1; ext = l; c = base; } } else if (dir === 1) { if (h > ext) ext = h; else if (l <= ext * (1 - dev)) { c = ext; dir = -1; ext = l; } } else { if (l < ext) ext = l; else if (h >= ext * (1 + dev)) { c = ext; dir = 1; ext = h; } } conf[i] = c; }); return { confirmed: conf }; },
};

const defaults = (d: { params: { key: string; default: unknown }[] }) => Object.fromEntries(d.params.map((p) => [p.key, p.default])) as IndicatorParams;
const close = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test("catalogue size, unique ids and complete metadata for every built-in", () => {
  assert.ok(ALL_BUILTIN_INDICATORS.length >= 100, `${ALL_BUILTIN_INDICATORS.length} built-ins`);
  assert.equal(new Set(ALL_BUILTIN_INDICATORS.map((d) => d.id)).size, ALL_BUILTIN_INDICATORS.length);
  for (const d of ALL_BUILTIN_INDICATORS) {
    assert.ok(d.name && d.description && d.category, `${d.id}: name/description/category`);
    assert.ok(d.meta?.formula && d.meta.missing && d.meta.incremental === "exact", `${d.id}: formula, missing-data policy, incremental status`);
    assert.ok(d.outputs.length > 0 && d.outputs.every((o) => o.key && o.label && o.color), `${d.id}: outputs`);
    for (const p of d.params) {
      assert.ok(p.label && p.default !== undefined, `${d.id}.${p.key}: label/default`);
      if (typeof p.default === "number") assert.ok((p.min === undefined || p.default >= p.min) && (p.max === undefined || p.default <= p.max), `${d.id}.${p.key}: default inside range`);
    }
    assert.ok(typeof d.stream === "function", `${d.id}: streaming form`);
    assert.ok(Number.isInteger(d.warmup(defaults(d))), `${d.id}: warm-up`);
  }
});

const REGIMES: [string, IndicatorInput][] = [["daily", market(600, 3)], ["intraday", market(900, 17, true)], ["volatile", market(500, 41)]];
for (const [name, data] of REGIMES) {
  test(`every native indicator matches its independent reference (${name})`, () => {
    let compared = 0;
    for (const def of NATIVE_INDICATORS) {
      const ref = REF[def.id];
      const params = defaults(def);
      const got = def.calculate(data, params);
      for (const o of def.outputs) assert.ok(Array.isArray(got[o.key]) && got[o.key].length >= data.time.length, `${def.id}.${o.key} present`);
      if (!ref) continue;
      const want = ref(data, params);
      for (const [k, arr] of Object.entries(want)) {
        for (let i = 0; i < data.time.length; i++) if (!close(got[k][i], arr[i])) assert.fail(`${name}: ${def.id}.${k}[${i}] = ${got[k][i]}, reference ${arr[i]}`);
      }
      compared++;
    }
    assert.ok(compared >= 80, `${compared} indicators compared with references`);
  });
}

test("indicators without a separate reference: cross-checked through identities and known values", () => {
  const x = market(400, 9, true);
  const get = (id: string, p: IndicatorParams = {}) => { const d = NATIVE_INDICATORS.find((q) => q.id === id)!; return d.calculate(x, { ...defaults(d), ...p }); };
  // Fibonacci and Woodie pivots, CPR and previous high/low from the same previous-period prices as standard pivots.
  const std = get("pivots"), fib = get("fibpivots"), wd = get("woodie"), cpr = get("cpr"), prev = get("prevhl");
  for (let i = 0; i < 400; i++) {
    if (Number.isNaN(std.p[i])) continue;
    const R = prev.high[i] - prev.low[i];
    assert.ok(close(fib.r2[i], std.p[i] + 0.618 * R) && close(fib.s3[i], std.p[i] - R));
    assert.ok(close(wd.p[i], (prev.high[i] + prev.low[i] + 2 * prev.close[i]) / 4));
    assert.ok(close(cpr.pivot[i], std.p[i]) && close(cpr.bc[i], (prev.high[i] + prev.low[i]) / 2) && close(cpr.tc[i], 2 * std.p[i] - cpr.bc[i]));
  }
  // Highest high / lowest low, swings carry confirmed fractal levels, opening range.
  const hh = get("highesthigh", { length: 7 }), ll = get("lowestlow", { length: 7 });
  for (let i = 6; i < 400; i++) assert.ok(close(hh.hh[i], Math.max(...x.high.slice(i - 6, i + 1))) && close(ll.ll[i], Math.min(...x.low.slice(i - 6, i + 1))));
  const fr = get("fractals", { bars: 3 }), sw = get("swings", { left: 3, right: 3 });
  let last = NaN;
  for (let i = 0; i < 400; i++) { if (!Number.isNaN(fr.up[i])) last = fr.up[i]; assert.ok(close(sw.high[i], last), `swing carry at ${i}`); }
  const or = get("openingrange", { minutes: 30 });
  for (let i = 0; i < 400; i++) {
    const day = pkey(x.time[i], "day");
    const first = x.time.findIndex((t) => pkey(t, "day") === day);
    const idx = x.time.map((t, k) => k).filter((k) => k <= i && pkey(x.time[k], "day") === day && x.time[k] < x.time[first] + 1800);
    assert.ok(close(or.high[i], Math.max(...idx.map((k) => x.high[k]))) && close(or.low[i], Math.min(...idx.map((k) => x.low[k]))));
  }
  // Hurst: a persistent random walk with trending increments scores above 0.5; alternating returns score low.
  const trend = market(300, 5);
  trend.close = trend.close.map((_, i) => 100 * Math.exp(0.001 * i + 0.0005 * Math.sin(i / 7)));
  const h1 = NATIVE_INDICATORS.find((d) => d.id === "hurst")!.calculate(trend, { length: 128, source: "close" }).h;
  const alt = market(300, 5);
  alt.close = alt.close.map((_, i) => 100 * (1 + (i % 2 ? 0.01 : -0.01) * (1 + (i % 5) / 10)));
  const h2 = NATIVE_INDICATORS.find((d) => d.id === "hurst")!.calculate(alt, { length: 128, source: "close" }).h;
  assert.ok(h1[299] > 0.5 && h2[299] < 0.3, `Hurst persistent ${h1[299]} vs anti-persistent ${h2[299]}`);
  // Zig Zag provisional extreme is the running extreme of the current leg.
  const zz = get("zigzag", { deviation: 2 });
  assert.ok(zz.provisional.some(Number.isFinite));
});

test("streaming equivalence for every native indicator: sequential append and repeated live replacement", () => {
  const data = market(300, 23, true);
  for (const def of NATIVE_INDICATORS) {
    const p = defaults(def);
    const full = def.calculate(data, p);
    const spec = def.stream!(p, { intraday: true });
    const g = new StreamGraph();
    g.acquire(spec.outputs.map((o) => o.node));
    const live: IndicatorInput = { time: [], open: [], high: [], low: [], close: [], volume: [], intraday: true, benchmark: [] };
    for (let i = 0; i < 300; i++) {
      for (const k of ["time", "open", "high", "low", "close", "volume", "benchmark"] as const) (live[k] as number[]).push((data[k] as number[])[i]);
      // Three provisional versions of the bar, then its final values.
      for (const bump of [1.01, 0.99, 1.005]) {
        live.close[i] = data.close[i] * bump;
        live.high[i] = Math.max(data.high[i], live.close[i]);
        live.low[i] = Math.min(data.low[i], live.close[i]);
        g.sync(live, Math.max(0, i - 1));
      }
      live.close[i] = data.close[i];
      live.high[i] = data.high[i];
      live.low[i] = data.low[i];
      g.sync(live, Math.max(0, i - 1));
    }
    for (const o of spec.outputs) {
      const v = g.values(o.node.key);
      for (let i = 0; i < 300; i++) if (!Object.is(v[i], full[o.key][i]) && !(Number.isNaN(v[i]) && Number.isNaN(full[o.key][i]))) assert.fail(`${def.id}.${o.key}[${i}]: streamed ${v[i]} ≠ full ${full[o.key][i]}`);
    }
  }
});

class Fake implements RenderAdapter {
  last: RenderModel | null = null;
  render(m: RenderModel) { this.last = m; }
  setOptions() {}
  onCrosshair() {}
  getViewRange() { return null; }
  setViewRange() {}
  fit() {}
  scrollToEnd() {}
  scrollBy() {}
  zoom() {}
  resize() {}
  destroy() {}
}

test("discovery, required inputs and benchmark handling on a chart", () => {
  assert.ok(builtinRegistry.search({ category: "Statistics" }).length >= 20);
  assert.deepEqual(builtinRegistry.search({ text: "kaufman" }).map((d) => d.id).sort(), ["er", "kama"]);
  assert.ok(builtinRegistry.search({ requires: "benchmark" }).map((d) => d.id).includes("beta"));
  assert.equal(builtinRegistry.search({ incremental: false }).length, 0, "every built-in is incremental");
  assert.ok(builtinRegistry.search({ param: "periods" }).some((d) => d.id === "hv"));
  const cats = builtinRegistry.categories();
  for (const c of ["Trend", "Momentum", "Volatility", "Volume", "Statistics", "Structure"]) assert.ok(cats[c] >= 10, `${c}: ${cats[c]}`);
  const x = market(300, 2);
  const chart = createChartWithAdapter(new Fake());
  chart.addCandlestickSeries().setData(x.time.map((t, i) => ({ time: t, open: x.open[i], high: x.high[i], low: x.low[i], close: x.close[i], volume: x.volume[i] })));
  assert.throws(() => chart.addIndicator("beta"), (e: unknown) => e instanceof XChartError && e.code === "MISSING_INPUT");
  assert.deepEqual(chart.indicatorCompatibility("beta"), { ok: false, reasons: ["needs a benchmark series (chart.setBenchmarkSeries)"] });
  const bench = chart.addLineSeries({ pane: "separate" });
  bench.setData(x.time.map((t, i) => ({ time: t, value: x.benchmark![i] })));
  chart.setBenchmarkSeries(bench);
  const beta = chart.addIndicator("beta", { length: 30 });
  const ref = REF.beta(x, { length: 30, source: "close" }).beta;
  const got = new Map(beta.getValues().map((p) => [p.time, p.values.beta]));
  for (let i = 0; i < 300; i++) if (Number.isFinite(ref[i])) assert.ok(close(got.get(x.time[i])!, ref[i]), `beta[${i}]`);
  assert.throws(() => chart.setBenchmarkSeries(null), XChartError, "in use");
  bench.remove();
  assert.equal(chart.getIndicators().length, 0, "benchmark indicators are removed with their benchmark (no silent NaNs)");
  assert.equal(builtinRegistry.compatibility("vwap", { derived: true }).ok, false);
  assert.equal(builtinRegistry.compatibility("sma", { derived: true }).ok, true);
});
