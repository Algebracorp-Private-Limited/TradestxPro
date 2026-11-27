# Paper trading (`/ai-intelligence/paper`)

Code: `lib/intelligence/paper/` (`engine.ts` is pure; `store.ts` uses the database). API: `/api/intelligence/paper`. Storage: gated migration **007-paper-trading** (`paper_accounts`, `paper_orders`, `paper_positions`, `paper_fills`). The feature flag is **`PAPER_TRADING`**, off by default.

**This is a simulation.** No order is ever sent to a broker. `LIVE_EXECUTION` cannot be enabled.

## Instruments

| Kind | Format | Price source |
|---|---|---|
| Cash equity | `NSE:SYMBOL` | Daily OHLC from the equity bhavcopy (`candles`) |
| Future | `FUT:UNDERLYING:YYYY-MM-DD` | Session close from the F&O bhavcopy (`fo_futures`, migration 004) |
| Option | `OPT:UNDERLYING:YYYY-MM-DD:STRIKE:CE\|PE` | Session close from the F&O bhavcopy (`fo_contracts`) |

## Order rules

- **No back-filling:** an order fills only on data **after** the session it was placed against.
- **Equity market orders:** fill at the next session's open.
- **Equity limit orders:** a buy fills on the first session whose low is at or below the limit, at min(open, limit). A sell fills on the first session whose high is at or above the limit, at max(open, limit).
- **F&O orders:** only closes are stored, so a market order fills at the next session's close. A limit order fills when that close is at or better than the limit.
- **Expiry of unfilled orders:** after `validSessions` sessions (1–30, default 5) without a fill.
- **F&O quantity:** must be a multiple of the lot size.
- **Equity shorts:** cash equities cannot be sold short. This is checked when placing (against the position and open sell orders) and again at fill time.
- **Cash check:** the fill is rejected if paper cash would go negative.
- **Costs:** the statutory schedule (`risk/costs.ts`) is charged on every fill.
- **Margin:** not simulated. Short options and futures are allowed and flagged.

## Accounting

- **Positions:** signed quantity with an average price. Realised P&L is booked on reductions, and a flipped position reopens at the fill price.
- **Cash:**
  - equities and option premiums move cash by their full value;
  - futures move cash only by realised P&L (no notional debit).
- **Expiry settlement:** F&O positions past expiry settle at the **expiry-day close of the underlying**. Futures settle at that price; options at their intrinsic value.

  This is simplified: stock F&O is physically settled on the exchange, but the simulation settles it in cash. Settlement waits until that day's close has been loaded.
- **Account equity:**
  - cash;
  - plus equity and option positions at their latest stored close (shorts count negative);
  - plus open futures P&L.

  Total P&L = equity − starting cash.

## Processing

`runPaper` runs inside the daily monitoring job (after the EOD load). For each run:
1. It processes open orders.
2. It settles expired positions.
3. It writes a notification for each fill or rejection.

The account can be reset to a chosen starting cash (₹10,000 to ₹100 crore), which deletes all paper orders, positions and fills.

## Limitations

- **Daily data only.** Fills don't reflect intraday prices, queue position or liquidity.
- **F&O history:** only the latest session is stored. If the daily job misses a session, an F&O order fills at the next session the job sees.
