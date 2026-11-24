import test from "node:test";
import assert from "node:assert/strict";
import { createChartWithAdapter } from "../lib/xchart-sdk/create-chart.ts";
import { seriesPaneId, timeFormatter, type AdapterEvents, type RenderAdapter, type RenderModel } from "../lib/xchart-sdk/canvas-adapter.ts";
import type { Change } from "../lib/xchart-sdk/store.ts";
import type { CandlestickData } from "../lib/xchart-sdk/types.ts";
import { XChartError } from "../lib/xchart-sdk/validation.ts";
import { syncCharts } from "../lib/xchart-sdk/sync.ts";
import { CALENDARS, TradingCalendar, holidayList, offsetSeconds, zonedTime } from "../lib/xchart-sdk/calendar/index.ts";

class Fake implements RenderAdapter {
  last: RenderModel | null = null;
  view: { from: number; to: number } | null = null;
  events: AdapterEvents = {};
  cross: ({ index: number; price: number | null } | null)[] = [];
  crossCb: ((i: number | null, t: number | null, p: number | null) => void) | null = null;
  setRanges = 0;
  render(m: RenderModel, _c: Change) { this.last = m; if (!this.view && m.times.length) this.view = { from: 0, to: m.times.length - 1 }; }
  setOptions() {}
  onCrosshair(cb: (i: number | null, t: number | null, p: number | null) => void) { this.crossCb = cb; }
  getViewRange() { return this.last && this.last.times.length ? this.view : null; }
  setViewRange(from: number, to: number) { this.view = { from, to }; this.setRanges++; }
  fit() {}
  scrollToEnd() {}
  scrollBy() {}
  zoom() {}
  resize() {}
  destroy() {}
  setEvents(e: AdapterEvents) { this.events = e; }
  setCrosshair(c: { index: number; price: number | null } | null) { this.cross.push(c); }
}
const DAY = 86400;
const T0 = 1_767_225_600; // 2026-01-01
function candles(n: number, start = T0, step = DAY): CandlestickData[] {
  return Array.from({ length: n }, (_, i) => ({ time: start + i * step, open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i }));
}
const code = (c: string) => (e: unknown) => e instanceof XChartError && e.code === c;

test("price-scale modes and series scale/pane options validate atomically", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f, { priceScale: { mode: "percentage" } });
  chart.applyOptions({ priceScale: { mode: "indexed" } });
  assert.equal(chart.options().priceScale?.mode, "indexed");
  assert.throws(() => chart.applyOptions({ priceScale: { mode: "weird" as never } }), XChartError);
  assert.equal(chart.options().priceScale?.mode, "indexed");
  assert.throws(() => chart.applyOptions({ timeZone: "Mars/Olympus" }), XChartError);
  assert.throws(() => chart.applyOptions({ locale: "!!" }), XChartError);
  chart.applyOptions({ timeZone: "America/New_York", locale: "en-US" });
  const line = chart.addLineSeries({ priceScaleId: "left" });
  assert.throws(() => chart.addLineSeries({ priceScaleId: "bad id" }), XChartError);
  assert.throws(() => chart.addLineSeries({ pane: "xs-1" }), XChartError, "generated pane ids are reserved");
  assert.throws(() => line.applyOptions({ pane: "has space" }), XChartError);
  assert.equal(line.options().pane, undefined);
  chart.addHistogramSeries({ pane: "osc" });
  chart.addLineSeries({ pane: "osc" });
  assert.equal(seriesPaneId(5, "line", { pane: "osc" }), "osc");
  assert.equal(seriesPaneId(5, "histogram", {}), "xs-5");
  assert.equal(seriesPaneId(5, "line", {}), "main");
  assert.deepEqual(chart.panes().map((p) => p.id), ["main", "osc"], "series sharing a named pane share one pane");
});

