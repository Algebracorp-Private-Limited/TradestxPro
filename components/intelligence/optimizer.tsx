"use client";

import { useState } from "react";
import { StrategyDetail, type StrategyView } from "./fo-detail";
import { Card, Empty, Loading, Notice, fmt, inr } from "./ui";

type Result = {
  strategy: { id: string; name: string }; objective: string; evaluated: number; eligible: number; rejected: { insufficientData: number; validation: number; constraints: number };
  searchSpace: { anchors: number; scales: number; expiries: string[] }; note: string;
  best: { anchor: number; scale: number; expiry: string; objectiveValue: number; evaluation: StrategyView }[];
};
const OBJECTIVES: [string, string][] = [["score", "Highest score"], ["rewardRisk", "Best reward : risk"], ["lowestMaxLoss", "Smallest maximum loss"], ["breakevenReach", "Breakevens best placed vs expected move"], ["credit", "Largest net credit"]];
const field = "mt-1 block rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white";

/** Bounded search over strike shift, width and expiry for one strategy (every candidate validated). */
export function Optimizer({ u, strategies }: { u: string; strategies: { id: string; name: string }[] }) {
  const [strategy, setStrategy] = useState("bull-call-spread");
  const [objective, setObjective] = useState("score");
  const [maxLoss, setMaxLoss] = useState("");
  const [minRR, setMinRR] = useState("");
  const [defined, setDefined] = useState(true);
  const [d, setD] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const run = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const q = new URLSearchParams({ u, strategy, objective, ...(maxLoss ? { maxLossPerLot: maxLoss } : {}), ...(minRR ? { minRR } : {}), ...(defined ? { definedRiskOnly: "1" } : {}) });
    fetch(`/api/intelligence/strategy/optimize?${q}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Optimisation failed"); setD(null); } else { setErr(null); setD(j); setOpen(null); }
      setBusy(false);
    }, () => { setErr("Network error"); setBusy(false); });
  };
  return (
    <Card title={`Optimise a strategy · ${u}`}>
      <form onSubmit={run} className="flex flex-wrap items-end gap-2 text-xs text-muted">
        <label>Strategy<select value={strategy} onChange={(e) => setStrategy(e.target.value)} className={`${field} max-w-[16rem]`}>{(strategies.length ? strategies : [{ id: strategy, name: strategy }]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Objective<select value={objective} onChange={(e) => setObjective(e.target.value)} className={field}>{OBJECTIVES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>Max loss per lot (₹)<input type="number" min={0} value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)} placeholder="any" className={`${field} w-28`} /></label>
        <label>Min reward : risk<input type="number" min={0} step="0.1" value={minRR} onChange={(e) => setMinRR(e.target.value)} placeholder="any" className={`${field} w-24`} /></label>
        <label className="flex items-center gap-1 pb-2"><input type="checkbox" checked={defined} onChange={(e) => setDefined(e.target.checked)} />Defined risk only</label>
        <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50">{busy ? "Searching…" : "Optimise"}</button>
      </form>
      {err && <div className="mt-2"><Notice tone="error">{err}</Notice></div>}
      {busy && <Loading label="Evaluating candidates…" />}
      {d && !busy && (
        <div className="mt-3 space-y-2 text-xs">
          <p className="text-muted">{d.evaluated} candidates searched ({d.searchSpace.anchors} strike shifts × {d.searchSpace.scales} widths × expiries {d.searchSpace.expiries.join(", ")}): {d.eligible} met your constraints; {d.rejected.constraints} failed a constraint, {d.rejected.validation} failed validation, {d.rejected.insufficientData} lacked data. {d.note}</p>
          {d.objective === "rewardRisk" && <Notice tone="warn">Reward : risk ignores how likely each outcome is: cheap far-out-of-the-money spreads rank high on this objective even though they pay off less often. Compare the breakeven against the expected move before relying on it.</Notice>}
          {!d.best.length ? <Empty>No candidate met the constraints.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full text-left"><thead className="text-muted"><tr><th className="py-1">#</th><th>Expiry</th><th>Shift · width</th><th>Legs</th><th>Score</th><th>Max loss / lot</th><th>R : R</th><th>Net</th><th /></tr></thead>
              <tbody>{d.best.map((c, i) => [
                <tr key={i} className="border-t border-line"><td className="py-1.5">{i + 1}</td><td>{c.expiry}</td><td>{c.anchor >= 0 ? "+" : ""}{c.anchor} · ×{c.scale}</td>
                  <td className="font-mono text-[10px]">{c.evaluation.legs ? c.evaluation.legs.map((l) => `${l.side === "BUY" ? "+" : "−"}${l.ratio > 1 ? l.ratio : ""}${l.right}${l.strike ?? ""}`).join(" ") : "restricted"}</td>
                  <td>{c.evaluation.score}</td><td>{c.evaluation.unlimitedLoss ? "Unlimited" : inr(Math.abs(c.evaluation.maxLoss ?? 0), 0)}</td><td>{fmt(c.evaluation.rewardRisk)}</td>
                  <td>{c.evaluation.netPremium === null ? "—" : c.evaluation.netPremium >= 0 ? `${inr(c.evaluation.netPremium, 0)} debit` : `${inr(-c.evaluation.netPremium, 0)} credit`}</td>
                  <td><button type="button" onClick={() => setOpen(open === i ? null : i)} className="rounded border border-line px-2 py-0.5 text-[11px]">{open === i ? "Hide" : "Details"}</button></td></tr>,
                open === i && <tr key={`${i}d`}><td colSpan={9} className="bg-white/[0.02] p-2"><StrategyDetail s={c.evaluation} /></td></tr>,
              ])}</tbody></table></div>
          )}
        </div>
      )}
    </Card>
  );
}
