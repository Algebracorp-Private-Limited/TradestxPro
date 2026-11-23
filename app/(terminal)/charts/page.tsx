import type { Metadata } from "next";
import { Suspense } from "react";
import { AiAnalysisFromUrl } from "@/components/ai-analysis";
import { ChartTerminal } from "@/components/chart/chart-terminal";

export const metadata: Metadata = { title: "Advanced Chart" };

export default function ChartsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading chart…</p>}>
      <ChartTerminal />
      <div className="mt-4">
        <AiAnalysisFromUrl param="symbol" fallback="NSEIDX:NIFTY 50" />
      </div>
    </Suspense>
  );
}
