# XChart SDK (v0.3.1)

A TypeScript API for building financial charts on top of TradestXPro's own canvas chart engine.
It is **not published as an npm package**. It lives in `lib/xchart-sdk/` in this repository and is
structured so it can later be published as `@tradestxpro/xchart`.

## What's new in v0.3.1 (rendering, performance, SDK completion)

* **Price-based chart types rendered**: Renko, Kagi, Point & Figure, Line Break and Range bars on a
  logical axis, built incrementally from candles, with confirmed / provisional elements and no
  invented timestamps ([derived-data-model.md](xchart/derived-data-model.md)).
* **Incremental indicator engine**: all built-ins update in O(1)–O(window) per tick, exactly,
  with shared nodes and checkpoints; live ticks at 100k candles × 20 indicators went from 264 ms
  to 3.6 ms median ([incremental-indicators.md](xchart/incremental-indicators.md),
  [performance.md](xchart/performance.md)).
* **122 built-in indicators** with formula metadata, search and compatibility checks
  ([indicator-catalog.md](xchart/indicator-catalog.md)).
* **Indicator Web Worker** with versioned, validated protocol, coalescing, stale-result rejection
  and cancellation ([worker-architecture.md](xchart/worker-architecture.md)).
* **Independent price scales** (log / % / indexed / inverted / manual range on every scale),
  **drawings on any pane**, crosshair-only redraws from a cached frame.
* **Calendar providers**: versioned exchange-calendar datasets, `dayStatus`, overnight sessions
  ([calendar-providers.md](xchart/calendar-providers.md)).
* **Cross-browser CI**: Chromium, Firefox and WebKit are mandatory jobs
  ([browser-compatibility.md](xchart/browser-compatibility.md)).
* Upgrading: [migration-v0.3.1.md](xchart/migration-v0.3.1.md).

## What's new in v0.3.0 (Advanced API)

Detailed guides live in [`docs/xchart/`](xchart/README.md).

