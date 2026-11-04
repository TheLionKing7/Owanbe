# Deployment runbook (F-79)

## Environments
Use **one hosted Supabase project**, as requested by the owner. It is the authoritative production database. Development and destructive tests use disposable local Postgres through `supabase/tests/run-local.sh`; they do not need another hosted project. A staging app connected to the hosted project is **not isolated** and must not run destructive tests or use real personal data for experiments.

| Environment | APP_ENV | Supabase project | Paystack keys | Hosting |
|---|---|---|---|---|
| Development | development | Local disposable test database | `sk_test_` / `pk_test_` | Local development / preview |
| Staging | staging | Local test database; hosted reads only when explicitly approved | `sk_test_` / `pk_test_` | Preview / staging URL |
| Production | production | Owner's single hosted project | `sk_live_` / `pk_live_` | Lovable published URL |

Separate app origins and environment settings do not isolate data in a shared database. Do not connect staging payment writes to production tables. Full hosted staging requires separately approved isolation; it is not provided by this setup.

`src/config/server-env.ts` rejects a live Paystack key outside production and a test key in production.

## Settings per environment
Server-only (stored as secrets, never in code):
`APP_ENV`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (Lovable reserves the `SUPABASE_` secret prefix), `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `SENTRY_DSN`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`.

Browser (public values only): `VITE_APP_ORIGIN`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLIC_KEY`.

Paystack webhook URL per environment: `<origin>/api/public/paystack/webhook` (Paystack Dashboard → Settings → API Keys & Webhooks).

## Release order
1. **Migrations first, and only backward-compatible ones.** Add columns, tables and functions. Never rename or drop in the same release as the code that stops using them (expand → migrate → contract over two releases).
2. Run migrations and SQL tests in a disposable local database using `bash supabase/tests/run-local.sh`, then run `bun run test`. The included GitHub verification workflow runs these without hosted credentials.
3. Publish the app to staging. Smoke test: homepage, sign-in, Host house, Vendor house, Paystack test webhook.
4. Apply the same migrations to production.
5. Publish the app to production.

## Restore and rollback (test before every release)
- **Database:** inspect the backups actually available on your plan (Supabase → Database → Backups); do not assume point-in-time recovery exists. Before production migrations, take a secured backup/export and rehearse restoration locally with sanitized data. Never restore over the single hosted database just to test recovery.
- **App:** roll back by restoring the previous version from Lovable's version history and publishing it again. Because migrations are backward-compatible, the previous app version keeps working on the new schema.
- **Migration rollback:** each migration that is not purely additive ships with a written reverse script in `supabase/rollback/`, tested locally first and explicitly approved before hosted execution.

## Release checklist
- [ ] `missingServerEnv()` returns nothing in the target environment
- [ ] `checkEnvIsolation()` returns nothing
- [ ] Migrations and tests pass in the disposable local database
- [ ] Secured backup and local restore rehearsal completed this release
- [ ] Previous app version noted for rollback
- [ ] Production migrations applied before publishing

## Paystack and Sentry setup
- **Paystack:** use the same business account's test and live modes. Copy test keys only into development/staging settings and live keys only into production settings. Set each mode's webhook URL to the corresponding app origin. A single test-mode webhook setting cannot target two origins simultaneously; nominate one test receiver. Test payments must never update production financial records.
- **Sentry:** the `owanbe-web` project is configured under `gifted-mind-technologies`. Browser initialization retrieves only the public ingestion DSN and environment through a server function; Sentry management credentials never reach the browser. `APP_ENV` selects `development`, `staging`, or `production` (unset defaults to development for monitoring). Browser capture strips messages, users, requests, breadcrumbs, contexts, extras and arbitrary tags; replay, tracing and sessions are disabled. Root-boundary errors and unhandled browser errors are captured. Server-side errors, source-map upload and production alert setup are not yet instrumented. Confirm a safe sample event reaches Sentry before relying on browser monitoring. Publish after setting secrets before expecting the changes on the published app.
- **Auth0:** use separate applications/callback allowlists for local/preview and production origins where possible. Keep the approved Auth0 authentication authority; never create a competing login system.

See [GitHub audit sync](github-audit-sync.md) to activate the included mirroring and verification workflows. No workflow deploys production or changes the hosted database.
