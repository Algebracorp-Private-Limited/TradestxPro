// Package integration test: builds and packs @tradestxpro/xchart, installs the tarball into
// independent sample projects and checks each one for real:
//   node-ssr     ESM import + CJS require in Node (no DOM)
//   typescript   tsc --noEmit against the published declarations (NodeNext and Bundler resolution)
//   exports      subpath exports resolve; internal files are not importable
//   vanilla      plain ES modules in a browser: pixels drawn, module Web Worker used
//   vue          Vue 3 (vue.esm-browser from npm): pixels drawn
//   next-app     Next.js (App Router, SSR) + React bindings: `next build`, `next start`, pixels drawn
// Usage: node packages/xchart/tests/integration.mjs [--skip-next] [--browser chromium|firefox|webkit]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { extname, join, normalize, resolve } from "node:path";
import assert from "node:assert/strict";

const PKG = resolve(import.meta.dirname, "..");
const ROOT = resolve(PKG, "../..");
const SAMPLES = join(PKG, ".samples");
const args = process.argv.slice(2);
const ENGINE = args.includes("--browser") ? args[args.indexOf("--browser") + 1] : "chromium";
const require = createRequire(join(ROOT, "package.json"));
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`✖ ${name}: ${e.message}`);
  }
};
const run = (cmd, argv, cwd, env = {}) => execFileSync(cmd, argv, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

rmSync(SAMPLES, { recursive: true, force: true });
mkdirSync(SAMPLES, { recursive: true });

let tarball = "";
await step("build + npm pack", () => {
  run(process.execPath, [join(PKG, "scripts/build.mjs")], PKG);
  const out = JSON.parse(run(npm, ["pack", "--json", "--ignore-scripts", "--pack-destination", SAMPLES], PKG));
  tarball = join(SAMPLES, out[0].filename);
  const files = out[0].files.map((f) => f.path);
  assert.ok(files.includes("dist/esm/index.js") && files.includes("dist/cjs/index.js") && files.includes("dist/types/index.d.ts"), "dist in tarball");
  assert.ok(files.includes("LICENSE") && files.includes("README.md"), "LICENSE and README in tarball");
  assert.ok(!files.some((f) => f.startsWith("src/") || f.startsWith(".build/") || f.startsWith("examples/")), "only dist and docs are published");
  console.log(`  ${out[0].filename}: ${out[0].files.length} files, ${(out[0].size / 1024).toFixed(0)} KiB packed, ${(out[0].unpackedSize / 1024).toFixed(0)} KiB unpacked`);
});

function sample(name, extraDeps = {}) {
  const dir = join(SAMPLES, name);
  cpSync(join(PKG, "examples", name), dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `xchart-sample-${name}`, private: true, type: "module", dependencies: { "@tradestxpro/xchart": `file:${tarball}`, ...extraDeps } }, null, 2));
  run(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  return dir;
}

await step("node-ssr: ESM import and CJS require without a DOM", () => {
  const dir = sample("node-ssr");
  const esm = JSON.parse(run(process.execPath, ["index.mjs"], dir));
  assert.equal(esm.version, "0.4.0");
  assert.equal(esm.indicators, 122);
  assert.ok(Math.abs(esm.smaLast - (111 + 114 + 118) / 3) < 1e-9, "SMA computed");
  assert.ok(esm.renko > 0, "Renko computed");
  const cjs = JSON.parse(run(process.execPath, ["index.cjs"], dir));
  assert.equal(cjs.version, "0.4.0");
  assert.equal(cjs.usesWorker, false, "no Worker in Node: main-thread fallback");
});

await step("typescript: declarations type-check (NodeNext and Bundler resolution)", () => {
  const dir = sample("typescript");
  // React types for the /react entry come from the repository (the sample has no React installed).
  mkdirSync(join(dir, "node_modules/@types"), { recursive: true });
  cpSync(join(ROOT, "node_modules/@types/react"), join(dir, "node_modules/@types/react"), { recursive: true });
  const tsc = require.resolve("typescript/bin/tsc");
  run(process.execPath, [tsc, "-p", "tsconfig.json"], dir);
  writeFileSync(join(dir, "tsconfig.bundler.json"), JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { module: "ESNext", moduleResolution: "Bundler" } }));
  run(process.execPath, [tsc, "-p", "tsconfig.bundler.json"], dir);
});

