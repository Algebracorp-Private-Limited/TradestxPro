# Derived data model (price-based chart types)

Renko, Kagi, Point & Figure, Line Break and Range bars are **derived series**: the drawn elements
(bricks, lines, columns, bars) are calculated from the stored candles. Their number is unrelated
to time: several can complete inside one candle, and many candles can pass without one. They are
therefore drawn on a **logical axis** (element index), not on the time axis. No timestamps are
invented and the stored OHLCV is never modified.

```
candles (SeriesStore, unchanged) ──► DerivedSeriesEngine ──► DerivedPoint[] ──► engine (logical axis)
                                     committed state + provisional tail replay
```

## DerivedPoint

| Field | Meaning |
|---|---|
| `id` | Stable id (`kind:seq`), unchanged while the element exists |
| `logical` | Position on the logical axis (0, 1, 2, …) |
| `sourceTime`, `sourceIndex` | Candle whose data completed (or currently forms) the element |
| `seq` | Element sequence within its source candle (several per candle are possible) |
| `open/high/low/close`, `direction` | Element geometry; `direction` 1 = up, −1 = down |
| `status` | `"confirmed"` (cannot change any more) or `"provisional"` (formed by the live candle; may change or disappear) |
| `sourceClose` | Close of the source candle (for tooltips) |
| `reconstructed` | `true` when the intrabar path was assumed (see below) |
| kind-specific | Renko `size`; Kagi `thickStart/thickEnd/switchPrice`; P&F `lowBox/highBox/boxes/reversal`; Range bars `complete` |

`getDerivedInfo()` returns `{ type, settings, points, provisional, methodology, error, hidden }`.
`methodology` is a human-readable description of the exact rules and settings used; `hidden`
lists what a derived chart cannot show (see *What is hidden*).

## Confirmed vs provisional

The engine keeps a **committed state** for all closed candles and replays only the **last (live)
candle** on a copy of that state on every tick. Elements produced by the live candle are
`provisional`; when the candle closes (a newer candle arrives) they become `confirmed` and are
never recalculated again. A live tick therefore costs O(elements produced by one candle), not
O(history). `showProvisional: false` hides provisional elements.

Confirmed elements never repaint. Provisional elements can change on every tick, which is
inherent to these chart types (it is reported, not hidden).

## Intrabar path assumption

Candles do not say whether the high or the low came first. When a method uses high and low
(`source: "high-low"`, Range bars, wicks), the engine assumes the path
**open → nearer extreme → farther extreme → close** (`PATH_ASSUMPTION`). Elements whose creation
depends on that ordering are flagged `reconstructed: true`. With tick data the result could differ;
tick input is not wired into charts in v0.3.1 (see *Limitations*).

## Methods and settings

| Kind | Settings (defaults in `resolveDerivedSettings`) | Rule |
|---|---|---|
| `renko` | `method` fixed/percentage/atr, `size`, `atrPeriod`, `reversal` (bricks, default 2), `source`, `wicks` | Classic Renko: a new brick each time price moves `size` beyond the last brick; a reversal needs `reversal` × size. |
| `kagi` | `method`, `reversal`, `atrPeriod`, `source`, `yangWidth`, `yinWidth` | Line continues while price extends; reverses after a move of `reversal`; becomes thick (yang) above the previous shoulder, thin (yin) below the previous waist. |
| `point-and-figure` | `method`, `boxSize`, `atrPeriod`, `reversal` (default 3), `source` close/high-low | X/O columns on a box grid; reversal after `reversal` boxes. With high-low the Dorsey rule applies (extend first, reverse only if no extension). |
| `line-break` | `lines` (default 3), `source` | A new line when the close exceeds the high/low of the last `lines` lines. |
| `range-bars` | `method` fixed/percentage/atr/ticks, `range`, `tickSize`, `atrPeriod`, `wicks` | Each bar spans exactly `range`; a gap creates the bars that the move implies (gap rule). `ticks` sets the range in ticks of `tickSize`. |

**Size methods.** `fixed`: price units. `percentage`: percent of the reference price when the
element starts. `atr`: multiple of the Wilder ATR of the candles **before** the current one (known
when the candle opens): sizes follow volatility without look-ahead, and confirmed elements never
change. No element is drawn while the ATR warms up.

Invalid settings throw `XChartError("INVALID_OPTION")` before anything changes.

## Resource limits

* At most `MAX_PER_CANDLE` (10,000) elements from one candle and `MAX_DERIVED_POINTS` (1,000,000) in
  total. Exceeding either (e.g. a box size far too small for the price) throws
  `XChartError("DERIVED_LIMIT")`. `setChartType` builds eagerly, so the error is atomic: the chart
  keeps its previous type. A later live update that exceeds the limit is reported in
  `getDerivedInfo().error` and the last valid element set stays on screen.

## Interaction on the logical axis

* Pan, zoom, crosshair and `getVisibleLogicalRange / setVisibleLogicalRange` work on elements.
* `crosshairMove` carries `derived: DerivedPoint` for the element under the pointer.
* Time-based APIs map through `sourceTime`: `setVisibleRange`, `setCrosshairPosition` and
  `timeScale().timeToCoordinate(t)` use the first element formed at or after `t` (`null` after the
  last element); `coordinateToTime(x)` returns the element's source candle time (`null` outside the
  elements). No fictitious times are interpolated.
* Drawings made on a derived chart use `domain: "logical"` (anchored to element indexes); time
  drawings are hidden while a derived type is active and come back unchanged.

## What is hidden on a derived chart

Overlays that have no meaning per element are hidden (not dropped) while a derived type is active
and listed in `getDerivedInfo().hidden`: additional series, markers, session shading, time-domain
drawings, and indicators that need volume or time (`requires`). Price-only indicators are
calculated on the derived closes.

## Programmatic use

```ts
import { computeDerived, DerivedSeriesEngine } from "@/lib/xchart-sdk";
const s = computeDerived("renko", candles, { method: "fixed", size: 5 }); // one-shot
const eng = new DerivedSeriesEngine("kagi", { reversal: 4 });              // streaming
eng.sync(candles);   // incremental: only new / changed candles are processed
eng.points();        // DerivedPoint[]
```

The same calculation runs in the indicator worker (`IndicatorWorkerClient.computeDerived`), with results
identical to the main thread (tested).

## Limitations

* Tick-based construction (true range bars, exact intrabar order) is not wired into charts: the
  engine accepts candles only. `reconstructed` marks every element that depends on the assumption.
* One derived type per chart; additional series are hidden while it is active.
