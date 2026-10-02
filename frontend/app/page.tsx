"use client";

import { useEffect, useState } from "react";

type MarketSnapshot = {
  index: string;
  level: number;
  change: number;
  percent: number;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "https://studious-rotary-phone-j9vxx45gpwjh54jv-5000.app.github.dev";

const plans = [
  { name: "7 Day Free Trial", monthlyInr: 0, text: "Explore the core TradestXPro experience.", features: ["Market dashboard", "Basic watchlist", "Limited preview access"] },
  { name: "Essential", monthlyInr: 999, text: "Focused market research and disciplined analysis.", features: ["SuperChart · 2 indicators", "2 stock AI analyses", "2 option AI analyses"] },
  { name: "Plus", monthlyInr: 1999, text: "More analysis capacity and price alerts.", features: ["SuperChart · 5 indicators", "5 stock AI analyses", "2 option AI analyses", "2 price notifications"], featured: true },
  { name: "Premium", monthlyInr: 5999, text: "Advanced charting and deeper options analysis.", features: ["SuperChart · 10 indicators", "2 charts", "10 stock AI analyses", "Payoff chart", "10 option AI analyses"] },
  { name: "Ultimate", monthlyInr: 19999, text: "Maximum workspace flexibility for advanced users.", features: ["SuperChart · Unlimited indicators", "10 charts", "Unlimited stock AI analyses", "Payoff chart", "Unlimited option AI analyses"] },
];

export default function Home() {
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [annual, setAnnual] = useState(false);
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");

  useEffect(() => {
    fetch(API_URL + "/api/market/nse")
      .then((r) => r.json())
      .then((data) => setMarket(data))
      .catch(() => setMarket(null));
  }, []);

  const value = market?.level ?? 22500;
  const change = market?.change ?? 120;
  const percent = market?.percent ?? 0.53;
  const positive = change >= 0;

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070b]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
          <a href="#top" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 bg-white/5 text-xs font-black">TX</span>
            <span className="text-xl font-semibold tracking-tight">TradestXPro</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
            <a href="#top" className="hover:text-white">Home</a>
            <a href="#market" className="hover:text-white">Market</a>
            <a href="#watchlist" className="hover:text-white">Watchlist</a>
            <a href="#ai-analysis" className="hover:text-white">AI Analysis</a>
            <a href="#superchart" className="hover:text-white">SuperChart</a>
          </nav>
          <div className="flex items-center gap-2">
            <button className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">Login</button>
            <button className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">Signup</button>
          </div>
        </div>
      </header>

      <section id="top" className="border-b border-white/10">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div className="flex flex-col justify-center">
            <span className="mb-5 w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">AI-powered market intelligence</span>
            <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
              See the market.<br /><span className="text-slate-400">Understand the trade.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-400">
              Market data, advanced charting and AI-assisted analysis in one disciplined trading workspace.
            </p>
            <div className="mt-8 flex gap-3">
              <a href="#plans" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Get Started</a>
              <a href="#market" className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold hover:bg-white/10">Explore Market</a>
            </div>
          </div>

          <div id="market" className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div><p className="text-sm text-slate-500">Market overview</p><h2 className="mt-1 text-xl font-semibold">Indian Indices</h2></div>
              <select defaultValue="NIFTY 50" className="rounded-lg border border-white/10 bg-[#0b111a] px-3 py-2 text-xs text-slate-200">
                <option>NIFTY 50</option><option>NIFTY NEXT 50</option><option>NIFTY 100</option><option>NIFTY BANK</option><option>SENSEX</option>
              </select>
            </div>
            <div className="grid gap-4 pt-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#0b111a] p-5">
                <p className="text-sm text-slate-500">NIFTY 50</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</p>
                <p className={"mt-2 text-sm font-medium " + (positive ? "text-emerald-400" : "text-rose-400")}>{positive ? "▲" : "▼"} {Math.abs(change)} ({Math.abs(percent).toFixed(2)}%)</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0b111a] p-5">
                <p className="text-sm text-slate-500">SENSEX</p>
                <p className="mt-2 text-3xl font-semibold">82,450</p>
                <p className="mt-2 text-sm font-medium text-emerald-400">▲ 268 (0.33%)</p>
              </div>
            </div>
            <div id="superchart" className="mt-4 rounded-2xl border border-white/10 bg-[#0b111a] p-5">
              <div className="flex items-center justify-between"><div><p className="text-sm text-slate-500">NIFTY 50 · 1D</p><p className="text-xs text-slate-600">SmartChart preview</p></div><span className="text-xs text-slate-500">Volume · Indicators · Time</span></div>
              <div className="mt-5 h-44 rounded-xl border border-white/5 bg-[#070b11] p-4">
                <svg viewBox="0 0 640 180" className="h-full w-full" aria-label="Chart preview">
                  <path d="M0,125 C55,115 65,135 110,113 S175,128 210,101 S270,104 305,86 S360,95 395,68 S450,78 485,55 S535,69 575,42 S615,54 640,30" fill="none" stroke="currentColor" strokeWidth="3" className="text-slate-200"/>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="ai-analysis" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <p className="text-sm text-slate-500">AI Analysis</p>
        <h2 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight">Turn market signals into structured analysis.</h2>
        <p className="mt-4 max-w-2xl text-slate-400">Combine price action, indicators, volume and derivatives data into a clear research workflow.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Stock Analysis", "Structured signals, entry zones, stop loss and targets."],
            ["Options Analysis", "Strike-level context, payoff views and risk framing."],
            ["Futures Analysis", "Trend, basis, open interest and momentum context."],
            ["Smart Insights", "Bring multiple market inputs into one view."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
              <h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="watchlist" className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <p className="text-sm text-slate-500">Your workspace</p>
          <h2 className="mt-2 text-3xl font-semibold">Watchlist & market discovery</h2>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {["NIFTY 50", "BANK NIFTY", "RELIANCE"].map((name, i) => (
              <div key={name} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0a0f17] p-4">
                <span className="font-medium">{name}</span><span className={i === 1 ? "text-rose-400" : "text-emerald-400"}>{i === 1 ? "▼ 0.24%" : "▲ 0.53%"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="plans" className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="text-center"><p className="text-sm text-slate-500">Pricing</p><h2 className="mt-3 text-4xl font-semibold">Plan for every Experience</h2><p className="mt-4 text-slate-400">Choose monthly or annual access and scale your market workspace.</p></div>
        <div className="mt-8 flex justify-center gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0b111a] p-1">
            <button onClick={() => setAnnual(false)} className={"rounded-lg px-4 py-2 text-sm " + (!annual ? "bg-white text-slate-950" : "text-slate-400")}>Monthly</button>
            <button onClick={() => setAnnual(true)} className={"rounded-lg px-4 py-2 text-sm " + (annual ? "bg-white text-slate-950" : "text-slate-400")}>Annual <span className="text-emerald-400">(save 10%)</span></button>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#0b111a] p-1">
            <button onClick={() => setCurrency("INR")} className={"rounded-lg px-4 py-2 text-sm " + (currency === "INR" ? "bg-white text-slate-950" : "text-slate-400")}>INR</button>
            <button onClick={() => setCurrency("USD")} className={"rounded-lg px-4 py-2 text-sm " + (currency === "USD" ? "bg-white text-slate-950" : "text-slate-400")}>USD</button>
          </div>
        </div>
        <div className="mt-10 grid gap-5 xl:grid-cols-5">
          {plans.map((plan) => {
            const monthlyInr = plan.monthlyInr;
            const annualInr = Math.round(monthlyInr * 12 * 0.9);
            const price = currency === "USD"
              ? "$" + Math.round((annual ? annualInr : monthlyInr) / 90)
              : "₹" + (annual ? annualInr : monthlyInr).toLocaleString("en-IN");
            const featured = plan.featured === true;
            return (
              <article key={plan.name} className={"flex flex-col rounded-2xl border p-6 " + (featured ? "border-white/30 bg-white text-slate-950" : "border-white/10 bg-[#0a0f17]")}>
                <p className={"text-sm " + (featured ? "text-slate-600" : "text-slate-500")}>{plan.name}</p>
                <h3 className="mt-3 text-3xl font-semibold">{price}</h3>
                <p className={"mt-4 text-sm leading-6 " + (featured ? "text-slate-600" : "text-slate-400")}>{plan.text}</p>
                <div className="my-5 border-t border-current opacity-10" />
                <div className="flex-1 space-y-3">{plan.features.map((feature) => <div key={feature} className="flex gap-2 text-sm"><span>✓</span><span>{feature}</span></div>)}</div>
                <button className={"mt-7 w-full rounded-xl px-4 py-3 text-sm font-semibold " + (featured ? "bg-slate-950 text-white" : "bg-white text-slate-950")}>{plan.name === "7 Day Free Trial" ? "Try 7 day free" : "Get Started"}</button>
              </article>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:justify-between lg:px-8">
          <span>© 2026 TradestXPro</span><span>Risk Disclosure · Terms · Privacy</span>
        </div>
      </footer>
    </main>
  );
}