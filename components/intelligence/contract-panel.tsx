"use client";

import { useEffect, useRef, useState } from "react";
import { KV, Loading, Notice, StatusBadge, FreshnessBadge, fmt, inr, pct, type Prov } from "./ui";

type Plan = {
  side: "BUY" | "SELL"; status: string; entryPremium?: { low: number; high: number } | null; underlyingConfirmation?: string | null; underlyingInvalidation?: number | null;
  stopPremium?: number | null; targetPremium?: number | null; additionalTargetPremium?: number | null; timeExit?: string; plannedRiskPerLot?: number | null; plannedRewardPerLot?: number | null;
  maxTheoreticalLoss: string; requiredMargin: number | null; executionValidated: boolean; sizing?: { quantity: number; lots: number | null; plannedRisk: number } | null;
  costs?: { total: number } | null; disclosures: string[]; reasons: string[]; notices?: string[];
};
type Analysis = {
  underlying: string; expiry: string; strike: number; right: "CE" | "PE"; lotSize: number | null; tickSize: number | null; spot: number | null;
  metrics: Record<string, number | string | null>; ivRankNote: string; expectedMove: { atmIv: number | null; straddle: number | null; ivMove: number | null; assumption: string };
  view: { label: string; buyScore: number | null; sellScore: number | null; reasons: string[] }; buy: Plan; sell: Plan;
  alternatives: { strike: number; moneyness: string | null; mid: number | null; delta: number | null; thetaPctPerDay: number | null; spreadPct: number | null; breakevenDistancePct: number | null; buyScore: number | null; why: string }[];
  preferred: { strike: number; reason: string } | null; provenance: Prov; labels: { underlying: string; premium: string; payoff: string };
};
type Expl = { buyAssessment: string; sellAssessment: string; strikeChoice: string; expiryChoice: string; risks: string[]; waitOrAvoid: string; source: string; model: string | null; fallbackReason: string | null } | null;
type Compare = { sameExpiry: Record<string, unknown>[]; otherExpiries: Record<string, unknown>[]; note: string };

