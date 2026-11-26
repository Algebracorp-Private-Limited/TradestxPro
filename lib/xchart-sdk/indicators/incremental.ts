/**
 * Streaming indicator kernels.
 *
 * A kernel ("node") consumes one bar at a time and keeps a small cloneable state. Nodes form a
 * graph (see dependencies.ts): e.g. MACD = ema(close,12) − ema(close,26), signal = ema(line,9).
 * Every node reproduces the arithmetic of TradestXPro's reference implementations in lib/ta
 * operation by operation (same seeding, same NaN rules, same evaluation order), so streaming
 * results are identical to a full historical calculation — verified by tests on every built-in.
 *
 * Live updates: the graph keeps a COMMITTED state through the previous bar; the current bar is
 * evaluated on clones, so replacing the live candle any number of times never advances a
 * recursive calculation twice.
 */
/** One bar. `b` is the benchmark value at this bar (NaN when no benchmark series is set). */
export type Row = { t: number; o: number; h: number; l: number; c: number; v: number; b: number };

/** Runtime state of one node. `d` holds the value slots of its dependencies (assigned by the graph). */
export abstract class Kernel {
  d: number[] = [];
  /** Optional second output (e.g. supertrend direction), read through `aux`. */
  abstract step(i: number, r: Row, v: Float64Array, aux: Float64Array, slot: number): number;
  abstract clone(): Kernel;
  protected base<T extends Kernel>(k: T): T {
    k.d = this.d;
    return k;
  }
}

export type NodeDef = {
  /** Canonical identity: equal keys = mathematically identical node (shared). */
  key: string;
  deps: NodeDef[];
  create(): Kernel;
};

const node = (key: string, deps: NodeDef[], create: () => Kernel): NodeDef => ({ key, deps, create });

// ---------- sources ----------
export type SourceName = "open" | "high" | "low" | "close" | "volume" | "hl2" | "hlc3" | "ohlc4" | "time" | "benchmark";
class SourceK extends Kernel {
  private f: (r: Row) => number;
  constructor(f: (r: Row) => number) {
    super();
    this.f = f;
  }
  step(_i: number, r: Row) {
    return this.f(r);
  }
  clone() {
    return this.base(new SourceK(this.f));
  }
}
const SOURCES: Record<SourceName, (r: Row) => number> = {
  open: (r) => r.o, high: (r) => r.h, low: (r) => r.l, close: (r) => r.c, volume: (r) => r.v, time: (r) => r.t, benchmark: (r) => r.b,
  hl2: (r) => (r.h + r.l) / 2,
  hlc3: (r) => (r.h + r.l + r.c) / 3,
  ohlc4: (r) => (r.o + r.h + r.l + r.c) / 4,
};
export const src = (name: SourceName): NodeDef => node(`src:${name}`, [], () => new SourceK(SOURCES[name]));

// ---------- element-wise maps ----------
class MapK extends Kernel {
  private f: (a: number[]) => number;
  constructor(f: (a: number[]) => number) {
    super();
    this.f = f;
  }
  private buf: number[] = [];
  step(_i: number, _r: Row, v: Float64Array) {
    const b = this.buf;
    b.length = this.d.length;
    for (let k = 0; k < b.length; k++) b[k] = v[this.d[k]];
    return this.f(b);
  }
  clone() {
    return this.base(new MapK(this.f));
  }
}
/** Pure function of the dependencies' current values. `id` must uniquely describe `f`. */
export const map = (id: string, deps: NodeDef[], f: (a: number[]) => number): NodeDef => node(`map:${id}(${deps.map((x) => x.key).join(",")})`, deps, () => new MapK(f));

class PickAuxK extends Kernel {
  step(_i: number, _r: Row, _v: Float64Array, aux: Float64Array) {
    return aux[this.d[0]];
  }
  clone() {
    return this.base(new PickAuxK());
  }
}
/** The secondary output of a node. */
export const aux = (of: NodeDef): NodeDef => node(`aux(${of.key})`, [of], () => new PickAuxK());

