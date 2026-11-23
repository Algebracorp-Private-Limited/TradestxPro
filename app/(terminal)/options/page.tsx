import type { Metadata } from "next";
import { Suspense } from "react";
import { AiAnalysisFromUrl } from "@/components/ai-analysis";
import { OptionsTerminal } from "@/components/options/options-terminal";

export const metadata: Metadata = { title: "Options" };

export default function OptionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading option chain…</p>}>
      <AiAnalysisFromUrl param="u" fallback="NIFTY" />
      <div className="mt-4"><OptionsTerminal /></div>
    </Suspense>
  );
}
