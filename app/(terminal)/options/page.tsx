import type { Metadata } from "next";
import { Suspense } from "react";
import { OptionsTerminal } from "@/components/options/options-terminal";

export const metadata: Metadata = { title: "Options" };

export default function OptionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading option chain…</p>}>
      <OptionsTerminal />
    </Suspense>
  );
}
