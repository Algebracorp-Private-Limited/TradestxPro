// Product catalogue taken from the TradestXPro Master Blueprint (sections 2, 9 and 10).

export type Phase = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7";

export const PHASES: Record<Phase, string> = {
  P1: "Foundation",
  P2: "Market data",
  P3: "Charts & screening",
  P4: "Derivatives",
  P5: "AI Intelligence",
  P6: "XScript & backtesting",
  P7: "Commercial readiness",
};

export type Module = { slug: string; name: string; blurb: string; phase: Phase; icon: string };

export const MODULES: Module[] = [
  { slug: "dashboard", name: "Dashboard", blurb: "Index tiles, breadth, movers, news and widgets.", phase: "P2", icon: "◧" },
  { slug: "markets", name: "Markets", blurb: "NSE/BSE indices, constituents, sectors, MCX and FX.", phase: "P2", icon: "▤" },
  { slug: "watchlists", name: "Watchlists", blurb: "Multiple lists, custom columns, tags and alerts.", phase: "P2", icon: "☆" },
  { slug: "charts", name: "Advanced Charts", blurb: "Candles, indicators, drawings and multi-chart layouts.", phase: "P3", icon: "⌇" },
  { slug: "screener", name: "Stock Screener", blurb: "Technical, fundamental, momentum and liquidity filters.", phase: "P3", icon: "⌕" },
  { slug: "alerts", name: "Alerts", blurb: "Price, technical, OI, IV and AI-condition alerts.", phase: "P3", icon: "◔" },
  { slug: "futures", name: "Futures Explorer", blurb: "Index and stock contracts, OI, basis and rollover.", phase: "P4", icon: "⇄" },
  { slug: "options", name: "Options Chain", blurb: "Strikes, OI, Greeks, IV, PCR and max pain.", phase: "P4", icon: "⋮" },
  { slug: "options-screener", name: "Options Screener", blurb: "Greeks, IV, OI, liquidity and unusual activity.", phase: "P4", icon: "◇" },
  { slug: "strategy-lab", name: "Strategy Lab", blurb: "Multi-leg builder, payoff, Greeks and margin estimates.", phase: "P4", icon: "∑" },
  { slug: "ai", name: "AI Trade Intelligence", blurb: "Evidence-led scenarios, levels and invalidation.", phase: "P5", icon: "✦" },
  { slug: "research", name: "Research & News", blurb: "Announcements, corporate actions and AI summaries.", phase: "P5", icon: "❐" },
  { slug: "xscript", name: "XScript Studio", blurb: "Custom indicators and strategies, sandboxed backtests.", phase: "P6", icon: "{}" },
  { slug: "portfolio", name: "Portfolio & Risk", blurb: "Research portfolios, paper trades and risk analytics.", phase: "P6", icon: "◐" },
  { slug: "brokers", name: "Broker Connections", blurb: "ICICI Direct Breeze first; provider-agnostic adapters.", phase: "P7", icon: "⛓" },
];

export type Plan = {
  name: string;
  monthlyInr: number;
  tagline: string;
  features: string[];
  featured?: boolean;
};

export const PLANS: Plan[] = [
  {
    name: "Essential",
    monthlyInr: 999,
    tagline: "Focused research and disciplined analysis.",
    features: ["Market dashboard", "Basic watchlists", "Charts · 2 indicators", "Basic stock screener", "Basic option chain", "Limited AI reports"],
  },
  {
    name: "Plus",
    monthlyInr: 1999,
    tagline: "More analysis capacity and alerts.",
    features: ["Everything in Essential", "Extended watchlists", "Charts · 5 indicators", "Advanced stock screener", "Basic options screener", "Standard AI reports", "Basic XScript & backtests"],
    featured: true,
  },
  {
    name: "Premium",
    monthlyInr: 5999,
    tagline: "Advanced charting and deeper derivatives work.",
    features: ["Everything in Plus", "Charts · 10 indicators, 2 layouts", "Advanced options screener", "Payoff & Strategy Lab", "Extended AI reports", "Portfolio risk analytics"],
  },
  {
    name: "Ultimate",
    monthlyInr: 19999,
    tagline: "Maximum workspace for professional users.",
    features: ["Everything in Premium", "Unlimited indicators, 10 charts", "Advanced XScript & backtests", "Highest AI report limits", "Priority support"],
  },
];

export const ANNUAL_DISCOUNT = 0.1;
export const TRIAL_DAYS = 7;

export function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
