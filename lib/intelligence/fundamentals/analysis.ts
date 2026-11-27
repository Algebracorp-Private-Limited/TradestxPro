/**
 * Fundamental investment analysis (deterministic). Financial quality, valuation multiples,
 * historical and peer valuation, DCF with bear/base/bull scenarios and reverse DCF.
 * Inputs are imported statements (dataset.ts) and the latest verified close; every assumption of
 * the DCF is returned with the result and can be overridden.
 */
import { insufficient, type InsufficientData } from "../core/types.ts";
import { periodsKnownAt, type Company, type Period } from "./dataset.ts";

const r = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const div = (a: number, b: number) => (b === 0 || !Number.isFinite(a) || !Number.isFinite(b) ? null : a / b);
const cagr = (first: number, last: number, years: number) => (first > 0 && last > 0 && years > 0 ? (last / first) ** (1 / years) - 1 : null);

export type Quality = {
  period: string;
  growth: { revenueYoY: number | null; ebitdaYoY: number | null; netProfitYoY: number | null; epsYoY: number | null; revenueCagr3y: number | null; epsCagr3y: number | null };
  margins: { ebitda: number | null; operating: number | null; net: number | null };
  cash: { operatingCashFlow: number; freeCashFlow: number; capex: number; cashConversion: number | null; accrualRatio: number | null };
  balance: { debtToEquity: number | null; netDebt: number; interestCoverage: number | null; workingCapital: number | null };
  returns: { roe: number | null; roce: number | null; roic: number | null };
  flags: string[];
};

export function quality(periods: Period[]): Quality | InsufficientData {
  if (!periods.length) return insufficient(["financial statements"], "no published annual statements");
  const p = periods[periods.length - 1], prev = periods.length > 1 ? periods[periods.length - 2] : null;
  const p3 = periods.length >= 4 ? periods[periods.length - 4] : null;
  const yoy = (k: keyof Period) => (prev ? div((p[k] as number) - (prev[k] as number), Math.abs(prev[k] as number)) : null);
  const avgEq = prev ? (p.equity + prev.equity) / 2 : p.equity;
  const tax = p.taxRate ?? (p.operatingProfit - p.interestExpense > 0 ? Math.max(0, Math.min(0.4, 1 - p.netProfit / (p.operatingProfit - p.interestExpense))) : 0.25);
  const fcf = p.operatingCashFlow - p.capex;
  const flags: string[] = [];
  const conv = div(p.operatingCashFlow, p.netProfit);
  if (conv !== null && conv < 0.7 && p.netProfit > 0) flags.push(`operating cash flow is ${r(conv * 100, 0)}% of net profit: earnings quality needs scrutiny`);
  const icov = div(p.operatingProfit, p.interestExpense);
  if (icov !== null && icov < 3) flags.push(`interest coverage ${r(icov, 1)}× is thin`);
  const de = div(p.totalDebt, p.equity);
  if (de !== null && de > 1.5) flags.push(`debt-to-equity ${r(de, 2)} is high`);
  if (fcf < 0) flags.push("negative free cash flow in the latest year");
  return {
    period: p.period,
    growth: {
      revenueYoY: r(yoy("revenue"), 4), ebitdaYoY: r(yoy("ebitda"), 4), netProfitYoY: r(yoy("netProfit"), 4), epsYoY: r(yoy("eps"), 4),
      revenueCagr3y: p3 ? r(cagr(p3.revenue, p.revenue, 3), 4) : null, epsCagr3y: p3 ? r(cagr(p3.eps, p.eps, 3), 4) : null,
    },
    margins: { ebitda: r(div(p.ebitda, p.revenue), 4), operating: r(div(p.operatingProfit, p.revenue), 4), net: r(div(p.netProfit, p.revenue), 4) },
    cash: { operatingCashFlow: p.operatingCashFlow, freeCashFlow: r(fcf)!, capex: p.capex, cashConversion: r(conv, 4), accrualRatio: r(div(p.netProfit - p.operatingCashFlow, Math.abs(p.netProfit)), 4) },
    balance: { debtToEquity: r(de, 4), netDebt: r(p.totalDebt - p.cash)!, interestCoverage: r(icov, 2), workingCapital: p.currentAssets !== undefined && p.currentLiabilities !== undefined ? r(p.currentAssets - p.currentLiabilities) : null },
    returns: { roe: r(div(p.netProfit, avgEq), 4), roce: r(div(p.operatingProfit, p.equity + p.totalDebt), 4), roic: r(div(p.operatingProfit * (1 - tax), p.equity + p.totalDebt - p.cash), 4) },
    flags,
  };
}

