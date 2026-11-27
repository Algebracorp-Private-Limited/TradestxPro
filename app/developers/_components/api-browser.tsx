"use client";

import { useMemo, useState } from "react";

type Member = { name: string; signature: string; doc: string };
type Item = { name: string; kind: string; module: string; doc: string; signature?: string; members?: Member[] };

const KIND_ORDER = ["function", "class", "interface", "const", "type", "namespace", "enum", "other"];

export function ApiBrowser({ items }: { items: Item[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (!kind || i.kind === kind) && (!s || i.name.toLowerCase().includes(s) || i.doc.toLowerCase().includes(s) || i.members?.some((m) => m.name.toLowerCase().includes(s))));
  }, [items, q, kind]);
  const kinds = KIND_ORDER.filter((k) => items.some((i) => i.kind === k));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="w-64 rounded-lg border border-line bg-panel px-2 py-1.5 text-sm" placeholder="Search exports and members…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the API" />
        <select className="rounded-lg border border-line bg-panel px-2 py-1.5 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span className="text-xs text-muted">{filtered.length} of {items.length}</span>
      </div>
      <ul className="space-y-2">
        {filtered.map((i) => (
          <li key={i.name} id={i.name} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <code className="font-mono text-sm font-semibold text-white">{i.name}</code>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{i.kind}</span>
              <span className="font-mono text-[10px] text-muted">{i.module}</span>
            </div>
            {i.doc && <p className="mt-1 text-xs leading-5 text-soft">{i.doc}</p>}
            {i.signature && i.kind !== "interface" && <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-soft">{i.signature}</pre>}
            {i.members && i.members.length > 0 && (
              <details className="mt-2" open={Boolean(q) && i.members.some((m) => m.name.toLowerCase().includes(q.toLowerCase()))}>
                <summary className="cursor-pointer text-xs text-accent">{i.members.length} members</summary>
                <ul className="mt-2 space-y-1.5">
                  {i.members.map((m) => (
                    <li key={m.name + m.signature}>
                      <pre className="overflow-x-auto font-mono text-[11px] text-white">{m.signature}</pre>
                      {m.doc && <p className="text-[11px] leading-4 text-muted">{m.doc}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
