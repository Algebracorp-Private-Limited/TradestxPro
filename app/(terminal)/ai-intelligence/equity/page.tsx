import type { Metadata } from "next";
import { EquityAI } from "@/components/intelligence/equity-view";

export const metadata: Metadata = { title: "Equity AI" };

export default function EquityPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Equity AI</h1>
        <p className="text-sm text-muted">Conditional trade setups for NSE stocks: entry, confirmation, stop-loss, targets, sizing and costs, with reasons to avoid.</p>
      </header>
      <EquityAI />
    </div>
  );
}
