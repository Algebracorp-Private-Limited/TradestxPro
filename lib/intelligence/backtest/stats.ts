/** Trade statistics and score calibration (pure). Observed frequencies, not probability forecasts. */
export type TradeResult = { date: string; score: number | null; setup: string; exitReason: "TARGET" | "STOP" | "TIME_EXIT"; r: number; netR: number; sessionsHeld: number };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [r2(Math.max(0, c - h) * 100), r2(Math.min(1, c + h) * 100)];
}

export function tradeStats(trades: TradeResult[]) {
  const n = trades.length;
  if (!n) return { n: 0, wins: 0, winRatePct: null, avgR: null, avgNetR: null, profitFactor: null, maxDrawdownR: null, avgSessions: null, byExit: {}, equityCurve: [] as { date: string; cumR: number }[], winRateCi: null };
  const wins = trades.filter((t) => t.netR > 0).length;
  const gp = trades.filter((t) => t.netR > 0).reduce((a, t) => a + t.netR, 0), gl = -trades.filter((t) => t.netR < 0).reduce((a, t) => a + t.netR, 0);
  let cum = 0, peak = 0, dd = 0;
  const equityCurve = [...trades].sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => {
    cum += t.netR; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum);
    return { date: t.date, cumR: r2(cum) };
  });
  const byExit: Record<string, number> = {};
  for (const t of trades) byExit[t.exitReason] = (byExit[t.exitReason] ?? 0) + 1;
  return {
    n, wins, winRatePct: r2((wins / n) * 100), winRateCi: wilson(wins, n), avgR: r2(trades.reduce((a, t) => a + t.r, 0) / n), avgNetR: r2(trades.reduce((a, t) => a + t.netR, 0) / n),
    profitFactor: gl > 0 ? r2(gp / gl) : null, maxDrawdownR: r2(dd), avgSessions: r2(trades.reduce((a, t) => a + t.sessionsHeld, 0) / n), byExit, equityCurve,
  };
}

export const SCORE_BUCKETS: [number, number][] = [[0, 50], [50, 60], [60, 70], [70, 80], [80, 101]];

/** Observed outcome frequency by score bucket, with Wilson 95% intervals and sample sizes. */
export function calibration(trades: TradeResult[]) {
  const rows = SCORE_BUCKETS.map(([lo, hi]) => {
    const t = trades.filter((x) => x.score !== null && x.score >= lo && x.score < hi);
    const w = t.filter((x) => x.netR > 0).length;
    return { bucket: `${lo}–${hi === 101 ? 100 : hi - 1}`, n: t.length, winRatePct: t.length ? r2((w / t.length) * 100) : null, ci: wilson(w, t.length), avgNetR: t.length ? r2(t.reduce((a, x) => a + x.netR, 0) / t.length) : null };
  });
  const usable = rows.filter((r) => r.n >= 10);
  let monotonic: boolean | null = null;
  if (usable.length >= 2) monotonic = usable.every((r, i) => i === 0 || (r.avgNetR ?? 0) >= (usable[i - 1].avgNetR ?? 0));
  return {
    rows, monotonic,
    note: "Observed outcomes of past signals in this sample, with 95% intervals. Buckets with fewer than 10 trades are not interpretable. A score is a rank, not a probability of profit, and past frequencies do not guarantee future results.",
  };
}
