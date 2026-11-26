import test from "node:test";
import assert from "node:assert/strict";
import { createChartWithAdapter } from "../lib/xchart-sdk/create-chart.ts";
import type { RenderAdapter, RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import type { EngineLayer, InteractionDelegate, LayerApi, PointerInfo } from "../components/chart/engine.ts";
import type { CandlestickData } from "../lib/xchart-sdk/types.ts";
import { DRAWING_TYPES, type DrawingType } from "../lib/xchart-sdk/drawings/types.ts";
import { TOOLS } from "../lib/xchart-sdk/drawings/tools.ts";
import { distToSegment, extendLine, fibExtension, fibRetracement, linearRegression, pointInPolygon, riskReward, snapToOhlc } from "../lib/xchart-sdk/drawings/geometry.ts";
import { XChartError } from "../lib/xchart-sdk/validation.ts";

// Linear test geometry: x = 10·i + 5, y = 400 − 2·price, main pane 0..400, plot width 800.
const X = (i: number) => i * 10 + 5;
const Y = (p: number) => 400 - 2 * p;
class Geo implements RenderAdapter {
  last: RenderModel | null = null;
  layers: EngineLayer[] = [];
  delegate: InteractionDelegate | null = null;
  redraws = 0;
  render(m: RenderModel) { this.last = m; }
  setOptions() {}
  onCrosshair() {}
  getViewRange() { return this.last && this.last.times.length ? { from: 0, to: this.last.times.length - 1 } : null; }
  setViewRange() {}
  fit() {}
  scrollToEnd() {}
  scrollBy() {}
  zoom() {}
  resize() {}
  destroy() {}
  setLayers(l: EngineLayer[]) { this.layers = l; }
  setInteraction(d: InteractionDelegate | null) { this.delegate = d; }
  requestRedraw() { this.redraws++; }
  xOfIndex(i: number) { return X(i); }
  indexOfX(x: number) { return (x - 5) / 10; }
  priceToY(p: number) { return Y(p); }
  yToPrice(y: number) { return (400 - y) / 2; }
  getPanes() { return [{ id: "main", top: 0, height: 400 }]; }
  getPlotWidth() { return 800; }
}

/** Canvas context stub that accepts every call and records method names. */
function stubCtx(calls: string[] = []): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      if (k === "measureText") return (s: string) => ({ width: s.length * 6 });
      return () => { calls.push(String(k)); };
    },
    set(t, k, v) { t[k as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}
function layerApi(ctx: CanvasRenderingContext2D, pane = "main", tags: string[] = []): LayerApi {
  return {
    ctx, theme: { draw: "#f5c451", text: "#ddd", bg: "#000", select: "#38bdf8" } as LayerApi["theme"],
    pane: { id: pane, top: 0, height: 400, width: 800 }, from: 0, to: 79, spacing: 10, barCount: 80,
    xOfIndex: X, indexOfX: (x) => (x - 5) / 10, yOfPrice: Y, priceOfY: (y) => (400 - y) / 2,
    bar: () => undefined, axisLabel: (_y, text) => { tags.push(text); },
  };
}

const DAY = 86400;
const T0 = 1_700_000_000;
const t = (i: number) => T0 + i * DAY;
function candles(n: number): CandlestickData[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 5) * 20;
    return { time: t(i), open: c - 1, high: c + 3, low: c - 3, close: c, volume: 1000 + i };
  });
}
function setup(n = 80) {
  const geo = new Geo();
  const chart = createChartWithAdapter(geo);
  const s = chart.addCandlestickSeries();
  s.setData(candles(n));
  return { geo, chart, s };
}
const ptr = (i: number, price: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({ x: X(i), y: Y(price), index: i, price, paneId: "main", shift: false, ctrl: true, pointerType: "mouse", ...extra });
const key = (k: string, mod: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mod }) as KeyboardEvent;

function pointsFor(type: DrawingType) {
  const a = TOOLS[type].anchors;
  const n = a === "multi" ? 4 : a;
  const base = [{ time: t(10), price: 90 }, { time: t(30), price: 120 }, { time: t(40), price: 80 }, { time: t(20), price: 70 }];
  return base.slice(0, n);
}

