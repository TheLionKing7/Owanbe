# 04 · Data model (Supabase Postgres)

Applied migrations: `supabase/migrations/` (filename order). **Pending** (not yet applied because no Supabase project is connected): nothing — `supabase/pending/` is empty, and `20261105080000_vendor_profiles.sql` was promoted into `migrations/` on 2026-11-08. Tests: `bash supabase/tests/run-local.sh` uses a throwaway Postgres 16 and `supabase_stub.sql` to mimic `auth.jwt()`, the `anon`/`authenticated` roles and a reduced `storage` schema.

**Nothing here has been applied to a hosted database.** Every migration in `migrations/` and every SQL suite in `supabase/tests/` has never been executed: this machine has no Postgres 16 binaries and Docker does not run here, so the database side of each feature is **unverified** until it runs against a real Postgres 16.

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
| `onboarding_profiles` | F-7 (`20261107090000_f7_onboarding.sql`) | `user_id` **unique** → users; `role` host/vendor; `phone_e164` (E.164 check, `phone_verified` false until F-51 verifies it; a changed number resets it); `city`; `host_intent` hosting/arranging; `event_type`, `event_date`; `business_category`; `completed_at` | **no client access** (RLS forced, all privileges revoked); read and written only through the three F-7 functions |
| `vendor_profiles` | F-14-era (`20261105080000_vendor_profiles.sql`) | one profile per vendor house (`house_id` **unique**); slug, business_name, category, headline, about, `published` + `published_at` | read only published profiles, through the public projections |
| `quotes`, `quote_revisions`, `quote_date_locks`, `vendor_availability` | F-14 (`20261104120000_f14_quotes.sql`) | a quote carries immutable revisions; money is `bigint …_minor` + `currency`; a revision can only be sent by the vendor house | read own house's quotes only, through the quote projections |
| `quote_payment_holds`, `notifications`, `refund_obligations` | F-38 (`20261104160000_f38_vendor_calendar_soft_hold.sql`) | the advisory hold on a dated quote; `payment_due_at` is the server deadline the countdown is derived from | read own house's holds and notifications, through the F-38 projections |
| `guest_lists`, `rsvps`, `guest_list_shares` | F-40 (`20261108120000_f40_guest_list_privacy.sql`) | a list is house-scoped with a title and `visibility` private/shared/public; `rsvps` holds phone and address; a share is a revocable grant to one verified account | active members of the owning house only; shared and public projections declare no `phone` or `address` column at all |
| `conversations`, `messages` | F-100 (`20261109020000_f100_in_app_chat.sql`) | one conversation per host-house/vendor-house pair; `messages` are append-only (trigger) and carry `sender_side` | the two houses of the conversation only, through the chat projections |
| `message_attachments` | F-100 (`20261109040000_f100_chat_attachments.sql`) | FK **(message_id, conversation_id) → messages(id, conversation_id)**; file_name ≤200, content_type ≤120, `size_bytes` 1..10485760, unique `storage_path` | both houses of the conversation only, through the attachment projections |
| `ai_planner_interactions` | F-101 (`20261109120000_f101_ai_planner.sql`) | one row per planner generation (a failed attempt is logged too); FK **(house_id, house_kind) → houses(id, kind)** with `house_kind` pinned to `host`; `budget_minor` bigint + `budget_currency`; `status` ok/error; `option_count` 0..6; `plan_summary` jsonb array; one report per row (check: `reported_at` and `report_category` are both null or both set) | the host reads their own rows only; no direct writes |
| `app_private.payment_settings` | F-102 | single row: `commission_bps` 250, `tax_bps` 0 (the owner has not set the tax), `tax_base` commission\|gross, `completion_window_hours` 24, `payments_paused`, `large_amount_threshold_minor` null | none (no client access) |
| `ledger_accounts` | F-102 | one account per code, owner and currency; `owner_kind` platform/user/house/booking; `normal_side` debit\|credit; unique on (code, owner, currency) | **no client access**; read through the ledger views and the projections |
| `journal_entries` | F-102 | one entry per step; `idempotency_key` **unique**; `kind` booking_hold/release_70/release_30/fee/refund/reversal/payout; `reverses_id` for a correction | **no client access**; append-only trigger blocks update/delete/truncate |
| `postings` | F-102 | the lines of an entry; `ledger_account_id` → ledger_accounts (named that way because the F-60 credential guard reserves `account_*`); `amount_minor` <> 0, positive is a debit and negative a credit; a deferred constraint trigger refuses an entry that does not balance per currency (`unbalanced_entry`) | **no client access**; append-only trigger |
| `bookings` | F-102 | one row per accepted quote (`quote_id` unique); FK **(host_house_id, host_house_kind) → houses(id, kind)** and the same for the vendor house; `total_minor` + `currency`; `status` awaiting_payment/paid/completed/cancelled/refunded with a `bookings_state_shape` check | read own house's bookings only, through `my_bookings()` |
| `fund_pool` | F-102 | the money for one booking: `held_minor`, `released_70_minor`, `released_30_minor`, `commission_minor`, `tax_minor`, `vendor_net_minor`, `refunded_minor`; check `fund_pool_balances` (held + released + refunded = paid) and `fund_pool_state_shape`; `payment_reference`; `release_30_due_at` is the server deadline; `frozen` + `frozen_reason` + `frozen_by` for the dispute freeze | the two houses of the booking only, through `booking_fund()` |
| `wallet_ledger` | F-102 | the append-only trail of what moved for one booking; `movement`, `direction`, `amount_minor`, `idempotency_key` **unique** | the two houses of the booking only, through `booking_movements()`; append-only trigger |
| `payment_events` | F-102 | one row per provider event; **unique (event_type, reference)** so a retried webhook is recognised; `outcome` allocated/refund_required/settled/ignored/duplicate | **no client access**; the webhook's own idempotency |
| `app_private.auth_settings` | F-76 | single row: issuer `https://<domain>/`, audience | none (set via `configure_auth0`) |

