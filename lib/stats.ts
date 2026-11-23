// Pure statistics helpers (unit-tested).

/** Beta and correlation of a stock's daily returns against an index, over the dates both traded. */
export function betaCorr(
  stock: { d: string; c: number }[],
  index: Map<string, number>,
  maxDays = 250,
): { beta: number | null; corr: number | null } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = Math.max(1, stock.length - maxDays); i < stock.length; i++) {
    const a = stock[i - 1];
    const b = stock[i];
    const ia = index.get(a.d);
    const ib = index.get(b.d);
    if (!ia || !ib || !a.c || !b.c) continue;
    ys.push(b.c / a.c - 1);
    xs.push(ib / ia - 1);
  }
  const n = xs.length;
  if (n < 30) return { beta: null, corr: null };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) ** 2;
    vy += (ys[i] - my) ** 2;
  }
  if (!vx || !vy) return { beta: null, corr: null };
  return { beta: cov / vx, corr: cov / Math.sqrt(vx * vy) };
}