test("priceScale(): margins, visibility, main-scale mode, honest overlay limits", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  chart.addCandlestickSeries().setData(candles(20));
  const vol = chart.addHistogramSeries({ pane: "main", priceScaleId: "vol" });
  vol.setData(candles(20).map((c) => ({ time: c.time, value: 1000 })));
  const events: string[] = [];
  chart.on("scaleChange", (e) => events.push(e.scaleId));
  chart.priceScale("vol").applyOptions({ margins: { top: 0.8, bottom: 0 } });
  assert.deepEqual(chart.priceScale("vol").options().margins, { top: 0.8, bottom: 0 });
  assert.equal(chart.priceScale("vol").seriesCount(), 1);
  assert.deepEqual(f.last!.scales, [{ id: "vol", margins: { top: 0.8, bottom: 0 }, visible: undefined }]);
  assert.throws(() => chart.priceScale("vol").applyOptions({ margins: { top: 0.6, bottom: 0.6 } }), XChartError);
  assert.throws(() => chart.priceScale("vol").applyOptions({ mode: "logarithmic" }), code("UNSUPPORTED_SCALE"));
  assert.throws(() => chart.priceScale("vol").applyOptions({ colour: 1 } as never), XChartError);
  assert.deepEqual(chart.priceScale("vol").options().margins, { top: 0.8, bottom: 0 }, "rejected calls change nothing");
  chart.priceScale().applyOptions({ mode: "logarithmic" });
  assert.equal(chart.options().priceScale?.mode, "logarithmic");
  assert.equal(chart.priceScale("right").options().mode, "logarithmic");
  chart.priceScale("left").applyOptions({ visible: false });
  assert.deepEqual(events, ["vol", "right", "left"]);
  assert.throws(() => chart.priceScale("no good"), XChartError);
});

test("panes(): heights, collapse, order and events", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  chart.addCandlestickSeries().setData(candles(30));
  const a = chart.addLineSeries({ pane: "separate" });
  chart.addHistogramSeries({ pane: "vol" });
  chart.addIndicator("rsi");
  const ids = chart.panes().map((p) => p.id);
  assert.deepEqual(ids, ["main", `xs-${(a as unknown as { id: number }).id}`, "vol", "xind-rsi-1"]);
  const log: string[] = [];
  chart.on("paneResize", (e) => log.push(`${e.paneId}:${e.height}`));
  chart.on("layoutChange", (e) => log.push(e.reason));
  chart.pane("vol")!.setHeight(150);
  assert.equal(f.last!.paneSizes!.vol, 150);
  assert.throws(() => chart.pane("vol")!.setHeight(5), XChartError);
  assert.throws(() => chart.pane("main")!.collapse(), XChartError);
  chart.pane("vol")!.collapse();
  assert.equal(chart.pane("vol")!.isCollapsed(), true);
  assert.deepEqual(f.last!.collapsed, ["vol"]);
  chart.pane("vol")!.expand();
  assert.deepEqual(f.last!.collapsed, []);
  chart.pane("xind-rsi-1")!.moveTo(1);
  assert.deepEqual(chart.panes().map((p) => p.id), ["main", "xind-rsi-1", ids[1], "vol"]);
  assert.throws(() => chart.pane("vol")!.moveTo(9), XChartError);
  // A separator drag reported by the renderer is kept and emitted.
  f.events.paneResize!({ main: 200, [ids[1]]: 80, vol: 90, "xind-rsi-1": 70 });
  chart.applyOptions({}); // any full re-render keeps the dragged sizes
  assert.deepEqual(f.last!.paneSizes, { main: 200, [ids[1]]: 80, vol: 90, "xind-rsi-1": 70 });
  assert.deepEqual(log.filter((x) => x.startsWith("vol:")), ["vol:150", "vol:90"]);
  assert.ok(log.includes("pane-collapse") && log.includes("pane-expand") && log.includes("pane-move"));
  const stale = chart.pane(ids[1])!;
  a.remove();
  assert.equal(chart.pane(ids[1]), undefined, "a series' own pane goes away with it");
  assert.throws(() => stale.collapse(), code("PANE_REMOVED"));
});

test("programmatic crosshair position", () => {
  const f = new Fake();
  const chart = createChartWithAdapter(f);
  assert.throws(() => chart.setCrosshairPosition(NaN), XChartError);
  chart.setCrosshairPosition(T0); // no data: ignored
  assert.equal(f.cross.length, 0);
  chart.addCandlestickSeries().setData(candles(10));
  chart.setCrosshairPosition(T0 + 3 * DAY, 105);
  chart.clearCrosshairPosition();
  assert.deepEqual(f.cross, [{ index: 3, price: 105 }, null]);
});

