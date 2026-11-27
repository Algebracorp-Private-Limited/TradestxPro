# Indicators

```ts
const chart = createChart(el);
chart.addCandlestickSeries().setData(candles);

const ema = chart.addIndicator("ema", { period: 21, color: "#f59e0b" });
const bb  = chart.addIndicator("bb", { length: 20, source: "hlc3" });
const rsi = chart.addIndicator("rsi", { length: 14, pane: "separate" });

ema.setParameters({ length: 50 });   // validated; recalculates
bb.applyOptions({ lineStyle: "dashed", hiddenOutputs: ["basis"] });
rsi.setVisible(false);
ema.getValues();                     // [{ time, values: { ema: 101.2 }, projected: false }, …]
chart.removeIndicator(bb);           // or bb.remove()
```

`config` mixes **parameters** (`length`/`period`, `source`, `mult`, …) and **display options**
(`color`, `colors`, `lineWidth`, `lineStyle`, `pane`, `priceScaleId`, `visible`, `title`,
`hiddenOutputs`, `fills`). Unknown keys, out-of-range values and wrong types throw
`INVALID_PARAMETER` / `INVALID_OPTION` before the indicator is added.

## Built-ins (122)

The 22 original built-ins (`sma ema wma hma bb keltner donchian supertrend psar vwap ichimoku rsi
macd stoch adx atr cci mfi willr roc obv volume`, maths from `lib/ta/catalog.ts`) plus 100 native
catalog indicators (v0.3.1). Full list with formulas, parameters and requirements:
[indicator-catalog.md](indicator-catalog.md). `chart.listIndicators()` returns the definitions;
`chart.searchIndicators()` and `chart.indicatorCompatibility()` help discovery.

* `source` (open/high/low/close/volume/hl2/hlc3/ohlc4) is available where a definition declares
  it. `period` is accepted as an alias of `length`.
* **No look-ahead:** values computed on a prefix of the data equal the values of the full
  computation over that prefix (tested). Delayed or repainting indicators say so in `meta.repaint`.
* **Input:** the candlestick series (gaps skipped and mapped back to the shared time axis), or the
  first line/area series when the chart has no candles. Benchmark indicators use
  `chart.setBenchmarkSeries(series)`.

## Live updates (v0.3.1)

Every built-in is evaluated **incrementally and exactly**: a live tick or an appended bar costs
O(1)–O(window) per indicator, independent of the history length, with results identical to a full
recalculation (tested bitwise). Indicators share common intermediate nodes (e.g. one EMA(20) for
MACD and Keltner). Updates are coalesced to one flush per frame. Custom indicators without a
`stream` keep the v0.3 policy (tail window for `lookback`, otherwise full recalculation). See
[incremental-indicators.md](incremental-indicators.md).

## Projections (Ichimoku)

Outputs longer than the data (the Ichimoku cloud is 26 bars ahead) are drawn in empty slots
after the last candle. **No candle is created**: `crosshairMove` reports `projected: true` and no
series data there; `getValues()` flags those points with `projected: true`.

## Errors

A failing calculation never breaks the chart: the indicator shows nothing, `indicator.error()`
returns the message and an `indicatorError` event is emitted. Fix the parameters with
`setParameters()` to recover.

## Custom indicators

```ts
chart.registerIndicator({
  id: "range-pct",
  name: "Range %",
  description: "(high − low) / close × 100",
  inputs: ["high", "low", "close"],
  params: [{ key: "smooth", label: "Smoothing", type: "integer", default: 1, min: 1, max: 50 }],
  outputs: [{ key: "pct", name: "Range %", type: "line", color: "#38bdf8" }],
  pane: "separate",
  warmup: (p) => Number(p.smooth) - 1,
  lookback: (p) => Number(p.smooth),          // optional: enables cheap tail updates
  calculate(input, p) {
    const raw = input.close.map((c, i) => ((input.high[i] - input.low[i]) / c) * 100);
    // …smooth with p.smooth…
    return { pct: raw };
  },
});
chart.addIndicator("range-pct", { smooth: 3 });
```

* Definitions are validated (`INVALID_INDICATOR`); results must be arrays at least as long as the
  input (longer = projection).
* `calculate` must not look ahead: value *i* may only use inputs `0…i`.
* Definitions are plain functions you ship with your app — there is no string/script evaluation.

## Registries

* `chart.registerIndicator(def)` — this chart only (no global state). `unregisterIndicator(id)`
  throws `INDICATOR_IN_USE` while instances exist.
* `registerIndicator(def)` (module export) — the process-wide **default registry** every new chart
  inherits from. It is the one shared registry in the SDK; prefer per-chart registration in
  libraries and multi-tenant code.
* Built-ins cannot be unregistered (`BUILTIN_INDICATOR`); duplicate ids throw `DUPLICATE_INDICATOR`.

## Cloud series

```ts
const cloud = chart.addCloudSeries({ upColor: "rgba(34,197,94,.25)", downColor: "rgba(239,68,68,.25)", displacement: 0 });
cloud.setData([{ time, upper, lower }, …]);
```

The fill switches colour exactly where the boundaries cross. `displacement` shifts the drawing by
whole bars (positive = forward into projection space). `lineVisible: false` hides the boundaries.
