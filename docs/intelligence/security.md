# Security (Phase 4)

This covers each item in the Phase 4 application-security list (§52): what is implemented, where, and how it is tested.

| Requirement | Implementation | Verified by |
|---|---|---|
| Server-side API credentials | AI provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`), broker sessions and `CRON_SECRET` are read only on the server (`import "server-only"` modules). The browser calls only this origin; the CSP's `connect-src 'self'` enforces that. | `tests/intelligence-core.test.ts` (provider requests); CSP header |
| Authentication | Every `/api/intelligence/*` route uses `userHandler` (session required). Developer API keys are hashed (SHA-256) and shown once. | `tests/intelligence-safety.test.ts` (static check over all routes); `tests/developers-accounts.test.ts` |
| Role-based access control | Developer organisations have owner, admin, developer and viewer roles, with per-action checks (viewers cannot issue keys). Admin pages use the existing admin role. | `tests/developers-accounts.test.ts` |
| User-data isolation | Every query on scans, plans, alerts, analyses and developer data is scoped by `user_id` or membership. Another user's id returns 404, not 403, so existence is not revealed. | Integration tests: scan, monitoring and developer isolation (`intelligence-scan`, `intelligence-monitoring`, `developers-accounts`) |
| Data entitlement checks | Every record carries `entitlement` (public-eod, user-broker-session, licensed-feed, synthetic). Live chains come only from the requesting user's own broker session. | `tests/intelligence-data.test.ts` |
| Request validation | Symbols, expiries, ids and numbers are validated and clamped (`lib/intelligence/http.ts`, `sanitizeScanConfig`, `validatePlan`, `createAlert`). Unknown fields are dropped; user notes are stripped of markup. | Unit and integration tests |
| Rate limiting | Per-user token buckets on costly endpoints (`lib/intelligence/ratelimit.ts`): backtest 6/min, strategy 20/min, annotate 10/min, scenario and tradevision 30/min, analyses 60/min. A limit returns 429 with `Retry-After`. Limits are per server instance. | `tests/intelligence-safety.test.ts` (limiter and route coverage) |
| Per-user usage limits | AI per-user and global request rates and token budgets (AI client). Two concurrent scans per user. 100 open plans, 200 active alerts. 25 saved scan configs. | `tests/intelligence-core.test.ts`, `intelligence-scan`, `intelligence-monitoring` |
| Secure audit logs | `ai_analyses` is immutable (a trigger blocks UPDATE) and records engine, prompt and data versions. `ai_usage` records provider, model, tokens and cost per request. The existing `audit_logs` table records authentication events. | `tests/intelligence-core.test.ts` |
| Background-job authorisation | `/api/cron/intelligence` requires `Authorization: Bearer $CRON_SECRET` when the secret is set (it can spend AI budget). `/api/cron/eod` is idempotent, lock-guarded and only loads missing public files, so it stays public by design. | Static test |
| Secure caching | API responses are `Cache-Control: no-store`. AI result caching is keyed by prompt version and facts hash and never crosses users' private data (facts contain market data only). | `tests/intelligence-core.test.ts` |
| Error sanitisation | `handleError` returns a generic message and logs details on the server. Domain errors (`ScanError`, `MonitorError`, `DevAccessError`) carry safe messages and status codes. | Route tests |
| Cross-user leakage protection | Ownership checks in every store function. Scan results, plans and alerts are joined through `user_id`. Cron jobs process all users but expose results only to their owners. | Isolation tests |
| AI provider usage controls | Rate limits, token budgets and cost tracking; provider failover; schema validation; numeric grounding; the forbidden-claims check; deterministic fallbacks. | `tests/intelligence-core.test.ts` |
| Safe chart-specification imports | `validateChartSpec`: whitelisted kinds, fields and enums; bounded prices and times; plain-text labels (markup and script patterns rejected); registry-only indicators; element cap. **Specs are never executed.** | `tests/intelligence-tradevision.test.ts` |
| No credentials or PII to AI providers | Prompts receive computed market facts only. A test walks every facts object for user, broker, credential and identity fields. | `tests/intelligence-safety.test.ts` |
| Prompt injection | Untrusted text (company profiles and any future news) is wrapped in `<UNTRUSTED_DATA>`, with delimiter collisions neutralised and length capped. Shared rules tell the model to treat it as data. Output is schema-validated and grounded, so injected instructions cannot add numbers or claims that pass validation. | `tests/intelligence-safety.test.ts`, `tests/intelligence-core.test.ts` |

## HTTP security headers (`next.config.ts`)

- `Content-Security-Policy`:
  - `default-src 'self'`
  - `script-src 'self' 'unsafe-inline'` (for the theme bootstrap and Next.js inline payloads)
  - `connect-src 'self'`
  - `worker-src 'self' blob:`
  - `object-src 'none'`
  - `frame-ancestors 'none'`
  - `base-uri 'self'` and `form-action 'self'`
  - `upgrade-insecure-requests`
  - Vercel preview deployments also allow the Vercel toolbar origin.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone and geolocation disabled), and HSTS.
- `poweredByHeader: false`.

The CSP was checked in Chromium on 21 pages, including the XChart demo and every AI page: no violations and no page errors. Firefox and WebKit were not run against these pages in this environment.

## Known gaps

- Endpoint rate limits are per instance (in memory), not global. A shared store (Redis or Postgres) would be needed for strict global quotas.
- `script-src` allows `'unsafe-inline'`. Moving to nonces would need middleware that sets a per-request nonce.
- There is no automated dependency or vulnerability scanning in CI. `npm audit` should be run before releases.
