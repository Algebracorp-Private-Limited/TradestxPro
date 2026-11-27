/**
 * Scenario and risk engine for positions made of option, futures and cash legs. Every number is a model
 * estimate, never a quote. Options are repriced with Black-Scholes-Merton on spot — the same model their
 * implied volatilities were solved with (lib/intelligence/options/contract.ts), so a position entered at
 * those prices shows zero P&L at no move. Futures legs move with spot plus the session's basis:
 *   - payoff curves at several dates (today, intermediate, near expiry);
 *   - a P&L grid over underlying moves × implied-volatility shifts × days forward;
 *   - stress tests: σ-scaled gap moves, ±10% moves, IV shocks, one week of decay;
 *   - net Greeks.
 * Probabilities of profit are not produced.
 */
import { greeks as modelGreeks, price as modelPrice } from "../options/pricing.ts";

export type PosLeg = { side: "BUY" | "SELL"; right: "CE" | "PE" | "FUT" | "CASH"; strike: number | null; expiry: string | null; qty: number; entry: number; iv: number | null };
export type ScenarioInput = { legs: PosLeg[]; spot: number; now: Date; r?: number; q?: number; forwardBasis?: number | null; atmIv: number | null };

const DAY = 86400e3;
const sgn = (s: "BUY" | "SELL") => (s === "BUY" ? 1 : -1);
const r2 = (v: number) => Math.round(v * 100) / 100;
const yrs = (expiry: string, at: Date) => Math.max(0, (Date.parse(`${expiry}T10:00:00Z`) - at.getTime()) / (365 * DAY));

/** Value of one unit of a leg at underlying S, IV shift dv (absolute, e.g. 0.05 = +5 pp), time `at`. */
export function legValue(l: PosLeg, S: number, at: Date, dv: number, inp: Pick<ScenarioInput, "r" | "q" | "forwardBasis">): number {
  if (l.right === "CASH") return S;
  if (l.right === "FUT") return S + (inp.forwardBasis ?? 0);
  const T = yrs(l.expiry!, at);
  const sigma = Math.max(0.01, (l.iv && l.iv > 0 ? l.iv : 0.2) + dv);
  return modelPrice({ model: "bsm", underlying: S, K: l.strike!, T, r: inp.r ?? 0.065, sigma, q: inp.q ?? 0, right: l.right });
}

export function pnl(inp: ScenarioInput, S: number, at: Date, dv = 0): number {
  return inp.legs.reduce((a, l) => a + sgn(l.side) * l.qty * (legValue(l, S, at, dv, inp) - l.entry), 0);
}

export function nearestExpiry(legs: PosLeg[]): string | null {
  const e = legs.map((l) => l.expiry).filter((x): x is string => !!x).sort();
  return e[0] ?? null;
}

export function payoffCurves(inp: ScenarioInput, opts: { rangePct?: number; points?: number } = {}) {
  const exp = nearestExpiry(inp.legs);
  const end = exp ? new Date(Date.parse(`${exp}T10:00:00Z`)) : new Date(inp.now.getTime() + 30 * DAY);
  const mid = new Date((inp.now.getTime() + end.getTime()) / 2);
  const rp = opts.rangePct ?? 0.15, N = opts.points ?? 80;
  const xs = Array.from({ length: N + 1 }, (_, i) => inp.spot * (1 - rp + (2 * rp * i) / N));
  const curve = (at: Date) => xs.map((s) => ({ s: r2(s), pnl: r2(pnl(inp, s, at)) }));
  return {
    dates: [
      { label: "Today", date: inp.now.toISOString().slice(0, 10), points: curve(inp.now) },
      { label: "Midway", date: mid.toISOString().slice(0, 10), points: curve(mid) },
      { label: exp ? "Near expiry" : "In 30 days", date: end.toISOString().slice(0, 10), points: curve(end) },
    ],
    model: `Black-Scholes-Merton on spot (the model the IVs were solved with)${inp.forwardBasis ? "; futures legs at spot + session basis" : ""}`,
  };
}

