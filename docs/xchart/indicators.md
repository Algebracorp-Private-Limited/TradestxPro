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

## Built-ins (22)

`sma ema wma hma bb keltner donchian supertrend psar vwap ichimoku rsi macd stoch adx atr cci mfi
willr roc obv volume` — `chart.listIndicators()` returns their definitions (params with
defaults/limits, outputs, pane, levels).

* The maths comes from TradestXPro's indicator catalogue (`lib/ta/catalog.ts`); the SDK wraps it,
  it does not reimplement it. Accuracy is tested against independent textbook implementations
  (SMA, EMA seeded with an SMA, Wilder RSI, MACD).
* `source` (open/high/low/close/volume/hl2/hlc3/ohlc4) is available on sma, ema, wma, hma, bb,
  rsi, macd and roc. `period` is accepted as an alias of `length`.
* **No look-ahead:** for every built-in, values computed on a prefix of the data equal the values
  of the full computation over that prefix (tested). Ichimoku's lagging span is, by definition,
  plotted 26 bars back.
* **Input:** the candlestick series (gaps skipped and mapped back to the shared time axis), or the
  first line/area series when the chart has no candles.

## Live updates

| Change | Finite-memory indicators (sma, wma, hma, bb, donchian, stoch, cci, willr, roc, mfi, volume) | Recursive indicators (ema, rsi, macd, atr, adx, supertrend, psar, obv, vwap, ichimoku, keltner) |
|---|---|---|
| Last bar replaced / one bar appended | Window of `2·(lookback+2)` bars recalculated | Full recalculation |
| Anything else | Full recalculation | Full recalculation |

Recalculation is deferred to the next frame and coalesced (many ticks → one recalculation).
Results are identical either way (tested).

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
