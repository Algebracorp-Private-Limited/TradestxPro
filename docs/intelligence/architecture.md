# TradestXPro AI Intelligence — architecture

```
lib/intelligence/
  core/            types (provenance, statuses, INSUFFICIENT DATA), freshness rules, staged pipeline, JSON-schema validation
  ai-providers/    provider abstraction (Anthropic, OpenAI, Gemini, mock), AIClient (timeouts, retries, cache,
                   rate limits, cost, deterministic fallback), versioned prompts, untrusted-text fencing
  instruments/     unified instrument master (pure normalisation of the synced reference data)
  market-data/     capability register, database-backed data with provenance, live broker data (server-only)
  technical/       market regime engine
  audit/           AI usage + immutable analysis records
  server.ts        server entry: shared AI client with usage persisted
```

## Principles

1. **Deterministic first.** Every number (indicators, levels, sizes, payoffs, Greeks) is computed by
   code. The language model only explains verified facts, and its output is validated (schema +
   semantic checks against the facts) before use; otherwise a deterministic fallback is shown.
2. **Provenance everywhere.** Each data record carries source, exchange time, received time, age,
   freshness (`real-time | delayed | eod | stale | unknown`), entitlement, missing fields and
   validation status (`core/freshness.ts`).
3. **No fabrication.** Missing inputs produce `INSUFFICIENT DATA` with the list of what is missing;
   the capability register (`market-data/capabilities.ts`) says which feeds exist.
4. **Freshness gates.** Intraday setups require real-time data (`usableForIntraday`); EOD data is only
   used for swing/positional/investment horizons and is labelled "End of day".
5. **Immutability.** Stored analyses cannot be updated (database trigger); corrections are new rows.
6. **Isolation.** Live data comes from the requesting user's own broker session and is never shared;
   stored analyses are read with the requesting user's id only.

## Processing pipeline (`core/pipeline.ts`)

Stages run in order with per-stage reports (in/out counts, errors per item, notes, timing),
bounded concurrency for per-item work, progress callbacks and cancellation between items.
A failing item is recorded and skipped; it never aborts the run. The scanner (4C) maps the
specification's 17 steps onto these stages.

## Database

Phase 4 tables are in `lib/migrations` (001 developer accounts, 002 intelligence core, …), applied only
by an operator with `scripts/migrate.ts --database-url … --apply`. Features check for their tables and
degrade to "not configured" when absent. `lib/schema.ts` (auto-applied) is unchanged.