function PlanView({ p, label }: { p: Plan; label: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex items-center gap-2"><span className="text-xs font-semibold">{label}</span><StatusBadge status={p.status} />{!p.executionValidated && <span className="text-[10px] text-gold">not execution-validated</span>}</div>
      {p.notices?.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
      <KV items={[
        ...(p.entryPremium ? [["Entry premium", `${inr(p.entryPremium.low)} – ${inr(p.entryPremium.high)}`] as [string, string]] : []),
        ...(p.underlyingConfirmation ? [["Underlying confirmation", p.underlyingConfirmation] as [string, string]] : []),
        ...(p.underlyingInvalidation ? [["Underlying invalidation", inr(p.underlyingInvalidation)] as [string, string]] : []),
        ...(p.stopPremium ? [["Premium stop-loss", inr(p.stopPremium)] as [string, string]] : []),
        ...(p.targetPremium ? [["Target premium", `${inr(p.targetPremium)}${p.additionalTargetPremium ? ` · then ${inr(p.additionalTargetPremium)}` : ""}`] as [string, string]] : []),
        ...(p.timeExit ? [["Time-based exit", p.timeExit] as [string, string]] : []),
        ...(p.plannedRiskPerLot !== undefined && p.plannedRiskPerLot !== null ? [["Planned risk / reward per lot", `${inr(p.plannedRiskPerLot, 0)} / ${inr(p.plannedRewardPerLot, 0)}`] as [string, string]] : []),
        ["Maximum theoretical loss", p.maxTheoreticalLoss],
        ["Required margin", p.requiredMargin === null ? "unavailable (no margin data)" : inr(p.requiredMargin, 0)],
        ...(p.sizing ? [["Quantity (your limits)", `${p.sizing.lots ?? 0} lot(s) · planned risk ${inr(p.sizing.plannedRisk, 0)}`] as [string, string]] : []),
        ...(p.costs ? [["Estimated costs", inr(p.costs.total)] as [string, string]] : []),
      ]} />
      {p.reasons.length > 0 && <ul className="list-disc pl-4 text-[11px] text-muted">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {p.disclosures.length > 0 && <ul className="list-disc pl-4 text-[11px] text-gold">{p.disclosures.map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  );
}

export function ContractPanel({ u, expiry, strike, right, onClose }: { u: string; expiry: string | null; strike: number; right: "CE" | "PE"; onClose: () => void }) {
  const [a, setA] = useState<Analysis | null>(null);
  const [ex, setEx] = useState<Expl>(null);
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ u, strike: String(strike), right, explain: "1" });
    if (expiry) q.set("expiry", expiry);
    fetch(`/api/intelligence/options/analyze?${q}`).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) setErr(j.error ?? "Analysis failed");
      else { setA(j.analysis); setEx(j.explanation); }
    }, () => alive && setErr("Network error"));
    const qc = new URLSearchParams({ u, right });
    if (expiry) qc.set("expiry", expiry);
    fetch(`/api/intelligence/options/compare?${qc}`).then((r) => r.json()).then((j) => alive && j.ok && setCmp(j), () => {});
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => { alive = false; window.removeEventListener("keydown", esc); };
  }, [u, expiry, strike, right, onClose]);
  const m = a?.metrics;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Contract analysis ${u} ${strike} ${right}`} className="h-full w-full max-w-3xl overflow-y-auto border-l border-line bg-panel p-4 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">{u} {expiry ?? ""} {strike} {right} <span className="text-xs font-normal text-muted">contract analysis</span></h2>
          <span className="flex items-center gap-2">
            {expiry && <a href={`/ai-intelligence/workspace?${new URLSearchParams({ u, expiry, strike: String(strike), right })}`} className="rounded-md border border-line px-2 py-1 text-xs hover:bg-white/5">Open charts</a>}
            <button onClick={onClose} className="rounded-md border border-line px-2 py-1 text-xs" aria-label="Close">Close</button>
          </span>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
        {!a && !err && <Loading label="Analysing contract…" />}
        {a && m && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs"><FreshnessBadge p={a.provenance} /><span className="text-muted">AI View: <b className="text-soft">{a.view.label}</b> (buy {a.view.buyScore ?? "—"}, sell {a.view.sellScore ?? "—"}; scores are not probabilities)</span></div>
            <div className="grid gap-4 md:grid-cols-2">
              <KV items={[
                ["Underlying (spot)", inr(a.spot)], ["Moneyness", String(m.moneyness ?? "—")], ["Lot size · tick", `${a.lotSize ?? "—"} · ${a.tickSize ?? "0.05"}`],
                ["LTP · bid · ask (premium)", `${inr(m.premium as number)} · ${inr(m.bid as number)} · ${inr(m.ask as number)}`], ["Bid-ask spread", m.spread !== null ? `${inr(m.spread as number)} (${pct(m.spreadPct as number, 2)})` : "unknown (no bid/ask)"],
                ["Volume · OI · OI change", `${fmt(m.volume as number, 0)} · ${fmt(m.oi as number, 0)} · ${fmt(m.oiChange as number, 0)}`],
                ["Intrinsic · extrinsic", `${inr(m.intrinsic as number)} · ${inr(m.extrinsic as number)}`], ["Time to expiry", `${m.daysToExpiry} days`],
                ["Expiry breakeven (underlying)", inr(m.breakeven as number)],
              ]} />
              <KV items={[
                [`IV (${m.ivSource ?? "—"})`, pct((m.iv as number) * 100, 1)], ["IV rank / percentile", a.ivRankNote],
                [`Delta · gamma (${m.greeksSource ?? "—"})`, `${fmt(m.delta as number, 3)} · ${fmt(m.gamma as number, 5)}`], ["Theta · vega · rho", `${fmt(m.theta as number)} · ${fmt(m.vega as number)} · ${fmt(m.rho as number)}`],
                ["Decay", `${pct(m.thetaPctPerDay as number, 2)} of premium per day`],
                ["Expected move to expiry", `±${inr(a.expectedMove.ivMove)} (ATM IV ${pct((a.expectedMove.atmIv ?? NaN) * 100, 1)}); ATM straddle ${inr(a.expectedMove.straddle)}`],
              ]} />
            </div>
            <p className="text-[10px] text-muted">{a.labels.underlying} · {a.labels.premium} · {a.labels.payoff}. {a.expectedMove.assumption}.</p>
            <div className="grid gap-3 lg:grid-cols-2"><PlanView p={a.buy} label="Buying this contract" /><PlanView p={a.sell} label="Selling this contract" /></div>
            {ex && (
              <div className="rounded-xl border border-line p-3 text-xs leading-5">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">{ex.source === "fallback" ? `Deterministic explanation (${ex.fallbackReason ?? "AI unavailable"})` : `AI explanation · ${ex.model} · checked against the computed numbers`}</p>
                <p><b>Buying:</b> {ex.buyAssessment}</p><p><b>Selling:</b> {ex.sellAssessment}</p><p><b>Strike:</b> {ex.strikeChoice}</p><p><b>Expiry:</b> {ex.expiryChoice}</p><p><b>Wait or avoid:</b> {ex.waitOrAvoid}</p>
                {ex.risks.length > 0 && <p className="text-muted"><b className="text-soft">Risks:</b> {ex.risks.join(" · ")}</p>}
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold">Alternative strikes (same expiry){a.preferred ? ` — ${a.preferred.strike} ranks higher` : ""}</p>
              {a.preferred && <p className="mb-1 text-[11px] text-muted">{a.preferred.reason}</p>}
              <div className="overflow-x-auto"><table className="w-full text-left text-[11px]"><thead className="text-muted"><tr><th>Strike</th><th>Moneyness</th><th>Mid</th><th>Δ</th><th>Decay/day</th><th>Spread</th><th>Breakeven dist.</th><th>Buy score</th></tr></thead>
                <tbody>{a.alternatives.map((x) => <tr key={x.strike} className="border-t border-line"><td>{x.strike}</td><td>{x.moneyness}</td><td>{fmt(x.mid)}</td><td>{fmt(x.delta, 2)}</td><td>{pct(x.thetaPctPerDay, 1)}</td><td>{x.spreadPct === null ? "—" : pct(x.spreadPct, 1)}</td><td>{pct(x.breakevenDistancePct, 1)}</td><td>{x.buyScore}</td></tr>)}</tbody></table></div>
            </div>
            {cmp && cmp.otherExpiries.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold">Same moneyness in other expiries (EOD)</p>
                <div className="overflow-x-auto"><table className="w-full text-left text-[11px]"><thead className="text-muted"><tr><th>Expiry</th><th>Strike</th><th>Mid</th><th>IV</th><th>Δ</th><th>Decay/day</th><th>Days</th><th>Buy score</th></tr></thead>
                  <tbody>{cmp.otherExpiries.map((x) => { const v = x as { expiry: string; strike: number; mid: number | null; iv: number | null; delta: number | null; thetaPctPerDay: number | null; daysToExpiry: number; view: { buyScore: number | null } }; return <tr key={v.expiry} className="border-t border-line"><td>{v.expiry}</td><td>{v.strike}</td><td>{fmt(v.mid)}</td><td>{pct((v.iv ?? NaN) * 100, 1)}</td><td>{fmt(v.delta, 2)}</td><td>{pct(v.thetaPctPerDay, 1)}</td><td>{v.daysToExpiry}</td><td>{v.view.buyScore}</td></tr>; })}</tbody></table></div>
                <p className="mt-1 text-[10px] text-muted">{cmp.note}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
