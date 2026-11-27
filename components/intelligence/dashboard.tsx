"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Empty, FreshnessBadge, KV, Loading, Notice, fmt, pct, type Prov } from "./ui";

type Data = {
  asOf: string | null;
  provenance: Prov;
  marketRegime: { primary: string; flags: string[]; confidence: string; direction: number; evidence: { id: string; label: string; detail: string }[] } | null;
  marketRegimeMissing: string[];
  indices: { key: string; close: number | null; changePct: number | null; date: string | null }[];
  breadth: { advances: number; declines: number; unchanged: number; above200: number; total: number; newHighs: number; newLows: number } | null;
  sectors: { industry: string; members: number; avgChangePct: number; advancing: number }[];
  vix: { close: number | null; changePct: number | null } | null;
  scans: { id: number; status: string; mode: string; createdAt: string; horizon: string; coverage: { scanned: number; unique: number; opportunities: Record<string, number>; notDeepEvaluated: number } }[] | null;
  gate: { actionable: boolean; personalized: boolean; research: boolean };
  ai: { id: string; configured: boolean; model: string | null }[];
  capabilities: { kind: string; available: string; notes: string }[];
};

const ENGINES = [
  { href: "/ai-intelligence/market-scan", name: "MarketScan AI", text: "Scan index universes with staged, deterministic screening and reported coverage." },
  { href: "/ai-intelligence/equity", name: "Equity AI", text: "Conditional swing and positional setups for one stock." },
  { href: "/ai-intelligence/investment", name: "Investment AI", text: "Fundamentals, valuation and DCF from imported financial statements." },
];

export function IntelligenceDashboard() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/intelligence/dashboard").then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) setErr(j.error ?? "Could not load the dashboard.");
      else setD(j);
    }, () => alive && setErr("Network error."));
    return () => { alive = false; };
  }, []);
  if (err) return <Notice tone="error">{err}</Notice>;
  if (!d) return <Loading />;
  const latestScan = d.scans?.find((s) => s.status === "completed");
  const missing = d.capabilities.filter((c) => c.available === "no");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <FreshnessBadge p={d.provenance} />
        <span className="text-muted">AI: {d.ai.filter((a) => a.configured).map((a) => `${a.id} (${a.model})`).join(", ") || "not configured — deterministic explanations only"}</span>
      </div>
      {!d.gate.research && <Notice tone="warn">Research tools (scanner, equity and investment analysis) are not activated in this environment. Market analytics below remain available.</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Overall market direction (NIFTY 50)" className="lg:col-span-2">
          {d.marketRegime ? (
            <div className="space-y-2 text-sm">
              <p><span className="text-lg font-semibold">{d.marketRegime.primary}</span> <span className="text-xs text-muted">({d.marketRegime.confidence} confidence, direction {fmt(d.marketRegime.direction)})</span></p>
              {d.marketRegime.flags.length > 0 && <p className="text-xs text-gold">{d.marketRegime.flags.join(" · ")}</p>}
              <ul className="space-y-0.5 text-xs text-muted">{d.marketRegime.evidence.slice(0, 5).map((e) => <li key={e.id}><span className="text-soft">{e.label}:</span> {e.detail}</li>)}</ul>
            </div>
          ) : <Empty>Not enough NIFTY 50 history to classify the regime ({d.marketRegimeMissing.join(", ")}).</Empty>}
        </Card>
        <Card title="Volatility and breadth">
          <KV items={[
            ["India VIX", d.vix ? `${fmt(d.vix.close)} (${pct(d.vix.changePct, 2)})` : "—"],
            ["Advances / declines", d.breadth ? `${d.breadth.advances} / ${d.breadth.declines}` : "—"],
            ["Above 200-day EMA", d.breadth ? `${d.breadth.above200} of ${d.breadth.total} (${pct((d.breadth.above200 / d.breadth.total) * 100, 0)})` : "—"],
            ["52-week highs / lows", d.breadth ? `${d.breadth.newHighs} / ${d.breadth.newLows}` : "—"],
          ]} />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Major indices">
          <ul className="space-y-1 text-sm">{d.indices.map((i) => (
            <li key={i.key} className="flex justify-between gap-2"><span className="text-soft">{i.key}</span><span className="font-mono">{fmt(i.close)} <span className={(i.changePct ?? 0) >= 0 ? "text-up" : "text-down"}>{pct(i.changePct, 2)}</span></span></li>
          ))}</ul>
        </Card>
        <Card title="Sector performance (latest session)" className="lg:col-span-2">
          {d.sectors.length ? (
            <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">{d.sectors.slice(0, 16).map((s) => (
              <li key={s.industry} className="flex justify-between gap-2"><span className="truncate text-soft">{s.industry}</span><span className="font-mono"><span className={s.avgChangePct >= 0 ? "text-up" : "text-down"}>{pct(s.avgChangePct, 2)}</span> <span className="text-muted">{s.advancing}/{s.members}</span></span></li>
            ))}</ul>
          ) : <Empty>No sector data (index constituents not loaded).</Empty>}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Opportunities (your latest completed scan)" className="lg:col-span-2">
          {latestScan ? (
            <div className="space-y-2 text-sm">
              <p className="text-xs text-muted">Scan #{latestScan.id} · {latestScan.mode} · {latestScan.horizon} · {latestScan.coverage.scanned} of {latestScan.coverage.unique} symbols evaluated{latestScan.coverage.notDeepEvaluated ? ` (${latestScan.coverage.notDeepEvaluated} not deep-evaluated: accelerated mode)` : ""}</p>
              <ul className="flex flex-wrap gap-2 text-xs">{Object.entries(latestScan.coverage.opportunities).map(([k, v]) => <li key={k} className="rounded-md border border-line px-2 py-1">{k}: <b>{v}</b></li>)}</ul>
              <Link className="text-xs text-accent" href={`/ai-intelligence/market-scan?job=${latestScan.id}`}>Open results →</Link>
            </div>
          ) : <Empty>No completed scan yet. Bullish/bearish equity opportunities appear here after a market scan.</Empty>}
          <p className="mt-2 text-[11px] text-muted">Futures, option buying/selling and multi-leg opportunities come from the F&O scanner (a later milestone).</p>
        </Card>
        <Card title="Data coverage and warnings">
          <ul className="space-y-1 text-xs text-muted">
            <li>Data is end-of-day unless your broker is connected: intraday setups are not generated from it.</li>
            {missing.slice(0, 7).map((m) => <li key={m.kind}><span className="text-down">Unavailable:</span> {m.kind}{m.notes ? ` — ${m.notes}` : ""}</li>)}
          </ul>
        </Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {ENGINES.map((e) => (
          <Link key={e.href} href={e.href} className="rounded-2xl border border-line p-4 hover:border-accent/50">
            <h3 className="font-semibold">{e.name}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{e.text}</p>
          </Link>
        ))}
      </div>
      <p className="text-[11px] leading-5 text-muted">Research and educational analytics. Not investment advice or a recommendation to trade. Scores rank evidence and are not probabilities of profit. Confirm prices with your broker.</p>
    </div>
  );
}
