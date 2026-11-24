# Plugins

```ts
import type { XChartPlugin } from "@/lib/xchart-sdk";

const sessionVwapBands: XChartPlugin = {
  id: "acme/vwap-bands",
  version: "1.0.0",
  install(ctx) {
    ctx.registerIndicator(vwapBandsDefinition);                 // chart-scoped
    ctx.registerDrawingTool("note-box", { anchors: 2, render(env, pts, d) { … }, hit(env, pts, p) { … } });
    const off = ctx.addLayer({ pane: "main", z: "below", draw(api) { /* api.ctx, api.xOfIndex, api.yOfPrice … */ } });
    ctx.on("visibleRangeChange", (e) => { … });
    return { destroy() { /* release your own resources */ } };
  },
};

chart.use(sessionVwapBands);
chart.plugins();                 // [{ id, version, layers, indicators, tools }]
chart.removePlugin("acme/vwap-bands");
```

## Context

| Method | Effect (undone on removal) |
|---|---|
| `addLayer({ pane, z, draw })` | Draws on a pane below or above the series; returns an unsubscribe |
| `registerIndicator(def)` | Chart-scoped indicator type (instances removed with the plugin) |
| `registerDrawingTool(type, spec)` | Chart-scoped drawing tool (its drawings removed with the plugin) |
| `on(event, handler)` | Event subscription |
| `requestRedraw()` | Schedules a frame |
| `chart` | The public `ChartApi` |

## Guarantees

* A failing `install` is rolled back completely and `use()` throws `PLUGIN_FAILED`.
* Exceptions in layers and event handlers are caught: the layer is skipped for that frame and a
  `pluginError { pluginId, error }` event is emitted (once per plugin for layers).
* `removePlugin()` and `chart.remove()` call `destroy()` and undo every registration.

## Security model — read this

Plugins are **trusted code**. They run in the page with the same privileges as your application
and are **not sandboxed**: a plugin can read the DOM, make network requests and access anything
your app can. Only install plugins you wrote or reviewed.

The SDK never loads plugins from URLs or strings and never evaluates code (no `eval`/`new
Function`). Layouts list plugin ids for information only; installing is always an explicit
`chart.use()` call by your application.
