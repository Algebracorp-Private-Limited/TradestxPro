/**
 * Alert conditions (pure): catalogue, validation and evaluation.
 *
 * Categories and the instrument each one watches:
 *   price      NSE:SYMBOL / NSEIDX:INDEX  — close/high/low levels, daily % change
 *   technical  NSE:SYMBOL / NSEIDX:INDEX  — RSI levels, close crossing an SMA/EMA, volume spike vs 20-day mean
 *   oi         FO:UNDERLYING              — day-over-day % change in total open interest (all F&O contracts)
 *   iv         FO:UNDERLYING              — ATM implied volatility of the nearest expiry (model IV from the bhavcopy)
 *   setup      NSE:SYMBOL                 — equity setup engine signal (status in a set, score ≥ threshold)
 * All are evaluated on end-of-day data after each daily load; nothing here is real-time.
 */
import * as ta from "../../ta/indicators.ts";

export type Category = "price" | "technical" | "oi" | "iv" | "setup";
export type ConditionDef = { id: string; category: Category; label: string; thresholdLabel: string; min: number; max: number; params?: { key: string; label: string; min: number; max: number; default: number }[] };

export const CONDITIONS: ConditionDef[] = [
  { id: "close_above", category: "price", label: "Close above", thresholdLabel: "Price", min: 0.01, max: 1e7 },
  { id: "close_below", category: "price", label: "Close below", thresholdLabel: "Price", min: 0.01, max: 1e7 },
  { id: "high_above", category: "price", label: "High above", thresholdLabel: "Price", min: 0.01, max: 1e7 },
  { id: "low_below", category: "price", label: "Low below", thresholdLabel: "Price", min: 0.01, max: 1e7 },
  { id: "pct_change_above", category: "price", label: "Daily change above (%)", thresholdLabel: "%", min: -50, max: 50 },
  { id: "pct_change_below", category: "price", label: "Daily change below (%)", thresholdLabel: "%", min: -50, max: 50 },
  { id: "rsi_above", category: "technical", label: "RSI above", thresholdLabel: "RSI level", min: 1, max: 99, params: [{ key: "length", label: "RSI length", min: 2, max: 100, default: 14 }] },
  { id: "rsi_below", category: "technical", label: "RSI below", thresholdLabel: "RSI level", min: 1, max: 99, params: [{ key: "length", label: "RSI length", min: 2, max: 100, default: 14 }] },
  { id: "cross_above_sma", category: "technical", label: "Close crosses above SMA", thresholdLabel: "SMA length", min: 2, max: 250 },
  { id: "cross_below_sma", category: "technical", label: "Close crosses below SMA", thresholdLabel: "SMA length", min: 2, max: 250 },
  { id: "cross_above_ema", category: "technical", label: "Close crosses above EMA", thresholdLabel: "EMA length", min: 2, max: 250 },
  { id: "cross_below_ema", category: "technical", label: "Close crosses below EMA", thresholdLabel: "EMA length", min: 2, max: 250 },
  { id: "volume_spike", category: "technical", label: "Volume above N × 20-day average", thresholdLabel: "Multiple", min: 1.1, max: 50 },
  { id: "oi_change_pct_above", category: "oi", label: "Total OI change above (%)", thresholdLabel: "%", min: -100, max: 500 },
  { id: "oi_change_pct_below", category: "oi", label: "Total OI change below (%)", thresholdLabel: "%", min: -100, max: 500 },
  { id: "atm_iv_above", category: "iv", label: "ATM IV above (%)", thresholdLabel: "IV %", min: 1, max: 300 },
  { id: "atm_iv_below", category: "iv", label: "ATM IV below (%)", thresholdLabel: "IV %", min: 1, max: 300 },
  { id: "setup_signal", category: "setup", label: "Engine setup signal (score ≥)", thresholdLabel: "Minimum score", min: 0, max: 100 },
];
export const CONDITION_IDS = CONDITIONS.map((c) => c.id);
export const conditionDef = (id: string) => CONDITIONS.find((c) => c.id === id);

const INSTRUMENT: Record<Category, RegExp> = {
  price: /^(NSE|NSEIDX):[A-Z0-9 &_.-]{1,40}$/,
  technical: /^(NSE|NSEIDX):[A-Z0-9 &_.-]{1,40}$/,
  oi: /^FO:[A-Z0-9&_.-]{1,30}$/,
  iv: /^FO:[A-Z0-9&_.-]{1,30}$/,
  setup: /^NSE:[A-Z0-9&_.-]{1,30}$/,
};

export const SETUP_STATUSES = ["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION", "WATCHLIST"] as const;

