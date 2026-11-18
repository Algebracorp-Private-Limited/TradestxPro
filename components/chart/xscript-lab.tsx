"use client";

import { useEffect, useRef, useState } from "react";
import { EXAMPLE_SCRIPTS, XSCRIPT_FUNCTIONS, type XInput } from "@/lib/xscript/xscript";

export type AppliedScript = { uid: string; name: string; code: string; inputs: Record<string, number> };
type Saved = { id: number; name: string; code: string; updatedAt: string };

async function call(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? "Request failed");
  return d;
}

type Props = {
  applied: AppliedScript[];
  onApply: (s: AppliedScript) => void;
  onRemove: (uid: string) => void;
  onInputs: (uid: string, inputs: Record<string, number>) => void;
  status: Record<string, { error?: string; inputs?: XInput[]; ms?: number; title?: string }>;
  onClose: () => void;
};

export function XScriptLab({ applied, onApply, onRemove, onInputs, status, onClose }: Props) {
  const [code, setCode] = useState(EXAMPLE_SCRIPTS[0].code);
  const [name, setName] = useState(EXAMPLE_SCRIPTS[0].name);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [showRef, setShowRef] = useState(false);
  const gutter = useRef<HTMLDivElement>(null);
  const editorUid = "editor";
  const st = status[editorUid];

  const loadSaved = () => call("/api/scripts").then((d) => setSaved(d.scripts)).catch(() => {});
  useEffect(() => {
    call("/api/scripts").then((d) => setSaved(d.scripts)).catch(() => {});
    try {
      const draft = localStorage.getItem("txp.xscript.draft");
      if (draft) {
        const d = JSON.parse(draft);
        Promise.resolve().then(() => {
          setCode(String(d.code ?? ""));
          setName(String(d.name ?? "Untitled"));
          setSavedId(typeof d.id === "number" ? d.id : null);
        });
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("txp.xscript.draft", JSON.stringify({ code, name, id: savedId })); } catch {}
  }, [code, name, savedId]);

  const run = () => {
    const prev = applied.find((a) => a.uid === editorUid);
    onApply({ uid: editorUid, name, code, inputs: prev?.inputs ?? {} });
    setMsg(null);
  };

  const save = async (asNew: boolean) => {
    try {
      if (savedId && !asNew) await call(`/api/scripts/${savedId}`, "PATCH", { name, code });
      else setSavedId((await call("/api/scripts", "POST", { name, code })).id);
      setMsg("Saved to your account.");
      loadSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const lines = code.split("\n").length;

  return (
    <section aria-label="XScript Lab" className="flex h-full min-h-0 flex-col border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="font-mono text-sm font-semibold text-accent">{"{}"} XScript Lab</span>
        <button onClick={onClose} aria-label="Close lab" className="rounded px-2 py-1 text-muted hover:bg-white/5">✕</button>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Script name" className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-xs" />
        <select
          aria-label="Open script"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith("ex:")) {
              const ex = EXAMPLE_SCRIPTS[Number(v.slice(3))];
              setCode(ex.code);
              setName(ex.name);
              setSavedId(null);
            } else if (v.startsWith("s:")) {
              const s = saved.find((x) => x.id === Number(v.slice(2)));
              if (s) {
                setCode(s.code);
                setName(s.name);
                setSavedId(s.id);
              }
            } else if (v === "new") {
              setCode('indicator("My indicator", overlay=true)\nplot(sma(close, 20), "SMA 20")\n');
              setName("My indicator");
              setSavedId(null);
            }
          }}
          className="rounded-md border border-line bg-ink px-2 py-1 text-xs text-soft"
        >
          <option value="">Open…</option>
          <option value="new">New script</option>
          <optgroup label="Examples">
            {EXAMPLE_SCRIPTS.map((e, i) => <option key={e.name} value={`ex:${i}`}>{e.name}</option>)}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="My scripts">
              {saved.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden font-mono text-[12.5px] leading-5">
        <div ref={gutter} aria-hidden className="select-none overflow-hidden border-r border-line bg-ink/60 px-2 py-2 text-right text-muted/60">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={st?.error && st.error.startsWith(`Line ${i + 1}:`) ? "text-rose-400" : ""}>{i + 1}</div>
          ))}
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              run();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const t = e.currentTarget;
              const s = t.selectionStart;
              setCode(code.slice(0, s) + "  " + code.slice(t.selectionEnd));
              requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
            }
          }}
          spellCheck={false}
          aria-label="XScript code"
          className="min-h-0 flex-1 resize-none whitespace-pre bg-ink px-3 py-2 text-soft focus:outline-none"
        />
      </div>

      {st?.error ? (
        <p role="alert" className="border-t border-down/40 bg-down/10 px-3 py-2 font-mono text-xs text-rose-200">{st.error}</p>
      ) : st?.ms !== undefined ? (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">✓ Ran “{st.title}” in {st.ms.toFixed(1)} ms</p>
      ) : null}

      {st?.inputs && st.inputs.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
          {st.inputs.map((inp) => (
            <label key={inp.name} className="flex items-center gap-1.5 text-xs text-muted">
              {inp.title}
              <input
                type="number"
                value={inp.value}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  const cur = applied.find((a) => a.uid === editorUid)?.inputs ?? {};
                  if (Number.isFinite(v)) onInputs(editorUid, { ...cur, [inp.name]: v });
                }}
                className="w-16 rounded border border-line bg-ink px-1.5 py-0.5 text-right font-mono text-soft"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <button onClick={run} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-slate-200">▶ Run on chart <span className="opacity-60">Ctrl+Enter</span></button>
        <button
          onClick={() => {
            onApply({ uid: `pin-${Date.now()}`, name, code, inputs: applied.find((a) => a.uid === editorUid)?.inputs ?? {} });
            onRemove(editorUid);
          }}
          className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-white/5"
        >
          Pin to chart
        </button>
        <button onClick={() => save(false)} className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-white/5">{savedId ? "Save" : "Save to account"}</button>
        {savedId && <button onClick={() => save(true)} className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-white/5">Save as new</button>}
        {savedId && (
          <button
            onClick={async () => {
              if (!confirm(`Delete “${name}” from your account?`)) return;
              try {
                await call(`/api/scripts/${savedId}`, "DELETE");
                setSavedId(null);
                loadSaved();
                setMsg("Deleted.");
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
            className="rounded-md px-2 py-1.5 text-xs text-rose-300 hover:bg-down/10"
          >
            Delete
          </button>
        )}
        <button onClick={() => setShowRef((s) => !s)} aria-expanded={showRef} className="ml-auto text-xs text-accent hover:underline">{showRef ? "Hide" : "Show"} reference</button>
        {msg && <span role="status" className="w-full text-xs text-muted">{msg}</span>}
      </div>

      {applied.some((a) => a.uid !== editorUid) && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
          <span className="text-[11px] text-muted">Pinned:</span>
          {applied.filter((a) => a.uid !== editorUid).map((a) => (
            <span key={a.uid} className="flex items-center rounded border border-line text-[11px]">
              <span className="px-1.5 py-0.5">{status[a.uid]?.title ?? a.name}{status[a.uid]?.error ? " ⚠" : ""}</span>
              <button onClick={() => onRemove(a.uid)} aria-label={`Unpin ${a.name}`} className="border-l border-line px-1 text-muted hover:text-rose-300">✕</button>
            </span>
          ))}
        </div>
      )}

      {showRef && (
        <div className="max-h-56 overflow-auto border-t border-line px-3 py-2 text-xs">
          {XSCRIPT_FUNCTIONS.map((g) => (
            <div key={g.group} className="mb-2">
              <p className="mb-0.5 text-muted">{g.group}</p>
              <p className="font-mono leading-5 text-soft">{g.items.join("  ·  ")}</p>
            </div>
          ))}
          <p className="text-muted">Operators: + − * / %  ==  !=  &lt;  &gt;  and  or  not. Comments start with //.</p>
        </div>
      )}
    </section>
  );
}
