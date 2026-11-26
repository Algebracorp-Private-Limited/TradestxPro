/**
 * Streaming builders for price-based chart types. Each builder consumes source candles one at a
 * time and keeps a small, cloneable state, so a live update of the LAST candle is handled by
 * restoring the state from before that candle and processing it again (O(1)), and a new candle
 * commits the previous one. Builders never look ahead: a point depends only on candles up to and
 * including its source candle.
 *
 * Intrabar path assumption (used by "high-low" sources and range bars): OHLC data does not say
 * whether the high or the low came first. We assume open → low → high → close for rising candles
 * (close ≥ open) and open → high → low → close for falling candles. Points built this way are
 * flagged `reconstructed: true`; they are a model of the candle, not observed trades.
 */
import { XChartError, isCssColor } from "../validation.ts";
import type { DerivedKind, DerivedPoint, DerivedSettingsMap, KagiSettings, LineBreakSettings, PnfSettings, PriceSource, RangeBarSettings, RenkoSettings, SourceCandle } from "./types.ts";

export const PATH_ASSUMPTION = "Intrabar path assumed open → low → high → close for rising candles and open → high → low → close for falling candles; OHLC data does not record the true order.";

type Emit = Omit<DerivedPoint, "id" | "logical" | "seq" | "status" | "sourceTime" | "sourceIndex" | "sourceClose">;

export interface Builder {
  /** Processes one candle and returns the points it completes. */
  process(c: SourceCandle, index: number): Emit[];
  /** Points that are open / still extendable after the last processed candle (e.g. the last Kagi line). */
  open(): Emit[];
  clone(): Builder;
  /** Size in use (for the methodology note / tests). */
  readonly label: string;
}

// ---------- shared helpers ----------
function pathOf(c: SourceCandle, source: PriceSource): number[] {
  switch (source) {
    case "hl2": return [(c.high + c.low) / 2];
    case "hlc3": return [(c.high + c.low + c.close) / 3];
    case "ohlc4": return [(c.open + c.high + c.low + c.close) / 4];
    case "high-low": return c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
    default: return [c.close];
  }
}

/** Wilder ATR, causal: value() is the ATR of the candles pushed so far (NaN during warm-up). */
class CausalAtr {
  n: number;
  count = 0;
  prevClose = NaN;
  sum = 0;
  atr = NaN;
  constructor(n: number) {
    this.n = n;
  }
  push(c: SourceCandle) {
    const tr = Number.isFinite(this.prevClose) ? Math.max(c.high - c.low, Math.abs(c.high - this.prevClose), Math.abs(c.low - this.prevClose)) : c.high - c.low;
    this.prevClose = c.close;
    this.count++;
    if (this.count <= this.n) {
      this.sum += tr;
      if (this.count === this.n) this.atr = this.sum / this.n;
    } else this.atr = (this.atr * (this.n - 1) + tr) / this.n;
  }
  value() {
    return this.atr;
  }
  clone() {
    const a = new CausalAtr(this.n);
    Object.assign(a, this);
    return a;
  }
}

/**
 * Size provider. fixed: constant. percentage: pct of a reference price given by the caller.
 * atr: ATR of the candles BEFORE the current one (known when the candle starts — no look-ahead).
 */
class SizeRule {
  method: string;
  value: number;
  atr: CausalAtr | null;
  constructor(method: string, value: number, atrPeriod: number) {
    this.method = method;
    this.value = value;
    this.atr = method === "atr" ? new CausalAtr(atrPeriod) : null;
  }
  /** Size for the current candle, before it is pushed. NaN while the ATR warms up. */
  size(ref: number): number {
    if (this.method === "percentage") return (Math.abs(ref) * this.value) / 100;
    if (this.method === "atr") return this.atr!.value() * this.value;
    return this.value;
  }
  after(c: SourceCandle) {
    this.atr?.push(c);
  }
  clone() {
    const s = new SizeRule(this.method, this.value, 1);
    s.atr = this.atr ? this.atr.clone() : null;
    return s;
  }
}

