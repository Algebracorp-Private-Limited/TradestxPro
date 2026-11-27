"use client";

import { KV, Notice, StatusBadge, fmt, inr, pct } from "./ui";

export type StrategyView = {
  id: string; name: string; family: string; view: string; classification: "BUY_ONLY" | "SELL_ONLY" | "MIXED"; risk: "defined" | "undefined";
  status: string; missing: string[]; legs?: { side: string; right: string; strike: number | null; expiry: string; ratio: number; premium: number }[]; lotSize: number | null;
  netPremium: number | null; maxProfit: number | null; maxLoss: number | null; unlimitedProfit: boolean; unlimitedLoss: boolean; breakevens: number[]; rewardRisk: number | null;
  netGreeks: { delta: number; gamma: number; theta: number; vega: number } | null; breakevenVsExpectedMove: number | null; worstSpreadPct: number | null; minOi: number | null;
  payoff: { s: number; pnl: number }[]; model: string; score: number | null; scoreNote: string; reasons: string[];
  sizing?: { lots: number; maxLossTotal: number | null } | null; costs?: { total: number } | null; disclosures: string[]; notices?: string[]; underlying?: string; expiry?: string;
};
export type FuturesView = {
  underlying: string; status: string; missing: string[]; near: { expiry: string; price: number; lot: number; daysToExpiry: number; oi: number; oiChange: number; priceChangePct: number | null } | null;
  next: { expiry: string; price: number } | null; spot: number | null; basis: number | null; basisPct: number | null; annualisedCarryPct: number | null; rollSpread: number | null; rollNote: string | null;
  pattern: { label: string; note: string } | null;
  plan: { side: "LONG" | "SHORT" | null; entryTrigger?: number | null; stop?: number | null; target?: number | null; target2?: number | null; rewardRisk?: number | null; sizing?: { lots: number | null; plannedRisk: number } | null; costs?: { total: number } | null; maxTheoreticalLoss: string; timeExit: string };
  score: number | null; scoreNote: string; reasons: string[]; disclosures: string[]; notices?: string[];
};

const CLASS: Record<StrategyView["classification"], string> = { BUY_ONLY: "BUY ONLY", SELL_ONLY: "SELL ONLY", MIXED: "Buy + sell" };

/** Expiry payoff (₹ per lot) of a strategy; SVG, no chart library. */
export function PayoffChart({ points, spot, breakevens, height = 140 }: { points: { s: number; pnl: number }[]; spot: number | null; breakevens: number[]; height?: number }) {
  if (points.length < 2) return null;
  const W = 520, H = height, P = 6;
  const xs = points.map((p) => p.s), ys = points.map((p) => p.pnl);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
  const X = (v: number) => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P), Y = (v: number) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const line = points.map((p) => `${X(p.s)},${Y(p.pnl)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Expiry payoff from ${fmt(x0, 0)} to ${fmt(x1, 0)}; breakevens ${breakevens.map((b) => fmt(b, 0)).join(", ") || "none"}`}>
      <defs><clipPath id="above"><rect x="0" y="0" width={W} height={Y(0)} /></clipPath><clipPath id="below"><rect x="0" y={Y(0)} width={W} height={H} /></clipPath></defs>
      <polygon points={`${X(x0)},${Y(0)} ${line} ${X(x1)},${Y(0)}`} className="fill-up/20" clipPath="url(#above)" />
      <polygon points={`${X(x0)},${Y(0)} ${line} ${X(x1)},${Y(0)}`} className="fill-down/20" clipPath="url(#below)" />
      <line x1={P} x2={W - P} y1={Y(0)} y2={Y(0)} className="stroke-line" />
      <polyline points={line} fill="none" strokeWidth={1.6} className="stroke-white" />
      {spot !== null && spot >= x0 && spot <= x1 && <line x1={X(spot)} x2={X(spot)} y1={P} y2={H - P} className="stroke-accent" strokeDasharray="3 3" />}
      {breakevens.filter((b) => b >= x0 && b <= x1).map((b) => <circle key={b} cx={X(b)} cy={Y(0)} r={2.5} className="fill-gold" />)}
      <text x={P} y={12} className="fill-muted text-[10px]">{inr(y1, 0)}</text>
      <text x={P} y={H - 8} className="fill-muted text-[10px]">{inr(y0, 0)}</text>
    </svg>
  );
}

