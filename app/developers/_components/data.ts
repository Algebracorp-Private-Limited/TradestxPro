/** Synthetic candles for demos (deterministic random walk). Never real market data. */
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export function synthetic(n: number, opts: { seed?: number; start?: number; step?: number; base?: number; vol?: number } = {}): Candle[] {
  let s = opts.seed ?? 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const base = opts.base ?? 1000, vol = opts.vol ?? 0.01, step = opts.step ?? 86400;
  let p = base;
  const start = opts.start ?? Date.UTC(2024, 0, 1) / 1000;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = Math.max(1, o * (1 + (rnd() - 0.49) * vol * 2));
    const h = Math.max(o, c) * (1 + rnd() * vol * 0.6), l = Math.min(o, c) * (1 - rnd() * vol * 0.6);
    p = c;
    return { time: start + i * step, open: +o.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), close: +c.toFixed(2), volume: Math.round(50_000 + rnd() * 200_000) };
  });
}