test("syncCharts: time range and crosshair by time, no feedback loops, cleanup", () => {
  const fa = new Fake(), fb = new Fake(), fc = new Fake();
  const A = createChartWithAdapter(fa), B = createChartWithAdapter(fb), C = createChartWithAdapter(fc);
  A.addCandlestickSeries().setData(candles(100));
  B.addCandlestickSeries().setData(candles(50, T0 + 50 * DAY)); // different bars: second half only
  C.addCandlestickSeries().setData(candles(100));
  const g = syncCharts([A, B]);
  assert.throws(() => syncCharts([A], { crosshair: "yes" as never }), XChartError);
  fa.view = { from: 60, to: 80 };
  fa.events.view!({ from: 60, to: 80, spacing: 5 });
  assert.deepEqual(B.getVisibleRange(), { from: T0 + 60 * DAY, to: T0 + 80 * DAY }, "aligned by time, not by index");
  assert.deepEqual(fb.view, { from: 10, to: 30 });
  const before = fa.setRanges;
  fb.events.view!({ from: 10, to: 30, spacing: 5 });
  assert.equal(fa.setRanges, before, "an echoed range is not pushed back");
  assert.equal(fc.setRanges, 0, "charts outside the group are untouched");
  // Crosshair: A's pointer at bar 70 → B shows its crosshair at its own bar 20.
  fa.crossCb!(70, T0 + 70 * DAY, 170);
  assert.deepEqual(fb.cross.at(-1), { index: 20, price: null });
  fa.crossCb!(null, null, null);
  assert.equal(fb.cross.at(-1), null);
  // A removed chart leaves the group; destroy releases every subscription.
  B.remove();
  assert.deepEqual(g.charts(), [A]);
  g.add(C);
  g.destroy();
  fa.events.view!({ from: 1, to: 5, spacing: 5 });
  assert.equal(fc.setRanges, 0);
  assert.throws(() => g.add(A), XChartError);
});

test("calendars: NSE/BSE sessions in IST", () => {
  const nse = new TradingCalendar("NSE");
  const at = (iso: string) => Date.parse(iso) / 1000;
  assert.equal(nse.sessionAt(at("2026-03-02T03:35:00Z")), "pre"); // 09:05 IST Monday
  assert.equal(nse.sessionAt(at("2026-03-02T03:45:00Z")), "regular"); // 09:15
  assert.equal(nse.sessionAt(at("2026-03-02T09:59:00Z")), "regular"); // 15:29
  assert.equal(nse.sessionAt(at("2026-03-02T10:00:00Z")), "closed"); // 15:30
  assert.equal(nse.sessionAt(at("2026-03-02T10:15:00Z")), "post"); // 15:45
  assert.equal(nse.sessionAt(at("2026-03-07T05:00:00Z")), "closed"); // Saturday
  assert.deepEqual(nse.regularBounds("2026-03-02"), { open: at("2026-03-02T03:45:00Z"), close: at("2026-03-02T10:00:00Z") });
  assert.equal(nse.nextOpen(at("2026-03-07T05:00:00Z")), at("2026-03-09T03:45:00Z"), "Saturday → Monday 09:15 IST");
  assert.equal(new TradingCalendar("BSE").isTradingDay("2026-03-02"), true);
  assert.equal(nse.tradingDaysBetween("2026-03-02", "2026-03-15"), 10);
  // Holidays and early closes only come from the provider (none are bundled).
  const h = holidayList({ NSE: ["2026-03-03"] }, { NSE: { "2026-03-04": "13:00" } });
  const nseH = new TradingCalendar("NSE", h);
  assert.equal(nseH.isTradingDay("2026-03-03"), false);
  assert.equal(nseH.sessionAt(at("2026-03-03T05:00:00Z")), "closed");
  assert.equal(nseH.sessionAt(at("2026-03-04T08:00:00Z")), "closed", "13:30 IST after a 13:00 early close");
  assert.equal(nseH.sessionAt(at("2026-03-04T07:00:00Z")), "regular");
  assert.equal(nseH.tradingDaysBetween("2026-03-02", "2026-03-15"), 9);
  assert.equal(nseH.nextOpen(at("2026-03-02T11:00:00Z")), at("2026-03-04T03:45:00Z"), "skips the holiday");
  assert.throws(() => holidayList({ NSE: ["3 March"] }), XChartError);
});

