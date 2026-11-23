"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { whenVisible } from "@/lib/client/visible";
import { IndexPicker } from "./index-picker";

type Section = "index" | "future" | "option";
type Quote = { ltp: number; change: number | null; changePct: number | null; open: number | null; high: number | null; low: number | null; volume: number | null; oi?: number | null };
type Item = {
  id: number; section: Section; exchange: string; key: string; label: string;
  meta: { underlying?: string; expiry?: string; strike?: number | null; right?: "CE" | "PE" | null; lot?: number };
  expired: boolean; quote: Quote | null; eod: { close: number; changePct: number | null } | null; chart: string | null;
};
type Contract = { exchange: string; token: string; expiry: string; strike: number | null; right: "CE" | "PE" | null; lot: number };
type Underlying = { underlying: string; name: string; exchange: string };

const TITLES: Record<Section, string> = { index: "Indices", future: "Futures", option: "Options" };
const f2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const big = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(2) + " L" : v.toLocaleString("en-IN"));
const tone = (v: number | null | undefined) => (v === null || v === undefined ? "text-muted" : v >= 0 ? "text-up" : "text-down");

async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Request failed");
  return d;
}

export function IconBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`grid h-7 w-7 place-items-center rounded-md border border-line text-sm hover:bg-white/5 ${danger ? "text-rose-300 hover:border-down/50" : "text-soft hover:text-white"}`}>
      {children}
    </button>
  );
}

