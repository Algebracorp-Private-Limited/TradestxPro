import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrument } from "@/lib/market-data";
import { AddToWatchlist } from "@/components/add-to-watchlist";
import { getSessionUser } from "@/lib/auth";
import { getQuotes } from "@/lib/brokers/quotes";
import { isVaultConfigured } from "@/lib/brokers/vault";
import { db } from "@/lib/db";
import { AutoRefresh } from "@/components/auto-refresh";

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
  const user = (await getSessionUser())!;
  const live = inst.exchange === "NSE" && isVaultConfigured()
    ? await getQuotes(user.id, [{ key: "q", kind: "stock", symbol: inst.symbol, token: inst.token, breezeCode: inst.breezeCode }]).catch(() => null)
    : null;
  const q = live?.quotes.q ?? null;
  const sql = await db();
  const [eod] = await sql<{ close: number; change_pct: number; volume: number; d: Date; high52: number; low52: number }[]>`
    SELECT close, change_pct, volume, d, high52, low52 FROM screener_snapshot WHERE symbol = ${inst.symbol}`;
  const f = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fv = (v: number | null | undefined) => (!v ? "—" : v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(2) + " L" : v.toLocaleString("en-IN"));
  const price = q?.ltp ?? eod?.close ?? null;
  const pct = q ? q.changePct : eod?.change_pct ?? null;
  const cards: [string, string, string?][] = [
    ["Last price", f(price), pct === null ? undefined : pct >= 0 ? "text-up" : "text-down"],
    ["Change", pct === null ? "—" : `${q?.change !== null && q?.change !== undefined ? `${q.change >= 0 ? "+" : ""}${f(q.change)} ` : ""}(${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`, pct === null ? undefined : pct >= 0 ? "text-up" : "text-down"],
    ["Day range", q?.low && q?.high ? `${f(q.low)} – ${f(q.high)}` : "—"],
    ["Volume", fv(q?.volume ?? eod?.volume)],
    ["52-week range", eod ? `${f(eod.low52)} – ${f(eod.high52)}` : "—"],
  ];

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
      <AutoRefresh seconds={20} enabled={Boolean(q)} />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/markets" className="rounded-md border border-line px-2.5 py-1 hover:bg-white/5 hover:text-white">← Markets</Link>
        {inst.hasDerivatives && <Link href="/derivatives" className="rounded-md border border-line px-2.5 py-1 hover:bg-white/5 hover:text-white">← F&amp;O</Link>}
        <span aria-hidden>/</span> {inst.symbol}
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Price">
        {cards.map(([label, value, cls]) => (
          <div key={label} className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className={`mt-2 truncate font-mono text-lg ${cls ?? ""}`} title={value}>{value}</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">
        {q ? `Live from ${live?.brokerName}, refreshes every 20 s.` : eod ? `End-of-day close for ${eod.d.toISOString().slice(0, 10)}. Connect a broker for live prices.` : "Connect a broker for live prices."}
        {" "}<Link href={`/charts?symbol=NSE:${encodeURIComponent(inst.symbol)}`} className="text-accent hover:underline">Open chart →</Link>
        {inst.hasDerivatives && <> · <Link href={`/options?u=${encodeURIComponent(inst.symbol)}`} className="text-accent hover:underline">Option chain →</Link></>}
      </p>

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