export type Multiples = { marketCap: number; ev: number; pe: number | null; pb: number | null; evEbitda: number | null; evSales: number | null; peg: number | null; fcfYield: number | null; dividendYield: number | null };

export function multiples(p: Period, price: number, epsCagr: number | null): Multiples {
  const mcap = price * p.sharesOutstanding; // ₹ crore (shares in crore × ₹)
  const ev = mcap + p.totalDebt - p.cash;
  const pe = p.eps > 0 ? price / p.eps : null;
  return {
    marketCap: r(mcap)!, ev: r(ev)!, pe: r(pe), pb: p.equity > 0 ? r(mcap / p.equity) : null, evEbitda: p.ebitda > 0 ? r(ev / p.ebitda) : null, evSales: p.revenue > 0 ? r(ev / p.revenue) : null,
    peg: pe !== null && epsCagr !== null && epsCagr > 0 ? r(pe / (epsCagr * 100)) : null, fcfYield: r(div(p.operatingCashFlow - p.capex, mcap), 4),
    dividendYield: p.dividendsPerShare !== undefined ? r(p.dividendsPerShare / price, 4) : null,
  };
}

export type DcfAssumptions = { fcf0: number; growth: number; years: number; terminalGrowth: number; discountRate: number; netDebt: number; shares: number };
/** Two-stage FCFF DCF → equity value per share (₹). */
export function dcfValue(a: DcfAssumptions): number | null {
  if (!(a.discountRate > a.terminalGrowth) || a.shares <= 0 || a.years < 1) return null;
  let pv = 0, f = a.fcf0;
  for (let t = 1; t <= a.years; t++) {
    f *= 1 + a.growth;
    pv += f / (1 + a.discountRate) ** t;
  }
  const tv = (f * (1 + a.terminalGrowth)) / (a.discountRate - a.terminalGrowth);
  pv += tv / (1 + a.discountRate) ** a.years;
  return (pv - a.netDebt) / a.shares;
}

