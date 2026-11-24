# Performance

Measured with `XCHART_BENCH=1 node --test --experimental-strip-types tests/xchart-sdk-browser.test.ts`
(reported, never asserted). Environment: headless Chromium 153 via Playwright 1.63, Node 22.23,
Linux container with 4 vCPUs, 670 × 400 px chart, device pixel ratio 1. Synthetic 1-minute candles.
Headless Chromium paces `requestAnimationFrame` at ~30 Hz, so **"→ frame" times have a floor of
~33 ms**; the "draw" figure is the renderer's own time for that frame. Numbers vary between
machines; compare runs on the same machine only.

## Indicators (median / p95, ms)

| Candles × indicators | Add all | Tick → frame | (draw) | Append → frame | Pan draw | +50 drawings draw | Layout save / load |
|---|---|---|---|---|---|---|---|
| 1k × 5 | 18.7 | 33.3 / 33.7 | 2.1 / 4.4 | 33.3 / 33.7 | 1.7 / 2.3 | 2.5 / 6.7 | 1.0 / 32.4 |
| 1k × 10 | 33.2 | 33.3 / 34.4 | 2.2 / 3.1 | 33.3 / 36.1 | 2.8 / 5.4 | 3.9 / 5.6 | 0.5 / 33.0 |
| 1k × 20 | 36.4 | 33.3 / 34.8 | 3.9 / 6.1 | 33.3 / 34.2 | 3.4 / 6.0 | 4.9 / 17.9 | 1.2 / 32.2 |
| 10k × 5 | 32.1 | 33.4 / 36.4 | 2.0 / 3.2 | 33.3 / 33.6 | 1.7 / 4.0 | 2.9 / 3.9 | 0.4 / 33.0 |
| 10k × 10 | 39.6 | 33.3 / 35.3 | 2.8 / 3.2 | 33.3 / 33.7 | 2.7 / 3.5 | 3.9 / 12.4 | 0.3 / 32.9 |
| 10k × 20 | 88.3 | 38.2 / 53.6 | 2.9 / 4.2 | 47.6 / 62.2 | 4.2 / 8.6 | 3.9 / 9.3 | 0.4 / 66.4 |
| 50k × 5 | 66.5 | 33.4 / 36.1 | 1.6 / 2.4 | 33.3 / 38.2 | 1.6 / 2.3 | 3.3 / 4.9 | 0.4 / 82.9 |
| 50k × 10 | 199.6 | **100.0 / 168.2** | 2.8 / 5.4 | **83.3 / 133.7** | 3.3 / 3.6 | 4.0 / 5.8 | 0.4 / 155.8 |
| 50k × 20 | 268.2 | **178.1 / 260.2** | 4.3 / 7.3 | **197.8 / 233.1** | 3.6 / 5.4 | 4.9 / 7.9 | 0.3 / 316.7 |
| 100k × 5 | 134.3 | 33.8 / 79.8 | 1.9 / 3.6 | 34.0 / 66.6 | 1.9 / 3.2 | 3.0 / 5.1 | 0.3 / 149.6 |
| 100k × 10 | 299.0 | **255.5 / 320.5** | 3.2 / 7.7 | **248.4 / 266.8** | 2.6 / 4.2 | 4.0 / 7.7 | 0.5 / 299.4 |
| 100k × 20 | 637.8 | **398.2 / 492.7** | 4.1 / 8.6 | **399.5 / 488.9** | 4.0 / 5.7 | 4.9 / 7.4 | 0.2 / 622.5 |

Indicator sets (catalogue order, `volume` excluded): **5** = sma, ema, wma, hma, bb; **10** adds
keltner, donchian, supertrend, psar, vwap; **20** adds ichimoku, rsi, macd, stoch, adx, atr, cci,
mfi, willr, roc. Recursive (fully recalculated on ticks): 1 of 5, 5 of 10, 11 of 20.

### What the numbers mean

* **Rendering stays cheap at every size** (median 1.6–4.9 ms per frame, p95 ≤ 18 ms): only
  visible bars are drawn.
* **Live ticks are cheap for finite-memory indicators** (window recalculation): the 5-indicator set
  (one recursive EMA) stays at the frame floor up to 100k candles (median).
* **Recursive indicators are recalculated in full on every tick.** Each costs roughly 15–120 ms
  at 100k bars in TradestXPro's indicator catalogue (`lib/ta`), so 10–20 of them on 50k–100k
  candles take 100–400 ms per tick (ticks are coalesced to one recalculation per frame, so the
  chart stays responsive but updates at a lower rate). v0.3 shares one converted input between
  all indicators of a chart (≈ −25 % at 100k × 20 vs. before).
* **Recommendation:** for live charts with many recursive indicators, keep ≤ 10k–20k bars loaded
  (older history can be paged in on demand).
* Planned (not in v0.3): incremental `update()` implementations for the recursive built-ins.

## Core SDK (v0.2.1 benchmark, same environment)

| Candles | Load 3 series | Replace last + draw | Append | Zoom / pan draw | Create+load+remove |
|---|---|---|---|---|---|
| 1k | 12.3 | 0.1 + 1.6 | < 0.1 | 1.7 / 1.5 | 0.9 |
| 10k | 36.9 | 0.1 + 1.7 | < 0.1 | 1.9 / 1.7 | 3.0 |
| 50k | 172.8 | 0.1 + 1.6 | < 0.1 | 1.7 / 1.6 | 21.5 |

Memory: `performance.memory` is coarse in headless Chromium without extra flags, so heap figures
are not reported; destruction releases all chart-owned arrays, listeners and observers (tested).
