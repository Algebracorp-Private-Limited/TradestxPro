"use client";

import { useState } from "react";
import { INDICATOR_BY_ID, type Bar } from "@/lib/ta/catalog";
import { ALL_VISIBLE, factoryReset, saveAsDefault, type ActiveIndicator, type TfVisibility } from "@/lib/ta/indicator-settings";

const tabCls = (on: boolean) => `border-b-2 px-1 pb-2 text-sm font-semibold ${on ? "border-white text-white" : "border-transparent text-muted hover:text-white"}`;
const inputCls = "w-28 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-sm text-soft focus:border-accent focus:outline-none";
const WIDTHS = [1, 1.4, 2, 3, 4];

export function IndicatorSettingsDialog({
  value,
  bars,
  onApply,
  onClose,
}: {
  value: ActiveIndicator;
  bars: Bar[];
  onApply: (v: ActiveIndicator) => void;
  onClose: () => void;
}) {
  const def = INDICATOR_BY_ID[value.id];
  const [draft, setDraft] = useState<ActiveIndicator>(value);
  const [tab, setTab] = useState<"inputs" | "style" | "visibility">("inputs");
  const [menu, setMenu] = useState(false);
  if (!def) return null;

  // Outputs for the style tab (computed once from current inputs).
  let outputs: { key: string; label: string; color: string }[] = [];
  try {
    outputs = def.compute(bars.slice(-300), draft.params, { intraday: true }).map((o) => ({ key: o.key, label: o.label, color: o.color }));
  } catch {}

  const setParam = (k: string, v: number) => setDraft((d) => ({ ...d, params: { ...d.params, [k]: v } }));
  const setStyle = (k: string, patch: Record<string, unknown>) =>
    setDraft((d) => ({ ...d, styles: { ...(d.styles ?? {}), [k]: { ...(d.styles?.[k] ?? {}), ...patch } } }));
  const vis = draft.visibility ?? ALL_VISIBLE;
  const groups = [...new Set(def.params.map((p) => p.group ?? "Inputs"))];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${def.name} settings`} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-lg font-semibold">{def.name}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-muted hover:bg-white/5">✕</button>
        </div>
        <div role="tablist" className="mt-3 flex gap-5 border-b border-line px-5">
          {(["inputs", "style", "visibility"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={tabCls(tab === t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4">
          {tab === "inputs" && (
            def.params.length === 0 ? <p className="text-sm text-muted">This indicator has no inputs.</p> : groups.map((g) => (
              <section key={g} className="space-y-3">
                {groups.length > 1 || g !== "Inputs" ? <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">{g}</h3> : null}
                {def.params.filter((p) => (p.group ?? "Inputs") === g).map((p) => (
                  <label key={p.key} className="flex items-center justify-between gap-3 text-sm text-soft">
                    {p.kind === "bool" ? (
                      <span className="flex items-center gap-2.5">
                        <input type="checkbox" checked={draft.params[p.key] === 1} onChange={(e) => setParam(p.key, e.target.checked ? 1 : 0)} className="h-4 w-4 accent-sky-400" />
                        {p.label}
                      </span>
                    ) : (
                      <>
                        <span>{p.label}</span>
                        {p.kind === "select" ? (
                          <select value={draft.params[p.key]} onChange={(e) => setParam(p.key, Number(e.target.value))} className={`${inputCls} w-40`}>
                            {p.options!.map((o, i) => <option key={o} value={i}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step ?? 1}
                            value={draft.params[p.key]}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v)) setParam(p.key, Math.min(p.max, Math.max(p.min, v)));
                            }}
                            className={`${inputCls} text-right font-mono`}
                          />
                        )}
                      </>
                    )}
                  </label>
                ))}
              </section>
            ))
          )}

          {tab === "style" && (
            <>
              <section className="space-y-2.5">
                {outputs.length === 0 && <p className="text-sm text-muted">Nothing to style for the current inputs.</p>}
                {outputs.map((o) => {
                  const st = draft.styles?.[o.key] ?? {};
                  return (
                    <div key={o.key} className="flex items-center justify-between gap-3 text-sm">
                      <label className="flex min-w-0 items-center gap-2.5 text-soft">
                        <input type="checkbox" checked={st.visible !== false} onChange={(e) => setStyle(o.key, { visible: e.target.checked })} className="h-4 w-4 accent-sky-400" />
                        <span className="truncate">{o.label}</span>
                      </label>
                      <span className="flex shrink-0 items-center gap-2">
                        <input type="color" aria-label={`${o.label} colour`} value={st.color ?? o.color} onChange={(e) => setStyle(o.key, { color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-line bg-ink" />
                        <select aria-label={`${o.label} line width`} value={st.width ?? 1.4} onChange={(e) => setStyle(o.key, { width: Number(e.target.value) })} className="rounded-lg border border-line bg-ink px-1.5 py-1.5 text-xs text-soft">
                          {WIDTHS.map((w) => <option key={w} value={w}>{w}px</option>)}
                        </select>
                      </span>
                    </div>
                  );
                })}
              </section>
              <section className="space-y-2.5 border-t border-line pt-4">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">Placement &amp; output</h3>
                <label className="flex items-center justify-between gap-3 text-sm text-soft">
                  Place on
                  <select value={draft.placement ?? def.pane} onChange={(e) => setDraft((d) => ({ ...d, placement: e.target.value as "overlay" | "separate" }))} className={`${inputCls} w-40`}>
                    <option value="overlay">Price chart</option>
                    <option value="separate">Separate pane</option>
                  </select>
                </label>
                {([
                  ["scaleLabels", "Labels on price scale"],
                  ["statusValues", "Values in status line"],
                  ["statusInputs", "Inputs in status line"],
                ] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2.5 text-sm text-soft">
                    <input type="checkbox" checked={draft[k] !== false} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.checked }))} className="h-4 w-4 accent-sky-400" />
                    {label}
                  </label>
                ))}
              </section>
            </>
          )}

          {tab === "visibility" && (
            <section className="space-y-2.5">
              <p className="text-xs text-muted">Show this indicator on these timeframes:</p>
              {(Object.keys(ALL_VISIBLE) as (keyof TfVisibility)[]).map((k) => (
                <label key={k} className="flex items-center gap-2.5 text-sm capitalize text-soft">
                  <input type="checkbox" checked={vis[k]} onChange={(e) => setDraft((d) => ({ ...d, visibility: { ...vis, [k]: e.target.checked } }))} className="h-4 w-4 accent-sky-400" />
                  {k}
                </label>
              ))}
            </section>
          )}
        </div>

        <div className="relative flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="rounded-lg border border-line px-3 py-1.5 text-sm text-soft hover:bg-white/5">Defaults ▾</button>
            {menu && (
              <div className="absolute bottom-full left-0 mb-1 w-48 overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
                <button onClick={() => { setDraft(factoryReset(draft)); setMenu(false); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5">Reset settings</button>
                <button onClick={() => { saveAsDefault(draft); setMenu(false); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5">Save as default</button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg border border-line px-4 py-1.5 text-sm hover:bg-white/5">Cancel</button>
            <button onClick={() => { onApply(draft); onClose(); }} className="rounded-lg bg-white px-5 py-1.5 text-sm font-semibold text-slate-950 hover:bg-slate-200">Ok</button>
          </div>
        </div>
      </div>
    </div>
  );
}
