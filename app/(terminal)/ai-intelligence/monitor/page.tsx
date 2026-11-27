import type { Metadata } from "next";
import { Monitor } from "@/components/intelligence/monitor";

export const metadata: Metadata = { title: "Monitor & backtest" };

export default async function MonitorPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Monitor & backtest</h1>
        <p className="text-sm text-muted">Track trade plans, alerts (price, technical, OI, IV and engine setups) and an AI watchlist on end-of-day data, with in-app and e-mail notifications; backtest the setup engine walk-forward and review performance and score calibration.</p>
      </header>
      <Monitor initialTab={tab} />
    </div>
  );
}