/** Watchlist sections for indices, futures and options, each with add (＋), edit (✎) and delete (🗑). */
export function WatchSections() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [broker, setBroker] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ section: Section; replace?: Item } | null>(null);
  const [editing, setEditing] = useState<Section | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const d = await call("/api/watch");
      setItems(d.items);
      setBroker(d.broker);
      setErr(d.error ?? null);
      if (d.broker) timer.current = setTimeout(() => whenVisible(() => loadRef.current()), 20_000);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    loadRef.current = load;
    Promise.resolve().then(load);
    return () => clearTimeout(timer.current);
  }, [load]);

  const add = async (section: Section, exchange: string, key: string, replace?: Item) => {
    try {
      if (replace) await call(`/api/watch/${replace.id}`, "PATCH", { section, exchange, key });
      else await call("/api/watch", "POST", { section, exchange, key });
      setErr(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async (it: Item) => {
    setItems((x) => x?.filter((i) => i.id !== it.id) ?? x);
    await call(`/api/watch/${it.id}`, "DELETE").catch((e) => setErr(e.message));
    load();
  };
  const clearSection = async (s: Section) => {
    const list = (items ?? []).filter((i) => i.section === s);
    if (!list.length || !confirm(`Remove all ${list.length} ${TITLES[s].toLowerCase()} from your watchlist?`)) return;
    setItems((x) => x?.filter((i) => i.section !== s) ?? x);
    await Promise.all(list.map((i) => call(`/api/watch/${i.id}`, "DELETE").catch(() => {})));
    load();
  };

  return (
    <div className="space-y-4">
      {err && <p role="alert" className="text-xs text-gold">{err}</p>}
      {(["index", "future", "option"] as Section[]).map((s) => {
        const list = (items ?? []).filter((i) => i.section === s);
        const isEdit = editing === s;
        return (
          <section key={s} aria-labelledby={`ws-${s}`} className="overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <h2 id={`ws-${s}`} className="font-semibold">{TITLES[s]} <span className="text-xs font-normal text-muted">{list.length}</span></h2>
              {broker && <span className="rounded-full bg-up/15 px-2 py-0.5 text-[10px] text-up">Live · {broker}</span>}
              <div className="ml-auto flex gap-1.5">
                <IconBtn label={`Add to ${TITLES[s]}`} onClick={() => setPicker({ section: s })}>＋</IconBtn>
                <IconBtn label={isEdit ? "Done editing" : `Edit ${TITLES[s]}`} onClick={() => setEditing(isEdit ? null : s)}>{isEdit ? "✓" : "✎"}</IconBtn>
                <IconBtn label={`Delete all ${TITLES[s]}`} onClick={() => clearSection(s)} danger>🗑</IconBtn>
              </div>
            </div>
            {items === null ? (
              <div className="h-16 animate-pulse bg-white/[0.02]" />
            ) : !list.length ? (
              <p className="px-4 py-5 text-sm text-muted">
                Nothing here yet. <button onClick={() => setPicker({ section: s })} className="text-accent hover:underline">＋ Add {s === "index" ? "an index" : s === "future" ? "a futures contract" : "an option contract"}</button>
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-xs text-muted">
                    <tr className="text-right">
                      <th className="px-4 py-2 text-left font-medium">{s === "index" ? "Index" : "Contract"}</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Change</th>
                      <th className="px-3 py-2 font-medium">High</th>
                      <th className="px-3 py-2 font-medium">Low</th>
                      {s !== "index" && <th className="px-3 py-2 font-medium">OI</th>}
                      {s !== "index" && <th className="px-3 py-2 font-medium">Volume</th>}
                      <th className="w-24 px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((it) => {
                      const price = it.quote?.ltp ?? it.eod?.close ?? null;
                      const pct = it.quote ? it.quote.changePct : it.eod?.changePct ?? null;
                      return (
                        <tr key={it.id} className="border-t border-line hover:bg-white/[0.03]">
                          <td className="px-4 py-2">
                            {it.chart ? <Link href={`/charts?symbol=${encodeURIComponent(it.chart)}`} className="font-medium hover:text-accent">{it.label}</Link> : <span className="text-muted line-through">{it.label}</span>}
                            <span className="block text-[11px] text-muted">
                              {it.expired ? "Expired" : s === "index" ? it.exchange : `${it.exchange} · lot ${it.meta.lot ?? "—"}`}
                              {s === "option" && it.meta.underlying && !it.expired && <> · <Link href={`/options?u=${it.meta.underlying}`} className="hover:text-accent">chain</Link></>}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{f2(price)}</td>
                          <td className={`px-3 py-2 text-right font-mono tabular-nums ${tone(pct)}`}>{pct === null ? "—" : `${it.quote?.change != null ? `${it.quote.change >= 0 ? "+" : ""}${f2(it.quote.change)} ` : ""}(${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-soft">{f2(it.quote?.high)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-soft">{f2(it.quote?.low)}</td>
                          {s !== "index" && <td className="px-3 py-2 text-right font-mono tabular-nums">{big(it.quote?.oi)}</td>}
                          {s !== "index" && <td className="px-3 py-2 text-right font-mono tabular-nums">{big(it.quote?.volume)}</td>}
                          <td className="px-3 py-2">
                            <div className={`flex justify-end gap-1 ${isEdit ? "" : "opacity-60 hover:opacity-100"}`}>
                              <IconBtn label={`Change ${it.label}`} onClick={() => setPicker({ section: s, replace: it })}>✎</IconBtn>
                              <IconBtn label={`Remove ${it.label}`} onClick={() => remove(it)} danger>🗑</IconBtn>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {picker?.section === "index" && (
        <IndexPicker
          title={picker.replace ? `Replace ${picker.replace.label}` : "Add an index"}
          mode="single"
          onPick={(i) => { add("index", i.group, i.key, picker.replace); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker && picker.section !== "index" && (
        <ContractPicker
          type={picker.section}
          initial={picker.replace?.meta.underlying}
          title={picker.replace ? `Replace ${picker.replace.label}` : picker.section === "future" ? "Add a futures contract" : "Add an option contract"}
          onPick={(c) => { add(picker.section, c.exchange, c.token, picker.replace); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

let underlyingCache: Underlying[] | null = null;

function ContractPicker({ type, title, initial, onPick, onClose }: { type: "future" | "option"; title: string; initial?: string; onPick: (c: Contract) => void; onClose: () => void }) {
  const [unders, setUnders] = useState<Underlying[]>(underlyingCache ?? []);
  const [q, setQ] = useState(initial ?? "");
  const [u, setU] = useState<string | null>(initial ?? null);
  const [data, setData] = useState<{ expiries: { expiry: string }[]; expiry?: string; contracts: Contract[] } | null>(null);
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [right, setRight] = useState<"CE" | "PE">("CE");

  useEffect(() => {
    if (underlyingCache) return;
    call("/api/options/underlyings").then((d) => {
      const m = (s: { symbol: string; name: string; exchange: string }) => ({ underlying: s.symbol, name: s.name, exchange: s.exchange });
      underlyingCache = [...d.indices.map(m), ...d.stocks.map(m)];
      setUnders(underlyingCache);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!u) return;
    let alive = true;
    call(`/api/watch/contracts?underlying=${encodeURIComponent(u)}&type=${type}${expiry ? `&expiry=${expiry}` : ""}`).then((d) => alive && setData(d)).catch(() => alive && setData({ expiries: [], contracts: [] }));
    return () => { alive = false; };
  }, [u, type, expiry]);

  const matches = useMemo(() => {
    const t = q.trim().toUpperCase();
    return unders.filter((x) => !t || x.underlying.includes(t) || x.name.toUpperCase().includes(t)).slice(0, 40);
  }, [q, unders]);
  const strikes = (data?.contracts ?? []).filter((c) => c.right === right);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 text-muted hover:bg-white/10 hover:text-white">✕</button>
        </div>
        {!u ? (
          <>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search index or stock (e.g. NIFTY, RELIANCE)" aria-label="Search underlying" className="m-3 rounded-lg border border-line bg-ink px-3 py-2 text-sm" />
            <ul className="min-h-0 flex-1 overflow-auto pb-2">
              {matches.map((m) => (
                <li key={m.exchange + m.underlying}>
                  <button onClick={() => { setU(m.underlying); setData(null); setExpiry(undefined); }} className="flex w-full justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-white/5">
                    <span className="font-mono">{m.underlying}</span><span className="truncate text-xs text-muted">{m.name}</span>
                  </button>
                </li>
              ))}
              {!unders.length && <li className="px-4 py-2 text-xs text-muted">Loading…</li>}
            </ul>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <button onClick={() => { setU(null); setData(null); }} className="mb-3 text-xs text-accent hover:underline">← {u} · change underlying</button>
            {!data ? <p className="text-sm text-muted">Loading contracts…</p> : type === "future" ? (
              <ul className="space-y-1.5">
                {data.contracts.map((c) => (
                  <li key={c.token}>
                    <button onClick={() => onPick(c)} className="flex w-full justify-between rounded-lg border border-line px-3 py-2 text-sm hover:border-accent">
                      <span>{u} {new Date(c.expiry + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} FUT</span>
                      <span className="text-xs text-muted">{c.exchange} · lot {c.lot}</span>
                    </button>
                  </li>
                ))}
                {!data.contracts.length && <li className="text-sm text-muted">No futures listed for {u}.</li>}
              </ul>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <select value={data.expiry ?? ""} onChange={(e) => setExpiry(e.target.value)} aria-label="Expiry" className="rounded-lg border border-line bg-ink px-2 py-1.5 text-sm">
                    {data.expiries.map((e) => <option key={e.expiry} value={e.expiry}>{e.expiry}</option>)}
                  </select>
                  <div className="flex overflow-hidden rounded-lg border border-line text-sm">
                    {(["CE", "PE"] as const).map((r) => (
                      <button key={r} onClick={() => setRight(r)} aria-pressed={right === r} className={`px-3 py-1.5 ${right === r ? "bg-white text-slate-950" : "text-soft hover:bg-white/5"}`}>{r === "CE" ? "Call" : "Put"}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {strikes.map((c) => (
                    <button key={c.token} onClick={() => onPick(c)} className="rounded-md border border-line px-2 py-1.5 font-mono text-xs hover:border-accent">{c.strike}</button>
                  ))}
                </div>
                {!strikes.length && <p className="text-sm text-muted">No options listed for this expiry.</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
