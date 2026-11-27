# Regulatory controls and dependencies (Phase 4)

**This document is not legal advice, and a disclaimer does not make a product compliant.** The rules that apply to TradestXPro's AI Intelligence depend on how it is offered: to whom, for a fee or not, whether outputs are personalised, and whether they are actionable. A qualified securities lawyer or compliance professional must review the activated scope **before** actionable or personalised features are enabled for the public.

The official SEBI and exchange texts were **not** retrieved or verified for this document: this build environment cannot reach sebi.gov.in or the exchange websites. The instruments named below are starting points for counsel. Their current versions, amendments and circulars must be checked against the official sources.

## What the platform does today

| Capability | Default | Controlled by |
|---|---|---|
| Educational demonstrations (strategy catalogue, payoff education) | on | `EDUCATIONAL_DEMOS` |
| General market analytics: descriptive chain analytics, TradeVision levels and zones, price alerts | on | `MARKET_ANALYTICS` |
| Research outputs: setups, scores, contract and strategy rankings, backtests, paper plans | **off** | `RESEARCH` |
| Actionable levels: entry, stop, targets, strategy legs, futures plan levels | **off** | `ACTIONABLE_RECOMMENDATIONS` |
| Personalised outputs: position size from the user's capital, cost of that size | **off** | `PERSONALIZED_RECOMMENDATIONS` |
| Paper trading (simulated orders on end-of-day data; never sent to a broker) | **off** | `PAPER_TRADING` |
| Live execution | **can never be enabled**: `isEnabled("LIVE_EXECUTION")` always returns false (tested) | `LIVE_EXECUTION` |

The gate is enforced on the server (`lib/intelligence/present.ts`, `presentFutures`). When a flag is off, the restricted fields are **removed from API responses**, not just hidden in the UI.

Every intelligence route checks a flag and requires authentication. Plan-producing routes apply the gate. A static test (`tests/intelligence-safety.test.ts`) enforces both for routes added later.

**Recommended activation path:** keep `RESEARCH`, `ACTIONABLE_RECOMMENDATIONS` and `PERSONALIZED_RECOMMENDATIONS` off in production. Enable them only in approved test and research environments until the reviews below are complete.

## Areas requiring review

| Area | Why it applies | Instruments to review (verify current text) |
|---|---|---|
| **Investment research** and **stock or derivatives recommendations** | Setups with entry, stop and targets, contract and strategy rankings, and buy/sell suitability are recommendations or research if offered to users. | SEBI (Research Analysts) Regulations, 2014, as amended, and related circulars and master circulars. |
| **Research Analyst** activities | Publishing research reports or recommendations, especially for a fee. | RA registration, qualification and certification, disclosures, conflict-of-interest and record-keeping requirements. |
| **Investment Adviser** activities | Personalised advice, such as sizing from the user's capital or suitability to the user. | SEBI (Investment Advisers) Regulations, 2013, as amended: registration, risk profiling and suitability, fee rules, segregation of advice and distribution. |
| **Personalised financial recommendations** | `PERSONALIZED_RECOMMENDATIONS` sizes positions from user inputs. | As above; no risk profiling or suitability assessment exists in the platform. |
| **Algorithmic trading** | Strategy generation exists. Execution does not, and live execution is blocked in code. | SEBI circulars on retail participation in algorithmic trading and broker API usage, and the exchanges' implementation standards. Applies if any order placement is added later. |
| **Broker integration** | Users connect their own broker sessions (Dhan, ICICI) to read market data. | Broker API terms of use; exchange rules on API use; data-use permissions. Credentials stay server-side and encrypted, and are never sent to AI providers (tested). |
| **Exchange market-data redistribution** | Displaying NSE bhavcopy data and broker-sourced quotes to users. | NSE / NSE Indices data-licensing and redistribution policies, and vendor agreements for real-time or delayed data. Every value is labelled with its source and freshness, and real-time data appears only through the user's own broker session. |
| **Financial advertising** and **performance claims** | Backtests, calibration and paper-plan performance pages. | SEBI rules on advertisements by regulated entities and restrictions on past-performance claims; exchange advertising codes. Every performance view is labelled as a historical or paper sample, with intervals and limitations, and scores are never presented as probabilities. |
| **Educational content using market data** | Educational pages that use recent prices. | SEBI circulars restricting unregistered persons who use recent market data in "education" and on association with unregistered entities. Check whether an educational-only offering must use lagged data. |
| **User disclosures** | All AI pages. | The disclosures required by the registration finally obtained (RA and/or IA), on top of the platform's existing risk notices. |

## Controls implemented in code

- **Feature flags:** separate flags for each tier above, server-side.
- **Response stripping:** restricted fields are removed from responses.
- **Freshness gating:**
  - end-of-day, delayed or stale data never produces an "ENTER IF CONFIRMED" option or futures plan;
  - stale data never carries an entry status for equities;
  - intraday setups are never produced from daily bars.
- **Score language:** "scores rank; they are not probabilities of profit" appears wherever a score is shown. The AI prompt rules forbid probability and certainty claims, and grounding checks reject them.
- **No positioning attribution:** OI patterns are described without saying who holds positions. Max pain is labelled descriptive.
- **No fabricated data:** missing inputs give INSUFFICIENT DATA with the missing items listed. Margin is never shown, and nothing is "execution-validated" without margin data.
- **Independent validation:** before any plan is shown, it is checked for:
  - contract existence, expiry, strike and lot size;
  - stop and target sides;
  - Greeks recomputed from the model;
  - maximum loss recomputed independently;
  - risk constraints;
  - margin claims.

  Plans that fail are withheld (`lib/intelligence/validation/plans.ts`).
- **Audit trail:** analyses are stored immutably in `ai_analyses` (an update trigger blocks edits), with engine, prompt and data versions.

## Not implemented (blocks public activation of advisory features)

- Investor risk profiling and suitability assessment.
- Registration-specific disclosures, grievance redressal and record-retention periods required by RA/IA rules.
- Fee and billing arrangements (no paid subscriptions are active).
- Data-licence agreements for redistribution of real-time or delayed exchange data.