/** Growth rate (first stage) implied by the current price; null when outside [-50%, 100%]. */
export function reverseDcf(price: number, a: Omit<DcfAssumptions, "growth">): number | null {
  let lo = -0.5, hi = 1;
  const f = (g: number) => (dcfValue({ ...a, growth: g }) ?? NaN) - price;
  if (!(f(lo) <= 0 && f(hi) >= 0)) return null;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export type InvestmentInput = {
  symbol: string;
  company: Company | null;
  price: number | null;
  priceDate: string | null;
  asOf: string;
  peers?: { symbol: string; company: Company; price: number }[];
  /** Historical closes at period ends (from the platform's EOD history), when available. */
  historicalPrices?: Record<string, number>;
  dcf?: Partial<{ discountRate: number; terminalGrowth: number; years: number; bearGrowth: number; baseGrowth: number; bullGrowth: number }>;
};

export type InvestmentAnalysis = {
  symbol: string;
  name: string;
  status: "ANALYSED" | "INSUFFICIENT DATA";
  asOf: string;
  price: number | null;
  latestPeriod: string | null;
  reportingDates: { period: string; periodEnd: string; reportedAt: string }[];
  quality: Quality | null;
  multiples: Multiples | null;
  historical: { period: string; pe: number | null; evEbitda: number | null }[];
  peers: { median: { pe: number | null; evEbitda: number | null; pb: number | null }; count: number } | null;
  dcf: { assumptions: Omit<DcfAssumptions, "growth">; scenarios: { bear: number | null; base: number | null; bull: number | null }; growth: { bear: number; base: number; bull: number }; impliedGrowth: number | null } | null;
  marginOfSafety: number | null;
  entryRange: { low: number; high: number } | null;
  horizon: string;
  invalidation: string[];
  reasonsToAvoid: string[];
  missing: string[];
};

const median = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

export function analyzeInvestment(i: InvestmentInput): InvestmentAnalysis {
  const missing: string[] = [];
  const base: InvestmentAnalysis = {
    symbol: i.symbol, name: i.company?.name ?? i.symbol, status: "INSUFFICIENT DATA", asOf: i.asOf, price: i.price, latestPeriod: null, reportingDates: [], quality: null, multiples: null,
    historical: [], peers: null, dcf: null, marginOfSafety: null, entryRange: null, horizon: "3–5 years", invalidation: [], reasonsToAvoid: [], missing,
  };
  if (!i.company) {
    missing.push("financial statements (no fundamentals dataset covers this company)", "shareholding and pledging", "governance disclosures", "business profile and catalysts");
    return base;
  }
  const periods = periodsKnownAt(i.company, i.asOf);
  base.reportingDates = periods.map((p) => ({ period: p.period, periodEnd: p.periodEnd, reportedAt: p.reportedAt }));
  if (periods.length < 2) {
    missing.push(`at least two published annual periods (have ${periods.length})`);
    return base;
  }
  if (i.price === null) {
    missing.push("current price");
    return base;
  }
  const q = quality(periods);
  if ("status" in q) return { ...base, missing: q.missing };
  const p = periods[periods.length - 1];
  const m = multiples(p, i.price, q.growth.epsCagr3y);
  if (!i.company.shareholding) missing.push("shareholding and pledging");
  if (!i.company.governance) missing.push("governance disclosures (auditor observations, contingent liabilities)");
  if (!i.company.profile) missing.push("business profile and catalysts");
  if (periods.length < 4) missing.push("three-year growth history (need 4 annual periods)");

  const historical = periods.map((pp) => {
    const hp = i.historicalPrices?.[pp.periodEnd];
    if (hp === undefined) return { period: pp.period, pe: null, evEbitda: null };
    const mm = multiples(pp, hp, null);
    return { period: pp.period, pe: mm.pe, evEbitda: mm.evEbitda };
  });
  if (historical.every((h) => h.pe === null)) missing.push("prices at past period ends (historical valuation range)");

  const peerM = (i.peers ?? []).map((x) => {
    const pp = periodsKnownAt(x.company, i.asOf).at(-1);
    return pp ? multiples(pp, x.price, null) : null;
  }).filter((x): x is Multiples => x !== null);
  const peers = peerM.length ? { median: { pe: median(peerM.map((x) => x.pe)), evEbitda: median(peerM.map((x) => x.evEbitda)), pb: median(peerM.map((x) => x.pb)) }, count: peerM.length } : null;
  if (!peers) missing.push("peer companies in the same industry");

  // DCF: explicit, overridable assumptions. Defaults are conservative and reported.
  const fcf0 = p.operatingCashFlow - p.capex;
  const histGrowth = q.growth.revenueCagr3y ?? q.growth.revenueYoY ?? 0.08;
  const g = {
    base: i.dcf?.baseGrowth ?? Math.max(0, Math.min(0.2, histGrowth)),
    bear: i.dcf?.bearGrowth ?? Math.max(-0.05, Math.min(0.2, histGrowth) - 0.06),
    bull: i.dcf?.bullGrowth ?? Math.min(0.3, Math.max(0, histGrowth) + 0.05),
  };
  const assumptions = { fcf0, years: i.dcf?.years ?? 10, terminalGrowth: i.dcf?.terminalGrowth ?? 0.05, discountRate: i.dcf?.discountRate ?? 0.12, netDebt: p.totalDebt - p.cash, shares: p.sharesOutstanding };
  const dcf = fcf0 > 0
    ? { assumptions, growth: g, scenarios: { bear: r(dcfValue({ ...assumptions, growth: g.bear })), base: r(dcfValue({ ...assumptions, growth: g.base })), bull: r(dcfValue({ ...assumptions, growth: g.bull })) }, impliedGrowth: r(reverseDcf(i.price, assumptions), 4) }
    : null;
  const reasons = [...q.flags];
  if (!dcf) reasons.push("free cash flow is not positive: DCF value not computed");
  if (i.company.shareholding?.pledgedPct && i.company.shareholding.pledgedPct > 10) reasons.push(`promoter pledge ${i.company.shareholding.pledgedPct}% of holding`);
  if (i.company.governance?.auditorObservations.length) reasons.push(`auditor observations: ${i.company.governance.auditorObservations.length}`);
  const baseValue = dcf?.scenarios.base ?? null;
  const mos = baseValue !== null && baseValue > 0 ? r((baseValue - i.price) / baseValue, 4) : null;
  if (mos !== null && mos < 0) reasons.push(`price is above the base-case value (margin of safety ${r(mos * 100, 1)}%)`);
  const entry = baseValue !== null && dcf?.scenarios.bear !== null && dcf !== null ? { low: r(Math.min(dcf.scenarios.bear!, baseValue * 0.75))!, high: r(baseValue * 0.85)! } : null;
  return {
    ...base, status: "ANALYSED", latestPeriod: p.period, quality: q, multiples: m, historical, peers, dcf, marginOfSafety: mos, entryRange: entry,
    invalidation: ["Two consecutive years of falling operating cash flow", "Debt-to-equity rising above 1.5", "Return on capital employed falling below the discount rate", "Promoter pledging increasing materially"],
    reasonsToAvoid: reasons, missing,
  };
}
