"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FuturesDetail, StrategyDetail, type FuturesView, type StrategyView } from "./fo-detail";
import { Optimizer } from "./optimizer";
import { Card, Empty, FreshnessBadge, Loading, Notice, type Prov } from "./ui";

type Mode = "ALL" | "BUY_ONLY" | "SELL_ONLY";
type Rank = {
  underlying: string; expiry: string; spot: number | null; expiries: string[]; source: "broker" | "eod"; mode: Mode; candidates: number; evaluated: number; insufficient: number; missingSample: string[];
  provenance: Prov; ranked: StrategyView[]; scoreNote: string; futuresNote: string | null; context: { direction: number | null; regime: string | null };
};
type Reg = { total: number; families: string[]; strategies: { id: string; name: string; family: string; view: string; classification: Mode | "MIXED"; risk: string; summary: string; legs: { side: string; right: string; offset: number; ratio: number; expiry: string }[] }[] };

const MODES: [Mode, string, string][] = [
  ["ALL", "All strategies", "Every registry strategy that fits your filters."],
  ["BUY_ONLY", "BUY ONLY", "Only strategies where every leg is bought: the most you can lose is what you pay."],
  ["SELL_ONLY", "SELL ONLY", "Only strategies where every leg is sold: premium collected, with large or unlimited potential loss."],
];

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}