// ---------- moving averages (lib/ta semantics) ----------
/** ta.sma: starts at the first valid input; a NaN resets the window. */
class SmaK extends Kernel {
  started = false;
  sum = 0;
  count = 0;
  ring: Float64Array;
  private n: number;
  constructor(n: number) {
    super();
    this.n = n;
    this.ring = new Float64Array(n + 1);
  }
  step(i: number, _r: Row, v: Float64Array) {
    const x = v[this.d[0]];
    const n = this.n;
    this.ring[i % (n + 1)] = x;
    if (!this.started) {
      if (Number.isNaN(x)) return NaN;
      this.started = true;
    }
    if (Number.isNaN(x)) {
      this.sum = 0;
      this.count = 0;
      return NaN;
    }
    this.sum += x;
    this.count++;
    if (this.count > n) this.sum -= this.ring[(i - n) % (n + 1)];
    return this.count >= n ? this.sum / n : NaN;
  }
  clone() {
    const k = this.base(new SmaK(this.n));
    k.started = this.started;
    k.sum = this.sum;
    k.count = this.count;
    k.ring = this.ring.slice();
    return k;
  }
}
export const sma = (x: NodeDef, n: number): NodeDef => node(`sma(${x.key},${n})`, [x], () => new SmaK(n));

/** ta.ema / ta.rma (seeded with the SMA of the first n values after the first valid one; NaN keeps the previous value). */
class SeededK extends Kernel {
  started = false;
  seed = 0;
  count = 0;
  prev = NaN;
  private n: number;
  private alpha: number;
  constructor(n: number, alpha: number) {
    super();
    this.n = n;
    this.alpha = alpha;
  }
  step(_i: number, _r: Row, v: Float64Array) {
    const x = v[this.d[0]];
    if (!this.started) {
      if (Number.isNaN(x)) return NaN;
      this.started = true;
    }
    if (this.count < this.n) {
      this.seed += x;
      this.count++;
      if (this.count < this.n) return NaN;
      this.prev = this.seed / this.n;
      return this.prev;
    }
    if (Number.isNaN(x)) return this.prev;
    this.prev = this.alpha * x + (1 - this.alpha) * this.prev;
    return this.prev;
  }
  clone() {
    const k = this.base(new SeededK(this.n, this.alpha));
    Object.assign(k, { started: this.started, seed: this.seed, count: this.count, prev: this.prev });
    return k;
  }
}
export const ema = (x: NodeDef, n: number): NodeDef => node(`ema(${x.key},${n})`, [x], () => new SeededK(n, 2 / (n + 1)));
export const rma = (x: NodeDef, n: number): NodeDef => node(`rma(${x.key},${n})`, [x], () => new SeededK(n, 1 / n));

/** Ring buffer of the last `size` values of a dependency, indexed by global bar index. */
class Window {
  buf: Float64Array;
  nan = 0; // NaNs currently inside the last `size` values
  filled = 0;
  size: number;
  constructor(size: number) {
    this.size = size;
    this.buf = new Float64Array(size);
  }
  push(i: number, x: number) {
    const s = this.size;
    if (this.filled === s && Number.isNaN(this.buf[i % s])) this.nan--;
    this.buf[i % s] = x;
    if (this.filled < s) this.filled++;
    if (Number.isNaN(x)) this.nan++;
  }
  /** Value k bars ago (k < size). */
  at(i: number, k: number) {
    return this.buf[(i - k) % this.size];
  }
  clone() {
    const w = new Window(this.size);
    w.buf = this.buf.slice();
    w.nan = this.nan;
    w.filled = this.filled;
    return w;
  }
}

