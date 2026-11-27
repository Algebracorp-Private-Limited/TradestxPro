# Layouts

```ts
const layout = chart.saveLayout();                       // plain JSON, no market data
const withData = chart.saveLayout({ includeData: true }); // opt-in: includes series data
localStorage.setItem("layout", JSON.stringify(layout));

const report = chart.loadLayout(localStorage.getItem("layout"), { skipUnknownIndicators: false, applyData: true });
// { seriesMatched, seriesCreated, seriesSkipped, indicatorsAdded, indicatorsSkipped, drawings, pluginsNotInstalled }
```

## Contents

`{ format: "xchart-layout", version: 1, sdkVersion, chart, chartType, series, indicators,
drawings, priceScales, panes, session, plugins }`

* `chart`: only `theme, crosshair, followLatest, priceScale, utcOffsetMinutes, timeZone, locale`.
* `series`: type + options (+ data only with `includeData`).
* `indicators`: type, parameters, display options. `drawings`: serialised drawings.
* `panes`: sizes, collapsed, order — saved as portable references (`series:<n>`,
  `indicator:<n>`, named ids) and mapped back to the new ids on load.
* `session`: built-in calendar id. `plugins`: ids only.

## Safety

* **Allow-listed output:** a layout is assembled field by field from SDK state, so tokens,
  credentials, account data, URLs or functions cannot leak into it.
* **No market data by default.**
* **Nothing executes on load:** plugin ids are reported in `pluginsNotInstalled`, never loaded;
  indicator types must already be registered (or are skipped with `skipUnknownIndicators`).
* **Strict validation before any change:** size (5 MB), nesting depth (16), `__proto__` /
  `constructor` / `prototype` keys, unknown fields, chart and series options, data, chart type,
  indicator parameters (dry run), drawings, scales, panes and calendar ids. On any error an
  `XChartError` (`INVALID_LAYOUT`, `UNSUPPORTED_LAYOUT`, `UNKNOWN_INDICATOR`, …) is thrown and the
  chart is unchanged.

## Series matching

Layout series are matched to the chart's existing series **by type and order** and their options
applied; the chart's own data is kept. A layout series without a match is created only when the
layout carries its data; otherwise it is skipped (counted in `seriesSkipped`).
