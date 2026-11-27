"use client";

import { FreshnessBadge, Insufficient, KV, Restricted, ScoreBar, StatusBadge, fmt, inr, pct, type Prov } from "./ui";

/** Shape of an equity setup as returned by the API (after the presentation gate). */
export type SetupView = {
  symbol: string; name: string; sector: string | null; horizon: string; status: string; direction: string | null; setup: string; price: number | null; asOf: string | null; freshness: string;
  entry?: { low: number; high: number } | null; confirmation?: string | null; stop?: number | null; targets?: { price: number; label: string }[]; trailing?: string | null; invalidation?: string | null;
  timeExit?: string | null; riskPerShare?: number | null; rewardPerShare?: number | null; rewardRisk?: number | null;
  sizing?: { quantity: number; capitalUsed: number; plannedRisk: number; limitedBy: string; reasons: string[] } | null;
  costs?: { total: number; brokerage: number; statutoryTotal: number; slippage: number; scheduleId: string; scheduleReviewDue: boolean; assumptions: string[] } | null;
  liquidity: { medianTradedValue: number | null; ok: boolean }; volatility: { atrPct: number | null; realisedVol: number | null };
  regime: { primary: string; flags: string[]; confidence: string; evidence: { id: string; label: string; detail: string }[] } | null;
  score: { total: number; components: { label: string; value: number; weight: number; reason: string }[]; disclaimer: string } | null;
  evidenceQuality: string; evidence: { id: string; label: string; detail: string }[]; reasonsToAvoid: string[]; missing: string[];
  explanation?: { summary: string; reasoning: string[]; risks: string[]; avoidIf: string[]; source: string; model: string | null; fallbackReason: string | null } | null;
  notices?: string[];
};

export function SetupDetail({ s, provenance }: { s: SetupView; provenance?: Prov }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={s.status} />
        <span className="font-semibold">{s.setup}</span>
        <span className="text-xs text-muted">{s.horizon} · {s.direction ?? "no direction"}</span>
        <FreshnessBadge p={provenance ?? { source: "NSE EOD", exchangeTime: s.asOf, freshness: s.freshness }} />
      </div>
      {s.status === "INSUFFICIENT DATA" && <Insufficient reasons={s.reasonsToAvoid} missing={s.missing} />}
      <Restricted notices={s.notices} />
      <div className="grid gap-4 lg:grid-cols-2">
        <KV items={[
          ["Price", inr(s.price)],
          ...(s.entry ? [["Entry range", `${inr(s.entry.low)} – ${inr(s.entry.high)}`] as [string, string]] : []),
          ...(s.confirmation ? [["Entry confirmation", s.confirmation] as [string, string]] : []),
          ...(s.stop !== undefined && s.stop !== null ? [["Stop-loss", inr(s.stop)] as [string, string]] : []),
          ...((s.targets ?? []).map((t) => [t.label, inr(t.price)] as [string, string])),
          ...(s.trailing ? [["Trailing stop", s.trailing] as [string, string]] : []),
          ...(s.invalidation ? [["Invalidation", s.invalidation] as [string, string]] : []),
          ...(s.timeExit ? [["Time-based exit", s.timeExit] as [string, string]] : []),
          ...(s.riskPerShare ? [["Risk / reward per share", `${inr(s.riskPerShare)} / ${inr(s.rewardPerShare)} (R:R ${fmt(s.rewardRisk)})`] as [string, string]] : []),
          ...(s.sizing ? [["Position (your limits)", `${s.sizing.quantity} shares · ${inr(s.sizing.capitalUsed, 0)} capital · planned risk ${inr(s.sizing.plannedRisk, 0)} (limited by ${s.sizing.limitedBy})`] as [string, string]] : []),
          ...(s.costs ? [["Estimated costs (round trip)", `${inr(s.costs.total)} = brokerage ${inr(s.costs.brokerage)} + statutory ${inr(s.costs.statutoryTotal)} + slippage ${inr(s.costs.slippage)}`] as [string, string]] : []),
          ["Liquidity", s.liquidity.medianTradedValue === null ? "unknown" : `${inr(s.liquidity.medianTradedValue / 1e7, 2)} crore median daily value${s.liquidity.ok ? "" : " (below minimum)"}`],
          ["Volatility", `ATR ${pct(s.volatility.atrPct, 2)} of price · realised ${pct(s.volatility.realisedVol, 1)}`],
          ["Regime", s.regime ? `${s.regime.primary}${s.regime.flags.length ? ` · ${s.regime.flags.join(", ")}` : ""} (${s.regime.confidence} confidence)` : "—"],
          ["Evidence quality", s.evidenceQuality],
        ]} />
        <div className="space-y-3">
          {s.score && <ScoreBar total={s.score.total} components={s.score.components} disclaimer={s.score.disclaimer} />}
          {s.reasonsToAvoid.length > 0 && s.status !== "INSUFFICIENT DATA" && (
            <div>
              <p className="text-xs font-semibold text-soft">Reasons to avoid or be careful</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">{s.reasonsToAvoid.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
      {s.explanation && (
        <div className="rounded-xl border border-line p-3 text-xs leading-5">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">
            {s.explanation.source === "fallback" ? `Deterministic explanation (${s.explanation.fallbackReason ?? "AI unavailable"})` : `AI explanation · ${s.explanation.model} · checked against the computed numbers`}
          </p>
          <p className="text-soft">{s.explanation.summary}</p>
          {s.explanation.reasoning.length > 0 && <ul className="mt-1 list-disc pl-4 text-muted">{s.explanation.reasoning.map((r) => <li key={r}>{r}</li>)}</ul>}
          {s.explanation.risks.length > 0 && <p className="mt-1 text-muted"><span className="text-soft">Risks:</span> {s.explanation.risks.join(" · ")}</p>}
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Evidence ({s.evidence.length})</summary>
        <ul className="mt-1 space-y-0.5 text-muted">{s.evidence.map((e) => <li key={e.id + e.detail}><span className="text-soft">{e.label}:</span> {e.detail}</li>)}</ul>
      </details>
    </div>
  );
}
