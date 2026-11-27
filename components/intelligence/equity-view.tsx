"use client";

import { useState } from "react";
import { InstrumentSearch } from "@/components/instrument-search";
import { SetupDetail, type SetupView } from "./setup-detail";
import { Card, Loading, Notice, type Prov } from "./ui";

export function EquityAI() {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [horizon, setHorizon] = useState("swing");
  const [capital, setCapital] = useState(500000);
  const [maxRisk, setMaxRisk] = useState(5000);
  const [explain, setExplain] = useState(true);
  const [res, setRes] = useState<{ setup: SetupView; provenance: Prov; analysisId: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [track, setTrack] = useState<string | null>(null);
  const trackPlan = () => {
    if (!res) return;
    setTrack("Saving…");
    fetch("/api/intelligence/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromEngine: true, symbol: res.setup.symbol, horizon }) })
      .then(async (r) => { const j = await r.json().catch(() => ({})); setTrack(r.ok ? "Tracking: see Monitor & backtest → Plans." : j.error ?? "Could not track this plan."); }, () => setTrack("Network error"));
  };
  const analyze = async (sym: string, fresh = false) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/intelligence/equity/analyze?symbol=${encodeURIComponent(sym)}&horizon=${horizon}&capital=${capital}&maxRisk=${maxRisk}${explain ? "&explain=1" : ""}${fresh ? "&fresh=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Analysis failed");
      setRes(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = "rounded-lg border border-line bg-panel px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <Card title="Analyse a stock">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <InstrumentSearch placeholder="Search an NSE stock — e.g. RELIANCE" onPick={(r) => { setSymbol(r.symbol); analyze(r.symbol); }} />
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="space-y-1"><span className="block text-muted">Horizon</span><select className={field} value={horizon} onChange={(e) => setHorizon(e.target.value)}><option value="swing">Swing</option><option value="positional">Positional</option><option value="short-term-investment">Short-term investment</option><option value="intraday">Intraday</option></select></label>
            <label className="space-y-1"><span className="block text-muted">Capital ₹</span><input type="number" className={`${field} w-28`} value={capital} onChange={(e) => setCapital(Number(e.target.value))} /></label>
            <label className="space-y-1"><span className="block text-muted">Max risk ₹</span><input type="number" className={`${field} w-24`} value={maxRisk} onChange={(e) => setMaxRisk(Number(e.target.value))} /></label>
            <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" checked={explain} onChange={(e) => setExplain(e.target.checked)} />AI explanation</label>
            {symbol && <button className="rounded-lg border border-line px-3 py-1.5" onClick={() => analyze(symbol, true)} disabled={busy}>Refresh</button>}
          </div>
        </div>
      </Card>
      {err && <Notice tone="error">{err}</Notice>}
      {busy && <Loading label="Analysing…" />}
      {res && !busy && (
        <Card title={<span>{res.setup.name} <span className="font-mono text-xs text-muted">NSE:{res.setup.symbol}{res.setup.sector ? ` · ${res.setup.sector}` : ""}</span></span>} right={res.analysisId ? <span className="text-[10px] text-muted">analysis #{res.analysisId} (stored, immutable)</span> : null}>
          <SetupDetail s={res.setup} provenance={res.provenance} />
          {res.setup.entry && res.setup.stop && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <button onClick={trackPlan} className="rounded-md border border-line px-3 py-1.5 hover:bg-white/5">Track this plan (paper)</button>
              {track && <span className="text-muted">{track} <a href="/ai-intelligence/monitor?tab=plans" className="text-accent hover:underline">Open monitor</a></span>}
            </div>
          )}
        </Card>
      )}
      <p className="text-[11px] leading-5 text-muted">Conditional setups from end-of-day data. A setup is not a prediction or a recommendation: act only after the stated confirmation, and only after confirming prices with your broker. Stops are not guaranteed fills; gaps can exceed the planned risk.</p>
    </div>
  );
}