test("geometry helpers", () => {
  assert.equal(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  assert.equal(distToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 10);
  const [p, q] = extendLine({ x: 10, y: 10 }, { x: 20, y: 20 }, 0, 100, "line");
  assert.deepEqual([p, q], [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  const r = extendLine({ x: 10, y: 10 }, { x: 20, y: 20 }, 0, 100, "ray");
  assert.deepEqual(r[1], { x: 100, y: 100 });
  assert.ok(pointInPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  assert.ok(!pointInPolygon({ x: 15, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]));
  const fr = fibRetracement(100, 200);
  assert.equal(fr.find((l) => l.level === 0.5)!.price, 150);
  assert.equal(fr.find((l) => l.level === 0)!.price, 200);
  assert.equal(fr.find((l) => l.level === 1)!.price, 100);
  assert.ok(Math.abs(fibExtension(100, 200, 150).find((l) => l.level === 1.618)!.price - 311.8) < 1e-9);
  const lr = linearRegression([0, 1, 2, 3], [1, 3, 5, 7])!;
  assert.ok(Math.abs(lr.slope - 2) < 1e-12 && Math.abs(lr.intercept - 1) < 1e-12 && lr.sd < 1e-9);
  const rr = riskReward("long", 100, 95, 115);
  assert.ok(rr.valid && Math.abs(rr.ratio - 3) < 1e-12);
  assert.equal(riskReward("long", 100, 105, 115).valid, false, "a long stop above entry is invalid");
  assert.ok(riskReward("short", 100, 105, 85).valid);
  assert.equal(snapToOhlc(101, Y(101), [100, 110, 90, 105], Y), 100);
  assert.equal(snapToOhlc(150, Y(150), [100, 110, 90, 105], Y), 150, "far from every OHLC value: unchanged");
});

test("every drawing tool: creation, validation, rendering and hit-testing", () => {
  const { chart, geo } = setup();
  assert.equal(DRAWING_TYPES.length, 27);
  for (const type of DRAWING_TYPES) {
    const pts = pointsFor(type);
    const d = chart.addDrawing({ type, points: pts, text: type === "text" || type === "callout" ? "note" : undefined });
    assert.equal(d.type, type);
    assert.deepEqual(d.data().points, pts);
    // Wrong anchor count is rejected without side effects.
    const before = chart.getDrawings().length;
    assert.throws(() => chart.addDrawing({ type, points: TOOLS[type].anchors === "multi" ? pts.slice(0, 2) : [...pts, pts[0], pts[0], pts[0], pts[0]] }), (e: unknown) => e instanceof XChartError && e.code === "INVALID_DRAWING");
    assert.equal(chart.getDrawings().length, before);
  }
  // Render everything through the layer (selected + hovered paths included).
  const calls: string[] = [];
  const layer = geo.layers.find((l) => l.pane === "main" && l.z === "above")!;
  chart.selectDrawing(chart.getDrawings()[0].id);
  for (const d of chart.getDrawings()) d.applyOptions({ showLabels: true, extendRight: true });
  assert.doesNotThrow(() => layer.draw(layerApi(stubCtx(calls))));
  assert.ok(calls.includes("stroke") && calls.includes("fill") && calls.includes("fillText"));
  // Anchor hit-testing on each drawing in isolation.
  for (const type of DRAWING_TYPES) {
    const { chart: c, geo: g } = setup();
    const d = c.addDrawing({ type, points: pointsFor(type) });
    const p0 = d.data().points[0];
    assert.equal(g.delegate!.down!(ptr(10, p0.price)), true, `${type}: press on its first anchor is claimed`);
    assert.equal(c.selectedDrawing(), d.id);
    g.delegate!.up!(ptr(10, p0.price));
  }
});

test("validation is atomic", () => {
  const { chart } = setup();
  const bad: unknown[] = [
    { type: "nope", points: [] },
    { type: "trendline", points: [{ time: t(1), price: 1 }, { time: t(2), price: NaN }] },
    { type: "trendline", points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }], style: { color: "not-a-colour" } },
    { type: "trendline", points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }], style: { lineWidth: 99 } },
    { type: "trendline", points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }], style: { onClick: "alert(1)" } },
    { type: "text", points: [{ time: t(1), price: 1 }], text: "x".repeat(501) },
    { type: "trendline", id: "bad id!", points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }] },
  ];
  for (const b of bad) assert.throws(() => chart.addDrawing(b as never), XChartError);
  assert.equal(chart.getDrawings().length, 0);
  const d = chart.addDrawing({ id: "a", type: "trendline", points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }] });
  assert.throws(() => chart.addDrawing({ id: "a", type: "rectangle", points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }] }), (e: unknown) => (e as XChartError).code === "DUPLICATE_DRAWING");
  assert.throws(() => d.applyOptions({ color: "bogus" }), XChartError);
  assert.equal(d.data().style.color, undefined);
  assert.throws(() => d.update({ points: [{ time: t(1), price: 1 }] }), XChartError);
  assert.equal(d.data().points.length, 2);
  assert.throws(() => chart.loadDrawings([{ type: "trendline", points: [{ time: 1, price: 1 }, { time: 2, price: 2 }] }, { type: "bad" }]), XChartError);
  assert.equal(chart.getDrawings().length, 1, "a rejected load keeps the existing drawings");
});