export function StrategyDetail({ s, spot }: { s: StrategyView; spot?: number | null }) {
  if (s.status !== "OK") return <Notice tone="warn">Insufficient data: {s.missing.join(", ")}</Notice>;
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-line px-1.5 py-0.5 text-[10px]">{CLASS[s.classification]}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${s.risk === "defined" ? "border-up/40 text-up" : "border-down/40 text-down"}`}>{s.risk === "defined" ? "Defined risk" : "Undefined risk"}</span>
        <span className="text-muted">{s.family} · {s.view} · score {s.score ?? "—"} ({s.scoreNote})</span>
      </div>
      {s.notices?.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
      <div className="grid gap-3 md:grid-cols-2">
        <KV items={[
          ["Net premium (per lot)", s.netPremium === null ? "—" : s.netPremium >= 0 ? `${inr(s.netPremium, 0)} debit` : `${inr(-s.netPremium, 0)} credit`],
          ["Max profit at expiry (per lot)", s.unlimitedProfit ? "Unlimited" : inr(s.maxProfit, 0)],
          ["Max loss at expiry (per lot)", s.unlimitedLoss ? "Unlimited" : s.maxLoss === null ? "—" : inr(Math.abs(s.maxLoss), 0)],
          ["Breakevens (underlying)", s.breakevens.length ? s.breakevens.map((b) => fmt(b, 2)).join(" · ") : "none"],
          ["Reward : risk", s.rewardRisk === null ? "—" : fmt(s.rewardRisk)],
          ["Nearest breakeven vs expected move", s.breakevenVsExpectedMove === null ? "—" : `${fmt(s.breakevenVsExpectedMove)}× the 1σ move`],
        ]} />
        <KV items={[
          ["Net Δ · Γ (per lot)", s.netGreeks ? `${fmt(s.netGreeks.delta)} · ${fmt(s.netGreeks.gamma, 4)}` : "—"],
          ["Net θ /day · vega /pp (per lot)", s.netGreeks ? `${inr(s.netGreeks.theta)} · ${inr(s.netGreeks.vega)}` : "—"],
          ["Worst leg spread · min OI", `${s.worstSpreadPct === null ? "unknown (no bid/ask)" : pct(s.worstSpreadPct, 2)} · ${fmt(s.minOi, 0)}`],
          ["Required margin", "unavailable (no margin data)"],
          ...(s.sizing ? [["Lots within your risk limit", `${s.sizing.lots} (max loss ${inr(Math.abs(s.sizing.maxLossTotal ?? 0), 0)})`] as [string, string]] : []),
          ...(s.costs ? [["Estimated costs (round trip)", inr(s.costs.total)] as [string, string]] : []),
        ]} />
      </div>
      {s.legs && (
        <table className="w-full text-left text-[11px]"><thead className="text-muted"><tr><th>Leg</th><th>Strike</th><th>Expiry</th><th>Qty (lots)</th><th>Price</th></tr></thead>
          <tbody>{s.legs.map((l, i) => <tr key={i} className="border-t border-line"><td className={l.side === "BUY" ? "text-up" : "text-down"}>{l.side} {l.right}</td><td>{l.strike ?? "—"}</td><td>{l.expiry}</td><td>{l.ratio}</td><td>{fmt(l.premium)}</td></tr>)}</tbody></table>
      )}
      <PayoffChart points={s.payoff} spot={spot ?? null} breakevens={s.breakevens} />
      <p className="text-[10px] text-muted">Payoff at the near expiry ({s.model}); per lot of {fmt(s.lotSize, 0)}. Underlying price on the horizontal axis.</p>
      {s.reasons.length > 0 && <ul className="list-disc pl-4 text-muted">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      <ul className="list-disc pl-4 text-gold">{s.disclosures.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}

export function FuturesDetail({ f }: { f: FuturesView }) {
  if (!f.near) return <Notice tone="warn">Insufficient data: {f.missing.join(", ")}</Notice>;
  const p = f.plan;
  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={f.status} /><span className="text-muted">score {f.score ?? "—"} ({f.scoreNote})</span></div>
      {f.notices?.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}
      {f.missing.length > 0 && <Notice tone="warn">Missing: {f.missing.join(", ")}</Notice>}
      <div className="grid gap-3 md:grid-cols-2">
        <KV items={[
          ["Near future", `${f.near.expiry} · ${inr(f.near.price)} (${f.near.daysToExpiry} days)`], ["Underlying (same session)", inr(f.spot)],
          ["Basis", f.basis === null ? "—" : `${inr(f.basis)} (${pct(f.basisPct, 2)})`], ["Annualised carry", pct(f.annualisedCarryPct, 2)],
          ["Next month · roll spread", f.next ? `${f.next.expiry} · ${inr(f.next.price)} · ${inr(f.rollSpread)}` : "—"],
          ["Open interest · change", `${fmt(f.near.oi, 0)} · ${fmt(f.near.oiChange, 0)}`], ["Lot size", fmt(f.near.lot, 0)],
        ]} />
        <KV items={[
          ["Direction", p.side ?? "No directional plan"],
          ...(p.entryTrigger ? [["Entry trigger (futures price)", inr(p.entryTrigger)] as [string, string]] : []),
          ...(p.stop ? [["Stop-loss", inr(p.stop)] as [string, string]] : []),
          ...(p.target ? [["Targets", `${inr(p.target)} · then ${inr(p.target2)}`] as [string, string]] : []),
          ...(p.rewardRisk ? [["Reward : risk", fmt(p.rewardRisk)] as [string, string]] : []),
          ...(p.sizing ? [["Lots (your limits)", `${p.sizing.lots ?? 0} · planned risk ${inr(p.sizing.plannedRisk, 0)}`] as [string, string]] : []),
          ...(p.costs ? [["Estimated costs", inr(p.costs.total)] as [string, string]] : []),
          ["Maximum theoretical loss", p.maxTheoreticalLoss], ["Time exit", p.timeExit], ["Required margin", "unavailable (no margin data)"],
        ]} />
      </div>
      {f.pattern && <p><b>{f.pattern.label}.</b> <span className="text-muted">{f.pattern.note}</span></p>}
      {f.rollNote && <Notice tone="warn">{f.rollNote}</Notice>}
      {f.reasons.length > 0 && <ul className="list-disc pl-4 text-muted">{f.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      <ul className="list-disc pl-4 text-gold">{f.disclosures.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
}
