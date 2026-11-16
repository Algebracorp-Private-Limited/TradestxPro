# TradestXPro

AI-powered Indian market intelligence terminal for NSE, BSE, F&O, MCX and FX.
Built in phases per the *TradestXPro Master Blueprint & SOP* (v1.0).

**Current phase: P1 Foundation.** It includes the landing page, pricing, signup with email OTP, login, sessions, logout and a protected dashboard shell. No market data is shown yet. Quotes arrive in P2 once a licensed feed is connected.

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

Health check: `GET /api/health` reports the database, email and market-data status.

## Security notes (P1)

- scrypt password hashing. Sessions are random tokens, stored hashed, in an `httpOnly`, `SameSite=Lax` cookie (14 days).
- OTP: 6 digits, stored hashed, 10-minute expiry, 5 attempts, 60 s resend cooldown, 5 sends/hour.
- Login lockout after 8 failures (15 min). Requests from other sites are blocked by an Origin check. Security headers are set.
- Audit log for signup, verification, login and failures.

## Disclaimer

Research and education tool only. Not investment advice. Consult a SEBI-registered adviser.
