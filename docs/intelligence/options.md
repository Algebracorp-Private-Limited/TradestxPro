# Option chain and contract intelligence (Phase 4D)

Code: `lib/intelligence/options/` (`pricing.ts`, `contract.ts`, `chain-analytics.ts`, `inputs.ts`, `server.ts`, `explain.ts`).
APIs: `/api/intelligence/option-chain/analyze`, `/api/intelligence/options/analyze`, `/api/intelligence/options/compare`.
UI: the **AI View** columns in the option chain (`/options`), the contract panel, and **Chain Intelligence** (`/ai-intelligence/option-chain`).

## Data sources

| Source | When | What is missing |
|---|---|---|
| User's broker chain (Dhan / ICICI) | broker connected | depends on the broker; Greeks are labelled `broker` when supplied |
| NSE F&O bhavcopy, latest session | otherwise | bid/ask, IV, Greeks (computed and labelled `model`), intraday data |

Freshness follows `core/freshness.ts`. EOD chains are labelled end-of-day everywhere, and an EOD or delayed
chain never yields an `ENTER IF CONFIRMED` plan (`usableForIntraday` needs real-time data). The page says
"confirm the live quote before acting".

Not available, so never shown: historical IV (no IV rank or percentile; `ivRank` is `null` with a note), margin
(sell plans have `requiredMargin: null` and are never execution-validated), and historical per-strike OI. OI
history comes only from stored `fo_activity` daily rows. Nothing is reconstructed from the current snapshot.

## Pricing models (`pricing.ts`)

NSE index and stock options are European-style.

- **Black-Scholes-Merton** on spot `S` with dividend yield `q`:
  `d1 = (ln(S/K) + (r − q + σ²/2)T) / (σ√T)`, `d2 = d1 − σ√T`,
  `C = S e^{−qT} N(d1) − K e^{−rT} N(d2)`, `P = K e^{−rT} N(−d2) − S e^{−qT} N(−d1)`.
- **Black-76** on the futures/forward price `F` of the same expiry (used when `forward` is supplied):
  `d1 = (ln(F/K) + σ²T/2) / (σ√T)`, `C = e^{−rT}(F N(d1) − K N(d2))`, `P = e^{−rT}(K N(−d2) − F N(−d1))`.

`r` defaults to 6.5% and `q` to 0. Both are inputs, not statutory constants. Outputs are theoretical estimates, never executable quotes.

### Greeks conventions

- Delta: per ₹1 move in the underlying (Black-76 delta is with respect to F: `e^{−rT}N(d1)` for calls, `−e^{−rT}N(−d1)` for puts).
- Gamma: per ₹1, squared.
- Theta: per **calendar day**.
- Vega: per **1 percentage point** of volatility.
- Rho: per **1 percentage point** of rate.
- Implied volatility: solved by bisection from the mid price (bid/ask mid when both exist, else LTP).

The tests check these against textbook reference values (Hull) and finite differences.

## Contract metrics (`metrics`)

For each contract, `metrics` reports:

- Premium, bid/ask, spread (₹ and % of mid), volume, OI and OI change.
- IV with its source, the Greeks with their source, intrinsic and extrinsic value, and days to expiry.
- Moneyness: ATM within half a strike step. "Deep" means beyond the larger of three steps or 5% of spot.
- Expiry breakeven, and decay (`|θ| / premium` per day).

**Expected move**: ATM IV × spot × √T (±1σ under a lognormal assumption), alongside the ATM straddle price.

## AI View (`quickView`)

`quickView` is a deterministic score with no language model. The option-chain page requests every contract's view in
one call per underlying and expiry. Hover and focus cards read those cached views, so **no model request is made on hover**.

- **Buy score (0–100):** direction fit with the underlying regime 35%, delta in the 0.35–0.65 band 20%, decay 20%, IV relative to ATM 10%, and liquidity (spread, OI, volume) 15%. The score is halved inside 2 days to expiry.
- **Sell score:** opposite direction fit, delta 0.15–0.35, high decay, rich IV, and liquidity.
- **Label:** Buy setup / Sell setup / Neutral / Avoid / No data.

