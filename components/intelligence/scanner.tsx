"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SetupDetail, type SetupView } from "./setup-detail";
import { FuturesDetail, StrategyDetail, type FuturesView, type StrategyView } from "./fo-detail";
import { Card, Empty, Loading, Notice, StatusBadge, fmt, inr } from "./ui";

const UNIVERSES = [
  "NIFTY 50", "NIFTY NEXT 50", "NIFTY 100", "NIFTY 200", "NIFTY 500", "NIFTY MIDCAP 100", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 100", "NIFTY SMALLCAP 250",
  "NIFTY BANK", "NIFTY FINANCIAL SERVICES", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG", "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY PSU BANK",
  "NIFTY PRIVATE BANK", "NIFTY OIL & GAS", "ALL_FO_UNDERLYINGS", "ALL_NSE_EQUITY",
];
const LABEL: Record<string, string> = { ALL_FO_UNDERLYINGS: "All F&O underlyings", ALL_NSE_EQUITY: "All NSE equities (EOD snapshot)" };
const HORIZONS = [["swing", "Swing (≈2 weeks)"], ["positional", "Positional (≈6 weeks)"], ["short-term-investment", "Short-term investment (≈3 months)"], ["intraday", "Intraday (needs real-time)"], ["btst", "BTST (needs real-time)"]] as const;
const STATUSES = ["ENTER IF CONFIRMED", "WAIT FOR CONFIRMATION", "WATCHLIST", "AVOID", "NO TRADE", "INSUFFICIENT DATA"];
const COLUMNS = ["Status", "Score", "Setup", "Price", "Entry", "Stop", "Target 1", "R:R", "Sector"] as const;
type Column = (typeof COLUMNS)[number];

type Coverage = {
  mode: string; unavailableUniverses: string[]; selected: number; unique: number; duplicates: number; shortlisted: number | null; notDeepEvaluated: number; scanned: number;
  excluded: Record<string, number>; missingData: number; staleData: number; opportunities: Record<string, number>; instrumentsNotScanned: string[];
  aiRequests: number; aiInputTokens: number; aiOutputTokens: number; aiCostUsd: number; marketDataRequests: number; startedAt: string | null; finishedAt: string | null;
};
type Job = { id: number; status: string; mode: string; progress: number; remaining: number; coverage: Coverage; createdAt: string; error: string | null };
type Row = { key: string; symbol: string; kind: "equity" | "futures" | "strategy"; status: string; score: number | null; payload: SetupView & Partial<StrategyView> & Partial<FuturesView> };
const INSTRUMENTS = [["equity", "Cash equity"], ["stock-futures", "Stock futures"], ["stock-options", "Stock options"], ["index-futures", "Index futures"], ["index-options", "Index options"]] as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}

