"use client";

/**
 * "AI View" cell for option-chain rows. Shows the cached deterministic view (label + score); hover or
 * keyboard focus shows the concise analysis; click / tap / Enter opens the detailed contract panel.
 * No language-model request is made on hover.
 */
export type QuickView = { label: "Buy setup" | "Sell setup" | "Neutral" | "Avoid" | "No data"; buyScore: number | null; sellScore: number | null; reasons: string[] };

const TONE: Record<QuickView["label"], string> = {
  "Buy setup": "text-up border-up/40", "Sell setup": "text-gold border-gold/40", Neutral: "text-soft border-line", Avoid: "text-down border-down/40", "No data": "text-muted border-line",
};
const SHORT: Record<QuickView["label"], string> = { "Buy setup": "Buy", "Sell setup": "Sell", Neutral: "Neutral", Avoid: "Avoid", "No data": "—" };

export function AIViewCell({ view, side, strike, onOpen, restricted }: { view: QuickView | undefined; side: "CE" | "PE"; strike: number; onOpen: () => void; restricted?: boolean }) {
  if (restricted) return <span className="text-[10px] text-muted" title="AI View needs the research feature">—</span>;
  if (!view) return <span className="text-[10px] text-muted/50">…</span>;
  const score = view.label === "Sell setup" ? view.sellScore : view.buyScore;
  return (
    <span className="group relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TONE[view.label]} hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-accent`}
        aria-label={`AI view for ${strike} ${side}: ${view.label}${score !== null ? `, score ${score}` : ""}. Open contract analysis.`}
      >
        {SHORT[view.label]}{score !== null && view.label !== "No data" ? ` ${score}` : ""}
      </button>
      <span role="tooltip" className={`pointer-events-none absolute top-full z-30 mt-1 hidden w-64 rounded-lg border border-line bg-panel p-2 text-left text-[11px] font-normal leading-4 text-soft shadow-xl group-hover:block group-focus-within:block ${side === "CE" ? "left-0" : "right-0"}`}>
        <b className="text-white">{strike} {side} · {view.label}</b>
        <span className="block text-muted">Buy {view.buyScore ?? "—"} · Sell {view.sellScore ?? "—"} (scores, not probabilities)</span>
        {view.reasons.map((r) => <span key={r} className="block">• {r}</span>)}
        <span className="mt-1 block text-accent">Click for the full analysis</span>
      </span>
    </span>
  );
}
