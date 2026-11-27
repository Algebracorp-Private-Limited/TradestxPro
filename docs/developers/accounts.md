# Developer account architecture

Status: **implemented, tested, switched off.** Enable with `TXP_FLAG_DEVELOPER_ACCOUNTS=1` after an
operator applies migration `001-developer-accounts` (see `scripts/migrate.ts`). No billing exists.

## Data model (migration 001)

| Table | Purpose |
|---|---|
| `dev_organizations` | Developer organisations (created by a signed-in TradestXPro user) |
| `dev_members` | Membership and role: owner, admin, developer, viewer |
| `dev_projects` | Projects with an optional https origin allow-list |
| `dev_api_keys` | API keys: public prefix + SHA-256 hash only; expiry, revocation, rotation link, per-key rate limit |
| `dev_api_usage` | Per-key, per-minute request and rejection counters (35-day retention, `pruneUsage`) |
| `dev_sdk_entitlements` | SDK licence records: evaluation / commercial / enterprise; granted by administrators |
| `dev_support_requests` | Support requests per organisation |

## Rules (enforced in `lib/developers/accounts.ts`, tested on Postgres)

* Every operation checks the caller's role in the organisation; non-members get **404** (no probing of ids).
* Keys: `xck_<12-char prefix>_<256-bit base64url secret>`, shown once; constant-time hash comparison;
  unknown, wrong, expired and revoked keys get the same 401.
* Rotation issues a replacement and expires the old key after 24 hours; revocation is immediate (admin+).
* Rate limit per key per minute; excess requests return 429 and are counted as rejected.
* Requests need an active SDK entitlement (403 otherwise) and, when configured, an allowed origin.
* Limits: 5 owned organisations per user, 20 projects per organisation, 5 active keys per project.
* Organisation, project and key events are audited.

## Licensing separation

Entitlements are for the SDK only. Exchange market-data rights are never granted, implied or tracked here.

## API

`/api/developers` (signed in): `GET ?resource=orgs|projects|keys|usage`, `POST { action: createOrg | createProject | issueKey | rotateKey | revokeKey }`.
Returns 404 while the flag is off and 503 until the migration is applied.
