# Drawings, markers and price lines

## Tools (27)

| Group | Tools (anchors) |
|---|---|
| Lines | `trendline` (2), `ray` (2), `extended-line` (2), `horizontal-line` (1), `horizontal-ray` (1), `vertical-line` (1), `arrow` (2) |
| Channels | `parallel-channel` (3), `regression-channel` (2, least squares ±2σ of closes), `pitchfork` (3, Andrews) |
| Fibonacci | `fib-retracement` (2), `fib-extension` (3), `fib-timezones` (2), `fib-fan` (2), `fib-channel` (3) |
| Shapes & notes | `rectangle` (2), `ellipse` (2), `triangle` (3), `polygon` (3–64), `text` (1), `price-label` (1), `callout` (2) |
| Measurement | `price-range` (2), `date-range` (2), `date-price-range` (2), `long-position` (3: entry, target, stop), `short-position` (3) |

Anchors are `{ time, price }` — never pixels or bar numbers — so drawings stay attached to the
data across zoom, pan, live updates and reloads. `long-position`/`short-position` are
illustrations (risk/reward, % to target/stop); they place no orders.

## API

```ts
const d = chart.addDrawing({ type: "fib-retracement", points: [{ time: t1, price: 980 }, { time: t2, price: 1040 }], style: { color: "#f59e0b", levels: [0, 0.382, 0.5, 0.618, 1] } });
d.update({ points: [...] });  d.applyOptions({ lineStyle: "dashed" });
d.setLocked(true);  d.setVisible(false);  d.remove();
chart.getDrawing(id); chart.getDrawings(); chart.removeDrawing(id); chart.clearDrawings();
chart.duplicateDrawing(id); chart.selectDrawing(id);
chart.undoDrawing(); chart.redoDrawing();                 // 100-step history
const json = chart.serializeDrawings();  chart.loadDrawings(json);   // atomic, validated
chart.subscribeDrawingEvents((e) => …);  // create | update | remove | select | tool
```

Style: `color, lineWidth (0.5–10), lineStyle, fillColor, fillOpacity (0–1), textColor, fontSize
(6–72), levels (≤ 32), extendLeft, extendRight, showLabels`. Unknown keys and invalid colours throw.

## Interactive drawing

`chart.setDrawingTool("trendline")` (null cancels). Then:

* Click to place each anchor, or press–drag–release for two-anchor tools (works with touch).
  Polygons finish with a double click.
* Anchors snap to the nearest open/high/low/close within 12 px (`chart.setDrawingSnap(false)`
  disables; hold **Ctrl/⌘** to place freely).
* Select by clicking; drag the body (moves by whole bars) or an anchor. Locked drawings select
  but do not move or delete.
* Keyboard (chart focused): **Delete/Backspace** remove, **Ctrl/⌘+Z** undo, **Ctrl/⌘+Y** or
  **Ctrl/⌘+Shift+Z** redo, **Ctrl/⌘+D** duplicate, **Shift+L** lock/unlock, **Esc** cancel/deselect.
* Presses that do not hit a drawing pan the chart as usual.

Drawings render through an engine layer and never touch series data. Custom tools can be
registered by [plugins](plugins.md).

## Markers

```ts
series.setMarkers([{ time, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Buy", size: 1 }]);
const id = series.addMarker({ time, position: "aboveBar", shape: "circle" });
series.removeMarker(id); series.getMarkers(); series.clearMarkers();
```

Shapes `arrowUp | arrowDown | circle | square`; positions `aboveBar | belowBar | inBar`. Several
markers on one bar stack. Markers on a time without data are kept but not drawn.

## Price lines

```ts
const pl = series.createPriceLine({ price: 1012.5, title: "Target", color: "#22c55e", lineStyle: "solid" });
series.createPriceLine({ source: "last" });            // follows the newest value
series.createPriceLine({ source: "previousClose" });   // close before the newest bar
pl.applyOptions({ price: 1015 }); pl.price(); pl.remove(); series.priceLines();
```

Options are validated atomically. An axis label is drawn unless `axisLabelVisible: false`.
