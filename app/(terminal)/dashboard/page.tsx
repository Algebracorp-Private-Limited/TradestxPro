import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { lastSync } from "@/lib/instruments";
import { listWatchlists } from "@/lib/market-data";
import { FeedBanner, Dash } from "@/components/feed-banner";
import { InstrumentSearch } from "@/components/instrument-search";

export const metadata: Metadata = { title: "Dashboard" };

const INDEX_TILES = ["NIFTY 50", "SENSEX", "NIFTY BANK", "INDIA VIX", "USD/INR", "MCX GOLD"];

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

export default async function Dashboard() {
  const user = (await getSessionUser())!;
  const [sync, lists] = await Promise.all([lastSync().catch(() => null), listWatchlists(user.id)]);
  const trialDays = daysLeft(user.trialEndsAt);
  const c = sync?.counts;

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-muted">Your TradestXPro workspace.</p>
        </div>
        <div className="rounded-xl border border-line bg-panel px-4 py-2.5 text-sm">
          <span className="text-muted">Plan: </span>
          <span className="font-medium">{user.plan === "trial" ? "Free trial" : user.plan}</span>
          {user.plan === "trial" && trialDays !== null && (
            <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{trialDays} days left</span>
          )}
        </div>
      </section>

      <FeedBanner compact />

      <section aria-labelledby="search" className="rounded-2xl border border-line bg-panel/60 p-4 sm:p-5">
        <h2 id="search" className="mb-3 text-sm font-medium text-soft">Find an instrument</h2>
        <InstrumentSearch limit={6} />
      </section>

      <section aria-labelledby="indices">
        <h2 id="indices" className="mb-3 text-sm font-medium text-soft">Market overview</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {INDEX_TILES.map((name) => (
            <div key={name} className="rounded-xl border border-line bg-panel p-4">
              <p className="text-xs text-muted">{name}</p>
              <p className="mt-2 font-mono text-xl"><Dash /></p>
              <p className="mt-1 text-[11px] text-muted">Awaiting feed</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Link href="/markets" className="rounded-xl border border-line bg-panel p-5 hover:border-white/20">
          <p className="text-xs text-muted">Instrument master</p>
          <p className="mt-2 font-mono text-2xl">{c ? (c.nse + c.bse).toLocaleString("en-IN") : "—"}</p>
          <p className="mt-1 text-sm text-muted">
            {c ? `${c.nse.toLocaleString("en-IN")} NSE · ${c.bse.toLocaleString("en-IN")} BSE equities` : "Not loaded yet"}
          </p>
        </Link>
        <Link href="/derivatives" className="rounded-xl border border-line bg-panel p-5 hover:border-white/20">
          <p className="text-xs text-muted">Live F&amp;O contracts</p>
          <p className="mt-2 font-mono text-2xl">{c ? (c.nfo + c.bfo).toLocaleString("en-IN") : "—"}</p>
          <p className="mt-1 text-sm text-muted">Futures &amp; options across NSE and BSE</p>
        </Link>
        <Link href="/watchlists" className="rounded-xl border border-line bg-panel p-5 hover:border-white/20">
          <p className="text-xs text-muted">Your watchlists</p>
          <p className="mt-2 font-mono text-2xl">{lists.length}</p>
          <p className="mt-1 text-sm text-muted">{lists.reduce((s, l) => s + l.items.length, 0)} symbols tracked</p>
        </Link>
      </section>

      <p className="text-xs text-muted">
        {sync?.finishedAt
          ? `Instrument master refreshed ${new Date(sync.finishedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST · source: ICICI Direct security master.`
          : "Instrument master has not been loaded yet."}{" "}
        Research tool only. Not investment advice.
      </p>
    </>
  );
}
