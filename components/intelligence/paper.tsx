"use client";

import { useEffect, useState } from "react";
import { Card, Empty, KV, Loading, Notice, fmt, inr } from "./ui";

type Summary = {
  account: { startingCash: number; cash: number; costsPaid: number; marketValue: number; equity: number; realized: number; unrealized: number; totalPnl: number; since: string };
  positions: { instrument: string; kind: string; qty: number; avgPrice: number; mark: number | null; markDate: string | null; unrealized: number | null; realized: number; settled: boolean; short: boolean }[];
  orders: { id: number; instrument: string; side: string; qty: number; type: string; limit: number | null; placedAfter: string; status: string; fillPrice: number | null; fillDate: string | null; costs: number | null; reason: string | null }[];
  fills: { instrument: string; side: string; qty: number; price: number; costs: number; realized: number; kind: string; d: string }[];
  basis: string;
};
const field = "mt-1 block rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}
const post = <T,>(body: unknown) => api<T>("/api/intelligence/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const tone = (v: number | null) => (v === null ? "" : v >= 0 ? "text-up" : "text-down");

export function PaperTrading() {
  const [d, setD] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [t, setT] = useState({ kind: "equity", symbol: "", expiry: "", strike: "", right: "CE", side: "BUY", qty: "1", type: "MARKET", limit: "", valid: "5" });
  const [cash, setCash] = useState("1000000");
  useEffect(() => {
    let alive = true;
    api<Summary>("/api/intelligence/paper").then((j) => { if (alive) { setD(j); setErr(null); } }, (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [reload]);
  const instrument = () => {
    const s = t.symbol.trim().toUpperCase();
    return t.kind === "equity" ? `NSE:${s}` : t.kind === "future" ? `FUT:${s}:${t.expiry}` : `OPT:${s}:${t.expiry}:${t.strike}:${t.right}`;
  };
  const order = (e: React.FormEvent) => {
    e.preventDefault();
    post<{ id: number; placedAfter: string; note: string }>({ action: "order", instrument: instrument(), side: t.side, qty: Number(t.qty), type: t.type, limit: t.type === "LIMIT" ? Number(t.limit) : null, validSessions: Number(t.valid) })
      .then((r) => { setMsg(`Order #${r.id} placed after the ${r.placedAfter} session. ${r.note}`); setErr(null); setReload((x) => x + 1); }, (er) => { setErr(er.message); setMsg(null); });
  };
  if (err && !d) return <Notice tone="error">{err}</Notice>;
  if (!d) return <Loading />;
  const a = d.account;
  return (
    <div className="space-y-4">
      <Notice>{d.basis}</Notice>
      {err && <Notice tone="error">{err}</Notice>}
      {msg && <Notice>{msg}</Notice>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card title="Account">
          <KV items={[
            ["Equity (cash + positions)", inr(a.equity)], ["Total P&L", <span key="p" className={tone(a.totalPnl)}>{inr(a.totalPnl)}</span>],
            ["Cash", inr(a.cash)], ["Positions at market", inr(a.marketValue)],
            ["Realised · unrealised", `${inr(a.realized)} · ${inr(a.unrealized)}`], ["Costs paid", inr(a.costsPaid)],
            ["Starting cash", `${inr(a.startingCash, 0)} (since ${a.since.slice(0, 10)})`],
          ]} />
          <form className="mt-3 flex flex-wrap items-end gap-2 text-xs text-muted" onSubmit={(e) => { e.preventDefault(); if (confirm("Reset the paper account? All paper orders, positions and fills are deleted.")) post({ action: "reset", startingCash: Number(cash) }).then(() => { setMsg("Paper account reset."); setReload((x) => x + 1); }, (er) => setErr(er.message)); }}>
            <label>Starting cash (₹)<input type="number" min={10000} value={cash} onChange={(e) => setCash(e.target.value)} className={`${field} w-32`} /></label>
            <button className="rounded-md border border-line px-3 py-1.5 text-sm">Reset account</button>
          </form>
        </Card>
        <Card title="Order ticket">
          <form onSubmit={order} className="flex flex-wrap items-end gap-2 text-xs text-muted">
            <label>Instrument<select value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value })} className={field}><option value="equity">Equity</option><option value="future">Future</option><option value="option">Option</option></select></label>
            <label>{t.kind === "equity" ? "NSE symbol" : "Underlying"}<input required value={t.symbol} onChange={(e) => setT({ ...t, symbol: e.target.value })} className={`${field} w-28`} /></label>
            {t.kind !== "equity" && <label>Expiry<input required type="date" value={t.expiry} onChange={(e) => setT({ ...t, expiry: e.target.value })} className={field} /></label>}
            {t.kind === "option" && <><label>Strike<input required type="number" step="any" value={t.strike} onChange={(e) => setT({ ...t, strike: e.target.value })} className={`${field} w-24`} /></label><label>Right<select value={t.right} onChange={(e) => setT({ ...t, right: e.target.value })} className={field}><option>CE</option><option>PE</option></select></label></>}
            <label>Side<select value={t.side} onChange={(e) => setT({ ...t, side: e.target.value })} className={field}><option>BUY</option><option>SELL</option></select></label>
            <label>Quantity{t.kind !== "equity" && " (units)"}<input required type="number" min={1} value={t.qty} onChange={(e) => setT({ ...t, qty: e.target.value })} className={`${field} w-24`} /></label>
            <label>Type<select value={t.type} onChange={(e) => setT({ ...t, type: e.target.value })} className={field}><option>MARKET</option><option>LIMIT</option></select></label>
            {t.type === "LIMIT" && <label>Limit price<input required type="number" step="0.05" value={t.limit} onChange={(e) => setT({ ...t, limit: e.target.value })} className={`${field} w-24`} /></label>}
            <label>Valid (sessions)<input type="number" min={1} max={30} value={t.valid} onChange={(e) => setT({ ...t, valid: e.target.value })} className={`${field} w-20`} /></label>
            <button className={`rounded-md px-3 py-1.5 text-sm font-medium text-slate-950 ${t.side === "BUY" ? "bg-up" : "bg-down"}`}>Place paper {t.side.toLowerCase()}</button>
          </form>
          <p className="mt-2 text-[11px] text-muted">F&O quantities must be a multiple of the lot size. Cash equities cannot be sold short. Short options and futures are allowed, but margin is not simulated.</p>
        </Card>
      </div>
      <Card title="Positions">
        {!d.positions.length ? <Empty>No positions.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Instrument</th><th>Qty</th><th>Avg price</th><th>Mark</th><th className="text-right">Unrealised</th><th className="text-right">Realised</th></tr></thead>
            <tbody>{d.positions.map((p) => (
              <tr key={p.instrument} className="border-t border-line"><td className="py-1.5 font-mono">{p.instrument}{p.short && <span className="ml-1 text-[10px] text-gold">short · margin not simulated</span>}{p.settled && <span className="ml-1 text-[10px] text-muted">settled at expiry</span>}</td>
                <td>{p.qty}</td><td>{fmt(p.avgPrice)}</td><td>{p.mark === null ? "—" : `${fmt(p.mark)} (${p.markDate})`}</td>
                <td className={`text-right font-mono ${tone(p.unrealized)}`}>{p.unrealized === null ? "—" : fmt(p.unrealized)}</td><td className={`text-right font-mono ${tone(p.realized)}`}>{fmt(p.realized)}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
      <Card title="Orders">
        {!d.orders.length ? <Empty>No orders yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">#</th><th>Instrument</th><th>Order</th><th>Status</th><th>Fill</th><th>Costs</th><th /></tr></thead>
            <tbody>{d.orders.map((o) => (
              <tr key={o.id} className="border-t border-line"><td className="py-1.5">{o.id}</td><td className="font-mono">{o.instrument}</td>
                <td className={o.side === "BUY" ? "text-up" : "text-down"}>{o.side} {o.qty} {o.type === "LIMIT" ? `@ ${fmt(o.limit)}` : "at market"}<span className="block text-[10px] text-muted">after {o.placedAfter}</span></td>
                <td>{o.status.toLowerCase()}{o.reason && <span className="block text-[10px] text-muted">{o.reason}</span>}</td>
                <td>{o.fillPrice === null ? "—" : `${fmt(o.fillPrice)} on ${o.fillDate}`}</td><td>{o.costs === null ? "—" : fmt(o.costs)}</td>
                <td className="text-right">{o.status === "OPEN" && <button onClick={() => post({ action: "cancel", id: o.id }).then(() => setReload((x) => x + 1), (er) => setErr(er.message))} className="rounded border border-line px-2 py-0.5 text-[11px]">Cancel</button>}</td></tr>
            ))}</tbody></table></div>
        )}
      </Card>
      {d.fills.length > 0 && (
        <Card title="Fills">
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Date</th><th>Instrument</th><th>Side</th><th>Qty</th><th>Price</th><th>Costs</th><th className="text-right">Realised</th></tr></thead>
            <tbody>{d.fills.map((f, i) => <tr key={i} className="border-t border-line"><td className="py-1">{f.d}</td><td className="font-mono">{f.instrument}{f.kind === "SETTLEMENT" && <span className="ml-1 text-[10px] text-muted">expiry settlement</span>}</td><td>{f.side}</td><td>{f.qty}</td><td>{fmt(f.price)}</td><td>{fmt(f.costs)}</td><td className={`text-right font-mono ${tone(f.realized)}`}>{fmt(f.realized)}</td></tr>)}</tbody></table></div>
        </Card>
      )}
    </div>
  );
}
