"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Item = { underlying: string; name: string; exchange: string; expiries: number };

export function UnderlyingFilter({ items }: { items: Item[] }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toUpperCase();
    return t ? items.filter((i) => i.underlying.includes(t) || i.name.toUpperCase().includes(t)) : items;
  }, [q, items]);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Filter stock underlyings"
        placeholder="Filter, e.g. TATA"
        className="mb-3 w-full max-w-sm rounded-lg border border-line bg-ink px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No stock derivatives match “{q}”.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {shown.map((i) => (
            <li key={i.exchange + i.underlying}>
              <Link
                href={`/derivatives/${encodeURIComponent(i.underlying)}?exchange=${i.exchange}`}
                className="block rounded-lg border border-line bg-panel px-3 py-2 hover:border-white/20"
                title={i.name}
              >
                <span className="block font-mono text-sm">{i.underlying}</span>
                <span className="block truncate text-[11px] text-muted">{i.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
