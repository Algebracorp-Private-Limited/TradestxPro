# Events

```ts
const off = chart.on("crosshairMove", (e) => { … });   // returns an idempotent unsubscribe
chart.once("indicatorError", (e) => { … });
off();
```

| Event | Payload |
|---|---|
| `crosshairMove` | `CrosshairEvent` (`time, price, seriesData, indicators, projected, display`) |
| `visibleRangeChange` | `{ range: { from, to }, logical: { from, to } }` |
| `click`, `dblClick` | `{ time, price, paneId, point: { x, y }, logical }` (clicks on drawings are consumed by the drawing tools) |
| `seriesUpdate` | `{ seriesId, kind: "full" \| "tick" }` |
| `indicatorChange` | `{ indicator, action: "added" \| "removed" \| … }` |
| `indicatorError` | `{ indicator, error }` |
| `drawingCreate` / `drawingUpdate` | `{ drawing }` (serialised) |
| `drawingRemove` | `{ id }` |
| `drawingSelect` / `drawingTool` | `{ id }` / `{ tool }` |
| `paneResize` | `{ paneId, height }` |
| `scaleChange` | `{ scaleId, paneId }` |
| `layoutChange` | `{ reason }` (`pane-collapse`, `pane-move`, `chart-type`, `layout-load`, …) |
| `pluginError` | `{ pluginId, error }` |
| `destroy` | `{}` (then all handlers are released) |

* Delivery is synchronous, in subscription order; a throwing handler is logged and does not stop
  the others. Handlers removed during a delivery are skipped.
* `subscribeCrosshairMove` and `subscribeDrawingEvents` (v0.2/v0.3) remain available.
