// Indicator catalogue: metadata + compute functions used by charts, the screener and XScript.
import * as ta from "./indicators";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Output = {
  key: string;
  label: string;
  values: number[];
  color: string;
  style?: "line" | "histogram" | "dots" | "area";
};

/** Every parameter is stored as a number: selects store the option index, checkboxes store 0/1. */
export type ParamDef = {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  kind?: "number" | "select" | "bool";
  options?: string[];
  group?: string;
};

export type ComputeContext = { intraday: boolean };

export type IndicatorDef = {
  id: string;
  name: string;
  short: string;
  pane: "overlay" | "separate";
  category: "Trend" | "Momentum" | "Volatility" | "Volume";
  params: ParamDef[];
  levels?: number[];
  range?: [number, number];
  compute: (bars: Bar[], p: Record<string, number>, ctx: ComputeContext) => Output[];
};

const cols = (bars: Bar[]) => ({
  o: bars.map((b) => b.o),
  h: bars.map((b) => b.h),
  l: bars.map((b) => b.l),
  c: bars.map((b) => b.c),
  v: bars.map((b) => b.v),
  t: bars.map((b) => b.t),
});

export const SOURCE_NAMES = ["(H + L + C)/3", "Close", "Open", "High", "Low", "(H + L)/2", "(O + H + L + C)/4"];
function sourceSeries(x: ReturnType<typeof cols>, idx: number): number[] {
  switch (idx) {
    case 1: return x.c;
    case 2: return x.o;
    case 3: return x.h;
    case 4: return x.l;
    case 5: return x.h.map((h, i) => (h + x.l[i]) / 2);
    case 6: return x.o.map((o, i) => (o + x.h[i] + x.l[i] + x.c[i]) / 4);
    default: return x.h.map((h, i) => (h + x.l[i] + x.c[i]) / 3);
  }
}

const len = (key = "length", def = 14, label = "Length"): ParamDef => ({ key, label, default: def, min: 1, max: 500 });
const mult = (def = 2, key = "mult", label = "Multiplier"): ParamDef => ({ key, label, default: def, min: 0.1, max: 10, step: 0.1 });

export const PALETTE = ["#38bdf8", "#f5c451", "#a78bfa", "#f472b6", "#34d399", "#fb923c", "#60a5fa", "#e879f9"];