await step("exports: subpaths resolve, internals are encapsulated", () => {
  const dir = join(SAMPLES, "node-ssr");
  const req = createRequire(join(dir, "package.json"));
  assert.ok(req.resolve("@tradestxpro/xchart").endsWith("dist/cjs/index.js"));
  assert.ok(req.resolve("@tradestxpro/xchart/react").endsWith("dist/cjs/react.js"));
  assert.throws(() => req.resolve("@tradestxpro/xchart/dist/esm/create-chart.js"), /not defined by "exports"|ERR_PACKAGE_PATH_NOT_EXPORTED/);
  const manifest = JSON.parse(readFileSync(join(dir, "node_modules/@tradestxpro/xchart/package.json"), "utf8"));
  assert.equal(manifest.sideEffects, false, "tree-shakable");
  assert.equal(manifest.private, true, "cannot be published by accident");
});

// ---------- browsers ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
function serve(dir) {
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(dir, p.endsWith("/") ? p + "index.html" : p));
    if (!file.startsWith(dir) || !existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}
let pw = null;
try {
  pw = require("playwright");
} catch {
  console.log("playwright unavailable: browser checks skipped");
}
async function pixelsDrawn(page) {
  return page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return 0;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 || d[i + 1] > 150) n++;
    return n;
  });
}
async function browserCheck(dir, path, extra) {
  const s = await serve(dir);
  const browser = await pw[ENGINE].launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(s.url + path);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    assert.ok((await pixelsDrawn(page)) > 2000, "chart pixels drawn");
    if (extra) await extra(page);
    assert.deepEqual(errors, [], "no page errors");
  } finally {
    await browser.close();
    s.close();
  }
}
if (pw) {
  await step(`vanilla (${ENGINE}): ES modules, module worker, pixels`, async () => {
    const dir = sample("vanilla");
    await browserCheck(dir, "index.html", async (page) => {
      const r = await page.evaluate(() => window.result);
      assert.equal(r.version, "0.4.0");
      assert.equal(r.worker, true, "module Web Worker from the ESM build");
      assert.ok(r.rsiLast > 0 && r.rsiLast < 100);
    });
  });
  await step(`vue (${ENGINE}): Vue 3 component, pixels`, async () => {
    const dir = sample("vue", { vue: "^3.5.0" });
    await browserCheck(dir, "index.html");
  });
  if (!args.includes("--skip-next")) {
    await step(`next-app (${ENGINE}): Next.js build (SSR) + React bindings, pixels`, async () => {
      const dir = sample("next-app");
      const next = join(ROOT, "node_modules/next/dist/bin/next");
      const env = { XCHART_SAMPLE_ROOT: ROOT, NEXT_TELEMETRY_DISABLED: "1" };
      const out = run(process.execPath, [next, "build"], dir, env);
      assert.match(out, /Compiled successfully|✓/);
      const port = 3900 + Math.floor(Math.random() * 90);
      const srv = spawn(process.execPath, [next, "start", "-p", String(port)], { cwd: dir, env: { ...process.env, ...env }, stdio: "ignore" });
      try {
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/`);
            if (r.ok) {
              const html = await r.text();
              assert.match(html, /XChart on Next\.js/, "server-rendered HTML");
              break;
            }
          } catch {}
          await new Promise((r) => setTimeout(r, 500));
        }
        const browser = await pw[ENGINE].launch();
        try {
          const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(`http://127.0.0.1:${port}/`);
          await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
          await page.waitForTimeout(300);
          assert.ok((await pixelsDrawn(page)) > 2000, "chart pixels drawn");
          assert.deepEqual(errors, []);
        } finally {
          await browser.close();
        }
      } finally {
        srv.kill();
      }
    });
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} package checks passed`);
writeFileSync(join(SAMPLES, "results.json"), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
