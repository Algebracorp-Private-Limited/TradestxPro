# MarketScan AI — scanner methodology

Routes: `/ai-intelligence/market-scan` (UI); `POST /api/intelligence/scan`, `GET /api/intelligence/scan/status`,
`GET /api/intelligence/scan/results`, `POST /api/intelligence/scan/cancel`, `GET|POST|DELETE /api/intelligence/scan/configs`,
`GET /api/cron/intelligence` (background trigger). Storage: migration `003-market-scan`.

## Jobs, not long requests

A scan is created once (idempotency key per user), stored with its queue of symbols, then advanced in
chunks of 40 symbols under a 45-second database lease. Each status poll advances one chunk; the
background trigger advances pending jobs without a browser. Concurrent advances cannot double-process
(only the lease holder works). Partial results and coverage are persisted after every chunk; a failure
marks the job failed and keeps what was done. Users can cancel; at most two scans run per user.

## Stages

| # | Stage | Implementation |
|---|---|---|
| 1 | Universe | Index constituents (NSE files) + the user's watchlists, deduplicated; indices without constituent data are listed as unavailable |
| 2 | Deterministic scan | Daily bars per symbol (batched query per chunk), provenance and freshness per symbol, market regime |
| 3 | Derivatives chains | F&O instruments: futures (Futures AI) and option strategies (Strategy AI), see `strategy-and-futures.md` |
| 4 | Candidates | Equity setup engine (breakout, trend pullback, mean reversion; extended trends wait; bearish → no cash short) |
| 5 | Constraints | Capital, risk per trade, capital per trade, minimum reward:risk, minimum liquidity, quantity, costs |
| 6 | Ranking | Transparent score (stored per result; results sorted at read time by score, R:R or symbol) |
| 7 | AI explanations | Top 5 eligible candidates; grounded in the computed numbers; deterministic fallback |
| 8 | Validation + rendering | Numeric grounding and forbidden-claim checks; regulatory presentation gate |

## Modes

* **Comprehensive** — every unique symbol is evaluated.
* **Accelerated** — first-stage shortlist from the EOD snapshot without loading bars (bullish: close >
  50-day EMA, 20-day return ≥ 0, relative volume ≥ 0.8 or ADX ≥ 20; bearish: the mirror). Symbols outside
  the shortlist are counted as **not deep-evaluated**; the UI states that this is not a comprehensive scan.

## Coverage reported

Selected (with overlap), unique, duplicates removed, unavailable universes, shortlisted, not deep-evaluated,
scanned, remaining, excluded by reason, missing-data count, stale-data count, status counts, market-data
requests, AI requests/tokens/cost, start and completion times, progress.

## Filters

Universe, horizon (swing, positional, short-term investment; intraday/scalping/BTST/STBT are accepted
but return INSUFFICIENT DATA without real-time data and intraday bars), direction, capital, risk per trade,
capital per trade, reward:risk, liquidity. Instrument filters for futures/options, margin, spread and
option buy/sell/multi-leg options are part of the configuration and are used by the F&O stage (`market-scan/fo.ts`; futures prices need migration `004-fo-futures`). Margin is never available, so the max-margin filter is not applied.
Saved configurations: up to 25 per user.

## Measured performance (synthetic benchmark)

`npm run bench:scan` (`scripts/bench-scan.ts`) seeds **synthetic** universes into a scratch database (`TEST_DATABASE_URL`, never production) and times comprehensive scans through the real job code: `createScan`, then leased 40-symbol `advanceScan` chunks.

Measured on the Phase 4 build container (Linux x64, 4 vCPU, Node 22, local Postgres 16, 2026-11-27):

| Universe (synthetic) | Instruments | Symbols scanned | Chains / contracts | Chunks | Total | Per symbol | AI requests |
|---|---|---|---|---|---|---|---|
| 50 | equity | 50 | — | 2 | 0.26 s | 5.2 ms | 0 |
| 100 | equity | 100 | — | 3 | 0.34 s | 3.4 ms | 0 |
| 200 | equity | 200 | — | 5 | 0.83 s | 4.1 ms | 0 |
| 500 | equity | 500 | — | 13 | 2.19 s | 4.4 ms | 0 |
| 2,000 | equity | 2,000 | — | 50 | 8.25 s | 4.1 ms | 0 |
| 50 | stock futures + options | 50 | 50 / 2,100 | 2 | 1.66 s | 33.3 ms | 0 |
| 180 | stock futures + options | 180 | 180 / 7,560 | 5 | 5.53 s | 30.7 ms | 0 |

**What this measures:** database and CPU time on this machine.

**What it does not measure:**
- Production database latency (Vercel ↔ the hosted Postgres region).
- Market-data provider latency: the scanner reads stored EOD data, not live feeds.
- AI cost: explanations were not requested in the benchmark. AI cost per scan is measured per job in its coverage record (`aiRequests`, `aiInputTokens`, `aiOutputTokens`, `aiCostUsd`) and depends on the configured provider and `explainTop`.

Scans on the real NIFTY 50/100/200/500 constituents and the full NSE equity and F&O lists **have not been timed on production data** from this environment.

Each chunk (40 symbols) finished well inside the 45-second lease: the slowest F&O chunk took about 1.3 s.