/** Validates a new alert; returns cleaned params or an error message. */
export function validateCondition(instrument: string, condition: string, threshold: number, params: unknown): { ok: true; params: Record<string, unknown> } | { ok: false; error: string } {
  const def = conditionDef(condition);
  if (!def) return { ok: false, error: "unknown alert condition" };
  if (!INSTRUMENT[def.category].test(instrument)) {
    const hint = def.category === "oi" || def.category === "iv" ? "FO:UNDERLYING (e.g. FO:NIFTY)" : def.category === "setup" ? "NSE:SYMBOL" : "NSE:SYMBOL or NSEIDX:INDEX";
    return { ok: false, error: `this condition needs an instrument like ${hint}` };
  }
  if (!Number.isFinite(threshold) || threshold < def.min || threshold > def.max) return { ok: false, error: `${def.thresholdLabel} must be between ${def.min} and ${def.max}` };
  if (/cross_|volume/.test(condition) && condition !== "volume_spike" && !Number.isInteger(threshold)) return { ok: false, error: "length must be a whole number" };
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const d of def.params ?? []) {
    const v = p[d.key] === undefined ? d.default : Number(p[d.key]);
    if (!Number.isInteger(v) || v < d.min || v > d.max) return { ok: false, error: `${d.label} must be a whole number between ${d.min} and ${d.max}` };
    out[d.key] = v;
  }
  if (condition === "setup_signal") {
    const st = Array.isArray(p.statuses) ? p.statuses.filter((s): s is string => (SETUP_STATUSES as readonly string[]).includes(String(s))) : ["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"];
    if (!st.length) return { ok: false, error: "choose at least one setup status" };
    out.statuses = st;
  }
  return { ok: true, params: out };
}

export type Bar = { d: string; o: number; h: number; l: number; c: number; v: number };

/**
 * Evaluates price/technical conditions on bars after `afterDate` (indicators use the full history, so a
 * signal on a new bar sees the same values it would on a chart). Returns triggers in date order.
 */
export function evaluateSeries(condition: string, threshold: number, params: Record<string, unknown>, bars: Bar[], afterDate: string): { d: string; value: number }[] {
  const c = bars.map((b) => b.c);
  const out: { d: string; value: number }[] = [];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  let series: number[] | null = null;
  if (condition === "rsi_above" || condition === "rsi_below") series = ta.rsi(c, Number(params.length ?? 14));
  if (condition.endsWith("_sma")) series = ta.sma(c, threshold);
  if (condition.endsWith("_ema")) series = ta.ema(c, threshold);
  const vol = condition === "volume_spike" ? ta.sma(bars.map((b) => b.v), 20) : null;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (b.d <= afterDate) continue;
    const prev = bars[i - 1];
    let hit: number | null = null;
    switch (condition) {
      case "close_above": hit = b.c > threshold ? b.c : null; break;
      case "close_below": hit = b.c < threshold ? b.c : null; break;
      case "high_above": hit = b.h > threshold ? b.h : null; break;
      case "low_below": hit = b.l < threshold ? b.l : null; break;
      case "pct_change_above": { const p = ((b.c - prev.c) / prev.c) * 100; hit = p > threshold ? r2(p) : null; break; }
      case "pct_change_below": { const p = ((b.c - prev.c) / prev.c) * 100; hit = p < threshold ? r2(p) : null; break; }
      case "rsi_above": hit = series![i] > threshold ? r2(series![i]) : null; break;
      case "rsi_below": hit = series![i] < threshold ? r2(series![i]) : null; break;
      case "cross_above_sma": case "cross_above_ema": {
        const m = series![i], pm = series![i - 1];
        hit = Number.isFinite(m) && Number.isFinite(pm) && prev.c <= pm && b.c > m ? r2(b.c) : null; break;
      }
      case "cross_below_sma": case "cross_below_ema": {
        const m = series![i], pm = series![i - 1];
        hit = Number.isFinite(m) && Number.isFinite(pm) && prev.c >= pm && b.c < m ? r2(b.c) : null; break;
      }
      case "volume_spike": {
        // Average of the 20 sessions before this bar (the bar itself excluded).
        const avg = vol![i - 1];
        hit = Number.isFinite(avg) && avg > 0 && b.v > threshold * avg ? r2(b.v / avg) : null; break;
      }
    }
    if (hit !== null && Number.isFinite(hit)) out.push({ d: b.d, value: hit });
  }
  return out;
}

/** Day-over-day % change in total OI; triggers for days after `afterDate`. */
export function evaluateOi(condition: string, threshold: number, days: { d: string; oi: number }[], afterDate: string): { d: string; value: number }[] {
  const out: { d: string; value: number }[] = [];
  for (let i = 1; i < days.length; i++) {
    if (days[i].d <= afterDate || !(days[i - 1].oi > 0)) continue;
    const p = Math.round(((days[i].oi - days[i - 1].oi) / days[i - 1].oi) * 10000) / 100;
    if (condition === "oi_change_pct_above" ? p > threshold : p < threshold) out.push({ d: days[i].d, value: p });
  }
  return out;
}

export function describe(condition: string, threshold: number, params: Record<string, unknown>): string {
  const def = conditionDef(condition);
  if (!def) return condition;
  if (condition === "setup_signal") return `Engine signal (${(params.statuses as string[] | undefined)?.join(" / ") ?? "entry statuses"}) with score ≥ ${threshold}`;
  if (condition.startsWith("rsi")) return `RSI(${params.length ?? 14}) ${condition.endsWith("above") ? "above" : "below"} ${threshold}`;
  if (condition.startsWith("cross")) return `${def.label} ${threshold}`;
  if (condition === "volume_spike") return `Volume above ${threshold}× its 20-day average`;
  return `${def.label} ${threshold}`;
}