// ---------- Renko ----------
class RenkoBuilder implements Builder {
  s: Required<RenkoSettings>;
  rule: SizeRule;
  last: { open: number; close: number; dir: 1 | -1 } | null = null;
  base = NaN; // first price before any brick
  lo = Infinity;
  hi = -Infinity;
  constructor(s: Required<RenkoSettings>) {
    this.s = s;
    this.rule = new SizeRule(s.method, s.size, s.atrPeriod);
  }
  get label() {
    return `${this.s.method} ${this.s.size}${this.s.method === "percentage" ? "%" : this.s.method === "atr" ? `× ATR(${this.s.atrPeriod})` : ""}`;
  }
  process(c: SourceCandle): Emit[] {
    const out: Emit[] = [];
    const recon = this.s.source === "high-low";
    for (const price of pathOf(c, this.s.source)) {
      if (!Number.isFinite(this.base) && !this.last) this.base = price;
      this.lo = Math.min(this.lo, price);
      this.hi = Math.max(this.hi, price);
      for (let guard = 0; guard < 100_000; guard++) {
        const ref = this.last ? this.last.close : this.base;
        const size = this.rule.size(ref);
        if (!(size > 0)) break; // ATR warm-up: no bricks yet
        const L = this.last;
        const rev = this.s.reversal;
        let o: number | null = null, cl = 0, dir: 1 | -1 = 1;
        if (!L) {
          if (price >= this.base + size) [o, cl, dir] = [this.base, this.base + size, 1];
          else if (price <= this.base - size) [o, cl, dir] = [this.base, this.base - size, -1];
        } else if (L.dir === 1) {
          if (price >= L.close + size) [o, cl, dir] = [L.close, L.close + size, 1];
          else if (price <= L.close - rev * size) [o, cl, dir] = [L.close - (rev - 1) * size, L.close - rev * size, -1];
        } else {
          if (price <= L.close - size) [o, cl, dir] = [L.close, L.close - size, -1];
          else if (price >= L.close + rev * size) [o, cl, dir] = [L.close + (rev - 1) * size, L.close + rev * size, 1];
        }
        if (o === null) break;
        const wick = this.s.wicks;
        out.push({
          open: o, close: cl, direction: dir, size, reconstructed: recon,
          high: dir === 1 ? cl : wick ? Math.max(o, this.hi) : o,
          low: dir === 1 ? (wick ? Math.min(o, this.lo) : o) : cl,
        });
        this.last = { open: o, close: cl, dir };
        this.lo = this.hi = cl;
      }
    }
    this.rule.after(c);
    return out;
  }
  open() {
    return [];
  }
  clone(): Builder {
    const b = new RenkoBuilder(this.s);
    Object.assign(b, { rule: this.rule.clone(), last: this.last && { ...this.last }, base: this.base, lo: this.lo, hi: this.hi });
    return b;
  }
}

