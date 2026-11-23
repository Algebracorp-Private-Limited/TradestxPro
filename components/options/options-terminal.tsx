"use client";

import { whenVisible } from "@/lib/client/visible";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info } from "./info";

type Leg = {
  token: string; ltp: number | null; change: number | null; changePct: number | null; bid: number | null; bidQty: number | null; ask: number | null; askQty: number | null;
  oi: number | null; oiChange: number | null; volume: number | null; iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; rho: number | null;
  greeksSource: "broker" | "model" | null;
};
type Row = { strike: number; ce: Leg | null; pe: Leg | null };
type Chain = {
  underlying: string; name: string; exchange: "NFO" | "BFO"; kind: "index" | "stock"; expiries: string[]; expiry: string | null; lotSize: number | null;
  spot: number | null; spotSource: string; broker: string | null; rows: Row[]; pcr: number | null; maxPain: number | null; atm: number | null; daysToExpiry: number | null; error?: string; asOf: string;
};
type U = { symbol: string; name: string; exchange: string; hasMembers?: boolean };
type Sel = { strike: number; side: "CE" | "PE" };

const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fi = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e7 ? (v / 1e7).toFixed(2) + "Cr" : Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(2) + "L" : Math.round(v).toLocaleString("en-IN"));
const fd = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
const tone = (v: number | null | undefined) => (v === null || v === undefined ? "text-muted" : v >= 0 ? "text-up" : "text-down");