## Functions
| Function | Who calls | Does |
|---|---|---|
| `public.my_onboarding()` | browser (F-7) | the caller's onboarding row joined with `users.display_name` and whether they own a Vendor house; no row = not started |
| `public.save_onboarding(role, display_name?, phone?, city?, host_intent?, event_type?, event_date?, business_category?)` | browser (F-7) | upserts the caller's row (null keeps a field); updates `users.display_name`; refuses `invalid_role`, `invalid_name`, `event_date_in_past`, and `role_locked` once completed |
| `public.complete_onboarding()` | browser (F-7) | idempotent; requires name ≥ 2, phone and city, plus host intent (host) or business category **and** an owned Vendor house (vendor); raises `onboarding_incomplete:<part>`; audits `onboarding.completed` with the role only (no phone or city) |
| `app_private.configure_auth0(domain, audience)` | operator / service role | sets the accepted issuer and audience; until it runs, all sessions fail with `auth_not_configured` |
| `app_private.verified_sub()` | RLS, functions | returns the Auth0 `sub` after checking iss, aud (string or array), exp and sub; raises `invalid_token: …` (28000) |
| `app_private.current_user_id()` | RLS, functions | `users.id` for the verified sub when active |
| `app_private.is_active_member(house)` | houses RLS | membership check without RLS recursion |
| `app_private.touch()` | triggers | created_at immutable, updated_at, version++ |
| `app_private.audit(actor, action, table, target, house, details)` | server functions | append to `audit_events` |
| `app_private.provision_host_house(user)` | `ensure_user` | idempotently creates the Host house ("<First>'s celebrations" or "My celebrations"), owner membership and audit row |
| `public.ensure_user()` | client, after login | **session gate**: verify token, upsert user, raise `account_<status>` (42501) unless active, provision Host house |
| `public.my_houses()` | client | projection `(house_id, kind, display_name, role, capabilities)` of the caller's active memberships |
| `app_private.owner_only_capabilities()` / `all_house_capabilities()` | F-78 functions | the two fixed capability lists: payouts/members/billing · chat/quotes/calendar/profile/bookings + those three |
| `app_private.house_can(house, capability)` + `public.house_can(…)` | RPC (pending F-78) | **the role matrix**: owner ⇒ any capability; staff ⇒ only granted ones and never payouts/members/billing; unknown capability, revoked membership, archived house or no membership ⇒ false. Stable, definer, `search_path=''` |
| `app_private.require_house_capability(house, capability)` | other definer functions | returns the caller's user id or raises `forbidden: % in house` (42501) |
| `public.set_member_capabilities(membership, capabilities)` | vendor owner RPC (pending F-78) | needs the `members` capability; refuses to edit an owner membership or grant an owner-only capability; audits `membership.capabilities_changed` |
| `public.revoke_member(membership)` | vendor owner RPC (pending F-78) | sets `revoked_at` + `revoked_by` (owner cannot be removed); audits `membership.revoked` |
| `app_private.staff_grant_for(capability, target_kind, target)` | staff RPCs (pending F-78) | the caller's active, unexpired grant covering the target — global preferred, otherwise via an active, unexpired `assignments` row, and the user must be `active` |
| `app_private.log_sensitive_read(actor, grant, table, target, house, purpose)` | staff RPCs (pending F-78) | inserts `audit_events` row `action='sensitive.read'` with `purpose = left(trim(purpose),500)` and `details={'staff_grant_id'}`; raises `purpose_required` (22023) when the purpose is shorter than 10 characters |
| `public.support_house_members(house, purpose)` | support RPC (pending F-78) | read-only projection of a house's team; requires an active `support` grant, always logs the read |
| `public.authorize_sensitive_read(capability, target_kind, target, purpose)` | later sensitive reads (pending F-78) | gate for `support`, `event_manager`, `arbitrator`, `verification_reviewer`, `finance`; returns the grant id and logs the read |

