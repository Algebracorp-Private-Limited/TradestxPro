import type { Metadata } from "next";
import { PaperTrading } from "@/components/intelligence/paper";

export const metadata: Metadata = { title: "Paper trading" };

export default function PaperPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Paper trading</h1>
        <p className="text-sm text-muted">Practise with a virtual account: simulated orders on equities, futures and options, filled on end-of-day data, with positions, P&L, costs and expiry settlement. No real orders are ever placed.</p>
      </header>
      <PaperTrading />
    </div>
  );
}
