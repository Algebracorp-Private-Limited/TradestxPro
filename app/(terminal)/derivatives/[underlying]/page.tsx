import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrument, getUnderlying } from "@/lib/market-data";
import { Dash, FeedBanner } from "@/components/feed-banner";

type Props = {
  params: Promise<{ underlying: string }>;
  searchParams: Promise<{ expiry?: string; exchange?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${decodeURIComponent((await params).underlying).toUpperCase()} F&O` };
}

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const fmtNum = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default async function UnderlyingPage({ params, searchParams }: Props) {
  const { underlying } = await params;
  const { expiry, exchange } = await searchParams;
  const d = await getUnderlying(decodeURIComponent(underlying), expiry, exchange);
  if (!d) notFound();
  const cash = await getInstrument(d.exchange === "NFO" ? "NSE" : "BSE", d.underlying);
  const qs = (e: string) => `?exchange=${d.exchange}&expiry=${e}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/derivatives" className="hover:text-white">F&amp;O Contracts</Link> <span aria-hidden>/</span> {d.underlying}
      </nav>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-3xl font-semibold tracking-tight">{d.underlying}</h1>
            <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-soft">{d.exchange}</span>
          </div>
          <p className="mt-1 text-soft">{d.name}</p>
        </div>
        {cash && (
          <Link href={`/instrument/${cash.exchange}/${cash.symbol}`} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/5">
            View cash instrument →
          </Link>
        )}
      </section>

      <FeedBanner compact />

      {d.futures.length > 0 && (
        <section aria-labelledby="fut" className="overflow-hidden rounded-2xl border border-line bg-panel">
          <h2 id="fut" className="border-b border-line px-5 py-3 text-sm font-medium text-soft">Futures</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium">Expiry</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Lot size</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Tick</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">LTP</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">OI</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Basis</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Token</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.futures.map((f) => (
                  <tr key={f.token}>
                    <td className="px-5 py-2.5">{fmtDate(f.expiry)}</td>
                    <td className="px-5 py-2.5 text-right font-mono">{f.lotSize}</td>
                    <td className="px-5 py-2.5 text-right font-mono">{f.tickSize ?? "—"}</td>
                    <td className="px-5 py-2.5 text-right"><Dash /></td>
                    <td className="px-5 py-2.5 text-right"><Dash /></td>
                    <td className="px-5 py-2.5 text-right"><Dash /></td>
                    <td className="px-5 py-2.5 text-right font-mono text-muted">{f.token}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.optionExpiries.length > 0 && d.selectedExpiry && (
        <section aria-labelledby="chain" className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <h2 id="chain" className="text-sm font-medium text-soft">
              Option chain · {fmtDate(d.selectedExpiry)} · {d.chain.length} strikes · lot {d.chain[0]?.ce?.lotSize ?? d.chain[0]?.pe?.lotSize}
            </h2>
          </div>
          <nav aria-label="Expiries" className="flex gap-1.5 overflow-x-auto border-b border-line px-5 py-2.5">
            {d.optionExpiries.map((e) => (
              <Link
                key={e}
                href={qs(e)}
                aria-current={e === d.selectedExpiry ? "true" : undefined}
                className={`shrink-0 rounded-md px-2.5 py-1 text-xs ${e === d.selectedExpiry ? "bg-white text-slate-950" : "bg-white/5 text-soft hover:bg-white/10"}`}
              >
                {fmtDate(e)}
              </Link>
            ))}
          </nav>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-panel text-xs text-muted">
                <tr>
                  <th colSpan={4} scope="colgroup" className="border-b border-line px-3 py-2 text-center font-medium text-up">CALLS</th>
                  <th rowSpan={2} scope="col" className="border-b border-line bg-panel-2 px-3 py-2 text-center font-medium text-white">Strike</th>
                  <th colSpan={4} scope="colgroup" className="border-b border-line px-3 py-2 text-center font-medium text-down">PUTS</th>
                </tr>
                <tr className="text-right">
                  {["OI", "IV", "Δ", "LTP"].map((h) => <th key={"c" + h} scope="col" className="border-b border-line px-3 py-1.5 font-medium">{h}</th>)}
                  {["LTP", "Δ", "IV", "OI"].map((h) => <th key={"p" + h} scope="col" className="border-b border-line px-3 py-1.5 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.chain.map((row) => (
                  <tr key={row.strike} className="text-right">
                    {[0, 1, 2, 3].map((i) => <td key={"c" + i} className="px-3 py-1.5">{row.ce ? <Dash /> : <span className="text-muted/40">·</span>}</td>)}
                    <td className="bg-panel-2 px-3 py-1.5 text-center font-mono font-medium">{fmtNum(row.strike)}</td>
                    {[0, 1, 2, 3].map((i) => <td key={"p" + i} className="px-3 py-1.5">{row.pe ? <Dash /> : <span className="text-muted/40">·</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-muted">
        Contract metadata from the ICICI Direct security master, refreshed daily. Prices, OI and Greeks arrive with the market data feed. Not investment advice.
      </p>
    </>
  );
}
