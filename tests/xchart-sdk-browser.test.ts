/**
 * Real-browser tests for the XChart SDK: the SDK and the existing ChartEngine run unbundled in
 * Chromium (TypeScript stripped by Node, served through Playwright request interception) and the
 * canvas PIXELS are checked.
 *
 * - Locally the tests skip when Playwright/Chromium is unavailable.
 * - With XCHART_REQUIRE_BROWSER=1 (set in CI) they FAIL instead of skipping.
 * - XCHART_BENCH=1 also runs the benchmarks (not part of the functional suite).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { join, normalize } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(import.meta.dirname, "..");
const ORIGIN = "http://xchart.test";
const REQUIRED = process.env.XCHART_REQUIRE_BROWSER === "1";
const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;

// Playwright is a pinned devDependency (also pre-installed in dev images); typed loosely here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let pw: Any = null;
let loadError = "";
try {
  pw = require("playwright");
} catch (e) {
  loadError = (e as Error).message;
}

async function launch(t: { skip: (m: string) => void }): Promise<Any | null> {
  const unavailable = (why: string) => {
    if (REQUIRED) throw new Error(`Mandatory browser tests cannot run: ${why}`);
    t.skip(why);
    return null;
  };
  if (!strip) return unavailable("node:module stripTypeScriptTypes is unavailable (Node ≥ 22.13 needed)");
  if (!pw) return unavailable(`playwright is not installed (${loadError})`);
  try {
    return await pw.chromium.launch();
  } catch (e) {
    return unavailable(`Chromium could not start: ${(e as Error).message.split("\n")[0]}`);
  }
}

// Test page: two chart containers plus pixel helpers. W×H chosen so plot width = 600 (axis = 70).
const PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<div id="a" style="width:670px;height:400px"></div><div id="b" style="width:400px;height:240px"></div>
<script type="module">
  // Instrument global listeners/observers to prove cleanup.
  const counts = { listeners: 0, observers: 0, disconnects: 0 };
  // Only listeners registered by the chart engine count (Playwright injects its own pointerup listener).
  const live = new Set();
  const add = window.addEventListener.bind(window), rem = window.removeEventListener.bind(window);
  window.addEventListener = (t, f, o) => { if (String(new Error().stack).includes("/components/chart/engine.ts")) { live.add(f); counts.listeners = live.size; } return add(t, f, o); };
  window.removeEventListener = (t, f, o) => { if (live.delete(f)) counts.listeners = live.size; return rem(t, f, o); };
  const RO = window.ResizeObserver;
  window.ResizeObserver = class extends RO { constructor(cb) { super(cb); counts.observers++; } disconnect() { counts.disconnects++; return super.disconnect(); } };
  window.counts = counts;
  window.frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.pixels = (el) => { const cv = el.querySelector("canvas"); return { cv, img: cv.getContext("2d").getImageData(0, 0, cv.width, cv.height) }; };
  // Count pixels matching pred within [x0,x1)×[y0,y1).
  window.count = (img, pred, x0 = 0, x1 = img.width, y0 = 0, y1 = img.height) => {
    let n = 0; const d = img.data;
    for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) {
      const i = (y * img.width + x) * 4; if (pred(d[i], d[i + 1], d[i + 2], d[i + 3])) n++;
    }
    return n;
  };
  window.is = {
    green: (r, g, b) => g > 200 && r < 60 && b < 60,
    red: (r, g, b) => r > 200 && g < 60 && b < 60,
    blue: (r, g, b) => b > 200 && r < 60 && g < 60,
    yellow: (r, g, b) => r > 150 && g > 150 && b < 60,
    magenta: (r, g, b) => r > 150 && b > 150 && g < 60,
  };
  // Candles: n bars, 1 day apart, gently rising, alternating up/down.
  window.mk = (n, start = 1767225600, step = 86400) => Array.from({ length: n }, (_, i) => {
    const c = 100 + i;
    return i % 2 ? { time: start + i * step, open: c + 1, high: c + 2, low: c - 2, close: c - 1, volume: 1000 + i }
                 : { time: start + i * step, open: c - 1, high: c + 2, low: c - 2, close: c + 1, volume: 1000 + i };
  });
  // Bar centre x when indices [0, n-1] fill the 600 px plot exactly (setVisibleRange first..last).
  window.xOf = (i, n) => (i + 0.5) * (600 / n);
  const X = await import("/lib/xchart-sdk/index.ts");
  window.X = X; window.ready = true;
</script></body></html>`;

async function openPage(browser: Any) {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, async (route: Any) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: PAGE });
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || !file.endsWith(".ts")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: "text/javascript", body: strip!(readFileSync(file, "utf8")) });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, null, { timeout: 15000 });
  return { page, errors };
}

async function withPage(t: Any, fn: (page: Any, errors: string[]) => Promise<void>) {
  const browser = await launch(t);
  if (!browser) return;
  try {
    const { page, errors } = await openPage(browser);
    await fn(page, errors);
    assert.deepEqual(errors, [], "no page errors");
  } finally {
    await browser.close();
  }
}

test("browser: candles, line, area and histogram draw the expected pixels", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark" });
      const c = chart.addCandlestickSeries({ upColor: "#00ff00", downColor: "#ff0000" });
      const data = mk(40);
      c.setData(data);
      const line = chart.addLineSeries({ color: "#0000ff", lineWidth: 3 });
      line.setData(data.map((d) => ({ time: d.time, value: d.close + 8 })));
      const area = chart.addAreaSeries({ color: "#ffff00", pane: "separate" });
      area.setData(data.map((d, i) => ({ time: d.time, value: (i % 7) + 1 })));
      const vol = chart.addHistogramSeries({ colorMode: "single", color: "#ff00ff", opacity: 1 });
      vol.setData(data.map((d) => ({ time: d.time, value: d.volume })));
      chart.setVisibleRange({ from: data[0].time, to: data[39].time });
      await frame();
      const { cv, img } = pixels(el);
      return {
        canvases: el.querySelectorAll("canvas").length, size: [cv.width, cv.height], bg: [...img.data.slice(0, 4)],
        green: count(img, is.green), red: count(img, is.red), blue: count(img, is.blue),
        yellow: count(img, is.yellow), magenta: count(img, is.magenta),
      };
    })()`);
    assert.equal(r.canvases, 1);
    assert.deepEqual(r.size, [670, 400]);
    assert.deepEqual(r.bg, [11, 15, 23, 255], "first frame drawn within two animation frames (dark background)");
    assert.ok(r.green > 300, `up candles (${r.green} px)`);
    assert.ok(r.red > 300, `down candles (${r.red} px)`);
    assert.ok(r.blue > 300, `line (${r.blue} px)`);
    assert.ok(r.yellow > 300, `area fill (${r.yellow} px)`);
    assert.ok(r.magenta > 300, `histogram (${r.magenta} px)`);
  });
});

test("browser: missing candle leaves an empty slot and other series align to the same x", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, {});
      const c = chart.addCandlestickSeries({ upColor: "#00ff00", downColor: "#00ff00" });
      const data = mk(10);
      c.setData(data.filter((_, i) => i !== 4)); // no candle at slot 4
      const l = chart.addLineSeries({ color: "#0000ff", lineWidth: 2, lastValueVisible: false });
      l.setData([{ time: data[4].time, value: 104 }, { time: data[5].time, value: 104 }]); // fills slot 4, ends at 5
      chart.setVisibleRange({ from: data[0].time, to: data[9].time });
      await frame();
      const { img } = pixels(el);
      const col = (i, pred) => count(img, pred, xOf(i, 10) - 4, xOf(i, 10) + 5, 0, 330);
      let minX = 1e9, maxX = -1;
      for (let x = 0; x < 600; x++) if (count(img, is.blue, x, x + 1, 0, 330)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      return { slot3: col(3, is.green), slot4: col(4, is.green), slot5: col(5, is.green), minX, maxX, x4: xOf(4, 10), x5: xOf(5, 10), times: chart.getVisibleRange() };
    })()`);
    assert.ok(r.slot3 > 20 && r.slot5 > 20, "neighbouring candles drawn");
    assert.equal(r.slot4, 0, "no candle drawn (or fabricated) at the missing slot");
    assert.ok(Math.abs(r.minX - r.x4) <= 3 && Math.abs(r.maxX - r.x5) <= 3, `line spans slots 4→5 (${r.minX}–${r.maxX} vs ${r.x4}–${r.x5})`);
  });
});

test("browser: setVisibleRange moves the actual viewport; theme switch repaints; live update changes pixels", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark", priceScale: { autoScale: true } });
      const c = chart.addCandlestickSeries({ upColor: "#00ff00", downColor: "#ff0000" });
      const data = mk(100);
      c.setData(data);
      chart.setVisibleRange({ from: data[0].time, to: data[99].time });
      await frame();
      const wide = count(pixels(el).img, (r, g, b) => g > 200 || r > 200, 0, 600, 0, 330);
      chart.setVisibleRange({ from: data[80].time, to: data[89].time });
      await frame();
      const narrow = count(pixels(el).img, (r, g, b) => g > 200 || r > 200, 0, 600, 0, 330);
      const range = chart.getVisibleRange();
      // live update of the last visible candle: much taller → more coloured pixels in its column
      chart.setVisibleRange({ from: data[90].time, to: data[99].time });
      await frame();
      const before = count(pixels(el).img, is.red, xOf(9, 10) - 10, xOf(9, 10) + 10, 0, 330);
      const last = data[99]; // a down candle: open 200, close 198
      c.update({ ...last, close: last.close - 25, low: last.close - 26 }); // much longer body
      await frame();
      const after = count(pixels(el).img, is.red, xOf(9, 10) - 10, xOf(9, 10) + 10, 0, 330);
      chart.applyOptions({ theme: "light" });
      await frame();
      const light = [...pixels(el).img.data.slice(0, 4)];
      return { wide, narrow, range, from: data[80].time, to: data[89].time, before, after, light };
    })()`);
    assert.deepEqual(r.range, { from: r.from, to: r.to });
    assert.ok(r.narrow > r.wide * 2, `10 visible bars are drawn much wider than 100 (${r.narrow} vs ${r.wide} px)`);
    assert.ok(r.after > r.before, `updated candle grew (${r.before} → ${r.after} px)`);
    assert.deepEqual(r.light, [255, 255, 255, 255], "light theme background");
  });
});

test("browser: crosshair follows the real pointer, refreshes on live data with a stationary pointer, emits on leave", async (t) => {
  await withPage(t, async (page) => {
    await page.evaluate(`(() => {
      const chart = window.chart = X.createChart(document.getElementById("a"), {});
      const c = window.c = chart.addCandlestickSeries();
      window.data = mk(10);
      c.setData(window.data);
      chart.setVisibleRange({ from: window.data[0].time, to: window.data[9].time });
      window.events = [];
      window.unsub = chart.subscribeCrosshairMove((e) => window.events.push({ time: e.time, price: e.price, close: e.seriesData.get(c)?.close ?? null }));
    })()`);
    const box = await page.locator("#a canvas").boundingBox();
    await page.mouse.move(box.x + 9.5 * 60, box.y + 150); // slot 9 (the latest candle)
    await page.waitForTimeout(80);
    await page.evaluate(`(() => { const l = window.data[9]; window.c.update({ ...l, high: l.high + 5, close: l.close + 4 }); })()`);
    await page.waitForTimeout(80);
    await page.mouse.move(box.x + box.width + 40, box.y + 450); // leave
    await page.waitForTimeout(80);
    const ev = await page.evaluate("window.events");
    assert.ok(ev.length >= 3, `events: ${JSON.stringify(ev)}`);
    assert.equal(ev[0].time, (await page.evaluate("window.data[9].time")));
    assert.equal(typeof ev[0].price, "number");
    assert.equal(ev[1].close, ev[0].close + 4, "stationary pointer received the updated candle");
    assert.deepEqual(ev[ev.length - 1], { time: null, price: null, close: null });
  });
});

test("browser: destroy releases canvas, wrapper, observers and listeners; containers are reusable; multiple charts", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const a = document.getElementById("a"), b = document.getElementById("b");
      const c1 = X.createChart(a, {}), c2 = X.createChart(b, { theme: "light" });
      c1.addLineSeries().setData([{ time: 1, value: 1 }, { time: 2, value: 2 }]);
      c2.addLineSeries().setData([{ time: 1, value: 1 }, { time: 2, value: 2 }]);
      await frame();
      const during = { ...counts, nodes: document.querySelectorAll("[data-xchart]").length };
      let dup = null; try { X.createChart(a, {}); } catch (e) { dup = e.code; }
      c1.remove(); c1.remove();
      await frame();
      const afterOne = { nodes: a.children.length, other: b.querySelectorAll("canvas").length };
      c2.remove();
      // Recreate in the same containers, many times.
      for (let i = 0; i < 20; i++) { const x = X.createChart(a, {}); x.addCandlestickSeries().setData(mk(50)); x.remove(); }
      await frame();
      return { during, dup, afterOne, end: { ...counts }, left: document.querySelectorAll("canvas, [data-xchart]").length };
    })()`);
    assert.equal(r.during.nodes, 2);
    assert.equal(r.during.listeners, 4); // pointerup + txp-theme per chart
    assert.equal(r.dup, "CONTAINER_IN_USE");
    assert.deepEqual(r.afterOne, { nodes: 0, other: 1 }, "removing one chart leaves the other intact");
    assert.equal(r.left, 0, "no canvas or wrapper left");
    assert.equal(r.end.listeners, 0, "all window listeners removed");
    assert.equal(r.end.observers, r.end.disconnects, "every ResizeObserver disconnected");
  });
});

test("browser: a failing renderer constructor leaves no DOM, listeners or container lock behind", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const a = document.getElementById("a");
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function () { throw new Error("GPU unavailable"); };
      let code = null, msg = "";
      try { X.createChart(a, {}); } catch (e) { code = e.code; msg = e.message; }
      HTMLCanvasElement.prototype.getContext = orig;
      const residue = a.children.length;
      const listeners = counts.listeners;
      const ok = X.createChart(a, {}); // container must be free again
      ok.addLineSeries().setData([{ time: 1, value: 1 }, { time: 2, value: 3 }]);
      await frame();
      ok.remove();
      let bad = null; try { X.createChart(a, { width: NaN, height: 10, autoSize: false }); } catch (e) { bad = e.code; }
      return { code, msg, residue, listeners, bad, after: a.children.length, observers: counts.observers - counts.disconnects };
    })()`);
    assert.equal(r.code, "INIT_FAILED");
    assert.match(r.msg, /GPU unavailable/);
    assert.equal(r.residue, 0, "wrapper and canvas removed after the failure");
    assert.equal(r.listeners, 0, "no listeners leaked by the failed construction");
    assert.equal(r.bad, "INVALID_DIMENSION", "invalid options rejected before touching the DOM");
    assert.equal(r.after, 0);
    assert.equal(r.observers, 0);
  });
});

// ---------------------------------------------------------------------------------------
// Benchmarks (opt-in: XCHART_BENCH=1). Reported, not asserted: hardware varies.
// ---------------------------------------------------------------------------------------
test("browser: v0.3 indicators, cloud, drawings, markers and price lines draw real pixels", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark" });
      const c = chart.addCandlestickSeries({ upColor: "#808080", downColor: "#808080", wickUpColor: "#808080", wickDownColor: "#808080" });
      const data = mk(40);
      c.setData(data);
      chart.setVisibleRange({ from: data[0].time, to: data[39].time });
      await frame();
      const snap = () => pixels(el).img;
      const base = snap();
      const plot = (img, pred) => count(img, pred, 0, 600, 0, 400);
      const out = { base: { blue: plot(base, is.blue), green: plot(base, is.green), magenta: plot(base, is.magenta), yellow: plot(base, is.yellow), red: plot(base, is.red) } };
      const sma = chart.addIndicator("sma", { period: 5, color: "#0000ff", lineWidth: 3 });
      await frame(); out.sma = plot(snap(), is.blue);
      sma.setVisible(false); await frame(); out.smaHidden = plot(snap(), is.blue);
      const cloud = chart.addCloudSeries({ upColor: "rgba(0,255,0,1)", downColor: "rgba(0,255,0,1)", lineVisible: false });
      cloud.setData(data.map((d) => ({ time: d.time, upper: d.close + 12, lower: d.close + 6 })));
      await frame(); out.cloud = plot(snap(), is.green);
      cloud.remove();
      chart.addDrawing({ type: "rectangle", points: [{ time: data[5].time, price: 104 }, { time: data[20].time, price: 125 }], style: { color: "#ff00ff", lineWidth: 3, fillOpacity: 0 } });
      await frame(); out.rect = plot(snap(), is.magenta);
      c.setMarkers([{ time: data[30].time, position: "aboveBar", shape: "arrowDown", color: "#ffff00", size: 2 }, { time: data[32].time, position: "belowBar", shape: "circle", color: "#ffff00", size: 2 }]);
      await frame(); out.markers = plot(snap(), is.yellow);
      const pl = c.createPriceLine({ price: 112, color: "#ff0000", lineStyle: "solid", lineWidth: 2 });
      await frame();
      const y = Math.round(chart.priceToCoordinate(112));
      out.priceLineRow = count(snap(), is.red, 0, 600, y - 1, y + 2);
      out.axisTag = count(snap(), is.red, 600, 670, y - 6, y + 6);
      pl.remove(); await frame(); out.priceLineGone = count(snap(), is.red, 0, 600, y - 1, y + 2);
      out.data = JSON.stringify(c.data()) === JSON.stringify(data);
      chart.remove();
      return out;
    })()`);
    assert.ok(r.sma > r.base.blue + 300, `SMA line pixels (${r.sma})`);
    assert.ok(r.smaHidden <= r.base.blue + 5, `hidden SMA leaves no pixels (${r.smaHidden})`);
    assert.ok(r.cloud > r.base.green + 1500, `cloud fill pixels (${r.cloud})`);
    assert.ok(r.rect > r.base.magenta + 400, `rectangle outline pixels (${r.rect})`);
    assert.ok(r.markers > r.base.yellow + 80, `marker pixels (${r.markers})`);
    assert.ok(r.priceLineRow > 500, `price line spans the plot (${r.priceLineRow})`);
    assert.ok(r.axisTag > 100, `price line axis label (${r.axisTag})`);
    assert.ok(r.priceLineGone < 20, `removed price line disappears (${r.priceLineGone})`);
    assert.equal(r.data, true, "decorations never modify series data");
  });
});

test("browser: pointer creates and drags drawings without panning; projected crosshair past the last candle", async (t) => {
  await withPage(t, async (page) => {
    await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark" });
      const c = chart.addCandlestickSeries();
      window.data = mk(40);
      c.setData(data);
      chart.setVisibleRange({ from: data[0].time, to: data[39].time });
      await frame();
      window.chart = chart;
      window.cross = [];
      chart.on("crosshairMove", (e) => cross.push({ time: e.time, projected: e.projected }));
      chart.setDrawingTool("trendline");
      window.range0 = JSON.stringify(chart.getVisibleRange());
    })()`);
    const xy = (i: number, price: number) => page.evaluate(`[chart.timeToCoordinate(data[${i}].time), chart.priceToCoordinate(${price})]`);
    const [x1, y1] = await xy(8, 110);
    const [x2, y2] = await xy(24, 120);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(x2, y2, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
    const created = await page.evaluate(`(() => { const d = chart.getDrawings()[0]; return { n: chart.getDrawings().length, pts: d && d.data().points, t8: data[8].time, t24: data[24].time, tool: chart.getDrawingTool(), range: JSON.stringify(chart.getVisibleRange()) === range0 }; })()`);
    assert.equal(created.n, 1);
    assert.equal(created.tool, null);
    assert.deepEqual(created.pts.map((p: { time: number }) => p.time), [created.t8, created.t24]);
    assert.equal(created.range, true, "creating a drawing does not pan");
    // Drag the line's midpoint by +4 bars.
    const [mx, my] = await page.evaluate(`[(chart.timeToCoordinate(data[8].time) + chart.timeToCoordinate(data[24].time)) / 2, (chart.priceToCoordinate(${created.pts[0].price}) + chart.priceToCoordinate(${created.pts[1].price})) / 2]`);
    const [bx] = await xy(4, 0);
    const [ax] = await xy(0, 0);
    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + (bx - ax), my, { steps: 5 });
    await page.mouse.up();
    const moved = await page.evaluate(`({ pts: chart.getDrawings()[0].data().points, t12: data[12].time, t28: data[28].time, range: JSON.stringify(chart.getVisibleRange()) === range0 })`);
    assert.deepEqual(moved.pts.map((p: { time: number }) => p.time), [moved.t12, moved.t28], "body drag moves both anchors by whole bars");
    assert.equal(moved.range, true, "dragging a drawing does not pan the chart");
    // Keyboard delete + undo on the focused canvas.
    await page.keyboard.press("Delete");
    assert.equal(await page.evaluate(`chart.getDrawings().length`), 0);
    await page.keyboard.press("Control+z");
    assert.equal(await page.evaluate(`chart.getDrawings().length`), 1);
    // Ichimoku: hovering the projection space reports projected = true (no fabricated candles).
    await page.evaluate(`(async () => { chart.addIndicator("ichimoku"); chart.fitContent(); await frame(); })()`);
    const lastX = await page.evaluate(`chart.timeToCoordinate(data[39].time)`);
    await page.mouse.move(Math.min(595, lastX + 40), 150);
    await page.evaluate(`frame()`);
    const last = await page.evaluate(`({ c: cross[cross.length - 1], last: data[39].time, bars: chart.getDrawings().length, n: chart.getIndicators()[0].getValues().length })`);
    assert.equal(last.c.projected, true);
    assert.ok(last.c.time > last.last);
    await page.evaluate(`chart.remove()`);
  });
});

test("browser: benchmarks (1k / 10k / 50k candles)", { skip: process.env.XCHART_BENCH !== "1" && "set XCHART_BENCH=1 to run" }, async (t) => {
  const browser = await launch(t);
  if (!browser) return;
  try {
    const { page } = await openPage(browser);
    const ua = await page.evaluate("navigator.userAgent");
    console.log(`    environment: ${ua.match(/HeadlessChrome\/[\d.]+/)?.[0] ?? ua} · Node ${process.version} · ${process.platform}`);
    for (const n of [1000, 10_000, 50_000]) {
      const r = await page.evaluate(`(async () => {
        const el = document.getElementById("a");
        const data = mk(${n}, 1600000000, 60);
        const vols = data.map((d) => ({ time: d.time, value: d.volume }));
        const sma = data.map((d) => ({ time: d.time, value: d.close }));
        const stats = (a) => { const b = [...a].sort((x, y) => x - y); return { med: b[b.length >> 1], p95: b[Math.min(b.length - 1, Math.floor(b.length * 0.95))] }; };
        await frame();
        let t0 = performance.now();
        const chart = X.createChart(el, { followLatest: true });
        const c = chart.addCandlestickSeries();
        const v = chart.addHistogramSeries({ colorMode: "candle" });
        const l = chart.addLineSeries();
        c.setData(data); v.setData(vols); l.setData(sma);
        const load = performance.now() - t0;
        await frame(); const firstDraw = chart.renderTimeMs();
        const last = data[data.length - 1];
        const rep = [], repDraw = [];
        for (let i = 0; i < 200; i++) {
          const s = performance.now();
          c.update({ ...last, close: last.close + (i % 5) * 0.1, high: last.high + 1, low: last.low - 1 });
          rep.push(performance.now() - s);
          await frame(); repDraw.push(chart.renderTimeMs());
        }
        const app = [], multi = [];
        for (let i = 1; i <= 200; i++) {
          const t = last.time + i * 60;
          let s = performance.now();
          c.update({ time: t, open: 1, high: 2, low: 0.5, close: 1.5 });
          app.push(performance.now() - s);
          s = performance.now();
          v.update({ time: t, value: 10 }); l.update({ time: t, value: 1.2 });
          multi.push(performance.now() - s);
        }
        await frame();
        const zoom = [];
        for (let i = 0; i < 30; i++) { chart.zoom(i % 2 ? 1 / 1.3 : 1.3); await frame(); zoom.push(chart.renderTimeMs()); }
        const pan = [];
        for (let i = 0; i < 60; i++) { chart.scrollBy(-5); await frame(); pan.push(chart.renderTimeMs()); }
        t0 = performance.now(); chart.remove(); const destroy = performance.now() - t0;
        const cycles = [];
        for (let i = 0; i < 20; i++) {
          const s = performance.now();
          const x = X.createChart(el, {}); x.addCandlestickSeries().setData(data); x.remove();
          cycles.push(performance.now() - s);
        }
        return { load, firstDraw, rep: stats(rep), repDraw: stats(repDraw), app: stats(app), multi: stats(multi), zoom: stats(zoom), pan: stats(pan), destroy, cycle: stats(cycles) };
      })()`);
      const f = (v: number) => `${v.toFixed(2)}`;
      const s = (o: { med: number; p95: number }) => `${f(o.med)}/${f(o.p95)}`;
      console.log(`    ${String(n).padStart(6)} candles | load 3 series ${f(r.load)} ms | first draw ${f(r.firstDraw)} | replace ${s(r.rep)} + draw ${s(r.repDraw)} | append ${s(r.app)} | +2 series update ${s(r.multi)} | zoom draw ${s(r.zoom)} | pan draw ${s(r.pan)} | destroy ${f(r.destroy)} | create+load+remove ${s(r.cycle)}  (ms, median/p95)`);
    }
  } finally {
    await browser.close();
  }
});
