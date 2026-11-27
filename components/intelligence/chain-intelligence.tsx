"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ContractPanel } from "./contract-panel";
import { Card, Empty, FreshnessBadge, KV, Loading, Notice, fmt, inr, pct, type Prov } from "./ui";
import type { QuickView } from "./ai-view-cell";

type Side = { oi: number | null; oiChange: number | null; volume: number | null; iv: number | null; delta: number | null; gamma: number | null; mid: number | null; spreadPct: number | null } | null;
type Resp = {
  source: "broker" | "eod"; provenance: Prov; expiries: string[]; expiry: string; lotSize: number | null;
  context: { direction: number | null; regime: string | null; atr: number | null };
  
  analytics: {
    spot: number | null;
    totals: { ceOi: number; peOi: number; ceVol: number; peVol: number; ceOiChange: number; peOiChange: number; pcrOi: number | null; pcrVolume: number | null };
    concentration: { calls: { strike: number; oi: number | null; share: number | null }[]; puts: { strike: number; oi: number | null; share: number | null }[] };
    expectedMove: { atmStrike: number | null; atmIv: number | null; straddle: number | null; ivMove: number | null; assumption: string };
    skew: { putIv95: number | null; callIv105: number | null; skewPts: number | null; note: string };
    gammaByStrike: { strike: number; gammaOi: number | null }[];
    maxPain: { strike: number | null; note: string };
    rows: { strike: number; ce: Side; pe: Side }[];
    ranking: { strike: number; right: "CE" | "PE"; view: QuickView }[];
    outlook: { underlyingRegime: string | null; direction: number | null; positioning: string };
  };
  viewsRestricted: boolean;
  termStructure: { expiry: string; atmStrike: number | null; atmIv: number | null; straddle: number | null; expectedMove: number | null; totalOi: number }[];
  termStructureSource: string;
  history: { oi: { d: string; ce: number; pe: number }[]; iv: null; ivNote: string };
};

const W = 640, H = 170, P = 28;

