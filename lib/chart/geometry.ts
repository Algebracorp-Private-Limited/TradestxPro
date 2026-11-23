// Pure chart geometry helpers shared by the canvas engine (unit-tested).

/** A filled polygon between two series, in (bar index, value) space. */
export type FillPoly = { up: boolean; pts: [number, number][] };

/**
 * Polygons between series `a` and `b` over bar indices [start, end]. Each segment between
 * neighbouring bars is one polygon; where the lines cross it is split at the exact crossing so
 * the colour changes there. `only` keeps just the "up" (a above b) or "down" parts.
 */
export function fillPolys(a: ArrayLike<number>, b: ArrayLike<number> | number, start: number, end: number, only?: "up" | "down"): FillPoly[] {
  const B = (i: number) => (typeof b === "number" ? b : b[i]);
  const out: FillPoly[] = [];
  const keep = (up: boolean) => !only || (only === "up") === up;
  const last = Math.min(end, a.length - 1, typeof b === "number" ? Infinity : b.length - 1);
  for (let i = Math.max(0, start); i < last; i++) {
    const a0 = a[i], a1 = a[i + 1], b0 = B(i), b1 = B(i + 1);
    if (![a0, a1, b0, b1].every(Number.isFinite)) continue;
    const d0 = a0 - b0;
    const d1 = a1 - b1;
    if (d0 * d1 >= 0) {
      const up = d0 + d1 >= 0;
      if (keep(up)) out.push({ up, pts: [[i, a0], [i + 1, a1], [i + 1, b1], [i, b0]] });
    } else {
      const t = d0 / (d0 - d1);
      const xc = i + t;
      const yc = a0 + (a1 - a0) * t;
      if (keep(d0 > 0)) out.push({ up: d0 > 0, pts: [[i, a0], [xc, yc], [i, b0]] });
      if (keep(d1 > 0)) out.push({ up: d1 > 0, pts: [[xc, yc], [i + 1, a1], [i + 1, b1]] });
    }
  }
  return out;
}

/**
 * MACD-style histogram tone: 0 = positive & rising, 1 = positive & falling,
 * 2 = negative & falling, 3 = negative & rising.
 */
export function histTone(v: number, prev: number): 0 | 1 | 2 | 3 {
  const hasPrev = Number.isFinite(prev);
  if (v >= 0) return hasPrev && v < prev ? 1 : 0;
  return hasPrev && v > prev ? 3 : 2;
}

/** Timestamp of the k-th bar after the last one (k ≥ 1), skipping weekends for daily-or-longer data. */
export function futureTime(times: ArrayLike<number>, k: number, intraday: boolean): number {
  const n = times.length;
  if (!n) return 0;
  const last = times[n - 1];
  if (intraday) {
    const diffs: number[] = [];
    for (let i = Math.max(1, n - 50); i < n; i++) diffs.push(times[i] - times[i - 1]);
    diffs.sort((x, y) => x - y);
    const step = diffs.length ? diffs[diffs.length >> 1] : 60;
    return last + k * step;
  }
  const step = n > 1 ? times[n - 1] - times[n - 2] : 86400;
  if (step >= 6 * 86400) return last + k * step; // weekly / monthly
  let t = last;
  for (let j = 0; j < k; ) {
    t += 86400;
    const dow = new Date(t * 1000).getUTCDay();
    if (dow !== 0 && dow !== 6) j++;
  }
  return t;
}

/** "#rrggbb" or "#rgb" (or any CSS colour) with an opacity applied. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${+a.toFixed(3)})`;
  }
  const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((x) => x.trim());
    return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
  }
  return color;
}

/** Black or white text, whichever reads better on the given background colour. */
export function contrastText(bg: string): string {
  const m = bg.trim().match(/^#([0-9a-f]{6})$/i);
  let r = 0, g = 0, b = 0;
  if (m) {
    const n = parseInt(m[1], 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    const rgb = bg.match(/rgba?\(([^)]+)\)/i);
    if (!rgb) return "#ffffff";
    [r, g, b] = rgb[1].split(",").map((x) => Number(x.trim()));
  }
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#0b1220" : "#ffffff";
}