// ---------- Kagi ----------
type KagiLine = { from: number; to: number; up: boolean; thickStart: boolean; thickEnd: boolean; switchPrice?: number };
class KagiBuilder implements Builder {
  s: Required<KagiSettings>;
  rule: SizeRule;
  start = NaN;
  line: KagiLine | null = null;
  thick = true;
  shoulder = NaN;
  waist = NaN;
  constructor(s: Required<KagiSettings>) {
    this.s = s;
    this.rule = new SizeRule(s.method, s.reversal, s.atrPeriod);
  }
  get label() {
    return `reversal ${this.s.method} ${this.s.reversal}`;
  }
  private check(L: KagiLine) {
    // Yang (thick) when a rising line exceeds the previous shoulder; yin (thin) when a falling line breaks the previous waist.
    if (L.up && !L.thickEnd && Number.isFinite(this.shoulder) && L.to > this.shoulder) {
      L.thickEnd = true;
      L.switchPrice = this.shoulder;
    } else if (!L.up && L.thickEnd && Number.isFinite(this.waist) && L.to < this.waist) {
      L.thickEnd = false;
      L.switchPrice = this.waist;
    }
    this.thick = L.thickEnd;
  }
  process(c: SourceCandle): Emit[] {
    const out: Emit[] = [];
    for (const price of pathOf(c, this.s.source)) {
      if (!Number.isFinite(this.start)) {
        this.start = price;
        continue;
      }
      const L = this.line;
      const amt = this.rule.size(L ? L.to : this.start);
      if (!L) {
        if (amt > 0 && Math.abs(price - this.start) >= amt) {
          const up = price > this.start;
          this.thick = up;
          this.line = { from: this.start, to: price, up, thickStart: up, thickEnd: up };
        }
        continue;
      }
      if ((L.up && price > L.to) || (!L.up && price < L.to)) {
        L.to = price;
        this.check(L);
      } else if (amt > 0 && Math.abs(price - L.to) >= amt) {
        out.push(this.emit(L));
        if (L.up) this.shoulder = L.to;
        else this.waist = L.to;
        const nl: KagiLine = { from: L.to, to: price, up: !L.up, thickStart: this.thick, thickEnd: this.thick };
        this.line = nl;
        this.check(nl);
      }
    }
    this.rule.after(c);
    return out;
  }
  private emit(L: KagiLine): Emit {
    return {
      open: L.from, close: L.to, high: Math.max(L.from, L.to), low: Math.min(L.from, L.to), direction: L.up ? 1 : -1, reconstructed: false,
      thickStart: L.thickStart, thickEnd: L.thickEnd, ...(L.switchPrice !== undefined ? { switchPrice: L.switchPrice } : {}),
    };
  }
  open() {
    return this.line ? [this.emit(this.line)] : [];
  }
  clone(): Builder {
    const b = new KagiBuilder(this.s);
    Object.assign(b, { rule: this.rule.clone(), start: this.start, line: this.line && { ...this.line }, thick: this.thick, shoulder: this.shoulder, waist: this.waist });
    return b;
  }
}

