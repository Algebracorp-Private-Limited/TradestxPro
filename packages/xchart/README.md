# @tradestxpro/xchart

Financial charting SDK built on TradestXPro's own canvas engine: candles and 11 time-based chart
types, Renko / Kagi / Point & Figure / Line Break / Range bars, 122 incrementally computed
indicators, 27 drawing tools, independent price scales, multi-pane layouts, chart synchronisation,
trading calendars, layouts, plugins and an indicator Web Worker.

> **Status:** v0.4.0, not published to a public registry. Distributed as a tarball under the terms
> in [LICENSE](LICENSE). This package contains no market data.

## Install

```bash
npm install ./tradestxpro-xchart-0.4.0.tgz
```

## Use

```ts
import { createChart } from "@tradestxpro/xchart";

const chart = createChart(document.getElementById("chart")!, { theme: "dark" });
const candles = chart.addCandlestickSeries();
candles.setData([{ time: 1704067200, open: 100, high: 102, low: 99, close: 101, volume: 1200 } /* … */]);
chart.addIndicator("ema", { length: 20 });
chart.addIndicator("rsi");
candles.update({ time: 1704067200, open: 100, high: 103, low: 99, close: 102.5 }); // live tick: O(1) per indicator
```

`time` is UTC seconds. The chart follows its container's size.

### React / Next.js

```tsx
"use client";
import { XChart } from "@tradestxpro/xchart/react";

<XChart style={{ height: 420 }} options={{ theme: "dark" }} onReady={(chart) => chart.addCandlestickSeries().setData(data)} />;
```

`useXChart(options)` returns `{ ref, chart }` for custom markup. Importing the package during
server rendering is safe; charts are created only after mount.

### Vue, Angular, plain JavaScript

See `examples/` in the source repository (Vue 3 component, Angular standalone component, plain ES
modules without a bundler, Node SSR in ESM and CommonJS, TypeScript).

## Module formats

| Entry | ES module | CommonJS | Types |
|---|---|---|---|
| `@tradestxpro/xchart` | `dist/esm/index.js` | `dist/cjs/index.js` | `dist/types/index.d.ts` |
| `@tradestxpro/xchart/react` | `dist/esm/react.js` | `dist/cjs/react.js` | `dist/types/react.d.ts` |
| `@tradestxpro/xchart/worker` | `dist/esm/workers/indicator-worker.js` | — | ✓ |

* `"sideEffects": false`: bundlers drop unused modules.
* `IndicatorWorkerClient` starts a module Web Worker from the ES module build. From CommonJS, or with
  bundlers that cannot resolve `new URL(…, import.meta.url)`, pass `createWorker`; without a worker
  the client computes on the main thread (`fallbackReason` says why).

## Your market data

The SDK never fetches data. Convert your feed to `{ time, open, high, low, close, volume }` with UTC
seconds and call `setData` / `update`. Invalid bars are rejected with typed `XChartError`s
(`validateBars` reports every problem), and nothing is modified or invented: gaps stay gaps.

## Documentation

API reference, guides, examples, browser compatibility and the changelog: the TradestXPro developer
portal (`/developers`) and `docs/xchart/` in the source repository.

## Requirements

ES2022 browsers with canvas 2D, `ResizeObserver` and `Intl` time zones (tested: Chromium 153,
Firefox 155, WebKit 26.6). Node ≥ 18 for server-side use (no DOM needed to import or compute).
