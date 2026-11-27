import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

test("developer portal API reference is generated from the current SDK", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "scripts/xchart-api-reference.mjs"), "--check"], { encoding: "utf8" });
  assert.match(out, /up to date/);
  const api = JSON.parse(readFileSync(join(ROOT, "app/developers/api-reference/api.json"), "utf8"));
  const names = new Set(api.items.map((i: { name: string }) => i.name));
  for (const n of ["createChart", "ChartApi", "SeriesApi", "IndicatorDefinition", "syncCharts", "IndicatorWorkerClient", "XChartError", "computeDerived"]) assert.ok(names.has(n), n);
});

test("package manifest: private (no accidental publish), dual format, typed subpaths, same version as the SDK", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "packages/xchart/package.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.sideEffects, false);
  for (const [k, v] of Object.entries(pkg.exports as Record<string, Record<string, string> | string>)) {
    if (k === "./package.json") continue;
    assert.ok(typeof v === "object" && v.types && v.import, `${k} has types and import`);
  }
  const sdkVersion = /XCHART_VERSION = "([^"]+)"/.exec(readFileSync(join(ROOT, "lib/xchart-sdk/index.ts"), "utf8"))![1];
  assert.equal(pkg.version, sdkVersion);
  assert.deepEqual(pkg.files.sort(), ["CHANGELOG.md", "LICENSE", "README.md", "dist"]);
});

test("package sources stay framework- and application-independent", () => {
  // The build stages lib/xchart-sdk + engine + lib/ta and fails on any import outside that closure;
  // here we also check for application coupling in the SDK sources directly.
  let out = "";
  try {
    out = execFileSync("grep", ["-rlE", "from \"(@/|next/|server-only)|process\\.env|lib/(db|auth|brokers)", join(ROOT, "lib/xchart-sdk"), join(ROOT, "components/chart/engine.ts"), join(ROOT, "lib/ta"), join(ROOT, "lib/chart")], { encoding: "utf8" }).trim();
  } catch (e) {
    if ((e as { status?: number }).status !== 1) throw e; // grep: 1 = no match (the expected outcome)
  }
  assert.equal(out, "", `application-coupled files: ${out}`);
});