// ---------- Point & Figure ----------
class PnfBuilder implements Builder {
  s: Required<PnfSettings>;
  atr: CausalAtr | null;
  box = NaN; // fixed/atr box size; percentage uses ratio
  ratio = NaN;
  origin = NaN; // percentage: price of box 0
  ref = NaN; // box index of the first price
  col: { x: boolean; low: number; high: number } | null = null;
  constructor(s: Required<PnfSettings>) {
    this.s = s;
    this.atr = s.method === "atr" ? new CausalAtr(s.atrPeriod) : null;
    if (s.method === "fixed") this.box = s.boxSize;
    if (s.method === "percentage") this.ratio = 1 + s.boxSize / 100;
  }
  get label() {
    return `box ${this.s.method} ${this.s.boxSize}, ${this.s.reversal}-box reversal`;
  }
  ready() {
    return this.s.method === "percentage" ? Number.isFinite(this.origin) : this.box > 0;
  }
  level(k: number): number {
    return this.s.method === "percentage" ? this.origin * Math.pow(this.ratio, k) : k * this.box;
  }
  /** Highest box index whose level ≤ price (floating-point safe). */
  floorK(p: number): number {
    const raw = this.s.method === "percentage" ? Math.log(p / this.origin) / Math.log(this.ratio) : p / this.box;
    let k = Math.floor(raw + 1e-9);
    while (this.level(k + 1) <= p + 1e-12 * Math.abs(p)) k++;
    while (this.level(k) > p + 1e-12 * Math.abs(p)) k--;
    return k;
  }
  ceilK(p: number): number {
    const f = this.floorK(p);
    return Math.abs(this.level(f) - p) <= 1e-12 * Math.max(1, Math.abs(p)) ? f : f + 1;
  }
  private emit(): Emit {
    const c = this.col!;
    const lo = this.level(c.low), hi = this.level(c.high);
    return {
      open: c.x ? lo : hi, close: c.x ? hi : lo, high: hi, low: lo, direction: c.x ? 1 : -1, reconstructed: false,
      lowBox: c.low, highBox: c.high, boxes: c.high - c.low + 1, size: this.s.method === "percentage" ? this.s.boxSize : this.box,
    };
  }
  /** Feeds one price; returns a completed column when a reversal starts a new one. */
  private step(up: number | null, down: number | null): Emit | null {
    const N = this.s.reversal;
    const c = this.col;
    if (!c) {
      if (up !== null && up >= this.level(this.ref + 1)) this.col = { x: true, low: this.ref + 1, high: this.floorK(up) };
      else if (down !== null && down <= this.level(this.ref - 1)) this.col = { x: false, high: this.ref - 1, low: this.ceilK(down) };
      return null;
    }
    if (c.x) {
      if (up !== null && up >= this.level(c.high + 1)) {
        c.high = this.floorK(up);
        return null;
      }
      if (down !== null && down <= this.level(c.high - N)) {
        const done = this.emit();
        this.col = { x: false, high: c.high - 1, low: this.ceilK(down) };
        return done;
      }
    } else {
      if (down !== null && down <= this.level(c.low - 1)) {
        c.low = this.ceilK(down);
        return null;
      }
      if (up !== null && up >= this.level(c.low + N)) {
        const done = this.emit();
        this.col = { x: true, low: c.low + 1, high: this.floorK(up) };
        return done;
      }
    }
    return null;
  }
  process(c: SourceCandle): Emit[] {
    const out: Emit[] = [];
    if (this.s.method === "atr" && !(this.box > 0)) {
      // ATR boxes: the size is fixed once, from the first available ATR (known before this candle).
      const a = this.atr!.value();
      if (a > 0) this.box = a * this.s.boxSize; // boxSize is the ATR multiplier
    }
    if (this.s.method === "percentage" && !Number.isFinite(this.origin)) this.origin = c.close > 0 ? c.close : NaN;
    if (this.ready()) {
      if (!Number.isFinite(this.ref)) this.ref = this.floorK(c.close);
      else if (this.s.source === "close") {
        const d = this.step(c.close, c.close);
        if (d) out.push(d);
      } else {
        // High-low (Dorsey convention): in X columns test the high for extension first, then the low
        // for a reversal; in O columns the low first, then the high. One action per candle.
        const col = this.col;
        let d: Emit | null = null;
        if (!col || col.x) {
          const before = col ? col.high : null;
          d = this.step(c.high, null);
          if (!d && (!this.col || this.col.high === before)) d = this.step(null, c.low);
        } else {
          const before = col.low;
          d = this.step(null, c.low);
          if (!d && this.col!.low === before) d = this.step(c.high, null);
        }
        if (d) out.push(d);
      }
    }
    this.atr?.push(c);
    return out;
  }
  open() {
    return this.col ? [this.emit()] : [];
  }
  clone(): Builder {
    const b = new PnfBuilder(this.s);
    Object.assign(b, { atr: this.atr?.clone() ?? null, box: this.box, ratio: this.ratio, origin: this.origin, ref: this.ref, col: this.col && { ...this.col } });
    return b;
  }
}