test("serialization round-trip is JSON-safe", () => {
  const { chart } = setup();
  for (const type of DRAWING_TYPES) chart.addDrawing({ type, points: pointsFor(type), style: { color: "#ff0000", levels: type.startsWith("fib") ? [0, 0.5, 1] : undefined }, text: "t" });
  chart.getDrawings()[3].setLocked(true);
  chart.getDrawings()[4].setVisible(false);
  const json = JSON.stringify(chart.serializeDrawings());
  assert.ok(!json.includes("function"));
  const { chart: other } = setup();
  other.loadDrawings(JSON.parse(json));
  assert.deepEqual(JSON.parse(JSON.stringify(other.serializeDrawings())), JSON.parse(json));
  assert.equal(other.getDrawings()[3].data().locked, true);
  assert.equal(other.getDrawings()[4].data().visible, false);
});

test("drawings never modify series data", () => {
  const { chart, s, geo } = setup();
  const before = JSON.stringify(s.data());
  const d = chart.addDrawing({ type: "trendline", points: [{ time: t(5), price: 100 }, { time: t(15), price: 110 }] });
  geo.delegate!.down!(ptr(5, 100));
  geo.delegate!.move!(ptr(9, 130));
  geo.delegate!.up!(ptr(9, 130));
  d.remove();
  assert.equal(JSON.stringify(s.data()), before);
});

