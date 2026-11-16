"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MODULES } from "@/lib/catalog";

export const LIVE_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "◧" },
  { href: "/markets", label: "Markets", icon: "▤" },
  { href: "/watchlists", label: "Watchlists", icon: "☆" },
  { href: "/derivatives", label: "F&O Contracts", icon: "⇄" },
];

const LIVE_SLUGS = new Set(["dashboard", "markets", "watchlists"]);

export function TerminalNav() {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(href + "/") || (href === "/markets" && path.startsWith("/instrument"));
  return (
    <>
      {/* Desktop sidebar */}
      <nav aria-label="Terminal" className="hidden w-60 shrink-0 border-r border-line bg-panel/60 p-3 lg:block">
        <ul className="space-y-0.5">
          {LIVE_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active(l.href) ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm ${active(l.href) ? "bg-white/[0.07] text-white" : "text-soft hover:bg-white/[0.04] hover:text-white"}`}
              >
                <span className="w-5 text-center font-mono text-xs text-accent" aria-hidden>{l.icon}</span>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 px-2 pb-2 text-[11px] uppercase tracking-wider text-muted">Coming next</p>
        <ul className="space-y-0.5">
          {MODULES.filter((m) => !LIVE_SLUGS.has(m.slug)).map((m) => (
            <li key={m.slug} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm text-muted">
              <span className="flex items-center gap-2.5">
                <span className="w-5 text-center font-mono text-xs opacity-60" aria-hidden>{m.icon}</span>
                {m.name}
              </span>
              <span className="font-mono text-[10px]">{m.phase}</span>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile tabs */}
      <nav aria-label="Terminal" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-panel/95 backdrop-blur lg:hidden">
        {LIVE_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active(l.href) ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${active(l.href) ? "text-white" : "text-muted"}`}
          >
            <span className="font-mono text-sm text-accent" aria-hidden>{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