export function StrategyAI({ initial }: { initial?: string }) {
  const [input, setInput] = useState(initial || "NIFTY");
  const [u, setU] = useState(initial || "NIFTY");
  const [expiry, setExpiry] = useState("");
  const [mode, setMode] = useState<Mode>("ALL");
  const [defined, setDefined] = useState(false);
  const [maxRisk, setMaxRisk] = useState(10000);
  const [d, setD] = useState<Rank | null>(null);
  const [fut, setFut] = useState<FuturesView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [reg, setReg] = useState<Reg | null>(null);
  const [family, setFamily] = useState("");

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ u, mode, maxRisk: String(maxRisk), capital: String(Math.max(maxRisk * 20, 100000)) });
    if (expiry) q.set("expiry", expiry);
    if (defined) q.set("definedRiskOnly", "1");
    api<Rank>(`/api/intelligence/strategy/analyze?${q}`).then((j) => { if (alive) { setD(j); setErr(null); setBusy(false); } }, (e) => { if (alive) { setErr(e.message); setD(null); setBusy(false); } });
    api<{ analysis: FuturesView }>(`/api/intelligence/futures/analyze?u=${encodeURIComponent(u)}&maxRisk=${maxRisk}`).then((j) => alive && setFut(j.analysis), () => alive && setFut(null));
    return () => { alive = false; };
  }, [u, expiry, mode, defined, maxRisk]);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ mode });
    if (family) q.set("family", family);
    if (defined) q.set("definedRiskOnly", "1");
    api<Reg>(`/api/intelligence/strategy/registry?${q}`).then((j) => alive && setReg(j), () => {});
    return () => { alive = false; };
  }, [mode, family, defined]);

  const refresh = (fn: () => void) => { setBusy(true); fn(); };
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = input.trim().toUpperCase(); if (v && v !== u) refresh(() => { setExpiry(""); setU(v); }); }}>
        <label className="text-xs text-muted">Underlying<input value={input} onChange={(e) => setInput(e.target.value)} className="mt-1 block w-36 rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white" aria-label="Underlying symbol" /></label>
        <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950">Analyse</button>
        {d && d.expiries.length > 0 && (
          <label className="text-xs text-muted">Expiry<select value={expiry || d.expiry} onChange={(e) => refresh(() => setExpiry(e.target.value))} className="mt-1 block rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-soft">{d.expiries.map((x) => <option key={x}>{x}</option>)}</select></label>
        )}
        <label className="text-xs text-muted">Max risk per trade (₹)<input type="number" min={100} value={maxRisk} onChange={(e) => refresh(() => setMaxRisk(Math.max(100, Number(e.target.value) || 100)))} className="mt-1 block w-32 rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white" /></label>
        <label className="flex items-center gap-1 pb-2 text-xs"><input type="checkbox" checked={defined} onChange={(e) => refresh(() => setDefined(e.target.checked))} />Defined risk only</label>
        <Link href={`/options/strategies?u=${encodeURIComponent(u)}`} className="ml-auto pb-2 text-xs text-accent hover:underline">Strategy builder →</Link>
      </form>
      <div role="radiogroup" aria-label="Strategy mode" className="grid gap-2 sm:grid-cols-3">
        {MODES.map(([v, l, help]) => (
          <button key={v} role="radio" aria-checked={mode === v} onClick={() => refresh(() => setMode(v))} className={`rounded-xl border p-3 text-left ${mode === v ? "border-accent bg-accent/10" : "border-line hover:bg-white/5"}`}>
            <span className="block text-sm font-semibold">{l}</span><span className="text-[11px] text-muted">{help}</span>
          </button>
        ))}
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {busy && <Loading label="Evaluating strategies…" />}
      {d && !busy && (
        <Card title={`Ranked strategies · ${d.underlying} ${d.expiry}`} right={<FreshnessBadge p={d.provenance} />}>
          <p className="mb-2 text-xs text-muted">
            {d.candidates} strategies matched your filters; {d.evaluated - d.insufficient} could be priced from the chain, {d.insufficient} had insufficient data{d.missingSample.length ? ` (e.g. ${d.missingSample.slice(0, 3).join("; ")})` : ""}.
            {" "}Underlying: {d.context.regime ?? "regime unknown"}. {d.scoreNote}
          </p>
          {d.source === "eod" && <Notice tone="warn">End-of-day prices (no bid/ask): strategies are for research; re-price with live quotes before acting.</Notice>}
          {d.futuresNote && <p className="mt-1 text-[11px] text-muted">Futures legs: {d.futuresNote}</p>}
          {!d.ranked.length ? <Empty>No strategy could be evaluated with the available data.</Empty> : (
            <ul className="mt-2 divide-y divide-line">
              {d.ranked.map((s, i) => (
                <li key={s.id}>
                  <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left text-sm hover:bg-white/[0.03]" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <span className="w-5 text-xs text-muted">{i + 1}</span><span className="font-semibold">{s.name}</span>
                    <span className="text-[11px] text-muted">{s.family} · {s.view} · {s.risk === "defined" ? "defined risk" : "undefined risk"}</span>
                    <span className="ml-auto font-mono text-xs">score {s.score}</span>
                  </button>
                  {open === s.id && <div className="pb-3"><StrategyDetail s={s} spot={d.spot} /></div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <Optimizer u={u} strategies={reg?.strategies.map((s) => ({ id: s.id, name: s.name })) ?? []} />
      <Card title={`Futures AI · ${u}`}>{fut ? <FuturesDetail f={fut} /> : <Empty>No futures analysis available.</Empty>}</Card>
      <Card title={`Strategy registry${reg ? ` · ${reg.total} strategies` : ""}`} right={reg && <select value={family} onChange={(e) => setFamily(e.target.value)} className="rounded-md border border-line bg-ink px-2 py-1 text-xs" aria-label="Family"><option value="">All families</option>{reg.families.map((f) => <option key={f}>{f}</option>)}</select>}>
        {!reg ? <Loading /> : (
          <div className="max-h-80 overflow-y-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-panel text-muted"><tr><th className="py-1">Strategy</th><th>Type</th><th>Risk</th><th>Legs (strikes in steps from ATM)</th></tr></thead>
            <tbody>{reg.strategies.map((s) => (
              <tr key={s.id} className="border-t border-line" title={s.summary}><td className="py-1">{s.name}</td><td>{s.classification === "MIXED" ? "Buy + sell" : s.classification.replace("_", " ")}</td><td>{s.risk}</td>
                <td className="font-mono text-[10px] text-muted">{s.legs.map((l) => `${l.side === "BUY" ? "+" : "−"}${l.ratio > 1 ? l.ratio : ""}${l.right}${l.right === "FUT" ? "" : l.offset === 0 ? "@ATM" : `@${l.offset > 0 ? "+" : ""}${l.offset}`}${l.expiry === "next" ? "(next)" : ""}`).join(" ")}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}
