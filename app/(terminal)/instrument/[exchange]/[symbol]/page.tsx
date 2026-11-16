import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrument } from "@/lib/market-data";
import { AddToWatchlist } from "@/components/add-to-watchlist";
import { Dash, FeedBanner } from "@/components/feed-banner";

type Props = { params: Promise<{ exchange: string; symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { exchange, symbol } = await params;
  return { title: `${decodeURIComponent(symbol).toUpperCase()} · ${exchange.toUpperCase()}` };
}

export default async function InstrumentPage({ params }: Props) {
  const { exchange, symbol } = await params;
  const inst = await getInstrument(exchange, decodeURIComponent(symbol));
  if (!inst) notFound();
  const other = await getInstrument(inst.exchange === "NSE" ? "BSE" : "NSE", inst.symbol);

  const facts: [string, React.ReactNode][] = [
    ["Exchange", inst.exchange],
    ["Series", inst.series ?? "—"],
    ["ISIN", <span key="isin" className="font-mono">{inst.isin ?? "—"}</span>],
    [inst.exchange === "BSE" ? "Scrip code" : "Exchange token", <span key="tok" className="font-mono">{inst.token}</span>],
    ["ICICI Breeze code", <span key="bc" className="font-mono">{inst.breezeCode}</span>],
    ["Face value", inst.faceValue !== null ? `₹${inst.faceValue}` : "—"],
    ["Tick size", inst.tickSize !== null ? `₹${inst.tickSize}` : "—"],
    ["Market lot", inst.lotSize ?? "—"],
  ];

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/markets" className="hover:text-white">Markets</Link> <span aria-hidden>/</span> {inst.symbol}
      </nav>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-3xl font-semibold tracking-tight">{inst.symbol}</h1>
            <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-soft">{inst.exchange}</span>
            {inst.hasDerivatives && (
              <Link href={`/derivatives/${inst.symbol}`} className="rounded bg-accent/15 px-2 py-0.5 text-xs text-accent hover:bg-accent/25">
                F&amp;O listed →
              </Link>
            )}
          </div>
          <p className="mt-1 text-soft">{inst.name}</p>
          {other && (
            <Link href={`/instrument/${other.exchange}/${other.symbol}`} className="mt-1 inline-block text-xs text-muted hover:text-white">
              Also listed on {other.exchange} →
            </Link>
          )}
        </div>
        <AddToWatchlist instrumentId={inst.id} />
      </section>

      <FeedBanner compact />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Price">
        {["Last price", "Change", "Day range", "Volume"].map((label) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-2 font-mono text-xl"><Dash /></p>
          </div>
        ))}
      </section>

      <section aria-labelledby="ref" className="rounded-2xl border border-line bg-panel">
        <h2 id="ref" className="border-b border-line px-5 py-3 text-sm font-medium text-soft">Reference data</h2>
        <dl className="grid sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line px-5 py-3 text-sm last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
              <dt className="text-muted">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          ["Advanced chart", "P3"],
          ["AI scenario analysis", "P5"],
          ["Corporate actions & news", "P5"],
        ].map(([t, p]) => (
          <div key={t} className="rounded-xl border border-dashed border-line p-4 text-sm">
            <p className="font-medium">{t}</p>
            <p className="mt-1 text-xs text-muted">Arrives in {p}</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">Source: ICICI Direct security master. Research tool only. Not investment advice.</p>
    </>
  );
}