test("interactive creation, drag, lock, keyboard, undo/redo", () => {
  const { chart, geo } = setup();
  const g = geo.delegate!;
  const events: string[] = [];
  const off = chart.subscribeDrawingEvents((e) => events.push(e.type));
  chart.setDrawingTool("trendline");
  assert.equal(chart.getDrawingTool(), "trendline");
  g.hover!(ptr(10.3, 95));
  assert.equal(g.down!(ptr(10.3, 95)), true);
  g.up!(ptr(10.3, 95)); // click without dragging: waits for a second anchor
  assert.equal(chart.getDrawings().length, 0);
  g.hover!(ptr(20, 105));
  g.down!(ptr(20, 105));
  g.up!(ptr(20, 105));
  assert.equal(chart.getDrawingTool(), null);
  const [d] = chart.getDrawings();
  assert.deepEqual(d.data().points, [{ time: t(10), price: 95 }, { time: t(20), price: 105 }], "anchors land on bar times");
  assert.equal(chart.selectedDrawing(), d.id);

  // Drag the body by 3 bars and +10 in price.
  assert.equal(g.down!(ptr(15, 100)), true);
  g.move!(ptr(18, 110));
  g.up!(ptr(18, 110));
  assert.deepEqual(d.data().points, [{ time: t(13), price: 105 }, { time: t(23), price: 115 }]);
  // Drag one anchor.
  g.down!(ptr(23, 115));
  g.move!(ptr(30, 120));
  g.up!(ptr(30, 120));
  assert.deepEqual(d.data().points[1], { time: t(30), price: 120 });

  // Undo twice → original placement; redo once.
  assert.equal(g.key!(key("z", { ctrlKey: true })), true);
  assert.deepEqual(d.data().points, [{ time: t(13), price: 105 }, { time: t(23), price: 115 }]);
  g.key!(key("z", { ctrlKey: true }));
  assert.deepEqual(d.data().points, [{ time: t(10), price: 95 }, { time: t(20), price: 105 }]);
  assert.equal(chart.redoDrawing(), true);
  assert.deepEqual(d.data().points, [{ time: t(13), price: 105 }, { time: t(23), price: 115 }]);

  // Locked drawings can be selected but not moved or deleted from the keyboard.
  d.setLocked(true);
  const locked = JSON.stringify(d.data().points);
  g.down!(ptr(18, 110));
  g.move!(ptr(25, 140));
  g.up!(ptr(25, 140));
  assert.equal(JSON.stringify(d.data().points), locked);
  g.key!(key("Delete"));
  assert.equal(chart.getDrawings().length, 1);
  d.setLocked(false);

  // Duplicate, delete, undo the delete.
  g.key!(key("d", { ctrlKey: true }));
  assert.equal(chart.getDrawings().length, 2);
  g.key!(key("Delete"));
  assert.equal(chart.getDrawings().length, 1);
  chart.selectDrawing(d.id);
  g.key!(key("Backspace"));
  assert.equal(chart.getDrawings().length, 0);
  chart.undoDrawing();
  assert.equal(chart.getDrawings().length, 1);
  assert.equal(chart.getDrawing(d.id)!.data().points.length, 2, "handles survive undo");

  // Escape cancels a tool; a press on empty space is left to the engine (pan).
  chart.setDrawingTool("rectangle");
  g.key!(key("Escape"));
  assert.equal(chart.getDrawingTool(), null);
  chart.selectDrawing(null);
  assert.equal(g.down!(ptr(70, 10)), false);
  assert.ok(events.includes("create") && events.includes("update") && events.includes("remove") && events.includes("select") && events.includes("tool"));
  off();
  const n = events.length;
  chart.clearDrawings();
  assert.equal(events.length, n, "unsubscribed handler no longer called");
});

test("drag-to-create, polygon by double click, OHLC snapping", () => {
  const { chart, geo } = setup();
  const g = geo.delegate!;
  chart.setDrawingTool("rectangle");
  g.down!(ptr(5, 90));
  g.move!(ptr(12, 110));
  g.up!(ptr(12, 110));
  assert.equal(chart.getDrawings().length, 1, "press-drag-release completes a two-anchor tool");

  chart.setDrawingTool("polygon");
  for (const [i, p] of [[1, 50], [8, 70], [4, 30]] as const) {
    g.down!(ptr(i, p));
    g.up!(ptr(i, p));
  }
  g.down!(ptr(4, 30));
  g.up!(ptr(4, 30));
  assert.equal(g.dbl!(ptr(4, 30)), true);
  const poly = chart.getDrawings().find((d) => d.type === "polygon")!;
  assert.equal(poly.data().points.length, 3, "the double click's duplicate anchor is dropped");

  // Snap: without Ctrl, a click 1px from a bar's high snaps to it.
  const bar = candles(80)[20];
  chart.setDrawingTool("horizontal-line");
  g.down!(ptr(20, bar.high + 0.4, { ctrl: false }));
  const h = chart.getDrawings().find((d) => d.type === "horizontal-line")!;
  assert.equal(h.data().points[0].price, bar.high);
  chart.setDrawingSnap(false);
  chart.setDrawingTool("horizontal-line");
  g.down!(ptr(20, bar.high + 0.4, { ctrl: false }));
  const h2 = chart.getDrawings().filter((d) => d.type === "horizontal-line")[1];
  assert.equal(h2.data().points[0].price, bar.high + 0.4);
});

test("typed drawing events via chart.on", () => {
  const { chart } = setup();
  const got: string[] = [];
  const offs = [chart.on("drawingCreate", (e) => got.push(`c:${e.drawing.type}`)), chart.on("drawingUpdate", (e) => got.push(`u:${e.drawing.id}`)), chart.on("drawingRemove", (e) => got.push(`r:${e.id}`))];
  const d = chart.addDrawing({ id: "x1", type: "vertical-line", points: [{ time: t(3), price: 0 }] });
  d.applyOptions({ color: "#00ff00" });
  d.remove();
  assert.deepEqual(got, ["c:vertical-line", "u:x1", "r:x1"]);
  offs.forEach((o) => o());
  assert.throws(() => chart.on("click", 5 as never), XChartError);
});