test("calendars: US daylight saving, MCX evening session, forex week, crypto", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  const nyse = new TradingCalendar("NYSE");
  // DST starts Sunday 8 March 2026: the open moves from 14:30 UTC to 13:30 UTC.
  assert.equal(nyse.sessionAt(at("2026-03-06T14:00:00Z")), "pre"); // 09:00 EST
  assert.equal(nyse.sessionAt(at("2026-03-06T14:30:00Z")), "regular"); // 09:30 EST
  assert.equal(nyse.sessionAt(at("2026-03-09T13:30:00Z")), "regular"); // 09:30 EDT
  assert.equal(nyse.sessionAt(at("2026-03-09T20:30:00Z")), "post"); // 16:30 EDT
  assert.equal(offsetSeconds("America/New_York", at("2026-03-06T12:00:00Z")), -5 * 3600);
  assert.equal(offsetSeconds("America/New_York", at("2026-03-09T12:00:00Z")), -4 * 3600);
  assert.equal(zonedTime("America/New_York", "2026-03-09", "09:30"), at("2026-03-09T13:30:00Z"));
  assert.equal(new TradingCalendar("NASDAQ").regularBounds("2026-03-06")!.open, at("2026-03-06T14:30:00Z"));
  const mcx = new TradingCalendar("MCX");
  assert.equal(mcx.regularBounds("2026-01-12")!.close, at("2026-01-12T18:00:00Z"), "23:30 IST outside US DST");
  assert.equal(mcx.regularBounds("2026-07-13")!.close, at("2026-07-13T18:25:00Z"), "23:55 IST during US DST");
  const fx = new TradingCalendar("FOREX");
  assert.equal(fx.sessionAt(at("2026-03-01T21:30:00Z")), "closed"); // Sun 16:30 EST
  assert.equal(fx.sessionAt(at("2026-03-01T22:30:00Z")), "regular"); // Sun 17:30 EST
  assert.equal(fx.sessionAt(at("2026-03-04T03:00:00Z")), "regular"); // midweek night
  assert.equal(fx.sessionAt(at("2026-03-06T22:30:00Z")), "closed"); // Fri 17:30 EST
  const crypto = new TradingCalendar("CRYPTO");
  assert.equal(crypto.sessionAt(at("2026-03-07T03:00:00Z")), "regular");
  assert.equal(crypto.regularBounds("2026-03-07")!.close - crypto.regularBounds("2026-03-07")!.open, 86400);
  assert.equal(Object.keys(CALENDARS).length, 7);
  assert.throws(() => new TradingCalendar("LSE" as never), XChartError);
  assert.throws(() => new TradingCalendar({ id: "X", name: "x", timeZone: "Nowhere/Land", week: {} }), XChartError);
  assert.throws(() => new TradingCalendar({ id: "X", name: "x", timeZone: "UTC", week: { 1: [{ kind: "regular", start: "10:00", end: "09:00" }] } }), XChartError);
});

test("time labels in an IANA zone and locale", () => {
  const ny = timeFormatter("America/New_York", "en-GB");
  const t = Date.parse("2026-03-09T13:30:00Z") / 1000;
  assert.equal(ny(t, true, false), "09:30");
  assert.match(ny(t, true, true), /9 Mar.*09:30/);
  const ist = timeFormatter(undefined, "en-GB", 19800);
  assert.equal(ist(Date.parse("2026-03-09T03:45:00Z") / 1000, true, false), "09:15", "fixed offset without a zone");
  assert.equal(ny(Date.parse("2026-03-09T00:00:00Z") / 1000, false, false), "9 Mar", "daily bars are dates (UTC)");
});

test("session highlight validation and layer registration", () => {
  const f = new Fake() as Fake & { layers?: unknown[]; setLayers?: (l: unknown[]) => void; requestRedraw?: () => void };
  f.setLayers = (l) => (f.layers = l);
  f.requestRedraw = () => {};
  const chart = createChartWithAdapter(f);
  const n = f.layers!.length;
  chart.setSessionHighlight({ calendar: "NSE" });
  assert.equal(f.layers!.length, n + 1);
  assert.throws(() => chart.setSessionHighlight({ calendar: "NSE", preColor: "nope" }), XChartError);
  assert.throws(() => chart.setSessionHighlight({ calendar: "ABC" as never }), XChartError);
  chart.setSessionHighlight(null);
  assert.equal(f.layers!.length, n);
});