/** ta.wma: exact loop over the window (same evaluation order). */
class WmaK extends Kernel {
  first = -1;
  w: Window;
  private n: number;
  constructor(n: number) {
    super();
    this.n = n;
    this.w = new Window(n);
  }
  step(i: number, _r: Row, v: Float64Array) {
    const x = v[this.d[0]];
    this.w.push(i, x);
    if (this.first < 0) {
      if (Number.isNaN(x)) return NaN;
      this.first = i;
    }
    const n = this.n;
    if (i < this.first + n - 1) return NaN;
    let s = 0;
    for (let k = 0; k < n; k++) {
      const y = this.w.at(i, k);
      if (Number.isNaN(y)) return NaN;
      s += y * (n - k);
    }
    return s / ((n * (n + 1)) / 2);
  }
  clone() {
    const k = this.base(new WmaK(this.n));
    k.first = this.first;
    k.w = this.w.clone();
    return k;
  }
}
export const wma = (x: NodeDef, n: number): NodeDef => node(`wma(${x.key},${n})`, [x], () => new WmaK(n));

/** ta.stdev: population standard deviation around sma(x,n), two-pass over the window. */
class StdevK extends Kernel {
  w: Window;
  private n: number;
  constructor(n: number) {
    super();
    this.n = n;
    this.w = new Window(n);
  }
  step(i: number, _r: Row, v: Float64Array) {
    const x = v[this.d[0]];
    const m = v[this.d[1]];
    this.w.push(i, x);
    if (Number.isNaN(m)) return NaN;
    let s = 0;
    for (let k = 0; k < this.n; k++) s += (this.w.at(i, k) - m) ** 2;
    return Math.sqrt(s / this.n);
  }
  clone() {
    const k = this.base(new StdevK(this.n));
    k.w = this.w.clone();
    return k;
  }
}
export const stdev = (x: NodeDef, n: number): NodeDef => node(`stdev(${x.key},${n})`, [x, sma(x, n)], () => new StdevK(n));

/** ta.highest / ta.lowest with a monotonic deque: O(1) amortised, exact. NaN anywhere in the window → NaN. */
class ExtremeK extends Kernel {
  idx: number[] = [];
  val: number[] = [];
  head = 0;
  nanIdx: number[] = [];
  private n: number;
  private max: boolean;
  constructor(n: number, max: boolean) {
    super();
    this.n = n;
    this.max = max;
  }
  step(i: number, _r: Row, v: Float64Array) {
    const x = v[this.d[0]];
    const n = this.n;
    while (this.nanIdx.length && this.nanIdx[0] <= i - n) this.nanIdx.shift();
    if (Number.isNaN(x)) this.nanIdx.push(i);
    else {
      const better = this.max ? (a: number) => a <= x : (a: number) => a >= x;
      while (this.val.length > this.head && better(this.val[this.val.length - 1])) {
        this.val.pop();
        this.idx.pop();
      }
      this.idx.push(i);
      this.val.push(x);
    }
    while (this.head < this.idx.length && this.idx[this.head] <= i - n) this.head++;
    if (this.head > 64 && this.head * 2 > this.idx.length) {
      this.idx = this.idx.slice(this.head);
      this.val = this.val.slice(this.head);
      this.head = 0;
    }
    if (i < n - 1 || this.nanIdx.length || this.head >= this.idx.length) return NaN;
    const m = this.val[this.head];
    return Number.isFinite(m) ? m : NaN;
  }
  clone() {
    const k = this.base(new ExtremeK(this.n, this.max));
    k.idx = this.idx.slice(this.head);
    k.val = this.val.slice(this.head);
    k.nanIdx = this.nanIdx.slice();
    return k;
  }
}
export const highest = (x: NodeDef, n: number): NodeDef => node(`highest(${x.key},${n})`, [x], () => new ExtremeK(n, true));
export const lowest = (x: NodeDef, n: number): NodeDef => node(`lowest(${x.key},${n})`, [x], () => new ExtremeK(n, false));

/** Value of `x` k bars ago (NaN before that). */
class LagK extends Kernel {
  w: Window;
  private k: number;
  constructor(k: number) {
    super();
    this.k = k;
    this.w = new Window(k + 1);
  }
  step(i: number, _r: Row, v: Float64Array) {
    this.w.push(i, v[this.d[0]]);
    return i >= this.k ? this.w.at(i, this.k) : NaN;
  }
  clone() {
    const c = this.base(new LagK(this.k));
    c.w = this.w.clone();
    return c;
  }
}
export const lag = (x: NodeDef, k: number): NodeDef => node(`lag(${x.key},${k})`, [x], () => new LagK(k));

