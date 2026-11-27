"use client";

import type { ReactNode } from "react";

export const STATUS_STYLE: Record<string, string> = {
  "ENTER IF CONFIRMED": "border-up/40 bg-up/10 text-up",
  "WAIT FOR CONFIRMATION": "border-accent/40 bg-accent/10 text-accent",
  WATCHLIST: "border-gold/40 bg-gold/10 text-gold",
  AVOID: "border-down/40 bg-down/10 text-down",
  "NO TRADE": "border-line bg-white/[0.03] text-muted",
  INVALIDATED: "border-down/40 bg-down/10 text-down",
  "INSUFFICIENT DATA": "border-line bg-white/[0.03] text-muted",
  ANALYSED: "border-accent/40 bg-accent/10 text-accent",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${STATUS_STYLE[status] ?? "border-line text-muted"}`}>{status}</span>;
}

export type Prov = { source: string; exchangeTime: string | null; freshness: string; notes?: string[]; missing?: string[] };
const FRESH: Record<string, string> = { "real-time": "Real-time", delayed: "Delayed", eod: "End of day", stale: "Stale", unknown: "Unverified" };
export function FreshnessBadge({ p }: { p: Prov | null | undefined }) {
  if (!p) return null;
  const tone = p.freshness === "real-time" ? "text-up" : p.freshness === "stale" || p.freshness === "unknown" ? "text-down" : "text-gold";
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted" title={[p.source, ...(p.notes ?? [])].join(" · ")}>
      <span className={`font-semibold ${tone}`}>{FRESH[p.freshness] ?? p.freshness}</span>
      <span>· {p.exchangeTime ? p.exchangeTime.slice(0, 16).replace("T", " ") : "time unknown"}</span>
    </span>
  );
}

export function Card({ title, children, right, className = "" }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel/60 p-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" | "error" }) {
  const c = tone === "warn" ? "border-gold/40 bg-gold/10 text-gold" : tone === "error" ? "border-down/40 bg-down/10 text-down" : "border-accent/30 bg-accent/5 text-soft";
  return <p role={tone === "error" ? "alert" : undefined} className={`rounded-lg border px-3 py-2 text-xs leading-5 ${c}`}>{children}</p>;
}

export function Insufficient({ missing, reasons }: { missing?: string[]; reasons?: string[] }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-xs">
      <p className="font-semibold text-soft">INSUFFICIENT DATA</p>
      {reasons?.length ? <ul className="mt-1 list-disc pl-4 text-muted">{reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      {missing?.length ? <p className="mt-1 text-muted">Missing: {missing.join(", ")}</p> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p role="status" className="animate-pulse text-sm text-muted">{label}</p>;
}

export const inr = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) })}`);
export const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: d }));
export const pct = (v: number | null | undefined, d = 1, asFraction = false) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(asFraction ? v * 100 : v).toFixed(d)}%`);

export function ScoreBar({ total, components, disclaimer }: { total: number; components?: { label: string; value: number; weight: number; reason: string }[]; disclaimer?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-28 overflow-hidden rounded bg-white/10" aria-hidden><div className="h-full bg-accent" style={{ width: `${total}%` }} /></div>
        <span className="font-mono text-xs">{total}/100</span>
      </div>
      {components && (
        <ul className="grid gap-x-4 gap-y-0.5 text-[11px] text-muted sm:grid-cols-2">
          {components.map((c) => <li key={c.label}><span className="text-soft">{c.label}</span> {Math.round(c.value * 100)}% (w{c.weight}) — {c.reason}</li>)}
        </ul>
      )}
      {disclaimer && <p className="text-[10px] text-muted">{disclaimer}</p>}
    </div>
  );
}

export function Restricted({ notices }: { notices?: string[] }) {
  if (!notices?.length) return null;
  return <div className="space-y-1">{notices.map((n) => <Notice key={n} tone="warn">{n}</Notice>)}</div>;
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-soft">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
