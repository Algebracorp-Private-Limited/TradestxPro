# Performance

## Method

`scripts/xchart-bench.ts` runs the same workload against two checkouts in a real browser and prints
median / p95 / max per metric:

```bash
git worktree add ../xchart-v030 784b133   # v0.3.0
node --experimental-strip-types --no-warnings scripts/xchart-bench.ts --root ../xchart-v030 --root .
```

* **Environment of the figures below:** chromium 153.0.8010.12, Node v22.23.4, Intel(R) Xeon(R) Processor @ 2.10GHz ×4, 16 GB, linux 6.18.44-fc-v880; headless, device pixel ratio 1, 1200 × 700 px chart
  (synced charts 680 × 300 px). Numbers vary between machines: compare runs from one machine only.
* **Data:** synthetic 1-minute candles (deterministic random walk). No market data.
* **Indicators:** the first *k* of sma, ema, wma, hma, bb, keltner, donchian, supertrend, psar, vwap, ichimoku, rsi, macd, stoch, adx, atr, cci, mfi, willr, roc (the same ids in both versions). In v0.3.0, 1 of the
  first 5, 5 of 10 and 11 of 20 were recursive and recalculated in full on every tick.
* **What is timed:** main-thread work, not frame-locked wall time (headless Chromium paces
  `requestAnimationFrame` at ~30 Hz, which would put a 33 ms floor under every figure):
  * *live tick* = `series.update()` replacing the last candle + the renderer's draw time of the
    frame it causes (the frame includes the indicator flush); 100 ticks;
  * *append* = the same for a new candle; 50 appends;
  * *pan draw* = draw time while scrolling; 40 frames;
  * *crosshair frame* = draw time of a pointer move (v0.3.1: crosshair-only frame from the cached
    frame; v0.3.0: full redraw); 60 moves;
  * *setData* and *add indicators* are wall time including their first frame;
  * *JS heap* = `performance.memory.usedJSHeapSize` after the run (coarse and GC-dependent:
    indicative only).

## Summary (v0.3.0 → v0.3.1)

| Scenario | v0.3.0 median / p95 | v0.3.1 median / p95 |
|---|---|---|
| Live tick, 100k candles × 20 indicators | 264 / 338 ms | **3.6 / 5.3 ms** |
| Live tick, 50k × 10 | 61.8 / 87.8 ms | **2.5 / 3.2 ms** |
| Live tick, 10k × 20 | 27.9 / 32.1 ms | **3.3 / 4.4 ms** |
| Append, 100k × 20 | 271 / 325 ms | **3.6 / 5.4 ms** (max 59 ms) |
| Crosshair move, 100k × 20 | 2.9 / 3.3 ms | **0.3 / 0.4 ms** |
| 8 synced charts, live tick on all | 21.6 / 26.6 ms | **7.3 / 8.7 ms** |
| Pan draw (any size) | 1.2–3.0 ms | 1.2–3.2 ms (unchanged) |
| Add 20 indicators to 100k candles | 572 ms | 876 ms (**slower**) |

* **Live updates no longer depend on the history length**: they are O(1)–O(window) per indicator
  (see [incremental-indicators.md](incremental-indicators.md)). v0.3.0 recalculated recursive
  indicators in full on every tick.
* **Regressions, reported as measured:**
  * *Adding indicators* is ~1.2–1.7× slower at 10k–100k candles: the first pass runs the streaming
    kernels bar by bar (one shared graph) instead of `lib/ta`'s array loops. It is a one-off cost
    per indicator, not per tick.
  * *Append max*: occasional spikes (up to 59 ms at 100k × 20) when JavaScript arrays grow; p95
    stays ≤ 5.4 ms.
  * *First crosshair move after a data change* costs a full frame plus caching it (the max column:
    up to 35 ms on one chart with 10 indicators, 42 ms summed over 8 synced charts); following
    moves cost ~0.3 ms.
* The frame cache is lazy: it is taken only while the crosshair moves, so data and pan frames
  without pointer activity do not pay for it. (An eager version cost +4 ms per frame with band
  fills; it was found by this benchmark and fixed before release.)

## v0.3.1

