# Worker architecture

`IndicatorWorkerClient` runs full-history indicator and price-based (derived) calculations in a
module Web Worker, with a synchronous fallback where workers are unavailable. Results are
identical to the main thread: the worker and the fallback execute the same pure code
(`workers/compute.ts`, built on the same streaming kernels as the chart).

```
main thread                                   worker (indicator-worker.ts)
IndicatorWorkerClient ── Request (validated) ──► validateRequest → compute.ts → Response
   coalescing per channel                        cancellation checked before and after work
   stale-result rejection  ◄── Response (validated) ──
   sync fallback (same compute.ts)
```

## API

```ts
import { IndicatorWorkerClient, StaleResultError, CancelledError } from "@/lib/xchart-sdk";
const client = new IndicatorWorkerClient();          // { createWorker?, sync? }
client.usesWorker;                                   // false → fallbackReason says why
const r = await client.computeIndicators(columns, [{ id: "rsi", params: { length: 14 } }, { id: "macd", params: {} }],
  { datasetVersion: 42, channel: "NIFTY", signal });
// r = { results: [{ outputs: { value: Float64Array } } | { error }], ms, transferMs, worker }
const d = await client.computeDerived(columns, "renko", { size: 5 });   // { points, worker }
client.cancel(jobId); client.inFlight(); client.terminate();
```

## Guarantees

* **Protocol versioning and validation.** Every message carries `v: PROTOCOL_VERSION`; both sides
  validate structure, types and sizes (`validateRequest` / `validateResponse`): at most 2,000,000
  rows and 200 indicators per request, typed arrays of equal length, known message types only.
  Malformed responses are ignored, malformed requests answered with an error.
* **No code transfer.** Requests name built-in indicators by id with plain parameters; parameters
  are validated with the same `resolveParams` as the chart. No functions, scripts or `eval` cross
  the boundary.
* **Coalescing.** Per `channel`, a new request cancels the one in flight (newest wins), unless
  `coalesce: false`.
* **Stale results.** Each request carries a `datasetVersion`. A result for an older version than the
  newest requested on its channel rejects with `StaleResultError`, so out-of-order completions can
  never overwrite newer data.
* **Cancellation.** `cancel(jobId)` or an `AbortSignal` rejects the job with `CancelledError` and
  tells the worker, which skips queued work and drops the result of work already running.
* **Transfer.** Column buffers are transferred (zero-copy); `transferMs` reports the overhead.
* **Failure.** A crashed worker rejects all pending jobs; the next request starts a new worker.
  `terminate()` rejects pending jobs and makes the client unusable.
* **Fallback.** Without `Worker` (SSR, tests) or if the worker cannot start, the client computes
  synchronously and reports `worker: false` and `fallbackReason`.

Tested in Node (fallback, protocol, staleness, cancellation) and in real browsers (the
`indicator Web Worker` browser test: identical results, cancellation, stale rejection, errors,
termination).

## Limitations

* The live chart does **not** use the worker: incremental indicator updates run on the main thread
  (O(1)–O(window) per tick, see [performance.md](performance.md)). The worker is for full-history
  batch work (screeners, backtests, very large histories) driven by the application.
* The worker computes the **22 original built-ins** and the derived chart types. The 100 native
  catalog indicators and custom indicators are not available in the worker in v0.3.1.
* Bundlers that do not support `new Worker(new URL(…, import.meta.url), { type: "module" })` need
  `createWorker`.
