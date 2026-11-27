"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Empty, KV, Loading, Notice, StatusBadge, fmt } from "./ui";

type Stats = { n: number; wins: number; winRatePct: number | null; winRateCi: [number, number] | null; avgR: number | null; avgNetR: number | null; profitFactor: number | null; maxDrawdownR: number | null; avgSessions: number | null; byExit: Record<string, number>; equityCurve: { date: string; cumR: number }[] };
type Calib = { rows: { bucket: string; n: number; winRatePct: number | null; ci: [number, number] | null; avgNetR: number | null }[]; monotonic: boolean | null; note: string };
type Plan = { id: number; instrument: string; origin: string; setup: string | null; score: number | null; status: string; startDate: string; evaluatedThrough: string | null; restricted?: boolean;
  plan: { direction: string; entry: { low: number; high: number }; stop: number; target: number; timeExitSessions: number; entryValidSessions: number } | null;
  state: { entryDate: string | null; entryPrice: number | null; exitDate: string | null; exitPrice: number | null; exitReason: string | null; r: number | null; netR: number | null; mae: number | null; mfe: number | null } };
type Alert = { id: number; instrument: string; condition: string; threshold: number; note: string | null; status: string; repeat: boolean; lastEvaluated: string | null; triggeredOn: string | null; triggerValue: number | null; unseen: boolean };
type Backtest = { status: string; missing?: string[]; truncated?: boolean; evaluatedThrough?: string; symbol: string; horizon: string; from: string; to: string; evaluations: number; signals: number; skipped: Record<string, number>; stats: Stats; bySetup: Record<string, Stats>; calibration: Calib; limitations: string[]; costFraction: number; durationMs: number;
  trades: { date: string; exitDate: string; setup: string; score: number | null; exitReason: string; entry: number; stop: number; target: number; r: number; netR: number; sessionsHeld: number }[] };

const field = "mt-1 block rounded-md border border-line bg-ink px-2 py-1.5 text-sm text-white";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}