export function MarketScanner({ initialJob }: { initialJob: number | null }) {
  const [universes, setUniverses] = useState<string[]>(["NIFTY 50"]);
  const [horizon, setHorizon] = useState("swing");
  const [direction, setDirection] = useState("any");
  const [mode, setMode] = useState<"comprehensive" | "accelerated">("comprehensive");
  const [capital, setCapital] = useState(500000);
  const [instruments, setInstruments] = useState<string[]>(["equity"]);
  const [optMode, setOptMode] = useState<"ALL" | "BUY_ONLY" | "SELL_ONLY">("ALL");
  const [definedRisk, setDefinedRisk] = useState(true);
  const [maxRisk, setMaxRisk] = useState(5000);
  const [maxCap, setMaxCap] = useState(100000);
  const [minRR, setMinRR] = useState(1.5);
  const [minLiqCr, setMinLiqCr] = useState(5);
  const [job, setJob] = useState<Job | null>(null);
  const [jobId, setJobId] = useState<number | null>(initialJob);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"score" | "symbol" | "rr">("score");
  const [statusFilter, setStatusFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [cols, setCols] = useState<Column[]>([...COLUMNS]);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: number; name: string; config: Record<string, unknown> }[]>([]);
  const [saveName, setSaveName] = useState("");
  const [reload, setReload] = useState(0);
  const polling = useRef(false);

  const config = useMemo(() => ({ universes, horizon, direction, capital, maxRiskPerTrade: maxRisk, maxCapitalPerTrade: maxCap, minRewardRisk: minRR, minLiquidity: minLiqCr * 1e7, instruments, optionBuyingOnly: optMode === "BUY_ONLY", optionSellingOnly: optMode === "SELL_ONLY", definedRiskOnly: definedRisk }), [universes, horizon, direction, capital, maxRisk, maxCap, minRR, minLiqCr, instruments, optMode, definedRisk]);

  useEffect(() => {
    let alive = true;
    api<{ configs: typeof saved }>("/api/intelligence/scan/configs").then((d) => alive && setSaved(d.configs), () => {});
    return () => { alive = false; };
  }, [reload]);

  // Poll (and advance) the current job until it finishes.
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    polling.current = true;
    const tick = async () => {
      try {
        const d = await api<{ scan: Job }>(`/api/intelligence/scan/status?id=${jobId}`);
        if (!alive) return;
        setJob(d.scan);
        if (d.scan.status === "queued" || d.scan.status === "running") setTimeout(tick, 1200);
        else polling.current = false;
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    };
    tick();
    return () => { alive = false; };
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !job || (job.status !== "completed" && job.status !== "cancelled" && job.coverage.scanned === 0)) return;
    let alive = true;
    api<{ results: Row[]; total: number }>(`/api/intelligence/scan/results?id=${jobId}&page=${page}&pageSize=25&sort=${sort}${statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : ""}`)
      .then((d) => { if (alive) { setRows(d.results); setTotal(d.total); } }, (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [jobId, job, page, sort, statusFilter]);

  const run = async () => {
    setErr(null);
    setRows([]);
    try {
      const d = await api<{ id: number }>("/api/intelligence/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, mode, idempotencyKey: crypto.randomUUID().replace(/-/g, "") }) });
      setPage(1);
      setJobId(d.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const cancel = async () => {
    if (!jobId) return;
    await api("/api/intelligence/scan/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: jobId }) }).catch((e) => setErr(e.message));
  };
  const load = (c: Record<string, unknown>) => {
    if (Array.isArray(c.universes)) setUniverses(c.universes as string[]);
    if (typeof c.horizon === "string") setHorizon(c.horizon);
    if (typeof c.direction === "string") setDirection(c.direction);
    if (typeof c.capital === "number") setCapital(c.capital);
    if (typeof c.maxRiskPerTrade === "number") setMaxRisk(c.maxRiskPerTrade);
    if (typeof c.maxCapitalPerTrade === "number") setMaxCap(c.maxCapitalPerTrade);
    if (typeof c.minRewardRisk === "number") setMinRR(c.minRewardRisk);
    if (typeof c.minLiquidity === "number") setMinLiqCr(c.minLiquidity / 1e7);
    if (Array.isArray(c.instruments) && c.instruments.length) setInstruments(c.instruments as string[]);
    setOptMode(c.optionBuyingOnly ? "BUY_ONLY" : c.optionSellingOnly ? "SELL_ONLY" : "ALL");
    if (typeof c.definedRiskOnly === "boolean") setDefinedRisk(c.definedRiskOnly);
  };
  const running = job && (job.status === "queued" || job.status === "running");
  const field = "w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-sm";
  const c = job?.coverage;

  return (
    <div className="space-y-4">
      {err && <Notice tone="error">{err}</Notice>}
      <Card title="Scan configuration">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <fieldset>
            <legend className="mb-1 text-xs text-muted">Universe (constituents are deduplicated)</legend>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
              {UNIVERSES.map((u) => (
                <label key={u} className={`cursor-pointer rounded-md border px-2 py-0.5 text-[11px] ${universes.includes(u) ? "border-accent/60 bg-accent/10 text-white" : "border-line text-soft"}`}>
                  <input type="checkbox" className="sr-only" checked={universes.includes(u)} onChange={() => setUniverses((s) => (s.includes(u) ? s.filter((x) => x !== u) : [...s, u]))} />
                  {LABEL[u] ?? u}
                </label>
              ))}
            </div>
            <fieldset className="mt-3">
              <legend className="mb-1 text-xs text-muted">Instruments</legend>
              <div className="flex flex-wrap gap-1">
                {INSTRUMENTS.map(([v, l]) => (
                  <label key={v} className={`cursor-pointer rounded-md border px-2 py-0.5 text-[11px] ${instruments.includes(v) ? "border-accent/60 bg-accent/10 text-white" : "border-line text-soft"}`}>
                    <input type="checkbox" className="sr-only" checked={instruments.includes(v)} onChange={() => setInstruments((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))} />{l}
                  </label>
                ))}
              </div>
              {instruments.some((i) => i.includes("options")) && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  <span role="radiogroup" aria-label="Option strategies" className="flex overflow-hidden rounded-md border border-line">
                    {([["ALL", "All strategies"], ["BUY_ONLY", "BUY ONLY"], ["SELL_ONLY", "SELL ONLY"]] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={optMode === v} onClick={() => setOptMode(v)} className={`px-2 py-0.5 ${optMode === v ? "bg-white text-slate-950" : "text-soft"}`}>{l}</button>)}
                  </span>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={definedRisk} onChange={(e) => setDefinedRisk(e.target.checked)} />Defined risk only</label>
                </div>
              )}
              <p className="mt-1 text-[11px] text-muted">F&O results use the latest NSE F&O bhavcopy (end of day): futures and option strategies are research candidates, never entries.</p>
            </fieldset>
          </fieldset>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1"><span className="text-muted">Horizon</span><select className={field} value={horizon} onChange={(e) => setHorizon(e.target.value)}>{HORIZONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="space-y-1"><span className="text-muted">Direction</span><select className={field} value={direction} onChange={(e) => setDirection(e.target.value)}><option value="any">Any</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option></select></label>
            <label className="space-y-1"><span className="text-muted">Capital (₹)</span><input type="number" className={field} value={capital} min={1000} onChange={(e) => setCapital(Number(e.target.value))} /></label>
            <label className="space-y-1"><span className="text-muted">Max risk per trade (₹)</span><input type="number" className={field} value={maxRisk} min={1} onChange={(e) => setMaxRisk(Number(e.target.value))} /></label>
            <label className="space-y-1"><span className="text-muted">Max capital per trade (₹)</span><input type="number" className={field} value={maxCap} min={100} onChange={(e) => setMaxCap(Number(e.target.value))} /></label>
            <label className="space-y-1"><span className="text-muted">Min reward:risk</span><input type="number" step="0.1" className={field} value={minRR} min={0.5} onChange={(e) => setMinRR(Number(e.target.value))} /></label>
            <label className="space-y-1"><span className="text-muted">Min daily value (₹ crore)</span><input type="number" step="0.5" className={field} value={minLiqCr} min={0} onChange={(e) => setMinLiqCr(Number(e.target.value))} /></label>
            <label className="space-y-1"><span className="text-muted">Mode</span><select className={field} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="comprehensive">Comprehensive (every symbol)</option><option value="accelerated">Accelerated (shortlist first)</option></select></label>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">{mode === "accelerated" ? "Accelerated: a first-stage shortlist from the EOD snapshot; symbols outside it are counted as not deep-evaluated. This is not a comprehensive scan." : "Comprehensive: every unique symbol in the selected universes is evaluated."}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={run} disabled={Boolean(running) || !universes.length || !instruments.length} className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-40">Run scan</button>
          {running && <button onClick={cancel} className="rounded-lg border border-line px-3 py-1.5 text-sm">Cancel</button>}
          <span className="mx-1 h-5 w-px bg-line" />
          <input className="w-40 rounded-lg border border-line bg-panel px-2 py-1 text-xs" placeholder="Name this scan" value={saveName} onChange={(e) => setSaveName(e.target.value)} aria-label="Saved scan name" />
          <button className="rounded-lg border border-line px-2 py-1 text-xs disabled:opacity-40" disabled={!saveName.trim()} onClick={() => api("/api/intelligence/scan/configs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: saveName, config }) }).then(() => { setSaveName(""); setReload((x) => x + 1); }, (e) => setErr(e.message))}>Save</button>
          {saved.length > 0 && (
            <select className="rounded-lg border border-line bg-panel px-2 py-1 text-xs" value="" onChange={(e) => { const s = saved.find((x) => String(x.id) === e.target.value); if (s) load(s.config); }} aria-label="Load a saved scan">
              <option value="">Load saved…</option>
              {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </Card>

      {job && c && (
        <Card title={`Scan #${job.id} · ${job.status}`} right={<span className="font-mono text-xs">{Math.round(job.progress * 100)}%</span>}>
          <div className="mb-3 h-1.5 overflow-hidden rounded bg-white/10" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-accent transition-all" style={{ width: `${job.progress * 100}%` }} /></div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            {[
              ["Mode", c.mode], ["Selected (with overlap)", c.selected], ["Unique underlyings", c.unique], ["Duplicates removed", c.duplicates],
              ["Shortlisted", c.shortlisted ?? "— (comprehensive)"], ["Not deep-evaluated", c.notDeepEvaluated], ["Scanned", c.scanned], ["Remaining", job.remaining],
              ["Missing data", c.missingData], ["Stale data", c.staleData], ["Market-data requests", c.marketDataRequests], ["AI requests / cost", `${c.aiRequests} / $${c.aiCostUsd.toFixed(4)}`],
              ["Started", c.startedAt?.slice(11, 19) ?? "—"], ["Completed", c.finishedAt?.slice(11, 19) ?? "—"],
            ].map(([k, v]) => <div key={String(k)}><dt className="text-muted">{k}</dt><dd className="font-mono text-soft">{String(v)}</dd></div>)}
          </dl>
          {c.unavailableUniverses.length > 0 && <Notice tone="warn">No constituent data for: {c.unavailableUniverses.join(", ")} — not scanned.</Notice>}
          {Object.keys(c.excluded).length > 0 && <p className="mt-2 text-[11px] text-muted">Excluded: {Object.entries(c.excluded).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
          <p className="mt-2 flex flex-wrap gap-1.5 text-xs">{Object.entries(c.opportunities).map(([k, v]) => <button key={k} onClick={() => { setStatusFilter(statusFilter === k ? "" : k); setPage(1); }} className={`rounded-md border px-2 py-0.5 ${statusFilter === k ? "border-accent" : "border-line"}`}>{k}: <b>{v}</b></button>)}</p>
          {job.error && <Notice tone="error">{job.error}</Notice>}
        </Card>
      )}

      {jobId && (
        <Card
          title="Results"
          right={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select className="rounded-lg border border-line bg-panel px-2 py-1" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Filter by status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              <select className="rounded-lg border border-line bg-panel px-2 py-1" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort"><option value="score">Sort: score</option><option value="rr">Sort: reward:risk</option><option value="symbol">Sort: symbol</option></select>
              <details className="relative"><summary className="cursor-pointer rounded-lg border border-line px-2 py-1">Columns</summary>
                <div className="absolute right-0 z-10 mt-1 w-40 space-y-1 rounded-lg border border-line bg-panel p-2">{COLUMNS.map((col) => <label key={col} className="flex gap-2"><input type="checkbox" checked={cols.includes(col)} onChange={() => setCols((s) => (s.includes(col) ? s.filter((x) => x !== col) : [...s, col]))} />{col}</label>)}</div>
              </details>
            </div>
          }
        >
          {!rows.length ? (running ? <Loading label="Scanning… results appear as chunks complete." /> : <Empty>No results{statusFilter ? ` with status ${statusFilter}` : ""}.</Empty>) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted"><tr><th className="py-1 pr-2">Symbol</th>{cols.map((col) => <th key={col} className="py-1 pr-2">{col}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const p = r.payload;
                    const cell: Record<Column, React.ReactNode> = {
                      Status: <StatusBadge status={r.status} />, Score: r.score ?? "—", Setup: r.kind === "strategy" ? `${p.name} · ${p.expiry ?? ""}` : r.kind === "futures" ? `Futures ${p.plan?.side ?? "— no direction"}` : p.setup,
                      Price: r.kind === "futures" ? inr(p.near?.price) : r.kind === "strategy" ? (p.netPremium === null || p.netPremium === undefined ? "—" : `net ${inr(p.netPremium, 0)}`) : inr(p.price),
                      Entry: p.entry ? `${fmt(p.entry.low)}–${fmt(p.entry.high)}` : p.notices ? "restricted" : "—", Stop: p.stop ? fmt(p.stop) : "—",
                      "Target 1": p.targets?.[0] ? fmt(p.targets[0].price) : "—", "R:R": p.rewardRisk ? fmt(p.rewardRisk) : "—", Sector: p.sector ?? "—",
                    };
                    return [
                      <tr key={r.key} className="cursor-pointer border-t border-line hover:bg-white/[0.03]" tabIndex={0} onClick={() => setOpen(open === r.key ? null : r.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === r.key ? null : r.key); } }} aria-expanded={open === r.key}>
                        <td className="py-1.5 pr-2"><span className="font-semibold text-white">{r.symbol}</span> <span className="text-muted">{p.name !== r.symbol ? p.name : ""}</span></td>
                        {cols.map((col) => <td key={col} className="py-1.5 pr-2">{cell[col]}</td>)}
                      </tr>,
                      open === r.key && <tr key={r.key + "-d"}><td colSpan={cols.length + 1} className="bg-white/[0.02] p-3">{r.kind === "strategy" ? <StrategyDetail s={p as unknown as StrategyView} /> : r.kind === "futures" ? <FuturesDetail f={p as unknown as FuturesView} /> : <SetupDetail s={p} />}</td></tr>,
                    ];
                  })}
                </tbody>
              </table>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <button className="rounded border border-line px-2 py-0.5 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Prev</button>
                <span className="text-muted">Page {page} of {Math.max(1, Math.ceil(total / 25))} · {total} results</span>
                <button className="rounded border border-line px-2 py-0.5 disabled:opacity-40" disabled={page * 25 >= total} onClick={() => setPage((x) => x + 1)}>Next</button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
