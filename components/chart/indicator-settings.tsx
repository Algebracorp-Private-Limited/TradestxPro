"use client";

import { useState } from "react";
import { INDICATOR_BY_ID, withDefaults, type Bar, type HistColors, type OutputFill, type PaneBand } from "@/lib/ta/catalog";
import { ALL_VISIBLE, factoryReset, saveAsDefault, type ActiveIndicator, type FillStyle, type LineDash, type OutputStyle, type TfVisibility } from "@/lib/ta/indicator-settings";

const tabCls = (on: boolean) => `border-b-2 px-1 pb-2 text-sm font-semibold ${on ? "border-white text-white" : "border-transparent text-muted hover:text-white"}`;
const inputCls = "w-28 rounded-lg border border-line bg-ink px-2.5 py-1.5 text-sm text-soft focus:border-accent focus:outline-none";
const WIDTHS = [1, 1.4, 2, 3, 4];
const DASHES: [LineDash, string][] = [["solid", "━━"], ["dashed", "╍╍"], ["dotted", "┈┈"]];
const swatch = "h-7 w-8 cursor-pointer rounded border border-line bg-ink p-0.5";
const pct = (v: number) => `${Math.round(v * 100)}%`;

function Opacity({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted" title="Opacity">
      <input type="range" min={0} max={100} step={5} value={Math.round(value * 100)} onChange={(e) => onChange(Number(e.target.value) / 100)} aria-label={`${label} opacity`} className="w-20 accent-sky-400" />
      <span className="w-8 text-right font-mono">{pct(value)}</span>
    </label>
  );
}

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
  const [tab, setTab] = useState<"inputs" | "style" | "visibility" | "precision">("inputs");
  const [menu, setMenu] = useState(false);
  if (!def) return null;

  const params = withDefaults(def, draft.params);
  // Outputs, fills and zones for the style tab, from the current inputs.
  let outputs: { key: string; label: string; color: string; width?: number; opacity?: number; style?: string; hist?: HistColors; fills?: OutputFill[] }[] = [];
  try {
    outputs = def.compute(bars.slice(-300), params, { intraday: true }).map((o) => ({ key: o.key, label: o.label, color: o.color, width: o.width, opacity: o.opacity, style: o.style, hist: o.hist, fills: o.fills }));
  } catch {}
  const fills = outputs.flatMap((o) => o.fills ?? []);
  let bands: PaneBand[] = [];
  try {
    bands = def.bands?.(params) ?? [];
  } catch {}

  const setParam = (k: string, v: number) => setDraft((d) => ({ ...d, params: { ...withDefaults(def, d.params), [k]: v } }));
  const setStyle = (k: string, patch: OutputStyle) =>
    setDraft((d) => ({ ...d, styles: { ...(d.styles ?? {}), [k]: { ...(d.styles?.[k] ?? {}), ...patch } } }));
  const setFill = (k: string, patch: FillStyle) =>
    setDraft((d) => ({ ...d, fills: { ...(d.fills ?? {}), [k]: { ...(d.fills?.[k] ?? {}), ...patch } } }));
  const vis = draft.visibility ?? ALL_VISIBLE;
  const groups = [...new Set(def.params.map((p) => p.group ?? "Inputs"))];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${def.name} settings`} onClick={(e) => e.stopPropagation()} className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-lg font-semibold">{def.name}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-muted hover:bg-white/5">✕</button>
        </div>
        <div role="tablist" className="mt-3 flex gap-5 border-b border-line px-5">
          {(["inputs", "style", "visibility", "precision"] as const).map((t) => (
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
                        <input type="checkbox" checked={params[p.key] === 1} onChange={(e) => setParam(p.key, e.target.checked ? 1 : 0)} className="h-4 w-4 accent-sky-400" />
                        {p.label}
                      </span>
                    ) : (
                      <>
                        <span>{p.label}</span>
                        {p.kind === "select" ? (
                          <select value={params[p.key]} onChange={(e) => setParam(p.key, Number(e.target.value))} className={`${inputCls} w-40`}>
                            {p.options!.map((o, i) => <option key={o} value={i}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step ?? 1}
                            value={params[p.key]}
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
              <section className="space-y-3">
                <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">Plots</h3>
                {outputs.length === 0 && <p className="text-sm text-muted">Nothing to style for the current inputs.</p>}
                {outputs.map((o) => {
                  const st = draft.styles?.[o.key] ?? {};
                  const on = st.visible !== false;
                  return (
                    <div key={o.key} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <label className="flex min-w-0 items-center gap-2.5 text-soft">
                          <input type="checkbox" checked={on} onChange={(e) => setStyle(o.key, { visible: e.target.checked })} className="h-4 w-4 accent-sky-400" />
                          <span className="truncate">{o.label}</span>
                        </label>
                        {!o.hist && (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <input type="color" aria-label={`${o.label} colour`} value={st.color ?? o.color} onChange={(e) => setStyle(o.key, { color: e.target.value })} className={swatch} />
                            <select aria-label={`${o.label} line width`} value={st.width ?? o.width ?? 1.4} onChange={(e) => setStyle(o.key, { width: Number(e.target.value) })} className="rounded-lg border border-line bg-ink px-1 py-1 text-xs text-soft">
                              {[...new Set([...WIDTHS, st.width ?? o.width ?? 1.4])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w}px</option>)}
                            </select>
                            {o.style !== "dots" && (
                              <select aria-label={`${o.label} line style`} value={st.dash ?? "solid"} onChange={(e) => setStyle(o.key, { dash: e.target.value as LineDash })} className="rounded-lg border border-line bg-ink px-1 py-1 text-xs text-soft">
                                {DASHES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                              </select>
                            )}
                          </span>
                        )}
                      </div>
                      {o.hist && (
                        <div className="ml-6 grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {o.hist.colors.map((c, k) => (
                            <label key={k} className="flex items-center gap-2 text-[11px] text-muted">
                              <input type="color" aria-label={`${o.label} ${o.hist!.labels[k]} colour`} value={st.colors?.[k] ?? c}
                                onChange={(e) => { const next = [...(st.colors ?? o.hist!.colors)]; next[k] = e.target.value; setStyle(o.key, { colors: next }); }} className={swatch} />
                              {o.hist!.labels[k]}
                            </label>
                          ))}
                        </div>
                      )}
                      <div className="ml-6"><Opacity label={o.label} value={st.opacity ?? o.opacity ?? 1} onChange={(v) => setStyle(o.key, { opacity: v })} /></div>
                    </div>
                  );
                })}
              </section>
              {(fills.length > 0 || bands.length > 0) && (
                <section className="space-y-3 border-t border-line pt-4">
                  <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">Fills &amp; zones</h3>
                  {[...fills.map((f) => ({ id: f.id, label: f.label, up: f.up, down: f.down, opacity: f.opacity, two: f.up !== f.down, visible: f.visible })),
                    ...bands.map((b) => ({ id: b.id, label: b.label, up: b.color, down: b.color, opacity: b.opacity, two: false, visible: b.visible }))].map((f) => {
                    const fs = draft.fills?.[f.id] ?? {};
                    return (
                      <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <label className="flex min-w-0 items-center gap-2.5 text-soft">
                          <input type="checkbox" checked={(fs.visible ?? f.visible ?? true) !== false} onChange={(e) => setFill(f.id, { visible: e.target.checked })} className="h-4 w-4 accent-sky-400" />
                          <span className="truncate">{f.label}</span>
                        </label>
                        <span className="flex items-center gap-1.5">
                          <input type="color" aria-label={`${f.label} ${f.two ? "bullish " : ""}colour`} title={f.two ? "Bullish (above)" : "Colour"} value={fs.color ?? f.up} onChange={(e) => setFill(f.id, { color: e.target.value })} className={swatch} />
                          {f.two && <input type="color" aria-label={`${f.label} bearish colour`} title="Bearish (below)" value={fs.down ?? f.down} onChange={(e) => setFill(f.id, { down: e.target.value })} className={swatch} />}
                          <Opacity label={f.label} value={fs.opacity ?? f.opacity} onChange={(v) => setFill(f.id, { opacity: v })} />
                        </span>
                      </div>
                    );
                  })}
                </section>
              )}
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

          {tab === "precision" && (
            <section className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm text-soft">
                Decimal places
                <select value={draft.precision ?? "auto"} onChange={(e) => setDraft((d) => ({ ...d, precision: e.target.value === "auto" ? undefined : Number(e.target.value) }))} className={`${inputCls} w-40`}>
                  <option value="auto">Default (automatic)</option>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n === 0 ? "0 (whole numbers)" : `${n} · ${(1 / 10 ** n).toFixed(n)}`}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted">Applies to this indicator&apos;s values in the legend and its labels on the price scale.</p>
            </section>
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
