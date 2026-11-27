# Security review (v0.3.1)

This review covers the XChart SDK's trust boundaries as of v0.3.1. Each finding is marked
**Mitigated** (control in place and tested), **Accepted** (known, documented risk) or **Fixed in
3.1** (found and fixed during this phase).

| # | Area | Risk | Status | Control |
|---|---|---|---|---|
| 1 | Code execution | Layouts, indicator parameters, worker messages or calendar datasets carrying code | Mitigated | No `eval`, `new Function` or dynamic `import()` of user data anywhere in `lib/xchart-sdk` or the engine (checked by search). Layouts name indicators and plugins **by id only**; worker requests name built-ins by id with primitive parameters. |
| 2 | Layout import | Oversized or malicious JSON | Mitigated | `parseLayout`: ≤ 5 MB, depth ≤ 16, allow-listed top-level keys, per-collection caps (e.g. 2,000 drawings), every value re-validated by the same validators as the API; loading is atomic (invalid → nothing changes). |
| 3 | Prototype pollution | `__proto__` / `constructor` / `prototype` keys | Mitigated | Rejected in layouts (recursive), worker parameters, calendar ids; parameter objects are copied into fresh objects keyed by the definition's schema (unknown keys throw). |
| 4 | Memory / CPU exhaustion | Runaway price-based settings (tiny box sizes) | Fixed in 3.1 | `DERIVED_LIMIT`: ≤ 10,000 elements per candle and ≤ 1,000,000 in total; `setChartType` builds eagerly so the error is atomic. |
| 5 | Memory / CPU exhaustion | Worker requests | Mitigated | ≤ 2,000,000 rows, ≤ 200 indicators, ids ≤ 64 chars, typed arrays of equal length; coalescing cancels superseded jobs; `terminate()` releases the worker. |
| 6 | Memory | Undo history, checkpoints, drawings | Mitigated | Undo ≤ 100 steps; indicator checkpoints thinned to ≤ 64; polygons ≤ 64 points; text ≤ 500 chars; levels ≤ 32. |
| 7 | Worker results | Stale or forged results overwriting newer data | Mitigated | Responses validated (`validateResponse`), matched to pending job ids, rejected with `StaleResultError` when an older `datasetVersion` than the newest request on the channel; malformed messages ignored. |
| 8 | Calendar datasets | Wrong or unattributed exchange data | Mitigated | Dataset format/version, attribution (`source`, `retrievedAt`), coverage and date/time syntax validated; uncovered dates are `unknown`; failed reloads keep the previous dataset (`stale`). No holidays are hard-coded. |
| 9 | Plugins | Malicious or faulty plugin | Accepted (trusted code) / Mitigated (faults) | Plugins are application-installed code and **not sandboxed** (documented). Faults are isolated: a throwing layer or handler is caught, reported via `pluginError`, and the chart keeps rendering (browser-tested). |
| 10 | Canvas text | Script injection through labels | Mitigated | All text (titles, drawing text, axis labels) is drawn with `fillText` on canvas, never inserted as HTML. |
| 11 | Market data integrity | Fabricated or modified prices | Mitigated | Stored OHLCV is never modified; derived types, Heikin Ashi, projections and indicators are views; no candles or timestamps are invented (future slots on logical axes are unlabelled). Phase 2.1 validation (`validateTradestxproBars`, strict/tolerant) is unchanged. |
| 12 | Cleanup | Leaked listeners, observers, workers, timers | Mitigated | `chart.remove()` releases canvas, observers, listeners, indicator graph nodes and derived state (browser-tested with instrumented globals); worker clients terminate explicitly. |
| 13 | Secrets | Credentials in layouts or CI | Mitigated | Layouts contain no credentials; CI uses no secrets; no production credentials, databases or broker integrations were touched. |

## Residual risks

* Plugins run with full page privileges (by design). Only install plugins you trust.
* A custom indicator definition (`registerIndicator`) is application code and can be slow or throw;
  failures are isolated per indicator (`indicatorError`), slowness is not bounded.
* Worker computation of very large inputs within the limits can still take seconds; callers should
  pass an `AbortSignal` for user-cancellable work.
