/**
 * XChart before/after benchmark: runs the same workload against two SDK checkouts in a real
 * browser (Playwright) and prints median / p95 / max per metric.
 *
 *   node --experimental-strip-types --no-warnings scripts/xchart-bench.ts [--root <dir>]... [--quick]
 *
 * Each --root is a repository checkout (default: this one). Data is synthetic (deterministic
 * random walk); no market data is used. Results depend on hardware: compare runs from one machine.
 * Env: XCHART_BROWSER=chromium|firefox|webkit (default chromium).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import { join, normalize, resolve } from "node:path";
import { createServer } from "node:http";
import os from "node:os";

const require = createRequire(import.meta.url);
const strip = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pw: any = require("playwright");
const ENGINE = (process.env.XCHART_BROWSER ?? "chromium") as "chromium" | "firefox" | "webkit";

const args = process.argv.slice(2);
const roots: string[] = [];
for (let i = 0; i < args.length; i++) if (args[i] === "--root") roots.push(resolve(args[++i]));
if (!roots.length) roots.push(resolve(import.meta.dirname, ".."));
const QUICK = args.includes("--quick");

const SIZES = QUICK ? [1000, 10_000] : [1000, 10_000, 50_000, 100_000];
const COUNTS = QUICK ? [1, 5] : [1, 5, 10, 20];
const SYNC = QUICK ? [1, 2] : [1, 2, 4, 8];

const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#000"><div id="host"></div><script type="module">
  window.frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Deterministic random walk (mulberry32), 1-minute bars.
  window.mk = (n, start = 1600000000, step = 60) => {
    let s = 12345; const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let c = 1000; const out = new Array(n);
    for (let i = 0; i < n; i++) { const o = c; c = Math.max(1, c + (rnd() - 0.5) * 4); const h = Math.max(o, c) + rnd() * 2, l = Math.min(o, c) - rnd() * 2; out[i] = { time: start + i * step, open: o, high: h, low: l, close: c, volume: 1000 + Math.floor(rnd() * 9000) }; }
    return out;
  };
  window.stats = (a) => { const b = [...a].sort((x, y) => x - y); return { med: b[b.length >> 1], p95: b[Math.min(b.length - 1, Math.floor(b.length * 0.95))], max: b[b.length - 1] }; };
  window.box = (w, h) => { const d = document.createElement("div"); d.style.cssText = "width:" + w + "px;height:" + h + "px;display:inline-block"; document.getElementById("host").appendChild(d); return d; };
  window.X = await import("/lib/xchart-sdk/index.ts");
  window.ready = true;
</script></body></html>`;

function serve(root: string): Promise<{ origin: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(PAGE);
    }
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || !file.endsWith(".ts")) {
      res.writeHead(404);
      return res.end("");
    }
    try {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(strip(readFileSync(file, "utf8")));
    } catch {
      res.writeHead(404);
      res.end("");
    }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    const a = server.address() as { port: number };
    r({ origin: `http://127.0.0.1:${a.port}`, close: () => server.close() });
  }));
}

type S = { med: number; p95: number; max: number };
const f = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2));
const s = (o: S) => `${f(o.med)} / ${f(o.p95)} / ${f(o.max)}`;

async function run(root: string, ids: string[] | null) {
  const { origin, close } = await serve(root);
  const browser = await pw[ENGINE].launch();
  const rows: string[] = [];
  let version = "?";
  let usedIds: string[] = ids ?? [];
  try {
    const fresh = async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(origin + "/");
      await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true, null, { timeout: 30000 });
      return { page, errors };
    };
    {
      const { page } = await fresh();
      version = await page.evaluate("X.XCHART_VERSION");
      if (!ids) {
        usedIds = await page.evaluate(`(() => { const c = X.createChart(box(10, 10)); const r = c.listIndicators().map((d) => d.id).filter((id) => id !== "volume"); c.remove(); return r; })()`);
      }
      await page.close();
    }
    for (const n of SIZES) {
      for (const k of COUNTS) {
        const { page, errors } = await fresh();
        const r = await page.evaluate(`(async () => {
          const el = box(1200, 700);
          const data = mk(${n});
          const ids = ${JSON.stringify(usedIds)}.slice(0, ${k});
          let t0 = performance.now();
          const chart = X.createChart(el, { followLatest: true });
          const c = chart.addCandlestickSeries();
          c.setData(data);
          await frame();
          const load = performance.now() - t0;
          t0 = performance.now();
          for (const id of ids) chart.addIndicator(id);
          await frame();
          const add = performance.now() - t0;
          const last = data[data.length - 1];
          // Main-thread cost of a live update = update() call + the frame it causes (indicator flush + draw).
          const tick = [], draw = [];
          for (let i = 0; i < 100; i++) {
            const s = performance.now();
            c.update({ ...last, close: last.close + (i % 7) * 0.1, high: last.high + 1, low: last.low - 1 });
            const call = performance.now() - s;
            await frame();
            const d = chart.renderTimeMs() ?? 0;
            tick.push(call + d); draw.push(d);
          }
          const app = [];
          for (let i = 1; i <= 50; i++) {
            const s = performance.now();
            c.update({ time: last.time + i * 60, open: last.close, high: last.close + 1, low: last.close - 1, close: last.close + 0.5, volume: 1000 });
            const call = performance.now() - s;
            await frame();
            app.push(call + (chart.renderTimeMs() ?? 0));
          }
          const pan = [];
          for (let i = 0; i < 40; i++) { chart.scrollBy(i % 2 ? 5 : -7); await frame(); pan.push(chart.renderTimeMs() ?? 0); }
          // Crosshair: pointer moves over the plot (synthetic events on the canvas).
          const cv = el.querySelector("canvas"); const rect = cv.getBoundingClientRect();
          const xh = [];
          for (let i = 0; i < 60; i++) {
            const s = performance.now();
            cv.dispatchEvent(new PointerEvent("pointermove", { clientX: rect.left + 100 + i * 10, clientY: rect.top + 200 + (i % 10) * 5, bubbles: true, pointerType: "mouse" }));
            await frame();
            const st = chart.renderStats ? chart.renderStats() : null;
            // v0.3.1 reports crosshair-only frames separately; v0.3.0 redraws the full frame.
            xh.push(st && st.overlayFrames > 0 ? st.lastOverlayMs : (chart.renderTimeMs() ?? 0));
          }
          const heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
          t0 = performance.now(); chart.remove(); const destroy = performance.now() - t0;
          return { load, add, tick: stats(tick), draw: stats(draw), app: stats(app), pan: stats(pan), xh: stats(xh), heap, destroy };
        })()`);
        rows.push(`| ${n} | ${k} | ${f(r.load)} | ${f(r.add)} | ${s(r.tick)} | ${s(r.draw)} | ${s(r.app)} | ${s(r.pan)} | ${s(r.xh)} | ${r.heap == null ? "n/a" : r.heap.toFixed(0)} | ${f(r.destroy)} |${errors.length ? " errors: " + errors.join("; ") : ""}`);
        process.stderr.write(".");
        await page.close();
      }
    }
    const syncRows: string[] = [];
    for (const m of SYNC) {
      const { page, errors } = await fresh();
      const r = await page.evaluate(`(async () => {
        const charts = [];
        const data = mk(10000);
        for (let j = 0; j < ${m}; j++) {
          const ch = X.createChart(box(680, 300), { followLatest: true });
          const c = ch.addCandlestickSeries(); c.setData(data);
          for (const id of ${JSON.stringify(usedIds)}.slice(0, 5)) ch.addIndicator(id);
          charts.push({ ch, c });
        }
        const group = ${m} > 1 ? X.syncCharts(charts.map((x) => x.ch)) : null;
        await frame();
        const pan = [];
        // Main-thread cost: the call (incl. sync propagation) + every chart's frame.
        const drawn = () => charts.reduce((a, x) => a + (x.ch.renderTimeMs() ?? 0), 0);
        const overlay = () => charts.reduce((a, x) => { const st = x.ch.renderStats ? x.ch.renderStats() : null; return a + (st && st.overlayFrames > 0 ? st.lastOverlayMs : (x.ch.renderTimeMs() ?? 0)); }, 0);
        for (let i = 0; i < 40; i++) { const s = performance.now(); charts[0].ch.scrollBy(i % 2 ? 5 : -7); const call = performance.now() - s; await frame(); pan.push(call + drawn()); }
        const tick = [];
        const last = data[data.length - 1];
        for (let i = 0; i < 60; i++) { const s = performance.now(); for (const x of charts) x.c.update({ ...last, close: last.close + (i % 5) * 0.1 }); const call = performance.now() - s; await frame(); tick.push(call + drawn()); }
        const cv = document.querySelector("canvas"); const rect = cv.getBoundingClientRect();
        const xh = [];
        for (let i = 0; i < 60; i++) { const s = performance.now(); cv.dispatchEvent(new PointerEvent("pointermove", { clientX: rect.left + 50 + i * 8, clientY: rect.top + 120, bubbles: true, pointerType: "mouse" })); const call = performance.now() - s; await frame(); xh.push(call + overlay()); }
        group?.destroy(); for (const x of charts) x.ch.remove();
        return { pan: stats(pan), tick: stats(tick), xh: stats(xh) };
      })()`);
      syncRows.push(`| ${m} | ${s(r.pan)} | ${s(r.tick)} | ${s(r.xh)} |${errors.length ? " errors: " + errors.join("; ") : ""}`);
      process.stderr.write(".");
      await page.close();
    }
    process.stderr.write("\n");
    return { version, ids: usedIds, rows, syncRows, browserVersion: browser.version() };
  } finally {
    await browser.close();
    close();
  }
}

let ids: string[] | null = null;
const results = [];
for (const root of roots) {
  const r = await run(root, ids);
  ids = r.ids; // the first checkout's indicator list is reused so both run the same indicators
  results.push({ root, ...r });
}
console.log(`Environment: ${ENGINE} ${results[0].browserVersion}, Node ${process.version}, ${os.cpus()[0]?.model ?? "cpu"} ×${os.cpus().length}, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB, ${os.platform()} ${os.release()}`);
console.log(`Indicators (in order): ${ids!.join(", ")}`);
for (const r of results) {
  console.log(`\n### XChart ${r.version} (${r.root})\n`);
  console.log("| candles | indicators | setData→first frame ms | add indicators→frame ms | live tick: update()+frame (med / p95 / max) | of which draw | append bar: update()+frame | pan draw | crosshair frame | JS heap MB | destroy ms |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const row of r.rows) console.log(row);
  console.log("\nSynced charts (10k candles, 5 indicators each):\n");
  console.log("| charts | pan: call + all frames (med / p95 / max) | live tick on every chart | crosshair (synced) |");
  console.log("|---|---|---|---|");
  for (const row of r.syncRows) console.log(row);
}
