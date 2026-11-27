import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site";
import { PortalNav } from "./_components/nav";

export const metadata: Metadata = {
  title: { default: "XChart developers", template: "%s · XChart developers" },
  description: "Documentation, API reference, examples and playground for the XChart financial charting SDK.",
};

export default function DevelopersLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <p className="mb-2 hidden px-3 text-[11px] uppercase tracking-wider text-muted lg:block">XChart SDK v0.4.0</p>
          <PortalNav />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
      <SiteFooter />
    </>
  );
}
