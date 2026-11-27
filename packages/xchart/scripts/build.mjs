// Builds @tradestxpro/xchart from the canonical sources in this repository.
//
// The SDK's single source of truth stays where the application uses it (lib/xchart-sdk, the canvas
// engine in components/chart, the indicator maths in lib/ta). This script stages those files into
// packages/xchart/.build/src with rewritten relative imports, adds the package-only entry points
// from packages/xchart/src, and compiles:
//   dist/esm   ES modules (tree-shakable, "sideEffects": false)
//   dist/cjs   CommonJS (module workers unavailable: the worker client falls back to the main thread
//              unless `createWorker` is given)
//   dist/types declarations
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const PKG = resolve(import.meta.dirname, "..");
const ROOT = resolve(PKG, "../..");
const STAGE = join(PKG, ".build");
const SRC = join(STAGE, "src");
const DIST = join(PKG, "dist");

/** repo path (file or directory) → staged path */
const MAP = [
  ["lib/xchart-sdk", "src"],
  ["components/chart/engine.ts", "src/engine/engine.ts"],
  ["lib/chart/geometry.ts", "src/engine/geometry.ts"],
  ["lib/ta/catalog.ts", "src/ta/catalog.ts"],
  ["lib/ta/indicators.ts", "src/ta/indicators.ts"],
];

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const toPosix = (p) => p.split(sep).join("/");

function stagedPathOf(abs) {
  const rel = toPosix(relative(ROOT, abs));
  for (const [from, to] of MAP) {
    if (rel === from) return join(STAGE, to);
    if (rel.startsWith(from + "/")) return join(STAGE, to, rel.slice(from.length + 1));
  }
  return null;
}

rmSync(STAGE, { recursive: true, force: true });
rmSync(DIST, { recursive: true, force: true });
const files = [];
for (const [from] of MAP) {
  const abs = join(ROOT, from);
  for (const f of statSync(abs).isDirectory() ? walk(abs) : [abs]) if (f.endsWith(".ts")) files.push(f);
}
for (const f of files) {
  const out = stagedPathOf(f);
  let code = readFileSync(f, "utf8");
  code = code.replace(/(from\s+|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (m, pre, q, spec) => {
    const target = resolve(dirname(f), spec);
    const staged = stagedPathOf(target);
    if (!staged) throw new Error(`${relative(ROOT, f)} imports ${spec}, which is outside the SDK closure`);
    let r = toPosix(relative(dirname(out), staged));
    if (!r.startsWith(".")) r = "./" + r;
    return `${pre}${q}${r}${q}`;
  });
  if (/from\s+["']@\//.test(code)) throw new Error(`${relative(ROOT, f)} uses an application path alias`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, code);
}
// Package-only entry points (React bindings).
cpSync(join(PKG, "src"), SRC, { recursive: true });

// The default module-worker URL must point at the compiled file.
const wc = join(SRC, "workers/worker-client.ts");
writeFileSync(wc, readFileSync(wc, "utf8").replace('new URL("./indicator-worker.ts", import.meta.url)', 'new URL("./indicator-worker.js", import.meta.url)'));

const base = {
  target: "ES2022",
  lib: ["ES2022", "DOM", "DOM.Iterable"],
  strict: true,
  skipLibCheck: true,
  isolatedModules: true,
  rewriteRelativeImportExtensions: true,
  allowImportingTsExtensions: false,
  verbatimModuleSyntax: false,
  esModuleInterop: true,
  jsx: "react-jsx",
};
const tsc = createRequire(join(ROOT, "package.json")).resolve("typescript/bin/tsc");
function compile(name, opts) {
  const cfg = join(STAGE, `tsconfig.${name}.json`);
  writeFileSync(cfg, JSON.stringify({ compilerOptions: { ...base, ...opts }, include: ["src/**/*.ts"] }, null, 2));
  execFileSync(process.execPath, [tsc, "-p", cfg], { stdio: "inherit" });
}
compile("esm", { module: "ES2022", moduleResolution: "bundler", outDir: join(DIST, "esm"), declaration: true, declarationDir: join(DIST, "types") });

// CommonJS: `import.meta` does not exist there, so the default module worker is unavailable
// (IndicatorWorkerClient falls back to the main thread and says so in `fallbackReason`).
writeFileSync(wc, readFileSync(wc, "utf8").replace(
  'new Worker(new URL("./indicator-worker.js", import.meta.url), { type: "module" })',
  '(() => { throw new Error("module workers need the ES module build (or pass createWorker)"); })()',
));
compile("cjs", { module: "CommonJS", moduleResolution: "node10", outDir: join(DIST, "cjs"), declaration: false });
writeFileSync(join(DIST, "cjs/package.json"), JSON.stringify({ type: "commonjs" }) + "\n");

if (!existsSync(join(DIST, "esm/index.js")) || !existsSync(join(DIST, "cjs/index.js")) || !existsSync(join(DIST, "types/index.d.ts"))) {
  throw new Error("build output incomplete");
}
console.log(`@tradestxpro/xchart built: ${files.length} SDK sources → dist/esm, dist/cjs, dist/types`);
