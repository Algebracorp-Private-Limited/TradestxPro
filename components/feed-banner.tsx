export function FeedBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-xl border border-gold/40 bg-gold/[0.07] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        <strong className="text-gold">Price feed not connected.</strong>{" "}
        {!compact && (
          <span className="text-soft">
            Instrument and contract data below is from the exchange master. Live prices appear once a licensed feed is connected.
          </span>
        )}
      </span>
      <span className="font-mono text-xs text-muted">feed: offline</span>
    </div>
  );
}

export function Dash() {
  return <span className="text-muted/60" aria-label="No data">—</span>;
}
