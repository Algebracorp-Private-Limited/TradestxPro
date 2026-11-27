# Trade monitoring, alerts, backtesting and performance (Phase 4G)

Code:
- `lib/intelligence/monitoring/` (`lifecycle.ts`, `store.ts`)
- `lib/intelligence/backtest/` (`engine.ts`, `stats.ts`)

APIs:
- `/api/intelligence/plans` and `/plans/[id]`
- `/api/intelligence/alerts`
- `/api/intelligence/backtest`
- `/api/intelligence/performance`

UI: **Monitor & backtest** at `/ai-intelligence/monitor`, with Plans, Alerts, Backtest and Performance tabs. Equity AI has a **Track this plan (paper)** button.

Storage is migration **005-trade-monitoring** (`trade_plans`, `trade_plan_events`, `price_alerts`). Like every Phase 4 migration, it is gated: it is never applied automatically. Without it, the endpoints return "storage not configured" (503).

**Paper tracking only.** No order is placed, and no broker is contacted.

## Data and schedule

Plans and alerts are evaluated on stored **end-of-day** bars (`candles`). Nothing here is real-time, and the UI says so.

The evaluation (`runMonitoring`) runs:
- at the end of the scheduled daily EOD load (`/api/cron/eod`, in `vercel.json`), on the newly loaded bars;
- on `/api/cron/intelligence`, when that route is called (it needs `CRON_SECRET` when one is set).

The job is idempotent. Each plan and alert records the last bar it processed (`evaluated_through` / `last_evaluated`), so running it twice does nothing new. It works within a time budget and picks up the oldest items first.

## Plan lifecycle (`lifecycle.ts`)

```
WATCHING ──entry zone traded──▶ ACTIVE ──stop / target / time──▶ CLOSED
   │  └──stop traded first (or gap through it)──▶ INVALIDATED
   └──not reached within entryValidSessions──▶ EXPIRED          (any open state) ──user──▶ CANCELLED
```

Daily OHLC fill rules (conservative and stated in the code):
- **Entry:** the first bar that trades into the zone. The fill is at the open if the open is inside the zone; otherwise at the zone edge reached first.
- **Both levels on one bar:** if a bar reaches both the stop and the target, the exit is the **stop**. The order within the bar is unknown.
- **Gaps:** a gap beyond a level fills at the open, not at the level.
- **Entry bar:** the entry bar can stop out. It cannot hit the target, because the path after the fill is unknown.
- **Time exit:** at the close of the N-th session held.

Results are measured in R:
- R = (exit − entry) / |entry − stop|, sign-flipped for shorts.
- Net R subtracts the plan's round-trip cost fraction (0.25% of entry by default).
- MAE and MFE are tracked in R.

Plans tracked from the engine are rebuilt on the server by the equity engine; levels sent by the client are never trusted. Tracking them requires `ACTIONABLE_RECOMMENDATIONS`. Manual plans use your own levels and need only `RESEARCH`.

## Alerts (migration 006 extends the 005 price alerts)

| Category | Instrument | Conditions |
|---|---|---|
| Price | `NSE:SYMBOL`, `NSEIDX:INDEX` | close above or below; high above; low below; daily % change above or below |
| Technical | `NSE:SYMBOL`, `NSEIDX:INDEX` | RSI(n) above or below; close crosses above or below SMA(n) or EMA(n); volume above k× its 20-day average (the current bar is excluded from the average) |
| Open interest | `FO:UNDERLYING` | Day-over-day % change in total OI across the underlying's F&O contracts (`fo_activity`). Describes OI only; nothing about who holds positions. |
| Implied volatility | `FO:UNDERLYING` | ATM IV (%) of the nearest unexpired expiry, computed (Black-Scholes) from the latest bhavcopy chain. Evaluated once per session. |
| Engine setup | `NSE:SYMBOL` | The setup engine's status is one of the chosen statuses and its score is at least the minimum (a rank, not a probability). Needs `RESEARCH`. |

