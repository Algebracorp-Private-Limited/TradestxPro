"use client";

import { useState } from "react";
import { InstrumentSearch } from "@/components/instrument-search";
import { Card, Insufficient, KV, Loading, Notice, Restricted, StatusBadge, fmt, inr, pct } from "./ui";

type A = {
  symbol: string; name: string; status: string; asOf: string; price: number | null; latestPeriod: string | null;
  reportingDates: { period: string; periodEnd: string; reportedAt: string }[];
  quality: null | { growth: Record<string, number | null>; margins: Record<string, number | null>; cash: Record<string, number | null>; balance: Record<string, number | null>; returns: Record<string, number | null>; flags: string[] };
  multiples: null | Record<string, number | null>;
  historical: { period: string; pe: number | null; evEbitda: number | null }[];
  peers: null | { median: { pe: number | null; evEbitda: number | null; pb: number | null }; count: number };
  dcf: null | { assumptions: { fcf0: number; years: number; terminalGrowth: number; discountRate: number; netDebt: number; shares: number }; scenarios: { bear: number | null; base: number | null; bull: number | null }; growth: { bear: number; base: number; bull: number }; impliedGrowth: number | null };
  marginOfSafety: number | null; entryRange: { low: number; high: number } | null; horizon: string; invalidation: string[]; reasonsToAvoid: string[]; missing: string[]; restricted?: string[];
};
type Thesis = { thesis: string; qualityAssessment: string; valuationAssessment: string; growthDrivers: string[]; risks: string[]; avoidIf: string[]; source: string; model: string | null; fallbackReason: string | null };
type Resp = { analysis: A; thesis: Thesis | null; provenance: { fundamentals: { provider: { name: string; source: { name: string; url?: string }; retrievedAt: string }; revision: string; importedAt: string } | null } };

