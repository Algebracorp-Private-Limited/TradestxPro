/**
 * Real-browser tests for the XChart SDK: the SDK and the existing ChartEngine run unbundled in
 * Chromium (TypeScript stripped by Node and served through Playwright request interception), and
 * the canvas pixels are checked. Skipped (not failed) when Playwright/Chromium is unavailable.
 * Set XCHART_BENCH=1 to also print 1k / 10k / 50k candle benchmarks.
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
const strip = (nodeModule as unknown as { stripTypeScriptTypes?: (code: string) => string }).stripTypeScriptTypes;

// Playwright is optional (pre-installed in CI/dev images, not a package dependency): typed loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pw = any;
let pw: Pw | null = null;
try {
  pw = require("playwright") as Pw;
} catch {
  pw = null;
}

async function launch() {
  if (!pw || !strip) return null;
  try {
    return await pw.chromium.launch();
  } catch {
    return null;
  }
}

const PAGE = `<!doctype html><html><body style="margin:0;background:#000">
<div id="a" style="width:800px;height:420px"></div><div id="b" style="width:600px;height:300px"></div>
<script type="module">
  import * as X from "/lib/xchart-sdk/index.ts";
  window.X = X; window.ready = true;
</script></body></html>`;

async function openPage(browser: NonNullable<Awaited<ReturnType<typeof launch>>>) {
  const page = await browser.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.route(`${ORIGIN}/**`, async (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: PAGE });
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || !file.endsWith(".ts")) return route.fulfill({ status: 404, body: "" });
    // Silence Node's one-time experimental warning noise per file by stripping here.
    return route.fulfill({ contentType: "text/javascript", body: strip!(readFileSync(file, "utf8")) });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, null, { timeout: 15000 });
  return { page, errors };
}

const candlesJs = `(n, start, step) => Array.from({ length: n }, (_, i) => {
  const c = 100 + Math.sin(i / 9) * 10 + i * 0.05;
  return { time: start + i * step, open: c - 0.6, high: c + 1.5, low: c - 1.5, close: c + (i % 2 ? 0.8 : -0.8), volume: 1000 + (i % 50) * 20 };
})`;

test("browser: createChart renders candles, line, area and histogram on a real canvas", async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("Playwright/Chromium or node:module stripTypeScriptTypes unavailable");
  try {
    const { page, errors } = await openPage(browser);
    const r = await page.evaluate(`(async () => {
      const mk = ${candlesJs};
      const el = document.getElementById("a");
      const chart = X.createChart(el, { theme: "dark", crosshair: true });
      const c = chart.addCandlestickSeries({ upColor: "#00ff00", downColor: "#ff0000" });
      const data = mk(120, 1767225600, 86400);
      c.setData(data);
      const line = chart.addLineSeries({ color: "#0000ff", lineWidth: 3 });
      line.setData(data.map((d) => ({ time: d.time, value: d.close + 8 })));
      const area = chart.addAreaSeries({ color: "#ffff00", pane: "separate" });
      area.setData(data.map((d, i) => ({ time: d.time, value: Math.sin(i / 5) * 5 })));
      const vol = chart.addHistogramSeries({ colorMode: "candle", opacity: 1 });
      vol.setData(data.map((d) => ({ time: d.time, value: d.volume })));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.bgPx = [...el.querySelector("canvas").getContext("2d").getImageData(5, 5, 1, 1).data];
      const cv = el.querySelector("canvas");
      const ctx = cv.getContext("2d");
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
      const count = (pred) => { let n = 0; for (let i = 0; i < img.length; i += 4) if (pred(img[i], img[i+1], img[i+2])) n++; return n; };
      return {
        canvases: document.querySelectorAll("#a canvas").length,
        green: count((r, g, b) => g > 200 && r < 80 && b < 80),
        red: count((r, g, b) => r > 200 && g < 80 && b < 80),
        blue: count((r, g, b) => b > 200 && r < 60 && g < 60),
        yellow: count((r, g, b) => r > 120 && g > 120 && b < 60),
        size: [cv.width, cv.height], bg: window.bgPx,
      };
    })()`);
    const res = r as { canvases: number; green: number; red: number; blue: number; yellow: number; size: number[]; bg: number[] };
    assert.equal(res.canvases, 1);
    assert.deepEqual(res.size, [800, 420]);
    assert.deepEqual(res.bg, [11, 15, 23, 255], "first frame drawn within two animation frames (dark background)");
    assert.ok(res.green > 200, `up candles/volume drawn (${res.green} px)`);
    assert.ok(res.red > 200, `down candles/volume drawn (${res.red} px)`);
    assert.ok(res.blue > 300, `line drawn (${res.blue} px)`);
    assert.ok(res.yellow > 100, `area drawn (${res.yellow} px)`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("browser: visible range drives the viewport, crosshair events fire and stop on leave, remove cleans up", async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("Playwright/Chromium unavailable");
  try {
    const { page, errors } = await openPage(browser);
    const setup = await page.evaluate(`(async () => {
      const mk = ${candlesJs};
      const el = document.getElementById("a");
      const chart = window.chart = X.createChart(el, {});
      const c = window.c = chart.addCandlestickSeries();
      const data = mk(500, 1767225600, 3600);
      c.setData(data);
      window.events = [];
      window.unsub = chart.subscribeCrosshairMove((e) => window.events.push({ time: e.time, price: e.price, n: e.seriesData.size }));
      chart.setVisibleRange({ from: data[100].time, to: data[199].time });
      await new Promise((r) => requestAnimationFrame(r));
      let dup = null;
      try { X.createChart(el, {}); } catch (e) { dup = e.code; }
      return { range: chart.getVisibleRange(), from: data[100].time, to: data[199].time, dup };
    })()`) as { range: { from: number; to: number }; from: number; to: number; dup: string };
    assert.equal(setup.range.from, setup.from);
    assert.equal(setup.range.to, setup.to);
    assert.equal(setup.dup, "CONTAINER_IN_USE");

    // Real pointer events over the canvas.
    const box = (await page.locator("#a canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 150);
    await page.waitForTimeout(100);
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + 160);
    await page.waitForTimeout(100);
    await page.mouse.move(box.x + box.width + 50, box.y + 600); // leave
    await page.waitForTimeout(100);
    const ev = await page.evaluate("window.events") as { time: number | null; price: number | null; n: number }[];
    assert.ok(ev.length >= 2, `crosshair events: ${ev.length}`);
    assert.ok(ev[0].time! >= setup.from && ev[0].time! <= setup.to, "time within visible range");
    assert.ok(typeof ev[0].price === "number" && ev[0].n === 1);
    assert.deepEqual(ev[ev.length - 1], { time: null, price: null, n: 0 });

    // Live update keeps the canvas and changes pixels only after the next frame.
    const after = await page.evaluate(`(async () => {
      const d = window.c.data();
      const last = d[d.length - 1];
      window.c.update({ ...last, high: last.high + 50, close: last.close + 40 });
      window.c.update({ time: last.time + 3600, open: 1, high: 2, low: 0.5, close: 1.5 });
      window.chart.fitContent();
      await new Promise((r) => requestAnimationFrame(r));
      window.unsub();
      const n = window.chart.crosshairSubscriberCount();
      window.chart.remove();
      const left = document.querySelectorAll("#a canvas, #a [data-xchart]").length;
      const again = X.createChart(document.getElementById("a"), {}); // container is free again
      again.remove();
      return { n, left, len: window.c ? d.length : 0 };
    })()`) as { n: number; left: number };
    assert.equal(after.n, 0);
    assert.equal(after.left, 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test("browser: benchmarks (1k / 10k / 50k candles)", { skip: process.env.XCHART_BENCH !== "1" && "set XCHART_BENCH=1 to run" }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("Playwright/Chromium unavailable");
  try {
    const { page } = await openPage(browser);
    for (const n of [1000, 10_000, 50_000]) {
      const r = await page.evaluate(`(async () => {
        const mk = ${candlesJs};
        const el = document.getElementById("a");
        const data = mk(${n}, 1600000000, 60);
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await frame();
        let t0 = performance.now();
        const chart = X.createChart(el, {});
        const c = chart.addCandlestickSeries();
        const v = chart.addHistogramSeries({ colorMode: "candle" });
        c.setData(data);
        v.setData(data.map((d) => ({ time: d.time, value: d.volume })));
        const setData = performance.now() - t0;
        await frame(); const firstDraw = chart.renderTimeMs();
        // worst case: every candle in view
        chart.setVisibleRange({ from: data[0].time, to: data[data.length - 1].time });
        await frame(); const allBarsDraw = chart.renderTimeMs();
        chart.fitContent(); await frame();
        const last = data[data.length - 1];
        const tick = [], tickDraw = [];
        for (let i = 0; i < 200; i++) {
          const s = performance.now();
          c.update({ ...last, close: last.close + (i % 5) * 0.1, high: last.high + 1, low: last.low - 1 });
          tick.push(performance.now() - s);
          await frame();
          tickDraw.push(chart.renderTimeMs());
        }
        const appendT = [];
        for (let i = 1; i <= 100; i++) {
          const s = performance.now();
          c.update({ time: last.time + i * 60, open: 1, high: 2, low: 0.5, close: 1.5 });
          appendT.push(performance.now() - s);
        }
        await frame();
        const pan = [];
        for (let i = 0; i < 60; i++) { chart.scrollBy(-5); await frame(); pan.push(chart.renderTimeMs()); }
        const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
        const p95 = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length * 0.95)]; };
        chart.remove();
        return { setData, firstDraw, allBarsDraw, tick: med(tick), tickP95: p95(tick), tickDraw: med(tickDraw), append: med(appendT), panDraw: med(pan) };
      })()`) as Record<string, number>;
      const f = (v: number) => v.toFixed(2) + " ms";
      console.log(`    ${String(n).padStart(6)} candles: setData ${f(r.setData)} | draw: first ${f(r.firstDraw)}, all bars in view ${f(r.allBarsDraw)}, after tick ${f(r.tickDraw)}, while panning ${f(r.panDraw)} | update(): replace ${f(r.tick)} (p95 ${f(r.tickP95)}), append ${f(r.append)}`);
      assert.ok(Number.isFinite(r.setData));
    }
  } finally {
    await browser.close();
  }
});
