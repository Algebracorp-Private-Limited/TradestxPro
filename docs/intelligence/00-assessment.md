# Phase 4 pre-implementation assessment

Date: 2026-11-27. Baseline: `main` at `745180c` (merge of PR #3, XChart SDK v0.3.1).

## Baseline verification

| Item | Result |
|---|---|
| Phase 3.1 PR | Algebracorp-Private-Limited/TradestxPro#3 merged 2026-11-27 06:59 UTC as `745180c` |
| Phase 3.1 CI | `quality`, `browser (chromium/firefox/webkit)` passed on `9a801b8` / `a053bfe` (same tree as the merge). The XChart workflow does not run on pushes to `main`. |
| Production deploy | Vercel production deployment of `745180c` completed |

## Existing capabilities (reused, not duplicated)

| Area | Location | Notes |
|---|---|---|
| XChart SDK v0.3.1 | `lib/xchart-sdk/` | 122 incremental indicators, derived chart types, drawings, scales, panes, sync, worker, calendar providers |
| Canvas engine | `components/chart/engine.ts` | Proprietary; used directly by `/charts` (ChartTerminal) and through the SDK |
| Indicator maths | `lib/ta/catalog.ts`, `lib/ta/indicators.ts` | Production indicator library (bitwise-equal to SDK built-ins) |
| AI analysis | `lib/analysis.ts`, `lib/analysis-rules.ts`, `/api/ai/analysis`, `components/ai-analysis.tsx` | Anthropic (Claude) narrative over deterministic rule facts; rules fallback; 15-min cache; per-user rate limit |
| Stock screener | `lib/screener.ts`, `screener_snapshot` table, `/screener` | EOD technical snapshot (EMA/RSI/MACD/ADX/ATR/Supertrend/returns/beta) |
| Option screener | `lib/option-screener.ts`, `fo_contracts` table, `/options/screener` | Latest F&O bhavcopy session only (no per-contract history kept) |
| Option chain | `lib/options/chain.ts`, `/api/options/chain`, `components/options/options-terminal.tsx` | Live legs only through the user's connected broker (Dhan or ICICI Breeze); otherwise structure only |
| Option maths | `lib/options/bs.ts`, `lib/options/strategy.ts` | Black-Scholes price/Greeks/IV, PCR, max pain, 12 strategy templates, expiry payoff, BS mark-to-model |
| Strategy builder | `components/options/strategy-builder.tsx`, `/options/strategies` | Template-based single-expiry builder |
| Market data | NSE EOD bhavcopies (equity, index, F&O) via `/api/cron/eod`; ICICI security master via `/api/cron/instruments`; broker quotes per user (`lib/brokers/quotes.ts`); Delta Exchange (crypto, live) | No fundamentals, no corporate filings, no historical option premiums beyond the latest session |
| Instruments | `instruments`, `derivative_contracts` tables (ICICI security master: lot size, tick size, expiry, strike) | Verified reference data source for lot sizes and expiries |
| Index constituents | `index_constituents` table from NSE published CSVs (`lib/constituents.ts`) | Current constituents only (not point-in-time) |
| Brokers | `lib/brokers/*`: ICICI, Kotak, Dhan, Zerodha, Upstox, Angel, Fyers adapters; credentials AES-256-GCM encrypted | Quotes and option chains only; no order placement |
| Auth | Email OTP, session cookie, `userHandler` (CSRF origin check, JSON bodies), audit log | No roles beyond an admin allow-list (`lib/admin.ts`) |
| Database | `lib/schema.ts` applied automatically on first DB access when its hash changes | **Phase 4 tables must not go into `SCHEMA_SQL`**, or a deploy would migrate production. They live in separately gated migrations. |
| Background jobs | Vercel cron (daily instruments + EOD), `job_locks` leases | No queue; long work must be chunked and resumable |
| Navigation | `components/terminal-nav.tsx` (`LIVE_LINKS`), terminal layout requires login | |

## Data gaps that constrain Phase 4 (reported, not hidden)

1. **Fundamentals** (statements, ratios, shareholding, filings): no source exists. Investment AI must return
   INSUFFICIENT DATA until a licensed dataset is imported.
2. **Historical option premiums / OI / IV**: only the latest F&O session is stored. History can only start
   from data actually ingested (NSE F&O bhavcopy archives are a public EOD source already used by the EOD job).
3. **Real-time data** exists only through each user's own broker session (entitlement = that user). Without a
   broker, everything is EOD and must be labelled so; intraday setups must not be produced from EOD prices.
4. **Margin data**: no SPAN/exposure margin source; margin-dependent checks are marked "not execution-validated".
5. **Point-in-time index constituents and historical lot sizes**: not stored; backtests cannot claim
   survivorship-bias-free results until they are.
