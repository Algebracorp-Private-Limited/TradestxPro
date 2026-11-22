import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site";
import { WaitlistForm } from "@/components/waitlist-form";
import { ALGO_EXAMPLES, ALGO_FAQ } from "@/lib/algo-examples";
import { getSessionUser } from "@/lib/auth";
import { db, isDbConfigured } from "@/lib/db";

export const metadata: Metadata = {
  title: "Algo Trading — automate your strategies through your own broker",
  description:
    "How algorithmic trading works on TradestXPro: write rules in XScript, backtest, paper trade and run them through your own broker. Worked examples and early-access waitlist.",
};
export const dynamic = "force-dynamic";

const STEPS = [
  { n: "1", title: "Describe your rules", body: "Pick a template or write rules in XScript — e.g. “buy when the 9 EMA crosses above the 21 EMA, stop-loss 1.5%”. No coding experience needed for templates." },
  { n: "2", title: "Backtest on history", body: "See how those exact rules would have performed: returns, maximum drawdown, win rate, every trade on the chart, with brokerage and slippage included." },
  { n: "3", title: "Paper trade live", body: "Run the strategy on live prices from your own broker with simulated orders. Prove it in real market conditions without risking money." },
  { n: "4", title: "Go live through your broker", body: "When you're ready, the strategy places orders in your own broker account, with daily loss limits, position caps and a one-click kill switch." },
];

const CONTROLS = [
  ["Daily loss limit", "Strategy stops for the day once your maximum loss is hit."],
  ["Position & quantity caps", "Hard limits on lots, exposure and open positions."],
  ["One-click kill switch", "Square off and pause everything instantly, from any device."],
  ["Your broker, your money", "Funds never leave your broker account. We never hold money."],
  ["Every order logged", "Full audit trail of signals, orders and fills."],
  ["Approval mode", "Optionally confirm each order before it is sent."],
];

