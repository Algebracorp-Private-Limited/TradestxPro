# Browser compatibility

## Tested engines

The browser suite (`tests/xchart-sdk-browser.test.ts`, 18 functional tests checking real canvas
pixels, pointer/touch input, workers, resizing and cleanup) runs on every push in GitHub Actions as
three **mandatory** jobs (`XChart CI / browser (chromium|firefox|webkit)`), with Playwright 1.63.0
on `ubuntu-24.04`:

| Engine | Version (CI) | Result (run 45769687026, commit 36916bf) | Skipped |
|---|---|---|---|
| Chromium | 153.0.8010.12 | 18 / 18 pass | benchmarks only |
| Firefox | 155.0 | 17 / 17 pass | touch-drawing test: Playwright cannot emulate touch input (`hasTouch`) in Firefox |
| WebKit | 26.6 | 18 / 18 pass | benchmarks only |

A job fails if any test fails or is skipped for a reason other than the benchmarks or a documented
engine gap (`# SKIP [engine] reason`). Skips are explicit, never silent.

Run locally:

```bash
XCHART_REQUIRE_BROWSER=1 XCHART_BROWSER=firefox node --test --experimental-strip-types tests/xchart-sdk-browser.test.ts
```

## What is covered in every engine

* Candles, lines, areas, histograms, clouds, all time-based and price-based chart types (pixels).
* Missing-candle gaps, visible range, theme repaint, live updates.
* Crosshair from real pointer events; crosshair-only frames from the cached frame.
* Drawings created and dragged with the mouse, on the main pane and on indicator panes.
* Independent scales (log / inverted / percentage), pane collapse and separator drag.
* Synchronised charts, session shading, time-zone labels.
* The indicator Web Worker (module worker): identical results, cancellation, staleness, termination.
* High-DPI backing store (2×, 3×), container resize, phone-width viewport (375 px) without
  horizontal scroll.
* Destruction: canvases, observers and listeners released; containers reusable.

## Engine differences found and handled

* **Separator drag (WebKit):** pane geometry updates on the next animation frame; tests wait for it
  (Chromium happens to flush a frame during input dispatch). No engine change was needed.
* **Mobile emulation (Firefox):** `isMobile` is not available; the phone viewport and DPR are still
  tested. Touch input is tested in Chromium and WebKit only.

## Not tested

* Real mobile devices (iOS Safari, Android Chrome) and touch gestures beyond Playwright emulation
  (pinch-zoom is not automated).
* Browsers older than the versions above. The SDK needs ES2022, `ResizeObserver`, `Intl` with IANA
  time zones, canvas 2D and (optionally) module Web Workers; the worker client falls back to the
  main thread where module workers are unavailable.
* Screen readers: the chart canvas exposes no per-element accessibility tree; applications should
  provide text alternatives for the information they chart.