// ---------- Line Break ----------
class LineBreakBuilder implements Builder {
  s: Required<LineBreakSettings>;
  first = NaN;
  lines: { open: number; close: number; up: boolean }[] = [];
  constructor(s: Required<LineBreakSettings>) {
    this.s = s;
  }
  get label() {
    return `${this.s.lines}-line break`;
  }
  process(c: SourceCandle): Emit[] {
    const [price] = pathOf(c, this.s.source);
    if (!Number.isFinite(this.first)) {
      this.first = price;
      return [];
    }
    const L = this.lines;
    let next: { open: number; close: number; up: boolean; reversal: boolean } | null = null;
    if (!L.length) {
      if (price !== this.first) next = { open: this.first, close: price, up: price > this.first, reversal: false };
    } else {
      const cur = L[L.length - 1];
      const recent = L.slice(-this.s.lines);
      const hi = Math.max(...recent.map((l) => Math.max(l.open, l.close)));
      const lo = Math.min(...recent.map((l) => Math.min(l.open, l.close)));
      if (cur.up && price > cur.close) next = { open: cur.close, close: price, up: true, reversal: false };
      else if (!cur.up && price < cur.close) next = { open: cur.close, close: price, up: false, reversal: false };
      else if (cur.up && price < lo) next = { open: cur.open, close: price, up: false, reversal: true };
      else if (!cur.up && price > hi) next = { open: cur.open, close: price, up: true, reversal: true };
    }
    if (!next) return [];
    L.push({ open: next.open, close: next.close, up: next.up });
    if (L.length > this.s.lines + 1) L.shift(); // only the last N lines matter
    return [{ open: next.open, close: next.close, high: Math.max(next.open, next.close), low: Math.min(next.open, next.close), direction: next.up ? 1 : -1, reversal: next.reversal, reconstructed: false }];
  }
  open() {
    return [];
  }
  clone(): Builder {
    const b = new LineBreakBuilder(this.s);
    b.first = this.first;
    b.lines = this.lines.map((l) => ({ ...l }));
    return b;
  }
}

// ---------- Range bars ----------
class RangeBarBuilder implements Builder {
  s: Required<RangeBarSettings>;
  rule: SizeRule;
  cur: { open: number; high: number; low: number; close: number } | null = null;
  constructor(s: Required<RangeBarSettings>) {
    this.s = s;
    const method = s.method === "ticks" ? "fixed" : s.method;
    this.rule = new SizeRule(method, s.method === "ticks" ? s.range * s.tickSize : s.range, s.atrPeriod);
  }
  get label() {
    return this.s.method === "ticks" ? `${this.s.range} ticks × ${this.s.tickSize}` : `${this.s.method} ${this.s.range}`;
  }
  private bar(b: { open: number; high: number; low: number; close: number }, complete: boolean, size: number): Emit {
    return { ...b, direction: b.close >= b.open ? 1 : -1, reconstructed: true, complete, size };
  }
  process(c: SourceCandle): Emit[] {
    const out: Emit[] = [];
    const size = this.rule.size(this.cur ? this.cur.open : c.open);
    if (!(size > 0)) {
      this.rule.after(c);
      return out;
    }
    // A gap between candles is a jump, not a sequence of trades: close the bar at its last price.
    if (this.cur && c.open !== this.cur.close && (c.open > this.cur.low + size || c.open < this.cur.high - size)) {
      out.push(this.bar(this.cur, true, size));
      this.cur = null;
    }
    for (const p of pathOf(c, "high-low")) {
      if (!this.cur) {
        this.cur = { open: p, high: p, low: p, close: p };
        continue;
      }
      for (let guard = 0; guard < 100_000; guard++) {
        const b: { open: number; high: number; low: number; close: number } = this.cur!;
        if (p > b.low + size) {
          const top = b.low + size;
          out.push(this.bar({ ...b, high: top, close: top }, true, size));
          this.cur = { open: top, high: top, low: top, close: top };
        } else if (p < b.high - size) {
          const bot = b.high - size;
          out.push(this.bar({ ...b, low: bot, close: bot }, true, size));
          this.cur = { open: bot, high: bot, low: bot, close: bot };
        } else break;
      }
      const b = this.cur!;
      b.high = Math.max(b.high, p);
      b.low = Math.min(b.low, p);
      b.close = p;
    }
    this.rule.after(c);
    return out;
  }
  open() {
    return this.cur ? [this.bar(this.cur, false, this.rule.size(this.cur.open))] : [];
  }
  clone(): Builder {
    const b = new RangeBarBuilder(this.s);
    b.rule = this.rule.clone();
    b.cur = this.cur && { ...this.cur };
    return b;
  }
}

