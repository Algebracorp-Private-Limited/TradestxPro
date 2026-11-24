# Migrating from v0.2.1 to v0.3.0

v0.3 is additive: v0.2.1 code keeps working. Behaviour changes worth knowing:

* `ChartApi` / `SeriesApi` gained methods. **Custom `RenderAdapter` implementations** keep compiling:
  every new adapter method is optional; without them the chart works, but drawings, markers,
  price lines, plugin layers, coordinate conversion and pane geometry are unavailable.
* `SeriesPane` accepts named pane ids; `"main"` and `"separate"` are unchanged. Ids starting with
  `xs-` or `xind-` are reserved (`INVALID_OPTION`).
* `PriceScaleMode` adds `"percentage"` and `"indexed"`.
* `CrosshairEvent` adds optional `indicators`, `projected` and `display`.
* The chart canvas now handles pointer input for drawings first: a press on a drawing selects it
  instead of panning. Presses elsewhere pan as before. A press near the line between two panes
  now resizes them.
* `XCHART_VERSION` is `"0.3.0"`.

New: see the guides listed in [README.md](README.md).
