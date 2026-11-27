import type { Metadata } from "next";
import { IntelligenceDashboard } from "@/components/intelligence/dashboard";

export const metadata: Metadata = { title: "AI Intelligence" };

export default function AIIntelligencePage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">AI Intelligence</h1>
        <p className="text-sm text-muted">Deterministic market analysis with AI explanations of verified numbers.</p>
      </header>
      <IntelligenceDashboard />
    </div>
  );
}
