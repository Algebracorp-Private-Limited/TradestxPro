# SDK packaging (`@tradestxpro/xchart`)

## Layout

```
packages/xchart/
  package.json      name, version 0.4.0, exports map, "private": true (blocks npm publish)
  src/react.ts      package-only entry: React bindings (XChart, useXChart)
  scripts/build.mjs stages the SDK sources and compiles dist/
  examples/         vanilla, node-ssr, typescript, next-app, vue, angular
  tests/integration.mjs  npm pack + install into sample projects + checks
  README.md  LICENSE  CHANGELOG.md
  dist/             (generated) esm/, cjs/, types/
```

## Single source of truth

The SDK keeps living where the application uses it: `lib/xchart-sdk/`, the canvas engine
`components/chart/engine.ts`, `lib/chart/geometry.ts` and the indicator maths in `lib/ta/`. The build
copies exactly that closure into `packages/xchart/.build/src`, rewrites relative imports to the
package layout and **fails if any file imports something outside the closure** (or uses an `@/` alias).
A unit test (`tests/xchart-package.test.ts`) additionally rejects Next.js, `server-only`,
`process.env`, database, auth or broker imports in the SDK sources.

## Outputs

| Output | Compiler settings | Notes |
|---|---|---|
| `dist/esm` | ES2022 modules, `rewriteRelativeImportExtensions` | Tree-shakable (`sideEffects: false`); module worker via `new URL("./indicator-worker.js", import.meta.url)` |
| `dist/cjs` | CommonJS | `import.meta` does not exist: the default worker is replaced by a fallback; pass `createWorker` |
| `dist/types` | declarations | One `.d.ts` per module; subpath `types` conditions in `exports` |

## Commands

```bash
node packages/xchart/scripts/build.mjs                 # build dist/
(cd packages/xchart && npm pack)                       # tradestxpro-xchart-0.4.0.tgz (runs the build via prepack)
node packages/xchart/tests/integration.mjs             # pack + install + verify (chromium; --skip-next, --browser)
```

## Verification (integration test, 7 checks)

1. Tarball contents: only `dist`, README, LICENSE, CHANGELOG (146 files, 277 KiB packed).
2. Node: ESM `import` and CJS `require` without a DOM; indicators and Renko computed server-side.
3. TypeScript consumer type-checks against the declarations with `NodeNext` and `Bundler` resolution, including the React entry.
4. `exports` resolve for `.` and `./react`; internal files are not importable; `sideEffects: false`; `private: true`.
5. Plain ES modules in a browser: chart pixels drawn; `IndicatorWorkerClient` runs in a real module worker.
6. Vue 3 (`vue.esm-browser` from npm): component mounts the chart; pixels drawn.
7. Next.js App Router: `next build` (server-rendered page), `next start`, React bindings draw the chart.

CI job: `XChart CI / package` (Chromium). The Angular example is a reference component and is not built in CI.

## Not done

* Not published to npm (by instruction). Distribution is by tarball.
* No UMD/IIFE bundle (ES modules work directly in browsers).