## F-100 chat
| Function | Who calls | Does |
|---|---|---|
| `public.start_conversation(vendor_slug)` | browser | opens the single conversation between the caller's host house and that vendor house; refuses `invalid_vendor` and `vendor_not_found` |
| `public.send_message(conversation, body)` | browser | appends a message; refuses `invalid_message` (empty or >4000 characters) and `forbidden` for a non-participant |
| `public.send_document(conversation, body, file_name, content_type, size_bytes, storage_path)` | browser | appends a message plus its attachment row; refuses `invalid_attachment_type`, `invalid_attachment_size` and `forbidden: attachment path` when the path belongs to another conversation; audits `message.attachment_shared` |
| `public.my_conversations()` | browser | the caller's conversations with their counterparty, last message and message count |
| `public.conversation_messages(conversation)` | browser | the thread, each message marked for its own reader |
| `public.conversation_attachments(conversation)` / `public.conversation_attachment(conversation, attachment)` | browser | the attachments of a conversation, or one of them; the single-attachment call raises `attachment_not_found` |
| `app_private.can_chat_in(conversation)` | RLS, storage policies | true when the caller may speak in that conversation (participant, `chat` capability, membership not revoked) |
| `app_private.conversation_id_from_path(name)` | storage policies | parses `conversations/<uuid>/<file>` into the conversation id |

Storage bucket `chat-attachments` is **private** (`public = false`), `file_size_limit = 10485760`, with an allowlist of image and document types. Its `storage.objects` policies call `app_private.can_chat_in(app_private.conversation_id_from_path(name))`, so a file can only be read by a house that may speak in that conversation. Files are fetched through a short-lived signed URL minted with the caller's own token; the app never holds a service-role key.

## F-101 planner
The plan itself is built in the app (`src/features/planner`) and checked there against the published vendor profiles — the database cannot tell whether a price is real. This file stores the interaction and the reports.

| Function | Who calls | Does |
|---|---|---|
| `public.log_ai_planner_interaction(event_type, city, guest_count, budget_minor, budget_currency, brief, model, status, option_count, plan_summary)` | app server (F-101) | writes one interaction row and audits `planner.interaction`; requires an active member of a Host house (`forbidden: planner`, 42501); validates every field (22023 `invalid_planner_input`); refuses a second call inside 30 seconds (`rate_limited: planner`); keeps at most six options and resolves the vendor names from `public.vendor_profiles` where `published`, so a caller cannot log a business that is not on the platform |
| `public.report_ai_planner_response(interaction, category, note)` | browser (F-101) | records one report on the caller's own interaction; refuses an unknown category or a note over 500 characters (22023), an interaction that is not the caller's (`interaction_not_found`, P0002) and a second report (`already_reported`, 22023); audits `planner.response_reported` |
| `public.ai_planner_cooldown_seconds()` | app server (F-101) | seconds left of the 30-second per-user cooldown, 0 when none |
| `public.my_ai_planner_interactions()` | browser (F-101) | the caller's last 20 interactions, newest first |
| `app_private.planner_host_house(user)` | F-101 functions | the user's active Host house, or null |

