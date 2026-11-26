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
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, Math.ceil(x1)); x++) {
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

test("browser: overlay scale margins, percentage mode, left axis, panes (collapse, separator drag)", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark" });
      const c = chart.addCandlestickSeries({ upColor: "#808080", downColor: "#808080", wickUpColor: "#808080", wickDownColor: "#808080" });
      const data = mk(40);
      c.setData(data);
      const vol = chart.addHistogramSeries({ pane: "main", priceScaleId: "vol", colorMode: "single", color: "#ff00ff", opacity: 1 });
      vol.setData(data.map((d) => ({ time: d.time, value: d.volume })));
      chart.priceScale("vol").applyOptions({ margins: { top: 0.8, bottom: 0 } });
      chart.setVisibleRange({ from: data[0].time, to: data[39].time });
      await frame();
      const main = chart.pane("main").height();
      let img = pixels(el).img;
      const out = { main };
      out.volTop = count(img, is.magenta, 0, 600, 0, main * 0.75);
      out.volBottom = count(img, is.magenta, 0, 600, main * 0.78, main);
      // Percentage mode: same data, the right axis now reads in %.
      chart.priceScale().applyOptions({ mode: "percentage" });
      await frame();
      out.firstY = chart.priceToCoordinate(data[0].close);
      out.badgeMode = chart.priceScale().options().mode;
      // Left scale: a line on "left" gets axis labels on the left edge.
      const left = chart.addLineSeries({ priceScaleId: "left", color: "#0000ff" });
      left.setData(data.map((d, i) => ({ time: d.time, value: 5000 + i * 10 })));
      await frame();
      img = pixels(el).img;
      out.leftLabels = count(img, (r, g, b) => r > 120 && g > 120 && b > 120 && Math.abs(r - g) < 40, 0, 40, 10, main - 10);
      out.leftLine = count(img, is.blue, 0, 600, 0, main);
      // Panes: an oscillator pane, collapse it, then drag its separator.
      const osc = chart.addLineSeries({ pane: "osc", color: "#00ff00" });
      osc.setData(data.map((d, i) => ({ time: d.time, value: Math.sin(i / 3) })));
      await frame();
      out.oscH = chart.pane("osc").height();
      chart.pane("osc").collapse();
      await frame();
      out.collapsedH = chart.pane("osc").height();
      out.collapsedGreen = count(pixels(el).img, is.green, 0, 600, chart.pane("main").height(), 374);
      chart.pane("osc").expand();
      await frame();
      out.expandedH = chart.pane("osc").height();
      window.resizes = [];
      chart.on("paneResize", (e) => resizes.push(e));
      window.chartA = chart;
      return out;
    })()`);
    assert.ok(r.volBottom > 300, `volume on the overlay scale sits in the bottom margin band (${r.volBottom})`);
    assert.equal(r.volTop, 0, "nothing of the volume overlay above its band");
    assert.equal(r.badgeMode, "percentage");
    assert.ok(Number.isFinite(r.firstY));
    assert.ok(r.leftLabels > 40, `left axis labels drawn (${r.leftLabels})`);
    assert.ok(r.leftLine > 200, `left-scale line drawn on its own range (${r.leftLine})`);
    assert.ok(r.oscH > 40);
    assert.ok(r.collapsedH <= 22, `collapsed pane is a title strip (${r.collapsedH})`);
    assert.equal(r.collapsedGreen, 0, "a collapsed pane draws no series");
    assert.ok(Math.abs(r.expandedH - r.oscH) < 2);
    // Drag the separator above the oscillator pane up by 40 px.
    const top = await page.evaluate(`chartA.pane("main").height()`);
    await page.mouse.move(300, top + 1);
    await page.mouse.down();
    await page.mouse.move(300, top - 39, { steps: 4 });
    await page.mouse.up();
    const after = await page.evaluate(`({ main: chartA.pane("main").height(), osc: chartA.pane("osc").height(), resizes })`);
    assert.ok(Math.abs(after.main - (top - 40)) <= 2, `main pane shrank by 40 px (${top} → ${after.main})`);
    assert.ok(after.osc > r.oscH + 35, `oscillator pane grew (${r.oscH} → ${after.osc})`);
    assert.ok(after.resizes.some((e: { paneId: string }) => e.paneId === "osc"), "paneResize emitted");
    await page.evaluate(`chartA.remove()`);
  });
});

test("browser: synchronised charts follow the pointer and the viewport by time; session shading; time zone labels", async (t) => {
  await withPage(t, async (page) => {
    await page.evaluate(`(async () => {
      const A = X.createChart(document.getElementById("a"), { theme: "dark" });
      const B = X.createChart(document.getElementById("b"), { theme: "dark" });
      const data = mk(60);
      A.addCandlestickSeries().setData(data);
      B.addCandlestickSeries().setData(data.slice(20));
      window.g = X.syncCharts([A, B]);
      window.A = A; window.B = B; window.data = data;
      A.setVisibleRange({ from: data[25].time, to: data[45].time });
      await frame(); await frame(); await frame();
    })()`);
    const ranges = await page.evaluate(`({ a: A.getVisibleRange(), b: B.getVisibleRange() })`);
    const span = ranges.a.to - ranges.a.from;
    assert.ok(Math.abs(ranges.a.from - ranges.b.from) < span * 0.01 && Math.abs(ranges.a.to - ranges.b.to) < span * 0.01, `B follows A's time range (${JSON.stringify(ranges)})`);
    // Hover A: B draws a dashed crosshair at the same time.
    const x = await page.evaluate(`A.timeToCoordinate(data[35].time)`);
    await page.mouse.move(x, 150);
    await page.evaluate(`frame()`);
    const bx = await page.evaluate(`B.timeToCoordinate(data[35].time)`);
    const crossPx = await page.evaluate(`(() => { const { img } = pixels(document.getElementById("b")); return count(img, (r, g, b) => r > 90 && g > 90 && b > 90, ${Math.round(bx) - 1}, ${Math.round(bx) + 2}, 0, 210); })()`);
    assert.ok(crossPx > 30, `synchronised crosshair on B (${crossPx} px)`);
    await page.evaluate(`(() => { g.destroy(); A.remove(); B.remove(); })()`);

    // Intraday NSE bars: pre-open, regular and post-close slots get shaded differently; labels in New York time.
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark", timeZone: "America/New_York" });
      // 2026-03-02 (Mon) 09:00 IST = 03:30 UTC, 5-minute bars to 16:00 IST.
      const start = Date.UTC(2026, 2, 2, 3, 30) / 1000;
      const bars = mk(84, start, 300);
      chart.addCandlestickSeries({ upColor: "#808080", downColor: "#808080", wickUpColor: "#808080", wickDownColor: "#808080" }).setData(bars);
      chart.setVisibleRange({ from: bars[0].time, to: bars[83].time });
      await frame();
      const before = pixels(el).img;
      chart.setSessionHighlight({ calendar: "NSE", preColor: "rgba(0,0,255,0.5)", postColor: "rgba(255,0,0,0.5)" });
      await frame();
      const after = pixels(el).img;
      const xPre = chart.timeToCoordinate(bars[1].time), xReg = chart.timeToCoordinate(bars[40].time);
      const px = (img, x) => [...img.data.slice((20 * img.width + Math.round(x)) * 4, (20 * img.width + Math.round(x)) * 4 + 3)];
      const s = { pre: px(after, xPre), preBefore: px(before, xPre), reg: px(after, xReg), regBefore: px(before, xReg) };
      chart.remove();
      return s;
    })()`);
    assert.ok(r.pre[2] > r.preBefore[2] + 40, `pre-open bars are shaded (${r.preBefore} → ${r.pre})`);
    assert.deepEqual(r.reg, r.regBefore, "regular-session bars are not shaded");
  });
});

test("browser: chart types draw distinct pixels; Heikin Ashi keeps real data; plugin layer renders; layout round-trip", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark" });
      const c = chart.addCandlestickSeries({ upColor: "#00ff00", downColor: "#ff0000", wickUpColor: "#00ff00", wickDownColor: "#ff0000" });
      const data = mk(40);
      c.setData(data);
      chart.setVisibleRange({ from: data[0].time, to: data[39].time });
      const out = {};
      // Blue pixels on the horizontal segment a step line draws at close[10] between bars 10 and 11.
      const seg = (img) => { const y = Math.round(chart.priceToCoordinate(data[10].close)); const x0 = chart.timeToCoordinate(data[10].time) + 2, x1 = chart.timeToCoordinate(data[11].time) - 2; return count(img, is.blue, x0, x1, y - 1, y + 2); };
      const shot = async (type, style) => { chart.setChartType(type, style); await frame(); const { img } = pixels(el); return { green: count(img, is.green, 0, 600, 0, 374), red: count(img, is.red, 0, 600, 0, 374), blue: count(img, is.blue, 0, 600, 0, 374), seg: seg(img) }; };
      out.candles = await shot("candles");
      out.hollow = await shot("hollow-candles");
      out.hilo = await shot("high-low");
      out.line = await shot("line", { lineColor: "#0000ff", lineWidth: 2 });
      out.step = await shot("step-line", { lineColor: "#0000ff", lineWidth: 2 });
      out.columns = await shot("columns", { upColor: "#00ff00", downColor: "#ff0000" });
      out.baseline = await shot("baseline", { upColor: "#00ff00", downColor: "#ff0000", baseline: data[20].close });
      out.ha = await shot("heikin-ashi");
      out.haData = JSON.stringify(c.data()) === JSON.stringify(data);
      try { chart.setChartType("renko", { size: -1 }); } catch (e) { out.renko = e.code; }
      chart.setChartType("candles");
      chart.use({ id: "test/box", install(ctx) { ctx.addLayer({ z: "above", draw(api) { api.ctx.fillStyle = "#ff00ff"; api.ctx.fillRect(10, api.pane.top + 10, 50, 30); } }); } });
      await frame();
      out.plugin = count(pixels(el).img, is.magenta, 0, 100, 0, 60);
      chart.removePlugin("test/box");
      await frame();
      out.pluginGone = count(pixels(el).img, is.magenta, 0, 100, 0, 60);
      chart.addIndicator("ema", { period: 9, color: "#0000ff" });
      chart.addDrawing({ type: "horizontal-line", points: [{ time: data[5].time, price: 120 }] });
      const layout = JSON.stringify(chart.saveLayout());
      chart.remove();
      const other = X.createChart(el, { theme: "dark" });
      other.addCandlestickSeries().setData(data);
      other.loadLayout(layout);
      other.setVisibleRange({ from: data[0].time, to: data[39].time });
      await frame();
      out.restoredBlue = count(pixels(el).img, is.blue, 0, 600, 0, 374);
      out.restored = { ind: other.getIndicators().length, drawings: other.getDrawings().length };
      other.remove();
      return out;
    })()`);
    assert.ok(r.candles.green > 300 && r.candles.red > 300);
    assert.ok(r.hollow.green < r.candles.green * 0.7, `hollow up candles are outlines (${r.candles.green} → ${r.hollow.green})`);
    assert.ok(Math.abs(r.hollow.red - r.candles.red) < r.candles.red * 0.15, "falling candles stay filled");
    assert.ok(r.hilo.green > 100 && r.hilo.red > 100);
    assert.ok(r.line.blue > 300 && r.line.green < 20, `line chart (${JSON.stringify(r.line)})`);
    assert.ok(r.step.seg > r.line.seg + 6, `step line draws a horizontal segment between bars (${r.line.seg} → ${r.step.seg})`);
    assert.ok(r.columns.green + r.columns.red > r.candles.green + r.candles.red, "columns fill to the pane bottom");
    assert.ok(r.baseline.green > 100 && r.baseline.red > 100, `baseline colours above/below (${JSON.stringify(r.baseline)})`);
    assert.ok(r.ha.green > 200, "Heikin Ashi candles drawn");
    assert.equal(r.haData, true, "Heikin Ashi never changes series data");
    assert.equal(r.renko, "INVALID_OPTION", "invalid Renko settings are rejected");
    assert.ok(r.plugin > 1000, `plugin layer pixels (${r.plugin})`);
    assert.equal(r.pluginGone, 0);
    assert.deepEqual(r.restored, { ind: 1, drawings: 1 });
    assert.ok(r.restoredBlue > 200, `restored EMA is drawn (${r.restoredBlue})`);
  });
});

