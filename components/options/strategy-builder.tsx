"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { STRATEGIES, payoffAtExpiry, payoffNow, priceLevels, strikeStep, summarise, type Leg, type StrategyTemplate } from "@/lib/options/strategy";
import { yearsToExpiry } from "@/lib/options/bs";
import { Info } from "./info";

type ChainLeg = { ltp: number | null; bid: number | null; ask: number | null; iv: number | null } | null;
type Chain = { underlying: string; name: string; expiries: string[]; expiry: string | null; lotSize: number | null; spot: number | null; spotSource: string; broker: string | null; atm: number | null; rows: { strike: number; ce: ChainLeg; pe: ChainLeg }[] };
type U = { symbol: string; name: string; exchange: string };

const VIEWS = ["Bullish", "Bearish", "Neutral", "Volatile"] as const;
const VIEW_TONE: Record<string, string> = { Bullish: "text-up", Bearish: "text-down", Neutral: "text-accent", Volatile: "text-gold" };
const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const rupee = (v: number | null | undefined) => (v === null || v === undefined ? "Unlimited" : `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`);
const fd = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
const R = 0.065;

function premiumOf(l: ChainLeg): number | null {
  if (!l) return null;
  if (l.ltp && l.ltp > 0) return l.ltp;
  if (l.bid && l.ask) return (l.bid + l.ask) / 2;
  return null;
}