// ---------------- Left: underlyings ----------------
function Underlyings({ current, onPick }: { current: string; onPick: (u: U) => void }) {
  const [data, setData] = useState<{ indices: U[]; stocks: U[] } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, { stocks: U[]; withoutOptions: number } | "loading">>({});
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/options/underlyings").then((r) => r.json()).then((d) => d.ok && setData(d)).catch(() => {});
  }, []);

  const expand = (sym: string) => {
    setExpanded((e) => (e === sym ? null : sym));
    if (!members[sym]) {
      setMembers((m) => ({ ...m, [sym]: "loading" }));
      fetch(`/api/options/underlyings?index=${encodeURIComponent(sym)}`).then((r) => r.json()).then((d) => setMembers((m) => ({ ...m, [sym]: d.ok ? d : { stocks: [], withoutOptions: 0 } })));
    }
  };

  const stocks = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (data?.stocks ?? []).filter((s) => !t || s.symbol.includes(t) || s.name.toUpperCase().includes(t));
  }, [data, q]);

  const item = (u: U, indent = false) => (
    <button
      key={u.symbol + (indent ? "-m" : "")}
      onClick={() => onPick(u)}
      aria-current={current === u.symbol ? "true" : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${indent ? "pl-5" : ""} ${current === u.symbol ? "bg-accent/15 text-accent" : "text-soft hover:bg-white/5"}`}
      title={u.name}
    >
      <span className="truncate font-mono">{u.symbol}</span>
      <span className="text-[9px] text-muted">{u.exchange}</span>
    </button>
  );

  return (
    <aside aria-label="Option underlyings" className="flex min-h-0 flex-col border-r border-line bg-panel">
      <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Indices</p>
      <ul className="px-1.5">
        {(data?.indices ?? []).map((u) => {
          const m = members[u.symbol];
          return (
            <li key={u.symbol}>
              <div className="flex items-center" onDoubleClick={() => u.hasMembers && expand(u.symbol)}>
                {u.hasMembers ? (
                  <button onClick={() => expand(u.symbol)} aria-label={`${expanded === u.symbol ? "Hide" : "Show"} ${u.symbol} stocks`} aria-expanded={expanded === u.symbol} className="w-5 text-xs text-muted hover:text-white">
                    {expanded === u.symbol ? "▾" : "▸"}
                  </button>
                ) : <span className="w-5" />}
                <div className="min-w-0 flex-1">{item(u)}</div>
              </div>
              {expanded === u.symbol && (
                <div className="mb-1 border-l border-line pl-1 ml-2.5">
                  {m === "loading" || !m ? <p className="px-3 py-1 text-[11px] text-muted">Loading constituents…</p> : (
                    <>
                      {m.stocks.map((s) => item(s, true))}
                      {m.withoutOptions > 0 && <p className="px-3 py-1 text-[10px] text-muted">{m.withoutOptions} member{m.withoutOptions > 1 ? "s have" : " has"} no listed options</p>}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Stock options ({data?.stocks.length ?? 0})</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter stocks" aria-label="Filter option stocks" className="mx-2 mb-1 rounded-md border border-line bg-ink px-2 py-1 text-xs" />
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">{stocks.map((s) => item(s))}</div>
      <p className="border-t border-line px-3 py-2 text-[10px] leading-4 text-muted">Click an index for its chain. Double-click (or ▸) to list its stocks.</p>
    </aside>
  );
}

// ---------------- Right: contract detail ----------------
function Detail({ chain, sel, onSelect }: { chain: Chain; sel: Sel | null; onSelect: (s: Sel) => void }) {
  const row = sel ? chain.rows.find((r) => r.strike === sel.strike) : null;
  const leg = row && sel ? (sel.side === "CE" ? row.ce : row.pe) : null;
  const [depth, setDepth] = useState<{ bids: { price: number; qty: number }[]; asks: { price: number; qty: number }[]; source: string } | null | "loading">(null);
  const [depthErr, setDepthErr] = useState<string | null>(null);

  useEffect(() => {
    if (!leg || !chain.broker) return;
    let alive = true;
    Promise.resolve().then(() => alive && setDepth("loading"));
    fetch(`/api/options/depth?token=${leg.token}&exchange=${chain.exchange}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDepth(d.depth ?? null);
        setDepthErr(d.error ?? null);
      })
      .catch(() => alive && setDepth(null));
    return () => {
      alive = false;
    };
  }, [leg?.token, chain.broker, chain.exchange]); // eslint-disable-line react-hooks/exhaustive-deps

  const top = useMemo(() => {
    const all = chain.rows.flatMap((r) => [
      r.ce ? { strike: r.strike, side: "CE" as const, vol: r.ce.volume ?? 0, ltp: r.ce.ltp, oi: r.ce.oi } : null,
      r.pe ? { strike: r.strike, side: "PE" as const, vol: r.pe.volume ?? 0, ltp: r.pe.ltp, oi: r.pe.oi } : null,
    ]).filter((x): x is NonNullable<typeof x> => Boolean(x && x.vol > 0));
    return all.sort((a, b) => b.vol - a.vol).slice(0, 6);
  }, [chain.rows]);

  if (!leg || !row || !sel) {
    return (
      <aside className="space-y-4 border-l border-line bg-panel p-4 text-sm">
        <p className="text-muted">Click any call or put price in the chain to see its details, Greeks and market depth.</p>
        <TopTraded top={top} onSelect={onSelect} />
      </aside>
    );
  }

  const spot = chain.spot;
  const intrinsic = spot !== null ? Math.max(0, sel.side === "CE" ? spot - row.strike : row.strike - spot) : null;
  const timeValue = leg.ltp !== null && intrinsic !== null ? leg.ltp - intrinsic : null;
  const breakeven = leg.ltp !== null ? (sel.side === "CE" ? row.strike + leg.ltp : row.strike - leg.ltp) : null;
  const mid = leg.bid && leg.ask ? (leg.bid + leg.ask) / 2 : null;
  const spreadPct = leg.bid && leg.ask && mid ? ((leg.ask - leg.bid) / mid) * 100 : null;
  const title = `${chain.underlying} ${chain.expiry ? fd(chain.expiry) : ""} ${row.strike} ${sel.side}`;
  const stat = (label: string, value: string, term?: string, cls = "") => (
    <div className="flex items-center justify-between gap-2 py-1">
      <dt className="flex items-center text-muted">{label}{term && <Info term={term} place="left" />}</dt>
      <dd className={`font-mono ${cls}`}>{value}</dd>
    </div>
  );

  return (
    <aside aria-label="Contract details" className="min-h-0 space-y-4 overflow-auto border-l border-line bg-panel p-4 text-xs">
      <div>
        <p className="font-mono text-sm font-semibold">{title}</p>
        <div className="mt-1 flex items-baseline gap-2 font-mono">
          <span className="text-2xl font-semibold">{f(leg.ltp)}</span>
          <span className={tone(leg.change)}>{leg.change !== null ? `${leg.change >= 0 ? "+" : ""}${f(leg.change)} (${f(leg.changePct)}%)` : ""}</span>
        </div>
        <p className="mt-1 text-muted">Underlying <span className="font-mono text-soft">{f(spot)}</span> · {chain.spotSource}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={`/charts?symbol=${chain.exchange}:${leg.token}&tf=5m`} className="rounded-md border border-line px-2 py-1 hover:bg-white/5">📈 Contract chart</Link>
          <Link href={`/charts?symbol=${encodeURIComponent(chain.kind === "index" ? (chain.exchange === "BFO" ? "BSEIDX:" : "NSEIDX:") + underlyingIndexKey(chain.underlying) : "NSE:" + chain.underlying)}`} className="rounded-md border border-line px-2 py-1 hover:bg-white/5">Underlying chart</Link>
        </div>
      </div>

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Bid / Ask</h3>
        <dl className="divide-y divide-line">
          {stat("Bid", `${f(leg.bid)} × ${fi(leg.bidQty)}`, "Bid", "text-up")}
          {stat("Ask", `${f(leg.ask)} × ${fi(leg.askQty)}`, "Ask", "text-down")}
          {stat("Spread", spreadPct !== null ? `${f(leg.ask! - leg.bid!)} (${f(spreadPct)}%)` : "—", "Spread", spreadPct !== null && spreadPct > 5 ? "text-gold" : "")}
        </dl>
      </section>

      <section>
        <h3 className="mb-1 flex items-center text-[11px] font-semibold uppercase tracking-wider text-muted">Market depth — top 5</h3>
        {!chain.broker ? <p className="text-muted">Connect a broker for depth.</p> : depth === "loading" ? <p className="text-muted">Loading…</p> : !depth ? <p className="text-muted">{depthErr ?? "Depth not available."}</p> : (
          <>
            <table className="w-full font-mono">
              <thead className="text-[10px] text-muted"><tr><th className="text-left font-normal">Bid qty</th><th className="text-right font-normal">Bid</th><th className="text-right font-normal">Ask</th><th className="text-right font-normal">Ask qty</th></tr></thead>
              <tbody>
                {Array.from({ length: Math.max(depth.bids.length, depth.asks.length, 1) }, (_, i) => (
                  <tr key={i}>
                    <td className="text-left text-muted">{fi(depth.bids[i]?.qty)}</td>
                    <td className="text-right text-up">{f(depth.bids[i]?.price)}</td>
                    <td className="text-right text-down">{f(depth.asks[i]?.price)}</td>
                    <td className="text-right text-muted">{fi(depth.asks[i]?.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-muted">{depth.source}</p>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Greeks {leg.greeksSource === "model" && <span className="normal-case tracking-normal">(Black-Scholes, r = 6.5%)</span>}
        </h3>
        <dl className="divide-y divide-line">
          {stat("IV", leg.iv !== null ? `${f(leg.iv * 100)}%` : "—", "IV")}
          {stat("Delta", f(leg.delta, 3), "Delta")}
          {stat("Gamma", f(leg.gamma, 5), "Gamma")}
          {stat("Theta / day", f(leg.theta), "Theta")}
          {stat("Vega / 1%", f(leg.vega), "Vega")}
          {stat("Rho / 1%", f(leg.rho), "Rho")}
        </dl>
      </section>

      <section>
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Contract</h3>
        <dl className="divide-y divide-line">
          {stat("Open interest", fi(leg.oi), "OI")}
          {stat("OI change", fi(leg.oiChange), "OI Chg", tone(leg.oiChange))}
          {stat("Volume", fi(leg.volume), "Volume")}
          {stat("Intrinsic", f(intrinsic), "Intrinsic")}
          {stat("Time value", f(timeValue), "Time value")}
          {stat("Breakeven", f(breakeven), "Breakeven")}
          {stat("Lot size", fi(chain.lotSize), "Lot")}
          {stat("Premium / lot", leg.ltp !== null && chain.lotSize ? `₹${fi(leg.ltp * chain.lotSize)}` : "—")}
          {stat("Days to expiry", chain.daysToExpiry !== null ? String(chain.daysToExpiry) : "—", "DTE")}
        </dl>
      </section>

      <TopTraded top={top} onSelect={onSelect} />
    </aside>
  );
}

function TopTraded({ top, onSelect }: { top: { strike: number; side: "CE" | "PE"; vol: number; ltp: number | null; oi: number | null }[]; onSelect: (s: Sel) => void }) {
  return (
    <section>
      <h3 className="mb-1 flex items-center text-[11px] font-semibold uppercase tracking-wider text-muted">Most traded contracts <Info term="Volume" place="left" /></h3>
      {top.length === 0 ? <p className="text-muted">Volume appears once a broker supplies live data.</p> : (
        <table className="w-full font-mono text-xs">
          <thead className="text-[10px] text-muted"><tr><th className="text-left font-normal">Contract</th><th className="text-right font-normal">LTP</th><th className="text-right font-normal">Volume</th></tr></thead>
          <tbody>
            {top.map((t) => (
              <tr key={`${t.strike}${t.side}`} className="cursor-pointer hover:bg-white/5" onClick={() => onSelect({ strike: t.strike, side: t.side })}>
                <td className={t.side === "CE" ? "text-up" : "text-down"}>{t.strike} {t.side}</td>
                <td className="text-right">{f(t.ltp)}</td>
                <td className="text-right text-muted">{fi(t.vol)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const IDX_KEYS: Record<string, string> = { NIFTY: "NIFTY 50", BANKNIFTY: "NIFTY BANK", FINNIFTY: "NIFTY FINANCIAL SERVICES", MIDCPNIFTY: "NIFTY MIDCAP SELECT", NIFTYNXT50: "NIFTY NEXT 50", SENSEX: "SENSEX", BANKEX: "BANKEX" };
const underlyingIndexKey = (u: string) => IDX_KEYS[u] ?? u;

// ---------------- Centre: chain ----------------
export function OptionsTerminal() {
  const router = useRouter();
  const params = useSearchParams();
  const u = params.get("u") ?? "NIFTY";
  const expiry = params.get("expiry") ?? "";
  const exchange = params.get("exchange") ?? "";
  const [chain, setChain] = useState<Chain | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Sel | null>(null);
  const [range, setRange] = useState(15);
  const atmRef = useRef<HTMLTableRowElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const q = new URLSearchParams({ u });
      if (expiry) q.set("expiry", expiry);
      if (exchange) q.set("exchange", exchange);
      const r = await fetch(`/api/options/chain?${q}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setChain(d);
      setErr(null);
      if (d.broker) timer.current = setTimeout(() => whenVisible(() => loadRef.current()), 15_000);
    } catch (e) {
      setErr((e as Error).message || "Could not load the option chain.");
    } finally {
      setLoading(false);
    }
  }, [u, expiry, exchange]);

  useEffect(() => {
    loadRef.current = load;
    Promise.resolve().then(() => {
      setLoading(true);
      setSel(null);
      load();
    });
    return () => clearTimeout(timer.current);
  }, [load]);

  useEffect(() => {
    atmRef.current?.scrollIntoView({ block: "center" });
  }, [chain?.underlying, chain?.expiry, chain?.atm]);

  const nav = (next: { u?: string; expiry?: string; exchange?: string }) => {
    const q = new URLSearchParams({ u: next.u ?? u });
    const ex = next.expiry ?? (next.u ? "" : expiry);
    if (ex) q.set("expiry", ex);
    const xc = next.exchange ?? (next.u ? "" : exchange);
    if (xc) q.set("exchange", xc);
    router.replace(`/options?${q}`);
  };

  const rows = useMemo(() => {
    if (!chain) return [];
    const i = chain.atm !== null ? chain.rows.findIndex((r) => r.strike === chain.atm) : -1;
    if (i < 0 || range >= 999) return chain.rows;
    return chain.rows.slice(Math.max(0, i - range), i + range + 1);
  }, [chain, range]);
  const maxOi = useMemo(() => Math.max(1, ...rows.flatMap((r) => [r.ce?.oi ?? 0, r.pe?.oi ?? 0])), [rows]);

  const cell = (leg: Leg | null, side: "CE" | "PE", strike: number, itm: boolean) => {
    const picked = sel?.strike === strike && sel.side === side;
    const cls = `px-2 py-1.5 text-right font-mono cursor-pointer ${itm ? (side === "CE" ? "bg-up/[0.06]" : "bg-down/[0.06]") : ""} ${picked ? "outline outline-1 outline-accent" : ""}`;
    const click = () => leg && setSel({ strike, side });
    if (!leg) return Array.from({ length: 6 }, (_, k) => <td key={side + k} className="px-2 py-1.5 text-center text-muted/40">·</td>);
    const oiBar = (
      <span className="relative block">
        <span aria-hidden className={`absolute inset-y-0 ${side === "CE" ? "right-0 bg-up/20" : "left-0 bg-down/20"}`} style={{ width: `${((leg.oi ?? 0) / maxOi) * 100}%` }} />
        <span className="relative">{fi(leg.oi)}</span>
      </span>
    );
    const cellsCE = [
      <td key="oi" onClick={click} className={cls}>{oiBar}</td>,
      <td key="oic" onClick={click} className={`${cls} ${tone(leg.oiChange)}`}>{fi(leg.oiChange)}</td>,
      <td key="vol" onClick={click} className={`${cls} text-muted`}>{fi(leg.volume)}</td>,
      <td key="iv" onClick={click} className={cls}>{leg.iv !== null ? f(leg.iv * 100, 1) : "—"}</td>,
      <td key="d" onClick={click} className={`${cls} text-muted`}>{f(leg.delta, 2)}</td>,
      <td key="ltp" onClick={click} className={`${cls} font-semibold`}>
        {f(leg.ltp)}
        <span className={`block text-[10px] font-normal ${tone(leg.changePct)}`}>{leg.changePct !== null ? `${leg.changePct >= 0 ? "+" : ""}${f(leg.changePct, 1)}%` : ""}</span>
      </td>,
    ];
    return side === "CE" ? cellsCE : [...cellsCE].reverse();
  };

  return (
    <div className="-m-4 grid h-[calc(100dvh-53px-64px)] grid-cols-1 sm:-m-6 lg:h-[calc(100dvh-53px)] lg:grid-cols-[210px_minmax(0,1fr)_300px]">
      <div className="hidden min-h-0 lg:flex lg:flex-col"><Underlyings current={u} onPick={(x) => nav({ u: x.symbol, exchange: x.exchange })} /></div>

      <section aria-label="Option chain" className="flex min-h-0 min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-3 py-2">
          <div>
            <h1 className="font-mono text-lg font-semibold leading-tight">{chain?.underlying ?? u}</h1>
            <p className="text-[11px] text-muted">{chain?.name}</p>
          </div>
          <div className="font-mono">
            <span className="text-lg">{f(chain?.spot)}</span>
            <span className="ml-1.5 text-[10px] text-muted">{chain?.spotSource}</span>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center gap-1"><dt className="flex items-center text-muted">PCR<Info term="PCR" place="bottom" /></dt><dd className="font-mono">{f(chain?.pcr)}</dd></div>
            <div className="flex items-center gap-1"><dt className="flex items-center text-muted">Max pain<Info term="Max pain" place="bottom" /></dt><dd className="font-mono">{f(chain?.maxPain, 0)}</dd></div>
            <div className="flex items-center gap-1"><dt className="flex items-center text-muted">ATM<Info term="ATM" place="bottom" /></dt><dd className="font-mono">{f(chain?.atm, 0)}</dd></div>
            <div className="flex items-center gap-1"><dt className="flex items-center text-muted">Lot<Info term="Lot" place="bottom" /></dt><dd className="font-mono">{chain?.lotSize ?? "—"}</dd></div>
            <div className="flex items-center gap-1"><dt className="flex items-center text-muted">DTE<Info term="DTE" place="bottom" /></dt><dd className="font-mono">{chain?.daysToExpiry ?? "—"}</dd></div>
          </dl>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${chain?.broker ? "bg-up/15 text-up" : "bg-gold/15 text-gold"}`}>
            {chain?.broker ? `Live · ${chain.broker} · 15s` : <Link href="/brokers" className="underline">Connect a broker for live prices</Link>}
          </span>
        </div>

        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <label className="lg:hidden">
            <span className="sr-only">Underlying</span>
            <input defaultValue={u} onKeyDown={(e) => e.key === "Enter" && nav({ u: (e.target as HTMLInputElement).value.toUpperCase() })} className="w-28 rounded-md border border-line bg-ink px-2 py-1 font-mono text-xs" aria-label="Underlying symbol" />
          </label>
          <nav aria-label="Expiries" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {chain?.expiries.map((e) => (
              <button key={e} onClick={() => nav({ expiry: e })} aria-current={e === chain.expiry ? "true" : undefined}
                className={`shrink-0 rounded-md px-2 py-1 text-xs ${e === chain.expiry ? "bg-white text-slate-950" : "bg-white/5 text-soft hover:bg-white/10"}`}>
                {fd(e)}
              </button>
            ))}
          </nav>
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Strikes shown" className="rounded-md border border-line bg-ink px-2 py-1 text-xs text-soft">
            <option value={10}>±10 strikes</option>
            <option value={15}>±15 strikes</option>
            <option value={30}>±30 strikes</option>
            <option value={999}>All strikes</option>
          </select>
        </div>

        {(err || chain?.error) && <p role="alert" className="border-b border-line bg-gold/10 px-3 py-1.5 text-xs text-gold">{err ?? chain?.error}</p>}

        <div className={`min-h-0 flex-1 overflow-auto ${loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-10 bg-panel text-[10px] text-muted">
              <tr>
                <th colSpan={6} className="border-b border-line py-1 text-center font-semibold text-up">CALLS</th>
                <th rowSpan={2} className="border-b border-line bg-panel-2 px-2 text-center font-semibold text-white">Strike</th>
                <th colSpan={6} className="border-b border-line py-1 text-center font-semibold text-down">PUTS</th>
              </tr>
              <tr className="text-right">
                {[["OI", "OI"], ["OI Chg", "OI Chg"], ["Vol", "Volume"], ["IV %", "IV"], ["Δ", "Delta"], ["LTP", "LTP"]].map(([h, t]) => <th key={"c" + h} className="whitespace-nowrap border-b border-line px-2 py-1 font-medium">{h}<Info term={t} place="bottom" /></th>)}
                {[["LTP", "LTP"], ["Δ", "Delta"], ["IV %", "IV"], ["Vol", "Volume"], ["OI Chg", "OI Chg"], ["OI", "OI"]].map(([h, t]) => <th key={"p" + h} className="whitespace-nowrap border-b border-line px-2 py-1 font-medium">{h}<Info term={t} place="bottom" /></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const isAtm = chain?.atm === r.strike;
                const spot = chain?.spot ?? NaN;
                return (
                  <tr key={r.strike} ref={isAtm ? atmRef : undefined} className={isAtm ? "border-y-2 border-accent/50" : ""}>
                    {cell(r.ce, "CE", r.strike, r.strike < spot)}
                    <td className={`bg-panel-2 px-2 py-1.5 text-center font-mono font-semibold ${isAtm ? "text-accent" : ""}`}>{r.strike.toLocaleString("en-IN")}</td>
                    {cell(r.pe, "PE", r.strike, r.strike > spot)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && chain && rows.length === 0 && <p className="p-6 text-center text-sm text-muted">No strikes for this expiry.</p>}
        </div>
        <p className="border-t border-line bg-panel px-3 py-1 text-[10px] text-muted">
          Shaded cells are in the money. Greeks: from your broker when supplied, otherwise Black-Scholes from the option&apos;s price (r = 6.5%). Research tool only, not investment advice.
        </p>
      </section>

      <div className="hidden min-h-0 lg:block">{chain && <Detail chain={chain} sel={sel} onSelect={setSel} />}</div>
      {chain && sel && (
        <div className="fixed inset-x-0 bottom-16 z-30 max-h-[60vh] overflow-auto border-t border-line bg-panel shadow-2xl lg:hidden">
          <button onClick={() => setSel(null)} className="sticky top-0 w-full bg-panel py-1 text-center text-xs text-muted">Close ✕</button>
          <Detail chain={chain} sel={sel} onSelect={setSel} />
        </div>
      )}
    </div>
  );
}
