"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BROKERS, type BrokerId, type BrokerInfo } from "@/lib/brokers/catalog";

type Conn = { broker: BrokerId; status: "pending" | "connected" | "expired" | "error"; label: string | null; connectedAt: string | null; expiresAt: string | null; lastError: string | null; hasSavedDetails: boolean };
type State = { configured: boolean; connections: Conn[]; available: Record<string, boolean> };

const input = "mt-1 block w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none";
const STATUS: Record<Conn["status"], { text: string; cls: string }> = {
  connected: { text: "Connected", cls: "bg-up/15 text-up" },
  expired: { text: "Session expired", cls: "bg-gold/15 text-gold" },
  pending: { text: "Waiting for login", cls: "bg-white/10 text-soft" },
  error: { text: "Error", cls: "bg-down/15 text-down" },
};

function BrokerCard({ b, conn, available, configured, onChange }: { b: BrokerInfo; conn?: Conn; available: boolean; configured: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const status = conn?.status;
  const connected = status === "connected";

  async function connect(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    setErr(null);
    setBusy(true);
    const fields = e ? Object.fromEntries(new FormData(e.currentTarget)) : {};
    try {
      const res = await fetch(`/api/brokers/${b.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not connect.");
      if (d.redirect) {
        window.location.assign(d.redirect);
        return;
      }
      setOpen(false);
      onChange();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(forget: boolean) {
    if (forget && !confirm(`Remove ${b.name} and delete the saved details?`)) return;
    await fetch(`/api/brokers/${b.id}${forget ? "?forget=1" : ""}`, { method: "DELETE" });
    onChange();
  }

  const needsForm = b.fields.length > 0;
  const disabled = !configured || !available;

  return (
    <article className="flex flex-col rounded-2xl border border-line bg-panel">
      <div className="flex items-start justify-between gap-3 p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{b.name}</h3>
            {b.stage === "beta" && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted">Beta</span>}
          </div>
          <p className="text-xs text-muted">{b.api}</p>
        </div>
        {status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${STATUS[status].cls}`}>{STATUS[status].text}</span>}
      </div>

      <div className="flex-1 space-y-2 px-5 text-sm">
        {connected && conn?.label && <p className="text-soft">Account: <span className="font-mono">{conn.label}</span></p>}
        {connected && conn?.expiresAt && (
          <p className="text-xs text-muted">Session valid until {new Date(conn.expiresAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST</p>
        )}
        {conn?.lastError && !connected && <p className="text-xs text-rose-300">{conn.lastError}</p>}
        <p className="text-xs text-muted">
          {b.features.history ? "Live charts with intraday history" : "Live quotes"} from your account.
        </p>
        {b.note && <p className="text-xs text-muted">{b.note}</p>}
        {!available && <p className="text-xs text-gold">Not enabled yet: the site owner needs to register a {b.api} app.</p>}
      </div>

      {open && (
        <div className="m-5 mb-0 space-y-3 rounded-xl border border-line bg-ink/50 p-4">
          <ol className="list-decimal space-y-1 pl-4 text-xs leading-5 text-soft">
            {b.steps.map((s) => <li key={s} className="break-words">{s}</li>)}
          </ol>
          {needsForm ? (
            <form onSubmit={connect} className="space-y-2.5" autoComplete="off">
              {b.fields.map((f) => (
                <label key={f.key} className="block text-xs text-soft">
                  {f.label}
                  {!f.store && <span className="ml-1 text-muted">(not stored)</span>}
                  <input
                    name={f.key}
                    type={f.type ?? "text"}
                    inputMode={f.inputMode}
                    placeholder={conn?.hasSavedDetails && f.store ? "Saved — leave blank to keep" : f.placeholder}
                    required={!(conn?.hasSavedDetails && f.store)}
                    autoComplete="off"
                    spellCheck={false}
                    className={input}
                  />
                  {f.help && <span className="mt-0.5 block text-[11px] text-muted">{f.help}</span>}
                </label>
              ))}
              <button disabled={busy} className="w-full rounded-lg bg-white py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:opacity-60">
                {busy ? "Connecting…" : b.mode === "form" ? "Connect" : `Continue to ${b.name} login`}
              </button>
            </form>
          ) : (
            <button onClick={() => connect()} disabled={busy} className="w-full rounded-lg bg-white py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:opacity-60">
              {busy ? "Redirecting…" : `Continue to ${b.name} login`}
            </button>
          )}
          {err && <p role="alert" className="text-xs text-rose-300">{err}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2 p-5">
        <button
          onClick={() => (open ? setOpen(false) : needsForm || !connected ? setOpen(true) : connect())}
          disabled={disabled}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${connected ? "border border-line text-soft hover:bg-white/5" : "bg-white text-slate-950 hover:bg-slate-200"}`}
        >
          {open ? "Cancel" : connected ? "Reconnect" : status === "expired" ? "Log in again" : "Connect"}
        </button>
        {connected && <button onClick={() => remove(false)} className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:bg-white/5">Disconnect</button>}
        {conn && <button onClick={() => remove(true)} className="rounded-lg px-2 py-1.5 text-sm text-rose-300 hover:bg-down/10">Remove</button>}
      </div>
    </article>
  );
}

export function BrokerConnections() {
  const params = useSearchParams();
  const [state, setState] = useState<State | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/brokers")
      .then((r) => r.json())
      .then((d) => (d.ok ? setState(d) : setLoadErr(d.error)))
      .catch(() => setLoadErr("Could not load broker connections."));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const ok = params.get("connected");
  const bad = params.get("error");

  return (
    <div className="space-y-5">
      {ok && <p role="status" className="rounded-xl border border-up/40 bg-up/10 px-4 py-3 text-sm text-emerald-200">Connected: {ok}. Charts for NSE stocks and main indices now use your broker&apos;s data, including intraday timeframes.</p>}
      {bad && <p role="alert" className="rounded-xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-rose-200">{bad}</p>}
      {state && !state.configured && (
        <p role="alert" className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          Broker connections are switched off until the site owner adds the <code className="font-mono">BROKER_ENC_KEY</code> setting.
        </p>
      )}
      {loadErr && <p role="alert" className="text-sm text-rose-300">{loadErr}</p>}
      {!state && !loadErr && <p className="text-sm text-muted">Loading…</p>}
      {state && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {BROKERS.map((b) => (
            <BrokerCard key={b.id} b={b} conn={state.connections.find((c) => c.broker === b.id)} available={state.available[b.id] !== false} configured={state.configured} onChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}
