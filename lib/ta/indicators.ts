// TradestXPro technical-analysis engine. Pure, deterministic, no dependencies.
// A series is number[] aligned to bars; NaN marks "no value yet" (warm-up) or missing data.
// Moving averages start at the first index with `n` values after the first valid input,
// so indicators of indicators (e.g. EMA of RSI) work naturally.

export type Series = number[];

const nanArray = (len: number): Series => new Array<number>(len).fill(NaN);
const firstValid = (s: Series): number => {
  for (let i = 0; i < s.length; i++) if (!Number.isNaN(s[i])) return i;
  return s.length;
};

export function sma(src: Series, n: number): Series {
  const out = nanArray(src.length);
  if (n < 1) return out;
  let sum = 0;
  let count = 0;
  for (let i = firstValid(src); i < src.length; i++) {
    const v = src[i];
    if (Number.isNaN(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > n) sum -= src[i - n];
    if (count >= n) out[i] = sum / n;
  }
  return out;
}

function seededSmoothing(src: Series, n: number, alpha: number): Series {
  const out = nanArray(src.length);
  if (n < 1) return out;
  const start = firstValid(src);
  if (start + n > src.length) return out;
  let seed = 0;
  for (let i = start; i < start + n; i++) seed += src[i];
  let prev = seed / n;
  out[start + n - 1] = prev;
  for (let i = start + n; i < src.length; i++) {
    const v = src[i];
    if (Number.isNaN(v)) {
      out[i] = prev;
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first n values. */
export const ema = (src: Series, n: number): Series => seededSmoothing(src, n, 2 / (n + 1));
/** Wilder's smoothing (RMA / SMMA), used by RSI, ATR and ADX. */
export const rma = (src: Series, n: number): Series => seededSmoothing(src, n, 1 / n);

export function wma(src: Series, n: number): Series {
  const out = nanArray(src.length);
  const denom = (n * (n + 1)) / 2;
  for (let i = firstValid(src) + n - 1; i < src.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const v = src[i - k];
      if (Number.isNaN(v)) {
        ok = false;
        break;
      }
      s += v * (n - k);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

export function hma(src: Series, n: number): Series {
  const half = wma(src, Math.max(1, Math.floor(n / 2)));
  const full = wma(src, n);
  return wma(half.map((h, i) => 2 * h - full[i]), Math.max(1, Math.round(Math.sqrt(n))));
}

export function stdev(src: Series, n: number): Series {
  const mean = sma(src, n);
  return mean.map((m, i) => {
    if (Number.isNaN(m)) return NaN;
    let s = 0;
    for (let k = 0; k < n; k++) s += (src[i - k] - m) ** 2;
    return Math.sqrt(s / n);
  });
}

export function highest(src: Series, n: number): Series {
  return src.map((_, i) => {
    if (i < n - 1) return NaN;
    let m = -Infinity;
    for (let k = 0; k < n; k++) m = Math.max(m, src[i - k]);
    return Number.isFinite(m) ? m : NaN;
  });
}

export function lowest(src: Series, n: number): Series {
  return src.map((_, i) => {
    if (i < n - 1) return NaN;
    let m = Infinity;
    for (let k = 0; k < n; k++) m = Math.min(m, src[i - k]);
    return Number.isFinite(m) ? m : NaN;
  });
}

export const change = (src: Series, n = 1): Series => src.map((v, i) => (i >= n ? v - src[i - n] : NaN));
export const roc = (src: Series, n: number): Series =>
  src.map((v, i) => (i >= n && src[i - n] !== 0 ? ((v - src[i - n]) / src[i - n]) * 100 : NaN));

export function rsi(src: Series, n = 14): Series {
  const up = nanArray(src.length);
  const down = nanArray(src.length);
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    if (Number.isNaN(d)) continue;
    up[i] = Math.max(d, 0);
    down[i] = Math.max(-d, 0);
  }
  const au = rma(up, n);
  const ad = rma(down, n);
  return au.map((u, i) => {
    const d = ad[i];
    if (Number.isNaN(u) || Number.isNaN(d)) return NaN;
    if (d === 0) return u === 0 ? 50 : 100;
    return 100 - 100 / (1 + u / d);
  });
}

export function macd(src: Series, fast = 12, slow = 26, signalLen = 9) {
  const f = ema(src, fast);
  const s = ema(src, slow);
  const line = f.map((v, i) => v - s[i]);
  const signal = ema(line, signalLen);
  return { macd: line, signal, hist: line.map((v, i) => v - signal[i]) };
}

export function bollinger(src: Series, n = 20, mult = 2) {
  const mid = sma(src, n);
  const sd = stdev(src, n);
  return { mid, upper: mid.map((m, i) => m + mult * sd[i]), lower: mid.map((m, i) => m - mult * sd[i]) };
}

export function trueRange(h: Series, l: Series, c: Series): Series {
  return h.map((hi, i) =>
    i === 0 ? hi - l[i] : Math.max(hi - l[i], Math.abs(hi - c[i - 1]), Math.abs(l[i] - c[i - 1])),
  );
}

export const atr = (h: Series, l: Series, c: Series, n = 14): Series => rma(trueRange(h, l, c), n);

export function adx(h: Series, l: Series, c: Series, n = 14) {
  const len = h.length;
  const plusDM = nanArray(len);
  const minusDM = nanArray(len);
  for (let i = 1; i < len; i++) {
    const upMove = h[i] - h[i - 1];
    const downMove = l[i - 1] - l[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }
  const tr = trueRange(h, l, c);
  tr[0] = NaN;
  const atrS = rma(tr, n);
  const pdi = rma(plusDM, n).map((v, i) => (100 * v) / atrS[i]);
  const mdi = rma(minusDM, n).map((v, i) => (100 * v) / atrS[i]);
  const dx = pdi.map((p, i) => {
    const s = p + mdi[i];
    return s === 0 ? 0 : (100 * Math.abs(p - mdi[i])) / s;
  });
  return { adx: rma(dx, n), plusDI: pdi, minusDI: mdi };
}

/** Supertrend: direction 1 = uptrend (line below price), -1 = downtrend. */
export function supertrend(h: Series, l: Series, c: Series, n = 10, mult = 3) {
  const a = atr(h, l, c, n);
  const len = c.length;
  const line = nanArray(len);
  const dir = nanArray(len);
  let upper = NaN;
  let lower = NaN;
  let d = 1;
  for (let i = 0; i < len; i++) {
    if (Number.isNaN(a[i])) continue;
    const mid = (h[i] + l[i]) / 2;
    const bu = mid + mult * a[i];
    const bl = mid - mult * a[i];
    const prevClose = c[i - 1];
    upper = Number.isNaN(upper) || bu < upper || prevClose > upper ? bu : upper;
    lower = Number.isNaN(lower) || bl > lower || prevClose < lower ? bl : lower;
    if (Number.isNaN(line[i - 1] ?? NaN)) d = c[i] >= mid ? 1 : -1;
    else if (d === 1 && c[i] < lower) d = -1;
    else if (d === -1 && c[i] > upper) d = 1;
    dir[i] = d;
    line[i] = d === 1 ? lower : upper;
  }
  return { line, dir };
}

/** VWAP anchored to each session (calendar day in IST for `times` in seconds). */
export function vwap(h: Series, l: Series, c: Series, v: Series, times: number[]): Series {
  const out = nanArray(c.length);
  let pv = 0;
  let vol = 0;
  let day = "";
  for (let i = 0; i < c.length; i++) {
    const d = new Date((times[i] + 19800) * 1000).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const tp = (h[i] + l[i] + c[i]) / 3;
    pv += tp * (v[i] || 0);
    vol += v[i] || 0;
    out[i] = vol > 0 ? pv / vol : tp;
  }
  return out;
}

export type VwapAnchor = "session" | "week" | "month";

/** Anchored VWAP with volume-weighted standard deviation (for bands). Times are UTC seconds; anchors use IST. */
export function vwapBands(src: Series, v: Series, times: number[], anchor: VwapAnchor = "session") {
  const vwapOut = nanArray(src.length);
  const sdOut = nanArray(src.length);
  let pv = 0;
  let pv2 = 0;
  let vol = 0;
  let key = "";
  for (let i = 0; i < src.length; i++) {
    const d = new Date((times[i] + 19800) * 1000);
    let k: string;
    if (anchor === "month") k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    else if (anchor === "week") {
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
      k = monday.toISOString().slice(0, 10);
    } else k = d.toISOString().slice(0, 10);
    if (k !== key) {
      key = k;
      pv = pv2 = vol = 0;
    }
    const x = src[i];
    const w = v[i] > 0 ? v[i] : 0;
    pv += x * w;
    pv2 += x * x * w;
    vol += w;
    const mean = vol > 0 ? pv / vol : x;
    vwapOut[i] = mean;
    sdOut[i] = vol > 0 ? Math.sqrt(Math.max(0, pv2 / vol - mean * mean)) : 0;
  }
  return { vwap: vwapOut, sd: sdOut };
}

/** Shifts a series right by `n` bars (positive offset). */
export function shift(src: Series, n: number): Series {
  if (!n) return src;
  return src.map((_, i) => (i - n >= 0 && i - n < src.length ? src[i - n] : NaN));
}

export function obv(c: Series, v: Series): Series {
  let acc = 0;
  return c.map((x, i) => {
    if (i > 0) acc += x > c[i - 1] ? v[i] : x < c[i - 1] ? -v[i] : 0;
    return acc;
  });
}

export function stochastic(h: Series, l: Series, c: Series, kLen = 14, kSmooth = 3, dLen = 3) {
  const hh = highest(h, kLen);
  const ll = lowest(l, kLen);
  const raw = c.map((x, i) => (hh[i] === ll[i] ? 50 : (100 * (x - ll[i])) / (hh[i] - ll[i])));
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dLen) };
}

export function cci(h: Series, l: Series, c: Series, n = 20): Series {
  const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
  const m = sma(tp, n);
  return tp.map((x, i) => {
    if (Number.isNaN(m[i])) return NaN;
    let dev = 0;
    for (let k = 0; k < n; k++) dev += Math.abs(tp[i - k] - m[i]);
    dev /= n;
    return dev === 0 ? 0 : (x - m[i]) / (0.015 * dev);
  });
}

export function mfi(h: Series, l: Series, c: Series, v: Series, n = 14): Series {
  const tp = c.map((x, i) => (h[i] + l[i] + x) / 3);
  return tp.map((_, i) => {
    if (i < n) return NaN;
    let pos = 0;
    let neg = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const flow = tp[k] * v[k];
      if (tp[k] > tp[k - 1]) pos += flow;
      else if (tp[k] < tp[k - 1]) neg += flow;
    }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  });
}

export function williamsR(h: Series, l: Series, c: Series, n = 14): Series {
  const hh = highest(h, n);
  const ll = lowest(l, n);
  return c.map((x, i) => (hh[i] === ll[i] ? -50 : (-100 * (hh[i] - x)) / (hh[i] - ll[i])));
}

export function keltner(h: Series, l: Series, c: Series, n = 20, mult = 2, atrLen = 10) {
  const mid = ema(c, n);
  const a = atr(h, l, c, atrLen);
  return { mid, upper: mid.map((m, i) => m + mult * a[i]), lower: mid.map((m, i) => m - mult * a[i]) };
}

export function donchian(h: Series, l: Series, n = 20) {
  const upper = highest(h, n);
  const lower = lowest(l, n);
  return { upper, lower, mid: upper.map((u, i) => (u + lower[i]) / 2) };
}

/**
 * Ichimoku Kinko Hyo. Every output is aligned to the bar index it is plotted at:
 * - Senkou spans are plotted `displacement` periods ahead counting the current bar as the first,
 *   i.e. shifted forward by `displacement - 1` bars (the usual charting convention). Values that land
 *   past the last bar are returned in `futureA` / `futureB` (index n + k).
 * - The Chikou (lagging) span is the close plotted `displacement - 1` bars back.
 */
export function ichimoku(h: Series, l: Series, conv = 9, base = 26, spanB = 52, displacement = 26, c?: Series) {
  const mid = (n: number) => {
    const hh = highest(h, n);
    const ll = lowest(l, n);
    return hh.map((x, i) => (x + ll[i]) / 2);
  };
  const tenkan = mid(conv);
  const kijun = mid(base);
  const a = tenkan.map((t, i) => (t + kijun[i]) / 2);
  const b = mid(spanB);
  const off = Math.max(0, Math.round(displacement) - 1);
  const shift = (s: Series) => s.map((_, i) => (i >= off ? s[i - off] : NaN));
  const ahead = (s: Series) => s.slice(Math.max(0, s.length - off));
  const close = c ?? [];
  const chikou = h.map((_, i) => (i + off < close.length ? close[i + off] : NaN));
  return { tenkan, kijun, spanA: shift(a), spanB: shift(b), futureA: ahead(a), futureB: ahead(b), chikou, offset: off };
}

/** Parabolic SAR. */
export function psar(h: Series, l: Series, step = 0.02, max = 0.2): Series {
  const len = h.length;
  const out = nanArray(len);
  if (len < 2) return out;
  let up = h[1] >= h[0];
  let sar = up ? l[0] : h[0];
  let ep = up ? h[1] : l[1];
  let af = step;
  out[1] = sar;
  for (let i = 2; i < len; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, l[i - 1], l[i - 2]);
      if (l[i] < sar) {
        up = false;
        sar = ep;
        ep = l[i];
        af = step;
      } else if (h[i] > ep) {
        ep = h[i];
        af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, h[i - 1], h[i - 2]);
      if (h[i] > sar) {
        up = true;
        sar = ep;
        ep = h[i];
        af = step;
      } else if (l[i] < ep) {
        ep = l[i];
        af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
  }
  return out;
}

export function crossover(a: Series, b: Series): boolean[] {
  return a.map((v, i) => i > 0 && v > b[i] && a[i - 1] <= b[i - 1]);
}

export function crossunder(a: Series, b: Series): boolean[] {
  return a.map((v, i) => i > 0 && v < b[i] && a[i - 1] >= b[i - 1]);
}
