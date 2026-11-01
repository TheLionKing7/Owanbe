# 04 · Data model (Supabase Postgres)

Migrations: `supabase/migrations/` (applied in filename order). Tests: `bash supabase/tests/run-local.sh` uses a throwaway Postgres 16 and `supabase_stub.sql` to mimic `auth.jwt()` and the `anon`/`authenticated` roles.

## Conventions (enforced on every `public` table by `supabase/tests/schema_conventions.test.sql`)
- `id uuid primary key default gen_random_uuid()`
- `timestamptz` only (UTC). `created_at`, `updated_at` and `version` on every table except `audit_events`. Trigger `app_private.touch()` keeps `created_at` immutable, sets `updated_at = now()` and does `version + 1`.
- Money is `bigint <name>_minor` plus a `currency` column (ISO 4217). Never float, numeric or money types.
- RLS **enabled and forced**. `anon` reads nothing. Clients never INSERT, UPDATE or DELETE directly; writes go through `security definer` functions with `set search_path = ''`.
- Tenancy comes through foreign keys. Composite `(id, kind)` keys pin the house kind, so a record can't point at the wrong kind of house.
- Cross-party data is exposed only through deliberate projection functions (e.g. `my_houses()`), never by widening RLS.
- Financial corrections use compensating entries. Content deletion happens through purge jobs (future).

## Schemas
- `public`: application tables and client-callable RPCs.
- `app_private`: helpers and settings. `authenticated` has USAGE plus EXECUTE on specific functions only.

## Tables
| Table | Migration | Key columns / constraints | RLS (authenticated) |
|---|---|---|---|
| `users` | F-76 | `auth0_sub` **unique** (one user per Auth0 subject), email, email_verified, display_name, `status` active/suspended/deactivated, last_seen_at | read own row (`auth0_sub = verified_sub()`) |
| `houses` | F-77 | `kind` host/vendor, `owner_user_id`, display_name, archived_at; **unique (owner_user_id, kind)**; **unique (id, kind)** | read if active member and not archived (`app_private.is_active_member`) |
| `memberships` | F-77 | FK **(house_id, house_kind) → houses(id, kind)**; `role` owner/staff; `capabilities` ⊆ {chat, quotes, calendar, profile, bookings, payouts, members, billing}; checks `host_houses_owner_only` and `staff_not_owner_capabilities` (staff never payouts/members/billing); `revocation_attributed`; partial unique: one active membership per (house, user), one active owner per house | read own memberships |
| `staff_grants` | F-77 | user_id, `capability` support/finance/operations/arbitrator/event_manager/verification_reviewer, `scope_kind` global/event/case/verification_case, granted_by (≠ user), expires_at, revoked_at; **unique (id, scope_kind)**; event_manager must be event-scoped | read own active, unexpired grants |
| `assignments` | F-77 | FK **(staff_grant_id, target_kind) → staff_grants(id, scope_kind)**; target_id (FK to events/cases added when those tables exist); expires/revoked | read own active assignments of active grants |
| `audit_events` | F-77 | actor_user_id, `action` (`noun.verb`), target_table, target_id, house_id, purpose, details (identifiers only) | **no client access**; append-only trigger blocks update/delete/truncate |
| `app_private.auth_settings` | F-76 | single row: issuer `https://<domain>/`, audience | none (set via `configure_auth0`) |

## Functions
| Function | Who calls | Does |
|---|---|---|
| `app_private.configure_auth0(domain, audience)` | operator / service role | sets the accepted issuer and audience; until it runs, all sessions fail with `auth_not_configured` |
| `app_private.verified_sub()` | RLS, functions | returns the Auth0 `sub` after checking iss, aud (string or array), exp and sub; raises `invalid_token: …` (28000) |
| `app_private.current_user_id()` | RLS, functions | `users.id` for the verified sub when active |
| `app_private.is_active_member(house)` | houses RLS | membership check without RLS recursion |
| `app_private.touch()` | triggers | created_at immutable, updated_at, version++ |
| `app_private.audit(actor, action, table, target, house, details)` | server functions | append to `audit_events` |
| `app_private.provision_host_house(user)` | `ensure_user` | idempotently creates the Host house ("<First>'s celebrations" or "My celebrations"), owner membership and audit row |
| `public.ensure_user()` | client, after login | **session gate**: verify token, upsert user, raise `account_<status>` (42501) unless active, provision Host house |
| `public.my_houses()` | client | projection `(house_id, kind, display_name, role, capabilities)` of the caller's active memberships |

## Planned tables (from `blueprint/tech-spec.md` §4; built by their own features)
vendor_profiles, services, verification_cases · events, plans, tasks, budget_lines, shortlists · conversations, messages · quotes, quote_items, calendar_holds, allocations · bookings, payments, payment_events · ledger_accounts, ledger_entries, refunds, outages · approvals, payout_references, recovery_locks · subscriptions, fee_entries, trust_events, reviews · disputes, no_show_tickets, case_updates, evidence · guests, guest_shares, health_details, consents · invitations, claims, scanner_grants, admissions · files, access_grants, ai_reports · notifications, deliveries, preferences · jobs, outbox, idempotency_keys, privacy_requests, sessions.
