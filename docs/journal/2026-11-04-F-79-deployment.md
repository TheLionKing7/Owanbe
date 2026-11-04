# 2026-11-04 · F-79 Deployment

Payments switched from Stripe to Paystack at the owner's request (`PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` replace the Stripe keys).

**What changed**
- Added a runbook at `docs/deployment.md`.
- Added `src/config/server-env.ts`:
  - lists the required settings for each environment
  - blocks live Paystack keys outside production
- Added a Paystack webhook at `/api/public/paystack/webhook`, with signature verification.

**Owner actions**
- Create separate dev, staging and prod Supabase projects.
- Set up Sentry and Paystack, each per environment.