| candles | indicators | setData→first frame ms | add indicators→frame ms | live tick: update()+frame (med / p95 / max) | of which draw | append bar: update()+frame | pan draw | crosshair frame | JS heap MB | destroy ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | 1 | 29.80 | 27.70 | 1.50 / 1.90 / 2.90 | 1.40 / 1.70 / 2.70 | 1.40 / 1.70 / 1.90 | 1.20 / 1.50 / 1.60 | 0.30 / 0.50 / 3.90 | 10 | 0.70 |
| 1000 | 5 | 25.20 | 28.70 | 1.90 / 2.30 / 2.60 | 1.70 / 2.10 / 2.40 | 1.80 / 2.20 / 2.80 | 1.60 / 1.80 / 1.90 | 0.30 / 0.40 / 13.40 | 10 | 0.80 |
| 1000 | 10 | 27.00 | 55.00 | 2.50 / 3.30 / 4.10 | 2.20 / 2.90 / 3.80 | 2.60 / 3.30 / 5.30 | 2.50 / 3.80 / 3.80 | 0.30 / 0.40 / 29.90 | 10 | 1.00 |
| 1000 | 20 | 32.00 | 65.10 | 3.40 / 4.90 / 6.40 | 3.10 / 4.50 / 6.20 | 3.60 / 4.70 / 5.90 | 3.00 / 5.10 / 7.90 | 0.30 / 0.50 / 27.30 | 10 | 1.10 |
| 10000 | 1 | 34.60 | 21.50 | 1.50 / 1.80 / 2.00 | 1.40 / 1.70 / 1.90 | 1.50 / 1.90 / 2.20 | 1.30 / 2.00 / 2.00 | 0.30 / 0.60 / 4.40 | 14 | 0.70 |
| 10000 | 5 | 36.30 | 68.30 | 1.70 / 2.30 / 3.30 | 1.60 / 2.00 / 2.70 | 1.70 / 2.10 / 2.30 | 1.60 / 1.80 / 1.90 | 0.30 / 0.50 / 14.80 | 21 | 0.90 |
| 10000 | 10 | 32.80 | 93.40 | 2.60 / 3.30 / 5.70 | 2.40 / 3.00 / 5.50 | 2.50 / 3.80 / 4.70 | 2.30 / 2.50 / 2.60 | 0.30 / 0.40 / 24.60 | 30 | 1.10 |
| 10000 | 20 | 33.00 | 161 | 3.30 / 4.40 / 5.80 | 3.00 / 3.80 / 5.30 | 3.50 / 4.10 / 7.30 | 2.80 / 3.30 / 3.40 | 0.30 / 0.50 / 20.50 | 51 | 1.40 |
| 50000 | 1 | 54.70 | 44.30 | 1.40 / 1.90 / 2.30 | 1.30 / 1.80 / 2.20 | 1.30 / 1.60 / 2.40 | 1.20 / 1.40 / 1.50 | 0.30 / 0.40 / 4.10 | 40 | 0.70 |
| 50000 | 5 | 51.40 | 131 | 2.00 / 3.00 / 3.30 | 1.70 / 2.70 / 3.10 | 1.70 / 2.10 / 6.50 | 1.60 / 2.00 / 2.50 | 0.40 / 0.50 / 11.00 | 58 | 0.90 |
| 50000 | 10 | 56.00 | 280 | 2.50 / 3.20 / 7.60 | 2.30 / 2.90 / 7.30 | 2.40 / 3.40 / 17.80 | 2.30 / 2.90 / 3.00 | 0.40 / 0.50 / 33.10 | 61 | 1.00 |
| 50000 | 20 | 55.30 | 501 | 3.60 / 5.60 / 6.80 | 3.20 / 5.10 / 6.40 | 3.50 / 5.10 / 31.40 | 3.20 / 3.60 / 4.70 | 0.30 / 0.60 / 26.80 | 141 | 1.20 |
| 100000 | 1 | 78.90 | 60.90 | 1.50 / 2.20 / 2.70 | 1.40 / 2.00 / 2.50 | 1.40 / 2.40 / 3.80 | 1.30 / 1.70 / 1.70 | 0.30 / 0.40 / 4.20 | 65 | 0.80 |
| 100000 | 5 | 66.30 | 219 | 1.80 / 2.80 / 8.00 | 1.70 / 2.60 / 7.70 | 1.70 / 2.20 / 11.50 | 1.60 / 1.90 / 1.90 | 0.30 / 0.50 / 11.50 | 93 | 0.90 |
| 100000 | 10 | 72.90 | 500 | 2.60 / 4.20 / 6.80 | 2.30 / 3.70 / 6.50 | 2.70 / 4.00 / 30.40 | 2.40 / 2.80 / 3.00 | 0.30 / 0.40 / 35.40 | 190 | 0.90 |
| 100000 | 20 | 67.80 | 876 | 3.60 / 5.30 / 6.40 | 3.20 / 4.90 / 5.70 | 3.60 / 5.40 / 59.10 | 3.10 / 6.90 / 8.80 | 0.30 / 0.40 / 24.50 | 273 | 1.10 |