Scores rank contracts. **They are not probabilities of profit**, and the UI says so wherever a score appears.

## Contract analysis (`analyzeContract`)

### Buy plan

- Entry premium band: bid to ask, or 97%–101% of the mid when there is no quote.
- Underlying confirmation: spot ± 0.25 ATR on a closing basis.
- Invalidation: −1 ATR.
- Premium stop, target and additional target: the option is **repriced** at the invalidation and target levels (+1.5 ATR and +2.5 ATR) with the current IV and less time remaining.
- Time exit, planned risk and reward per lot, sizing within the user's limits, and estimated costs (`risk/costs.ts`).
- Status is `AVOID` when the regime does not favour the side, the reward-to-risk is below the user's minimum, or the size rounds to 0.

### Sell plan

- **Never execution-validated** and `requiredMargin: null`, because there is no margin data.
- Maximum theoretical loss: "Unlimited" for short calls; strike minus premium per lot for short puts.
- Disclosures are always attached: gap risk, margin expansion, and physical settlement for stock options.
- `definedRiskOnly` blocks uncovered shorts and points to spreads.

### Alternatives and explanation

- Alternatives are other strikes of the same expiry, ranked by buy score. A strike is marked preferred only when it scores more than 5 points higher.
- Other expiries at the same moneyness are shown by `/options/compare`, from EOD data.
- The AI explanation (`options.contract@1`) is grounded on the computed facts and falls back to a deterministic text. Numbers it introduces are rejected by `validation/grounding.ts`.

### Presentation gate

Plan levels are shown only when `ACTIONABLE_RECOMMENDATIONS` is on, and quantities only when `PERSONALIZED_RECOMMENDATIONS` is on (`present.ts`). Otherwise the analysis is educational.

## Chain Intelligence (`chainAnalytics`, `termStructure`)

All of these are descriptive:

- Totals and PCR by OI and by volume.
- The three largest OI strikes per side, with their share.
- OI, OI-change and volume by strike, and the IV smile.
- Skew: OTM put IV minus OTM call IV, using the strikes nearest ±5% from spot.
- Gamma × OI by strike, and expected move.
- Max pain: "descriptive statistic of open interest; not a reliable price prediction".
- Contract ranking (top 10).
- Term structure: ATM IV per expiry from the latest bhavcopy.

**Positioning is never attributed.** OI does not reveal who is long or short, so no institutional or dealer positioning is inferred, and the text says so.

## Option workspace (`/ai-intelligence/workspace`)

Four XChart panes with linked time range and crosshair (`syncCharts`):

- **Underlying** candles (broker intraday, or NSE end-of-day files for 1D), with the contract's levels:
  strike, expiry breakeven, ±1σ expected move and the plan invalidation.
- **Option premium** candles for the selected contract. Premium history comes only from a connected
  broker (Dhan or ICICI Direct); without one the pane shows INSUFFICIENT DATA and nothing is synthesised.
  Entry, stop and target lines appear only when the contract plan passes the presentation gate.
- **Model IV** and **extrinsic value** (`workspace/premium.ts`): each premium bar is matched to the
  underlying bar with the same timestamp; intrinsic = max(0, S−K) or max(0, K−S), extrinsic = premium −
  intrinsic, IV is solved from the premium with Black–Scholes. Unmatched bars and failed IV solves are
  left as gaps and counted. These are model values, not exchange-reported IV.

Endpoint: `GET /api/intelligence/workspace?u=&expiry=&strike=&right=CE|PE&tf=5m|15m|1h|1D` (RESEARCH flag,
rate-limited). Open it from a contract panel with **Open charts**.

## Feature flags

| Endpoint | Flag |
|---|---|
| `option-chain/analyze` | `MARKET_ANALYTICS` (default on). The per-contract views also need `RESEARCH`; without it the AI View column shows "—". |
| `options/analyze`, `options/compare` | `RESEARCH` |
