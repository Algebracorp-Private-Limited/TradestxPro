/**
 * Independent validation of plans before presentation (Phase 4 §51). Engines and AI explanations are
 * checked against the source data and recomputed numbers; a plan that fails is withheld with its issues
 * rather than shown. Checks:
 *   - instrument / contract exists in the chain; expiry valid and not past; strike on the ladder;
 *     lot size equals the chain's;
 *   - stop / target relationships for the plan's side (equity, option premium, futures);
 *   - prices fresh enough for the status claimed (no entry on stale or EOD data);
 *   - Greeks have a declared source, and model Greeks recompute within tolerance;
 *   - payoff / maximum loss recomputed independently on a fresh grid;
 *   - short legs only where the user's constraints allow them; margin never claimed without data.
 */
import { usableForIntraday } from "../core/freshness.ts";
import type { Provenance } from "../core/types.ts";
import type { ChainInput, ContractAnalysis, ContractPlan } from "../options/contract.ts";
import { greeks as modelGreeks, type Model } from "../options/pricing.ts";
import { yearsTo } from "../options/contract.ts";
import type { Evaluation, StrategyInputs } from "../strategy/evaluate.ts";
import { pnlAt } from "../strategy/evaluate.ts";

export type Validation = { ok: boolean; issues: string[] };
const ENTRY_STATUSES = new Set(["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION"]);
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/**
 * Entry statuses need usable prices. Premium and futures entries (`requireRealtime`) need real-time data;
 * daily-horizon equity plans may use the latest completed session but never stale or unknown data.
 */
export function validateFreshness(status: string, p: Provenance, opts: { requireRealtime?: boolean } = { requireRealtime: true }): string[] {
  if (opts.requireRealtime && status === "ENTER IF CONFIRMED" && !usableForIntraday(p).ok) return [`status "${status}" requires real-time prices; data is ${p.freshness}`];
  if (ENTRY_STATUSES.has(status) && (p.freshness === "stale" || p.freshness === "unknown")) return [`status "${status}" on ${p.freshness} data`];
  return [];
}

export function validateEquityPlan(s: { status: string; direction: "long" | "short" | null; entry: { low: number; high: number } | null; stop: number | null; targets: { price: number }[]; price: number | null }, p: Provenance): Validation {
  const issues: string[] = [];
  if (s.entry || s.stop) {
    if (!s.entry || !s.stop || !s.targets.length || !s.direction) issues.push("incomplete plan: entry, stop, target and direction are all required");
    else {
      if (!(s.entry.low > 0 && s.entry.low <= s.entry.high)) issues.push("invalid entry range");
      const long = s.direction === "long";
      if (long ? !(s.stop < s.entry.low) : !(s.stop > s.entry.high)) issues.push("stop-loss is on the wrong side of the entry");
      for (const t of s.targets) if (long ? !(t.price > s.entry.high) : !(t.price < s.entry.low)) issues.push(`target ${t.price} is on the wrong side of the entry`);
      for (let i = 1; i < s.targets.length; i++) if (long ? s.targets[i].price < s.targets[i - 1].price : s.targets[i].price > s.targets[i - 1].price) issues.push("targets are not ordered");
      if (s.price && (s.entry.high > s.price * 1.5 || s.entry.low < s.price * 0.5)) issues.push("entry far from the last price");
    }
  }
  issues.push(...validateFreshness(s.status, p, { requireRealtime: false }));
  return { ok: issues.length === 0, issues };
}

function contractIssues(c: ChainInput, strike: number, right: "CE" | "PE", expiry: string, lotSize: number | null, now: Date): string[] {
  const issues: string[] = [];
  if (expiry !== c.expiry) issues.push(`expiry ${expiry} is not the chain's expiry ${c.expiry}`);
  if (yearsTo(expiry, now) <= 0) issues.push(`expiry ${expiry} has passed`);
  const row = c.rows.find((r) => r.strike === strike);
  if (!row) issues.push(`strike ${strike} is not on the strike ladder`);
  else if (!(right === "CE" ? row.ce : row.pe)) issues.push(`contract ${strike} ${right} does not exist`);
  if (lotSize !== null && c.lotSize !== null && lotSize !== c.lotSize) issues.push(`lot size ${lotSize} differs from the contract's ${c.lotSize}`);
  return issues;
}

