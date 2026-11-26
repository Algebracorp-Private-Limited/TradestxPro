/**
 * Built-in indicators: every indicator in TradestXPro's existing catalogue (lib/ta/catalog.ts),
 * exposed through the XChart definition interface. The maths is NOT duplicated: calculate()
 * calls the catalogue's compute(), which uses lib/ta/indicators.ts.
 */
import { INDICATORS, type Bar, type IndicatorDef, type Output, type ParamDef } from "../../ta/catalog.ts";
import * as S from "./incremental.ts";
import type { StreamOutput, StreamSpec } from "./types.ts";
import type { IndicatorDefinition, IndicatorInput, IndicatorParams, IndicatorResult, IndicatorSource, OutputDef, ParamSchema } from "./types.ts";

/** Indicators computed from one price series: they accept a `source` parameter (default close). */
const SOURCE_BASED = new Set(["sma", "ema", "wma", "hma", "bb", "rsi", "macd", "roc"]);

/**
 * Finite-memory windows (bars) for tail-only live updates. Indicators not listed here are
 * recursive (EMA/Wilder smoothing, cumulative sums, trailing stops) and are recalculated in full.
 */
const LOOKBACK: Record<string, (p: IndicatorParams) => number> = {
  sma: (p) => Number(p.length),
  wma: (p) => Number(p.length),
  hma: (p) => Number(p.length) + Math.ceil(Math.sqrt(Number(p.length))) + 1,
  bb: (p) => Number(p.length),
  donchian: (p) => Number(p.length),
  stoch: (p) => Number(p.k) + Number(p.smooth) + Number(p.d),
  cci: (p) => Number(p.length) * 2,
  willr: (p) => Number(p.length),
  roc: (p) => Number(p.length) + 1,
  mfi: (p) => Number(p.length) + 1,
  volume: (p) => Number(p.length),
};

function sourceSeries(i: IndicatorInput, s: IndicatorSource): number[] {
  switch (s) {
    case "open": return i.open;
    case "high": return i.high;
    case "low": return i.low;
    case "volume": return i.volume;
    case "hl2": return i.high.map((h, k) => (h + i.low[k]) / 2);
    case "hlc3": return i.high.map((h, k) => (h + i.low[k] + i.close[k]) / 3);
    case "ohlc4": return i.open.map((o, k) => (o + i.high[k] + i.low[k] + i.close[k]) / 4);
    default: return i.close;
  }
}

function toBars(i: IndicatorInput, close: number[]): Bar[] {
  const out: Bar[] = new Array(i.time.length);
  for (let k = 0; k < i.time.length; k++) out[k] = { t: i.time[k], o: i.open[k], h: i.high[k], l: i.low[k], c: close[k], v: i.volume[k] };
  return out;
}

/**
 * Catalogue bars per input object and source. A chart passes the SAME input object to every
 * indicator for one data version, so the conversion (≈10 ms per 100k bars) happens once per
 * version instead of once per indicator. WeakMap: entries go away with the input.
 */
const barCache = new WeakMap<IndicatorInput, { rev: number; bySource: Map<string, Bar[]> }>();
function barsFor(input: IndicatorInput, source: string, close: () => number[]): Bar[] {
  let m = barCache.get(input);
  const rev = input.revision ?? 0;
  if (!m || m.rev !== rev) barCache.set(input, (m = { rev, bySource: new Map() })); // arrays were updated in place
  let b = m.bySource.get(source);
  if (!b) m.bySource.set(source, (b = toBars(input, close())));
  return b;
}

function schema(p: ParamDef): ParamSchema {
  if (p.kind === "bool") return { key: p.key, label: p.label, type: "boolean", default: p.default === 1 };
  if (p.kind === "select") return { key: p.key, label: p.label, type: "select", default: p.options![p.default], options: p.options };
  const integer = p.step === undefined && Number.isInteger(p.default);
  return {
    key: p.key, label: p.label, type: integer ? "integer" : "number", default: p.default, min: p.min, max: p.max, step: p.step,
    aliases: p.key === "length" ? ["period"] : undefined,
  };
}