// ---------- settings ----------
const DEFAULTS: { [K in DerivedKind]: Required<DerivedSettingsMap[K]> } = {
  renko: { method: "fixed", size: 1, atrPeriod: 14, reversal: 2, source: "close", wicks: false, showProvisional: true, upColor: "#22c55e", downColor: "#ef4444" },
  kagi: { method: "fixed", reversal: 1, atrPeriod: 14, source: "close", yangWidth: 3, yinWidth: 1, upColor: "#22c55e", downColor: "#ef4444", showProvisional: true },
  "point-and-figure": { method: "fixed", boxSize: 1, atrPeriod: 14, reversal: 3, source: "close", columnSpacing: 1, xColor: "#22c55e", oColor: "#ef4444", showProvisional: true },
  "line-break": { lines: 3, source: "close", upColor: "#22c55e", downColor: "#ef4444", showProvisional: true },
  "range-bars": { method: "fixed", range: 1, tickSize: 0.05, atrPeriod: 14, wicks: true, upColor: "#22c55e", downColor: "#ef4444", showProvisional: true },
};

const ALLOWED: Record<DerivedKind, Record<string, "number" | "int" | "bool" | "color" | string[]>> = {
  renko: { method: ["fixed", "percentage", "atr"], size: "number", atrPeriod: "int", reversal: "int", source: ["close", "hl2", "hlc3", "ohlc4", "high-low"], wicks: "bool", showProvisional: "bool", upColor: "color", downColor: "color" },
  kagi: { method: ["fixed", "percentage", "atr"], reversal: "number", atrPeriod: "int", source: ["close", "hl2", "hlc3", "ohlc4"], yangWidth: "number", yinWidth: "number", upColor: "color", downColor: "color", showProvisional: "bool" },
  "point-and-figure": { method: ["fixed", "percentage", "atr"], boxSize: "number", atrPeriod: "int", reversal: "int", source: ["close", "high-low"], columnSpacing: "number", xColor: "color", oColor: "color", showProvisional: "bool" },
  "line-break": { lines: "int", source: ["close", "hl2", "hlc3", "ohlc4"], upColor: "color", downColor: "color", showProvisional: "bool" },
  "range-bars": { method: ["fixed", "ticks", "percentage", "atr"], range: "number", tickSize: "number", atrPeriod: "int", wicks: "bool", upColor: "color", downColor: "color", showProvisional: "bool" },
};

/** Validates settings (atomic: throws before anything changes) and applies defaults. */
export function resolveSettings<K extends DerivedKind>(kind: K, s: unknown): Required<DerivedSettingsMap[K]> {
  if (s !== undefined && (!s || typeof s !== "object" || Array.isArray(s))) throw new XChartError("INVALID_OPTION", `${kind} settings must be an object`);
  const o = (s ?? {}) as Record<string, unknown>;
  const spec = ALLOWED[kind];
  for (const [k, v] of Object.entries(o)) {
    const t = spec[k];
    if (!t) throw new XChartError("INVALID_OPTION", `Unknown ${kind} setting "${k}"`);
    if (v === undefined) continue;
    const bad = (why: string) => {
      throw new XChartError("INVALID_OPTION", `${kind} setting "${k}" ${why} (got ${JSON.stringify(v)})`);
    };
    if (Array.isArray(t)) {
      if (!t.includes(v as string)) bad(`must be one of ${t.join(", ")}`);
    } else if (t === "bool") {
      if (typeof v !== "boolean") bad("must be a boolean");
    } else if (t === "color") {
      if (!isCssColor(v)) bad("must be a CSS colour");
    } else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || (t === "int" && !Number.isInteger(v))) bad(t === "int" ? "must be a positive integer" : "must be a positive number");
  }
  const r = { ...DEFAULTS[kind], ...o } as Required<DerivedSettingsMap[K]> & Record<string, unknown>;
  const lim = (k: string, max: number) => {
    if (typeof r[k] === "number" && (r[k] as number) > max) throw new XChartError("INVALID_OPTION", `${kind} setting "${k}" must be ≤ ${max}`);
  };
  lim("atrPeriod", 500);
  lim("reversal", kind === "kagi" ? 1e9 : 20);
  lim("lines", 20);
  lim("yangWidth", 12);
  lim("yinWidth", 12);
  lim("columnSpacing", 4);
  if ((r.method === "percentage") && ((r.size ?? r.boxSize ?? r.range ?? r.reversal) as number) > 50) throw new XChartError("INVALID_OPTION", `${kind}: a percentage size must be ≤ 50`);
  return r;
}

