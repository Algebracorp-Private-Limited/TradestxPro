export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-56 animate-pulse rounded bg-white/[0.06]" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-white/[0.04]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-panel" />)}
      </div>
      <div className="h-80 animate-pulse rounded-xl border border-line bg-panel" />
    </div>
  );
}
