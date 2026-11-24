# XChart SDK (v0.2)

A TypeScript API for building financial charts on top of TradestXPro's own canvas chart engine.
Intended to be published later as `@tradestxpro/xchart`; today it lives in `lib/xchart-sdk/`.

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
import { createChart } from "@/lib/xchart-sdk";

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

To use TradestXPro market data (the user's connected broker, or NSE end-of-day files), use the
existing `/api/charts/bars` endpoint through the helper (signed-in session required):

```ts
import { loadTradestxproCandles, fromTradestxproBars } from "@/lib/xchart-sdk";

const { candles: history } = await loadTradestxproCandles("NSE:RELIANCE", "1D");
candles.setData(history);
// or convert bars you already have: fromTradestxproBars(bars)  // { t, o, h, l, c, v } → CandlestickData
```

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
```

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

Events are emitted only when the hovered bar or price changes (not on every frame), never before
the pointer first enters, and once with `time: null` when it leaves. A throwing handler is
logged and does not stop other handlers.

## Errors

Invalid input throws `XChartError` (extends `RangeError`) with a `code`:

| Code | When |
|---|---|
| `INVALID_NUMBER`, `INVALID_TIME`, `INVALID_POINT` | non-finite values, non-integer / millisecond / negative times |
| `INVALID_OHLC`, `INVALID_VOLUME` | high/low inconsistent with open/close, negative volume |
| `DUPLICATE_TIME`, `UNSORTED_TIME` | `setData` with repeated or decreasing times (message names the item) |
| `OUT_OF_ORDER` | `update` older than the series' last point |
| `INVALID_RANGE`, `NO_DATA` | `from >= to`, or a visible range on an empty chart |
| `INVALID_OPTION`, `INCOMPATIBLE_SERIES` | bad colours/widths/opacity/precision; candle-coloured histogram without candles |
| `CHART_REMOVED`, `SERIES_REMOVED` | using a removed chart or series |
| `NO_DOM`, `INVALID_CONTAINER`, `CONTAINER_IN_USE` | SSR call, bad container, second chart in one container |

A rejected call leaves the chart unchanged.

## Cleanup

`chart.remove()` destroys the engine (cancels the pending frame, disconnects the ResizeObserver,
removes window listeners), removes the chart's wrapper element and canvas, clears subscribers and
frees the container for a new chart. It is idempotent. Always call it from your effect cleanup.

## Testing

* `tests/xchart-sdk.test.ts` (Node): validation, lifecycle, series creation/removal, history,
  live updates, duplicates/out-of-order, multi-series alignment, visible range, crosshair
  subscription cleanup, a 50,000-candle data-path benchmark.
* `tests/xchart-sdk-browser.test.ts` (Chromium via Playwright): the unbundled SDK + engine run in
  a real browser; checks canvas pixels for candles/line/area/histogram, first-frame rendering,
  viewport ranges, real pointer crosshair events, live updates and cleanup. Skipped (reported as
  skipped) if Playwright/Chromium is not installed. `XCHART_BENCH=1` also runs the benchmarks.
* Demo: `/xchart-demo` (synthetic data).

## Known limitations (v0.2)

* One candlestick series per chart (it is the engine's main series). Additional OHLC series are not supported yet.
* Bars are spaced by index, not by wall-clock time (gaps collapse). There is no option for time-proportional spacing.
* Line/area/histogram on the main pane share the price scale with the candles; there are no separate
  left/right price scales or scale margins yet. Separate panes have their own auto-scaled axis.
* Per-point colours (e.g. a colour on each histogram item) are not supported; colours come from series options.
* Minimum bar spacing is 0.5 px, so at most ~2 bars per pixel can be in view (50,000 bars cannot all be shown at once).
* Theme is `dark`/`light` presets; custom palettes, fonts and grid options are not exposed yet.
* Markers, price lines, drawings and the indicator catalogue exist in the engine but are not exposed through the SDK yet.
* Time labels support a fixed UTC offset only (no DST-aware time zones).

## Future API compatibility

* Method names and data shapes follow the common conventions of open charting APIs
  (`createChart`, `addLineSeries`, `setData`, `update`, `subscribeCrosshairMove`,
  `setVisibleRange`), so later additions (price lines, markers, multiple price scales) can be
  added without breaking existing calls.
* `SeriesOptions` (v0.1 name) is kept as a deprecated alias.
* New options will be optional with today's behaviour as the default; removals will go through a
  deprecation release first.