Synced charts (10k candles, 5 indicators each):

| charts | pan: call + all frames (med / p95 / max) | live tick on every chart | crosshair (synced) |
|---|---|---|---|
| 1 | 1.10 / 1.40 / 1.60 | 1.20 / 1.50 / 1.90 | 0.40 / 0.60 / 6.30 |
| 2 | 2.20 / 2.70 / 2.80 | 2.10 / 2.70 / 3.00 | 0.50 / 0.70 / 11.80 |
| 4 | 4.00 / 5.40 / 5.40 | 4.00 / 5.00 / 6.10 | 0.50 / 0.80 / 22.10 |
| 8 | 7.50 / 8.70 / 11.40 | 7.30 / 8.70 / 11.30 | 0.60 / 1.10 / 42.20 |

## v0.3.0 (same machine, same run)

| candles | indicators | setData→first frame ms | add indicators→frame ms | live tick: update()+frame (med / p95 / max) | of which draw | append bar: update()+frame | pan draw | crosshair frame | JS heap MB | destroy ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | 1 | 27.00 | 26.60 | 1.60 / 1.90 / 3.90 | 1.40 / 1.70 / 3.70 | 1.60 / 1.90 / 2.00 | 1.30 / 1.60 / 1.70 | 1.50 / 1.90 / 1.90 | 10 | 0.40 |
| 1000 | 5 | 30.70 | 27.90 | 2.10 / 2.80 / 3.20 | 1.70 / 2.30 / 2.40 | 2.00 / 2.30 / 2.40 | 1.60 / 1.90 / 2.00 | 1.60 / 2.00 / 2.30 | 21 | 0.40 |
| 1000 | 10 | 27.30 | 43.20 | 3.60 / 5.10 / 6.80 | 2.20 / 2.90 / 3.70 | 4.10 / 4.80 / 6.00 | 2.30 / 2.70 / 2.90 | 2.40 / 3.10 / 3.70 | 12 | 0.30 |
| 1000 | 20 | 27.80 | 47.00 | 6.10 / 8.00 / 10.80 | 3.10 / 4.10 / 5.80 | 5.80 / 7.30 / 8.80 | 3.00 / 3.50 / 3.60 | 2.80 / 3.50 / 3.70 | 15 | 0.40 |
| 10000 | 1 | 33.90 | 28.80 | 1.80 / 2.60 / 3.10 | 1.30 / 1.60 / 1.80 | 1.90 / 2.10 / 2.20 | 1.30 / 2.30 / 2.50 | 1.40 / 1.90 / 3.00 | 14 | 0.40 |
| 10000 | 5 | 31.40 | 33.10 | 3.40 / 4.80 / 12.30 | 1.60 / 2.10 / 2.40 | 3.60 / 4.50 / 5.80 | 1.50 / 1.70 / 1.70 | 1.60 / 2.10 / 2.30 | 21 | 0.40 |
| 10000 | 10 | 33.90 | 81.30 | 14.40 / 21.20 / 29.90 | 2.30 / 3.10 / 4.10 | 13.70 / 15.70 / 25.50 | 2.20 / 2.70 / 2.90 | 2.40 / 2.70 / 3.00 | 16 | 0.80 |
| 10000 | 20 | 32.00 | 89.00 | 27.90 / 32.10 / 49.60 | 3.10 / 4.30 / 7.30 | 27.50 / 29.10 / 40.40 | 3.00 / 3.60 / 4.10 | 3.00 / 3.50 / 4.70 | 78 | 0.40 |
| 50000 | 1 | 45.60 | 36.60 | 3.40 / 5.10 / 5.70 | 1.30 / 1.40 / 1.80 | 3.30 / 4.70 / 10.50 | 1.20 / 1.40 / 1.50 | 1.30 / 1.60 / 1.90 | 73 | 0.40 |
| 50000 | 5 | 46.40 | 80.60 | 10.50 / 15.40 / 23.00 | 1.50 / 2.20 / 2.70 | 9.50 / 12.60 / 18.20 | 1.60 / 2.00 / 2.00 | 1.70 / 2.00 / 2.40 | 117 | 0.40 |
| 50000 | 10 | 54.60 | 186 | 61.80 / 87.80 / 110 | 2.20 / 3.10 / 5.60 | 62.70 / 94.70 / 95.20 | 2.20 / 2.50 / 2.70 | 2.10 / 2.40 / 2.60 | 104 | 0.90 |
| 50000 | 20 | 45.20 | 314 | 129 / 168 / 200 | 3.20 / 4.00 / 5.10 | 127 / 159 / 172 | 2.90 / 3.60 / 3.70 | 2.90 / 3.50 / 5.40 | 190 | 0.40 |
| 100000 | 1 | 71.00 | 51.30 | 6.90 / 9.20 / 10.70 | 1.30 / 1.60 / 2.20 | 6.90 / 9.20 / 11.20 | 1.20 / 1.50 / 1.60 | 1.40 / 1.60 / 2.10 | 65 | 0.40 |
| 100000 | 5 | 65.60 | 127 | 20.70 / 41.00 / 74.20 | 1.60 / 1.90 / 2.30 | 19.30 / 35.70 / 73.00 | 1.50 / 2.40 / 2.50 | 1.60 / 1.80 / 2.00 | 290 | 0.40 |
| 100000 | 10 | 71.20 | 334 | 125 / 178 / 194 | 2.30 / 4.20 / 5.80 | 124 / 178 / 181 | 2.10 / 2.50 / 2.60 | 2.20 / 2.60 / 2.80 | 290 | 1.00 |
| 100000 | 20 | 73.10 | 572 | 264 / 338 / 353 | 3.20 / 4.60 / 9.90 | 271 / 325 / 354 | 3.00 / 4.10 / 5.40 | 2.90 / 3.30 / 5.80 | 150 | 0.40 |

