# Phase 4 completion report: XChart Developer Platform & AI Market Intelligence

Report date: 2026-11-27. Repository: `Algebracorp-Private-Limited/TradestxPro`. XChart SDK version: **0.4.0** (not published to npm).

Everything below was produced and checked in the build environment. Where something was not done or not measured, the report says so.

---

### 1. Completed milestones

| Milestone | Pull request | Merged into main |
|---|---|---|
| 4A — Standalone XChart SDK package and developer portal | [#4](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/4) | `b3d22a9` |
| 4B — Unified market data and AI infrastructure | [#5](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/5) | `f719744` |
| 4C — AI market scanner, equity and investment intelligence | [#6](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/6) | `6273a10` |
| 4D — AI option chain and contract intelligence | [#7](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/7) (into the 4C branch) → main via #6 | `6273a10` |
| 4E — F&O scanner, Strategy AI and Futures AI | [#8](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/8) (into the 4D branch) → main via #9 | `03c4c96` |
| 4F — TradeVision AI analytical charts | [#9](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/9) | `03c4c96` |
| 4G — Trade monitoring, alerts, backtesting and performance | [#10](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/10) | `178720a` |
| 4H — Security, regulatory controls, validation, testing and release preparation | [#11](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/11) | see item 42 |

### 2. SDK package structure

`packages/xchart` is `@tradestxpro/xchart` 0.4.0, marked private.

- **Exports:** `.`, `./react` (`XChart`, `useXChart`) and `./worker`.
- **Builds:** ESM, CJS and type declarations, produced by `scripts/build.mjs`, which stages the SDK, the engine and the indicator library.
- **Examples:** vanilla JS, Node SSR, TypeScript, Next.js, Vue and Angular.
- **Package tests:** 7 integration checks (CI job `package`).
- **Also included:** README, LICENSE and CHANGELOG.

See `docs/developers/sdk-packaging.md`.

### 3. Developer portal routes

`/developers`, `/developers/getting-started`, `/developers/xchart`, `/developers/api-reference` (179 exports generated from source), `/developers/examples`, `/developers/playground`, `/developers/market-data`, `/developers/changelog`, `/developers/licensing` and `/developers/account` (organisations, projects and API keys; needs migration 001 and the `DEVELOPER_ACCOUNTS` flag).

### 4. AI Intelligence routes

**Pages:**
- `/ai-intelligence` (dashboard)
- `/ai-intelligence/market-scan`
- `/ai-intelligence/equity`
- `/ai-intelligence/investment`
- `/ai-intelligence/option-chain` (Chain Intelligence)
- `/ai-intelligence/strategy` (Strategy AI and Futures AI)
- `/ai-intelligence/tradevision`
- `/ai-intelligence/monitor` (plans, alerts, backtest, performance)

**AI View inside existing pages:**
- `/options`: AI View and Bid/Ask columns, the contract panel.
- `/options/screener`: links into Chain Intelligence.

### 5. Implemented AI engines

All the numbers come from deterministic engines. The language model only explains computed facts, and its explanations are grounded and validated.

| Engine | Module |
|---|---|
| MarketScan AI | `market-scan/` |
| Equity AI | `equity/setup.ts` |
| Investment AI | `fundamentals/` |
| Futures AI | `futures/analyze.ts` |
| OptionScan / AI View | `options/contract.ts` (`quickView`) |
| Chain Intelligence | `options/chain-analytics.ts` |
| Strategy AI | `strategy/` |
| TradeVision AI | `tradevision/` |
| Risk Intelligence | `tradevision/scenarios.ts` |
| AI Trade Monitor | `monitoring/` |
| Market regime | `technical/regime.ts` |

### 6. Supported market universes

- **Presets:** `ALL_NSE_EQUITY` (the EOD snapshot), `ALL_FO_UNDERLYINGS`, NIFTY 50/Next 50/100/200/500, the Midcap and Smallcap indices, and sectoral indices, wherever constituent data is stored.
- **Watchlists:** user watchlists can be scanned.
- **Index F&O underlyings:** NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50, SENSEX and BANKEX, where F&O rows exist.

Duplicates across universes are counted and removed. Universes with no constituent data are reported as unavailable.

### 7. Supported instrument types

- NSE cash equities.
- NSE stock and index futures (EOD bhavcopy, migration 004).
- NSE stock and index options: EOD bhavcopy, or the user's broker chain (Dhan or ICICI) when connected.

### 8. Actual market-data providers

- NSE end-of-day files: the equity bhavcopy, the F&O bhavcopy and index files, loaded by the scheduled daily job.
- ICICI security master (the instrument list).
- The user's own broker session (Dhan or ICICI) for live quotes and option chains.

No paid or licensed real-time feed is configured.

### 9. Market-data entitlements

Every record carries an entitlement tag:
- `public-eod`: NSE files;
- `user-broker-session`: live data only for the user whose broker session supplied it;
- `licensed-feed`: none configured;
- `synthetic`: tests only.

Freshness classes are real-time, delayed, eod, stale and unknown. Every UI value is labelled with its source and freshness.

### 10. Missing data dependencies

- Intraday bar history, so intraday and BTST setups return INSUFFICIENT DATA.
- Option-premium and IV history, so there is no IV rank or percentile and no historical option backtests.
- Margin data, so nothing is execution-validated.
- Corporate-action calendar and adjustments.
- A fundamentals dataset (the importer exists; no dataset is bundled).
- A licensed real-time feed for users without a broker.
- Exchange holiday calendar data: the NSE holiday list is "unverified unless loaded", and this is labelled.

### 11. Market scanner coverage

The scanner covers comprehensive and accelerated modes, uses leased 40-symbol chunks, and saves partial results.

Each job's coverage record lists:
- selected, unique and duplicate symbols;
- symbols shortlisted and not deep-evaluated;
- symbols scanned, missing data and stale data;
- exclusions by reason, and opportunities by status;
- chains retrieved and contracts evaluated;
- AI requests, tokens and cost;
- data requests and timings.

The F&O stage covers stock and index futures and option strategies. Production-data coverage has **not** been measured from this environment (see item 26).

### 12. Option-chain AI functionality

- AI View on both sides of every chain row, from one deterministic request per chain. The hover and focus card makes no AI call.
- The contract panel (click, tap or Enter) shows:
  - buy and sell plans in premium terms, with confirmation and invalidation levels on the underlying;
  - Greeks, labelled broker or model;
  - expected move and breakeven;
  - disclosures, and the AI explanation.
- Chain Intelligence:
  - charts of OI, OI change and volume by strike, the IV smile, the term structure and OI history;
  - skew, PCR and descriptive max pain;
  - contract ranking.

### 13. Contract comparison functionality

- Alternative strikes in the same expiry, ranked by buy score, with the reasons.
- The same moneyness in other expiries, from EOD data (`/api/intelligence/options/compare`).

### 14. Single-leg buying functionality

- BUY ONLY mode in Strategy AI (35 single- and multi-leg BUY_ONLY strategies).
- The option buying scan (`optionBuyingOnly`).
- Contract buy plans: entry premium band, a premium stop derived by repricing at the invalidation level, targets, time exit, lot sizing and costs.

### 15. Single-leg selling functionality

- SELL ONLY mode (33 SELL_ONLY strategies) and the selling scan (`optionSellingOnly`).
- Sell plans are **never execution-validated**, because there is no margin data.
- Disclosures always attached: unlimited loss for short calls, gap risk, margin expansion, physical settlement for stock options.
- `definedRiskOnly` blocks uncovered shorts.

### 16. Multi-leg strategy inventory

The registry holds **260** strategies (BUY_ONLY 35, SELL_ONLY 33, MIXED 192). It can be extended at run time through `registerStrategy`. The 12 strategy-builder templates are canonical members of it.

Families: singles, verticals, straddles, strangles, guts, strip and strap, iron condors and iron butterflies (plus their reverse forms), butterflies (including broken-wing), condors, ratio spreads and backspreads, jade lizard and twisted sister, calendars and diagonals, and futures combinations.

### 17. Equity trading intelligence

- Setups: breakout, trend pullback, mean reversion, extended-trend wait, and bearish NO TRADE (cash shorts are not supported).
- Each plan has an entry zone, confirmation, stop, targets, trailing rule, time exit, sizing and costs, plus a weighted score with evidence.
- AI explanation with deterministic fallback.
- Plans are independently validated (4H).

### 18. Investment intelligence

- Quality metrics, multiples, a DCF with explicit assumptions, reverse DCF and peers.
- Built from an imported `txp-fundamentals` dataset. No dataset is bundled, so without an import the result is INSUFFICIENT DATA.

### 19. Futures intelligence

- Basis, annualised carry, roll spread and a roll warning.
- A neutral price/OI pattern: no claim about who holds positions.
- An ATR plan on futures prices, never an entry from EOD data, with plan levels validated.
- Needs migration 004.

### 20. TradeVision AI charts

- Rendered on the proprietary XChart canvas.
- Shows levels, zones, the volatility range and trade-plan levels.
- Rule-selected indicators: at most 4, each with its reason.
- Optional AI notes and grounded extra levels.
- Chart-spec validator; layer toggles; JSON export; an evidence table.

### 21. Payoff calculations

- At expiry, payoff is intrinsic value minus premium. The calendar's next-expiry leg is valued with BSM.
- Results match the existing builder's `summarise()` (tested).
- Maximum loss is recomputed independently by the validator.
- Payoff curves are given for today, midway and expiry.

### 22. Scenario analysis

- P&L grids of underlying move × IV shift, for today and in 7 days.
- Pricing uses BSM on spot (the model the IVs were solved with), or Black-76 where a forward is available in the contract engine.
- Futures legs use the session's basis.

### 23. Risk calculations

- Net Greeks.
- Stress tests: ±1/2/3σ overnight gaps, ±10% moves, IV ±10 pp, one week with no move.
- The worst stress result.
- Risk flags: uncovered shorts, short volatility, negative gamma, daily decay, expiry within 3 days.

Margin is never shown, and no probability of profit is computed.

### 24. AI provider configuration

| Provider | How it is called |
|---|---|
| Anthropic | SDK, structured output, server-side fallbacks |
| OpenAI | REST, `json_schema` |
| Gemini | REST, JSON mime type |

Selected by environment keys (`docs/intelligence/ai-providers.md`). Behaviour:
- timeouts, retries and failover;
- schema validation, numeric grounding and forbidden-claims checks;
- a result cache;
- per-user and global rate limits;
- cost tracking into `ai_usage`.

**No provider key is configured** in this environment, so every explanation used the deterministic fallback.

### 25. AI cost measurements

**Not measured.** No AI provider was called from this environment. Costs are recorded per request (`ai_usage`) and per scan job, and they will be available once a key is configured.

### 26. Scanner performance

Measured on **synthetic** data in a local scratch database (4 vCPU, Node 22, Postgres 16) with `npm run bench:scan`:

| Scan | Time | Per symbol |
|---|---|---|
| Equity, 50 symbols | 0.26 s | |
| Equity, 100 | 0.34 s | |
| Equity, 200 | 0.83 s | |
| Equity, 500 | 2.19 s | |
| Equity, 2,000 | 8.25 s | about 4 ms |
| F&O, 50 underlyings (2,100 contracts) | 1.66 s | |
| F&O, 180 underlyings (7,560 contracts) | 5.53 s | about 31 ms |

**Not measured:** scans on production data (the real NIFTY 50/100/200/500, the full NSE equity list and the full F&O list), production database latency, and provider latency.

### 27. Backtesting results

- The walk-forward engine is implemented and tested: no look-ahead (tested), stop-first fills, costs, calibration.
- **Only synthetic and local-dev data were backtested.** No backtest was run on production history from this environment, so no real-market results are claimed.
- Example (synthetic SYN01, swing): 15 evaluations, 3 closed trades. Too few to mean anything.

### 28. Forward-testing results

**None yet.** Paper-plan tracking and its performance and calibration views are implemented. Results will build up once migration 005 is applied and users track plans.

### 29. Database migrations

`001-developer-accounts`, `002-intelligence-core`, `003-market-scan`, `004-fo-futures` and `005-trade-monitoring`. They are gated and checksummed, applied by `npm run db:migrate -- --database-url <url> [--apply]`.

**None has been applied to production.** They were applied to local test and dev databases only.

### 30. API inventory

All routes require authentication and a feature flag.

**Scanning and dashboard**
- `dashboard`
- `scan`, `scan/status`, `scan/results`, `scan/cancel`, `scan/configs`

**Analysis**
- `equity/analyze`, `investment/analyze`, `futures/analyze`
- `options/analyze`, `options/compare`, `option-chain/analyze`
- `strategy/analyze`, `strategy/registry`
- `tradevision` (the chart specification), `tradevision/scenario`

**Monitoring**
- `plans`, `plans/[id]`, `alerts`, `backtest`, `performance`

**Background jobs**
- `/api/cron/intelligence`: needs `CRON_SECRET` when it is set.
- `/api/cron/eod`: scheduled daily; now also runs monitoring.

**Developer accounts**
- `/api/developers`

### 31. Security findings

Covered in `docs/intelligence/security.md`.

**Fixed during Phase 4:**
- No Content-Security-Policy existed; one was added (4H).
- The strategy registry route had no flag; it now requires `EDUCATIONAL_DEMOS`.
- Costly endpoints had no per-user rate limit; one was added.
- `npm run db:migrate` pointed at a missing file.
- A flaky developer-key test.
- The equity engine threw on pre-2024 dates, which broke backtests.

**Open:**
- Rate limits are per server instance, not global.
- The CSP allows inline scripts; a nonce would remove that.
- No automated dependency or vulnerability scan runs in CI.

### 32. Regulatory dependencies

Covered in `docs/intelligence/regulatory.md`.

- **Reviews required before public activation of actionable or personalised features:** Research Analyst and Investment Adviser regulations; algorithmic-trading and broker-API rules; exchange market-data redistribution licences; advertising and past-performance rules; educational-content rules.
- **Not verified here:** the official texts could not be retrieved from this environment.
- **Flags:** `RESEARCH`, `ACTIONABLE_RECOMMENDATIONS` and `PERSONALIZED_RECOMMENDATIONS` default off. `LIVE_EXECUTION` can never be enabled.

### 33. TypeScript results

`tsc --noEmit`: 0 errors (4H branch).

### 34. ESLint results

`eslint .`: 0 errors and 0 warnings. No rules were disabled.

### 35. Unit-test results

`node --test` with a local Postgres: **312 tests, 310 passed, 0 failed, 2 skipped** (benchmarks). The database integration tests ran; they did not skip.

### 36–38. Chromium, Firefox and WebKit results

- **CI:** the `browser (chromium)`, `browser (firefox)` and `browser (webkit)` jobs passed on every merged milestone. They run the SDK's browser test suite.
- **Local page walk-throughs** (all milestones, 1440 px and 390 px) ran in **Chromium only**: no page errors and no horizontal overflow.
- **CSP check:** 21 pages in Chromium, no violations.
- **Not run:** app-page walk-throughs in Firefox and WebKit, because those browsers are not installed in this container.

### 39. Production-build results

`next build` succeeds locally. Vercel production deployments of `main` were **READY** after each merge (`b3d22a9`, `6273a10`, `03c4c96`, `178720a`).

Vercel preview deployments for PR #9 and PR #10 failed with "Resource provisioning failed" before any build started. That is a Vercel-side failure: there were no build logs, and the same commits built successfully in production.

### 40. GitHub CI links

| Milestone | Runs |
|---|---|
| 4C | [push](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46006439918) · [pull request](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46006448696) |
| 4D | [push](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46006520380) |
| 4E | [pull request](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/45996746888) |
| 4F | [push](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46007943873) · [pull request](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46007986772) |
| 4G | [push](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46014707704) · [pull request](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46014718787) |
| 4H | see PR #11 checks |

The first 4G push run [failed](https://github.com/Algebracorp-Private-Limited/TradestxPro/actions/runs/46014148688) on a flaky 4A test, which was fixed before merging.

### 41. Pull request links

| Milestone | Pull request |
|---|---|
| 4A | [#4](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/4) |
| 4B | [#5](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/5) |
| 4C | [#6](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/6) |
| 4D | [#7](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/7) |
| 4E | [#8](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/8) |
| 4F | [#9](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/9) |
| 4G | [#10](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/10) |
| 4H | [#11](https://github.com/Algebracorp-Private-Limited/TradestxPro/pull/11) |

### 42. Latest commit SHAs

| Commit | SHA |
|---|---|
| 4A | `f460bb8` |
| 4B | `a1453a5` |
| 4C | `dac17b7` |
| 4D | `56bb7d9` |
| 4E | `0187663` |
| 4F | `7f8ee36` |
| 4G | `b36e046` + test fix `5fd396d` |
| 4H | `9ca1fae` + this report |
| `main` before 4H | `178720a` |

### 43. Screenshots of implemented pages

Taken locally with **synthetic** data (SYN01) and delivered with this report, not committed:
- option chain with the contract panel;
- Chain Intelligence;
- Strategy AI (SELL ONLY);
- TradeVision with the scenario lab;
- TradeVision with indicators;
- Monitor & backtest.

Each was taken at 1440 px, and the Strategy AI, TradeVision and Monitor pages also at 390 px.

### 44. Known limitations

See `docs/intelligence/README.md#known-limitations`. In short:
- EOD data only, plus the user's broker;
- no intraday bars, IV history or margin data;
- latest-session F&O rows only;
- monitoring on EOD data;
- daily-bar backtests with survivorship bias;
- per-instance rate limits;
- the minute-level cron not scheduled (Hobby plan);
- AI explanations fall back without a provider key.

### 45. Deferred functionality

- Technical, OI, IV and AI-condition alerts, and alert notifications.
- An AI watchlist of opportunities.
- Option-premium charts and a synchronised underlying and derivatives workspace.
- Strategy optimisation search.
- Paper-trading order simulation.
- Forward-testing results.
- The regulatory prerequisites for advisory features.
- Live execution (blocked).

### 46. Production status (not unchanged)

**Production has changed.** At the repository owner's request, Phase 4 PRs #4–#10 were merged into `main`, and #11 is being merged the same way, so Vercel deployed them to production. With the default flags, the following are now live:
- **Publicly:** the developer portal pages. Developer accounts stay disabled until `TXP_FLAG_DEVELOPER_ACCOUNTS=1` and migration 001 are in place.
- **For signed-in users:** the AI Intelligence pages, with descriptive analytics, the strategy catalogue and TradeVision levels. Research outputs stay withheld while `RESEARCH` is off. Price alerts and scans need migrations 003 and 005.

These are unchanged:
- **Database migrations:** none applied to production. Features that need them report "not configured".
- **Flag defaults:** in code, `RESEARCH`, `ACTIONABLE_RECOMMENDATIONS` and `PERSONALIZED_RECOMMENDATIONS` default off and `LIVE_EXECUTION` cannot be enabled. The production environment's flag variables were not changed.
- **Production credentials:** not modified. A Vercel API token supplied by the owner was stored in the build environment, only to read deployment logs.
- **SDK:** not published to npm.
- **Subscriptions:** no paid subscriptions activated.
- **Trading:** no trades executed.
- **Phase 5:** not started.

One production side effect: a smoke check during 4G sent a `HEAD` request to `/api/cron/eod`, which ran the idempotent, lock-guarded EOD loader once outside its schedule.