export function createBuilder(kind: DerivedKind, settings: Required<DerivedSettingsMap[DerivedKind]>): Builder {
  switch (kind) {
    case "renko": return new RenkoBuilder(settings as Required<RenkoSettings>);
    case "kagi": return new KagiBuilder(settings as Required<KagiSettings>);
    case "point-and-figure": return new PnfBuilder(settings as Required<PnfSettings>);
    case "line-break": return new LineBreakBuilder(settings as Required<LineBreakSettings>);
    default: return new RangeBarBuilder(settings as Required<RangeBarSettings>);
  }
}

export function methodology(kind: DerivedKind, s: Record<string, unknown>): string {
  const atr = `ATR(${s.atrPeriod}) is Wilder's ATR of the candles BEFORE the current one (causal: no look-ahead); before ${s.atrPeriod} candles exist no ${kind === "kagi" ? "reversal" : "brick"} can form.`;
  switch (kind) {
    case "renko":
      return `Renko from ${s.source === "high-low" ? "the reconstructed OHLC path. " + PATH_ASSUMPTION : `the ${s.source} price`}. Brick size: ${s.method === "fixed" ? `${s.size} price units` : s.method === "percentage" ? `${s.size}% of the previous brick close (set when each brick starts)` : `${s.size} × ATR. ${atr} Each brick keeps the size in force when it formed; historical bricks are NOT recalculated when the ATR later changes`}. A reversal needs ${s.reversal} brick(s) of movement against the trend.`;
    case "kagi":
      return `Kagi on the ${s.source} price. Reversal amount: ${s.method === "fixed" ? `${s.reversal} price units` : s.method === "percentage" ? `${s.reversal}% of the current line end` : `${s.reversal} × ATR. ${atr}`}. A line turns thick (yang) when it rises above the previous shoulder and thin (yin) when it falls below the previous waist; the first line is yang if rising.`;
    case "point-and-figure":
      return `Point & Figure, ${s.reversal}-box reversal, ${s.source === "close" ? "closing prices" : "high/low method (Dorsey convention: in an X column the high is tested for extension first and the low for reversal only if the column did not extend; mirrored for O columns — one action per candle; the true intrabar order is not known)"}. Boxes: ${s.method === "fixed" ? `${s.boxSize} price units` : s.method === "percentage" ? `${s.boxSize}% (logarithmic boxes from the first close)` : `${s.boxSize} × ATR(${s.atrPeriod}) at the first candle where it is available, then fixed for the whole chart (no look-ahead, no historical recalculation)`}.`;
    case "line-break":
      return `${s.lines}-line break on the ${s.source} price: a new line in the trend direction when the price exceeds the last line; a reversal line only when the price breaks the extreme of the last ${s.lines} lines.`;
    default:
      return `Range bars of ${s.method === "ticks" ? `${s.range} ticks of ${s.tickSize}` : s.method === "fixed" ? `${s.range} price units` : s.method === "percentage" ? `${s.range}% of the bar open` : `${s.range} × ATR (${atr})`} built from OHLC candles, not ticks: ${PATH_ASSUMPTION} Every bar is flagged "reconstructed". A gap between candles closes the current bar at its last price (no bars are invented inside a gap). True range bars require tick data.`;
  }
}