// ---------- price-structure primitives ----------
/** ta.trueRange; `firstNaN` reproduces ADX's convention (tr[0] = NaN). */
class TrK extends Kernel {
  prevC = NaN;
  private firstNaN: boolean;
  constructor(firstNaN: boolean) {
    super();
    this.firstNaN = firstNaN;
  }
  step(i: number, r: Row) {
    const pc = this.prevC;
    this.prevC = r.c;
    if (i === 0) return this.firstNaN ? NaN : r.h - r.l;
    return Math.max(r.h - r.l, Math.abs(r.h - pc), Math.abs(r.l - pc));
  }
  clone() {
    const k = this.base(new TrK(this.firstNaN));
    k.prevC = this.prevC;
    return k;
  }
}
export const trueRange = (firstNaN = false): NodeDef => node(`tr(${firstNaN ? "nan0" : "hl0"})`, [], () => new TrK(firstNaN));
export const atr = (n: number): NodeDef => rma(trueRange(false), n);

/** ta.adx directional movement; aux = −DM. */
class DmK extends Kernel {
  ph = NaN;
  pl = NaN;
  step(i: number, r: Row, _v: Float64Array, aux: Float64Array, slot: number) {
    const ph = this.ph, pl = this.pl;
    this.ph = r.h;
    this.pl = r.l;
    if (i === 0) {
      aux[slot] = NaN;
      return NaN;
    }
    const up = r.h - ph, down = pl - r.l;
    aux[slot] = down > up && down > 0 ? down : 0;
    return up > down && up > 0 ? up : 0;
  }
  clone() {
    const k = this.base(new DmK());
    k.ph = this.ph;
    k.pl = this.pl;
    return k;
  }
}
export const plusDM = (): NodeDef => node("dm+", [], () => new DmK());
export const minusDM = (): NodeDef => aux(plusDM());

/** ta.rsi up/down moves of x; aux = down move. */
class MovesK extends Kernel {
  prev = NaN;
  step(i: number, _r: Row, v: Float64Array, aux: Float64Array, slot: number) {
    const x = v[this.d[0]];
    const p = this.prev;
    this.prev = x;
    const d = x - p;
    if (i === 0 || Number.isNaN(d)) {
      aux[slot] = NaN;
      return NaN;
    }
    aux[slot] = Math.max(-d, 0);
    return Math.max(d, 0);
  }
  clone() {
    const k = this.base(new MovesK());
    k.prev = this.prev;
    return k;
  }
}
export const moves = (x: NodeDef): NodeDef => node(`moves(${x.key})`, [x], () => new MovesK());

/** ta.supertrend; returns the line, aux = direction (1 / −1). Deps: atr. */
class SupertrendK extends Kernel {
  upper = NaN;
  lower = NaN;
  dir = 1;
  prevLine = NaN;
  prevC = NaN;
  private mult: number;
  constructor(mult: number) {
    super();
    this.mult = mult;
  }
  step(_i: number, r: Row, v: Float64Array, aux: Float64Array, slot: number) {
    const a = v[this.d[0]];
    const prevClose = this.prevC;
    this.prevC = r.c;
    if (Number.isNaN(a)) {
      aux[slot] = NaN;
      this.prevLine = NaN;
      return NaN;
    }
    const mid = (r.h + r.l) / 2;
    const bu = mid + this.mult * a;
    const bl = mid - this.mult * a;
    this.upper = Number.isNaN(this.upper) || bu < this.upper || prevClose > this.upper ? bu : this.upper;
    this.lower = Number.isNaN(this.lower) || bl > this.lower || prevClose < this.lower ? bl : this.lower;
    if (Number.isNaN(this.prevLine)) this.dir = r.c >= mid ? 1 : -1;
    else if (this.dir === 1 && r.c < this.lower) this.dir = -1;
    else if (this.dir === -1 && r.c > this.upper) this.dir = 1;
    const line = this.dir === 1 ? this.lower : this.upper;
    this.prevLine = line;
    aux[slot] = this.dir;
    return line;
  }
  clone() {
    const k = this.base(new SupertrendK(this.mult));
    Object.assign(k, { upper: this.upper, lower: this.lower, dir: this.dir, prevLine: this.prevLine, prevC: this.prevC });
    return k;
  }
}
export const supertrendLine = (n: number, mult: number): NodeDef => node(`supertrend(${n},${mult})`, [atr(n)], () => new SupertrendK(mult));

