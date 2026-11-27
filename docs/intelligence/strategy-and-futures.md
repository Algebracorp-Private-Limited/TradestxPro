# F&O scanner, Strategy AI and Futures AI (Phase 4E)

Code:
- `lib/intelligence/strategy/` (`registry.ts`, `evaluate.ts`, `server.ts`)
- `lib/intelligence/futures/analyze.ts`
- `lib/intelligence/market-scan/fo.ts`

APIs:
- `/api/intelligence/strategy/analyze`
- `/api/intelligence/strategy/registry`
- `/api/intelligence/futures/analyze`
- F&O instruments in the existing `/api/intelligence/scan`

UI:
- **Strategy AI** at `/ai-intelligence/strategy`
- F&O instruments in **Market scan**

## Data

| Input | Source | Notes |
|---|---|---|
| Near-expiry option chain | User's broker chain when connected, else the latest NSE F&O bhavcopy | EOD rows have no bid/ask; IV and Greeks are computed and labelled `model` |
| Next-expiry chain (calendars, diagonals) | Latest bhavcopy | |
| Futures prices | `fo_futures`, the latest bhavcopy session | Needs migration **004-fo-futures**. Without it, futures report "futures dataset not configured" and futures legs are INSUFFICIENT DATA |
| Underlying regime, ATR | Daily bars (`candles`) | |
| Margin | Not available | Never shown, and nothing is execution-validated |

The EOD loader (`lib/eod.ts`) stores futures rows only when `fo_futures` exists. The application never creates the table.

## Strategy registry

The registry holds 260 built-in strategies, and `registerStrategy` adds more at run time. Every definition is data: legs with a side, a right (CE, PE or FUT), a strike offset in strike steps from ATM, a ratio, and an expiry (near or next).

**Families:**
- Single legs: long and short calls and puts at −4…+4 strikes.
- Verticals: 4 types × anchors −2/0/+2 × widths 1–5.
- Straddles, strangles, guts, strip and strap.
- Iron condors and reverse iron condors.
- Iron butterflies and reverse iron butterflies.
- Call and put butterflies (long, short and broken-wing).
- Condors.
- Ratio spreads and backspreads.
- Jade lizard and twisted sister.
- Calendars and diagonals.
- Futures and futures + option combinations: covered, protective, collar and synthetic.

The 12 templates of the existing strategy builder (`lib/options/strategy.ts`) are canonical members with the same ids and legs. A test checks this.

**Derived fields:**
- `classification`:
  - **BUY_ONLY**: every leg is bought.
  - **SELL_ONLY**: every leg is sold.
  - **MIXED**: both.
- `risk`: computed from the payoff slopes, not declared.
  - **undefined** when the upside slope is negative (net short calls or futures), or the downside slope is positive (net short puts or long futures).
  - **defined** otherwise.
  - Calendars count as covered.
- `multiExpiry` and `usesFutures`.

## Evaluation (`evaluateStrategy`)

1. **Build the legs.** Each leg is placed at the real ATM strike plus its offset times the strike step, at the chain's mid premium. A missing strike, premium, next expiry, futures price or lot size makes the result **INSUFFICIENT DATA**, listing what is missing. Nothing is estimated in its place.
2. **Compute the payoff at the near expiry.**
   - Near legs are valued at intrinsic value.
   - Next-expiry legs are repriced with Black-Scholes, using their IV and remaining time. This result is labelled "intrinsic + model (next expiry)".
   - The grid covers ±40% of spot plus every strike.
   - Unlimited profit or loss comes from the slope beyond the grid.
   - The left tail ends at S = 0, so a short put's loss is finite but reported as large.
   - Single-expiry results match the builder's `summarise()`. A test checks this.
3. **Compute the metrics.**
   - Net premium, maximum profit, maximum loss and reward:risk.
   - Breakevens, and the nearest breakeven in units of the 1σ expected move.
   - Net Greeks per lot.
   - Worst leg spread and the lowest open interest across the legs.
4. **Score (0–100).**
   - View fit vs the underlying regime: 35%.
   - Risk definition and reward:risk: 25%.
   - Liquidity: 20%.
   - Breakeven reach vs the expected move: 10%.
   - Vega fit to volatility expansion or contraction: 10%.
   - **A score ranks strategies. It is not a probability of profit.**
5. **Size and estimate costs.**
   - Lots = floor(per-trade risk budget ÷ maximum loss per lot). Only defined-loss strategies are sized.
   - Costs come from `risk/costs.ts`.
6. **Disclosures.** Margin is unavailable, undefined-risk strategies say so, short legs carry a margin-expansion warning, model-valued legs are flagged, and stock options note physical settlement. `executionValidated` is always false.

**Ranking.** BUY ONLY and SELL ONLY filter the registry before evaluation. Defined-risk-only, single-leg and family filters work the same way.

## Futures AI (`analyzeFutures`)

- **Pricing:**
  - Basis, and annualised carry against the underlying price of the same session.
  - Roll spread to the next month.
  - Within 3 days of expiry, a roll note says new positions belong in the next month.
- **Price/OI pattern:** described neutrally, e.g. "Price up, OI up". The conventional name is given with the statement that it does not identify who opened or closed positions.
- **Plan:**
  - Direction comes from the regime. Directions between −0.3 and +0.3 get no plan.
  - Entry trigger is ±0.25 ATR, stop is 1 ATR, targets are 1.5 and 2.5 ATR. ATR is scaled to the futures price.
  - Sizing is in whole lots within the user's risk budget. Costs use the futures segment.
- **Status:** end-of-day or delayed data never produces an entry. The status is WATCHLIST (score ≥ 50) or NO TRADE.
- **Not shown:** margin. The plan is never execution-validated.

## F&O scanner

The existing scan jobs (migration 003, leased chunks, coverage) evaluate F&O instruments selected in the configuration:
- `stock-futures` and `stock-options`, for universe symbols that have F&O data.
- `index-futures` and `index-options`, for index underlyings queued as `IDX:<underlying>`. Index bars come from `NSEIDX:<index>`.

Each job is marked `kind = 'fo'` when equity is not selected.

**Per underlying:**
- Futures produce one result (`<sym>|FUT`).
- Options produce the top 3 strategies (`<sym>|STRAT|<id>`), filtered by `optionBuyingOnly` or `optionSellingOnly` (BUY ONLY / SELL ONLY), `definedRiskOnly`, `singleLegOnly` and `multiLeg`.
- Strategy results are WATCHLIST (score ≥ 60 and sizable) or NO TRADE. The scanner's F&O data is end of day, so nothing is an entry.

**Coverage** counts `chainsRetrieved`, `contractsEvaluated`, and underlyings excluded for "no F&O data (…)".

## Presentation gate

| Flag off | What is withheld |
|---|---|
| `ACTIONABLE_RECOMMENDATIONS` | Strategy legs (strikes) and futures plan levels (`presentFutures`) |
| `PERSONALIZED_RECOMMENDATIONS` | Lots and costs |

The registry endpoint is educational: it returns structures only, with no prices.
