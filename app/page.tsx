import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site";
import { Pricing } from "@/components/pricing";
import { TerminalPreview } from "@/components/terminal-preview";
import { MODULES, PHASES, type Phase } from "@/lib/catalog";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MARKETS = [
  { name: "NSE", detail: "NIFTY 50 / 100 / 200 / 500, sectoral indices, equities" },
  { name: "BSE", detail: "SENSEX, BSE 50 / 100 / 500" },
  { name: "F&O", detail: "Index & stock futures and options from the exchange master" },
  { name: "MCX", detail: "Gold, silver, crude, natural gas, copper" },
  { name: "FX", detail: "USD/INR, EUR/INR, GBP/INR, JPY/INR" },
];

const AI_POINTS = [
  ["Grounded numbers", "Prices and indicators are computed deterministically; the AI explains them and never invents quotes."],
  ["Scenarios, not tips", "Bullish, bearish and neutral cases with time horizon, entry zone, targets and invalidation."],
  ["Evidence & contradictions", "Trend, volume and derivatives evidence shown side by side, including what argues against the setup."],
  ["Freshness on every report", "Data timestamp, model version and confidence calibration are always visible."],
];

export default async function Home() {
  const user = await getSessionUser().catch(() => null);

  return (
    <>
      <SiteHeader signedIn={Boolean(user)} />
      <main id="top">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:px-8 lg:py-24">
            <div>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-3 py-1 text-xs text-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                AI-powered Indian market intelligence
              </p>
              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
                See the market.
                <br />
                <span className="text-muted">Understand the trade.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-soft">
                One research terminal for NSE, BSE, F&amp;O, MCX and FX: advanced charts, screeners, option analytics and
                evidence-led AI analysis.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={user ? "/dashboard" : "/signup"} className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">
                  {user ? "Open terminal" : "Start 7-day free trial"}
                </Link>
                <Link href="#modules" className="rounded-xl border border-line bg-white/5 px-5 py-3 text-sm font-semibold hover:bg-white/10">
                  Explore modules
                </Link>
              </div>
              <p className="mt-5 text-xs text-muted">Research tool only. Not investment advice.</p>
            </div>
            <TerminalPreview />
          </div>
        </section>

        {/* Coverage */}
        <section aria-labelledby="coverage" className="border-b border-line">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <h2 id="coverage" className="sr-only">Market coverage</h2>
            <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
              {MARKETS.map((m) => (
                <div key={m.name} className="bg-ink p-5">
                  <dt className="font-mono text-sm font-semibold text-accent">{m.name}</dt>
                  <dd className="mt-1.5 text-sm leading-6 text-muted">{m.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Modules */}
        <section id="modules" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Every tool in one workspace</h2>
              <p className="mt-4 text-soft">
                Built in phases. Each module is labelled with the phase that delivers it, so you always know what is live.
              </p>
            </div>
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((m) => (
                <article key={m.slug} className="group rounded-2xl border border-line bg-panel p-5 transition hover:border-white/20">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/5 font-mono text-accent" aria-hidden>
                      {m.icon}
                    </span>
                    <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
                      {m.phase} · {PHASES[m.phase]}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold">{m.name}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">{m.blurb}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* AI */}
        <section id="ai" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <p className="font-mono text-sm text-accent">✦ AI Trade Intelligence</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Analysis you can audit</h2>
              <p className="mt-4 text-soft">
                Click <em>Analyze with AI</em> on any instrument to get a structured research scenario. Every number traces
                back to a calculation, every report carries its data timestamp.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {AI_POINTS.map(([title, body]) => (
                <div key={title} className="rounded-2xl border border-line bg-panel p-5">
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="mx-auto mb-8 max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Simple plans</h2>
              <p className="mt-4 text-soft">Start free, upgrade when the workspace earns its place.</p>
            </div>
            <Pricing />
          </div>
        </section>

        {/* Roadmap */}
        <section id="roadmap" className="scroll-mt-20">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Build roadmap</h2>
            <ol className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(PHASES) as Phase[]).map((p, i) => (
                <li key={p} className="rounded-2xl border border-line bg-panel p-5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-accent">{p}</span>
                    {i === 0 && <span className="rounded-full bg-up/15 px-2 py-0.5 text-[11px] font-medium text-up">In progress</span>}
                  </div>
                  <p className="mt-2 font-semibold">{PHASES[p]}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
