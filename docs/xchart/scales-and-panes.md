# Price scales and panes

## Main-scale modes

```ts
chart.priceScale().applyOptions({ mode: "percentage" }); // "normal" | "logarithmic" | "percentage" | "indexed"
chart.applyOptions({ priceScale: { mode: "indexed", autoScale: true, precision: 2 } }); // same setting
```

* **percentage**: % change from the first visible bar's close; **indexed**: first visible close = 100.
  Both are display transforms (axis, crosshair and last-price label show transformed values);
  series data and price-line prices stay in real prices. The base follows the first visible bar.
* Switching modes re-enables auto-scale.

## Overlay scales, left scale, margins

```ts
const vol = chart.addHistogramSeries({ pane: "main", priceScaleId: "vol", colorMode: "candle" });
chart.priceScale("vol").applyOptions({ margins: { top: 0.8, bottom: 0 } });   // bottom 20 % of the pane
chart.addLineSeries({ priceScaleId: "left" });                                // own range, labels on the left
chart.priceScale("left").applyOptions({ visible: false });                    // hide the left labels
chart.priceScale("vol").seriesCount();
```

* `priceScaleId` (main pane): `"right"` (default, the main scale), `"left"`, or any id — every id
  gets its own auto-fitted range in the main pane's rectangle.
* `margins` are fractions in `[0, 1)` summing to ≤ 0.9; valid on any scale including `"right"`.
* **v0.3.1: every scale is independent** — right, left, overlay and pane scales each take `mode`
  (`normal`, `logarithmic`, `percentage`, `indexed`), `invert`, `autoScale` + `range`, `margins`,
  `precision` / `minMove` / `formatter`. Address a pane's scale with `chart.priceScale(id, paneId)`.
* Log scales cannot place values ≤ 0: they are skipped and a `scaleWarning` event is emitted.
* `chart.priceToCoordinate(price, paneId, scaleId)` / `coordinateToPrice(y, paneId, scaleId)` and
  plugin layers (`api.scaleY(scaleId, p)`) use the same mapping as the renderer.
* The left scale's labels are drawn inside the plot's left edge on a translucent background.

Events: `scaleChange { scaleId, paneId }`.

## Panes

```ts
chart.addLineSeries({ pane: "separate" });          // own pane: id "xs-<seriesId>"
chart.addHistogramSeries({ pane: "osc" });          // named pane …
chart.addLineSeries({ pane: "osc" });               // … shared by several series
chart.addIndicator("rsi");                          // indicator pane: "xind-<indicatorId>"

chart.panes();                    // [{ id: "main" }, …] top to bottom
const p = chart.pane("osc")!;
p.setHeight(160);  p.height();    // px (30–5000); the main pane absorbs the difference
p.collapse();  p.expand();  p.isCollapsed();   // collapsed = 20 px title strip, series hidden
p.moveTo(1);                      // position below the main pane (1 = directly below)
```

* Users can drag the line between two panes to resize them (minimum 30 px each).
* Pane ids: `"main"`, `"separate"` panes (`xs-…`), indicator panes (`xind-…`) and named panes
  (1–32 letters, digits, `_` or `-`; the `xs-`/`xind-` prefixes are reserved).
* A pane disappears with its last series; stale `PaneApi` handles throw `PANE_REMOVED`.

Events: `paneResize { paneId, height }`, `layoutChange { reason }`.