/** Paired bars (calls up / puts down) by strike. Pure SVG, no chart library. */
function PairBars({ rows, get, label, spot }: { rows: Resp["analytics"]["rows"]; get: (s: Side) => number | null; label: string; spot: number | null }) {
  const vals = rows.map((r) => [Math.abs(get(r.ce) ?? 0), Math.abs(get(r.pe) ?? 0)]);
  const max = Math.max(1, ...vals.flat());
  const bw = (W - 2 * P) / Math.max(1, rows.length);
  const mid = H / 2;
  const xs = (i: number) => P + i * bw;
  const spotI = spot !== null ? rows.findIndex((r, i) => r.strike >= spot && (i === 0 || rows[i - 1].strike < spot)) : -1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label} by strike: calls above the axis, puts below`}>
      <line x1={P} x2={W - P} y1={mid} y2={mid} className="stroke-line" />
      {rows.map((r, i) => {
        const [c, p] = vals[i];
        const hc = (c / max) * (mid - 12), hp = (p / max) * (mid - 12);
        return (
          <g key={r.strike}>
            <title>{`${r.strike}: calls ${fmt(get(r.ce), 0)} · puts ${fmt(get(r.pe), 0)}`}</title>
            <rect x={xs(i) + 1} y={mid - hc} width={Math.max(1, bw - 2)} height={hc} className={(get(r.ce) ?? 0) < 0 ? "fill-up/40" : "fill-up"} />
            <rect x={xs(i) + 1} y={mid} width={Math.max(1, bw - 2)} height={hp} className={(get(r.pe) ?? 0) < 0 ? "fill-down/40" : "fill-down"} />
          </g>
        );
      })}
      {spotI >= 0 && <line x1={xs(spotI)} x2={xs(spotI)} y1={4} y2={H - 4} className="stroke-accent" strokeDasharray="3 3" />}
      <text x={P} y={11} className="fill-muted text-[10px]">Calls ▲</text>
      <text x={P} y={H - 3} className="fill-muted text-[10px]">Puts ▼</text>
      {rows.length > 0 && <><text x={P} y={mid + 12} className="fill-muted text-[9px]">{rows[0].strike}</text><text x={W - P} y={mid + 12} textAnchor="end" className="fill-muted text-[9px]">{rows.at(-1)!.strike}</text></>}
    </svg>
  );
}

/** Line chart for one or two series. */
function Lines({ xs, series, label, fmtY }: { xs: string[]; series: { name: string; cls: string; ys: (number | null)[] }[]; label: string; fmtY: (v: number) => string }) {
  const all = series.flatMap((s) => s.ys).filter((v): v is number => v !== null && Number.isFinite(v));
  if (all.length < 2) return <Empty>Not enough observations to draw {label.toLowerCase()}.</Empty>;
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i: number) => P + (i / Math.max(1, xs.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {series.map((s) => {
        const pts = s.ys.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" ");
        return <polyline key={s.name} points={pts} fill="none" strokeWidth={1.6} className={s.cls} />;
      })}
      {series.map((s) => s.ys.map((v, i) => v === null ? null : <circle key={s.name + i} cx={x(i)} cy={y(v)} r={2.2} className={s.cls.replace("stroke-", "fill-")}><title>{`${xs[i]} · ${s.name}: ${fmtY(v)}`}</title></circle>))}
      <text x={P} y={12} className="fill-muted text-[10px]">{fmtY(hi)}</text>
      <text x={P} y={H - 6} className="fill-muted text-[10px]">{fmtY(lo)}</text>
      <text x={W - P} y={H - 6} textAnchor="end" className="fill-muted text-[9px]">{xs[0]} → {xs.at(-1)}</text>
      <g>{series.map((s, i) => <text key={s.name} x={W - P - i * 90} y={12} textAnchor="end" className={`${s.cls.replace("stroke-", "fill-")} text-[10px]`}>{s.name}</text>)}</g>
    </svg>
  );
}

export function ChainIntelligence({ initial }: { initial?: string }) {
  const [u, setU] = useState(initial || "NIFTY");
  const [input, setInput] = useState(initial || "NIFTY");
  const [expiry, setExpiry] = useState<string>("");
  const [range, setRange] = useState(12);
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [panel, setPanel] = useState<{ strike: number; right: "CE" | "PE" } | null>(null);
  const close = useCallback(() => setPanel(null), []);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ u });
    if (expiry) q.set("expiry", expiry);
    fetch(`/api/intelligence/option-chain/analyze?${q}`).then(async (r) => {
      const j = await r.json().catch(() => ({ error: "Bad response" }));
      if (!alive) return;
      if (!r.ok) { setErr(j.error ?? "Could not load chain intelligence"); setD(null); } else { setD(j); setErr(null); }
      setBusy(false);
    }, () => { if (alive) { setErr("Network error"); setBusy(false); } });
    return () => { alive = false; };
  }, [u, expiry]);

  const rows = useMemo(() => {
    if (!d) return [];
    const all = d.analytics.rows, s = d.analytics.spot;
    if (s === null) return all;
    const i = all.reduce((b, r, k) => (Math.abs(r.strike - s) < Math.abs(all[b].strike - s) ? k : b), 0);
    return all.slice(Math.max(0, i - range), i + range + 1);
  }, [d, range]);

  const a = d?.analytics;
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = input.trim().toUpperCase(); if (v && v !== u) { setBusy(true); setExpiry(""); setU(v); } }}>
        <label className="text-xs text-muted">Underlying<input value={input} onChange={(e) => setInput(e.target.value)} className="mt-1 block w-36 rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white" aria-label="Underlying symbol" /></label>
        <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950">Analyse</button>
        {d && d.expiries.length > 0 && (
          <label className="text-xs text-muted">Expiry
            <select value={expiry || d.expiry} onChange={(e) => { setBusy(true); setExpiry(e.target.value); }} className="mt-1 block rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-soft">
              {d.expiries.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
        <label className="text-xs text-muted">Strikes<select value={range} onChange={(e) => setRange(Number(e.target.value))} className="mt-1 block rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-soft">{[8, 12, 20, 40].map((n) => <option key={n} value={n}>±{n}</option>)}</select></label>
        <span className="ml-auto flex gap-3"><Link href={`/ai-intelligence/strategy?u=${encodeURIComponent(u)}`} className="text-xs text-accent hover:underline">Strategy AI →</Link><Link href={`/options?u=${encodeURIComponent(u)}`} className="text-xs text-accent hover:underline">Open in option chain →</Link></span>
      </form>
      {err && <Notice tone="error">{err}</Notice>}
      {busy && <Loading label="Analysing the chain…" />}
      {d && a && !busy && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <FreshnessBadge p={d.provenance} />
            <span className="text-muted">{d.source === "broker" ? "Your broker's chain" : "NSE F&O bhavcopy (end of day): no bid/ask; IV and Greeks computed by TradestXPro"}</span>
          </div>
          {d.source === "eod" && <Notice tone="warn">End-of-day data. These analytics describe the last completed session and are not live market conditions.</Notice>}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Summary">
              <KV items={[
                ["Spot (underlying)", inr(a.spot)], ["Lot size", fmt(d.lotSize, 0)],
                ["PCR (OI) · PCR (volume)", `${fmt(a.totals.pcrOi)} · ${fmt(a.totals.pcrVolume)}`],
                ["Call OI · put OI", `${fmt(a.totals.ceOi, 0)} · ${fmt(a.totals.peOi, 0)}`],
                ["ATM IV · straddle", `${pct((a.expectedMove.atmIv ?? NaN) * 100, 1)} · ${inr(a.expectedMove.straddle)}`],
                ["Expected move to expiry", `±${inr(a.expectedMove.ivMove)}`],
                ["Skew (put − call IV)", a.skew.skewPts === null ? "—" : `${a.skew.skewPts} pts`],
                ["Max pain (descriptive)", fmt(a.maxPain.strike, 0)],
                ["Underlying regime · direction", `${a.outlook.underlyingRegime ?? "—"} · ${fmt(a.outlook.direction)}`],
              ]} />
              <p className="mt-2 text-[10px] text-muted">{a.expectedMove.assumption}. {a.maxPain.note} {a.skew.note}.</p>
            </Card>
            <Card title="Positioning (descriptive)" className="lg:col-span-2">
              <p className="text-xs leading-5 text-soft">{a.outlook.positioning}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
                <div><p className="mb-1 font-semibold text-up">Largest call OI</p>{a.concentration.calls.map((c) => <p key={c.strike}>{c.strike}: {fmt(c.oi, 0)} ({pct(c.share, 1)})</p>)}</div>
                <div><p className="mb-1 font-semibold text-down">Largest put OI</p>{a.concentration.puts.map((c) => <p key={c.strike}>{c.strike}: {fmt(c.oi, 0)} ({pct(c.share, 1)})</p>)}</div>
              </div>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Open interest by strike"><PairBars rows={rows} get={(s) => s?.oi ?? null} label="Open interest" spot={a.spot} /></Card>
            <Card title="OI change by strike"><PairBars rows={rows} get={(s) => s?.oiChange ?? null} label="OI change" spot={a.spot} /><p className="text-[10px] text-muted">Faded bars are OI reductions.</p></Card>
            <Card title="Volume by strike"><PairBars rows={rows} get={(s) => s?.volume ?? null} label="Volume" spot={a.spot} /></Card>
            <Card title="IV smile">
              <Lines xs={rows.map((r) => String(r.strike))} label="Implied volatility by strike" fmtY={(v) => `${(v * 100).toFixed(1)}%`}
                series={[{ name: "Call IV", cls: "stroke-up", ys: rows.map((r) => r.ce?.iv ?? null) }, { name: "Put IV", cls: "stroke-down", ys: rows.map((r) => r.pe?.iv ?? null) }]} />
            </Card>
            <Card title="IV term structure (ATM, latest EOD session)">
              <Lines xs={d.termStructure.map((t) => t.expiry)} label="ATM IV by expiry" fmtY={(v) => `${(v * 100).toFixed(1)}%`} series={[{ name: "ATM IV", cls: "stroke-accent", ys: d.termStructure.map((t) => t.atmIv) }]} />
              <p className="text-[10px] text-muted">{d.termStructureSource}</p>
            </Card>
            <Card title="Total OI history (all expiries)">
              <Lines xs={d.history.oi.map((h) => h.d)} label="Call and put open interest history" fmtY={(v) => fmt(v, 0)}
                series={[{ name: "Call OI", cls: "stroke-up", ys: d.history.oi.map((h) => h.ce) }, { name: "Put OI", cls: "stroke-down", ys: d.history.oi.map((h) => h.pe) }]} />
              <p className="text-[10px] text-muted">Stored daily observations only. {d.history.ivNote}</p>
            </Card>
          </div>
          <Card title="Contract ranking (deterministic scores, not probabilities)">
            {d.viewsRestricted ? <Notice>Contract views need the research feature.</Notice> : a.ranking.length === 0 ? <Empty>No contract could be scored.</Empty> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Contract</th><th>View</th><th>Buy</th><th>Sell</th><th>Reasons</th><th /></tr></thead>
                <tbody>{a.ranking.map((x) => (
                  <tr key={`${x.strike}${x.right}`} className="border-t border-line">
                    <td className="py-1.5 font-mono">{x.strike} {x.right}</td><td>{x.view.label}</td><td>{x.view.buyScore ?? "—"}</td><td>{x.view.sellScore ?? "—"}</td>
                    <td className="max-w-md text-[11px] text-muted">{x.view.reasons.slice(0, 2).join(" · ")}</td>
                    <td><button onClick={() => setPanel({ strike: x.strike, right: x.right })} className="rounded border border-line px-2 py-0.5 text-[11px] hover:bg-white/5">Analyse</button></td>
                  </tr>))}</tbody></table></div>
            )}
          </Card>
          {panel && <ContractPanel u={u} expiry={d.expiry} strike={panel.strike} right={panel.right} onClose={close} />}
        </>
      )}
    </div>
  );
}
