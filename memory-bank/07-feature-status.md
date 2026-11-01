# 07 · Feature status (Sage 7)

Project `cfbf39db-b40e-4f75-9039-f241e7b05bfd` · Repo `github.com/TheLionKing7/Owanbe` · last synced 2026-11-01

| Feature | Branch | Commit | Reported | Audit | Notes |
|---|---|---|---|---|---|
| F-75 Project setup | merged to `main` | `a1a4987` | ✅ | ✅ built (2026-11-01) | Homepage from mockup, lazy routes, house shells, APP_ORIGIN |
| F-76 Authentication | `feat/F-76-authentication` | `50ee4bb` | ✅ | ✅ built (2026-11-01) | Auth0 → Supabase third-party auth; `ensure_user` gate. Live tenant not provisioned **(unverified)** |
| F-77 Data model (foundation scope) | `feat/F-77-data-model` (stacked on F-76) | `4992cba` | ✅ | ⏳ awaiting audit | houses, memberships, staff_grants, assignments, audit_events, schema convention tests |
| F-78 Permission scoping | — | — | — | — | **next**. Wiring: fn `validateToken`, table memberships, env `SUPABASE_SERVICE_ROLE_KEY` |
| F-79 Deployment | — | — | — | — | Wiring: env SUPABASE_URL, SUPABASE_PUBLIC_KEY, SENTRY_DSN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |

## Sage 7 acceptance proposals for upcoming features
- **F-78:** the role matrix matches the host/vendor-owner/staff/support permissions; vendor staff can't change payouts or member administration (already a DB constraint from F-77); sensitive reads by support and managers are logged. Open: confirm the Auth0 → Supabase validation path for DB and Realtime (answered by ADR 0002).
- **F-79:** separate dev, staging and prod projects with isolated credentials; backward-compatible migrations deploy before the client; restore and rollback are tested before each release.

## Pending owner actions
- Push `feat/F-76-authentication` and `feat/F-77-data-model`, then merge F-76 into `main` first.
- Provision an Auth0 tenant and a Supabase project (`docs/auth0-setup.md`).
