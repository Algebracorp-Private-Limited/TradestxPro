"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MODULES } from "@/lib/catalog";

export const LIVE_LINKS: { href: string; label: string; icon: string; sub?: boolean }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "◧" },
  { href: "/markets", label: "Markets", icon: "▤" },
  { href: "/markets/indices", label: "Indices", icon: "≡", sub: true },
  { href: "/charts", label: "Charts", icon: "⌇" },
  { href: "/screener", label: "Screener", icon: "⌕" },
  { href: "/watchlists", label: "Watchlists", icon: "☆" },
  { href: "/options", label: "Options", icon: "⋮" },
  { href: "/options/strategies", label: "Strategies", icon: "∑", sub: true },
  { href: "/options/screener", label: "Option screener", icon: "⌕", sub: true },
  { href: "/derivatives", label: "F&O", icon: "⇄" },
  { href: "/ai-intelligence", label: "AI Intelligence", icon: "✦" },
  { href: "/ai-intelligence/market-scan", label: "Market scan", icon: "⌕", sub: true },
  { href: "/ai-intelligence/equity", label: "Equity AI", icon: "↗", sub: true },
  { href: "/ai-intelligence/investment", label: "Investment AI", icon: "◷", sub: true },
  { href: "/ai-intelligence/option-chain", label: "Chain Intelligence", icon: "⛓", sub: true },
  { href: "/ai-intelligence/strategy", label: "Strategy AI", icon: "Σ", sub: true },
  { href: "/ai-intelligence/tradevision", label: "TradeVision", icon: "◭", sub: true },
  { href: "/ai-intelligence/workspace", label: "Option workspace", icon: "⧉", sub: true },
  { href: "/ai-intelligence/monitor", label: "Monitor & backtest", icon: "◔", sub: true },
  { href: "/ai-intelligence/paper", label: "Paper trading", icon: "◇", sub: true },
  { href: "/brokers", label: "Brokers", icon: "⛓" },
];

const LIVE_SLUGS = new Set(["strategy-lab", "options-screener", "futures", "ai", "dashboard", "markets", "watchlists", "charts", "screener", "xscript", "brokers", "options", "alerts"]);

type NavLink = (typeof LIVE_LINKS)[number];
/** Top-level links, each with the sub-pages listed directly after it. */
const GROUPS: { link: NavLink; children: NavLink[] }[] = [];
for (const l of LIVE_LINKS) {
  if (l.sub && GROUPS.length) GROUPS[GROUPS.length - 1].children.push(l);
  else GROUPS.push({ link: l, children: [] });
}
const STORE = "txp-nav";
type NavState = { collapsed: boolean; closed: string[] };
function readState(): NavState {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (v && typeof v.collapsed === "boolean" && Array.isArray(v.closed)) return v;
  } catch { /* storage unavailable */ }
  return { collapsed: false, closed: [] };
}
function writeState(v: NavState) {
  try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export function TerminalNav() {
  const path = usePathname();
  const [st, setSt] = useState<NavState>({ collapsed: false, closed: [] });
  // Restored after mount so the server render and first client render match.
  useEffect(() => { Promise.resolve().then(() => setSt(readState())); }, []);
  const update = (v: NavState) => { setSt(v); writeState(v); };
  const active = (href: string) =>
    href === "/ai-intelligence" ? path === "/ai-intelligence"
    : href === "/options" ? path === "/options"
    : href === "/markets" ? path === "/markets" || path.startsWith("/instrument")
    : path === href || path.startsWith(href + "/");
  const c = st.collapsed;
  const item = (l: NavLink, sub: boolean) => (
    <Link
      href={l.href}
      title={c ? l.label : undefined}
      aria-label={c ? l.label : undefined}
      aria-current={active(l.href) ? "page" : undefined}
      className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-sm ${sub ? "ml-5 py-1.5 text-[13px]" : ""} ${c ? "justify-center" : ""} ${active(l.href) ? "bg-white/[0.07] text-white" : "text-soft hover:bg-white/[0.04] hover:text-white"}`}
    >
      <span className="w-5 shrink-0 text-center font-mono text-xs text-accent" aria-hidden>{l.icon}</span>
      {!c && <span className="truncate">{l.label}</span>}
    </Link>
  );
  return (
    <>
      {/* Desktop sidebar */}
      <nav aria-label="Terminal" className={`hidden shrink-0 border-r border-line bg-panel/60 p-3 transition-[width] duration-200 motion-reduce:transition-none lg:block ${c ? "w-16 px-2" : "w-60"}`}>
        <button
          type="button"
          onClick={() => update({ ...st, collapsed: !c })}
          aria-expanded={!c}
          aria-label={c ? "Expand navigation" : "Collapse navigation"}
          title={c ? "Expand navigation" : "Collapse navigation"}
          className={`mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-white/[0.04] hover:text-white ${c ? "justify-center" : "justify-end"}`}
        >
          {!c && <span>Collapse</span>}
          <span aria-hidden className="font-mono text-sm">{c ? "»" : "«"}</span>
        </button>
        <ul className="space-y-0.5">
          {GROUPS.map(({ link, children }) => {
            const childActive = children.some((x) => active(x.href));
            const open = !c && children.length > 0 && (childActive || !st.closed.includes(link.href));
            const id = `nav-${link.href.replace(/\W+/g, "-")}`;
            return (
              <li key={link.href}>
                <div className="flex items-center">
                  {item(link, false)}
                  {!c && children.length > 0 && (
                    <button
                      type="button"
                      onClick={() => update({ ...st, closed: open ? [...st.closed, link.href] : st.closed.filter((h) => h !== link.href) })}
                      aria-expanded={open}
                      aria-controls={id}
                      aria-label={`${open ? "Hide" : "Show"} ${link.label} pages`}
                      className="ml-0.5 rounded-md px-1.5 py-1.5 text-muted hover:bg-white/[0.04] hover:text-white"
                    >
                      <span aria-hidden className={`inline-block text-[10px] transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>▶</span>
                    </button>
                  )}
                </div>
                {open && (
                  <ul id={id} className="mt-0.5 space-y-0.5">
                    {children.map((x) => <li key={x.href} className="flex">{item(x, true)}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {!c && (
          <>
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
          </>
        )}
      </nav>

      {/* Mobile tabs */}
      <nav aria-label="Terminal" className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-panel/95 backdrop-blur lg:hidden">
        {LIVE_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active(l.href) ? "page" : undefined}
            className={`flex min-w-[64px] flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${active(l.href) ? "text-white" : "text-muted"}`}
          >
            <span className="font-mono text-sm text-accent" aria-hidden>{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
