# 07 · Feature status (Sage 7)

Project `cfbf39db-b40e-4f75-9039-f241e7b05bfd` · Repo `github.com/TheLionKing7/Owanbe` · last synced from Sage 7 `get_answers` on 2026-11-01 10:58 UTC

Sage 7 audited F-75/F-76/F-77 at **07:35:28 UTC**, then re-ran the audit at **08:55:36 UTC** with reworded notes. Both timestamps are kept below because the memory bank first cited the earlier run.

This doc exists only on `chore/memory-bank` (`dbfcd11`); `main` has no `memory-bank/` folder yet.

**Meaning of "built":** the Sage 7 audit record marks the feature built and nothing more. It is not a claim that the feature is ready, secure, or verified against live Auth0/Supabase services.

| Feature | Branch | Commit | Reported | Audit | Notes |
|---|---|---|---|---|---|
| F-75 Project setup | merged to `main` | `a1a4987` | ✅ 2026-11-01 03:31 UTC | ✅ built (audit 07:35:28 UTC, re-audited 08:55:36 UTC) | Homepage from mockup, lazy routes, house shells, APP_ORIGIN |
| F-76 Authentication | `feat/F-76-authentication` | `50ee4bb` | ✅ 2026-11-01 03:40 UTC | ✅ built (audit 07:35:28 UTC, re-audited 08:55:36 UTC) | Auth0 → Supabase third-party auth; `ensure_user` gate. Live tenant not provisioned **(unverified)** |
| F-77 Data model (foundation scope) | `feat/F-77-data-model` (stacked on F-76) | `4992cba` | ✅ 2026-11-01 05:01 UTC | ✅ built (audit 07:35:28 UTC, re-audited 08:55:36 UTC); read "⏳ awaiting audit" in `dbfcd11` | houses, memberships, staff_grants, assignments, audit_events, schema convention tests |
| F-78 Permission scoping | — | — | — | — | **next**. Wiring: fn `validateToken`, table memberships, env `SUPABASE_SERVICE_ROLE_KEY` |
| F-79 Deployment | — | — | — | — | Wiring: env SUPABASE_URL, SUPABASE_PUBLIC_KEY, SENTRY_DSN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |
| F-80 CI | — | — | — | — | Planned (Sage 7 `next_three` after F-79). No `.github/` in the repo today: no workflow runs on push or PR. |

## Audit evidence files (run 2026-11-01 07:35:28 UTC; notes reworded at 08:55:36 UTC)

Sage 7 stores a one-line audit note per claim, not a file list. The paths below are the repo evidence each note points to, verified present in the tree at `dbfcd11`.

- **F-75** — `a1a4987` · notes: 07:35 "Project setup complete with React, Vite, TypeScript, Tailwind, Vitest, CI scripts, and memory-bank indexing."; 08:55 "Vite + React + TypeScript project setup, layouts, routing, brand tokens, and test harness."
  - `docs/journal/2026-10-31-F-75-project-setup.md`, `docs/adr/0001-ui-foundation.md`
  - `package.json` (typecheck / test / build / check:bundle / ci), `scripts/check-bundle.mjs`
  - `src/App.tsx`, `src/config/env.ts`, `src/layouts/HouseLayout.tsx`, `src/lib/houses.ts`
  - The 07:35 note credited "memory-bank indexing", which `a1a4987` does not contain (`memory-bank/` arrived in `dbfcd11`); the 08:55 re-audit dropped that claim, so the evidence list above is what the current note supports.
- **F-76** — `50ee4bb` · notes: 07:35 "Auth0 SPA authentication with in-memory tokens, redirect callback handling, and server-side ensure_user session gate."; 08:55 "Auth0 SPA + Supabase third-party auth with server session gate and tests."
  - `supabase/migrations/20261101000000_f76_users_auth.sql`, `supabase/tests/f76_auth.test.sql`, `supabase/tests/run-local.sh`, `supabase/tests/supabase_stub.sql`
  - `src/lib/auth/AuthProvider.tsx`, `src/lib/auth/auth0Client.ts`, `src/lib/auth/types.ts`
  - `src/components/auth/RequireAuth.tsx`, `src/components/auth/AuthNotice.tsx`, `src/routes/AuthCallback.tsx`, `src/routes/SignIn.tsx`
  - `src/test/auth.test.tsx`, `src/test/fakeAuth.tsx`
  - `docs/adr/0002-auth0-supabase-third-party.md`, `docs/auth0-setup.md`, `docs/journal/2026-11-01-F-76-authentication.md`
- **F-77** — `4992cba` · notes: 07:35 "Foundational schema with UUID PKs, UTC timestamptz, versioned concurrency, minor-unit money rules, houses, memberships, and forced RLS."; 08:55 "Foundational schema with UUIDs, UTC timestamps, optimistic concurrency versions, RLS, and append-only audit log."
  - `supabase/migrations/20261101020000_f77_data_model.sql`
  - `supabase/tests/f77_data_model.test.sql`, `supabase/tests/schema_conventions.test.sql`
  - `src/test/auth.test.tsx` (house empty state + session gate cases added by F-77)
  - `docs/journal/2026-11-01-F-77-data-model.md`

## Sage 7 acceptance proposals for upcoming features
- **F-78:** the role matrix matches the host/vendor-owner/staff/support permissions; vendor staff can't change payouts or member administration (already a DB constraint from F-77); sensitive reads by support and managers are logged. Open: confirm the Auth0 → Supabase validation path for DB and Realtime (answered by ADR 0002).
- **F-79:** separate dev, staging and prod projects with isolated credentials; backward-compatible migrations deploy before the client; restore and rollback are tested before each release.

## Outstanding actions

- **Before any merge to `main`:** the owner instructed that `npm run ci` and `bash supabase/tests/run-local.sh` be run on another suitable machine and the results shared. Never disable TLS verification to make `npm install` work.
- **Not implemented:** the owner's "admit but restrict" decision (2026-11-01 10:58 UTC). `public.users.status` still allows only active/suspended/deactivated (`20261101000000_f76_users_auth.sql:89`) and `ensure_user()` refuses any non-active row (`:151`), so a restricted first-run state needs a migration plus a decision on which feature owns it. See `08`, `09`.
- **Branch topology:** `chore/memory-bank` (`dbfcd11`, `c9faf0a`, `448c0ff`) is a linear descendant of `feat/F-77-data-model` → `feat/F-76-authentication` → `main`. Merging `chore/memory-bank` into `main` therefore lands F-76, F-77 **and** the memory bank in one step (48 files, +2715 vs `main`); `main` is an ancestor, so it fast-forwards with no conflicts. Isolating the memory docs onto `main` alone would leave the bank describing `supabase/` and `src/lib/auth/` files that are not there, and `npm run memory:check` would fail.
- `supabase/tests/*.test.sql` have **not been executed** in this environment (no Postgres 16+ / `initdb`; Docker Desktop would not start, WSL default is v1) **(unverified)**. `npm install` also fails here on `openid-client-6.8.8.tgz` with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, so `typecheck`/`test`/`build` cannot run on this machine either.
- Provision an Auth0 tenant and a Supabase project (`docs/auth0-setup.md`).
- No CI and no branch protection on `main` (private repo): nothing runs `npm run ci` on a PR before merge (F-80).
