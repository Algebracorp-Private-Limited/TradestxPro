# Equity AI — trading setup methodology

`lib/intelligence/equity/setup.ts` (deterministic) and `equity/explain.ts` (AI explanation).

## Gates

* Intraday, scalping, BTST, STBT: need real-time prices **and** intraday bars; the platform stores no
  intraday bars, so these return INSUFFICIENT DATA (never a plan from daily data).
* Other horizons need EOD data of the latest completed session (stale → INSUFFICIENT DATA).
* At least 60 daily bars (regime engine).

## Setups (long only)

Overnight short selling of cash equities is not available to retail traders in India, so bearish
structures return NO TRADE with that reason (derivatives scanners cover bearish views).

| Setup | Condition | Entry / confirmation | Stop | Invalidation |
|---|---|---|---|---|
| Breakout | Close above prior 20-session high on ≥ 1.5× volume | prior high to +0.3 ATR; hold/retest of the level | level − 1.2 ATR | close < level − 0.5 ATR |
| Trend pullback | Bullish trend, close within 1 ATR of EMA20 and above EMA50 | EMA20 −0.25 to +0.5 ATR; close above prior high | min(10-day low, EMA50) − 0.25 ATR | close below EMA50 |
| Mean reversion (swing) | Mean-reversion regime, RSI < 38 near the lower band | lower band ±; close back inside the band | 5-day low − 0.5 ATR | two closes below the band |
| Extended uptrend | > 1 ATR above EMA20 | WAIT FOR CONFIRMATION (pullback) | — | — |

Targets: 1.5R (capped by the 52-week high when nearer), 2.5R, 3.5R for strong trends/breakouts;
mean reversion targets the 20-day mean and the upper band. Trailing: breakeven/EMA20 after Target 1, or
2.5 × ATR chandelier. Time exit: 10 / 30 / 60 sessions by horizon.

## Status

`AVOID` when liquidity, reward:risk or position size fails the user's limits; `WATCHLIST` when the score is
below 50; `ENTER IF CONFIRMED` when price is inside the entry zone; otherwise `WAIT FOR CONFIRMATION`.
Reasons to avoid always include the EOD-data caveat and any volatility/event/cost warnings.

## Score (`lib/intelligence/scoring.ts`)

Weighted components (trend 15, structure 15, momentum 10, volatility 10, liquidity 10, positioning 10,
reward:risk 15, costs 5, data quality 10; historical validation reserved). Inapplicable components are
excluded and the rest re-normalised. **A score of 85 is not an 85% probability**: no calibrated
probability model exists; the UI shows this disclaimer with every score.

## Costs and sizing

`risk/sizing.ts`: quantity = min(risk limit ÷ stop distance, capital limit ÷ price), whole lots for
derivatives. Planned stop risk is not the maximum loss. `risk/costs.ts`: dated statutory schedules (STT,
exchange charges, SEBI fee, stamp duty, GST) with sources, overridable via `TXP_COST_SCHEDULES`; the
built-in schedule (effective 2024-10-01) is flagged for review after 180 days; brokerage (₹20/order) and
slippage (5 bps) are labelled assumptions.

## AI explanation

The model receives only computed facts. Its output must pass the schema, **numeric grounding** (every
number it writes must match a fact within 0.5%, small counts excepted; "₹2.5 crore" is checked as both
2.5 and 25,000,000) and a forbidden-claims check (guarantees, "risk-free", "x% probability"); otherwise
the deterministic explanation is shown with the reason.
