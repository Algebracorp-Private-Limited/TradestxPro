/**
 * Built-in indicators: every indicator in TradestXPro's existing catalogue (lib/ta/catalog.ts),
 * exposed through the XChart definition interface. The maths is NOT duplicated: calculate()
 * calls the catalogue's compute(), which uses lib/ta/indicators.ts.
 */
import { INDICATORS, type Bar, type IndicatorDef, type Output, type ParamDef } from "../../ta/catalog.ts";
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
const barCache = new WeakMap<IndicatorInput, Map<string, Bar[]>>();
function barsFor(input: IndicatorInput, source: string, close: () => number[]): Bar[] {
  let m = barCache.get(input);
  if (!m) barCache.set(input, (m = new Map()));
  let b = m.get(source);
  if (!b) m.set(source, (b = toBars(input, close())));
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
    calculate: (input, p) => calc(input, p).result,
    display: { shortName: def.short },
  };
}

export const BUILTIN_INDICATORS: BuiltinDefinition[] = INDICATORS.map(wrap);
