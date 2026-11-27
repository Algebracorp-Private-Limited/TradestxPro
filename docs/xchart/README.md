# XChart SDK v0.3.1 guides

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
| [indicators.md](indicators.md) | Indicators, parameters, custom definitions, registries, cloud series, projections |
| [drawings.md](drawings.md) | 27 drawing tools, interaction, undo/redo, serialisation, markers, price lines |
| [scales-and-panes.md](scales-and-panes.md) | Scale modes, overlay/left scales, margins, panes |
| [sync-and-calendars.md](sync-and-calendars.md) | Chart synchronisation, trading calendars, sessions, time zones |
| [chart-types.md](chart-types.md) | Time-based chart types and price-based calculations |
| [layouts.md](layouts.md) | Saving and loading chart layouts safely |
| [plugins.md](plugins.md) | Plugin API and security model |
| [events.md](events.md) | Typed events |
| [performance.md](performance.md) | Benchmarks, method, limits |
| [migration-v0.3.md](migration-v0.3.md) | Upgrading from v0.2.1 |
| [derived-data-model.md](derived-data-model.md) | Price-based chart types: logical axis, confirmed / provisional elements, rules (v0.3.1) |
| [incremental-indicators.md](incremental-indicators.md) | Streaming indicator engine, shared nodes, checkpoints, exactness (v0.3.1) |
| [indicator-catalog.md](indicator-catalog.md) | All 122 built-in indicators with formulas and requirements (v0.3.1) |
| [worker-architecture.md](worker-architecture.md) | Indicator Web Worker: protocol, coalescing, staleness, cancellation (v0.3.1) |
| [calendar-providers.md](calendar-providers.md) | Versioned exchange-calendar datasets, `dayStatus`, overnight sessions (v0.3.1) |
| [browser-compatibility.md](browser-compatibility.md) | Chromium / Firefox / WebKit results (v0.3.1) |
| [api-coverage.md](api-coverage.md) | API matrix (v0.3.1) |
| [migration-v0.3.1.md](migration-v0.3.1.md) | Upgrading from v0.3.0 |
| [security.md](security.md) | Security review: trust boundaries, limits, residual risks (v0.3.1) |

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

## Known limitations (v0.3.1)

* One candlestick series per chart; bars are spaced by index (weekends/holidays collapse).
* Price-based chart types are built from candles: the intrabar path is assumed (flagged
  `reconstructed`); tick-based construction is not wired into charts.
* The indicator worker is not used by the live chart and computes only the 22 original
  built-ins and price-based types.
* Adding indicators is ~1.2–1.7× slower than v0.3.0 at large histories (one-off); live updates are
  ~70× faster at 100k candles × 20 indicators ([performance.md](performance.md)).
* Percentage/indexed scales are relative to the first visible value (the base moves while panning).
* No bundled exchange holiday lists: load datasets through calendar providers; uncovered weekdays
  are `unknown`. MCX agricultural contracts need a custom calendar.
* Plugins are trusted code: not sandboxed (errors in layers are isolated and reported).
* Hurst exponent is validated only by a directional check.
* Volume profile is not implemented.
* Browser tests run on Chromium, Firefox and WebKit (Playwright); not on real mobile devices.