/** ta.psar. */
class PsarK extends Kernel {
  up = false;
  sar = NaN;
  ep = NaN;
  af = 0;
  h1 = NaN;
  l1 = NaN;
  h2 = NaN;
  l2 = NaN;
  private stepAf: number;
  private max: number;
  constructor(stepAf: number, max: number) {
    super();
    this.stepAf = stepAf;
    this.max = max;
  }
  step(i: number, r: Row) {
    let out = NaN;
    if (i === 1) {
      this.up = r.h >= this.h1;
      this.sar = this.up ? this.l1 : this.h1;
      this.ep = this.up ? r.h : r.l;
      this.af = this.stepAf;
      out = this.sar;
    } else if (i >= 2) {
      let sar = this.sar + this.af * (this.ep - this.sar);
      if (this.up) {
        sar = Math.min(sar, this.l1, this.l2);
        if (r.l < sar) {
          this.up = false;
          sar = this.ep;
          this.ep = r.l;
          this.af = this.stepAf;
        } else if (r.h > this.ep) {
          this.ep = r.h;
          this.af = Math.min(this.af + this.stepAf, this.max);
        }
      } else {
        sar = Math.max(sar, this.h1, this.h2);
        if (r.h > sar) {
          this.up = true;
          sar = this.ep;
          this.ep = r.h;
          this.af = this.stepAf;
        } else if (r.l < this.ep) {
          this.ep = r.l;
          this.af = Math.min(this.af + this.stepAf, this.max);
        }
      }
      this.sar = sar;
      out = sar;
    }
    this.h2 = this.h1;
    this.l2 = this.l1;
    this.h1 = r.h;
    this.l1 = r.l;
    return out;
  }
  clone() {
    const k = this.base(new PsarK(this.stepAf, this.max));
    Object.assign(k, { up: this.up, sar: this.sar, ep: this.ep, af: this.af, h1: this.h1, l1: this.l1, h2: this.h2, l2: this.l2 });
    return k;
  }
}
export const psar = (step: number, max: number): NodeDef => node(`psar(${step},${max})`, [], () => new PsarK(step, max));

/** ta.vwapBands: anchored VWAP of x (IST session / week / month); aux = volume-weighted SD. */
class VwapK extends Kernel {
  pv = 0;
  pv2 = 0;
  vol = 0;
  key = "";
  private anchor: "session" | "week" | "month";
  constructor(anchor: "session" | "week" | "month") {
    super();
    this.anchor = anchor;
  }
  step(_i: number, r: Row, v: Float64Array, aux: Float64Array, slot: number) {
    const x = v[this.d[0]];
    const d = new Date((r.t + 19800) * 1000);
    let k: string;
    if (this.anchor === "month") k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    else if (this.anchor === "week") k = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
    else k = d.toISOString().slice(0, 10);
    if (k !== this.key) {
      this.key = k;
      this.pv = this.pv2 = this.vol = 0;
    }
    const w = r.v > 0 ? r.v : 0;
    this.pv += x * w;
    this.pv2 += x * x * w;
    this.vol += w;
    const mean = this.vol > 0 ? this.pv / this.vol : x;
    aux[slot] = this.vol > 0 ? Math.sqrt(Math.max(0, this.pv2 / this.vol - mean * mean)) : 0;
    return mean;
  }
  clone() {
    const k = this.base(new VwapK(this.anchor));
    Object.assign(k, { pv: this.pv, pv2: this.pv2, vol: this.vol, key: this.key });
    return k;
  }
}
export const vwap = (x: NodeDef, anchor: "session" | "week" | "month"): NodeDef => node(`vwap(${x.key},${anchor})`, [x], () => new VwapK(anchor));

