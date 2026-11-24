import type { Metadata } from "next";
import { XChartDemo } from "./demo";
import { XChartAdvancedDemo } from "./advanced";

export const metadata: Metadata = {
  title: "XChart SDK demo",
  description: "Developer demonstration of the TradestXPro XChart SDK with synthetic data.",
  robots: { index: false, follow: false },
};

export default function XChartDemoPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-accent">Developer preview · XChart SDK v0.3.0</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">XChart SDK demo</h1>
        <p className="mt-1 text-sm text-muted">
          A chart built only through the public SDK (<code className="font-mono text-soft">createChart</code>), rendered by TradestXPro&apos;s own canvas engine.
        </p>
        <p className="mt-2 inline-block rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs text-gold">
          Synthetic sample data: randomly generated prices, not real market data.
        </p>
      </header>
      <h2 className="pt-2 text-lg font-semibold">Basics (v0.2)</h2>
      <XChartDemo />
      <h2 className="pt-4 text-lg font-semibold">Advanced API (v0.3)</h2>
      <XChartAdvancedDemo />
    </main>
  );
}
