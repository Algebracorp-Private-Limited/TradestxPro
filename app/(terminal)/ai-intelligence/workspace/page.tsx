import type { Metadata } from "next";
import { Workspace } from "@/components/intelligence/workspace";

export const metadata: Metadata = { title: "Option workspace" };

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ u?: string; expiry?: string; strike?: string; right?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Option workspace</h1>
        <p className="text-sm text-muted">Synchronised underlying and option-premium charts, with model IV and time value derived from the premium history, and the contract engine&apos;s levels.</p>
      </header>
      <Workspace initial={sp} />
    </div>
  );
}
