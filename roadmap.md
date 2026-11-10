# Roadmap

- [x] Repair duplicate-object SQL errors while preserving records and permissions; repeated installation verified on disposable Postgres.
- [x] Repair embedded-preview Auth0 navigation and clarify professional planner sign-up; desktop, phone and blocked-tab recovery verified.
- [ ] Verify Auth0 preview callback configuration — blocked: requires Auth0 application settings access.

- [x] Payment owner decisions recorded; cancellation rules, Paystack virtual accounts, saved-card references and multi-model AI added.
- [ ] Run docs/sql/2026-11-10-f13-booking-completion.sql in the database — blocked: owner runs SQL on their own database.
- [x] Cancel buttons on booking screens, webhook saving card references, DVA on checkout.
- [x] F-13: host quote request from vendor page → vendor writes quote → accept → booking → pay.
- [ ] Live Paystack test of DVA/refunds — blocked: SQL above plus live Paystack keys.

- [x] F-76/F-79 repair: load public Auth0 and external database settings from saved runtime secrets; startup, single-use callback and retries tested.
- [ ] Complete real sign-in verification — blocked: Auth0 rejects the localhost callback URL; owner must allow http://localhost:8080/auth/callback and publish for live verification.

- [x] Import Owanbe repo into TanStack Start (homepage unchanged)
- [x] F-78 Permission scoping (database migration pending Supabase connection)
- [x] F-79 Deployment, using Paystack instead of Stripe
- [ ] Apply F-78 migration + add secrets — blocked: owner must connect their Supabase project
- [x] Report F-78/F-79 to Sage7
- [x] Restore original right-side homepage artwork and update category labels
- [x] Add GitHub audit mirroring and verification workflows with activation instructions
- [x] Correct deployment guidance for one hosted Supabase project
- [ ] Activate GitHub audit mirror — blocked: owner must add OWANBE_MIRROR_TOKEN to source repository Actions secrets
- [x] Add Sentry browser configuration, privacy tests and Supabase managed-key compatibility without replacing Auth0
- [ ] Verify Sentry event ingestion — blocked: saved SENTRY_DSN is not yet present in preview runtime
- [ ] Verify Supabase and apply pending migration — blocked: project connection diagnostics report no linked backend

- [x] Planner onboarding path at sign-up (Host, planning for a client)
