import { redirect } from "next/navigation";
import { Logo } from "@/components/site";
import { LogoutButton } from "@/components/logout-button";
import { TerminalNav } from "@/components/terminal-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { MarketPanel } from "@/components/market-panel";
import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TerminalLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2.5">
        <Logo />
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>
      <div className="flex flex-1">
        <TerminalNav />
        <main className="min-w-0 flex-1 space-y-6 p-4 pb-24 sm:p-6 lg:pb-6">{children}</main>
        <Suspense>
          <MarketPanel />
        </Suspense>
      </div>
    </div>
  );
}
