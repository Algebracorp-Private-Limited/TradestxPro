import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { lastSync } from "@/lib/instruments";
import { listWatchlists } from "@/lib/market-data";
import { db } from "@/lib/db";
import { AiAnalysis } from "@/components/ai-analysis";
import { MarketOverview } from "@/components/market-overview";
import { InstrumentSearch } from "@/components/instrument-search";

export const metadata: Metadata = { title: "Dashboard" };


const istTime = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function foSummary() {
  const sql = await db();
  const [r] = await sql<{ d: Date | null; contracts: number | null; fut: number | null; opt: number | null }[]>`
    SELECT d, sum(contracts)::float8 AS contracts,
           sum(contracts) FILTER (WHERE inst IN ('IDF', 'STF'))::float8 AS fut,
           sum(contracts) FILTER (WHERE inst IN ('IDO', 'STO'))::float8 AS opt
      FROM fo_activity WHERE d = (SELECT max(d) FROM fo_activity) GROUP BY d`;
  return r ?? null;
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

export default async function Dashboard() {
  const user = (await getSessionUser())!;
  const [sync, lists, fo] = await Promise.all([lastSync().catch(() => null), listWatchlists(user.id), foSummary().catch(() => null)]);
  const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const syncedToday = sync?.finishedAt ? istDay(new Date(sync.finishedAt)) === istDay(new Date()) : false;
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

      <section aria-labelledby="search" className="rounded-2xl border border-line bg-panel/60 p-4 sm:p-5">
        <h2 id="search" className="mb-3 text-sm font-medium text-soft">Find an instrument</h2>
        <InstrumentSearch limit={6} />
      </section>

      <MarketOverview />

      <AiAnalysis scope="market" target="NIFTY 50" />

      <section className="grid gap-3 md:grid-cols-3">
        <Link href="/markets" className="rounded-xl border border-line bg-panel p-5 hover:border-white/20">
          <p className="flex items-center justify-between text-xs text-muted">
            Instrument master
            {sync?.finishedAt && <span className={`rounded-full px-2 py-0.5 text-[10px] ${syncedToday ? "bg-up/15 text-up" : "bg-gold/15 text-gold"}`}>{syncedToday ? "Updated today" : "Updates daily 8:45 am"}</span>}
          </p>
          <p className="mt-2 font-mono text-2xl">{c ? (c.nse + c.bse).toLocaleString("en-IN") : "—"}</p>
          <p className="mt-1 text-sm text-muted">
            {c ? `${c.nse.toLocaleString("en-IN")} NSE · ${c.bse.toLocaleString("en-IN")} BSE equities` : "Not loaded yet"}
          </p>
          {sync?.finishedAt && <p className="mt-1 text-[11px] text-muted">Refreshed {istTime(new Date(sync.finishedAt))} IST</p>}
        </Link>
        <Link href="/derivatives" className="rounded-xl border border-line bg-panel p-5 hover:border-white/20">
          <p className="text-xs text-muted">F&amp;O</p>
          <p className="mt-2 font-mono text-2xl">{c ? (c.nfo + c.bfo).toLocaleString("en-IN") : "—"} <span className="text-xs text-muted">listed contracts</span></p>
          <p className="mt-1 text-sm text-muted">
            {fo?.d && fo.contracts
              ? `NSE traded ${Math.round(fo.contracts / 1e5).toLocaleString("en-IN")} L contracts on ${fo.d.toISOString().slice(0, 10)} (futures ${Math.round((fo.fut ?? 0) / 1e3).toLocaleString("en-IN")}K · options ${Math.round((fo.opt ?? 0) / 1e5).toLocaleString("en-IN")} L)`
              : "Daily NSE F&O activity loads after 8:15 pm IST"}
          </p>
          {sync?.finishedAt && <p className="mt-1 text-[11px] text-muted">Contract list refreshed {istTime(new Date(sync.finishedAt))} IST</p>}
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
