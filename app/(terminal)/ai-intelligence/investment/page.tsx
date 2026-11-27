import type { Metadata } from "next";
import { InvestmentAI } from "@/components/intelligence/investment-view";

export const metadata: Metadata = { title: "Investment AI" };

export default function InvestmentPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Investment AI</h1>
        <p className="text-sm text-muted">Business quality, valuation and DCF scenarios from published financial statements.</p>
      </header>
      <InvestmentAI />
    </div>
  );
}
