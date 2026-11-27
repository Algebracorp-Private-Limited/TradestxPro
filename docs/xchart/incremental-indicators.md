# Incremental indicator engine

All 122 built-in indicators (22 original + 100 native) are evaluated **incrementally and exactly**:
a live tick or a new bar costs O(1)–O(window) per indicator instead of a full recalculation, and
the result is identical to the reference full calculation (`definition.calculate`).

```
IndicatorInput (columnar, revisioned) ──► StreamGraph (shared nodes, reference counted)
                                            committed states (bars 0 … n−2)
                                            provisional states (bar n−1, evaluated on clones)
                                            checkpoints (every 4096 bars, bounded)
                                          ──► indicator outputs, aligned to the chart axis from the first changed bar
```

## Kernels and nodes

An indicator's `stream(params)` returns its outputs as **nodes** (`NodeDef`) built with the
helpers exported as `kernels`: sources (`src`), moving averages (`sma`, `ema`, `rma`, `wma`),
`stdev`, rolling `highest` / `lowest` (monotonic deque), `lag`, `trueRange` / `atr`, `plusDM` /
`minusDM`, `moves`, `supertrendLine`, `psar`, `vwap`, `obv`, `cci`, `mfi`, `roc`, `anyPositive`, and
the generic `map`, `aux`, `sum`, `rolling` and `reducer`. Each node has a canonical **key**
(kernel + parameters + input keys), so `ema(src("close"), 20)` used by MACD, Keltner and a plain
EMA is one node computed once (`indicatorEngineStats().shared`).

Each kernel implements `push(row)`, `value()` and `clone()`. Recursive kernels (EMA, RMA, Wilder
smoothing, PSAR, Supertrend …) carry their state forward; windowed kernels keep their window.

## Committed and provisional state

* **Committed**: node states after all closed bars. They advance exactly once per bar.
* **Provisional**: the live (last) bar is evaluated on *clones* of the committed states. A tick
  that replaces the live candle discards the clones and evaluates again, so replacing the live
  candle 1,000 times never advances an EMA more than once (no drift; tested).
* **Append**: when a new bar arrives, the previous live bar is committed (pushed into the real
  states) and the new bar becomes provisional.
* **Historical correction** (a bar before the live one changes): the graph restores the nearest
  checkpoint at or before the change and replays from there. Checkpoints are taken every 4096 bars
  and thinned to at most 64, so memory stays bounded.
* **Full `setData`**: one pass over the history (O(n) per node).

The chart reads data changes as `IndicatorInput.revision`; `patchInput` keeps the columnar input
current in place for ticks and appends, so no arrays are rebuilt per tick.

## Adding and removing indicators

* Adding an indicator acquires its nodes. Nodes that already exist are shared; **new nodes only**
  are initialised over the committed history (`initPending`), existing states are untouched.
* Removing an indicator (or changing its parameters) releases its nodes; reference counts cover
  the full dependency closure, and nodes are pruned when unused. Remaining states are unaffected.
* Outputs are written to the chart axis from the first changed bar (`writeAlignedFrom`), not in full.

## Exactness

`tests/xchart-incremental.test.ts` and `tests/xchart-catalog.test.ts` check, for every built-in:

* incremental evaluation (ticks, appends, corrections) ≡ a one-pass `calculate` over the same data,
  **bitwise** (`Object.is`) for all 122. For the 22 originals `calculate` is the `lib/ta` code used
  by the production terminal; for the 100 natives `calculate` runs the same node graph in one pass,
  so their *formula* correctness is established separately (next bullets),
* live replacement of the last bar ≡ the final candle,
* append, historical correction (checkpoint replay), removal, re-add, parameter change,
* gaps in the data (warm-up and NaN propagation match the reference),
* 91 native indicators against independent reference implementations written separately in the
  tests (agreement within 1e-9 relative); the remaining 9 are cross-checked by mathematical
  identities (e.g. Fibonacci/Woodie/CPR pivots from the standard pivot, highest/lowest by brute force). Hurst has only a
  directional sanity check (weaker; see *Limitations*).

## Fallback and errors

If a streaming evaluation throws, the indicator detaches from the graph, falls back to its
reference `calculate`, and emits `indicatorError`. Custom indicators without `stream` use the
previous policy: finite-memory definitions (`lookback`) recompute a tail window; others are
recalculated in full, at most once per frame.

## Scheduling

The chart coalesces any number of data changes into one indicator flush at the start of the next
animation frame. `FrameScheduler` exposes the same policy for applications that drive their own
calculations.

## Diagnostics

```ts
chart.indicatorEngineStats(); // { nodes, shared, committed, rebuilds, replays, lastSyncMs, incrementalAdds }
```

## Writing a streaming custom indicator

```ts
import { kernels } from "@/lib/xchart-sdk";
const { src, ema } = kernels;
chart.registerIndicator({
  id: "my-ema", name: "My EMA", description: "EMA of close", params: [{ key: "length", label: "Length", type: "integer", default: 20, min: 1 }],
  inputs: ["close"], outputs: [{ key: "value", label: "EMA", type: "line", color: "#38bdf8" }], pane: "overlay",
  warmup: (p) => Number(p.length) - 1,
  calculate: (inp, p) => ({ value: referenceEma(inp.close, Number(p.length)) }),
  stream: (p) => ({ outputs: [{ key: "value", node: ema(src("close"), Number(p.length)) }] }),
});
```

`calculate` stays the reference; `stream` must produce the same values (test both).

## Limitations

* The worker (see [worker-architecture.md](worker-architecture.md)) is not used by the live chart
  pipeline: incremental evaluation runs on the main thread (it is O(1)–O(window) per tick).
* Appending a bar occasionally costs more (JavaScript array growth): see
  [performance.md](performance.md) for the measured maximum.
* Hurst exponent: validated by a directional check only (random walk ≈ 0.5, trending > 0.5), not
  against an independent reference implementation.
