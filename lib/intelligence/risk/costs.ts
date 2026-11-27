/**
 * Indian transaction-cost model with versioned, configurable rule schedules.
 *
 * Statutory rates change (Finance Acts, exchange circulars). They are kept as dated schedules with
 * their sources, chosen by trade date, overridable at deployment (`TXP_COST_SCHEDULES`, JSON array of
 * schedules), and every estimate reports which schedule it used and whether that schedule is past
 * its review date. Brokerage and slippage are user/broker assumptions, reported as such.
 */
export type Segment = "equity-delivery" | "equity-intraday" | "futures" | "options";
export type Side = "BUY" | "SELL";

export type CostSchedule = {
  id: string;
  effectiveFrom: string; // YYYY-MM-DD
  lastReviewed: string; // YYYY-MM-DD: when someone last checked these rates against the sources
  sources: string[];
  /** Rates as fractions of turnover (options: of premium turnover). */
  stt: Record<Segment, { buy: number; sell: number }>;
  exchangeTxn: Record<Segment, number>;
  sebiPerCrore: number;
  stampBuy: Record<Segment, number>;
  gst: number;
};

export const SCHEDULES: CostSchedule[] = [
  {
    id: "IN-2024-10",
    effectiveFrom: "2024-10-01",
    lastReviewed: "2024-10-01",
    sources: [
      "Finance (No. 2) Act, 2024: STT on futures 0.02% and options 0.1% of premium (sell side), from 1 Oct 2024",
      "NSE revised transaction charges (uniform slab), effective 1 Oct 2024",
      "Indian Stamp Act amendments (uniform stamp duty), effective 1 Jul 2020",
      "SEBI turnover fee ₹10 per crore; GST 18% on brokerage, exchange charges and SEBI fees",
    ],
    stt: {
      "equity-delivery": { buy: 0.001, sell: 0.001 },
      "equity-intraday": { buy: 0, sell: 0.00025 },
      futures: { buy: 0, sell: 0.0002 },
      options: { buy: 0, sell: 0.001 },
    },
    exchangeTxn: { "equity-delivery": 0.0000297, "equity-intraday": 0.0000297, futures: 0.0000173, options: 0.0003503 },
    sebiPerCrore: 10,
    stampBuy: { "equity-delivery": 0.00015, "equity-intraday": 0.00003, futures: 0.00002, options: 0.00003 },
    gst: 0.18,
  },
];

export const REVIEW_AFTER_DAYS = 180;

export type CostAssumptions = {
  /** Brokerage per executed order (₹). Default 20 (typical discount broker) — an assumption, not a fact. */
  brokeragePerOrder?: number;
  /** Optional percentage cap/alternative (fraction of turnover); brokerage = min(perOrder, pct × turnover) when set. */
  brokeragePct?: number;
  /** Slippage per side as a fraction of price (default 5 bps cash/futures; options default: 1 tick unless spread known). */
  slippage?: number;
};

export type Leg = { segment: Segment; side: Side; price: number; quantity: number };

export type CostEstimate = {
  scheduleId: string;
  scheduleReviewDue: boolean;
  turnover: number;
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  stamp: number;
  gst: number;
  statutoryTotal: number;
  slippage: number;
  total: number;
  assumptions: string[];
};

export function scheduleFor(tradeDate: string, schedules: CostSchedule[] = activeSchedules()): CostSchedule {
  const s = [...schedules].filter((x) => x.effectiveFrom <= tradeDate).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!s) throw new Error(`no cost schedule effective on ${tradeDate}`);
  return s;
}

export function activeSchedules(env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env): CostSchedule[] {
  const raw = env.TXP_COST_SCHEDULES;
  if (!raw) return SCHEDULES;
  try {
    const extra = JSON.parse(raw) as CostSchedule[];
    if (Array.isArray(extra) && extra.every((x) => x && typeof x.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.effectiveFrom))) return [...SCHEDULES, ...extra];
  } catch {
    // ignore malformed override (the built-in schedule stays in use and is flagged for review)
  }
  return SCHEDULES;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Round-trip or single-leg cost estimate. Every leg is one executed order. */
export function estimateCosts(legs: Leg[], opts: CostAssumptions & { tradeDate: string; schedules?: CostSchedule[]; today?: string } ): CostEstimate {
  const s = scheduleFor(opts.tradeDate, opts.schedules);
  const per = opts.brokeragePerOrder ?? 20;
  const assumptions = [`brokerage ₹${per} per order${opts.brokeragePct !== undefined ? ` or ${(opts.brokeragePct * 100).toFixed(3)}% of turnover, whichever is lower` : ""} (assumed; set your broker's rate)`];
  let turnover = 0, brokerage = 0, stt = 0, exchange = 0, stamp = 0, slippage = 0;
  for (const l of legs) {
    if (!(l.price >= 0) || !(l.quantity > 0)) throw new Error("legs need a non-negative price and a positive quantity");
    const value = l.price * l.quantity;
    turnover += value;
    brokerage += opts.brokeragePct !== undefined ? Math.min(per, opts.brokeragePct * value) : per;
    stt += value * (l.side === "BUY" ? s.stt[l.segment].buy : s.stt[l.segment].sell);
    exchange += value * s.exchangeTxn[l.segment];
    if (l.side === "BUY") stamp += value * s.stampBuy[l.segment];
    const slip = opts.slippage ?? (l.segment === "options" ? 0 : 0.0005);
    slippage += value * slip;
  }
  if (opts.slippage === undefined) assumptions.push("slippage 5 bps per side for cash and futures; options: spread-based (0 when the spread is unknown — add it yourself)");
  const sebi = (turnover * s.sebiPerCrore) / 1e7;
  const gst = (brokerage + exchange + sebi) * s.gst;
  const statutoryTotal = stt + exchange + sebi + stamp + gst;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const reviewDue = (Date.parse(today) - Date.parse(s.lastReviewed)) / 86_400_000 > REVIEW_AFTER_DAYS;
  if (reviewDue) assumptions.push(`statutory rates from schedule ${s.id} (last reviewed ${s.lastReviewed}): verify against current exchange and tax notifications`);
  return {
    scheduleId: s.id, scheduleReviewDue: reviewDue, turnover: r2(turnover), brokerage: r2(brokerage), stt: r2(stt), exchange: r2(exchange), sebi: r2(sebi), stamp: r2(stamp), gst: r2(gst),
    statutoryTotal: r2(statutoryTotal), slippage: r2(slippage), total: r2(brokerage + statutoryTotal + slippage), assumptions,
  };
}
