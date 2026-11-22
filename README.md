# TradestXPro

AI-powered Indian market intelligence terminal for NSE, BSE, F&O, MCX and FX.
Built in phases per the *TradestXPro Master Blueprint & SOP* (v1.0).

**Live:** P1 Foundation (landing page, pricing, email-OTP signup, login, sessions, dashboard).
**Live (P3, early):** an in-house canvas chart engine (candles, Heikin-Ashi, bars, line and area; zoom, pan, crosshair; trend line, horizontal line, rectangle and Fibonacci drawing tools), a 22-indicator technical-analysis library, **XScript Lab** (a sandboxed scripting language for custom indicators and signals, with scripts saved per user), a Markets page with an index chart for all ~169 NSE indices, and a Stock Screener with presets. Data: NSE end-of-day files (indices and equities, about 14 months of history, refreshed daily) and Delta Exchange public data (crypto and tokenised US stocks, intraday).

**Broker Connect (new):** users connect their own ICICI Direct (Breeze), Kotak Neo or Dhan account. Zerodha, Upstox, Angel One and Fyers are in beta and need platform app keys. Charts for NSE stocks and the main indices then use the user's own broker data, including intraday timeframes. Credentials are AES-256-GCM encrypted (`BROKER_ENC_KEY`). TOTP and MPIN are never stored. Order placement is not enabled.

**Options & navigation (new):** `/options` has an index → constituents underlying list, a live option chain from the user's broker (ICICI / Dhan) with OI, OI change, volume, IV and delta, PCR, max pain and ATM, plus a contract panel (Greeks from the broker or Black-Scholes, top-5 depth, spread %, most-traded contracts, ⓘ explanations, contract chart). A collapsible watchlist/indices panel on every terminal page switches the current page to the picked scrip.

**Algo trading waitlist:** `/algo-trading` explains algo trading with worked XScript strategy examples and collects interest. Admins (`ADMIN_EMAILS`) see counts and a CSV export at `/admin/waitlist`.

**In progress:** P2 Market data. Done so far: the instrument master (NSE/BSE equities, NFO/BFO futures and options) loaded daily from ICICI Direct's public security master, instrument search, instrument pages, an F&O contract explorer with an option-chain grid, and per-user watchlists. No prices are shown until a licensed feed or the Breeze relay is connected.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4: one app, frontend and same-origin `/api` routes.
- PostgreSQL via `postgres`. The schema (`lib/schema.ts`) is applied automatically on first use.
- Email OTP via [Resend](https://resend.com).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL
npm run dev                  # http://localhost:3000
```

Without `RESEND_API_KEY`, development mode prints OTP codes to the server console. Production refuses signups until email is configured. OTPs are never returned in API responses.

## Checks

```bash
npm test          # unit tests (password hashing, OTP, validation)
npm run typecheck
npm run lint
npm run build
```

## Deploy (Vercel)

1. Import this GitHub repo at vercel.com/new (framework: Next.js, root: `/`).
2. Add a Postgres database: Vercel → Storage → Neon Postgres (this sets `DATABASE_URL`).
3. Add environment variables `RESEND_API_KEY` and `EMAIL_FROM`. Verify your domain in Resend first.
4. Vercel → Settings → Domains: add your domain and create the DNS records Vercel shows.
5. Every push to a branch gets a preview URL. Pushes to `main` go to production.

6. Optional: add `CRON_SECRET` (any long random string). Vercel Cron then calls `/api/cron/instruments` daily (see `vercel.json`). Without the secret, that endpoint only runs when the data is more than 20 hours old.

Health check: `GET /api/health` reports the database, email and market-data status.

## Security notes (P1)

- scrypt password hashing. Sessions are random tokens, stored hashed, in an `httpOnly`, `SameSite=Lax` cookie (14 days).
- OTP: 6 digits, stored hashed, 10-minute expiry, 5 attempts, 60 s resend cooldown, 5 sends/hour.
- Login lockout after 8 failures (15 min). Requests from other sites are blocked by an Origin check. Security headers are set.
- Audit log for signup, verification, login and failures.

## Disclaimer

Research and education tool only. Not investment advice. Consult a SEBI-registered adviser.