test("browser: engine used directly (terminal chart path) keeps its v0.2 behaviour", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const { ChartEngine } = await import("/components/chart/engine.ts");
      const el = document.getElementById("a");
      el.style.position = "relative";
      const changes = [];
      const eng = new ChartEngine(el, { onDrawingsChange: (d) => changes.push(d.length) });
      const raw = mk(60).map((b) => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
      eng.setData({ bars: raw, type: "candles", overlays: [], panes: [{ id: "rsi", title: "RSI", series: [{ label: "x", values: raw.map((b, i) => 50 + Math.sin(i) * 20), color: "#00ff00" }] }] });
      await frame();
      window.eng = eng;
      return { panes: eng.getPanes() };
    })()`);
    const sepY = r.panes[1].top;
    // Without onPaneResize the separator is not draggable: the press pans instead.
    await page.mouse.move(300, sepY);
    await page.mouse.down();
    await page.mouse.move(300, sepY - 40, { steps: 4 });
    await page.mouse.up();
    const after = await page.evaluate(`eng.getPanes()`);
    assert.deepEqual(after.map((p: { height: number }) => Math.round(p.height)), r.panes.map((p: { height: number }) => Math.round(p.height)), "pane sizes unchanged");
    // The engine's own drawing tools still work.
    await page.evaluate(`eng.setTool("trend")`);
    await page.mouse.click(100, 100);
    await page.mouse.click(300, 150);
    const drawn = await page.evaluate(`(() => { const n = eng.drawings?.length ?? null; eng.destroy(); return n; })()`);
    assert.equal(drawn, 1);
  });
});

test("browser: price-based chart types render real geometry (Renko, Kagi, P&F X/O symbols, Line Break, Range bars)", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark" });
      // Zig-zag walk: rises 20, falls 14, rises 18 … (deterministic, synthetic).
      const data = []; let p = 100;
      for (let i = 0; i < 120; i++) { const step = Math.floor(i / 10) % 2 ? -1.4 : 2; const o = p; p = o + step; data.push({ time: 1767225600 + i * 86400, open: o, high: Math.max(o, p) + 0.3, low: Math.min(o, p) - 0.3, close: p, volume: 1000 }); }
      const c = chart.addCandlestickSeries();
      c.setData(data);
      const shot = async () => { await frame(); return pixels(el).img; };
      const out = {};
      chart.setChartType("renko", { size: 2, upColor: "#00ff00", downColor: "#ff0000" });
      let img = await shot();
      out.renko = { green: count(img, is.green, 0, 600, 0, 374), red: count(img, is.red, 0, 600, 0, 374), points: chart.getDerivedInfo().points.length };
      chart.setChartType("kagi", { reversal: 3, upColor: "#00ff00", downColor: "#ff0000", yangWidth: 5, yinWidth: 1 });
      img = await shot();
      // Width of the vertical strokes: yang lines are thick, yin lines thin.
      const runs = (pred) => { const widths = []; for (let y = 20; y < 360; y += 7) { let run = 0; for (let x = 0; x < 600; x++) { const i = (y * img.width + x) * 4; if (pred(img.data[i], img.data[i + 1], img.data[i + 2])) run++; else { if (run) widths.push(run); run = 0; } } } widths.sort((a, b) => a - b); return widths[widths.length >> 1] ?? 0; };
      out.kagi = { yang: runs(is.green), yin: runs(is.red), lines: chart.getDerivedInfo().points.length };
      chart.setChartType("point-and-figure", { boxSize: 2, reversal: 3, xColor: "#00ff00", oColor: "#ff0000" });
      img = await shot();
      const pf = chart.getDerivedInfo();
      const ocol = pf.points.find((q) => q.direction === -1 && q.boxes >= 3);
      const lg = chart.getVisibleLogicalRange();
      out.pnf = { green: count(img, is.green, 0, 600, 0, 374), red: count(img, is.red, 0, 600, 0, 374), cols: pf.points.length };
      if (ocol) {
        // Centre of an O is empty (a ring, not a filled candle body).
        const span = 600 / (lg.to - lg.from + 1);
        const x = Math.round((ocol.logical - lg.from + 0.5) * span);
        const mid = Math.round((ocol.lowBox + ocol.highBox) / 2) * 2;
        const y = Math.round(chart.priceToCoordinate(mid));
        const i = (y * img.width + x) * 4;
        out.oCentre = [img.data[i], img.data[i + 1], img.data[i + 2]];
        out.oRing = count(img, is.red, x - span / 2, x + span / 2, y - 12, y + 12);
      }
      chart.setChartType("line-break", { lines: 3, upColor: "#00ff00", downColor: "#ff0000" });
      img = await shot();
      out.lb = { green: count(img, is.green, 0, 600, 0, 374), red: count(img, is.red, 0, 600, 0, 374), lines: chart.getDerivedInfo().points.length };
      chart.setChartType("range-bars", { range: 1.5, upColor: "#00ff00", downColor: "#ff0000" });
      img = await shot();
      const rb = chart.getDerivedInfo();
      out.rb = { green: count(img, is.green, 0, 600, 0, 374), red: count(img, is.red, 0, 600, 0, 374), bars: rb.points.length, reconstructed: rb.points.every((q) => q.reconstructed), forming: rb.points.at(-1).complete === false };
      // Logical-axis zoom & pan, screenshot, light theme.
      const before = chart.getVisibleLogicalRange();
      chart.zoom(2); await frame();
      const zoomed = chart.getVisibleLogicalRange();
      chart.scrollBy(-10); await frame();
      const panned = chart.getVisibleLogicalRange();
      out.nav = { before, zoomed, panned };
      const png = chart.takeScreenshot(2);
      const im = new Image(); im.src = png; await im.decode();
      out.png = [im.width, im.height];
      chart.applyOptions({ theme: "light" }); await frame();
      out.lightBg = [...pixels(el).img.data.slice(0, 3)];
      out.dataSame = JSON.stringify(c.data()) === JSON.stringify(data);
      window.chart = chart; window.data = data;
      return out;
    })()`);
    assert.ok(r.renko.points > 20 && r.renko.green > 2000 && r.renko.red > 1000, `renko bricks (${JSON.stringify(r.renko)})`);
    assert.ok(r.kagi.lines > 4, "kagi lines");
    assert.ok(r.kagi.yang >= 4 && r.kagi.yin <= 2, `yang thick / yin thin (${r.kagi.yang} / ${r.kagi.yin} px)`);
    assert.ok(r.pnf.cols >= 4 && r.pnf.green > 300 && r.pnf.red > 300, `X and O symbols (${JSON.stringify(r.pnf)})`);
    assert.ok(r.oCentre && !(r.oCentre[0] > 200 && r.oCentre[1] < 60), `O symbols are rings, not filled (${r.oCentre})`);
    assert.ok(r.oRing > 20, `O ring pixels (${r.oRing})`);
    assert.ok(r.lb.lines > 3 && r.lb.green > 1000 && r.lb.red > 500, `line break (${JSON.stringify(r.lb)})`);
    assert.ok(r.rb.bars > 20 && r.rb.green > 500 && r.rb.red > 300 && r.rb.reconstructed && r.rb.forming, `range bars (${JSON.stringify(r.rb)})`);
    assert.ok(r.nav.zoomed.to - r.nav.zoomed.from < (r.nav.before.to - r.nav.before.from) * 0.7, "zoom narrows the logical range");
    assert.ok(r.nav.panned.to < r.nav.zoomed.to - 5, "pan moves the logical range");
    assert.deepEqual(r.png, [1340, 800], "PNG export at 2×");
    assert.ok(r.lightBg[0] > 200, "light theme repaints");
    assert.equal(r.dataSame, true, "source candles unchanged");
    // Real pointer: crosshair reports the derived point and the source candle.
    await page.evaluate(`(() => { window.ev = null; chart.subscribeCrosshairMove((e) => (window.ev = e && e.derived ? { logical: e.derived.logical, sourceTime: e.derived.sourceTime, time: e.time, src: [...e.seriesData.values()][0] } : null)); })()`);
    await page.mouse.move(300, 150);
    await page.evaluate(`frame()`);
    const ev = await page.evaluate(`window.ev`);
    assert.ok(ev && ev.time === ev.sourceTime && ev.src && ev.src.time === ev.sourceTime, `crosshair: derived point with its source candle (${JSON.stringify(ev)})`);
    await page.evaluate(`chart.remove()`);
  });
});

