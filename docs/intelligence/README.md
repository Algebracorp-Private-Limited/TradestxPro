# AI Intelligence documentation (Phase 4)

| Topic | Document |
|---|---|
| Pre-implementation assessment | [00-assessment.md](00-assessment.md) |
| Architecture and processing pipeline | [architecture.md](architecture.md) |
| AI provider configuration | [ai-providers.md](ai-providers.md) |
| Market-data requirements, instrument master, freshness | [market-data.md](market-data.md) |
| Market regime engine | [regime.md](regime.md) |
| Scanner methodology and measured performance | [scanner-methodology.md](scanner-methodology.md) |
| Equity research methodology | [equity-research.md](equity-research.md) |
| Fundamental analysis | [fundamental-analysis.md](fundamental-analysis.md) |
| Option-chain analysis, contract ranking, Greeks formulas, pricing models | [options.md](options.md) |
| Strategy selection, payoff formulas, Futures AI, F&O scanner | [strategy-and-futures.md](strategy-and-futures.md) |
| Chart specification schema, TradeVision, scenarios and risk calculations | [tradevision.md](tradevision.md) |
| Monitoring architecture, backtesting methodology, performance evaluation | [monitoring.md](monitoring.md) |
| Security | [security.md](security.md) |
| Regulatory dependencies and market-data licensing | [regulatory.md](regulatory.md) |

Developer platform: [`docs/developers/`](../developers). XChart: [`docs/xchart/`](../xchart).

## Database migrations (gated, never auto-applied)

| Id | Tables |
|---|---|
| `001-developer-accounts` | `dev_organizations`, `dev_members`, `dev_projects`, `dev_api_keys`, `dev_api_usage`, `dev_sdk_entitlements`, `dev_support_requests` |
| `002-intelligence-core` | `ai_usage`, `ai_analyses` (immutable) |
| `003-market-scan` | `scan_jobs`, `scan_results`, `scan_configs`, `fundamentals_companies` |
| `004-fo-futures` | `fo_futures` |
| `005-trade-monitoring` | `trade_plans`, `trade_plan_events`, `price_alerts` |

To preview changes (dry run, the default), then apply them after review:

```
npm run db:migrate -- --database-url <url>            # dry run
npm run db:migrate -- --database-url <url> --apply
```

The migrator checksums each applied migration and refuses to run if an applied one has been edited.

## Known limitations

**Data**
- **Data coverage:**
  - End-of-day NSE data, plus live data only through the user's own broker session.
  - No intraday bar history, so intraday or BTST setups return INSUFFICIENT DATA.
  - No option-premium or IV history, so there is no IV rank or percentile and no historical option backtests.
  - No margin data, so nothing is execution-validated and short or undefined-risk plans are never "ready".
  - No corporate-action adjustments beyond the stored series.
  - Fundamentals only from an imported `txp-fundamentals` dataset (none is bundled).
- **F&O history:** contract-level F&O rows (`fo_contracts`, `fo_futures`) keep the latest session only. OI history is per underlying (`fo_activity`).
- **Monitoring and alerts:** evaluated on end-of-day bars after the daily load, not in real time.

**Methods**
- **Backtests:**
  - daily bars with conservative fill rules (stop first);
  - a flat cost fraction;
  - survivorship bias (today's symbol list).
- **Performance figures:** paper plans only, not brokerage P&L.
- **Calibration:** reports observed frequencies; small samples are flagged.
- **Rate limits:** per server instance, not global.

**Operations**
- **Background work:** the minute-level intelligence cron is not scheduled (the Vercel Hobby plan allows daily crons). Scans advance through status polling or an external scheduler; monitoring runs after the daily EOD job.
- **AI explanations:** need a configured provider key. Without one, every explanation uses the deterministic fallback, and that is labelled.

## Deferred (not implemented in Phase 4)

**Alerts and monitoring**
- Technical, OI, IV and AI-condition alerts (only price alerts exist).
- E-mail or push notifications for alerts.
- An "AI watchlist" of engine opportunities beyond tracked plans and alerts.

**Charts and option workspaces**
- Option-premium analytical charts.
- A synchronised underlying + derivatives chart workspace.
- Strategy optimisation by search over strikes and expiries (ranking covers the registry at ATM-relative strikes).

**Trading and research tiers**
- Paper-trading order simulation (`PAPER_TRADING`).
- Live execution (blocked in code).
- Forward-testing results (tracking exists; no results have accumulated).
- Regulatory prerequisites for public advisory features (see [regulatory.md](regulatory.md)).
