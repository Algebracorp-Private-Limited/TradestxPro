"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type List = { id: number; name: string; items: { id: number }[] };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function AddToWatchlist({ instrumentId }: { instrumentId: number }) {
  const [lists, setLists] = useState<List[] | null>(null);
  const [selected, setSelected] = useState<number | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function apply(d: { watchlists: List[] }) {
    setLists(d.watchlists);
    setSelected((s) => (s === "" && d.watchlists[0] ? d.watchlists[0].id : s));
  }
  const load = () => call("/api/watchlists", "GET").then(apply);
  useEffect(() => {
    call("/api/watchlists", "GET").then(apply).catch(() => setLists([]));
  }, []);

  const inSelected = lists?.find((l) => l.id === selected)?.items.some((i) => i.id === instrumentId);

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      let id = selected;
      if (id === "") {
        id = (await call("/api/watchlists", "POST", { name: "My watchlist" })).id as number;
        setSelected(id);
      }
      if (inSelected) {
        await call(`/api/watchlists/${id}/items/${instrumentId}`, "DELETE");
        setMsg({ ok: true, text: "Removed from watchlist." });
      } else {
        await call(`/api/watchlists/${id}/items`, "POST", { instrumentId });
        setMsg({ ok: true, text: "Added to watchlist." });
      }
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {lists && lists.length > 1 && (
        <select
          aria-label="Choose watchlist"
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
          className="rounded-lg border border-line bg-ink px-2 py-2 text-sm text-soft"
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      )}
      <button
        onClick={add}
        disabled={busy || lists === null}
        className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${inSelected ? "border border-line text-soft hover:bg-white/5" : "bg-white text-slate-950 hover:bg-slate-200"}`}
      >
        {inSelected ? "★ In watchlist — remove" : "☆ Add to watchlist"}
      </button>
      {msg && (
        <span role="status" className={`text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>
          {msg.text} {msg.ok && <Link href="/watchlists" className="underline">View</Link>}
        </span>
      )}
    </div>
  );
}
