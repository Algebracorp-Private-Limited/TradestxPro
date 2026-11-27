/** Pure geometry for drawing tools (screen space; unit-tested, no DOM). */
export type P = { x: number; y: number };

export function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Clips the infinite line through a→b (or the ray from a, or the segment) to x ∈ [x0, x1]. */
export function extendLine(a: P, b: P, x0: number, x1: number, mode: "segment" | "ray" | "line"): [P, P] {
  if (mode === "segment") return [a, b];
  if (a.x === b.x) {
    // Vertical: extend to a generous vertical span.
    const big = 1e5;
    return mode === "line" ? [{ x: a.x, y: -big }, { x: a.x, y: big }] : [a, { x: a.x, y: b.y > a.y ? big : -big }];
  }
  const k = (b.y - a.y) / (b.x - a.x);
  const at = (x: number): P => ({ x, y: a.y + k * (x - a.x) });
  if (mode === "line") return [at(x0), at(x1)];
  return [a, at(b.x > a.x ? x1 : x0)];
}

export function pointInPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from p to the ellipse outline inscribed in the box a–b (approximate, screen space). */
export function distToEllipse(p: P, a: P, b: P): number {
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2 || 1, ry = Math.abs(b.y - a.y) / 2 || 1;
  const nx = (p.x - cx) / rx, ny = (p.y - cy) / ry;
  const r = Math.hypot(nx, ny);
  return Math.abs(r - 1) * Math.min(rx, ry);
}

export const FIB_RETRACEMENT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXTENSION = [0, 0.618, 1, 1.618, 2.618];
export const FIB_TIME = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
export const FIB_FAN = [0.236, 0.382, 0.5, 0.618, 0.786];

/** Retracement level prices between a (0%) … b (100%) measured from b back to a, i.e. price = b − (b − a)·level. */
export function fibRetracement(a: number, b: number, levels = FIB_RETRACEMENT): { level: number; price: number }[] {
  return levels.map((level) => ({ level, price: b - (b - a) * level }));
}

/** Extension of move A→B projected from C: price = C + (B − A)·level. */
export function fibExtension(a: number, b: number, c: number, levels = FIB_EXTENSION): { level: number; price: number }[] {
  return levels.map((level) => ({ level, price: c + (b - a) * level }));
}

/** Least-squares line through (x_i, y_i) and the standard deviation of residuals. */
export function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number; sd: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - (intercept + slope * xs[i])) ** 2;
  return { slope, intercept, sd: Math.sqrt(ss / n) };
}

/** Risk/reward of a position illustration (prices only; never an order). */
export function riskReward(side: "long" | "short", entry: number, stop: number, target: number) {
  const risk = side === "long" ? entry - stop : stop - entry;
  const reward = side === "long" ? target - entry : entry - target;
  return {
    risk,
    reward,
    ratio: risk > 0 ? reward / risk : NaN,
    riskPct: entry !== 0 ? (risk / entry) * 100 : NaN,
    rewardPct: entry !== 0 ? (reward / entry) * 100 : NaN,
    valid: risk > 0 && reward > 0,
  };
}

/** Andrews pitchfork: median line from p1 through the midpoint of p2–p3. */
export function pitchfork(p1: P, p2: P, p3: P): { median: [P, P]; mid: P } {
  const mid = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  return { median: [p1, mid], mid };
}

/** Snaps a price to the nearest of a bar's OHLC values when within `maxPx` on screen. */
export function snapToOhlc(price: number, y: number, ohlc: number[], yOf: (p: number) => number, maxPx = 12): number {
  let best = price, bestD = maxPx;
  for (const v of ohlc) {
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(yOf(v) - y);
    if (d <= bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}