/** Catalogue parameters are numbers (selects = option index, booleans = 0/1). */
function toCatalogParams(def: IndicatorDef, p: IndicatorParams): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of def.params) {
    const v = p[d.key];
    if (d.kind === "bool") out[d.key] = v ? 1 : 0;
    else if (d.kind === "select") out[d.key] = Math.max(0, d.options!.indexOf(String(v)));
    else out[d.key] = Number(v);
  }
  return out;
}

// Deterministic synthetic sample used only to describe outputs and measure warm-up.
function sample(n: number): IndicatorInput {
  const time: number[] = [], open: number[] = [], high: number[] = [], low: number[] = [], close: number[] = [], volume: number[] = [];
  let p = 100;
  for (let k = 0; k < n; k++) {
    const o = p;
    const c = o + Math.sin(k / 7) * 1.5 + Math.cos(k / 3) * 0.7;
    time.push(1_600_000_000 + k * 86400); open.push(o); close.push(c);
    high.push(Math.max(o, c) + 1 + (k % 3) * 0.2); low.push(Math.min(o, c) - 1 - (k % 4) * 0.2); volume.push(1000 + ((k * 37) % 500));
    p = c;
  }
  return { time, open, high, low, close, volume, intraday: false };
}

function describe(def: IndicatorDef, outs: Output[], input: IndicatorInput): OutputDef[] {
  const named: Record<string, number[]> = { "@open": input.open, "@high": input.high, "@low": input.low, "@close": input.close };
  const same = (a: number[], b: number[]) => a === b || (a.length === b.length && a.every((v, k) => (Number.isNaN(v) && Number.isNaN(b[k])) || v === b[k]));
  return outs.map((o): OutputDef => ({
    key: o.key,
    label: o.label,
    type: (o.style === "histogram" ? "histogram" : o.style === "dots" ? "dots" : o.style === "area" ? "area" : "line") as OutputDef["type"],
    color: o.color,
    width: o.width,
    hist: o.hist ? { mode: o.hist.mode, colors: o.hist.colors } : undefined,
    fills: o.fills?.map((f) => {
      let w: string | number;
      if (typeof f.other === "number") w = f.other;
      else {
        const match = outs.find((x) => x !== o && same(x.values, f.other as number[]))?.key
          ?? Object.entries(named).find(([, arr]) => same(arr, f.other as number[]))?.[0];
        w = match ?? "@close";
      }
      return { id: f.id, label: f.label, with: w, up: f.up, down: f.down, opacity: f.opacity, only: f.only };
    }),
  }));
}

export type BuiltinDefinition = IndicatorDefinition & {
  /** Output metadata for specific parameters (catalogue outputs can depend on parameters). */
  describeOutputs(p: IndicatorParams): OutputDef[];
};

function wrap(def: IndicatorDef): BuiltinDefinition {
  const params: ParamSchema[] = def.params.map(schema);
  if (SOURCE_BASED.has(def.id)) params.push({ key: "source", label: "Source", type: "source", default: "close" });
  const defaults = Object.fromEntries(params.map((p) => [p.key, p.default])) as IndicatorParams;
  const calc = (input: IndicatorInput, p: IndicatorParams): { result: IndicatorResult; outs: Output[] } => {
    const src = SOURCE_BASED.has(def.id) ? ((p.source as IndicatorSource) ?? "close") : "close";
    const outs = def.compute(barsFor(input, src, () => sourceSeries(input, src)), toCatalogParams(def, p), { intraday: input.intraday });
    const result: IndicatorResult = {};
    for (const o of outs) result[o.key] = o.values;
    return { result, outs };
  };
  const describeCache = new Map<string, OutputDef[]>();
  const warmupCache = new Map<string, number>();
  const describeOutputs = (p: IndicatorParams) => {
    const k = JSON.stringify(p);
    let d = describeCache.get(k);
    if (!d) {
      const input = sample(300);
      d = describe(def, calc(input, p).outs, input);
      describeCache.set(k, d);
    }
    return d;
  };
  const levels = def.levels;
  return {
    id: def.id,
    name: def.name,
    description: `${def.name} (${def.category}). From the TradestXPro indicator catalogue.`,
    category: def.category,
    params,
    inputs: ["open", "high", "low", "close", "volume"],
    outputs: describeOutputs(defaults),
    describeOutputs,
    pane: def.pane,
    levels: typeof levels === "function" ? (p) => levels(toCatalogParams(def, { ...defaults, ...p })) : levels,
    range: def.range,
    /** Measured: index of the first value of the first output on a long synthetic series. */
    warmup(p) {
      const k = JSON.stringify(p);
      let w = warmupCache.get(k);
      if (w === undefined) {
        const lens = def.params.filter((x) => x.kind !== "bool" && x.kind !== "select").map((x) => Number(p[x.key]) || 0);
        const n = Math.max(400, ...lens.map((l) => l * 4 + 50));
        const r = calc(sample(n), p).outs[0];
        w = r ? r.values.findIndex((v) => Number.isFinite(v)) : 0;
        if (w < 0) w = n;
        warmupCache.set(k, w);
      }
      return w;
    },
    lookback: LOOKBACK[def.id],
    requires: def.id === "vwap" ? ["volume", "time"] : ["obv", "mfi", "volume"].includes(def.id) ? ["volume"] : [],
    calculate: (input, p) => calc(input, p).result,
    display: { shortName: def.short },
  };
}

