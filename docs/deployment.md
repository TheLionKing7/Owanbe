# Deployment runbook (F-79)

## Environments
Each environment has its **own** Supabase project, Auth0 tenant (or application), Paystack keys and Sentry project. Never share credentials between them.

| Environment | APP_ENV | Supabase project | Paystack keys | Hosting |
|---|---|---|---|---|
| Development | development | owanbe-dev | `sk_test_` / `pk_test_` | Lovable preview |
| Staging | staging | owanbe-staging | `sk_test_` / `pk_test_` | Lovable draft / staging URL |
| Production | production | owanbe-prod | `sk_live_` / `pk_live_` | Lovable published URL |

`src/config/server-env.ts` rejects a live Paystack key outside production and a test key in production.

## Settings per environment
Server-only (stored as secrets, never in code):
`APP_ENV`, `SUPABASE_URL`, `SUPABASE_PUBLIC_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `SENTRY_DSN`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`.

Browser (public values only): `VITE_APP_ORIGIN`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLIC_KEY`.

Paystack webhook URL per environment: `<origin>/api/public/paystack/webhook` (Paystack Dashboard → Settings → API Keys & Webhooks).

## Release order
1. **Migrations first, and only backward-compatible ones.** Add columns, tables and functions. Never rename or drop in the same release as the code that stops using them (expand → migrate → contract over two releases).
2. Apply migrations to staging, then run `bash supabase/tests/run-local.sh` and `bun run test`.
3. Publish the app to staging. Smoke test: homepage, sign-in, Host house, Vendor house, Paystack test webhook.
4. Apply the same migrations to production.
5. Publish the app to production.

## Restore and rollback (test before every release)
- **Database:** confirm a point-in-time backup exists for production (Supabase → Database → Backups). Each release, restore the latest backup into staging and run the test suite against it.
- **App:** roll back by restoring the previous version from Lovable's version history and publishing it again. Because migrations are backward-compatible, the previous app version keeps working on the new schema.
- **Migration rollback:** each migration that is not purely additive ships with a written reverse script in `supabase/rollback/`, tested on staging first.

## Release checklist
- [ ] `missingServerEnv()` returns nothing in the target environment
- [ ] `checkEnvIsolation()` returns nothing
- [ ] Migrations applied to staging and tests pass
- [ ] Backup restore into staging tested this release
- [ ] Previous app version noted for rollback
- [ ] Production migrations applied before publishing
