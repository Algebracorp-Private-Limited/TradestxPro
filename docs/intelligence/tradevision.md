# TradeVision AI analytical charts (Phase 4F)

Code: `lib/intelligence/tradevision/` (`spec.ts`, `zones.ts`, `annotate.ts`, `scenarios.ts`).
APIs: `/api/intelligence/tradevision`, `/api/intelligence/tradevision/scenario`.
UI: **TradeVision** at `/ai-intelligence/tradevision`.

The charts use the proprietary **XChart** engine (`lib/xchart-sdk`) through its public API:
- `createChart` and a candlestick series.
- `createPriceLine` for levels.
- `addDrawing({ type: "rectangle" })` for zones.
- `setMarkers` for markers.

No third-party chart library is used.

## Chart specification (`spec.ts`)

A chart is described by a declarative JSON spec: `{ version, instrument, timeframe, window, elements, notes }`.

**Element kinds:**
- `level`: role ∈ support, resistance, entry, stop, target, invalidation, breakeven, expected-move, max-pain, last-close.
- `zone`: role ∈ demand, supply, entry, target, expected-move, stop-area. Has `from`/`to` times; `to = null` extends the zone to the right.
- `marker`
- `indicator`: the id must be in the SDK registry (`listIndicators()`).

Every element carries `source` (engine or ai), a `label` and its `evidence`.

**Validation.** `validateChartSpec` validates every spec, both engine and AI specs:
- Unknown kinds and fields are rejected.
- Enums are whitelisted.
- Prices must be finite and within 0.5×–1.5× the window's price range.
- Times must fall inside the data window. Zones may extend at most 30 days ahead.
- Ids must be unique, with at most 80 elements.
- Labels, evidence and notes are plain text. Text that looks like markup or script (`< > { } \``, `javascript:`, `=>`, `function(`, `eval`, `on…=`) is rejected.
- **Specs are data and are never evaluated as code.**

## Deterministic annotations (`zones.ts`)

**Support and resistance:**
- Swing pivots are taken with 3 bars each side over the last 250 bars.
- Pivots are clustered within 0.5 ATR(14). A level needs at least 2 touches.
- Each level is classified relative to the last close. The nearest 6 are kept, and the evidence gives the touch count and last touch date.

**Demand and supply zones:**
- The zone is the base candle before an impulse. An impulse is a true range of at least 1.8 ATR, closing in the move's direction.
- A zone is kept only while no later close has gone through it. The nearest 2 of each kind are kept.

**Volatility range:** last close ± ATR × √(horizon sessions). This is labelled "a volatility measure, not a forecast".

**Trade plan:** entry zone, stop and targets from the equity setup engine (4C), when it produces them. These elements are withheld unless `ACTIONABLE_RECOMMENDATIONS` is on.

## AI annotation (`annotate.ts`, prompt `tradevision.annotate@1`)

The AI runs once per explicit **AI annotate** click. The AI client caches the result, and nothing runs on hover.

The model sees the engine spec as verified facts and may only:
- write a summary;
- attach notes to existing element ids;
- propose up to 4 extra horizontal levels, **at prices that already appear in the facts**.

Its output is checked in several ways:
- Notes and the summary go through numeric grounding and the forbidden-claims check. A failure falls back to the deterministic summary.
- Proposals must be grounded numerically (within 0.2% of a fact), then pass `validateChartSpec` as `source: "ai"`.
- Rejected items are listed on the page.

AI levels are drawn in their own colour and layer.

## Scenario and risk engine (`scenarios.ts`)

A position is a set of option, futures and cash legs. The scenario lab builds one from any registry strategy at real strikes (4E inputs).

Options are repriced with **Black-Scholes-Merton on spot**. That is the model the chain IVs were solved with, so a position entered at those prices shows zero P&L at no move. Futures legs move with spot plus the session's basis.

**Outputs:**
- Payoff curves for today, midway and the near expiry.
- P&L grids of underlying move × IV shift, for today and in 7 days.
- Net Greeks.
- Stress tests:
  - ±1/2/3σ overnight gaps, using 1-day σ = ATM IV/√252. The −3σ gap includes +5 pp IV.
  - ±10% moves.
  - IV ±10 pp.
  - One week with no move.
- The worst stress result.
- Risk flags: uncovered short calls or futures, short volatility, negative gamma, daily decay, and expiry within 3 days.

**Not produced:**
- Margin. It is never shown, and the page says margin is not the maximum possible loss.
- Probability of profit. None is computed.

When the broker supplies IVs, those are used as given. The zero-P&L property then holds only up to the broker's model differences.

## Workspace controls

- Layer toggles: support/resistance, demand/supply, volatility range, trade plan, AI levels, last close. Choices are kept per device in `localStorage`; the page works without it.
- **Export spec (JSON):** downloads the validated spec, including accepted AI levels.
- An elements table lists every element with its source and evidence.

## Flags

| Endpoint | Flag | Notes |
|---|---|---|
| `tradevision` | `MARKET_ANALYTICS` | Trade-plan elements need `RESEARCH` and `ACTIONABLE_RECOMMENDATIONS`. AI annotation needs `RESEARCH`. |
| `tradevision/scenario` | `RESEARCH` | Leg strikes are withheld without `ACTIONABLE_RECOMMENDATIONS`. |