function premiumPlanIssues(p: ContractPlan): string[] {
  const issues: string[] = [];
  if (!p.entryPremium) return issues;
  const mid = (p.entryPremium.low + p.entryPremium.high) / 2;
  if (p.side === "BUY") {
    if (p.stopPremium !== null && !(p.stopPremium < p.entryPremium.low)) issues.push("buy plan: premium stop is not below the entry");
    if (p.targetPremium !== null && !(p.targetPremium > p.entryPremium.high)) issues.push("buy plan: premium target is not above the entry");
  } else {
    if (p.stopPremium !== null && !(p.stopPremium > p.entryPremium.high)) issues.push("sell plan: premium stop is not above the entry");
    if (p.targetPremium !== null && !(p.targetPremium < p.entryPremium.low)) issues.push("sell plan: premium target is not below the entry");
    if (p.executionValidated) issues.push("sell plan claims execution validation without margin data");
  }
  if (p.requiredMargin !== null) issues.push("a margin figure is present but no margin data source exists");
  if (!(mid > 0)) issues.push("entry premium must be positive");
  return issues;
}

/** Validates a contract analysis against its chain. Model Greeks are recomputed and compared. */
export function validateContractAnalysis(a: ContractAnalysis, c: ChainInput, constraints: { definedRiskOnly?: boolean } = {}): { buy: Validation; sell: Validation; contract: Validation } {
  const now = c.now ?? new Date();
  const ci = contractIssues(c, a.strike, a.right, a.expiry, a.lotSize, now);
  const m = a.metrics;
  if (m.greeksSource !== "broker" && m.greeksSource !== "model" && m.delta !== null) ci.push("Greeks without a declared source");
  if (m.greeksSource === "model" && m.iv && c.spot) {
    const model: Model = c.forward ? "black76" : "bsm";
    const g = modelGreeks({ model, underlying: c.forward ?? c.spot, K: a.strike, T: yearsTo(a.expiry, now), r: c.r ?? 0.065, sigma: m.iv, q: c.q ?? 0, right: a.right });
    if (m.delta !== null && !close(m.delta, g.delta, 0.005)) ci.push(`model delta ${m.delta} does not recompute (${g.delta.toFixed(4)})`);
    if (m.theta !== null && !close(m.theta, g.theta, Math.max(0.02, Math.abs(g.theta) * 0.02))) ci.push(`model theta ${m.theta} does not recompute`);
  }
  const buy = [...premiumPlanIssues(a.buy), ...validateFreshness(a.buy.status, a.provenance)];
  const sell = [...premiumPlanIssues(a.sell), ...validateFreshness(a.sell.status, a.provenance)];
  if (constraints.definedRiskOnly && ENTRY_STATUSES.has(a.sell.status)) sell.push("uncovered short option offered although only defined-risk strategies are allowed");
  return { contract: { ok: ci.length === 0, issues: ci }, buy: { ok: buy.length === 0, issues: buy }, sell: { ok: sell.length === 0, issues: sell } };
}

