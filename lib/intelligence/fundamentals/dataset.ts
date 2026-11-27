/**
 * Fundamentals datasets (`txp-fundamentals`, version 1): company financial statements supplied by a
 * licensed provider or prepared from company filings, imported with attribution and reporting dates.
 * TradestXPro has no fundamentals feed of its own; without an imported dataset every investment
 * analysis is INSUFFICIENT DATA. Nothing is estimated to fill gaps.
 *
 * Units: all monetary values in ₹ crore; per-share values in ₹; shares in crore.
 */
export const FUNDAMENTALS_FORMAT = "txp-fundamentals";

export type Period = {
  period: string; // e.g. FY2025
  periodEnd: string; // YYYY-MM-DD
  reportedAt: string; // YYYY-MM-DD (date the results were published)
  type: "annual";
  consolidated: boolean;
  revenue: number;
  ebitda: number;
  operatingProfit: number; // EBIT
  netProfit: number;
  eps: number;
  operatingCashFlow: number;
  capex: number;
  totalDebt: number;
  cash: number;
  equity: number;
  interestExpense: number;
  sharesOutstanding: number;
  dividendsPerShare?: number;
  currentAssets?: number;
  currentLiabilities?: number;
  taxRate?: number; // fraction
};

export type Company = {
  name: string;
  industry: string;
  periods: Period[];
  shareholding?: { asOf: string; promoterPct: number; pledgedPct: number | null };
  governance?: { asOf: string; auditorObservations: string[]; contingentLiabilities: number | null };
  profile?: { description: string; source: string };
};

export type FundamentalsDataset = {
  format: typeof FUNDAMENTALS_FORMAT;
  version: 1;
  revision: string;
  provider: { id: string; name: string; source: { name: string; url?: string }; retrievedAt: string; license?: string };
  companies: Record<string, Company>;
};

export class FundamentalsError extends Error {}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED: (keyof Period)[] = ["revenue", "ebitda", "operatingProfit", "netProfit", "eps", "operatingCashFlow", "capex", "totalDebt", "cash", "equity", "interestExpense", "sharesOutstanding"];
const BAD = new Set(["__proto__", "constructor", "prototype"]);

/** Validates a dataset (JSON text or object); throws FundamentalsError with the first problem. */
export function parseFundamentals(input: unknown): FundamentalsDataset {
  let d = input;
  if (typeof input === "string") {
    if (input.length > 20_000_000) throw new FundamentalsError("dataset too large");
    try {
      d = JSON.parse(input);
    } catch {
      throw new FundamentalsError("not valid JSON");
    }
  }
  const o = d as FundamentalsDataset;
  const err = (m: string) => {
    throw new FundamentalsError(m);
  };
  if (!o || o.format !== FUNDAMENTALS_FORMAT || o.version !== 1) err(`not a ${FUNDAMENTALS_FORMAT} v1 dataset`);
  if (typeof o.revision !== "string" || !o.revision) err("revision is required");
  if (!o.provider || !/^[A-Za-z0-9._-]{1,64}$/.test(o.provider.id ?? "") || !o.provider.name || !o.provider.source?.name) err("provider needs id, name and source.name");
  if (!DATE.test(o.provider.retrievedAt ?? "")) err("provider.retrievedAt must be YYYY-MM-DD");
  if (!o.companies || typeof o.companies !== "object") err("companies must be an object");
  for (const [sym, c] of Object.entries(o.companies)) {
    if (BAD.has(sym) || !/^[A-Z0-9&.-]{1,30}$/.test(sym)) err(`invalid symbol "${sym}"`);
    if (!c || typeof c.name !== "string" || typeof c.industry !== "string" || !Array.isArray(c.periods) || !c.periods.length) err(`${sym}: name, industry and periods are required`);
    const seen = new Set<string>();
    for (const p of c.periods) {
      if (!p || typeof p.period !== "string" || !DATE.test(p.periodEnd) || !DATE.test(p.reportedAt) || p.type !== "annual") err(`${sym}: periods need period, periodEnd, reportedAt and type "annual"`);
      if (p.reportedAt < p.periodEnd) err(`${sym} ${p.period}: reportedAt before periodEnd`);
      if (seen.has(p.periodEnd)) err(`${sym}: duplicate period ${p.periodEnd}`);
      seen.add(p.periodEnd);
      for (const k of REQUIRED) if (typeof p[k] !== "number" || !Number.isFinite(p[k] as number)) err(`${sym} ${p.period}: ${k} must be a finite number`);
      if (p.sharesOutstanding <= 0) err(`${sym} ${p.period}: sharesOutstanding must be positive`);
      for (const k of ["dividendsPerShare", "currentAssets", "currentLiabilities", "taxRate"] as const) if (p[k] !== undefined && !Number.isFinite(p[k] as number)) err(`${sym} ${p.period}: ${k} must be a number`);
    }
    c.periods.sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  }
  return o;
}

/** Periods that were published on or before `asOf` (point-in-time: no look-ahead in analyses or backtests). */
export function periodsKnownAt(c: Company, asOf: string): Period[] {
  return c.periods.filter((p) => p.reportedAt <= asOf);
}