/** ta.obv. */
class ObvK extends Kernel {
  acc = 0;
  prevC = NaN;
  step(i: number, r: Row) {
    if (i > 0) this.acc += r.c > this.prevC ? r.v : r.c < this.prevC ? -r.v : 0;
    this.prevC = r.c;
    return this.acc;
  }
  clone() {
    const k = this.base(new ObvK());
    k.acc = this.acc;
    k.prevC = this.prevC;
    return k;
  }
}
export const obv = (): NodeDef => node("obv", [], () => new ObvK());

/** ta.cci core: deps tp, sma(tp,n); exact mean-deviation loop. */
class CciK extends Kernel {
  w: Window;
  private n: number;
  constructor(n: number) {
    super();
    this.n = n;
    this.w = new Window(n);
  }
  step(i: number, _r: Row, v: Float64Array) {
    const x = v[this.d[0]], m = v[this.d[1]];
    this.w.push(i, x);
    if (Number.isNaN(m)) return NaN;
    let dev = 0;
    for (let k = 0; k < this.n; k++) dev += Math.abs(this.w.at(i, k) - m);
    dev /= this.n;
    return dev === 0 ? 0 : (x - m) / (0.015 * dev);
  }
  clone() {
    const k = this.base(new CciK(this.n));
    k.w = this.w.clone();
    return k;
  }
}
export const cci = (n: number): NodeDef => {
  const tp = map("hlc3c", [src("high"), src("low"), src("close")], ([h, l, c]) => (h + l + c) / 3);
  return node(`cci(${n})`, [tp, sma(tp, n)], () => new CciK(n));
};