The rules are in `lib/intelligence/monitoring/conditions.ts`:
- Indicators are computed on the full history, so a signal matches the chart.
- Crosses fire only on the crossing bar.
- Every alert starts after the latest data that exists when it is created, so it never fires on old bars.
- Repeat alerts stay active and record every trigger.

Limits: 200 active alerts per user. Notes are stripped of markup. Without migration 006, only price alerts are accepted (other types return 503).

## Notifications

Alert triggers, plan events (entered, stop, target, time exit, expired, invalidated) and AI-watchlist transitions write `notifications` rows.

- **In the app:** the header bell shows the unread count, and Monitor → **Notifications** lists them (mark one or all as read).
- **By e-mail (opt-in):** "E-mail me" in Notifications settings, which is off by default. After each monitoring run, one plain-text digest per opted-in user is sent through the configured mail service (Resend: `RESEND_API_KEY`, `EMAIL_FROM`). Items are marked e-mailed only after a successful send, and a failure is retried on the next run.
- **Push notifications:** not implemented.

## AI watchlist

Monitor → **AI watchlist** (`RESEARCH`) holds up to 100 symbols per user, each with a horizon.

- **Evaluation:** each symbol is evaluated when added and again on every new session by the equity setup engine, with independent plan validation.
- **Notification:** sent when a symbol *newly* reaches "enter if confirmed" or "wait for confirmation".
- **Levels:** setup details pass through the presentation gate, so plan levels are withheld unless `ACTIONABLE_RECOMMENDATIONS` is on.

## Backtesting (`backtest/engine.ts`)

The backtest is a walk-forward run of the equity setup engine on one stock's stored daily history, up to 1,500 bars.

1. At each evaluation date t (every `step` sessions after a 220-bar warm-up), the engine sees **only bars[0..t]**, with an end-of-day provenance dated t.
2. Signals with entry, stop and target levels become paper plans and are simulated with the lifecycle rules on bars after t.
3. One position is held at a time, so signals don't overlap.

A test checks that there is no look-ahead: the trades closed before a date are identical when the data is cut at that date.

The result also lists:
- the signals that were **not** traded, with the reason: expired, invalidated, still open at the end of the data, or an engine status without plan levels, such as "wait for a pullback";
- `truncated`, when the evaluation cap stopped the run early.

**Limitations, reported with every result:**
- daily bars only (stop-first rule);
- fill rules, not a liquidity model;
- flat costs;
- survivorship bias from today's symbol list;
- the results describe this sample only.

Statutory cost schedules start at IN-2024-10. For earlier dates the engine **omits** its rupee cost estimate and lists the missing schedule, instead of applying later rates. The backtest uses its own stated cost fraction.

## Statistics and calibration (`backtest/stats.ts`)

- **Trade statistics:**
  - win rate (net R > 0), with a Wilson 95% interval;
  - average gross and net R, profit factor, and maximum drawdown in R;
  - average holding period, and exits by reason;
  - a cumulative net-R curve.
- **Calibration:**
  - outcomes grouped by engine score (0–49, 50–59, 60–69, 70–79, 80–100), with the sample size, win rate, Wilson interval and average net R;
  - buckets with fewer than 10 trades are shown greyed out;
  - "monotonic" is stated only when at least two buckets have 10 or more trades.

  The text on every view says these are observed frequencies in a sample, **not probabilities**, and that a score is a rank.
- **Performance:** applies the same statistics to your closed paper plans, overall and split between engine and manual plans, plus calibration of your engine plans.

## Flags

| Endpoint | Flag |
|---|---|
| plans, backtest, performance | `RESEARCH` |
| alerts (setup alerts need `RESEARCH`), notifications | `MARKET_ANALYTICS` |
| AI watchlist | `RESEARCH` |
| Tracking engine plans; showing engine plan levels in the list | `ACTIONABLE_RECOMMENDATIONS` |