export const BUILTIN_INDICATORS: BuiltinDefinition[] = INDICATORS.map(wrap);

// ---------- streaming forms (exact equivalents of lib/ta, see incremental.ts) ----------
const SRC_BY_CATALOG_INDEX: S.SourceName[] = ["hlc3", "close", "open", "high", "low", "hl2", "ohlc4"];

function builtinStream(id: string, P: Record<string, number>, srcName: S.SourceName, intraday: boolean): StreamSpec | null {
  const x = S.src(srcName);
  const hi = S.src("high"), lo = S.src("low"), cl = S.src("close");
  const out = (key: string, node: S.NodeDef, extra: Partial<StreamOutput> = {}): StreamOutput => ({ key, node, ...extra });
  const mid = (n: number) => S.map("mid", [S.highest(hi, n), S.lowest(lo, n)], ([a, b]) => (a + b) / 2);
  switch (id) {
    case "sma": return { outputs: [out("sma", S.sma(x, P.length))] };
    case "ema": return { outputs: [out("ema", S.ema(x, P.length))] };
    case "wma": return { outputs: [out("wma", S.wma(x, P.length))] };
    case "hma": {
      const n = P.length;
      const diff = S.map("hmaDiff", [S.wma(x, Math.max(1, Math.floor(n / 2))), S.wma(x, n)], ([h, f]) => 2 * h - f);
      return { outputs: [out("hma", S.wma(diff, Math.max(1, Math.round(Math.sqrt(n)))))] };
    }
    case "bb": {
      const m = S.sma(x, P.length), sd = S.stdev(x, P.length), k = P.mult;
      return { outputs: [out("upper", S.map(`plus*${k}`, [m, sd], ([a, b]) => a + k * b)), out("mid", m), out("lower", S.map(`minus*${k}`, [m, sd], ([a, b]) => a - k * b))] };
    }
    case "keltner": {
      const m = S.ema(cl, P.length), a = S.atr(P.atr), k = P.mult;
      return { outputs: [out("upper", S.map(`plus*${k}`, [m, a], ([u, v]) => u + k * v)), out("mid", m), out("lower", S.map(`minus*${k}`, [m, a], ([u, v]) => u - k * v))] };
    }
    case "donchian": {
      const u = S.highest(hi, P.length), l = S.lowest(lo, P.length);
      return { outputs: [out("upper", u), out("mid", S.map("avg2", [u, l], ([a, b]) => (a + b) / 2)), out("lower", l)] };
    }
    case "supertrend": {
      const line = S.supertrendLine(P.length, P.mult), dir = S.aux(line);
      return { outputs: [out("up", S.map("ifDir1", [line, dir], ([v, d]) => (d === 1 ? v : NaN))), out("down", S.map("ifDirM1", [line, dir], ([v, d]) => (d === -1 ? v : NaN)))] };
    }
    case "psar": return { outputs: [out("sar", S.psar(P.step, P.max))] };
    case "vwap": {
      if (P.hideDaily && !intraday) return { outputs: [] };
      const anchor = (["session", "week", "month"] as const)[P.anchor] ?? "session";
      const v = S.vwap(S.src(SRC_BY_CATALOG_INDEX[P.source] ?? "hlc3"), anchor), sd = S.aux(v);
      const pct = P.bandsMode === 1;
      const sh = Math.round(P.offset);
      const outs: StreamOutput[] = [out("vwap", v, { shift: sh })];
      for (const k of [1, 2, 3]) {
        if (!P[`band${k}`]) continue;
        const m = P[`mult${k}`];
        const band = (sign: 1 | -1) => S.map(`vwapBand${pct ? "%" : "sd"}${sign * m}`, [v, sd], ([a, b]) => (pct ? a * (1 + (sign * m) / 100) : a + sign * m * b));
        outs.push(out(`up${k}`, band(1), { shift: sh }), out(`lo${k}`, band(-1), { shift: sh }));
      }
      return { outputs: outs };
    }
    case "ichimoku": {
      const t = mid(P.conv), k = mid(P.base), a = S.map("avg2", [t, k], ([p, q]) => (p + q) / 2), b = mid(P.spanB);
      const off = Math.max(0, Math.round(P.disp) - 1);
      const outs: StreamOutput[] = [out("tenkan", t), out("kijun", k), out("spanA", a, { shift: off, projection: true }), out("spanB", b, { shift: off, projection: true })];
      if (P.chikou) outs.push(out("chikou", cl, { shift: -off }));
      return { outputs: outs };
    }
    case "rsi": {
      const mv = S.moves(x), au = S.rma(mv, P.length), ad = S.rma(S.aux(mv), P.length);
      return { outputs: [out("rsi", S.map("rsi", [au, ad], ([u, d]) => (Number.isNaN(u) || Number.isNaN(d) ? NaN : d === 0 ? (u === 0 ? 50 : 100) : 100 - 100 / (1 + u / d))))] };
    }
    case "macd": {
      const line = S.map("sub", [S.ema(x, P.fast), S.ema(x, P.slow)], ([f, sl]) => f - sl), sig = S.ema(line, P.signal);
      return { outputs: [out("hist", S.map("sub", [line, sig], ([a, b]) => a - b)), out("macd", line), out("signal", sig)] };
    }
    case "stoch": {
      const raw = S.map("stochRaw", [cl, S.highest(hi, P.k), S.lowest(lo, P.k)], ([c, h, l]) => (h === l ? 50 : (100 * (c - l)) / (h - l)));
      const k = S.sma(raw, P.smooth);
      return { outputs: [out("k", k), out("d", S.sma(k, P.d))] };
    }
    case "adx": {
      const atrS = S.rma(S.trueRange(true), P.length);
      const di = (dm: S.NodeDef) => S.map("di", [S.rma(dm, P.length), atrS], ([v, a]) => (100 * v) / a);
      const pdi = di(S.plusDM()), mdi = di(S.minusDM());
      const dx = S.map("dx", [pdi, mdi], ([p, m]) => {
        const s = p + m;
        return s === 0 ? 0 : (100 * Math.abs(p - m)) / s;
      });
      return { outputs: [out("adx", S.rma(dx, P.length)), out("pdi", pdi), out("mdi", mdi)] };
    }
    case "atr": return { outputs: [out("atr", S.atr(P.length))] };
    case "cci": return { outputs: [out("cci", S.cci(P.length))] };
    case "mfi": return { outputs: [out("mfi", S.mfi(P.length))] };
    case "willr": {
      const hh = S.highest(hi, P.length), ll = S.lowest(lo, P.length);
      return { outputs: [out("wr", S.map("willr", [cl, hh, ll], ([c, h, l]) => (h === l ? -50 : (-100 * (h - c)) / (h - l))))] };
    }
    case "roc": return { outputs: [out("roc", S.roc(x, P.length))] };
    case "obv": return { outputs: [out("obv", S.obv())] };
    case "volume": {
      const v = S.src("volume");
      return { outputs: [out("vol", v), out("ma", S.sma(v, P.length))], activeWhen: S.anyPositive(v) };
    }
  }
  return null;
}

for (const b of BUILTIN_INDICATORS) {
  const cat = INDICATORS.find((d) => d.id === b.id)!;
  if (!builtinStream(b.id, toCatalogParams(cat, Object.fromEntries(b.params.map((p) => [p.key, p.default]))), "close", true)) continue;
  b.stream = (p, ctx) => builtinStream(b.id, toCatalogParams(cat, p), SOURCE_BASED.has(b.id) ? ((p.source as S.SourceName) ?? "close") : "close", ctx.intraday)!;
}