/** P&L grid: rows = underlying moves (%), columns = IV shifts (pp), at `daysForward`. */
export function scenarioGrid(inp: ScenarioInput, moves = [-10, -5, -3, -1, 0, 1, 3, 5, 10], ivShifts = [-10, -5, 0, 5, 10], daysForward = 0) {
  const at = new Date(inp.now.getTime() + daysForward * DAY);
  return { moves, ivShifts, daysForward, values: moves.map((m) => ivShifts.map((v) => r2(pnl(inp, inp.spot * (1 + m / 100), at, v / 100)))) };
}

export function netGreeks(inp: ScenarioInput) {
  const out = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of inp.legs) {
    const s = sgn(l.side) * l.qty;
    if (l.right === "CASH" || l.right === "FUT") { out.delta += s; continue; }
    const g = modelGreeks({ model: "bsm", underlying: inp.spot, K: l.strike!, T: yrs(l.expiry!, inp.now), r: inp.r ?? 0.065, sigma: l.iv && l.iv > 0 ? l.iv : 0.2, q: inp.q ?? 0, right: l.right });
    out.delta += s * g.delta; out.gamma += s * g.gamma; out.theta += s * g.theta; out.vega += s * g.vega;
  }
  return { delta: r2(out.delta), gamma: Math.round(out.gamma * 1e4) / 1e4, theta: r2(out.theta), vega: r2(out.vega) };
}

export type StressRow = { name: string; move: number; ivShiftPp: number; days: number; pnl: number };

/** Stress tests. σ moves use the ATM IV (1-day σ = IV/√252); without IV only fixed % moves run. */
export function stressTests(inp: ScenarioInput): { rows: StressRow[]; worst: StressRow | null; notes: string[] } {
  const rows: StressRow[] = [];
  const notes: string[] = [];
  const run = (name: string, move: number, iv: number, days: number) => rows.push({ name, move: r2(move * 100), ivShiftPp: iv, days, pnl: r2(pnl(inp, inp.spot * (1 + move), new Date(inp.now.getTime() + days * DAY), iv / 100)) });
  if (inp.atmIv) {
    const s1 = inp.atmIv / Math.sqrt(252);
    for (const k of [1, 2, 3]) {
      run(`Overnight gap −${k}σ`, -k * s1, k === 3 ? 5 : 0, 1);
      run(`Overnight gap +${k}σ`, k * s1, 0, 1);
    }
  } else notes.push("No implied volatility: σ-scaled gap tests skipped.");
  run("Underlying −10%", -0.1, 5, 0);
  run("Underlying +10%", 0.1, 0, 0);
  run("IV −10 pp", 0, -10, 0);
  run("IV +10 pp", 0, 10, 0);
  run("One week, no move", 0, 0, 7);
  const worst = rows.reduce<StressRow | null>((a, b) => (!a || b.pnl < a.pnl ? b : a), null);
  notes.push("Model estimates: real prices can gap beyond these moves, and implied volatility can change with the move.");
  return { rows, worst, notes };
}

export function riskIntelligence(inp: ScenarioInput) {
  const g = netGreeks(inp);
  const st = stressTests(inp);
  const flags: string[] = [];
  if (inp.legs.some((l) => l.side === "SELL" && (l.right === "CE" || l.right === "FUT")) && !inp.legs.some((l) => l.side === "BUY" && l.right === "CE")) flags.push("Uncovered short call or short futures exposure: upside loss is unlimited.");
  if (g.vega < 0) flags.push("Short volatility: losses if implied volatility rises.");
  if (g.gamma < 0) flags.push("Negative gamma: losses accelerate on large moves in either direction.");
  if (g.theta < 0) flags.push(`Time decay costs about ₹${Math.abs(g.theta)} per day at current prices.`);
  const exp = nearestExpiry(inp.legs);
  if (exp && yrs(exp, inp.now) * 365 < 3) flags.push("Within 3 days of expiry: gamma and pin risk are high.");
  return { greeks: g, stress: st, flags, margin: null as null, marginNote: "Margin data is unavailable; margin is not the maximum possible loss." };
}
