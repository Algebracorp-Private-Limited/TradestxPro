import type { Metadata } from "next";
import { Monitor } from "@/components/intelligence/monitor";

export const metadata: Metadata = { title: "Monitor & backtest" };

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Monitor & backtest</h1>
        <p className="text-sm text-muted">Track trade plans and price alerts on end-of-day data, backtest the setup engine walk-forward, and review performance and score calibration.</p>
      </header>
      <Monitor initialTab={tab} />
    </div>
  );
}