Pending note: the migration is unapplied and `f101_ai_planner.test.sql` has never been executed on this machine (no Postgres 16 binaries, Docker does not run here), so the database side of F-101 is **unverified**.

Pending-F-78 note: nothing in the app calls these yet (`src/lib/permissions.ts` is a UI mirror only), and the migration is unapplied — so staff scoping is **enforced in code that is not deployed**, not in the live database **(unverified)**.

## F-102 fund pool and ledger
The double-entry ledger is the accounting truth (`ledger_accounts`, `journal_entries`, `postings`); `fund_pool` and `wallet_ledger` are the pool-scoped standing and the readable trail. Money moves only through the `service_role` functions below; the projections are `authenticated` and scope by house.

| Function | Who calls | Does |
|---|---|---|
| `public.allocate_split_payment(booking, reference, amount, currency)` | payment router (service role) | posts the payment as a `booking_hold` entry and releases 70% (vendor net + commission), keeping 30% in escrow with `release_30_due_at`; idempotent on the reference (`allocated`), and refuses a second reference (`payment_already_recorded`), an amount under the quote total (`payment_below_quote_total`) and a wrong currency (`currency_mismatch`) |
| `public.record_payment_event(provider, event_type, reference, amount, currency, payload)` | payment router (service role) | one row per provider event, unique on `(event_type, reference)`, so a retried webhook returns `duplicate` and changes nothing |
| `public.booking_for_payment_reference(reference)` | payment router (service role) | the booking a reference belongs to, or null |
| `public.complete_booking(booking)` | host (authenticated) | the host confirms the event; releases the final 30% tranche |
| `public.request_fund_refund(booking, reason)` | host (authenticated) | records the refund obligation for the money still held; refuses a frozen pool (`fund_pool_frozen`) and a missing or credential-shaped reason |
| `public.settle_refund(booking, reference)` | payment router (service role) | closes the refund against the ledger; `settled` on a replay |
| `public.freeze_fund_pool(booking, reason)` / `public.unfreeze_fund_pool(booking)` | staff with an `arbitrator` grant | the dispute freeze; a host or a vendor is refused (`forbidden: arbitrator grant required`) |
| `public.release_due_fund_tranches()` | job or operator | releases the 30% tranche whose 24-hour window has passed; a frozen pool is skipped |
| `public.booking_fund(booking)` / `public.booking_movements(booking)` / `public.booking_payment_request(booking)` | host (authenticated) | the fund breakdown, the movement trail and what the host still owes |
| `public.my_bookings(house)` | browser | the house's own bookings with their pool standing |
| `app_private.post_entry(...)` / `app_private.entry_lines(...)` / `app_private.ledger_account(code, currency)` | the money functions | the posting helper: an entry with its lines, the account lookup by code, and the balance check |
| `app_private.tranche_split(total)` / `app_private.tranche_fees(gross, settings)` | the money functions | the 70/30 split and the commission/tax on a tranche |
| `app_private.on_quote_accepted_booking()` | trigger on quotes | creates the booking and its pool when a quote is accepted, so no path accepts a quote without a booking to pay for |

Pending note: the migration is unapplied and `f102_fund_pool.test.sql` has never been executed on this machine (no Postgres 16 binaries, Docker does not run here), so the database side of F-102 is **unverified**.

## Planned tables (from `blueprint/tech-spec.md` §4; built by their own features)
vendor_profiles, services, verification_cases · events, plans, tasks, budget_lines, shortlists · conversations, messages · quotes, quote_items, calendar_holds, allocations · bookings, payments, payment_events · ledger_accounts, ledger_entries, refunds, outages · approvals, payout_references, recovery_locks · subscriptions, fee_entries, trust_events, reviews · disputes, no_show_tickets, case_updates, evidence · guests, guest_shares, health_details, consents · invitations, claims, scanner_grants, admissions · files, access_grants, ai_reports · notifications, deliveries, preferences · jobs, outbox, idempotency_keys, privacy_requests, sessions.