export function InvestmentAI() {
  const [res, setRes] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const analyze = async (sym: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/intelligence/investment/analyze?symbol=${encodeURIComponent(sym)}&explain=1`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Analysis failed");
      setRes(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const a = res?.analysis;
  return (
    <div className="space-y-4">
      <Card title="Fundamental investment analysis">
        <InstrumentSearch placeholder="Search an NSE company — e.g. INFY" onPick={(r) => analyze(r.symbol)} />
        <p className="mt-2 text-[11px] text-muted">Uses imported financial statements only (no technical indicators). Without a fundamentals dataset for the company the result is INSUFFICIENT DATA.</p>
      </Card>
      {err && <Notice tone="error">{err}</Notice>}
      {busy && <Loading label="Analysing…" />}
      {a && !busy && (
        <Card title={<span>{a.name} <span className="font-mono text-xs text-muted">NSE:{a.symbol}</span></span>} right={<StatusBadge status={a.status} />}>
          {a.status === "INSUFFICIENT DATA" ? <Insufficient missing={a.missing} reasons={["Fundamental analysis needs published financial statements from a licensed or verified source; none are imported for this company."]} /> : (
            <div className="space-y-4 text-sm">
              {res?.provenance.fundamentals && <p className="text-[11px] text-muted">Source: {res.provenance.fundamentals.provider.name} ({res.provenance.fundamentals.provider.source.name}), retrieved {res.provenance.fundamentals.provider.retrievedAt}, revision {res.provenance.fundamentals.revision}. Reporting dates: {a.reportingDates.map((r) => `${r.period} (published ${r.reportedAt})`).join(", ")}.</p>}
              {a.restricted && <Restricted notices={["The investment entry range is restricted until regulatory review is complete."]} />}
              <div className="grid gap-4 lg:grid-cols-3">
                <div><p className="mb-1 text-xs font-semibold">Financial quality ({a.latestPeriod})</p>{a.quality && <KV items={[
                  ["Revenue growth (YoY / 3y CAGR)", `${pct(a.quality.growth.revenueYoY, 1, true)} / ${pct(a.quality.growth.revenueCagr3y, 1, true)}`],
                  ["EPS growth (YoY / 3y CAGR)", `${pct(a.quality.growth.epsYoY, 1, true)} / ${pct(a.quality.growth.epsCagr3y, 1, true)}`],
                  ["EBITDA / operating / net margin", `${pct(a.quality.margins.ebitda, 1, true)} / ${pct(a.quality.margins.operating, 1, true)} / ${pct(a.quality.margins.net, 1, true)}`],
                  ["ROE / ROCE / ROIC", `${pct(a.quality.returns.roe, 1, true)} / ${pct(a.quality.returns.roce, 1, true)} / ${pct(a.quality.returns.roic, 1, true)}`],
                  ["Free cash flow", `${inr(a.quality.cash.freeCashFlow, 0)} cr`],
                  ["Cash conversion (OCF / NP)", fmt(a.quality.cash.cashConversion)],
                  ["Debt / equity", fmt(a.quality.balance.debtToEquity)],
                  ["Interest coverage", `${fmt(a.quality.balance.interestCoverage)}×`],
                ]} />}</div>
                <div><p className="mb-1 text-xs font-semibold">Valuation (price {inr(a.price)})</p>{a.multiples && <KV items={[
                  ["P/E · P/B", `${fmt(a.multiples.pe)} · ${fmt(a.multiples.pb)}`], ["EV/EBITDA · EV/Sales", `${fmt(a.multiples.evEbitda)} · ${fmt(a.multiples.evSales)}`],
                  ["PEG", fmt(a.multiples.peg)], ["FCF yield · dividend yield", `${pct(a.multiples.fcfYield, 2, true)} · ${pct(a.multiples.dividendYield, 2, true)}`],
                  ["Peer median P/E · EV/EBITDA", a.peers ? `${fmt(a.peers.median.pe)} · ${fmt(a.peers.median.evEbitda)} (${a.peers.count} peers)` : "no peers imported"],
                  ["Historical P/E", a.historical.filter((h) => h.pe !== null).map((h) => `${h.period} ${fmt(h.pe)}`).join(", ") || "no period-end prices"],
                ]} />}</div>
                <div><p className="mb-1 text-xs font-semibold">DCF (₹ per share)</p>{a.dcf ? <KV items={[
                  ["Bear / base / bull", `${inr(a.dcf.scenarios.bear)} / ${inr(a.dcf.scenarios.base)} / ${inr(a.dcf.scenarios.bull)}`],
                  ["Growth (bear / base / bull)", `${pct(a.dcf.growth.bear, 1, true)} / ${pct(a.dcf.growth.base, 1, true)} / ${pct(a.dcf.growth.bull, 1, true)} for ${a.dcf.assumptions.years} years`],
                  ["Discount rate · terminal growth", `${pct(a.dcf.assumptions.discountRate, 1, true)} · ${pct(a.dcf.assumptions.terminalGrowth, 1, true)}`],
                  ["Reverse DCF: growth implied by price", pct(a.dcf.impliedGrowth, 1, true)],
                  ["Margin of safety (vs base)", pct(a.marginOfSafety, 1, true)],
                  ...(a.entryRange ? [["Investment entry range", `${inr(a.entryRange.low)} – ${inr(a.entryRange.high)}`] as [string, string]] : []),
                  ["Horizon", a.horizon],
                ]} /> : <p className="text-xs text-muted">Not computed (free cash flow not positive).</p>}</div>
              </div>
              {res?.thesis && (
                <div className="rounded-xl border border-line p-3 text-xs leading-5">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">{res.thesis.source === "fallback" ? `Deterministic summary (${res.thesis.fallbackReason ?? "AI unavailable"})` : `AI research summary · ${res.thesis.model} · numbers checked`}</p>
                  <p className="text-soft">{res.thesis.thesis}</p>
                  <p className="mt-1 text-muted">{res.thesis.qualityAssessment} {res.thesis.valuationAssessment}</p>
                  {res.thesis.growthDrivers.length > 0 && <p className="mt-1 text-muted"><span className="text-soft">Growth drivers:</span> {res.thesis.growthDrivers.join(" · ")}</p>}
                  {res.thesis.risks.length > 0 && <p className="mt-1 text-muted"><span className="text-soft">Risks:</span> {res.thesis.risks.join(" · ")}</p>}
                </div>
              )}
              <div className="grid gap-4 text-xs sm:grid-cols-2">
                <div><p className="font-semibold">Thesis invalidation</p><ul className="mt-1 list-disc pl-4 text-muted">{a.invalidation.map((x) => <li key={x}>{x}</li>)}</ul></div>
                <div><p className="font-semibold">Reasons to avoid / missing data</p><ul className="mt-1 list-disc pl-4 text-muted">{[...a.reasonsToAvoid, ...a.missing.map((m) => `Missing: ${m}`)].map((x) => <li key={x}>{x}</li>)}</ul></div>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