test("browser: touch creates a logical-domain drawing on a Renko chart", async (t) => {
  const browser = await launch(t);
  if (!browser) return;
  try {
    const page = await (await browser.newContext({ hasTouch: true, viewport: { width: 900, height: 800 } })).newPage();
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
    await page.evaluate(`(async () => { const chart = X.createChart(document.getElementById("a")); chart.addCandlestickSeries().setData(mk(80)); chart.setChartType("renko", { size: 1 }); chart.setDrawingTool("rectangle"); window.chart = chart; await frame(); })()`);
    await page.touchscreen.tap(150, 120);
    await page.touchscreen.tap(320, 220);
    const d = await page.evaluate(`chart.getDrawings().map((x) => x.data())`);
    assert.equal(d.length, 1);
    assert.equal(d[0].domain, "logical");
    assert.ok(d[0].points.every((p: { logical: number }) => Number.isInteger(p.logical)));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("browser: indicator Web Worker — identical results, cancellation, stale rejection, errors, termination", async (t) => {
  await withPage(t, async (page) => {
    const r = await page.evaluate(`(async () => {
      const W = await import("/lib/xchart-sdk/workers/worker-client.ts");
      const B = await import("/lib/xchart-sdk/indicators/builtins.ts");
      const data = mk(20000, 1600000000, 60);
      const cols = { time: data.map((d) => d.time), open: data.map((d) => d.open), high: data.map((d) => d.high), low: data.map((d) => d.low), close: data.map((d) => d.close), volume: data.map((d) => d.volume), intraday: true };
      const client = new W.IndicatorWorkerClient();
      const out = { usesWorker: client.usesWorker };
      const res = await client.computeIndicators(cols, [{ id: "macd", params: {} }, { id: "supertrend", params: {} }, { id: "bogus", params: {} }]);
      out.worker = res.worker;
      const def = B.BUILTIN_INDICATORS.find((d) => d.id === "macd");
      const ref = def.calculate(cols, Object.fromEntries(def.params.map((p) => [p.key, p.default])));
      out.equal = ["macd", "signal", "hist"].every((k) => ref[k].every((v, i) => Object.is(v, res.results[0].outputs[k][i]) || (Number.isNaN(v) && Number.isNaN(res.results[0].outputs[k][i]))));
      out.bogus = res.results[2].error ?? null;
      out.callerIntact = cols.close.length === 20000 && Number.isFinite(cols.close[5]);
      out.transferMs = res.transferMs; out.ms = res.ms;
      // Coalescing: a newer request on the same channel cancels the older one.
      const p1 = client.computeIndicators(cols, [{ id: "adx", params: {} }], { datasetVersion: 1, channel: "c" }).then(() => "ok", (e) => e.name);
      const p2 = client.computeIndicators(cols, [{ id: "adx", params: {} }], { datasetVersion: 2, channel: "c" }).then(() => "ok", (e) => e.name);
      out.coalesce = await Promise.all([p1, p2]);
      // Stale rejection: without coalescing, an older dataset version that finishes is discarded.
      const s1 = client.computeIndicators(cols, [{ id: "ema", params: {} }], { datasetVersion: 3, channel: "s", coalesce: false }).then(() => "ok", (e) => e.name);
      const s2 = client.computeIndicators(cols, [{ id: "ema", params: {} }], { datasetVersion: 4, channel: "s", coalesce: false }).then(() => "ok", (e) => e.name);
      out.stale = await Promise.all([s1, s2]);
      // AbortSignal cancellation.
      const ac = new AbortController();
      const pc = client.computeIndicators(cols, [{ id: "ichimoku", params: {} }], { signal: ac.signal, channel: "a" }).then(() => "ok", (e) => e.name);
      ac.abort();
      out.abort = await pc;
      // Derived transformation in the worker.
      const d = await client.computeDerived(cols, "renko", { size: 2 });
      out.derived = d.worker && d.points.length > 5;
      // Termination rejects pending jobs.
      const pt = client.computeIndicators(cols, [{ id: "adx", params: {} }], { channel: "t" }).then(() => "ok", (e) => e.name);
      client.terminate();
      out.terminated = await pt;
      out.inFlight = client.inFlight();
      return out;
    })()`);
    assert.equal(r.usesWorker, true, "a real Web Worker is used");
    assert.equal(r.worker, true);
    assert.equal(r.equal, true, "worker results are identical to the reference calculation");
    assert.match(r.bogus, /Unknown/);
    assert.equal(r.callerIntact, true, "inputs are copied before transfer");
    assert.deepEqual(r.coalesce, ["CancelledError", "ok"]);
    assert.deepEqual(r.stale, ["StaleResultError", "ok"]);
    assert.equal(r.abort, "CancelledError");
    assert.equal(r.derived, true);
    assert.equal(r.terminated, "CancelledError");
    assert.equal(r.inFlight, 0);
    console.log(`    worker: 20k candles × 3 indicators compute ${r.ms.toFixed(1)} ms + transfer/overhead ${r.transferMs.toFixed(1)} ms`);
  });
});

test("browser: crosshair-only frames reuse the cached frame", async (t) => {
  await withPage(t, async (page) => {
    await page.evaluate(`(async () => {
      const el = document.getElementById("a");
      window.chart = X.createChart(el, {});
      chart.addCandlestickSeries().setData(mk(5000));
      for (const id of ["ema", "bb", "ichimoku", "rsi", "macd"]) chart.addIndicator(id);
      await frame();
    })()`);
    const before = await page.evaluate(`chart.renderStats()`);
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(100 + i * 10, 150 + (i % 5) * 20);
      await page.evaluate(`frame()`);
    }
    const after = await page.evaluate(`({ s: chart.renderStats(), canvases: document.querySelectorAll("#a canvas").length })`);
    assert.equal(after.canvases, 1, "still a single canvas in the page");
    assert.ok(after.s.overlayFrames - before.overlayFrames >= 30, `crosshair-only frames (${after.s.overlayFrames - before.overlayFrames})`);
    assert.ok(after.s.fullFrames - before.fullFrames <= 2, `pointer movement does not re-render the chart (${after.s.fullFrames - before.fullFrames} full frames)`);
    console.log(`    crosshair-only frame ${after.s.lastOverlayMs.toFixed(2)} ms vs full frame ${after.s.lastDrawMs.toFixed(2)} ms (5k candles, 5 indicators)`);
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

test("browser: v0.3 benchmarks (1k / 10k / 50k / 100k candles × 5 / 10 / 20 indicators)", { skip: process.env.XCHART_BENCH !== "1" && "set XCHART_BENCH=1 to run" }, async (t) => {
  const browser = await launch(t);
  if (!browser) return;
  try {
    const { page } = await openPage(browser);
    for (const n of [1000, 10_000, 50_000, 100_000]) {
      for (const k of [5, 10, 20]) {
        const r = await page.evaluate(`(async () => {
          const el = document.getElementById("a");
          const data = mk(${n}, 1600000000, 60);
          const stats = (a) => { const b = [...a].sort((x, y) => x - y); return { med: b[b.length >> 1], p95: b[Math.min(b.length - 1, Math.floor(b.length * 0.95))] }; };
          const chart = X.createChart(el, { followLatest: true });
          const c = chart.addCandlestickSeries();
          c.setData(data);
          await frame();
          const ids = chart.listIndicators().map((d) => d.id).filter((id) => id !== "volume");
          const pick = ids.slice(0, ${k});
          let t0 = performance.now();
          for (const id of pick) chart.addIndicator(id);
          await frame();
          const addAll = performance.now() - t0;
          const last = data[data.length - 1];
          const tick = [], tickDraw = [];
          for (let i = 0; i < 60; i++) {
            const s = performance.now();
            c.update({ ...last, close: last.close + (i % 5) * 0.1, high: last.high + 1, low: last.low - 1 });
            await frame();
            tick.push(performance.now() - s); tickDraw.push(chart.renderTimeMs());
          }
          const app = [];
          for (let i = 1; i <= 30; i++) {
            const s = performance.now();
            c.update({ time: last.time + i * 60, open: 100, high: 101, low: 99, close: 100.5 });
            await frame();
            app.push(performance.now() - s);
          }
          const pan = [];
          for (let i = 0; i < 30; i++) { chart.scrollBy(-7); await frame(); pan.push(chart.renderTimeMs()); }
          for (let i = 0; i < 50; i++) chart.addDrawing({ type: i % 2 ? "trendline" : "fib-retracement", points: [{ time: data[data.length - 200 + i].time, price: 100 + i }, { time: data[data.length - 100 + i].time, price: 120 + i }] });
          const draw50 = [];
          for (let i = 0; i < 20; i++) { chart.scrollBy(i % 2 ? 3 : -3); await frame(); draw50.push(chart.renderTimeMs()); }
          t0 = performance.now(); const layout = JSON.stringify(chart.saveLayout()); const save = performance.now() - t0;
          t0 = performance.now(); chart.loadLayout(layout); await frame(); const load = performance.now() - t0;
          t0 = performance.now(); chart.remove(); const destroy = performance.now() - t0;
          return { addAll, tick: stats(tick), tickDraw: stats(tickDraw), app: stats(app), pan: stats(pan), draw50: stats(draw50), save, load, destroy };
        })()`);
        const f = (v: number) => v.toFixed(1);
        const s = (o: { med: number; p95: number }) => `${f(o.med)}/${f(o.p95)}`;
        console.log(`    ${String(n).padStart(6)} candles × ${String(k).padStart(2)} ind | add all ${f(r.addAll)} ms | tick→frame ${s(r.tick)} (draw ${s(r.tickDraw)}) | append→frame ${s(r.app)} | pan draw ${s(r.pan)} | +50 drawings draw ${s(r.draw50)} | layout save ${f(r.save)} load ${f(r.load)} | destroy ${f(r.destroy)}  (ms, median/p95)`);
      }
    }
  } finally {
    await browser.close();
  }
});