Synced charts (10k candles, 5 indicators each):

| charts | pan: call + all frames (med / p95 / max) | live tick on every chart | crosshair (synced) |
|---|---|---|---|
| 1 | 1.10 / 1.40 / 1.50 | 3.00 / 4.40 / 6.80 | 1.20 / 1.40 / 2.50 |
| 2 | 2.20 / 3.10 / 3.40 | 5.60 / 7.80 / 9.10 | 2.20 / 3.20 / 4.00 |
| 4 | 3.80 / 6.00 / 6.10 | 10.00 / 15.20 / 18.40 | 3.60 / 4.30 / 5.30 |
| 8 | 7.00 / 8.60 / 8.70 | 21.60 / 26.60 / 49.20 | 6.10 / 7.40 / 8.30 |

## Core SDK (v0.2.1 benchmark)

| Candles | Load 3 series | Replace last + draw | Append | Zoom / pan draw | Create+load+remove |
|---|---|---|---|---|---|
| 1k | 12.3 | 0.1 + 1.6 | < 0.1 | 1.7 / 1.5 | 0.9 |
| 10k | 36.9 | 0.1 + 1.7 | < 0.1 | 1.9 / 1.7 | 3.0 |
| 50k | 172.8 | 0.1 + 1.6 | < 0.1 | 1.7 / 1.6 | 21.5 |

## Limits

* Price-based chart types: at most 10,000 elements per candle and 1,000,000 in total
  (`DERIVED_LIMIT`).
* Worker requests: at most 2,000,000 rows and 200 indicators.
* Calendar datasets: at most 2 MB of JSON.
