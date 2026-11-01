# 07 · Feature status (Sage 7)

Project `cfbf39db-b40e-4f75-9039-f241e7b05bfd` · Repo `github.com/TheLionKing7/Owanbe` · last synced from Sage 7 `get_answers` on 2026-11-01 07:35:28 UTC (audit run)

This doc exists only on `chore/memory-bank` (`dbfcd11`); `main` has no `memory-bank/` folder yet.

**Meaning of "built":** the Sage 7 audit record marks the feature built and nothing more. It is not a claim that the feature is ready, secure, or verified against live Auth0/Supabase services.

| Feature | Branch | Commit | Reported | Audit | Notes |
|---|---|---|---|---|---|
| F-75 Project setup | merged to `main` | `a1a4987` | ✅ 2026-11-01 03:31 UTC | ✅ built (audit 2026-11-01 07:35:28 UTC) | Homepage from mockup, lazy routes, house shells, APP_ORIGIN |
| F-76 Authentication | `feat/F-76-authentication` | `50ee4bb` | ✅ 2026-11-01 03:40 UTC | ✅ built (audit 2026-11-01 07:35:28 UTC) | Auth0 → Supabase third-party auth; `ensure_user` gate. Live tenant not provisioned **(unverified)** |
| F-77 Data model (foundation scope) | `feat/F-77-data-model` (stacked on F-76) | `4992cba` | ✅ 2026-11-01 05:01 UTC | ✅ built (audit 2026-11-01 07:35:28 UTC); read "⏳ awaiting audit" in `dbfcd11` | houses, memberships, staff_grants, assignments, audit_events, schema convention tests |
| F-78 Permission scoping | — | — | — | — | **next**. Wiring: fn `validateToken`, table memberships, env `SUPABASE_SERVICE_ROLE_KEY` |
| F-79 Deployment | — | — | — | — | Wiring: env SUPABASE_URL, SUPABASE_PUBLIC_KEY, SENTRY_DSN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |

## Audit evidence files (run 2026-11-01 07:35:28 UTC)

Sage 7 stores a one-line audit note per claim, not a file list. The paths below are the repo evidence each note points to, verified present in the tree at `dbfcd11`.

- **F-75** — `a1a4987` · note: "Project setup complete with React, Vite, TypeScript, Tailwind, Vitest, CI scripts, and memory-bank indexing."
  - `docs/journal/2026-10-31-F-75-project-setup.md`, `docs/adr/0001-ui-foundation.md`
  - `package.json` (typecheck / test / build / check:bundle / ci), `scripts/check-bundle.mjs`
  - `src/App.tsx`, `src/config/env.ts`, `src/layouts/HouseLayout.tsx`, `src/lib/houses.ts`
- **F-76** — `50ee4bb` · note: "Auth0 SPA authentication with in-memory tokens, redirect callback handling, and server-side ensure_user session gate."
  - `supabase/migrations/20261101000000_f76_users_auth.sql`, `supabase/tests/f76_auth.test.sql`, `supabase/tests/run-local.sh`, `supabase/tests/supabase_stub.sql`
  - `src/lib/auth/AuthProvider.tsx`, `src/lib/auth/auth0Client.ts`, `src/lib/auth/types.ts`
  - `src/components/auth/RequireAuth.tsx`, `src/components/auth/AuthNotice.tsx`, `src/routes/AuthCallback.tsx`, `src/routes/SignIn.tsx`
  - `src/test/auth.test.tsx`, `src/test/fakeAuth.tsx`
  - `docs/adr/0002-auth0-supabase-third-party.md`, `docs/auth0-setup.md`, `docs/journal/2026-11-01-F-76-authentication.md`
- **F-77** — `4992cba` · note: "Foundational schema with UUID PKs, UTC timestamptz, versioned concurrency, minor-unit money rules, houses, memberships, and forced RLS."
  - `supabase/migrations/20261101020000_f77_data_model.sql`
  - `supabase/tests/f77_data_model.test.sql`, `supabase/tests/schema_conventions.test.sql`
  - `src/test/auth.test.tsx` (house empty state + session gate cases added by F-77)
  - `docs/journal/2026-11-01-F-77-data-model.md`

## Sage 7 acceptance proposals for upcoming features
- **F-78:** the role matrix matches the host/vendor-owner/staff/support permissions; vendor staff can't change payouts or member administration (already a DB constraint from F-77); sensitive reads by support and managers are logged. Open: confirm the Auth0 → Supabase validation path for DB and Realtime (answered by ADR 0002).
- **F-79:** separate dev, staging and prod projects with isolated credentials; backward-compatible migrations deploy before the client; restore and rollback are tested before each release.

## Pending owner actions
- Push `feat/F-76-authentication` and `feat/F-77-data-model`, then merge F-76 into `main` first.
- Provision an Auth0 tenant and a Supabase project (`docs/auth0-setup.md`).