| Area | API | Guide |
|---|---|---|
| Indicators | `chart.addIndicator(type, config)`, registries, custom definitions, 22 built-ins | [indicators.md](xchart/indicators.md) |
| Clouds | `chart.addCloudSeries()` (two boundaries, colour switch at crossings, displacement) | [indicators.md](xchart/indicators.md#cloud-series) |
| Drawings | 27 tools, `chart.addDrawing()`, interactive tools, undo/redo, serialisation | [drawings.md](xchart/drawings.md) |
| Markers & price lines | `series.setMarkers()`, `series.createPriceLine()` | [drawings.md](xchart/drawings.md#markers) |
| Scales & panes | percentage/indexed modes, overlay & left scales, margins, `chart.panes()` | [scales-and-panes.md](xchart/scales-and-panes.md) |
| Sync & calendars | `syncCharts()`, `TradingCalendar`, session shading, IANA time zones | [sync-and-calendars.md](xchart/sync-and-calendars.md) |
| Chart types | `chart.setChartType()` (11 time-based types), price-based calculations | [chart-types.md](xchart/chart-types.md) |
| Layouts | `chart.saveLayout()` / `chart.loadLayout()` | [layouts.md](xchart/layouts.md) |
| Plugins | `chart.use()` (trusted, not sandboxed) | [plugins.md](xchart/plugins.md) |
| Events | `chart.on()`, `chart.once()` | [events.md](xchart/events.md) |
| Performance | benchmarks and limits | [performance.md](xchart/performance.md) |

Everything from v0.2.1 keeps working unchanged; see [migration](xchart/migration-v0.3.md).

## What changed in v0.2.1

* **Market-data integrity:** source OHLC is never repaired or clamped, timestamps are never
  rounded, zero volume is kept, and no record is dropped silently. Strict mode (default) rejects a
  dataset with any invalid record; tolerant mode (opt-in) quarantines bad records and returns a
  validation report. See [Market data](#market-data-validation).
* **Validation:** chart options are validated at creation and in `applyOptions` (dimensions,
  theme, price scale, UTC offset, booleans), series options are checked for real CSS colours,
  widths, opacity, line styles, colour modes, unknown keys and combinations. Every failure is an
  `XChartError` with a code, raised before anything changes.
* **Lifecycle:** removed series and destroyed charts throw `SERIES_REMOVED` / `CHART_REMOVED`
  consistently; repeated removal is a no-op; a failed construction removes its wrapper and canvas;
  destruction releases data arrays, series references, subscribers, listeners and observers.
* **Crosshair:** a stationary pointer now receives updated values after live updates, data
  replacement and series removal; new subscribers get the current state; unsubscribing during
  delivery is respected.
* **Live view:** appending bars no longer moves the viewport unless `followLatest: true`;
  full re-renders keep the same visible time window; switching daily ↔ intraday data refits.
* **CI:** `.github/workflows/xchart-ci.yml` runs typecheck, lint, unit tests, the production
  build and mandatory Chromium canvas tests.

> No third-party charting code: rendering is done by `components/chart/engine.ts` (TradestXPro's
> engine). TradingView libraries/widgets are not used.

## Architecture

```
Application code
   │  createChart(), series.setData(), series.update(), subscribeCrosshairMove() …
   ▼
XChart SDK                       lib/xchart-sdk/
   ├─ create-chart.ts            public API: ChartImpl / SeriesImpl, events, lifecycle
   ├─ store.ts                   SeriesStore: shared time axis + aligned arrays (pure TS)
   ├─ validation.ts              data / option / range validation, XChartError
   ├─ types.ts                   public types (framework-independent)
   ├─ market-data.ts             TradestXPro /api/charts/bars → SDK candles
   └─ canvas-adapter.ts          RenderAdapter interface + CanvasAdapter
   ▼
ChartEngine                      components/chart/engine.ts (unchanged rendering, a few opt-in hooks)
   ▼
<canvas>
```

* **Data** is owned by the SDK (`SeriesStore`). All series share one time axis: the sorted union of
  every series' timestamps. A series without a point at some time is a gap there (`NaN` internally).
* **Rendering** is delegated to a `RenderAdapter`. `CanvasAdapter` converts the store into the
  engine's `ChartData` (candles → `bars`, line/area/histogram → overlays or separate panes) and
  calls the engine. The engine's zoom, pan, price-axis drag, log/auto scale and crosshair behave
  exactly as on `/charts`.
* **Live updates** mutate the shared arrays in place and ask the engine to redraw on the next
  animation frame (`engine.refresh`). No history is recomputed on a tick.
* The SDK has **no React/Next.js imports**. Importing it during server rendering is safe;
  `createChart` throws a clear error if called without a DOM.

Engine changes made for the SDK (all opt-in, existing charts unaffected): `setOptions`
(theme override, crosshair on/off, fixed price precision, intraday label offset),
`getViewRange` / `setViewRange` / `scrollBy` / `scrollToEnd` / `refresh`, crosshair `price` and `time`,
gap bars (NaN prices) skipped when drawing and scaling, candle colours, area series, sign-coloured
histograms, `lastDrawMs`, and `resize()` no longer clears the canvas when the size did not change.
v0.2.1: `destroy()` is idempotent, stops scheduling frames and drops its data, drawings and callbacks.

## Importing

Inside this repository:

```ts
import { createChart, type CandlestickData } from "@/lib/xchart-sdk";
```

After packaging (future): `import { createChart } from "@tradestxpro/xchart";` with the same API.

## Canonical time

Every `time` is a **UTC Unix timestamp in whole seconds**.

* Intraday bars: the bar-open instant (e.g. 09:15 IST on 24 Nov 2026 = `Date.UTC(2026, 10, 24, 3, 45) / 1000`).
* Daily or longer bars: 00:00:00 UTC of the trading date (`Date.UTC(2026, 10, 24) / 1000`), the format
  TradestXPro's end-of-day data already uses.
* Milliseconds, fractions, negative values, duplicates and decreasing times are rejected.
* Intraday axis labels are shown at UTC+05:30 by default; change with `utcOffsetMinutes`.

Missing candles and session gaps need no special handling: just omit those times. Bars are spaced
by index (like most trading charts), so overnight gaps and weekends do not leave empty space.

## Creating a chart

```ts
"use client";
import { useEffect, useRef } from "react";
import { createChart, type CandlestickData } from "@/lib/xchart-sdk";

export function MyChart({ candles }: { candles: CandlestickData[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = createChart(box.current!, {
      theme: "dark",          // "dark" | "light"
      autoSize: true,          // follow the container size (default)
      crosshair: true,         // draw the crosshair (events fire either way)
      priceScale: { mode: "normal", autoScale: true, precision: 2 },
    });
    const series = chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444" });
    series.setData(candles);
    return () => chart.remove(); // releases canvas, ResizeObserver and listeners
  }, [candles]);
  return <div ref={box} style={{ height: 420 }} />;
}
```

`autoSize: false` with `width`/`height` gives a fixed size; `chart.resize(w, h)` changes it.
One container hosts one chart: calling `createChart` again on the same element throws
`CONTAINER_IN_USE` until the first chart is removed.

## Series

| Method | Renders | Key options |
|---|---|---|
| `addCandlestickSeries()` | OHLC candles with wicks in the main pane (one per chart) | `upColor`, `downColor`, `wickUpColor`, `wickDownColor` |
| `addLineSeries()` | line | `color`, `lineWidth`, `lineStyle` (`solid`/`dashed`/`dotted`), `pane`, `precision`, `lastValueVisible`, `title` |
| `addAreaSeries()` | line + gradient fill | line options + `topColor`, `bottomColor`, `baseline` (fill to this value; default: pane bottom) |
| `addHistogramSeries()` | bars from a zero baseline (own pane by default) | `colorMode` (`sign` / `candle` / `single`), `upColor`, `downColor`, `color`, `opacity`, `pane` |

`pane: "main"` draws on the price pane; `"separate"` gives the series its own pane under it.
Histogram `colorMode: "candle"` colours each bar by the candle's direction (volume) and needs a
candlestick series on the chart.

Every series has:

```ts
series.setData(points);        // replace all data (sorted, strictly increasing time)
series.update(point);          // live update (see below)
series.data();                 // copy of the data
series.applyOptions({ color: "#f59e0b" });
series.options();
series.remove();               // removes it from the chart; further calls throw
```

## Historical data and live updates

```ts
const candles = chart.addCandlestickSeries();
const volume = chart.addHistogramSeries({ colorMode: "candle", opacity: 0.6 });
const sma = chart.addLineSeries({ color: "#f59e0b", title: "SMA 20" });

candles.setData(history);                                       // CandlestickData[]
volume.setData(history.map((c) => ({ time: c.time, value: c.volume ?? 0 })));
sma.setData(smaPoints);                                         // may start later: aligned by time

// Tick for the current bar: same time as the last point → replaced in place
candles.update({ time: lastTime, open, high, low, close, volume });
// New bar: later time → appended (the view follows if the newest bar was in view)
candles.update({ time: lastTime + 300, open: close, high: close, low: close, close });
// Earlier time → XChartError OUT_OF_ORDER (data unchanged)
```

Series may have different timestamps; they are aligned by time. A series that lags behind may
later fill a time another series already has, or insert a new time between existing ones.

To use TradestXPro market data (the user's connected broker, or NSE end-of-day files), see
[Market data validation](#market-data-validation) below.

## Market data validation

`lib/xchart-sdk/market-data.ts` turns `{ t, o, h, l, c, v }` bars (the format of TradestXPro's
existing `/api/charts/bars` endpoint) into SDK candles **without changing any value**.

| Check | Rejection reason |
|---|---|
| Record is not an object | `MALFORMED_RECORD` |
| Time not finite, or negative | `INVALID_TIMESTAMP` |
| Time looks like milliseconds (> 1e11) | `MILLISECOND_TIMESTAMP` |
| Time has a fractional part (it is **not** truncated) | `FRACTIONAL_TIMESTAMP` |
| Open/high/low/close not finite | `INVALID_PRICE` |
| High below open/close/low, or low above open/close/high (it is **not** repaired) | `INVALID_OHLC` |
| Volume negative or not finite (0 is valid and kept; absent stays absent) | `INVALID_VOLUME` |
| Same time as the previous accepted record | `DUPLICATE_TIMESTAMP` |
| Earlier than the previous accepted record | `OUT_OF_ORDER` |

Missing candles are never fabricated.

```ts
import {
  validateTradestxproBars, fromTradestxproBars, loadTradestxproCandles, MarketDataError,
} from "@/lib/xchart-sdk";

// Strict (default): throws MarketDataError (code INVALID_MARKET_DATA) if any record is invalid.
try {
  const candles = fromTradestxproBars(bars, { source: "NSE:RELIANCE 1D" });
  series.setData(candles);
} catch (e) {
  if (e instanceof MarketDataError) console.table(e.report.rejections);
}

// Tolerant (opt-in): valid records are returned, invalid ones quarantined in the report.
const { candles, report } = validateTradestxproBars(bars, { mode: "tolerant", source: "vendor feed" });
series.setData(candles);
if (report.rejectedRecords) showDataWarning(report);

// Load straight from TradestXPro (signed-in session required).
const { candles: history, report: r } = await loadTradestxproCandles("NSE:RELIANCE", "1D", { mode: "strict" });
```

The report (`ValidationReport`):

```ts
{
  source: string;            // what you passed, or "<symbol> <tf> · <data source>" for loadTradestxproCandles
  mode: "strict" | "tolerant";
  validatedAt: string;       // ISO-8601
  totalRecords, validRecords, rejectedRecords,
  duplicateTimestamps, outOfOrderRecords, invalidOhlcRecords,
  invalidVolumeRecords, invalidTimestampRecords, malformedRecords,
  rejections: { index, time, reason, message, record }[]   // record = the original, unmodified
}
```

Ordering is checked against the last **accepted** record, so one bad row cannot hide another.

## Time scale and price scale

```ts
chart.setVisibleRange({ from, to });   // moves the actual viewport (times in seconds)
chart.getVisibleRange();               // { from, to } spanned by the viewport, or null without data
chart.fitContent();                    // show all data, re-enable price auto-scale
chart.scrollToRealTime();              // newest bar at the right edge, zoom kept
chart.scrollBy(-20);                   // scroll 20 bars back
chart.zoom(1.5);                       // zoom in around the right edge (< 1 zooms out)
chart.applyOptions({ priceScale: { mode: "logarithmic", precision: 1 } });
chart.applyOptions({ theme: "light" });
chart.applyOptions({ followLatest: true }); // keep the newest bar in view on live appends
```

**Viewport during updates.** A live update never moves the viewport unless `followLatest` is
`true` (and the newest bar was visible). Full re-renders (`setData`, series removal, inserting a
time between existing bars, option changes) keep the same visible **time** window. If the data
frequency changes (daily ↔ intraday) or the old window no longer contains data, the chart fits
the new data.

Users can still zoom with the wheel, pan by dragging (vertically too), drag the price axis to
stretch it and double-click to reset, as on `/charts`.

## Crosshair events

```ts
const unsubscribe = chart.subscribeCrosshairMove((e) => {
  if (e.time === null) return showPlaceholder();      // pointer left the chart
  const bar = e.seriesData.get(candles);              // CandlestickData | undefined
  const vol = e.seriesData.get(volume);               // { time, value } | undefined
  render(e.time, e.price, bar, vol);                  // price: main-pane price under the pointer
});
unsubscribe(); // idempotent; chart.remove() also clears all subscribers
```

Crosshair behaviour:

* Emitted when the hovered bar, the price under the pointer **or the data** changes (so a
  stationary pointer sees live-candle updates, data replacement and series removal), not on every frame.
* A handler subscribed while the pointer is over the chart receives the current state right away.
* Never emitted before the pointer first enters; emitted once with `time: null` when it leaves.
* A handler unsubscribed during a delivery (for example by another handler) is not called.
* A throwing handler is logged with `console.error` and does not stop the others.
* `chart.remove()` drops every subscription.

## Errors

Every SDK failure is an `XChartError` (a `RangeError` subclass, as in v0.2) with a stable `code`,
raised before any state changes: a rejected call leaves the chart and its series unchanged.

| Code | When |
|---|---|
| `INVALID_NUMBER`, `INVALID_TIME`, `INVALID_POINT`, `INVALID_DATA` | non-finite values, non-integer / millisecond / negative times, non-object points, non-array data |
| `INVALID_OHLC`, `INVALID_VOLUME` | high/low inconsistent with open/close, negative volume |
| `DUPLICATE_TIME`, `UNSORTED_TIME` | `setData` with repeated or decreasing times (message names the item) |
| `OUT_OF_ORDER` | `update` older than the series' last point |
| `INVALID_RANGE`, `NO_DATA` | `from >= to`, or a visible range on an empty chart |
| `INVALID_OPTION`, `INVALID_COLOR`, `INVALID_DIMENSION` | bad option values, unknown option keys, invalid CSS colours, NaN/∞/out-of-range sizes |
| `INVALID_SERIES_TYPE`, `UNSUPPORTED_SERIES`, `INCOMPATIBLE_SERIES` | unknown type; a second candlestick series; candle-coloured histogram without candles |
| `INVALID_HANDLER` | non-function crosshair handler |
| `CHART_REMOVED`, `SERIES_REMOVED` | using a removed chart or series |
| `NO_DOM`, `INVALID_CONTAINER`, `CONTAINER_IN_USE`, `INIT_FAILED` | SSR call, bad container, second chart in one container, renderer failed to start |
| `INVALID_MARKET_DATA` (`MarketDataError`, has `.report`), `DATA_UNAVAILABLE` | strict market-data validation failed; `/api/charts/bars` request failed |


## Lifecycle and cleanup

* `chart.remove()` destroys the engine (cancels the pending animation frame, disconnects the
  ResizeObserver, removes its window listeners), removes the chart's wrapper element and canvas,
  clears subscribers, detaches every series, releases the data arrays and frees the container
  for a new chart. It is idempotent.
* After `chart.remove()`, chart methods throw `CHART_REMOVED`; series methods (`setData`, `update`,
  `data`, `applyOptions`) throw `SERIES_REMOVED`; `series.remove()` is a no-op; `series.options()`
  still returns the last options.
* `series.remove()` is idempotent; its unique timestamps leave the shared axis.
* Removing the candlestick series while a `colorMode: "candle"` histogram remains is allowed: the
  histogram is coloured by sign until a candlestick series is added again (its option is kept).
* If the renderer cannot start (e.g. no 2D canvas), `createChart` throws `INIT_FAILED` and leaves
  no wrapper, canvas, listener or container lock behind. Invalid options are rejected before the DOM is touched.
* Always call `chart.remove()` from your effect cleanup.


## Testing and CI

* `tests/xchart-sdk.test.ts` (Node, 38 tests): validation, market-data integrity (strict/tolerant,
  reports, preserved values, zero volume), option validation and atomicity, lifecycle, crosshair
  reliability, alignment (gaps, holidays, unique timestamps, frequency changes), viewport, and a
  50,000-candle data-path check.
* `tests/xchart-sdk-browser.test.ts` (Chromium via Playwright): the unbundled SDK and engine run in
  a real browser and canvas **pixels** are checked: candles, line, area fill, histogram, missing
  candle slot, multi-series x alignment, viewport changes, theme switching, live updates, real
  pointer crosshair (including a stationary pointer during an update), DOM/listener/observer
  cleanup, multiple charts, and a forced renderer failure.
  * Locally these skip if Playwright/Chromium is unavailable.
  * With `XCHART_REQUIRE_BROWSER=1` (CI) they **fail** instead of skipping.
  * `XCHART_BENCH=1` also runs the benchmarks (reported, never asserted).
* CI: `.github/workflows/xchart-ci.yml` on pull requests to `main` and pushes to
  `feature/xchart-sdk-foundation`. Node 22.13.1, `npm ci` from the lockfile, `playwright@1.63.0`
  pinned in `devDependencies`. Two jobs to mark as required checks:
  * **`quality`**: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
  * **`browser`**: installs Chromium with system dependencies and runs the browser tests in
    mandatory mode; any failure or unexpected skip fails the job.
  No secrets are used; the build needs no database or broker credentials.
* v0.3 suites: `tests/xchart-indicators.test.ts`, `tests/xchart-drawings.test.ts`,
  `tests/xchart-scales-panes.test.ts`, `tests/xchart-advanced.test.ts`, plus Chromium tests for
  indicators, clouds, drawings (real pointer), markers, price lines, overlay scales, panes,
  synchronised charts, session shading, chart types, plugin layers and layout restore.
* v0.3.1 suites: `tests/xchart-derived.test.ts`, `tests/xchart-incremental.test.ts`,
  `tests/xchart-catalog.test.ts`; the browser suite runs in Chromium, Firefox and WebKit (CI matrix
  `browser (chromium|firefox|webkit)`, all mandatory).
* Benchmarks: `scripts/xchart-bench.ts` compares two checkouts (see
  [performance.md](xchart/performance.md)).
* Demo: `/xchart-demo` (synthetic data) — basics, v0.3 and 15 v0.3.1 sections.


## Known limitations (v0.3.1)

See [docs/xchart/README.md](xchart/README.md#known-limitations-v031) for the full, current list. In short:

* One candlestick series per chart; bars are spaced by index (gaps collapse).
* Price-based chart types are built from candles (intrabar path assumed and flagged); tick-based
  construction is not wired into charts.
* The worker is not used by the live chart and computes only the 22 original built-ins.
* Adding indicators is ~1.2–1.7× slower than v0.3.0 at large histories (one-off cost).
* No exchange holiday datasets are bundled; uncovered weekdays are `unknown`.
* Plugins are trusted code and are not sandboxed.
* Volume profile is not implemented; Hurst is validated only directionally.

## Migrating from v0.2 (to v0.2.1)

* `fromTradestxproBars()` **may now throw** `MarketDataError` where v0.2 silently clamped
  high/low, dropped duplicates/out-of-order/malformed rows, truncated fractional times and turned
  zero volume into "no volume". Fix the source, or opt into `{ mode: "tolerant" }` and inspect the report.
* `loadTradestxproCandles(symbol, tf, baseUrl)` still accepts a base-URL string; the third argument
  can now also be `{ mode, source, baseUrl }`. The result gains a `report`. Errors are `XChartError`.
* Live appends no longer scroll the chart automatically. Add `followLatest: true` to keep v0.2 behaviour.
* Series options are now validated strictly: unknown keys (e.g. `upColor` on a line series) and
  invalid CSS colours throw `INVALID_OPTION` / `INVALID_COLOR`.
* `autoSize: false` now requires `width` and `height`; sizes must be finite, 1–16384 px.
* A second candlestick series throws `UNSUPPORTED_SERIES` (was a plain `RangeError`).
* Errors remain `RangeError` subclasses, so existing `instanceof RangeError` checks still work.


## Future API compatibility

* Method names and data shapes follow the common conventions of open charting APIs
  (`createChart`, `addLineSeries`, `setData`, `update`, `subscribeCrosshairMove`,
  `setVisibleRange`), so later additions (price lines, markers, multiple price scales) can be
  added without breaking existing calls.
* `SeriesOptions` (v0.1 name) is kept as a deprecated alias.
* New options will be optional with today's behaviour as the default; removals will go through a
  deprecation release first.
