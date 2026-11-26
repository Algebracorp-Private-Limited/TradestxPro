/**
 * Drawing tool definitions: anchor counts, rendering and body hit-testing for every tool.
 * Rendering receives a controlled environment (coordinate conversion only).
 */
import { FIB_EXTENSION, FIB_FAN, FIB_RETRACEMENT, FIB_TIME, distToEllipse, distToSegment, extendLine, fibExtension, fibRetracement, linearRegression, pitchfork, pointInPolygon, riskReward, type P } from "./geometry.ts";
import type { DrawingData, DrawingPoint, DrawingType } from "./types.ts";

export type ToolEnv = {
  ctx: CanvasRenderingContext2D;
  width: number;
  top: number;
  height: number;
  /** Default drawing colour for the theme. */
  color: string;
  text: string;
  bg: string;
  px(p: DrawingPoint): P;
  fmt(price: number): string;
  timeLabel(t: number): string;
  /** Bars between two anchors (signed, fractional), in the drawing's coordinate domain. */
  bars(a: DrawingPoint, b: DrawingPoint): number;
  /** x of the n-th bar after an anchor (Fibonacci time zones). */
  xAfter(a: DrawingPoint, n: number): number;
  /** Closes between two anchors as screen-x and price (regression channel). */
  closes(a: DrawingPoint, b: DrawingPoint): { x: number[]; price: number[] };
  yOf(price: number): number;
};

export type ToolSpec = {
  /** Anchors required; "multi" = 3 or more, finished with a double click. */
  anchors: number | "multi";
  render(env: ToolEnv, pts: P[], d: DrawingData): void;
  hit(env: ToolEnv, pts: P[], p: P, d: DrawingData): boolean;
};

