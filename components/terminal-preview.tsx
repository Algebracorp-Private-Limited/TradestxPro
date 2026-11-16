// Static illustration of the terminal layout. Deliberately unlabelled numbers are avoided:
// the blueprint forbids presenting sample values as live market data.

function seededCandles(count: number) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let price = 100;
  return Array.from({ length: count }, () => {
    const open = price;
    const close = open + (rand() - 0.46) * 6;
    const high = Math.max(open, close) + rand() * 3;
    const low = Math.min(open, close) - rand() * 3;
    price = close;
    return { open, close, high, low };
  });
}

const candles = seededCandles(42);
const lo = Math.min(...candles.map((c) => c.low));
const hi = Math.max(...candles.map((c) => c.high));
const W = 520;
const H = 220;
const y = (v: number) => H - 10 - ((v - lo) / (hi - lo)) * (H - 20);

export function TerminalPreview() {
  const step = W / candles.length;
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-sky-950/40">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </div>
        <span className="rounded-md border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-gold">
          Illustration · not market data
        </span>
      </div>
      <div className="grid grid-cols-[1fr] sm:grid-cols-[1fr_150px]">
        <div className="border-line p-4 sm:border-r">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded bg-white/5 px-2 py-1 font-mono text-soft">INDEX · 1D</span>
            <span className="rounded bg-white/5 px-2 py-1">EMA 20</span>
            <span className="rounded bg-white/5 px-2 py-1">RSI 14</span>
            <span className="rounded bg-white/5 px-2 py-1">VWAP</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Illustrative candlestick chart">
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgb(255 255 255 / 0.06)" />
            ))}
            {candles.map((c, i) => {
              const up = c.close >= c.open;
              const x = i * step + step / 2;
              const color = up ? "var(--color-up)" : "var(--color-down)";
              return (
                <g key={i}>
                  <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1" />
                  <rect
                    x={x - step * 0.32}
                    width={step * 0.64}
                    y={y(Math.max(c.open, c.close))}
                    height={Math.max(1.5, Math.abs(y(c.open) - y(c.close)))}
                    fill={color}
                    rx="1"
                  />
                </g>
              );
            })}
            <polyline
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1.5"
              opacity="0.8"
              points={candles
                .map((_, i) => {
                  const win = candles.slice(Math.max(0, i - 7), i + 1);
                  const avg = win.reduce((s, c) => s + c.close, 0) / win.length;
                  return `${i * step + step / 2},${y(avg)}`;
                })
                .join(" ")}
            />
          </svg>
        </div>
        <div className="hidden space-y-2 p-3 sm:block">
          <p className="text-[11px] uppercase tracking-wider text-muted">Watchlist</p>
          {["Index", "Bank", "IT", "Auto", "Metal", "Pharma"].map((n, i) => (
            <div key={n} className="flex items-center justify-between rounded-md bg-white/[0.03] px-2 py-1.5 text-xs">
              <span className="text-soft">{n}</span>
              <span className={`h-1.5 w-8 rounded-full ${i % 3 === 1 ? "bg-down/60" : "bg-up/60"}`} aria-hidden />
            </div>
          ))}
          <div className="mt-3 rounded-md border border-accent/30 bg-sky-400/5 p-2 text-[11px] leading-4 text-soft">
            <span className="text-accent">✦ AI</span> scenario: trend, levels, invalidation and evidence.
          </div>
        </div>
      </div>
    </figure>
  );
}
