# Migrating from v0.3.0 to v0.3.1

v0.3.1 is additive: no public method was removed or renamed, and v0.3.0 layouts load unchanged
(`LAYOUT_VERSION` is unchanged). The changes below replace errors with working features or adjust
behaviour that was previously wrong. Check the ones your code relies on.

## Behaviour changes

| Area | v0.3.0 | v0.3.1 | Action |
|---|---|---|---|
| Price-based chart types (`renko`, `kagi`, `point-and-figure`, `line-break`, `range-bars`) | `setChartType` threw `UNSUPPORTED_CHART_TYPE`; layouts with them were rejected | Rendered on a logical axis (see [derived-data-model.md](derived-data-model.md)); layouts keep the type and settings | Remove code that caught `UNSUPPORTED_CHART_TYPE` for these types. `PRICE_CHART_TYPES` still lists them. |
| Overlay / left / pane scales | Only the main scale supported log / percentage / indexed / invert; others threw `UNSUPPORTED_SCALE` | Every scale has independent `mode`, `invert`, `range`, `margins`, `format` | Remove workarounds; `priceScale(id, paneId)` addresses pane scales. |
| Sessions with `end` ≤ `start` | Rejected (`INVALID_CALENDAR`) | An **overnight** session belonging to the date it starts on | A calendar that relied on the rejection to catch typos should validate its own input. |
| Pane sizes in layouts / `paneSizes` | Stored as the pane's height | Stored as the pane's **slot** height (pane + 1 px separator); `pane.height()` and `setHeight()` still mean the pane itself, and the main pane absorbs the difference | v0.3.0 layouts load with panes 1 px smaller; no action needed unless you compare stored numbers. |
| Drawings | Main pane, time domain only | `paneId`, `scaleId` and `domain: "time" \| "logical"` (default `"time"`, `"main"`, `"right"`) | None: missing fields take the defaults. |
| Indicators | Recursive indicators were recalculated in full on each tick | All built-ins are evaluated incrementally and exactly (identical values) | None. `indicatorEngineStats()` reports the engine. |
| Built-in catalog | 22 indicators | 122 (`ALL_BUILTIN_INDICATORS`); `BUILTIN_INDICATORS` still lists the original 22 | Ids of the original 22 are unchanged. |
| `timeToCoordinate` / `coordinateToTime` | Candle index | On price-based charts: first element formed at or after the time / the element's source time (`null` outside) | None for time-based charts. |
| Crosshair-only redraws | Every pointer move redrew the full frame | Pointer moves restore a cached frame and draw only the crosshair | Plugins that drew in their own `draw` on every pointer move should draw from chart state, not pointer events (they still run on every full frame). |

## New APIs (selection)

* Chart types: `getDerivedInfo()`, `getVisibleLogicalRange()` / `setVisibleLogicalRange()`,
  `takeScreenshot(scale)`, `crosshairMove.derived`.
* Indicators: `setBenchmarkSeries`, `searchIndicators`, `indicatorCompatibility`,
  `indicatorEngineStats`; definition `stream`, `meta`, `requires`.
* Scales: `priceScale(id, paneId)` with `mode`, `invert`, `range`, `format`; `scaleWarning` event.
* Panes and drawings: per-pane drawings, `drawingSelect` / `drawingTool` events.
* Calendars: `importCalendarDataset`, `CalendarRegistry`, `TradingCalendar#dayStatus`.
* Workers: `IndicatorWorkerClient`, `StaleResultError`, `CancelledError`.
* Aliases for familiar APIs: `off`, `subscribeClick`, `exportLayout` / `importLayout`,
  `timeScale()`, `series.removePriceLine`.
* Diagnostics: `renderStats()` (full vs crosshair-only frames).

## New error codes

* `DERIVED_LIMIT`: a price-based chart would produce more than 10,000 elements from one candle or
  1,000,000 in total (settings far too small for the data). The chart keeps its previous type.
* `MISSING_INPUT`: a benchmark-based indicator was added without `setBenchmarkSeries`.
* `INDICATOR_IN_USE`: the benchmark was cleared while an indicator still uses it.
* `INVALID_CALENDAR` now also covers dataset validation.

## Production terminal

The `/charts` terminal uses `ChartEngine` directly, not the SDK. The engine changes are opt-in or
invisible there (logical axis only with a derived model; separators stay opt-in via
`onPaneResize`; crosshair-only frames redraw identical pixels). See the regression notes in
[performance.md](performance.md) and the PR description.
