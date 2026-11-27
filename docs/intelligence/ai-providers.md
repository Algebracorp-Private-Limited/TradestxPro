# AI provider configuration

| Variable | Meaning | Default |
|---|---|---|
| `AI_PROVIDERS` | Provider order, comma-separated (`anthropic`, `openai`, `gemini`) | `anthropic` |
| `ANTHROPIC_API_KEY` / `AI_MODEL_ANTHROPIC` | Anthropic key / model | model `claude-opus-5-5` (already used in production) |
| `OPENAI_API_KEY` + `AI_MODEL_OPENAI` | OpenAI (both required; no model is assumed) | off |
| `GEMINI_API_KEY` + `AI_MODEL_GEMINI` | Google Gemini (both required) | off |
| `AI_PRICING` | JSON `{ model: { input, output } }` USD per million tokens | Claude Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 |
| `AI_USER_PER_MINUTE` / `AI_GLOBAL_PER_MINUTE` | Token-bucket rate limits | 10 / 120 |
| `AI_TIMEOUT_MS` | Per-attempt timeout | 45000 |
| `AI_DISABLED=1` | Every call uses its deterministic fallback | — |

Keys are read on the server only and never reach the browser. Nothing is activated without its key
(and, for OpenAI/Gemini, an explicit model).

## Behaviour (`ai-providers/client.ts`)

1. Rate limits (per user, global) → fallback when exceeded.
2. Response cache keyed by providers, prompt id/version/hash and the rendered input (15 min).
3. Providers in order; each attempt has a timeout; retryable failures (429, 5xx, timeouts, network)
   are retried with exponential backoff; non-retryable ones (refusal, 4xx) move to the next provider.
4. Output: JSON extracted, validated against the prompt's schema (including numeric/length bounds
   stripped from the wire schema), then the caller's semantic checks (e.g. numbers must match the
   deterministic facts). Invalid output is a failed attempt.
5. Everything failed / nothing configured → the caller's deterministic fallback, with the reason.

Every attempt produces a usage record (provider, model, prompt version, tokens, cost, latency,
outcome) stored in `ai_usage` when migration 002 is applied (`usageSummary` for monitoring).

## Anthropic specifics

Official SDK; `output_config.format: { type: "json_schema" }` structured outputs; `effort: "medium"`;
server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) so a
policy decline can be served by another model in the same call; `response.model` records the model
that actually answered. SDK retries are disabled (the client retries).

OpenAI and Gemini adapters implement their documented REST request shapes and are unit-tested with
a fake transport; they have not been exercised against the live services.

## Prompts

`ai-providers/prompts.ts`: prompts are registered with id + version; their content hash is recorded
with each analysis. Shared rules forbid inventing numbers, require "NO TRADE"/"INSUFFICIENT DATA"
when appropriate, and forbid presenting scores as probabilities. Untrusted text (news, filings, user
notes) is passed only inside `<UNTRUSTED_DATA>` blocks; closing tags inside the text are neutralised.
