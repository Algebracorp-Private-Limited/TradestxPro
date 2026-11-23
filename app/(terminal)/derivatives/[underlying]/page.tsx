import type { Metadata } from "next";
import { AiAnalysis } from "@/components/ai-analysis";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrument, getUnderlying } from "@/lib/market-data";
import { getSessionUser } from "@/lib/auth";
import { getQuotes, type Quote } from "@/lib/brokers/quotes";
import { isVaultConfigured } from "@/lib/brokers/vault";
import { UNDERLYING_INDEX } from "@/lib/options/chain";
import { AutoRefresh } from "@/components/auto-refresh";

type Props = {
  params: Promise<{ underlying: string }>;
  searchParams: Promise<{ exchange?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeURIComponent((await params).underlying).toUpperCase()} F&O` };
}

const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fi = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(2) + " L" : Math.round(v).toLocaleString("en-IN"));
const tone = (v: number | null | undefined) => (v === null || v === undefined ? "text-muted" : v >= 0 ? "text-up" : "text-down");

export default async function UnderlyingPage({ params, searchParams }: Props) {
  const { underlying } = await params;
  const { exchange } = await searchParams;
  const d = await getUnderlying(decodeURIComponent(underlying), undefined, exchange);
  if (!d) notFound();
  const user = (await getSessionUser())!;
  const idxKey = UNDERLYING_INDEX[d.underlying];
  const cash = idxKey ? null : await getInstrument(d.exchange === "NFO" ? "NSE" : "BSE", d.underlying);

  // Live prices: the underlying plus every futures contract.
  let quotes: Record<string, Quote> = {};
  let broker: string | null = null;
  let error: string | undefined;
  if (isVaultConfigured()) {
    const reqs = [
      idxKey
        ? { key: "spot", kind: "index" as const, symbol: idxKey }
        : { key: "spot", kind: "stock" as const, symbol: d.underlying, token: cash?.token, breezeCode: cash?.breezeCode },
      ...d.futures.map((fu) => ({ key: fu.token, kind: "future" as const, symbol: d.underlying, token: fu.token, breezeCode: fu.breezeCode, fut: { exchange: d.exchange, expiry: fu.expiry } })),
    ];
    const r = await getQuotes(user.id, reqs).catch(() => null);
    if (r) {
      quotes = r.quotes;
      broker = r.brokerName;
      error = r.error;
    }
  }
  const spot = quotes.spot?.ltp ?? null;
  const optionCount = d.chain.length;

  return (
    <>
      <AutoRefresh seconds={20} enabled={Boolean(broker)} />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/derivatives" className="rounded-md border border-line px-2.5 py-1 hover:bg-white/5 hover:text-white">← Back to F&amp;O</Link>
        <span aria-hidden>/</span>
        <span>{d.underlying}</span>
      </nav>

      <AiAnalysis scope="options" target={d.underlying} />

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-3xl font-semibold tracking-tight">{d.underlying}</h1>
            <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-soft">{d.exchange}</span>
          </div>
          <p className="mt-1 text-soft">{d.name}</p>
          <p className="mt-2 font-mono">
            <span className="text-xl">{f(spot)}</span>{" "}
            {quotes.spot && <span className={`text-sm ${tone(quotes.spot.changePct)}`}>{quotes.spot.changePct !== null ? `${quotes.spot.changePct >= 0 ? "+" : ""}${f(quotes.spot.changePct)}%` : ""}</span>}
            <span className="ml-2 font-sans text-xs text-muted">{broker ? `Spot · live from ${broker}` : "Connect a broker for live prices"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/options?u=${encodeURIComponent(d.underlying)}&exchange=${d.exchange}`} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200">Open live option chain →</Link>
          <Link href={`/charts?symbol=${encodeURIComponent(idxKey ? `${d.exchange === "BFO" ? "BSEIDX" : "NSEIDX"}:${idxKey}` : `NSE:${d.underlying}`)}`} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/5">Chart</Link>
          {cash && <Link href={`/instrument/${cash.exchange}/${cash.symbol}`} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/5">Stock page</Link>}
        </div>
      </section>
      {error && <p className="text-xs text-gold">{error}</p>}

      <section aria-labelledby="fut" className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 id="fut" className="text-sm font-semibold">Futures contracts <span className="font-normal text-muted">({d.futures.length})</span></h2>
          <span className="text-xs text-muted">Basis = futures price − spot. Positive basis (premium) is normal; it shrinks towards expiry.</span>
        </div>
        {d.futures.length === 0 ? <p className="p-5 text-sm text-muted">No futures listed for {d.underlying}.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  {["Expiry", "LTP", "Change", "OI", "Volume", "Basis", "Basis %", "Lot size", ""].map((h, i) => (
                    <th key={h + i} scope="col" className={`px-5 py-2 font-medium ${i > 0 && i < 8 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.futures.map((fu) => {
                  const q = quotes[fu.token];
                  const basis = q && spot ? q.ltp - spot : null;
                  return (
                    <tr key={fu.token}>
                      <td className="px-5 py-2.5">{fmtDate(fu.expiry)}</td>
                      <td className="px-5 py-2.5 text-right font-mono font-semibold">{f(q?.ltp)}</td>
                      <td className={`px-5 py-2.5 text-right font-mono ${tone(q?.change)}`}>{q?.change !== null && q?.change !== undefined ? `${q.change >= 0 ? "+" : ""}${f(q.change)} (${f(q.changePct)}%)` : "—"}</td>
                      <td className="px-5 py-2.5 text-right font-mono">{fi(q?.oi)}</td>
                      <td className="px-5 py-2.5 text-right font-mono text-muted">{fi(q?.volume)}</td>
                      <td className={`px-5 py-2.5 text-right font-mono ${tone(basis)}`}>{f(basis)}</td>
                      <td className={`px-5 py-2.5 text-right font-mono ${tone(basis)}`}>{basis !== null && spot ? `${f((basis / spot) * 100)}%` : "—"}</td>
                      <td className="px-5 py-2.5 text-right font-mono">{fu.lotSize}</td>
                      <td className="px-5 py-2.5 text-right"><Link href={`/charts?symbol=${d.exchange}:${fu.token}&tf=15m`} className="text-xs text-accent hover:underline">Chart</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="opt" className="rounded-2xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="opt" className="text-sm font-semibold">Options contracts</h2>
            <p className="mt-1 text-sm text-muted">
              {d.optionExpiries.length} expiries · {optionCount} strikes in the nearest expiry ({d.selectedExpiry ? fmtDate(d.selectedExpiry) : "—"}). Calls (CE) and puts (PE) with live prices, OI, IV and Greeks are on the option chain.
            </p>
          </div>
          <Link href={`/options?u=${encodeURIComponent(d.underlying)}&exchange=${d.exchange}`} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/5">View option chain →</Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {d.optionExpiries.map((e) => (
            <Link key={e} href={`/options?u=${encodeURIComponent(d.underlying)}&exchange=${d.exchange}&expiry=${e}`} className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-soft hover:bg-white/10">{fmtDate(e)}</Link>
          ))}
        </div>
      </section>

      <p className="text-xs text-muted">Contract list from the exchange master, refreshed daily. {broker ? `Prices live from ${broker}, refreshed every 20 s.` : ""} Research tool only, not investment advice.</p>
    </>
  );
}
