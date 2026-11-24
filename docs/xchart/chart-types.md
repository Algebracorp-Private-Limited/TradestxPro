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

## Price-based types

`renko`, `kagi`, `point-and-figure`, `line-break` and `range-bars` produce bricks/columns whose
number is unrelated to time — several can complete within one bar. Drawing them on the shared,
strictly increasing time axis would require inventing timestamps, so `setChartType` throws
`UNSUPPORTED_CHART_TYPE`. Their calculations are exported and tested:

```ts
import { renko, kagi, pointAndFigure, lineBreak, rangeBars } from "@/lib/xchart-sdk";
renko(closes, 5);                 // [{ open, close, up, time }]  classic, 2-box reversal
kagi(closes, 10);                 // [{ from, to, up, thick, time }]
pointAndFigure(closes, 1, 3);     // [{ kind: "X" | "O", low, high, boxes, time }]
lineBreak(closes, 3);             // [{ open, close, up, time }]
rangeBars(closes, 2);             // close-based approximation (true range bars need ticks)
```

`closes` = `[{ time, close }]`. Rendering them needs a sequence (non-time) axis — not in v0.3.
