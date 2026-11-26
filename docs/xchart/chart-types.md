# Chart types

```ts
chart.setChartType("heikin-ashi");
chart.setChartType("baseline", { baseline: 1000, upColor: "#22c55e", downColor: "#ef4444" });
chart.getChartType(); // { type, style }
```

Time-based types change how the candlestick series is **drawn**. The stored OHLCV is never
modified: indicators, markers, crosshair `seriesData`, price lines (`source: "last"`) and layouts
keep using the real data.

| Type | Drawing |
|---|---|
| `candles` | filled candles (default) |
| `hollow-candles` | rising candles outlined, falling filled |
| `bars` | OHLC bars |
| `heikin-ashi` | Heikin Ashi candles (see below) |
| `line`, `step-line`, `line-markers` | close line; step; line with point markers |
| `area` | close line with gradient fill |
| `baseline` | close line, coloured above/below `baseline` (default: first visible close) |
| `high-low` | high–low range bars |
| `columns` | close columns from the pane bottom, coloured by close-to-close change |

Style: `lineColor, lineWidth, areaTopColor, areaBottomColor, baseline, upColor, downColor`.

**Heikin Ashi:** computed from the real candles (gaps stay gaps), updated in place on live ticks.
The last-price label shows the **real** last close; `crosshairMove` gives the real candle in
`seriesData` and the drawn candle in `display`.

## Price-based types (v0.3.1)

`renko`, `kagi`, `point-and-figure`, `line-break` and `range-bars` are **rendered** on a logical
axis (one slot per brick / line / column / bar), calculated incrementally from the stored candles:

```ts
chart.setChartType("renko", { method: "atr", size: 1, atrPeriod: 14, reversal: 2, wicks: true });
chart.setChartType("kagi", { reversal: 12, yangWidth: 3, yinWidth: 1 });
chart.setChartType("point-and-figure", { boxSize: 5, reversal: 3, source: "high-low" });
chart.setChartType("line-break", { lines: 3 });
chart.setChartType("range-bars", { method: "ticks", range: 40, tickSize: 0.05 });
chart.getDerivedInfo(); // { type, settings, points, provisional, methodology, error, hidden }
```

| Type | Drawing |
|---|---|
| `renko` | bricks (optional wicks), up/down colours |
| `kagi` | vertical lines with horizontal shoulders; thick (yang) / thin (yin) |
| `point-and-figure` | X and O symbols on the box grid |
| `line-break` | boxes from open to close of each line |
| `range-bars` | OHLC bars of equal range |

* Confirmed elements never change; elements formed by the live candle are `provisional`.
* No timestamps are invented: the time axis shows the source candle of each element, empty
  future slots are unlabelled, and `crosshairMove` reports the element (`derived`) and the real
  source candle (`seriesData`).
* Additional series, markers, session shading, time-domain drawings and indicators that need
  volume or session time are hidden (listed in `hidden`) and come back when you switch to a
  time-based type. Price-only indicators are calculated on the element closes.
* Settings are validated before anything changes; runaway settings raise `DERIVED_LIMIT`.

Details, rules and limitations: [derived-data-model.md](derived-data-model.md). The v0.3 helpers
(`renko`, `kagi`, `pointAndFigure`, `lineBreak`, `rangeBars` on closes) remain exported for
compatibility.