/** Recomputes a strategy's legs and maximum loss independently and checks the reported figures. */
export function validateStrategyEvaluation(e: Evaluation, inp: StrategyInputs, constraints: { definedRiskOnly?: boolean } = {}): Validation {
  const issues: string[] = [];
  if (e.status !== "OK") return { ok: true, issues };
  const near = inp.near, now = near.now ?? new Date();
  for (const l of e.legs) {
    if (l.right === "FUT") {
      if (!inp.futures || l.expiry !== inp.futures.expiry) issues.push("futures leg without a matching futures contract");
      continue;
    }
    const chain = l.expiry === near.expiry ? near : inp.next && l.expiry === inp.next.expiry ? inp.next : null;
    if (!chain) { issues.push(`leg expiry ${l.expiry} has no chain`); continue; }
    issues.push(...contractIssues(chain, l.strike!, l.right, l.expiry, e.lotSize, now));
  }
  if (e.lotSize !== near.lotSize) issues.push("lot size differs from the chain");
  if (constraints.definedRiskOnly && e.risk === "undefined") issues.push("undefined-risk strategy offered although only defined-risk strategies are allowed");
  if (e.executionValidated) issues.push("strategy claims execution validation without margin data");
  if (e.requiredMargin !== null) issues.push("a margin figure is present but no margin data source exists");
  // Independent maximum-loss recomputation on a different grid (step 0.25% of spot, ±50%).
  if (near.spot && e.lotSize) {
    const S = near.spot;
    let min = Infinity;
    // Piecewise-linear at expiry: the minimum lies on a strike or an end of the range, so strikes are included.
    const pts = [...e.legs.flatMap((l) => (l.strike ? [l.strike] : []))];
    for (let x = S * 0.5; x <= S * 1.5; x += S * 0.0025) pts.push(x);
    for (const x of pts) min = Math.min(min, pnlAt(e.legs, x, near.expiry, now, near.r));
    min = Math.min(min, pnlAt(e.legs, 0, near.expiry, now, near.r));
    const recomputed = Math.min(0, min) * e.lotSize;
    const slope = pnlAt(e.legs, S * 3, near.expiry, now, near.r) - pnlAt(e.legs, S * 2, near.expiry, now, near.r);
    if (slope < -1e-6) { if (!e.unlimitedLoss) issues.push("loss is unlimited above the strikes but not reported as unlimited"); }
    else if (e.maxLoss === null) issues.push("maximum loss reported as unlimited but the payoff is bounded");
    else if (!close(e.maxLoss, recomputed, Math.max(1, Math.abs(recomputed) * 0.01))) issues.push(`maximum loss ${e.maxLoss} does not match the recomputed ${Math.round(recomputed * 100) / 100}`);
  }
  return { ok: issues.length === 0, issues };
}

// ---------------- Applying validation (withhold, never show a failing plan) ----------------
const withheld = <T extends { status: string; reasons?: string[] }>(p: T, issues: string[]): T => ({ ...p, status: "INSUFFICIENT DATA", reasons: [...(p.reasons ?? []), ...issues.map((i) => `validation: ${i}`)] });

export function applyContractValidation(a: ContractAnalysis, c: ChainInput, constraints: { definedRiskOnly?: boolean } = {}) {
  const v = validateContractAnalysis(a, c, constraints);
  const strip = (p: ContractPlan, issues: string[]): ContractPlan => ({ ...withheld(p, issues), entryPremium: null, stopPremium: null, targetPremium: null, additionalTargetPremium: null, sizing: null, costs: null, executionValidated: false });
  return {
    ...a,
    buy: v.contract.ok && v.buy.ok ? a.buy : strip(a.buy, [...v.contract.issues, ...v.buy.issues]),
    sell: v.contract.ok && v.sell.ok ? a.sell : strip(a.sell, [...v.contract.issues, ...v.sell.issues]),
    validation: { contract: v.contract, buy: v.buy, sell: v.sell },
  };
}

export function applyEquityValidation<T extends { status: string; direction: "long" | "short" | null; entry: { low: number; high: number } | null; stop: number | null; targets: { price: number; label: string }[]; price: number | null; reasonsToAvoid: string[]; missing: string[] }>(s: T, p: Provenance): T & { validation: Validation } {
  const v = validateEquityPlan(s, p);
  if (v.ok) return { ...s, validation: v };
  return { ...s, status: "INSUFFICIENT DATA", entry: null, stop: null, targets: [], reasonsToAvoid: [...s.reasonsToAvoid, ...v.issues.map((i) => `validation: ${i}`)], validation: v };
}

export function applyStrategyValidation(list: Evaluation[], inp: StrategyInputs, constraints: { definedRiskOnly?: boolean } = {}) {
  const kept: Evaluation[] = [];
  const rejected: { id: string; issues: string[] }[] = [];
  for (const e of list) {
    const v = validateStrategyEvaluation(e, inp, constraints);
    if (v.ok) kept.push(e);
    else rejected.push({ id: e.id, issues: v.issues });
  }
  return { kept, rejected };
}