/** ta.mfi: exact loop over the last n flows. */
class MfiK extends Kernel {
  tp: Window;
  vol: Window;
  private n: number;
  constructor(n: number) {
    super();
    this.n = n;
    this.tp = new Window(n + 1);
    this.vol = new Window(n + 1);
  }
  step(i: number, r: Row) {
    this.tp.push(i, (r.h + r.l + r.c) / 3);
    this.vol.push(i, r.v);
    const n = this.n;
    if (i < n) return NaN;
    let pos = 0, neg = 0;
    for (let k = i - n + 1; k <= i; k++) {
      const t = this.tp.at(i, i - k), flow = t * this.vol.at(i, i - k), prev = this.tp.at(i, i - k + 1);
      if (t > prev) pos += flow;
      else if (t < prev) neg += flow;
    }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  clone() {
    const k = this.base(new MfiK(this.n));
    k.tp = this.tp.clone();
    k.vol = this.vol.clone();
    return k;
  }
}
export const mfi = (n: number): NodeDef => node(`mfi(${n})`, [], () => new MfiK(n));

/** ta.roc on x (global bar index rule: NaN for i < n or a zero base). */
class RocK extends Kernel {
  w: Window;
  private n: number;
  constructor(n: number) {
    super();
    this.n = n;
    this.w = new Window(n + 1);
  }
  step(i: number, _r: Row, v: Float64Array) {
    const x = v[this.d[0]];
    this.w.push(i, x);
    if (i < this.n) return NaN;
    const b = this.w.at(i, this.n);
    return b !== 0 ? ((x - b) / b) * 100 : NaN;
  }
  clone() {
    const k = this.base(new RocK(this.n));
    k.w = this.w.clone();
    return k;
  }
}
export const roc = (x: NodeDef, n: number): NodeDef => node(`roc(${x.key},${n})`, [x], () => new RocK(n));

/** 1 once any positive value of x has been seen (Volume indicator shows nothing for index data). */
class AnyPositiveK extends Kernel {
  seen = 0;
  step(_i: number, _r: Row, v: Float64Array) {
    if (v[this.d[0]] > 0) this.seen = 1;
    return this.seen;
  }
  clone() {
    const k = this.base(new AnyPositiveK());
    k.seen = this.seen;
    return k;
  }
}
export const anyPositive = (x: NodeDef): NodeDef => node(`anyPositive(${x.key})`, [x], () => new AnyPositiveK());

/** Generic recursive accumulator for indicators defined by a reducer (used by the catalog expansion). */
export class ReducerK<S> extends Kernel {
  private init: () => S;
  private fn: (s: S, i: number, r: Row, x: number[]) => number;
  private copy: (s: S) => S;
  s: S;
  constructor(init: () => S, fn: (s: S, i: number, r: Row, x: number[]) => number, copy: (s: S) => S, s?: S) {
    super();
    this.init = init;
    this.fn = fn;
    this.copy = copy;
    this.s = s === undefined ? init() : s;
  }
  private buf: number[] = [];
  step(i: number, r: Row, v: Float64Array) {
    const b = this.buf;
    b.length = this.d.length;
    for (let k = 0; k < b.length; k++) b[k] = v[this.d[k]];
    return this.fn(this.s, i, r, b);
  }
  clone(): ReducerK<S> {
    return this.base(new ReducerK(this.init, this.fn, this.copy, this.copy(this.s)));
  }
}
/** A node defined by a reducer over its dependencies. `id` must uniquely describe the reducer and its parameters. */
export function reducer<S>(id: string, deps: NodeDef[], init: () => S, fn: (s: S, i: number, r: Row, x: number[]) => number, copy: (s: S) => S): NodeDef {
  return node(`red:${id}(${deps.map((d) => d.key).join(",")})`, deps, () => new ReducerK(init, fn, copy));
}

/**
 * Generic rolling-window node: keeps the last n values of each dependency and evaluates `fn` once
 * n consecutive bars have valid (non-NaN) values in every dependency; a NaN restarts the count.
 * `get(d, k)` = value of dependency d, k bars ago (k = 0 is the current bar). Exact (no running sums).
 */
class RollingK extends Kernel {
  ws: Window[];
  count = 0;
  private n: number;
  private fn: (get: (d: number, k: number) => number, n: number, i: number, r: Row) => number;
  constructor(n: number, deps: number, fn: (get: (d: number, k: number) => number, n: number, i: number, r: Row) => number) {
    super();
    this.n = n;
    this.fn = fn;
    this.ws = Array.from({ length: deps }, () => new Window(n));
  }
  step(i: number, r: Row, v: Float64Array) {
    let ok = true;
    for (let k = 0; k < this.ws.length; k++) {
      const x = v[this.d[k]];
      this.ws[k].push(i, x);
      if (Number.isNaN(x)) ok = false;
    }
    this.count = ok ? this.count + 1 : 0;
    if (this.count < this.n) return NaN;
    return this.fn((d, k) => this.ws[d].at(i, k), this.n, i, r);
  }
  clone() {
    const k = this.base(new RollingK(this.n, 0, this.fn));
    k.ws = this.ws.map((w) => w.clone());
    k.count = this.count;
    return k;
  }
}
/** `id` must uniquely describe `fn` (and its parameters). */
export const rolling = (id: string, deps: NodeDef[], n: number, fn: (get: (d: number, k: number) => number, n: number, i: number, r: Row) => number): NodeDef =>
  node(`roll:${id}(${deps.map((d) => d.key).join(",")};${n})`, deps, () => new RollingK(n, deps.length, fn));

/** Running sum of the last n values (NaN until n values; a NaN restarts). Exact loop. */
export const sum = (x: NodeDef, n: number): NodeDef => rolling("sum", [x], n, (g, m) => {
  let s = 0;
  for (let k = m - 1; k >= 0; k--) s += g(0, k);
  return s;
});

/** Calendar period key of a bar time in IST (same convention as VWAP anchors). */
export function periodKey(t: number, period: "day" | "week" | "month"): string {
  const d = new Date((t + 19800) * 1000);
  if (period === "month") return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  if (period === "week") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
