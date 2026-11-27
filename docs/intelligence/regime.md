# Market regime engine

`lib/intelligence/technical/regime.ts` — deterministic, built on the production indicator library.

Inputs: daily high/low/close (≥ 60 bars, otherwise INSUFFICIENT DATA), optional volume, optional
context (breadth %, IV percentile, relative strength, scheduled event, liquidity threshold).

| Measure | Use |
|---|---|
| Close vs EMA 20/50/200, EMA50 slope | trend structure |
| ADX(14), +DI/−DI | trend strength and direction agreement |
| ROC(20), RSI(14) | momentum |
| Prior 20-bar high/low + relative volume ≥ 1.5 | breakout / breakdown |
| EMA20 crossings in 40 bars with ADX < 20 | mean reversion |
| ATR14/ATR50, Bollinger bandwidth percentile | volatility expansion / contraction |
| Realised-vol (or IV) percentile | high / low volatility |
| Median 20-day traded value | illiquid (default < ₹5 crore) |

The direction score is a weighted vote of 6–8 independent conditions. "Strong" trends need a score
≥ 0.7 **and** ADX ≥ 25; conflicting signals (structure up but −DI dominant, or the reverse) yield
"Uncertain market". Output: primary regime, flags, confidence, direction, evidence (each with its
numbers), indicators used and metrics.