export default async function AlgoTrading() {
  const user = await getSessionUser().catch(() => null);
  let count = 0;
  if (isDbConfigured()) {
    try {
      const sql = await db();
      [{ n: count }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM algo_waitlist`;
    } catch {}
  }

  return (
    <>
      <SiteHeader signedIn={Boolean(user)} />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-line">
          <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 lg:py-24">
            <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs text-gold">
              Coming soon · early-access waitlist open
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
              Algo trading,
              <br />
              <span className="text-muted">through your own broker.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-soft">
              Turn your trading rules into a strategy, test it on years of data, paper trade it live — then let it trade
              for you in your own ICICI Direct, Kotak, Dhan, Zerodha, Upstox, Angel One or Fyers account.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a href="#waitlist" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-200">Join the waitlist</a>
              <a href="#examples" className="rounded-xl border border-line bg-white/5 px-5 py-3 text-sm font-semibold hover:bg-white/10">See strategy examples</a>
            </div>
            {count >= 50 && <p className="mt-5 text-sm text-muted">{count.toLocaleString("en-IN")} traders have already joined.</p>}
          </div>
        </section>

        {/* What is it */}
        <section className="border-b border-line">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">What is algo trading?</h2>
              <div className="mt-5 space-y-4 leading-7 text-soft">
                <p>
                  Every trader follows rules, even if they live only in their head: <em>“I buy when the price breaks
                  yesterday’s high on good volume, and I get out if it falls 1%.”</em>
                </p>
                <p>
                  Algorithmic trading means writing those rules down precisely, so a computer can watch the market for you
                  and act the instant the conditions are met — without hesitation, fear or greed, and without you staring at
                  the screen all day.
                </p>
                <p>
                  Because the rules are exact, you can also <strong className="text-white">test them on past data</strong>{" "}
                  before risking real money. That is the single biggest advantage: you find out whether an idea had an edge,
                  how much it could lose in a bad month, and how often it is right.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-6">
              <p className="text-sm font-medium text-soft">Manual vs. algo trading</p>
              <dl className="mt-4 divide-y divide-line text-sm">
                {[
                  ["Watching the market", "You, all day", "The strategy, every tick"],
                  ["Reaction time", "Seconds to minutes", "Milliseconds"],
                  ["Emotions", "Fear, greed, hesitation", "None — rules only"],
                  ["Testing an idea", "Gut feel", "Years of backtest data"],
                  ["Discipline on stop-loss", "Easy to skip", "Always enforced"],
                ].map(([k, a, b]) => (
                  <div key={k} className="grid grid-cols-3 gap-3 py-2.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-soft">{a}</dd>
                    <dd className="text-up">{b}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-semibold tracking-tight">How it will work on TradestXPro</h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <li key={s.n} className="rounded-2xl border border-line bg-panel p-5">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/15 font-mono text-sm text-accent">{s.n}</span>
                  <h3 className="mt-4 font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm text-muted">
              Already live today: charts, 22 indicators, the stock screener and{" "}
              <Link href="/charts" className="text-accent hover:underline">XScript Lab</Link> for custom indicators and buy/sell signals.
              Backtesting, paper trading and live execution follow.
            </p>
          </div>
        </section>

        {/* Examples */}
        <section id="examples" className="scroll-mt-20 border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-semibold tracking-tight">Strategy examples, explained</h2>
            <p className="mt-3 max-w-3xl text-soft">
              Five common strategy styles, written as XScript. Each shows the idea in plain language, the exact rules, the
              code, and what can go wrong. These are educational examples, not recommendations.
            </p>
            <div className="mt-8 space-y-6">
              {ALGO_EXAMPLES.map((ex, i) => (
                <article key={ex.id} id={ex.id} className="scroll-mt-20 overflow-hidden rounded-2xl border border-line bg-panel">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
                    <span className="font-mono text-sm text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <h3 className="mr-auto text-lg font-semibold">{ex.name}</h3>
                    {[ex.style, ex.market, ex.timeframe].map((t) => (
                      <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">{t}</span>
                    ))}
                  </div>
                  <div className="grid gap-0 lg:grid-cols-2">
                    <div className="space-y-4 p-5">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted">The idea</p>
                        <p className="mt-1.5 leading-7 text-soft">{ex.idea}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted">Rules</p>
                        <ul className="mt-1.5 space-y-1.5 text-sm leading-6 text-soft">
                          {ex.rules.map((r) => (
                            <li key={r} className="flex gap-2"><span className="text-accent" aria-hidden>▸</span>{r}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted">What can go wrong</p>
                        <ul className="mt-1.5 space-y-1.5 text-sm leading-6 text-soft">
                          {ex.risks.map((r) => (
                            <li key={r} className="flex gap-2"><span className="text-down" aria-hidden>!</span>{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="border-t border-line bg-ink lg:border-l lg:border-t-0">
                      <p className="border-b border-line px-4 py-2 text-[11px] text-muted">XScript strategy</p>
                      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6 text-soft"><code>{ex.code}</code></pre>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <p className="mt-6 text-xs text-muted">
              The <code className="font-mono">strategy()</code>, entry, exit and stop-loss commands are the planned XScript strategy syntax. The
              indicator functions (ema, rsi, atr, supertrend, adx…) already work in XScript Lab today.
            </p>
          </div>
        </section>

        {/* Safety */}
        <section className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-semibold tracking-tight">Built-in risk controls</h2>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CONTROLS.map(([t, b]) => (
                <div key={t} className="rounded-2xl border border-line bg-panel p-5">
                  <h3 className="font-semibold">{t}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted">{b}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl border border-gold/40 bg-gold/[0.06] p-5 text-sm leading-6 text-soft">
              <p className="font-semibold text-gold">Regulation</p>
              <p className="mt-1.5">
                SEBI’s framework for retail algorithmic trading (2025) requires strategies to be registered with the
                exchange through a broker, orders to come from registered systems with risk checks, and algo providers to
                meet SEBI’s requirements. TradestXPro will enable live algo trading only after completing these
                registrations. Until then, strategies can be written, backtested and paper traded.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ + waitlist */}
        <section id="waitlist" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:px-8">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
              <div className="mt-6 space-y-2">
                {ALGO_FAQ.map((f) => (
                  <details key={f.q} className="group rounded-xl border border-line bg-panel px-4 py-3">
                    <summary className="cursor-pointer list-none font-medium marker:hidden">
                      <span className="mr-2 inline-block text-accent transition group-open:rotate-90" aria-hidden>▸</span>
                      {f.q}
                    </summary>
                    <p className="mt-2 pl-5 text-sm leading-6 text-soft">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
              <h2 className="text-2xl font-semibold tracking-tight">Get early access</h2>
              <p className="mt-2 text-sm text-muted">
                Free to join, no commitment. We’re opening algo trading once enough traders sign up — waitlist members get
                in first, with early-access pricing.
              </p>
              <div className="mt-6">
                <WaitlistForm defaultName={user?.name} defaultEmail={user?.email} />
              </div>
            </div>
          </div>
        </section>

        <p className="mx-auto max-w-6xl px-4 pb-10 text-xs leading-5 text-muted sm:px-6 lg:px-8">
          Algo trading involves substantial risk, including the loss of capital. Past or backtested performance does not
          guarantee future results. Content on this page is educational and is not investment advice.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