function Payoff({ legs, lot, spot, T, breakevens }: { legs: Leg[]; lot: number; spot: number; T: number; breakevens: number[] }) {
  const W = 640;
  const H = 260;
  const strikes = legs.map((l) => l.strike);
  const lo = Math.min(spot, ...strikes) * 0.94;
  const hi = Math.max(spot, ...strikes) * 1.06;
  const N = 160;
  const xs = Array.from({ length: N + 1 }, (_, i) => lo + ((hi - lo) * i) / N);
  const exp = xs.map((x) => payoffAtExpiry(legs, lot, x));
  const now = T > 0 ? xs.map((x) => payoffNow(legs, lot, x, T, R)) : exp;
  const ymin = Math.min(...exp, ...now, 0);
  const ymax = Math.max(...exp, ...now, 0);
  const pad = (ymax - ymin || 1) * 0.1;
  const X = (x: number) => ((x - lo) / (hi - lo)) * W;
  const Y = (y: number) => H - ((y - (ymin - pad)) / (ymax - ymin + 2 * pad)) * H;
  const path = (ys: number[]) => xs.map((x, i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join("");
  const zero = Y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img" aria-label="Payoff chart at expiry and today">
      <defs>
        <clipPath id="above"><rect x="0" y="0" width={W} height={zero} /></clipPath>
        <clipPath id="below"><rect x="0" y={zero} width={W} height={H - zero} /></clipPath>
      </defs>
      <path d={`${path(exp)}L${W},${zero}L0,${zero}Z`} fill="var(--color-up)" opacity="0.15" clipPath="url(#above)" />
      <path d={`${path(exp)}L${W},${zero}L0,${zero}Z`} fill="var(--color-down)" opacity="0.15" clipPath="url(#below)" />
      <line x1="0" x2={W} y1={zero} y2={zero} stroke="var(--color-line)" />
      <path d={path(now)} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="5 4" />
      <path d={path(exp)} fill="none" stroke="var(--color-white)" strokeWidth="2" />
      <line x1={X(spot)} x2={X(spot)} y1="0" y2={H} stroke="var(--color-gold)" strokeDasharray="3 3" />
      <text x={X(spot) + 4} y="12" fontSize="10" fill="var(--color-gold)">Spot {f(spot, 0)}</text>
      {breakevens.filter((b) => b > lo && b < hi).map((b) => (
        <g key={b}>
          <circle cx={X(b)} cy={zero} r="3.5" fill="var(--color-white)" />
          <text x={X(b)} y={H + 14} fontSize="10" textAnchor="middle" fill="var(--color-muted)">BE {f(b, 0)}</text>
        </g>
      ))}
      <text x="4" y={H + 14} fontSize="10" fill="var(--color-muted)">{f(lo, 0)}</text>
      <text x={W - 4} y={H + 14} fontSize="10" textAnchor="end" fill="var(--color-muted)">{f(hi, 0)}</text>
    </svg>
  );
}

export function StrategyBuilder() {
  const params = useSearchParams();
  const [tpl, setTpl] = useState<StrategyTemplate | null>(null);
  const [kind, setKind] = useState<"index" | "stock">("index");
  const [unds, setUnds] = useState<{ indices: U[]; stocks: U[] } | null>(null);
  const [u, setU] = useState(params.get("u") ?? "NIFTY");
  const [expiry, setExpiry] = useState("");
  const [lots, setLots] = useState(1);
  const [width, setWidth] = useState(2);
  const [step, setStep] = useState(10);
  const [chain, setChain] = useState<Chain | null>(null);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [legs, setLegs] = useState<Leg[]>([]);

  useEffect(() => {
    fetch("/api/options/underlyings").then((r) => r.json()).then((d) => {
      if (!d.ok) return;
      setUnds(d);
      if (d.stocks.some((s: U) => s.symbol === u) && !d.indices.some((s: U) => s.symbol === u)) setKind("stock");
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the chain for the chosen underlying / expiry.
  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ u });
    if (expiry) q.set("expiry", expiry);
    fetch(`/api/options/chain?${q}`).then(async (r) => {
      const d = await r.json();
      if (!alive) return;
      if (!r.ok) {
        setChain(null);
        setChainErr(d.error ?? "Could not load the option chain.");
      } else {
        setChain(d);
        setChainErr(null);
      }
    }).catch(() => alive && setChainErr("Could not load the option chain."));
    return () => {
      alive = false;
    };
  }, [u, expiry]);

  // Build legs from the template whenever inputs change.
  useEffect(() => {
    if (!tpl || !chain || chain.atm === null) return;
    const strikes = chain.rows.map((r) => r.strike);
    const s = strikeStep(strikes);
    const nearest = (k: number) => strikes.reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a));
    const built = tpl.legs(chain.atm, s, width).map((l) => {
      const strike = nearest(l.strike);
      const row = chain.rows.find((r) => r.strike === strike);
      const cl = l.right === "CE" ? row?.ce : row?.pe;
      return { ...l, strike, lots, premium: premiumOf(cl ?? null) ?? 0, iv: cl?.iv ?? null };
    });
    Promise.resolve().then(() => setLegs(built));
  }, [tpl, chain, width, lots]);

  const lot = chain?.lotSize ?? 1;
  const spot = chain?.spot ?? null;
  const T = chain?.expiry ? yearsToExpiry(chain.expiry) : 0;
  const summary = useMemo(() => (legs.length && spot ? summarise(legs, lot, spot) : null), [legs, lot, spot]);
  const missingPrices = legs.some((l) => !(l.premium > 0));
  const list = kind === "index" ? unds?.indices ?? [] : unds?.stocks ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside aria-label="Preset strategies" className="space-y-4">
        {VIEWS.map((v) => (
          <section key={v} className="rounded-2xl border border-line bg-panel p-3">
            <h2 className={`mb-1.5 px-1 text-xs font-semibold uppercase tracking-wider ${VIEW_TONE[v]}`}>{v}</h2>
            {STRATEGIES.filter((s) => s.view === v).map((s) => (
              <button key={s.id} onClick={() => setTpl(s)} aria-pressed={tpl?.id === s.id}
                className={`block w-full rounded-lg px-2.5 py-2 text-left text-sm ${tpl?.id === s.id ? "bg-white text-slate-950" : "hover:bg-white/5"}`}>
                <span className="block font-medium">{s.name}</span>
                <span className={`block text-[11px] leading-4 ${tpl?.id === s.id ? "text-slate-600" : "text-muted"}`}>{s.summary}</span>
              </button>
            ))}
          </section>
        ))}
      </aside>

      <div className="min-w-0 space-y-4">
        {!tpl ? (
          <div className="rounded-2xl border border-dashed border-line p-10 text-center">
            <p className="text-lg font-semibold">Choose a strategy on the left</p>
            <p className="mt-1 text-sm text-muted">Bullish, bearish, neutral or volatile. We&apos;ll build it from the current option chain and show the payoff, investment, breakevens and P&amp;L.</p>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-line bg-panel p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{tpl.name} <span className={`text-sm font-normal ${VIEW_TONE[tpl.view]}`}>· {tpl.view}</span></h2>
                <p className="text-xs text-muted">{tpl.summary}</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <fieldset className="xl:col-span-2">
                  <legend className="mb-1 text-[11px] text-muted">Apply on</legend>
                  <div className="flex rounded-lg border border-line p-0.5">
                    {(["index", "stock"] as const).map((k) => (
                      <button key={k} onClick={() => { setKind(k); setU(k === "index" ? "NIFTY" : unds?.stocks[0]?.symbol ?? "RELIANCE"); setExpiry(""); }}
                        aria-pressed={kind === k} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${kind === k ? "bg-white text-slate-950" : "text-soft"}`}>
                        {k === "index" ? "Index option" : "Stock option"}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="text-[11px] text-muted xl:col-span-2">
                  {kind === "index" ? "Index" : "Stock"}
                  <select value={u} onChange={(e) => { setU(e.target.value); setExpiry(""); }} className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-sm text-soft">
                    {list.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol} — {x.name}</option>)}
                    {!list.some((x) => x.symbol === u) && <option value={u}>{u}</option>}
                  </select>
                </label>
                <label className="text-[11px] text-muted">
                  Expiry
                  <select value={chain?.expiry ?? ""} onChange={(e) => setExpiry(e.target.value)} className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-sm text-soft">
                    {(chain?.expiries ?? []).map((e) => <option key={e} value={e}>{fd(e)}</option>)}
                  </select>
                </label>
                <label className="text-[11px] text-muted">
                  Lots
                  <input type="number" min={1} max={100} value={lots} onChange={(e) => setLots(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-right font-mono text-sm" />
                </label>
                <label className="text-[11px] text-muted">
                  Spread width (strikes)
                  <input type="number" min={1} max={20} value={width} onChange={(e) => setWidth(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-right font-mono text-sm" />
                </label>
                <label className="text-[11px] text-muted">
                  P&amp;L step (points)
                  <input type="number" min={1} max={5000} value={step} onChange={(e) => setStep(Math.max(1, Number(e.target.value) || 10))} className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-right font-mono text-sm" />
                </label>
              </div>
              <p className="mt-3 text-xs text-muted">
                {chain ? <>Spot <span className="font-mono text-soft">{f(spot)}</span> ({chain.spotSource}) · ATM {f(chain.atm, 0)} · lot {lot} · {chain.broker ? `premiums live from ${chain.broker}` : "connect a broker for live premiums (or type them in below)"}</> : chainErr ?? "Loading chain…"}
              </p>
            </section>

            <section className="overflow-hidden rounded-2xl border border-line bg-panel">
              <p className="border-b border-line px-4 py-2 text-xs font-medium">Legs (current contracts — edit strike, lots or premium if you like)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] text-muted"><tr>{["Action", "Type", "Strike", "Lots", "Premium", "IV", "Cash flow"].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {legs.map((l, i) => (
                      <tr key={i}>
                        <td className={`px-4 py-2 font-semibold ${l.side === "BUY" ? "text-up" : "text-down"}`}>{l.side}</td>
                        <td className="px-4 py-2">{l.right}</td>
                        <td className="px-4 py-2">
                          <select value={l.strike} onChange={(e) => {
                            const strike = Number(e.target.value);
                            const row = chain?.rows.find((r) => r.strike === strike);
                            const cl = l.right === "CE" ? row?.ce : row?.pe;
                            setLegs((ls) => ls.map((x, k) => (k === i ? { ...x, strike, premium: premiumOf(cl ?? null) ?? x.premium, iv: cl?.iv ?? x.iv } : x)));
                          }} className="rounded border border-line bg-ink px-1.5 py-1 font-mono text-xs">
                            {(chain?.rows ?? []).map((r) => <option key={r.strike} value={r.strike}>{r.strike}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input type="number" min={1} value={l.lots} onChange={(e) => setLegs((ls) => ls.map((x, k) => (k === i ? { ...x, lots: Math.max(1, Number(e.target.value) || 1) } : x)))} className="w-16 rounded border border-line bg-ink px-1.5 py-1 text-right font-mono text-xs" />
                        </td>
                        <td className="px-4 py-2">
                          <input type="number" min={0} step={0.05} value={l.premium} onChange={(e) => setLegs((ls) => ls.map((x, k) => (k === i ? { ...x, premium: Math.max(0, Number(e.target.value) || 0) } : x)))} className={`w-24 rounded border bg-ink px-1.5 py-1 text-right font-mono text-xs ${l.premium > 0 ? "border-line" : "border-gold"}`} />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted">{l.iv ? `${f(l.iv * 100, 1)}%` : "—"}</td>
                        <td className={`px-4 py-2 font-mono text-xs ${l.side === "BUY" ? "text-down" : "text-up"}`}>{l.side === "BUY" ? "−" : "+"}₹{Math.round(l.premium * l.lots * lot).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {missingPrices && <p className="border-t border-line bg-gold/10 px-4 py-2 text-xs text-gold">Some legs have no live premium. Connect a broker or type the premium in to see accurate figures.</p>}
            </section>

            {summary && spot && (
              <>
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    [summary.netPremium >= 0 ? "Investment (net premium paid)" : "Net premium received", rupee(Math.abs(summary.netPremium)), summary.netPremium >= 0 ? "" : "text-up"],
                    ["Max profit", rupee(summary.maxProfit), "text-up"],
                    ["Max loss", summary.maxLoss === null ? "Unlimited" : rupee(summary.maxLoss), "text-down"],
                    ["Breakeven", summary.breakevens.length ? summary.breakevens.map((b) => f(b)).join("  ·  ") : "—", ""],
                  ].map(([k, v, cls]) => (
                    <div key={k} className="rounded-xl border border-line bg-panel px-4 py-3">
                      <p className="flex items-center text-[11px] text-muted">{k}{k === "Breakeven" && <Info term="Breakeven" />}</p>
                      <p className={`mt-1 font-mono text-lg ${cls}`}>{v}</p>
                    </div>
                  ))}
                </section>
                {summary.netPremium < 0 || legs.some((l) => l.side === "SELL") ? (
                  <p className="text-xs text-muted">This strategy sells options, so your broker will block margin (often much more than the premium). Check the exact margin with your broker before trading.</p>
                ) : null}

                <section className="rounded-2xl border border-line bg-panel p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <h3 className="font-medium">Payoff</h3>
                    <span className="text-muted"><span className="font-semibold text-white">━</span> at expiry ({chain?.expiry ? fd(chain.expiry) : "—"}) · <span className="text-accent">╍</span> today (Black-Scholes)</span>
                  </div>
                  <Payoff legs={legs} lot={lot} spot={spot} T={T} breakevens={summary.breakevens} />
                </section>

                <section className="overflow-hidden rounded-2xl border border-line bg-panel">
                  <p className="border-b border-line px-4 py-2 text-xs font-medium">Profit &amp; loss — 5 steps of {step} points below and above the current price</p>
                  <table className="w-full text-sm">
                    <thead className="text-[11px] text-muted"><tr><th className="px-4 py-2 text-left font-medium">Underlying price</th><th className="px-4 py-2 text-right font-medium">Move</th><th className="px-4 py-2 text-right font-medium">P&amp;L at expiry</th><th className="px-4 py-2 text-right font-medium">P&amp;L today</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {priceLevels(spot, step, 5).reverse().map((p) => {
                        const atExp = payoffAtExpiry(legs, lot, p);
                        const today = T > 0 ? payoffNow(legs, lot, p, T, R) : atExp;
                        const isSpot = Math.abs(p - spot) < 1e-6;
                        return (
                          <tr key={p} className={isSpot ? "bg-gold/10" : ""}>
                            <td className="px-4 py-1.5 font-mono">{f(p)}{isSpot && <span className="ml-2 font-sans text-[10px] text-gold">current</span>}</td>
                            <td className="px-4 py-1.5 text-right font-mono text-muted">{p === spot ? "0" : `${p > spot ? "+" : "−"}${f(Math.abs(p - spot), 0)}`}</td>
                            <td className={`px-4 py-1.5 text-right font-mono ${atExp >= 0 ? "text-up" : "text-down"}`}>{rupee(atExp)}</td>
                            <td className={`px-4 py-1.5 text-right font-mono ${today >= 0 ? "text-up" : "text-down"}`}>{rupee(today)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              </>
            )}
            <p className="text-xs text-muted">
              Educational tool, not a recommendation. Figures exclude brokerage, taxes and slippage. <Link href={`/options?u=${encodeURIComponent(u)}`} className="text-accent hover:underline">Open {u} option chain →</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
