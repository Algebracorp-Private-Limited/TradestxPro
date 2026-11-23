"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Read = { bias: "Bullish" | "Bearish" | "Neutral"; score: number; headline: string; points: string[]; levels: { support: number | null; resistance: number | null } };
type A = { title: string; asOf: string | null; live: boolean; read: Read; narrative: string | null; engine: "claude" | "rules" };

const f2 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const BIAS = { Bullish: "bg-up/15 text-up border-up/40", Bearish: "bg-down/15 text-down border-down/40", Neutral: "bg-white/5 text-soft border-line" };

function remember(): boolean {
  try {
    return localStorage.getItem("txp_ai_open") !== "0";
  } catch {
    return true;
  }
}

/** Collapsible analysis card: Claude's write-up when configured, otherwise the rule-based technical read. */
export function AiAnalysis({ scope, target }: { scope: "market" | "index" | "stock" | "options"; target: string }) {
  const [open, setOpen] = useState(true);
  const [a, setA] = useState<A | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => setOpen(remember()));
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.resolve().then(() => { if (alive) { setA(null); setErr(null); } });
    fetch(`/api/ai/analysis?scope=${scope}&target=${encodeURIComponent(target)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!alive) return;
        if (!r.ok) setErr(d.error || "Analysis unavailable.");
        else setA(d);
      })
      .catch(() => alive && setErr("Analysis unavailable right now."));
    return () => {
      alive = false;
    };
  }, [scope, target, open]);

  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem("txp_ai_open", o ? "0" : "1"); } catch {}
      return !o;
    });
  };

  return (
    <section aria-label="AI analysis" className="rounded-xl border border-accent/30 bg-accent/[0.04]">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <span className="text-accent" aria-hidden>✦</span>
        <span className="text-sm font-medium">AI analysis</span>
        {a && <span className={`rounded-full border px-2 py-0.5 text-[10px] ${BIAS[a.read.bias]}`}>{a.read.bias}</span>}
        {a && <span className="hidden truncate text-xs text-muted sm:inline">{a.title} · {a.live ? "live price" : `EOD ${a.asOf ?? ""}`}</span>}
        <span className="ml-auto text-xs text-muted">{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      {open && (
        <div className="border-t border-accent/20 px-4 py-3 text-sm">
          {!a && !err && <div className="space-y-2"><div className="h-3 w-3/4 animate-pulse rounded bg-white/5" /><div className="h-3 w-1/2 animate-pulse rounded bg-white/5" /></div>}
          {err && <p className="text-xs text-muted">{err}</p>}
          {a && (
            <>
              {a.narrative ? (
                <div className="space-y-1 leading-6 text-soft">
                  {a.narrative.split("\n").filter(Boolean).map((l, i) =>
                    l.trim().startsWith("- ") ? <p key={i} className="pl-3">• {l.trim().slice(2)}</p> : <p key={i} className={i === 0 ? "text-white" : ""}>{l}</p>,
                  )}
                </div>
              ) : (
                <>
                  <p className="text-white">{a.read.headline}</p>
                  <ul className="mt-2 grid gap-x-6 gap-y-1 text-[13px] text-soft md:grid-cols-2">
                    {a.read.points.map((p, i) => <li key={i}>• {p}</li>)}
                  </ul>
                </>
              )}
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {a.read.levels.support !== null && <span>Nearest support ≈ <span className="font-mono text-up">{f2(a.read.levels.support)}</span></span>}
                {a.read.levels.resistance !== null && <span>Nearest resistance ≈ <span className="font-mono text-down">{f2(a.read.levels.resistance)}</span></span>}
                <span>{a.engine === "claude" ? "Written by Claude from the indicators above." : "Automated read of trend, momentum and positioning indicators."} Educational research, not investment advice.</span>
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Picks the analysis subject from the page URL (charts: ?symbol=, options: ?u=). */
export function AiAnalysisFromUrl({ param, fallback }: { param: "symbol" | "u"; fallback: string }) {
  const sp = useSearchParams();
  const raw = (sp.get(param) ?? fallback).toUpperCase();
  if (param === "u") return <AiAnalysis scope="options" target={raw} />;
  const [prefix, code] = raw.includes(":") ? raw.split(/:(.*)/s) : ["NSE", raw];
  if (prefix === "NSE") return <AiAnalysis scope="stock" target={code} />;
  if (prefix === "NSEIDX" || prefix === "BSEIDX") return <AiAnalysis scope="index" target={code} />;
  return null;
}