function Curve({ points }: { points: { date: string; cumR: number }[] }) {
  if (points.length < 2) return <Empty>Not enough closed trades for a curve.</Empty>;
  const W = 600, H = 140, P = 6;
  const ys = [0, ...points.map((p) => p.cumR)], lo = Math.min(...ys), hi = Math.max(...ys);
  const X = (i: number) => P + (i / (points.length - 1)) * (W - 2 * P), Y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Cumulative net R from ${points[0].date} to ${points.at(-1)!.date}: ${points.at(-1)!.cumR}R`}>
      <line x1={P} x2={W - P} y1={Y(0)} y2={Y(0)} className="stroke-line" />
      <polyline points={points.map((p, i) => `${X(i)},${Y(p.cumR)}`).join(" ")} fill="none" strokeWidth={1.6} className={points.at(-1)!.cumR >= 0 ? "stroke-up" : "stroke-down"} />
      <text x={P} y={12} className="fill-muted text-[10px]">{hi}R</text><text x={P} y={H - 8} className="fill-muted text-[10px]">{lo}R</text>
    </svg>
  );
}

function StatsView({ s }: { s: Stats }) {
  if (!s.n) return <Empty>No closed trades yet.</Empty>;
  return (
    <KV items={[
      ["Closed trades", String(s.n)], ["Win rate (net R > 0)", `${fmt(s.winRatePct, 1)}%${s.winRateCi ? ` (95% interval ${s.winRateCi[0]}–${s.winRateCi[1]}%)` : ""}`],
      ["Average R (gross · net)", `${fmt(s.avgR)} · ${fmt(s.avgNetR)}`], ["Profit factor (net)", s.profitFactor === null ? "—" : fmt(s.profitFactor)],
      ["Max drawdown", `${fmt(s.maxDrawdownR)}R`], ["Average holding", `${fmt(s.avgSessions, 1)} sessions`],
      ["Exits", Object.entries(s.byExit).map(([k, v]) => `${k.toLowerCase().replace("_", " ")} ${v}`).join(" · ")],
    ]} />
  );
}

function CalibView({ c }: { c: Calib }) {
  return (
    <div>
      <table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Score</th><th>Trades</th><th>Win rate</th><th>95% interval</th><th>Avg net R</th></tr></thead>
        <tbody>{c.rows.map((r) => <tr key={r.bucket} className={`border-t border-line ${r.n < 10 ? "text-muted" : ""}`}><td className="py-1">{r.bucket}</td><td>{r.n}</td><td>{r.winRatePct === null ? "—" : `${r.winRatePct}%`}</td><td>{r.ci ? `${r.ci[0]}–${r.ci[1]}%` : "—"}</td><td>{fmt(r.avgNetR)}</td></tr>)}</tbody></table>
      <p className="mt-1 text-[11px] text-muted">{c.monotonic === null ? "Too few trades per bucket to judge whether higher scores were associated with better outcomes." : c.monotonic ? "In this sample, average net R did not fall as the score rose." : "In this sample, higher score buckets did not consistently show better outcomes."} {c.note}</p>
    </div>
  );
}

function Plans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [events, setEvents] = useState<{ d: string; kind: string; note: string }[]>([]);
  const [form, setForm] = useState({ symbol: "", direction: "long", low: "", high: "", stop: "", target: "", time: "10" });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ plans: Plan[] }>("/api/intelligence/plans").then((j) => alive && (setPlans(j.plans), setErr(null)), (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [reload]);
  const show = (id: number) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    api<{ events: typeof events }>(`/api/intelligence/plans/${id}`).then((j) => setEvents(j.events), () => setEvents([]));
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    api("/api/intelligence/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instrument: `NSE:${form.symbol.trim().toUpperCase()}`, plan: { direction: form.direction, entry: { low: +form.low, high: +form.high }, stop: +form.stop, target: +form.target, timeExitSessions: +form.time } }) })
      .then(() => { setForm({ ...form, low: "", high: "", stop: "", target: "" }); setReload((x) => x + 1); }, (er) => setErr(er.message));
  };
  return (
    <div className="space-y-4">
      {err && <Notice tone="error">{err}</Notice>}
      <Card title="Track your own plan (paper)">
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs text-muted">
          <label>NSE symbol<input required value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} className={`${field} w-28`} /></label>
          <label>Direction<select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className={field}><option value="long">Long</option><option value="short">Short</option></select></label>
          {(["low", "high", "stop", "target"] as const).map((k) => <label key={k}>{k === "low" ? "Entry from" : k === "high" ? "Entry to" : k === "stop" ? "Stop" : "Target"}<input required type="number" step="0.05" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={`${field} w-24`} /></label>)}
          <label>Time exit (sessions)<input type="number" min={1} max={250} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={`${field} w-20`} /></label>
          <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950">Track</button>
        </form>
        <p className="mt-2 text-[11px] text-muted">Plans are tracked on end-of-day bars after each daily data load. Nothing is sent to a broker. Engine plans can be tracked from Equity AI.</p>
      </Card>
      <Card title="Tracked plans">
        {!plans ? <Loading /> : !plans.length ? <Empty>No tracked plans yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Instrument</th><th>Status</th><th>Plan</th><th>Entry</th><th>Exit</th><th className="text-right">Net R</th><th /></tr></thead>
            <tbody>{plans.map((p) => [
              <tr key={p.id} className="border-t border-line">
                <td className="py-1.5"><button className="font-semibold hover:text-accent" onClick={() => show(p.id)} aria-expanded={open === p.id}>{p.instrument.replace(/^NSE:/, "")}</button><span className="block text-[10px] text-muted">{p.origin === "engine" ? `${p.setup ?? "Engine"} · score ${p.score ?? "—"}` : "Manual"} · from {p.startDate}</span></td>
                <td><StatusBadge status={p.status} /></td>
                <td className="font-mono text-[11px]">{p.plan ? `${p.plan.direction} ${fmt(p.plan.entry.low)}–${fmt(p.plan.entry.high)} · SL ${fmt(p.plan.stop)} · T ${fmt(p.plan.target)}` : "restricted"}</td>
                <td>{p.state.entryDate ? `${p.state.entryDate} @ ${fmt(p.state.entryPrice)}` : "—"}</td>
                <td>{p.state.exitDate ? `${p.state.exitReason?.toLowerCase().replace("_", " ")} ${p.state.exitDate} @ ${fmt(p.state.exitPrice)}` : p.evaluatedThrough ? `checked to ${p.evaluatedThrough}` : "—"}</td>
                <td className={`text-right font-mono ${(p.state.netR ?? 0) >= 0 ? "text-up" : "text-down"}`}>{p.state.netR === null ? "—" : fmt(p.state.netR)}</td>
                <td className="text-right">{["WATCHING", "ACTIVE"].includes(p.status) && <button onClick={() => api(`/api/intelligence/plans/${p.id}`, { method: "DELETE" }).then(() => setReload((x) => x + 1), (e) => setErr(e.message))} className="rounded border border-line px-2 py-0.5 text-[11px]">Cancel</button>}</td>
              </tr>,
              open === p.id && <tr key={`${p.id}-e`}><td colSpan={7} className="bg-white/[0.02] p-2"><ul className="space-y-0.5 text-[11px]">{events.map((e, i) => <li key={i}><span className="font-mono text-muted">{e.d}</span> {e.note}</li>)}</ul>{p.state.mae !== null && <p className="mt-1 text-[11px] text-muted">Max adverse {fmt(p.state.mae)}R · max favourable {fmt(p.state.mfe)}R</p>}</td></tr>,
            ])}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

type CondDef = { id: string; category: string; label: string; thresholdLabel: string; min: number; max: number; params?: { key: string; label: string; min: number; max: number; default: number }[] };
const CATEGORY_LABEL: Record<string, string> = { price: "Price", technical: "Technical", oi: "Open interest", iv: "Implied volatility", setup: "Engine setup" };
const INSTRUMENT_HINT: Record<string, string> = { price: "Symbol, or NSEIDX:NIFTY 50", technical: "Symbol, or NSEIDX:NIFTY 50", oi: "F&O underlying, e.g. NIFTY", iv: "F&O underlying, e.g. NIFTY", setup: "NSE symbol" };

function Alerts() {
  const [alerts, setAlerts] = useState<(Alert & { description?: string; category?: string })[] | null>(null);
  const [conds, setConds] = useState<CondDef[]>([]);
  const [basis, setBasis] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<{ instrument: string; condition: string; threshold: string; note: string; repeat: boolean; params: Record<string, string> }>({ instrument: "", condition: "close_above", threshold: "", note: "", repeat: false, params: {} });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ alerts: (Alert & { description?: string; category?: string })[]; conditions: CondDef[]; basis: string }>("/api/intelligence/alerts").then((j) => {
      if (!alive) return;
      setAlerts(j.alerts); setConds(j.conditions ?? []); setBasis(j.basis); setErr(null);
      if (j.alerts.some((a) => a.unseen)) api("/api/intelligence/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "seen" }) }).catch(() => {});
    }, (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [reload]);
  const def = conds.find((c) => c.id === f.condition);
  const cat = def?.category ?? "price";
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = f.instrument.trim().toUpperCase();
    const instrument = raw.includes(":") ? raw : cat === "oi" || cat === "iv" ? `FO:${raw}` : `NSE:${raw}`;
    const params: Record<string, number> = {};
    for (const p of def?.params ?? []) params[p.key] = Number(f.params[p.key] ?? p.default);
    api("/api/intelligence/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instrument, condition: f.condition, threshold: +f.threshold, note: f.note, repeat: f.repeat, params }) })
      .then(() => { setF({ ...f, threshold: "", note: "" }); setReload((x) => x + 1); }, (er) => setErr(er.message));
  };
  const categories = [...new Set(conds.map((c) => c.category))];
  return (
    <div className="space-y-4">
      {err && <Notice tone="error">{err}</Notice>}
      <Card title="New alert">
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs text-muted">
          <label>Type<select value={cat} onChange={(e) => { const first = conds.find((c) => c.category === e.target.value); if (first) setF({ ...f, condition: first.id, threshold: "" }); }} className={field}>{(categories.length ? categories : ["price"]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}</select></label>
          <label>Condition<select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value, threshold: "" })} className={field}>{conds.filter((c) => c.category === cat).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label>{INSTRUMENT_HINT[cat]}<input required value={f.instrument} onChange={(e) => setF({ ...f, instrument: e.target.value })} className={`${field} w-44`} /></label>
          <label>{def?.thresholdLabel ?? "Value"}<input required type="number" step="any" min={def?.min} max={def?.max} value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} className={`${field} w-24`} /></label>
          {(def?.params ?? []).map((p) => <label key={p.key}>{p.label}<input type="number" min={p.min} max={p.max} value={f.params[p.key] ?? String(p.default)} onChange={(e) => setF({ ...f, params: { ...f.params, [p.key]: e.target.value } })} className={`${field} w-20`} /></label>)}
          <label>Note<input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} className={`${field} w-40`} /></label>
          <label className="flex items-center gap-1 pb-2"><input type="checkbox" checked={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.checked })} />Repeat</label>
          <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950">Add alert</button>
        </form>
        <p className="mt-2 text-[11px] text-muted">{basis || "Evaluated on end-of-day data after each daily load; not real-time."} {cat === "oi" ? "Total open interest across the underlying's F&O contracts, day over day. It does not show who holds the positions." : cat === "iv" ? "ATM implied volatility of the nearest expiry, computed from the end-of-day option chain." : cat === "setup" ? "Fires when the setup engine's status is an entry status and its score reaches your minimum (a rank, not a probability)." : ""}</p>
      </Card>
      <Card title="Your alerts">
        {!alerts ? <Loading /> : !alerts.length ? <Empty>No alerts yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Instrument</th><th>Condition</th><th>Status</th><th>Triggered</th><th>Checked to</th><th /></tr></thead>
            <tbody>{alerts.map((a) => (
              <tr key={a.id} className={`border-t border-line ${a.unseen ? "bg-accent/10" : ""}`}>
                <td className="py-1.5 font-semibold">{a.instrument.replace(/^(NSE|FO):/, "")}<span className="ml-1 text-[10px] font-normal text-muted">{CATEGORY_LABEL[a.category ?? "price"]}</span>{a.note && <span className="block text-[10px] font-normal text-muted">{a.note}</span>}</td>
                <td>{a.description ?? `${a.condition} ${fmt(a.threshold)}`}{a.repeat ? " · repeats" : ""}</td>
                <td>{a.status.toLowerCase()}</td>
                <td>{a.triggeredOn ? `${a.triggeredOn} (${fmt(a.triggerValue)})` : "—"}</td>
                <td>{a.lastEvaluated ?? "—"}</td>
                <td className="text-right"><button onClick={() => api(`/api/intelligence/alerts?id=${a.id}`, { method: "DELETE" }).then(() => setReload((x) => x + 1), (e) => setErr(e.message))} className="rounded border border-line px-2 py-0.5 text-[11px]">Delete</button></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

type WatchItem = { id: number; symbol: string; horizon: string; status: string | null; score: number | null; setup: string | null; evaluatedOn: string | null; changedAt: string | null };
function Watchlist() {
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [basis, setBasis] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [horizon, setHorizon] = useState("swing");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    api<{ items: WatchItem[]; basis: string }>("/api/intelligence/watchlist").then((j) => { if (alive) { setItems(j.items); setBasis(j.basis); setErr(null); } }, (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [reload]);
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    api("/api/intelligence/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, horizon }) })
      .then(() => { setSymbol(""); setBusy(false); setReload((x) => x + 1); }, (er) => { setErr(er.message); setBusy(false); });
  };
  return (
    <div className="space-y-4">
      {err && <Notice tone="error">{err}</Notice>}
      <Card title="AI watchlist">
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-xs text-muted">
          <label>NSE symbol<input required value={symbol} onChange={(e) => setSymbol(e.target.value)} className={`${field} w-32`} /></label>
          <label>Horizon<select value={horizon} onChange={(e) => setHorizon(e.target.value)} className={field}><option value="swing">Swing</option><option value="positional">Positional</option><option value="short-term-investment">Short-term investment</option></select></label>
          <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50">{busy ? "Evaluating…" : "Watch"}</button>
        </form>
        <p className="mt-2 text-[11px] text-muted">{basis || "Re-evaluated on each new end-of-day session."} You get a notification when a symbol newly reaches &ldquo;enter if confirmed&rdquo; or &ldquo;wait for confirmation&rdquo;.</p>
      </Card>
      <Card title="Watched symbols">
        {!items ? <Loading /> : !items.length ? <Empty>No symbols watched yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr><th className="py-1">Symbol</th><th>Horizon</th><th>Status</th><th>Setup</th><th>Score</th><th>As of</th><th /></tr></thead>
            <tbody>{items.map((w) => (
              <tr key={w.id} className="border-t border-line">
                <td className="py-1.5 font-semibold"><a className="hover:text-accent" href={`/ai-intelligence/equity?symbol=${encodeURIComponent(w.symbol)}`}>{w.symbol}</a></td>
                <td>{w.horizon}</td><td>{w.status ? <StatusBadge status={w.status} /> : "—"}</td><td>{w.setup ?? "—"}</td><td>{w.score ?? "—"}</td><td>{w.evaluatedOn ?? "—"}</td>
                <td className="text-right"><button onClick={() => api(`/api/intelligence/watchlist?id=${w.id}`, { method: "DELETE" }).then(() => setReload((x) => x + 1), (e) => setErr(e.message))} className="rounded border border-line px-2 py-0.5 text-[11px]">Remove</button></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

type Note = { id: number; kind: string; title: string; body: string; link: string | null; d: string; read: boolean; createdAt: string };
function Notifications() {
  const [d, setD] = useState<{ unread: number; items: Note[]; settings: { emailAlerts: boolean }; emailAvailable: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    api<NonNullable<typeof d>>("/api/intelligence/notifications").then((j) => { if (alive) { setD(j); setErr(null); } }, (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [reload]);
  const post = (body: unknown) => api("/api/intelligence/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(() => { setReload((x) => x + 1); window.dispatchEvent(new Event("txp:notifications")); }, (e) => setErr(e.message));
  if (err) return <Notice tone="error">{err}</Notice>;
  if (!d) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title="Notification settings">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.settings.emailAlerts} disabled={!d.emailAvailable} onChange={(e) => post({ action: "settings", emailAlerts: e.target.checked })} />E-mail me a digest of new alerts, plan events and watchlist changes after each daily update</label>
        {!d.emailAvailable && <p className="mt-1 text-[11px] text-muted">E-mail is not configured on this server.</p>}
      </Card>
      <Card title={`Notifications${d.unread ? ` · ${d.unread} unread` : ""}`} right={d.unread ? <button onClick={() => post({ action: "read", id: "all" })} className="rounded border border-line px-2 py-0.5 text-[11px]">Mark all read</button> : null}>
        {!d.items.length ? <Empty>No notifications yet. Alerts, plan events and watchlist changes appear here after each daily update.</Empty> : (
          <ul className="divide-y divide-line">{d.items.map((n) => (
            <li key={n.id} className={`flex gap-3 py-2 text-xs ${n.read ? "" : "bg-accent/5"}`}>
              <span className="w-20 shrink-0 font-mono text-muted">{n.d}</span>
              <span className="min-w-0 flex-1"><b className="text-soft">{n.title}</b><span className="block text-muted">{n.body}</span></span>
              <span className="flex shrink-0 flex-col items-end gap-1">{n.link && <a href={n.link} className="text-accent hover:underline">Open</a>}{!n.read && <button onClick={() => post({ action: "read", id: n.id })} className="text-muted hover:text-soft">Mark read</button>}</span>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function BacktestView() {
  const [symbol, setSymbol] = useState("RELIANCE");
  const [horizon, setHorizon] = useState("swing");
  const [d, setD] = useState<Backtest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    api<Backtest>(`/api/intelligence/backtest?${new URLSearchParams({ symbol: symbol.trim().toUpperCase(), horizon })}`).then((j) => { setD(j); setErr(null); setBusy(false); }, (er) => { setErr(er.message); setBusy(false); });
  };
  return (
    <div className="space-y-4">
      <Card title="Walk-forward backtest of the equity setup engine">
        <form onSubmit={run} className="flex flex-wrap items-end gap-2 text-xs text-muted">
          <label>NSE symbol<input value={symbol} onChange={(e) => setSymbol(e.target.value)} className={`${field} w-32`} /></label>
          <label>Horizon<select value={horizon} onChange={(e) => setHorizon(e.target.value)} className={field}><option value="swing">Swing</option><option value="positional">Positional</option><option value="short-term-investment">Short-term investment</option></select></label>
          <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50">{busy ? "Running…" : "Run backtest"}</button>
        </form>
        <p className="mt-2 text-[11px] text-muted">At each evaluation date the engine sees only the bars up to that date; signals become paper plans simulated on later bars.</p>
      </Card>
      {err && <Notice tone="error">{err}</Notice>}
      {d && (d.status !== "OK" ? <Notice tone="warn">Insufficient data: {d.missing?.join(", ")}</Notice> : (
        <>
          <Card title={`${d.symbol} · ${d.horizon} · ${d.from} → ${d.to}`}>
            {d.truncated && <Notice tone="warn">The evaluation limit was reached: results cover signals through {d.evaluatedThrough} only.</Notice>}
            <p className="mb-2 text-xs text-muted">{d.evaluations} evaluation dates, {d.signals} signals, {d.stats.n} closed trades; cost {fmt(d.costFraction * 100, 2)}% per round trip. Not evaluated as entries: {Object.entries(d.skipped).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(", ") || "none"}.</p>
            <div className="grid gap-4 lg:grid-cols-2"><StatsView s={d.stats} /><Curve points={d.stats.equityCurve} /></div>
          </Card>
          <Card title="Score calibration (observed, this sample)"><CalibView c={d.calibration} /></Card>
          {d.trades.length > 0 && (
            <Card title="Trades">
              <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-panel text-muted"><tr><th className="py-1">Entry</th><th>Exit</th><th>Setup</th><th>Score</th><th>Entry · SL · T</th><th>Exit reason</th><th className="text-right">Net R</th></tr></thead>
                <tbody>{d.trades.map((t, i) => <tr key={i} className="border-t border-line"><td className="py-1">{t.date}</td><td>{t.exitDate}</td><td>{t.setup}</td><td>{t.score ?? "—"}</td><td className="font-mono">{fmt(t.entry)} · {fmt(t.stop)} · {fmt(t.target)}</td><td>{t.exitReason.toLowerCase().replace("_", " ")}</td><td className={`text-right font-mono ${t.netR >= 0 ? "text-up" : "text-down"}`}>{fmt(t.netR)}</td></tr>)}</tbody></table></div>
            </Card>
          )}
          <Card title="Limitations"><ul className="list-disc pl-4 text-xs text-muted">{d.limitations.map((l) => <li key={l}>{l}</li>)}</ul></Card>
        </>
      ))}
    </div>
  );
}

function PerformanceView() {
  const [d, setD] = useState<{ counts: Record<string, number>; stats: Stats; bySource: { engine: Stats; manual: Stats }; calibration: Calib; basis: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<NonNullable<typeof d>>("/api/intelligence/performance").then((j) => alive && setD(j), (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);
  if (err) return <Notice tone="error">{err}</Notice>;
  if (!d) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title="Your tracked plans">
        <p className="mb-2 text-xs text-muted">{Object.entries(d.counts).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ") || "No plans yet."}</p>
        <div className="grid gap-4 lg:grid-cols-2"><StatsView s={d.stats} /><Curve points={d.stats.equityCurve} /></div>
        <p className="mt-2 text-[11px] text-muted">{d.basis}</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Engine plans"><StatsView s={d.bySource.engine} /></Card>
        <Card title="Manual plans"><StatsView s={d.bySource.manual} /></Card>
      </div>
      <Card title="Engine score calibration (your closed engine plans)"><CalibView c={d.calibration} /></Card>
    </div>
  );
}

const TABS = [["plans", "Plans"], ["alerts", "Alerts"], ["watchlist", "AI watchlist"], ["notifications", "Notifications"], ["backtest", "Backtest"], ["performance", "Performance"]] as const;

export function Monitor({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>(TABS.some(([k]) => k === initialTab) ? (initialTab as (typeof TABS)[number][0]) : "plans");
  const pick = useCallback((k: (typeof TABS)[number][0]) => { setTab(k); history.replaceState(null, "", `?tab=${k}`); }, []);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Monitor" className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => pick(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-accent text-white" : "border-transparent text-muted hover:text-soft"}`}>{l}</button>)}
      </div>
      <div role="tabpanel">{tab === "plans" ? <Plans /> : tab === "alerts" ? <Alerts /> : tab === "watchlist" ? <Watchlist /> : tab === "notifications" ? <Notifications /> : tab === "backtest" ? <BacktestView /> : <PerformanceView />}</div>
      <p className="text-[11px] text-muted">Research tools on end-of-day data. Paper tracking only; no orders are placed.</p>
    </div>
  );
}
