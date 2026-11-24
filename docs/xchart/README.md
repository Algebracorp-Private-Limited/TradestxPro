# XChart SDK v0.3 guides

XChart is TradestXPro's charting SDK (`lib/xchart-sdk/`), rendered by TradestXPro's own canvas
engine (`components/chart/engine.ts`). No third-party charting library is used.

```
Application → XChart SDK (createChart, series, indicators, drawings, layouts, plugins)
            → SeriesStore (one shared time axis, original OHLCV — never modified)
            → CanvasAdapter (translates the model; layers; interaction delegate)
            → ChartEngine (canvas rendering, pan/zoom, panes, crosshair)
```

| Guide | Contents |
|---|---|
| [indicators.md](indicators.md) | Built-in indicators, parameters, custom definitions, registries, cloud series, projections |
| [drawings.md](drawings.md) | 27 drawing tools, interaction, undo/redo, serialisation, markers, price lines |
| [scales-and-panes.md](scales-and-panes.md) | Scale modes, overlay/left scales, margins, panes |
| [sync-and-calendars.md](sync-and-calendars.md) | Chart synchronisation, trading calendars, sessions, time zones |
| [chart-types.md](chart-types.md) | Time-based chart types and price-based calculations |
| [layouts.md](layouts.md) | Saving and loading chart layouts safely |
| [plugins.md](plugins.md) | Plugin API and security model |
| [events.md](events.md) | Typed events |
| [performance.md](performance.md) | Benchmarks, method, limits |
| [migration-v0.3.md](migration-v0.3.md) | Upgrading from v0.2.1 |

Demo: `/xchart-demo` (synthetic data only).

## Principles

* **Market data is never modified.** Indicators, chart types (Heikin Ashi …), markers, price lines,
  drawings and session shading are views over the stored OHLCV.
* **No fabricated candles.** Projections (Ichimoku cloud, displaced clouds) occupy empty future
  slots; the crosshair reports `projected: true` there and series data is absent.
* **Atomic, typed errors.** Every invalid call throws an `XChartError` with a `code` before any
  state changes.
* **No global mutable state** beyond the opt-in default indicator registry (see
  [indicators.md](indicators.md#registries)); everything else belongs to a chart and is released
  by `chart.remove()`.
* **Honest limits.** Features that cannot be rendered correctly throw `UNSUPPORTED_*` errors
  instead of drawing something misleading.

## Known limitations

* One candlestick series per chart; bars are spaced by index (weekends/holidays collapse).
* Price-based chart types are calculated, not rendered (`UNSUPPORTED_CHART_TYPE`).
* Overlay price scales are linear and auto-fitted; log/percentage/indexed apply to the main scale.
  Separate panes have one (right) scale.
* The "left" scale draws its labels inside the plot's left edge (the plot is not narrowed).
* Recursive indicators are fully recalculated on each live tick (no incremental state yet). See
  [performance.md](performance.md) for the cost at large histories.
* Percentage/indexed modes are relative to the first visible bar, so the base changes while panning
  (by design, matching common charting behaviour).
* Range bars are computed from closes (true range bars need tick data).
* No bundled exchange holiday lists; provide a `HolidayProvider`. MCX agricultural contracts need a
  custom calendar (non-agri hours are built in).
* Plugins are trusted code: not sandboxed.
* Drawings live on the main pane only.
* Browser tests run on Chromium only.