const TOL = 6;
const dash = (ctx: CanvasRenderingContext2D, s?: string) => ctx.setLineDash(s === "dashed" ? [6, 4] : s === "dotted" ? [1.5, 3] : []);
function stroke(env: ToolEnv, d: DrawingData, path: () => void, width?: number) {
  const { ctx } = env;
  ctx.strokeStyle = d.style.color ?? env.color;
  ctx.lineWidth = width ?? d.style.lineWidth ?? 1.5;
  dash(ctx, d.style.lineStyle);
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.setLineDash([]);
}
function fill(env: ToolEnv, d: DrawingData, path: () => void, alpha = d.style.fillOpacity ?? 0.12, color = d.style.fillColor ?? d.style.color ?? env.color) {
  const { ctx } = env;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  path();
  ctx.fill();
  ctx.globalAlpha = 1;
}
function label(env: ToolEnv, d: DrawingData, text: string, x: number, y: number, align: CanvasTextAlign = "left", box = false) {
  const { ctx } = env;
  ctx.font = `${d.style.fontSize ?? 11}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (box) {
    const w = ctx.measureText(text).width + 10;
    const bx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.fillStyle = d.style.fillColor ?? d.style.color ?? env.color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, y - 10, w, 20, 4);
    else ctx.rect(bx, y - 10, w, 20);
    ctx.fill();
    ctx.fillStyle = d.style.textColor ?? "#ffffff";
    ctx.fillText(text, bx + w / 2, y);
    ctx.textAlign = "center";
    return;
  }
  ctx.fillStyle = d.style.textColor ?? d.style.color ?? env.text;
  ctx.fillText(text, x, y);
}
const line = (env: ToolEnv, d: DrawingData, a: P, b: P) => stroke(env, d, () => {
  env.ctx.moveTo(a.x, a.y);
  env.ctx.lineTo(b.x, b.y);
});
const near = (p: P, a: P, b: P) => distToSegment(p, a, b) <= TOL;
const ext = (d: DrawingData, fallback: "segment" | "ray" | "line") => {
  if (d.style.extendLeft && d.style.extendRight) return "line";
  if (d.style.extendRight) return "ray";
  return fallback;
};
const pct = (a: number, b: number) => (a !== 0 ? ((b - a) / a) * 100 : NaN);
const fmtPct = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—");

function twoLine(mode: "segment" | "ray" | "line"): ToolSpec {
  return {
    anchors: 2,
    render(env, [a, b], d) {
      const [p, q] = extendLine(a, b, 0, env.width, ext(d, mode));
      line(env, d, p, q);
    },
    hit(env, [a, b], p, d) {
      const [x, y] = extendLine(a, b, 0, env.width, ext(d, mode));
      return near(p, x, y);
    },
  };
}

function fibLevels(env: ToolEnv, d: DrawingData, x0: number, x1: number, items: { level: number; price: number }[]) {
  items.forEach(({ level, price }, i) => {
    const y = env.yOf(price);
    stroke(env, d, () => {
      env.ctx.moveTo(x0, y);
      env.ctx.lineTo(x1, y);
    }, i === 0 || level === 1 ? 1.5 : 1);
    // Keep labels readable when the drawing's left edge is scrolled out of view.
    if (d.style.showLabels !== false) label(env, d, `${(level * 100).toFixed(1)}%  ${env.fmt(price)}`, Math.max(4, Math.min(x0, x1) + 4), y - 8);
  });
}

function positionTool(side: "long" | "short"): ToolSpec {
  return {
    anchors: 3,
    render(env, [e, t, s], d) {
      const [entry, target, stop] = [d.points[0].price, d.points[1].price, d.points[2].price];
      const x0 = e.x, x1 = Math.max(t.x, s.x, e.x + 40);
      const profit = d.style.fillColor ?? "#22c55e";
      const loss = "#ef4444";
      fill(env, d, () => env.ctx.rect(x0, Math.min(e.y, t.y), x1 - x0, Math.abs(t.y - e.y)), 0.18, profit);
      fill(env, d, () => env.ctx.rect(x0, Math.min(e.y, s.y), x1 - x0, Math.abs(s.y - e.y)), 0.18, loss);
      line(env, d, { x: x0, y: e.y }, { x: x1, y: e.y });
      const rr = riskReward(side, entry, stop, target);
      const tag = rr.valid ? `${side === "long" ? "Long" : "Short"} · R:R ${rr.ratio.toFixed(2)}` : `${side === "long" ? "Long" : "Short"} · invalid levels`;
      label(env, d, `Target ${env.fmt(target)} (${fmtPct(side === "long" ? rr.rewardPct : rr.rewardPct)})`, x0 + 4, t.y + (t.y < e.y ? 10 : -10));
      label(env, d, `Stop ${env.fmt(stop)} (−${Number.isFinite(rr.riskPct) ? Math.abs(rr.riskPct).toFixed(2) : "—"}%)`, x0 + 4, s.y + (s.y < e.y ? 10 : -10));
      label(env, d, tag, (x0 + x1) / 2, e.y - 10, "center", true);
    },
    hit(env, [e, t, s], p) {
      const x0 = e.x, x1 = Math.max(t.x, s.x, e.x + 40);
      const ys = [e.y, t.y, s.y];
      return p.x >= x0 - TOL && p.x <= x1 + TOL && p.y >= Math.min(...ys) - TOL && p.y <= Math.max(...ys) + TOL;
    },
  };
}

export const TOOLS: Record<DrawingType, ToolSpec> = {
  trendline: twoLine("segment"),
  ray: twoLine("ray"),
  "extended-line": twoLine("line"),
  arrow: {
    anchors: 2,
    render(env, [a, b], d) {
      line(env, d, a, b);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const s = 10 + (d.style.lineWidth ?? 1.5) * 2;
      env.ctx.fillStyle = d.style.color ?? env.color;
      env.ctx.beginPath();
      env.ctx.moveTo(b.x, b.y);
      env.ctx.lineTo(b.x - s * Math.cos(ang - 0.4), b.y - s * Math.sin(ang - 0.4));
      env.ctx.lineTo(b.x - s * Math.cos(ang + 0.4), b.y - s * Math.sin(ang + 0.4));
      env.ctx.fill();
    },
    hit: (env, [a, b], p) => near(p, a, b),
  },
  "horizontal-line": {
    anchors: 1,
    render(env, [a], d) {
      line(env, d, { x: 0, y: a.y }, { x: env.width, y: a.y });
      if (d.style.showLabels !== false) label(env, d, d.text ? `${d.text} · ${env.fmt(d.points[0].price)}` : env.fmt(d.points[0].price), 6, a.y - 8);
    },
    hit: (env, [a], p) => Math.abs(p.y - a.y) <= TOL,
  },
  "horizontal-ray": {
    anchors: 1,
    render(env, [a], d) {
      line(env, d, a, { x: env.width, y: a.y });
      if (d.style.showLabels !== false) label(env, d, env.fmt(d.points[0].price), a.x + 4, a.y - 8);
    },
    hit: (env, [a], p) => p.x >= a.x - TOL && Math.abs(p.y - a.y) <= TOL,
  },
  "vertical-line": {
    anchors: 1,
    render(env, [a], d) {
      line(env, d, { x: a.x, y: env.top }, { x: a.x, y: env.top + env.height });
      if (d.style.showLabels !== false) label(env, d, env.timeLabel(d.points[0].time), a.x + 4, env.top + 12);
    },
    hit: (env, [a], p) => Math.abs(p.x - a.x) <= TOL,
  },
  "parallel-channel": {
    anchors: 3,
    render(env, [a, b, c], d) {
      const dy = c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
      const a2 = { x: a.x, y: a.y + dy }, b2 = { x: b.x, y: b.y + dy };
      fill(env, d, () => {
        env.ctx.moveTo(a.x, a.y);
        env.ctx.lineTo(b.x, b.y);
        env.ctx.lineTo(b2.x, b2.y);
        env.ctx.lineTo(a2.x, a2.y);
        env.ctx.closePath();
      });
      line(env, d, a, b);
      line(env, d, a2, b2);
      stroke(env, { ...d, style: { ...d.style, lineStyle: "dashed" } }, () => {
        env.ctx.moveTo(a.x, a.y + dy / 2);
        env.ctx.lineTo(b.x, b.y + dy / 2);
      }, 1);
    },
    hit(env, [a, b, c], p) {
      const dy = c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
      return near(p, a, b) || near(p, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y + dy }) || pointInPolygon(p, [a, b, { x: b.x, y: b.y + dy }, { x: a.x, y: a.y + dy }]);
    },
  },
  "regression-channel": {
    anchors: 2,
    render(env, [a, b], d) {
      const c = env.closes(d.points[0], d.points[1]);
      const r = linearRegression(c.x, c.price);
      if (!r) {
        line(env, d, a, b);
        return;
      }
      const xa = Math.min(a.x, b.x), xb = Math.max(a.x, b.x);
      const y = (x: number, k: number) => env.yOf(r.intercept + r.slope * x + k * 2 * r.sd);
      fill(env, d, () => {
        env.ctx.moveTo(xa, y(xa, 1));
        env.ctx.lineTo(xb, y(xb, 1));
        env.ctx.lineTo(xb, y(xb, -1));
        env.ctx.lineTo(xa, y(xa, -1));
        env.ctx.closePath();
      }, 0.08);
      for (const k of [1, 0, -1]) line(env, k ? { ...d, style: { ...d.style, lineStyle: "dashed" } } : d, { x: xa, y: y(xa, k) }, { x: xb, y: y(xb, k) });
      if (d.style.showLabels !== false) label(env, d, `±2σ · ${c.x.length} bars`, xb + 4, y(xb, 0));
    },
    hit: (env, [a, b], p) => p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL && near(p, a, b) || (p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && Math.abs(p.y - (a.y + b.y) / 2) < Math.abs(b.y - a.y) / 2 + 30),
  },
  pitchfork: {
    anchors: 3,
    render(env, [a, b, c], d) {
      const { median, mid } = pitchfork(a, b, c);
      const dx = mid.x - a.x, dy = mid.y - a.y;
      const far = (p: P) => extendLine(p, { x: p.x + dx, y: p.y + dy }, 0, env.width, "ray")[1];
      line(env, d, median[0], far(a));
      line(env, d, b, far(b));
      line(env, d, c, far(c));
      line(env, { ...d, style: { ...d.style, lineStyle: "dotted" } }, b, c);
    },
    hit(env, [a, b, c], p) {
      const { mid } = pitchfork(a, b, c);
      const dx = mid.x - a.x, dy = mid.y - a.y;
      const far = (q: P) => extendLine(q, { x: q.x + dx, y: q.y + dy }, 0, env.width, "ray")[1];
      return near(p, a, far(a)) || near(p, b, far(b)) || near(p, c, far(c));
    },
  },
  "fib-retracement": {
    anchors: 2,
    render(env, [a, b], d) {
      const x1 = d.style.extendRight ? env.width : Math.max(a.x, b.x);
      fibLevels(env, d, Math.min(a.x, b.x), x1, fibRetracement(d.points[0].price, d.points[1].price, d.style.levels ?? FIB_RETRACEMENT));
      stroke(env, { ...d, style: { ...d.style, lineStyle: "dashed" } }, () => {
        env.ctx.moveTo(a.x, a.y);
        env.ctx.lineTo(b.x, b.y);
      }, 1);
    },
    hit: (env, [a, b], p) => p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL && p.y >= Math.min(a.y, b.y) - TOL && p.y <= Math.max(a.y, b.y) + TOL,
  },
  "fib-extension": {
    anchors: 3,
    render(env, [a, b, c], d) {
      line(env, { ...d, style: { ...d.style, lineStyle: "dashed" } }, a, b);
      line(env, { ...d, style: { ...d.style, lineStyle: "dashed" } }, b, c);
      fibLevels(env, d, c.x, d.style.extendRight ? env.width : Math.max(c.x + 120, b.x), fibExtension(d.points[0].price, d.points[1].price, d.points[2].price, d.style.levels ?? FIB_EXTENSION));
    },
    hit: (env, [a, b, c], p) => near(p, a, b) || near(p, b, c) || (p.x >= c.x && p.x <= Math.max(c.x + 120, b.x)),
  },
  "fib-timezones": {
    anchors: 2,
    render(env, _pts, d) {
      const unit = Math.max(1, Math.round(Math.abs(env.bars(d.points[0], d.points[1]))));
      for (const f of FIB_TIME) {
        const x = env.xAfter(d.points[0], f * unit);
        if (x > env.width + 1) break;
        line(env, d, { x, y: env.top }, { x, y: env.top + env.height });
        if (d.style.showLabels !== false) label(env, d, String(f), x + 3, env.top + 10);
      }
    },
    hit(env, [a], p, d) {
      const unit = Math.max(1, Math.round(Math.abs(env.bars(d.points[0], d.points[1]))));
      return FIB_TIME.some((f) => Math.abs(env.xAfter(d.points[0], f * unit) - p.x) <= TOL) || Math.abs(p.x - a.x) <= TOL;
    },
  },
  "fib-fan": {
    anchors: 2,
    render(env, [a, b], d) {
      for (const f of d.style.levels ?? FIB_FAN) {
        const q = { x: b.x, y: b.y + (a.y - b.y) * f };
        const [p, r] = extendLine(a, q, 0, env.width, "ray");
        line(env, d, p, r);
        if (d.style.showLabels !== false) label(env, d, `${(f * 100).toFixed(1)}%`, q.x + 4, q.y);
      }
      line(env, d, a, b);
    },
    hit: (env, [a, b], p, d) => near(p, a, b) || (d.style.levels ?? FIB_FAN).some((f) => {
      const [x, y] = extendLine(a, { x: b.x, y: b.y + (a.y - b.y) * f }, 0, env.width, "ray");
      return near(p, x, y);
    }),
  },
  "fib-channel": {
    anchors: 3,
    render(env, [a, b, c], d) {
      const off = c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
      for (const f of d.style.levels ?? [0, 0.382, 0.618, 1, 1.618]) {
        const [p, q] = extendLine({ x: a.x, y: a.y + off * f }, { x: b.x, y: b.y + off * f }, 0, env.width, ext(d, "segment"));
        line(env, d, p, q);
        if (d.style.showLabels !== false) label(env, d, `${(f * 100).toFixed(1)}%`, q.x + 4, q.y);
      }
    },
    hit(env, [a, b, c], p, d) {
      const off = c.y - (a.y + ((b.y - a.y) * (c.x - a.x)) / (b.x - a.x || 1));
      return (d.style.levels ?? [0, 0.382, 0.618, 1, 1.618]).some((f) => near(p, { x: a.x, y: a.y + off * f }, { x: b.x, y: b.y + off * f }));
    },
  },
  rectangle: {
    anchors: 2,
    render(env, [a, b], d) {
      const r = () => env.ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      fill(env, d, r);
      stroke(env, d, r);
      if (d.text) label(env, d, d.text, Math.min(a.x, b.x) + 6, Math.min(a.y, b.y) + 10);
    },
    hit: (env, [a, b], p) => p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL && p.y >= Math.min(a.y, b.y) - TOL && p.y <= Math.max(a.y, b.y) + TOL,
  },
  ellipse: {
    anchors: 2,
    render(env, [a, b], d) {
      const e = () => env.ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2 || 1, Math.abs(b.y - a.y) / 2 || 1, 0, 0, Math.PI * 2);
      fill(env, d, e);
      stroke(env, d, e);
    },
    hit(env, [a, b], p) {
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2 || 1, ry = Math.abs(b.y - a.y) / 2 || 1;
      return ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1 || distToEllipse(p, a, b) <= TOL;
    },
  },
  triangle: {
    anchors: 3,
    render(env, pts, d) {
      const path = () => {
        env.ctx.moveTo(pts[0].x, pts[0].y);
        env.ctx.lineTo(pts[1].x, pts[1].y);
        env.ctx.lineTo(pts[2].x, pts[2].y);
        env.ctx.closePath();
      };
      fill(env, d, path);
      stroke(env, d, path);
    },
    hit: (env, pts, p) => pointInPolygon(p, pts) || pts.some((q, i) => near(p, q, pts[(i + 1) % 3])),
  },
  polygon: {
    anchors: "multi",
    render(env, pts, d) {
      const path = () => {
        pts.forEach((q, i) => (i ? env.ctx.lineTo(q.x, q.y) : env.ctx.moveTo(q.x, q.y)));
        env.ctx.closePath();
      };
      fill(env, d, path);
      stroke(env, d, path);
    },
    hit: (env, pts, p) => pointInPolygon(p, pts) || pts.some((q, i) => near(p, q, pts[(i + 1) % pts.length])),
  },
  text: {
    anchors: 1,
    render(env, [a], d) {
      label(env, { ...d, style: { ...d.style, fontSize: d.style.fontSize ?? 13 } }, d.text ?? "Text", a.x, a.y);
    },
    hit(env, [a], p, d) {
      env.ctx.font = `${d.style.fontSize ?? 13}px ui-sans-serif, system-ui, sans-serif`;
      const w = env.ctx.measureText(d.text ?? "Text").width;
      return p.x >= a.x - TOL && p.x <= a.x + w + TOL && Math.abs(p.y - a.y) <= (d.style.fontSize ?? 13);
    },
  },
  "price-label": {
    anchors: 1,
    render(env, [a], d) {
      label(env, d, d.text ? `${d.text} ${env.fmt(d.points[0].price)}` : env.fmt(d.points[0].price), a.x + 8, a.y, "left", true);
      env.ctx.fillStyle = d.style.color ?? env.color;
      env.ctx.beginPath();
      env.ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
      env.ctx.fill();
    },
    hit: (env, [a], p) => p.x >= a.x - TOL && p.x <= a.x + 120 && Math.abs(p.y - a.y) <= 11,
  },
  callout: {
    anchors: 2,
    render(env, [a, b], d) {
      line(env, d, a, b);
      label(env, d, d.text ?? "Note", b.x, b.y, "center", true);
    },
    hit: (env, [a, b], p) => near(p, a, b) || (Math.abs(p.x - b.x) <= 60 && Math.abs(p.y - b.y) <= 11),
  },
  "price-range": {
    anchors: 2,
    render(env, [a, b], d) {
      const x = (a.x + b.x) / 2;
      fill(env, d, () => env.ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x) || 2, Math.abs(b.y - a.y)), 0.1);
      line(env, d, { x, y: a.y }, { x, y: b.y });
      const p1 = d.points[0].price, p2 = d.points[1].price;
      label(env, d, `${env.fmt(p2 - p1)} (${fmtPct(pct(p1, p2))})`, x, b.y + (b.y < a.y ? -14 : 14), "center", true);
    },
    hit: (env, [a, b], p) => p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL && p.y >= Math.min(a.y, b.y) - TOL && p.y <= Math.max(a.y, b.y) + TOL,
  },
  "date-range": {
    anchors: 2,
    render(env, [a, b], d) {
      const y = (a.y + b.y) / 2;
      fill(env, d, () => env.ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y) || 2), 0.1);
      line(env, d, { x: a.x, y }, { x: b.x, y });
      const bars = Math.round(env.bars(d.points[0], d.points[1]));
      const days = Math.abs(d.points[1].time - d.points[0].time) / 86400;
      label(env, d, `${bars} bars · ${days >= 1 ? days.toFixed(1) + " d" : (days * 24).toFixed(1) + " h"}`, (a.x + b.x) / 2, y - 14, "center", true);
    },
    hit: (env, [a, b], p) => p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL && p.y >= Math.min(a.y, b.y) - TOL && p.y <= Math.max(a.y, b.y) + TOL,
  },
  "date-price-range": {
    anchors: 2,
    render(env, [a, b], d) {
      const r = () => env.ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      fill(env, d, r, 0.1);
      stroke(env, d, r, 1);
      const p1 = d.points[0].price, p2 = d.points[1].price;
      const bars = Math.round(env.bars(d.points[0], d.points[1]));
      label(env, d, `${env.fmt(p2 - p1)} (${fmtPct(pct(p1, p2))}) · ${bars} bars`, (a.x + b.x) / 2, Math.max(a.y, b.y) + 14, "center", true);
    },
    hit: (env, [a, b], p) => p.x >= Math.min(a.x, b.x) - TOL && p.x <= Math.max(a.x, b.x) + TOL && p.y >= Math.min(a.y, b.y) - TOL && p.y <= Math.max(a.y, b.y) + TOL,
  },
  "long-position": positionTool("long"),
  "short-position": positionTool("short"),
};

export const MIN_ANCHORS = (t: DrawingType) => (TOOLS[t].anchors === "multi" ? 3 : (TOOLS[t].anchors as number));