test("markers: validation, rendering, no data mutation", () => {
  const { chart, s, geo } = setup();
  const before = JSON.stringify(s.data());
  assert.throws(() => s.setMarkers([{ time: t(1), position: "top" as never, shape: "circle" }]), XChartError);
  assert.throws(() => s.setMarkers([{ time: t(1), position: "aboveBar", shape: "star" as never }]), XChartError);
  assert.throws(() => s.setMarkers([{ time: NaN, position: "aboveBar", shape: "circle" }]), XChartError);
  assert.deepEqual(s.getMarkers(), []);
  s.setMarkers([
    { time: t(30), position: "belowBar", shape: "arrowUp", text: "Buy" },
    { time: t(10), position: "aboveBar", shape: "arrowDown", text: "Sell" },
    { time: t(10), position: "aboveBar", shape: "circle" },
    { time: t(12), position: "inBar", shape: "square", color: "#ffffff" },
  ]);
  assert.deepEqual(s.getMarkers().map((m) => m.time), [t(10), t(10), t(12), t(30)], "kept sorted by time");
  const id = s.addMarker({ time: t(40), position: "aboveBar", shape: "circle" });
  assert.equal(s.getMarkers().length, 5);
  assert.equal(s.removeMarker(id), true);
  assert.equal(s.removeMarker("missing"), false);
  const layer = geo.layers.find((l) => l !== geo.layers[geo.layers.length - 1])!;
  assert.ok(layer, "a decoration layer was registered");
  const calls: string[] = [];
  layer.draw(layerApi(stubCtx(calls)));
  assert.ok(calls.filter((c) => c === "fill").length >= 4);
  assert.equal(JSON.stringify(s.data()), before, "markers never modify the series data");
  s.clearMarkers();
  assert.equal(s.getMarkers().length, 0);
  chart.remove();
  assert.throws(() => s.setMarkers([]), XChartError);
});

test("price lines: fixed, last and previous close; atomic options; removal", () => {
  const { s, geo } = setup(10);
  const data = candles(10);
  assert.throws(() => s.createPriceLine({}), XChartError, "a fixed line needs a price");
  assert.throws(() => s.createPriceLine({ price: 1, color: "nope" }), XChartError);
  assert.throws(() => s.createPriceLine({ price: 1, bogus: 1 } as never), XChartError);
  const fixed = s.createPriceLine({ price: 101.5, title: "Target", color: "#22c55e" });
  const last = s.createPriceLine({ source: "last" });
  const prev = s.createPriceLine({ source: "previousClose", lineStyle: "dotted" });
  assert.equal(fixed.price(), 101.5);
  assert.equal(last.price(), data[9].close);
  assert.equal(prev.price(), data[8].close);
  s.update({ time: t(10), open: 140, high: 160, low: 139, close: 150 });
  assert.equal(last.price(), 150, "follows live updates");
  assert.equal(prev.price(), data[9].close);
  assert.throws(() => fixed.applyOptions({ lineWidth: 50 }), XChartError);
  assert.equal(fixed.options().lineWidth, 1);
  fixed.applyOptions({ price: 99 });
  assert.equal(fixed.price(), 99);
  const tags: string[] = [];
  geo.layers[0].draw(layerApi(stubCtx(), "main", tags));
  assert.deepEqual(tags.sort(), ["150.00", "99.00", data[9].close.toFixed(2)].sort());
  assert.equal(s.priceLines().length, 3);
  fixed.remove();
  assert.equal(s.priceLines().length, 2);
  assert.throws(() => fixed.applyOptions({ price: 1 }), XChartError);
});

test("chart.remove() releases drawings, decorations and subscribers", () => {
  const { chart, s, geo } = setup();
  chart.addDrawing({ type: "trendline", points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }] });
  s.createPriceLine({ price: 100 });
  const unsub = chart.subscribeDrawingEvents(() => {});
  chart.remove();
  unsub();
  assert.throws(() => chart.getDrawings(), XChartError);
  assert.throws(() => chart.addDrawing({ type: "trendline", points: [] }), XChartError);
  assert.equal(geo.layers.length >= 1, true);
});
