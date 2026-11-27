"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const PORTAL_LINKS = [
  { href: "/developers", label: "Overview" },
  { href: "/developers/getting-started", label: "Getting started" },
  { href: "/developers/xchart", label: "XChart guide" },
  { href: "/developers/api-reference", label: "API reference" },
  { href: "/developers/examples", label: "Examples" },
  { href: "/developers/playground", label: "Playground" },
  { href: "/developers/market-data", label: "Market data" },
  { href: "/developers/changelog", label: "Changelog" },
  { href: "/developers/licensing", label: "Licensing" },
  { href: "/developers/account", label: "Account" },
];

export function PortalNav() {
  const path = usePathname();
  return (
    <nav aria-label="Developer portal" className="lg:sticky lg:top-6">
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0">
        {PORTAL_LINKS.map((l) => {
          const on = path === l.href;
          return (
            <li key={l.href} className="shrink-0">
              <Link href={l.href} aria-current={on ? "page" : undefined} className={`block rounded-lg px-3 py-1.5 text-sm ${on ? "bg-white/[0.07] text-white" : "text-soft hover:bg-white/[0.04] hover:text-white"}`}>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
