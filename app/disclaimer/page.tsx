import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";

export const metadata: Metadata = { title: "Disclaimer" };

export default function Disclaimer() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Disclaimer</h1>
        <p className="mt-2 text-sm text-muted">Draft pending legal review.</p>
        <div className="mt-8 space-y-5 leading-7 text-soft">
          <p>
            TradestXPro, operated by Algebracorp Private Limited, provides market data visualisation, analytics and
            research tools for educational and informational purposes only.
          </p>
          <p>
            Nothing on this website, including charts, screeners, option analytics or AI-generated scenarios, is
            investment advice, a research recommendation or an offer to buy or sell any security, derivative, commodity or
            currency. AI scenarios are hypothetical and may be wrong.
          </p>
          <p>
            Trading and investing involve substantial risk, including loss of capital. Derivatives are leveraged and can
            result in losses greater than the amount invested. Past performance and backtests do not guarantee future
            results.
          </p>
          <p>
            Market data may be delayed, incomplete or unavailable. Always confirm prices with your broker before acting.
            Consult a SEBI-registered investment adviser before making investment decisions.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
