# Investment AI — fundamental analysis

Status today: **no fundamentals feed exists**, so every company returns INSUFFICIENT DATA until a
dataset is imported. Nothing is estimated from prices or technical indicators.

## Data

`txp-fundamentals` v1 datasets (`lib/intelligence/fundamentals/dataset.ts`): provider attribution
(name, source, retrieval date, licence), annual periods with period end and **publication date**,
statement lines in ₹ crore, optional shareholding/pledge, governance (auditor observations, contingent
liabilities) and profile. Validation rejects missing/non-finite values, publication before period end,
duplicates and unsafe keys. Import: `scripts/import-fundamentals.ts --database-url … --file … [--apply]`
into `fundamentals_companies` (migration 003). Analyses use only periods published on or before the
analysis date (point-in-time).

## Calculations (`fundamentals/analysis.ts`)

| Area | Measures |
|---|---|
| Growth | Revenue, EBITDA, net profit, EPS year on year; revenue and EPS 3-year CAGR |
| Margins | EBITDA, operating, net |
| Cash | Operating cash flow, free cash flow (OCF − capex), cash conversion (OCF/NP), accrual ratio |
| Balance sheet | Debt/equity, net debt, interest coverage (EBIT/interest), working capital |
| Returns | ROE (NP / average equity), ROCE (EBIT / (equity + debt)), ROIC (EBIT(1−t) / (equity + debt − cash)) |
| Multiples | P/E, P/B, EV/EBITDA, EV/Sales, PEG, FCF yield, dividend yield; historical P/E and EV/EBITDA at period ends (where prices exist); peer medians (same industry in the dataset) |
| DCF | Two-stage FCFF; bear/base/bull growth; discount rate 12%, terminal growth 5%, 10 years by default — every assumption returned and overridable |
| Reverse DCF | Growth implied by the current price (bisection) |

Margin of safety = (base value − price) / base value. Entry range = bear value to 85% of base value
(restricted by the presentation gate until approved). Quality flags: weak cash conversion, thin
interest coverage, high leverage, negative FCF, pledging, auditor observations.

## AI summary

`investment.explain@1`: thesis, quality and valuation assessments, growth drivers, risks, reasons to
avoid — grounded in the computed numbers; company profile text is passed as untrusted data.
