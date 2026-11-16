import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/site";
import { LogoutButton } from "@/components/logout-button";
import { getSessionUser } from "@/lib/auth";
import { MODULES, PHASES } from "@/lib/catalog";

export const metadata: Metadata = { title: "Terminal" };
export const dynamic = "force-dynamic";

const INDEX_TILES = ["NIFTY 50", "SENSEX", "NIFTY BANK", "INDIA VIX", "USD/INR", "MCX GOLD"];

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

export default async function Dashboard() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const trialDays = daysLeft(user.trialEndsAt);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2.5">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      <div className="flex flex-1">
        <nav aria-label="Terminal modules" className="hidden w-60 shrink-0 border-r border-line bg-panel/60 p-3 lg:block">
          <p className="px-2 pb-2 text-[11px] uppercase tracking-wider text-muted">Modules</p>
          <ul className="space-y-0.5">
            {MODULES.map((m, i) => (
              <li key={m.slug}>
                <span
                  aria-disabled={i !== 0}
                  className={`flex items-center justify-between rounded-lg px-2 py-2 text-sm ${i === 0 ? "bg-white/[0.06] text-white" : "text-muted"}`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="w-5 text-center font-mono text-xs text-accent" aria-hidden>{m.icon}</span>
                    {m.name}
                  </span>
                  {i !== 0 && <span className="font-mono text-[10px]">{m.phase}</span>}
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 space-y-6 p-4 sm:p-6">
          <section className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Welcome, {user.name.split(" ")[0]}</h1>
              <p className="mt-1 text-sm text-muted">Your TradestXPro workspace.</p>
            </div>
            <div className="rounded-xl border border-line bg-panel px-4 py-2.5 text-sm">
              <span className="text-muted">Plan: </span>
              <span className="font-medium capitalize">{user.plan === "trial" ? "Free trial" : user.plan}</span>
              {user.plan === "trial" && trialDays !== null && (
                <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">{trialDays} days left</span>
              )}
            </div>
          </section>

          <section
            role="status"
            className="flex flex-col gap-1 rounded-xl border border-gold/40 bg-gold/[0.07] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              <strong className="text-gold">Market data feed not connected.</strong>{" "}
              <span className="text-soft">Live quotes arrive in Phase 2 once a licensed feed is in place. No prices are shown until then.</span>
            </span>
            <span className="font-mono text-xs text-muted">feed: offline</span>
          </section>

          <section aria-labelledby="indices">
            <h2 id="indices" className="mb-3 text-sm font-medium text-soft">Market overview</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {INDEX_TILES.map((name) => (
                <div key={name} className="rounded-xl border border-line bg-panel p-4">
                  <p className="text-xs text-muted">{name}</p>
                  <p className="mt-2 font-mono text-xl text-muted/60" aria-label="No data">—</p>
                  <p className="mt-1 text-[11px] text-muted">Awaiting feed</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="coming" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <h2 id="coming" className="sr-only">Modules in development</h2>
            {MODULES.slice(1, 7).map((m) => (
              <div key={m.slug} className="rounded-xl border border-dashed border-line p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-accent" aria-hidden>{m.icon}</span>
                  <span className="text-[11px] text-muted">{m.phase} · {PHASES[m.phase]}</span>
                </div>
                <p className="mt-3 font-medium">{m.name}</p>
                <p className="mt-1 text-sm text-muted">{m.blurb}</p>
              </div>
            ))}
          </section>

          <p className="text-xs text-muted">Research tool only. Not investment advice.</p>
        </main>
      </div>
    </div>
  );
}