export const INDICATORS: IndicatorDef[] = [
  {
    id: "sma", name: "Simple Moving Average", short: "SMA", pane: "overlay", category: "Trend", params: [len("length", 20)],
    compute: (b, p) => [{ key: "sma", label: `SMA ${p.length}`, values: ta.sma(cols(b).c, p.length), color: "#f5c451" }],
  },
  {
    id: "ema", name: "Exponential Moving Average", short: "EMA", pane: "overlay", category: "Trend", params: [len("length", 20)],
    compute: (b, p) => [{ key: "ema", label: `EMA ${p.length}`, values: ta.ema(cols(b).c, p.length), color: "#38bdf8" }],
  },
  {
    id: "wma", name: "Weighted Moving Average", short: "WMA", pane: "overlay", category: "Trend", params: [len("length", 20)],
    compute: (b, p) => [{ key: "wma", label: `WMA ${p.length}`, values: ta.wma(cols(b).c, p.length), color: "#a78bfa" }],
  },
  {
    id: "hma", name: "Hull Moving Average", short: "HMA", pane: "overlay", category: "Trend", params: [len("length", 21)],
    compute: (b, p) => [{ key: "hma", label: `HMA ${p.length}`, values: ta.hma(cols(b).c, p.length), color: "#f472b6" }],
  },
  {
    id: "bb", name: "Bollinger Bands", short: "BB", pane: "overlay", category: "Volatility", params: [len("length", 20), mult(2)],
    compute: (b, p) => {
      const r = ta.bollinger(cols(b).c, p.length, p.mult);
      return [
        { key: "upper", label: "Upper", values: r.upper, color: "#a78bfa" },
        { key: "mid", label: `BB ${p.length}`, values: r.mid, color: "#f5c451" },
        { key: "lower", label: "Lower", values: r.lower, color: "#a78bfa" },
      ];
    },
  },
  {
    id: "keltner", name: "Keltner Channels", short: "KC", pane: "overlay", category: "Volatility", params: [len("length", 20), mult(2), len("atr", 10, "ATR length")],
    compute: (b, p) => {
      const x = cols(b);
      const r = ta.keltner(x.h, x.l, x.c, p.length, p.mult, p.atr);
      return [
        { key: "upper", label: "Upper", values: r.upper, color: "#34d399" },
        { key: "mid", label: `KC ${p.length}`, values: r.mid, color: "#f5c451" },
        { key: "lower", label: "Lower", values: r.lower, color: "#34d399" },
      ];
    },
  },
  {
    id: "donchian", name: "Donchian Channels", short: "DC", pane: "overlay", category: "Volatility", params: [len("length", 20)],
    compute: (b, p) => {
      const x = cols(b);
      const r = ta.donchian(x.h, x.l, p.length);
      return [
        { key: "upper", label: `DC ${p.length} upper`, values: r.upper, color: "#60a5fa" },
        { key: "mid", label: "Mid", values: r.mid, color: "#8b95a7" },
        { key: "lower", label: "Lower", values: r.lower, color: "#60a5fa" },
      ];
    },
  },
  {
    id: "supertrend", name: "Supertrend", short: "ST", pane: "overlay", category: "Trend", params: [len("length", 10, "ATR length"), mult(3)],
    compute: (b, p) => {
      const x = cols(b);
      const r = ta.supertrend(x.h, x.l, x.c, p.length, p.mult);
      return [
        { key: "up", label: `ST ${p.length},${p.mult} ▲`, values: r.line.map((v, i) => (r.dir[i] === 1 ? v : NaN)), color: "#22c55e" },
        { key: "down", label: "▼", values: r.line.map((v, i) => (r.dir[i] === -1 ? v : NaN)), color: "#f43f5e" },
      ];
    },
  },
  {
    id: "psar", name: "Parabolic SAR", short: "SAR", pane: "overlay", category: "Trend",
    params: [{ key: "step", label: "Step", default: 0.02, min: 0.001, max: 1, step: 0.01 }, { key: "max", label: "Max", default: 0.2, min: 0.01, max: 1, step: 0.01 }],
    compute: (b, p) => {
      const x = cols(b);
      return [{ key: "sar", label: "SAR", values: ta.psar(x.h, x.l, p.step, p.max), color: "#fb923c", style: "dots" }];
    },
  },
  {
    id: "vwap", name: "VWAP", short: "VWAP", pane: "overlay", category: "Volume",
    params: [
      { key: "hideDaily", label: "Hide VWAP on 1D or above", default: 0, min: 0, max: 1, kind: "bool", group: "VWAP settings" },
      { key: "anchor", label: "Anchor period", default: 0, min: 0, max: 2, kind: "select", options: ["Session", "Week", "Month"], group: "VWAP settings" },
      { key: "source", label: "Source", default: 0, min: 0, max: 6, kind: "select", options: SOURCE_NAMES, group: "VWAP settings" },
      { key: "offset", label: "Offset", default: 0, min: -500, max: 500, group: "VWAP settings" },
      { key: "bandsMode", label: "Bands calculation mode", default: 0, min: 0, max: 1, kind: "select", options: ["Standard deviation", "Percentage"], group: "Bands settings" },
      { key: "band1", label: "Bands multiplier #1", default: 1, min: 0, max: 1, kind: "bool", group: "Bands settings" },
      { key: "mult1", label: "Multiplier #1", default: 1, min: 0, max: 50, step: 0.1, group: "Bands settings" },
      { key: "band2", label: "Bands multiplier #2", default: 1, min: 0, max: 1, kind: "bool", group: "Bands settings" },
      { key: "mult2", label: "Multiplier #2", default: 2, min: 0, max: 50, step: 0.1, group: "Bands settings" },
      { key: "band3", label: "Bands multiplier #3", default: 1, min: 0, max: 1, kind: "bool", group: "Bands settings" },
      { key: "mult3", label: "Multiplier #3", default: 3, min: 0, max: 50, step: 0.1, group: "Bands settings" },
    ],
    compute: (b, p, ctx) => {
      if (p.hideDaily && !ctx.intraday) return [];
      const x = cols(b);
      const src = sourceSeries(x, p.source);
      const anchor = (["session", "week", "month"] as const)[p.anchor] ?? "session";
      const r = ta.vwapBands(src, x.v, x.t, anchor);
      const pct = p.bandsMode === 1;
      const band = (m: number, sign: 1 | -1) => r.vwap.map((v, i) => (pct ? v * (1 + (sign * m) / 100) : v + sign * m * r.sd[i]));
      const outs: Output[] = [{ key: "vwap", label: `VWAP ${["Session", "Week", "Month"][p.anchor] ?? ""}`, values: r.vwap, color: "#a855f7" }];
      const bandColors = ["#4caf50", "#a3a32a", "#14b8a6"];
      ([1, 2, 3] as const).forEach((k, i) => {
        if (!p[`band${k}`]) return;
        const m = p[`mult${k}`];
        outs.push({ key: `up${k}`, label: `Upper #${k}`, values: band(m, 1), color: bandColors[i] });
        outs.push({ key: `lo${k}`, label: `Lower #${k}`, values: band(m, -1), color: bandColors[i] });
      });
      return outs.map((o) => ({ ...o, values: ta.shift(o.values, Math.round(p.offset)) }));
    },
  },
  {
    id: "ichimoku", name: "Ichimoku Cloud", short: "Ichimoku", pane: "overlay", category: "Trend",
    params: [len("conv", 9, "Conversion"), len("base", 26, "Base"), len("spanB", 52, "Span B"), len("disp", 26, "Displacement")],
    compute: (b, p) => {
      const x = cols(b);
      const r = ta.ichimoku(x.h, x.l, p.conv, p.base, p.spanB, p.disp);
      return [
        { key: "tenkan", label: "Tenkan", values: r.tenkan, color: "#38bdf8" },
        { key: "kijun", label: "Kijun", values: r.kijun, color: "#f43f5e" },
        { key: "spanA", label: "Span A", values: r.spanA, color: "#22c55e" },
        { key: "spanB", label: "Span B", values: r.spanB, color: "#fb923c" },
      ];
    },
  },
  {
    id: "rsi", name: "Relative Strength Index", short: "RSI", pane: "separate", category: "Momentum", params: [len("length", 14)], levels: [70, 30], range: [0, 100],
    compute: (b, p) => [{ key: "rsi", label: `RSI ${p.length}`, values: ta.rsi(cols(b).c, p.length), color: "#a78bfa" }],
  },
  {
    id: "macd", name: "MACD", short: "MACD", pane: "separate", category: "Momentum", levels: [0],
    params: [len("fast", 12, "Fast"), len("slow", 26, "Slow"), len("signal", 9, "Signal")],
    compute: (b, p) => {
      const r = ta.macd(cols(b).c, p.fast, p.slow, p.signal);
      return [
        { key: "hist", label: "Hist", values: r.hist, color: "#8b95a7", style: "histogram" },
        { key: "macd", label: `MACD ${p.fast},${p.slow},${p.signal}`, values: r.macd, color: "#38bdf8" },
        { key: "signal", label: "Signal", values: r.signal, color: "#fb923c" },
      ];
    },
  },
  {
    id: "stoch", name: "Stochastic", short: "Stoch", pane: "separate", category: "Momentum", levels: [80, 20], range: [0, 100],
    params: [len("k", 14, "%K length"), len("smooth", 3, "%K smoothing"), len("d", 3, "%D length")],
    compute: (b, p) => {
      const x = cols(b);
      const r = ta.stochastic(x.h, x.l, x.c, p.k, p.smooth, p.d);
      return [
        { key: "k", label: `Stoch ${p.k},${p.smooth},${p.d} %K`, values: r.k, color: "#38bdf8" },
        { key: "d", label: "%D", values: r.d, color: "#fb923c" },
      ];
    },
  },
  {
    id: "adx", name: "ADX / DMI", short: "ADX", pane: "separate", category: "Trend", params: [len("length", 14)], levels: [25],
    compute: (b, p) => {
      const x = cols(b);
      const r = ta.adx(x.h, x.l, x.c, p.length);
      return [
        { key: "adx", label: `ADX ${p.length}`, values: r.adx, color: "#f5c451" },
        { key: "pdi", label: "+DI", values: r.plusDI, color: "#22c55e" },
        { key: "mdi", label: "−DI", values: r.minusDI, color: "#f43f5e" },
      ];
    },
  },
  {
    id: "atr", name: "Average True Range", short: "ATR", pane: "separate", category: "Volatility", params: [len("length", 14)],
    compute: (b, p) => {
      const x = cols(b);
      return [{ key: "atr", label: `ATR ${p.length}`, values: ta.atr(x.h, x.l, x.c, p.length), color: "#fb923c" }];
    },
  },
  {
    id: "cci", name: "Commodity Channel Index", short: "CCI", pane: "separate", category: "Momentum", params: [len("length", 20)], levels: [100, -100],
    compute: (b, p) => {
      const x = cols(b);
      return [{ key: "cci", label: `CCI ${p.length}`, values: ta.cci(x.h, x.l, x.c, p.length), color: "#60a5fa" }];
    },
  },
  {
    id: "mfi", name: "Money Flow Index", short: "MFI", pane: "separate", category: "Volume", params: [len("length", 14)], levels: [80, 20], range: [0, 100],
    compute: (b, p) => {
      const x = cols(b);
      return [{ key: "mfi", label: `MFI ${p.length}`, values: ta.mfi(x.h, x.l, x.c, x.v, p.length), color: "#34d399" }];
    },
  },
  {
    id: "willr", name: "Williams %R", short: "%R", pane: "separate", category: "Momentum", params: [len("length", 14)], levels: [-20, -80], range: [-100, 0],
    compute: (b, p) => {
      const x = cols(b);
      return [{ key: "wr", label: `%R ${p.length}`, values: ta.williamsR(x.h, x.l, x.c, p.length), color: "#f472b6" }];
    },
  },
  {
    id: "roc", name: "Rate of Change", short: "ROC", pane: "separate", category: "Momentum", params: [len("length", 12)], levels: [0],
    compute: (b, p) => [{ key: "roc", label: `ROC ${p.length}`, values: ta.roc(cols(b).c, p.length), color: "#38bdf8" }],
  },
  {
    id: "obv", name: "On-Balance Volume", short: "OBV", pane: "separate", category: "Volume", params: [],
    compute: (b) => {
      const x = cols(b);
      return [{ key: "obv", label: "OBV", values: ta.obv(x.c, x.v), color: "#60a5fa" }];
    },
  },
  {
    id: "volume", name: "Volume", short: "Vol", pane: "separate", category: "Volume", params: [len("length", 20, "MA length")],
    compute: (b, p) => {
      const v = cols(b).v;
      if (!v.some((x) => x > 0)) return []; // indices have no volume
      return [
        { key: "vol", label: "Volume", values: v, color: "#8b95a7", style: "histogram" },
        { key: "ma", label: `MA ${p.length}`, values: ta.sma(v, p.length), color: "#f5c451" },
      ];
    },
  },
];

export const INDICATOR_BY_ID = Object.fromEntries(INDICATORS.map((d) => [d.id, d]));

export function defaultParams(def: IndicatorDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/** Heikin-Ashi transform. */
export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = i === 0 ? (b.o + b.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, v: b.v });
  }
  return out;
}

/** Aggregates daily bars into weekly (Mon-start) or monthly bars. */
export function resample(bars: Bar[], period: "W" | "M"): Bar[] {
  const out: Bar[] = [];
  let key = "";
  for (const b of bars) {
    const d = new Date(b.t * 1000);
    let k: string;
    if (period === "M") k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    else {
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
      k = monday.toISOString().slice(0, 10);
    }
    if (k !== key) {
      out.push({ ...b });
      key = k;
    } else {
      const cur = out[out.length - 1];
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  return out;
}
