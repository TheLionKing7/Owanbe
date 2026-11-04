# 2026-11-01 · F-76 Authentication

**What changed**
- Database (`supabase/migrations/20261101000000_f76_users_auth.sql`):
  - `public.users` holds one row per Auth0 subject (unique `auth0_sub`), with UUID ids, UTC timestamps and a version column.
  - Row-level security means a user can read only their own row; nobody writes to the table directly.
  - `app_private.verified_sub()` checks the token's issuer, audience (string or array), expiry and subject. It fails closed when the Auth0 settings are missing.
  - `public.ensure_user()` is the session gate: it creates the user on first sign-in, updates `last_seen_at`, and refuses suspended or deactivated accounts.
- `supabase/config.toml` enables Auth0 third-party auth and turns off Supabase sign-ups.
- Web app:
  - The `AuthProvider` loads the Auth0 SDK and the Supabase client on demand, after the page is idle, so the homepage's first paint is unchanged (78 kB gzipped).
  - The Host and Vendor houses are wrapped in `RequireAuth`. New routes: `/sign-in`, `/sign-up` and `/auth/callback`.
  - The header shows "Sign Out" and "My Ówàńbè" once signed in.
  - Only explicitly named env vars are exposed (`PUBLIC_ENV`), so secrets can't leak into the bundle.
- New env vars: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, `SUPABASE_URL` and `SUPABASE_PUBLIC_KEY`.
- Docs: `docs/auth0-setup.md` and ADR 0002.

**How it was checked**
- `npm run ci`: typecheck, 17 Vitest tests (9 of them auth), build, and the bundle budget.
- `bash supabase/tests/run-local.sh`: database tests on Postgres 16 with a Supabase `auth.jwt()` stub.

**Not yet verified / follow-ups**
- No Auth0 tenant or Supabase project exists yet, so the flow hasn't been tested end to end against the live services. Follow `docs/auth0-setup.md`, then sign in once in each environment.
- Revoking live sessions when a team member is removed belongs to F-78 (Permission scoping).
