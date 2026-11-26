# API coverage (v0.3.1)

This audit compares the public API with the Phase 3 / Phase 3.1 requirements as recorded for the
project. Status values:

- **Implemented**: available under the requested name.
- **Equivalent**: same capability under a different name.
- **Partial**: available with stated limits.
- **Unsupported**: not available.
- **Deferred**: planned, not in this release.

Compatibility aliases were added where a different name was common (listed as *alias*).

| Area | Requirement | Status | API |
|---|---|---|---|
| Indicator | add / remove / list instances | Implemented | `chart.addIndicator(type, config)`, `chart.removeIndicator(i)`, `indicator.remove()`, `chart.getIndicators()` |
| Indicator | parameters, options, visibility, values | Implemented | `setParameters`, `applyOptions`, `setVisible`, `getValues`, `recalculate`, `error()` |
| Indicator | custom definitions, registries | Implemented | `chart.registerIndicator`, `registerIndicator` (default registry), `unregisterIndicator`, `listIndicators`, `getIndicatorDefinition` |
| Indicator | discovery and compatibility | Implemented | `chart.searchIndicators(q)`, `chart.indicatorCompatibility(id)`, `builtinRegistry.search/categories/compatibility` |
| Indicator | incremental computation | Implemented | all 122 built-ins (`definition.stream`); custom definitions may provide `stream` or use the full `calculate` path |
| Indicator | benchmark-based statistics | Implemented | `chart.setBenchmarkSeries(series)` |
| Indicator | Web Worker computation | Partial | `IndicatorWorkerClient` (historical / large calculations, derived transforms); the live chart pipeline runs incrementally on the main thread and does not use the worker |
| Indicator | Volume Profile | Unsupported | needs price-level volume; an OHLCV-based approximation was not added in this release |
| Cloud | cloud series with fill switch and displacement | Implemented | `chart.addCloudSeries(options)` |
| Drawing | add / get / list / remove / clear | Implemented | `addDrawing`, `getDrawing`, `getDrawings`, `removeDrawing`, `clearDrawings` |
| Drawing | interactive tools, undo/redo, serialisation | Implemented | `setDrawingTool`, `undoDrawing`, `redoDrawing`, `serializeDrawings`, `loadDrawings`, `duplicateDrawing`, `selectDrawing`, `setDrawingSnap` |
| Drawing | events | Implemented | `subscribeDrawingEvents`, `on("drawingCreate" …)` |
| Drawing | multi-pane drawings | Implemented | `DrawingSpec.paneId` / `scaleId`; pointer creation on any pane |
| Drawing | derived (logical-axis) drawings | Implemented | `DrawingSpec.domain: "logical"` |
| Drawing | custom tools | Implemented | plugin `registerDrawingTool` |
| Marker | set / add / remove / get / clear | Implemented | `series.setMarkers`, `addMarker`, `removeMarker`, `getMarkers`, `clearMarkers` |
| Price line | create / update / remove | Implemented | `series.createPriceLine`, `line.applyOptions`, `line.remove`, `series.priceLines()`, *alias* `series.removePriceLine(line)` |
| Price line | last price / previous close | Implemented | `source: "last" | "previousClose"` |
| Price scale | right, left, overlay, pane scales | Implemented | `chart.priceScale(id, paneId)` |
| Price scale | linear, log, percentage, indexed per scale | Implemented | `applyOptions({ mode })` |
| Price scale | inversion, manual range, margins, precision, min move, formatter, visibility | Implemented | `invert`, `autoScale:false + range`, `margins`, `precision`, `minMove`, `formatter`, `visible` |
| Price scale | coordinate conversion | Implemented | `chart.priceToCoordinate(price, paneId, scaleId)`, `coordinateToPrice`, `priceScale(id).priceToCoordinate` |
| Price scale | time-proportional spacing | Unsupported | bars are spaced by index (gaps collapse) |
| Time scale | visible range (time and logical), fit, scroll, zoom | Implemented | `setVisibleRange`, `getVisibleRange`, `setVisibleLogicalRange`, `getVisibleLogicalRange`, `fitContent`, `scrollToRealTime`, `scrollBy`, `zoom` |
| Time scale | grouped facade | Equivalent | *alias* `chart.timeScale()` |
| Time scale | coordinate conversion | Implemented | `timeToCoordinate`, `coordinateToTime` |
| Pane | list, height, collapse, order, separator drag | Implemented | `chart.panes()`, `chart.pane(id)`, `setHeight`, `collapse`, `expand`, `moveTo` |
| Synchronisation | range and crosshair by time | Implemented | `syncCharts(charts, options)`, `setCrosshairPosition`, `clearCrosshairPosition` |
| Calendar | sessions, time zones, DST | Implemented | `TradingCalendar`, `CALENDARS` (NSE, BSE, MCX, NYSE, NASDAQ, FOREX, CRYPTO) |
| Calendar | providers, datasets, three-state status | Implemented | `CalendarRegistry`, `importCalendarDataset`, `calendar.dayStatus(date)` |
| Calendar | bundled verified holiday datasets | Deferred | none are bundled (see calendar-providers.md) |
| Advanced series | 11 time-based chart types | Implemented | `chart.setChartType(type, style)` |
| Advanced series | Renko, Kagi, P&F, Line Break, Range bars | Implemented | `chart.setChartType("renko", settings)`, `getDerivedInfo()` |
| Advanced series | tick-based range bars | Partial | `computeDerived` works on candles; range bars from tick streams are not wired into the chart |
| Layout | save / load | Implemented | `saveLayout`, `loadLayout`, *alias* `exportLayout`, `importLayout` |
| Plugin | install / remove / list | Implemented | `chart.use`, `removePlugin`, `plugins()` |
| Event | subscribe / once / unsubscribe | Implemented | `chart.on`, `chart.once`, returned unsubscribe, *alias* `chart.off`, `subscribeClick`, `subscribeCrosshairMove` |
| Export | PNG | Implemented | `chart.takeScreenshot(scale)` |
| Diagnostics | render and engine statistics | Implemented | `renderStats()`, `renderTimeMs()`, `indicatorEngineStats()` |
