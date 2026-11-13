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
| `market_benchmarks` | F-106 (`20261109160000_f106_market_benchmarks.sql`) | one observed market price: FK **(vendor_house_id, vendor_house_kind) → houses(id, kind)** with `vendor_house_kind` pinned to `vendor`; `category` + `location` + `location_key`; `price_minor` bigint + `currency`; `source` is always `vendor_quote`; `source_ref` → quotes(id) and `source_revision`; `observed_at` is when the quote was sent; `verification_status` verified/unverified; unique (source_ref, source_revision, category, location_key) | **no client access at all** (RLS enabled and forced, no policies, `revoke all`); read only through the two F-106 functions; append-only trigger |
| `app_private.ai_settings` | F-107 (`20261109180000_f107_owanbe_ai.sql`) | one row: the zero-retention gate. `zdr_confirmed` with `zdr_provider` + `zdr_contract_ref` + `zdr_confirmed_at` + `zdr_confirmed_by`; the `ai_settings_zdr_shape` check means a confirmed gate cannot exist without a provider, a contract reference and a moment, and an unconfirmed gate cannot carry the shadow of one | none (revoked from every role, including `service_role`); only the owner can open the gate |
| `cases` | F-107 | a case anyone can raise, including OwanbeAI: `reference` `CASE-[0-9A-F]{12}`; `subject` 3..200 and `reason` 10..1000; `status` open/investigating/waiting_on_customer/resolved/closed; `priority` low/normal/high/urgent; `source` ai_investigation/staff/host/vendor; `ai_interaction_id` → ai_interactions(id); `booking_id` and `house_id` set null on delete; **no money fields at all**, so a case cannot carry an instruction to move money | **no client access** (RLS enabled and forced, no policies, `revoke all`); written only through `open_ai_case` |
| `ai_interactions` | F-107 | one row per AI interaction, whatever surface produced it: `surface` payment_investigation/vendor_profile_copy; `request_summary` 1..500; `response_text` 1..4000; `reason`; `model`; `outcome` answered/opened_case/no_issue/needs_human; `booking_id`; `reported_at` + `report_category` + `report_note` with the `ai_interactions_one_report` check (**one report per answer**); the F-60 credential guard refuses a card-like number or an "account…digits" phrase in the request, the response, the reason, a case subject or a case reason | **no client access** (RLS enabled and forced, no policies, `revoke all`); written only through `log_ai_interaction` and `report_ai_interaction` |
| `ai_case_notes` | F-107 (`20261113120000_f107_ai_console.sql`) | one note a staff member wrote while working a case: `case_id` → cases(id) on delete cascade; `author_user_id` → users(id); `body` 1..1000 with the F-60 credential guard, so a card-like number is refused | **no client access** (RLS enabled and forced, no policies, `revoke all`); written only through `update_ai_case` |
| `invitations` | F-108 (`20261113150000_f108_ticketing.sql`) | one issued link for one guest list: `claim_limit` 1 or 2; `token_hash` (sha256, **unique**) — the raw token exists once, in the host's hands; `generation` moves on when the link is reissued; `status` issued/claimed/revoked; `claim_deadline` and `admission_expires_at` are the server deadlines | **no client access** (RLS enabled and forced, no policies, `revoke all`); read and written only through the F-108 functions |
| `invite_claims` | F-108 | one claim against one invitation: `slot` (unique per invitation); `display_name`; `phone_reference` (sha256 — **the phone is never stored in the clear**); `session_hash` (sha256 of the guest's session); `status` active/revoked with a check that `revoked_at` and the status cannot drift apart; partial unique (invitation_id, phone_reference) where active | **no client access**; written only through `claim_invitation` |
| `admissions` | F-108 | the entry card: `claim_id` unique; `credential_hash` (sha256, unique) — the QR carries the raw credential, the platform stores only its hash; `status` issued/admitted/revoked; `expires_at` | **no client access**; written only through `claim_invitation` and `record_checkin` |
| `scanner_grants` | F-108 | who may admit, on which device, until when: `guest_list_id`, `house_id` + `house_kind` pinned to `host`; `grantee_user_id` and `granted_by` → users(id); `device_id`; `expires_at`; `revoked_at` + `revoked_by` (a check keeps them paired); partial unique (guest_list_id, device_id) where not revoked — one live device per list | **no client access**; written only through `issue_scanner_grant` and `revoke_scanner_grant` |
| `checkins` | F-108 | one admission attempt: `admission_id`, `scanner_grant_id`, `guest_list_id`, `device_id`, `occurred_at` (the device's own clock), `mode` online/queued_offline, `result` admitted/duplicate/expired/unknown | **no client access**; written only through `record_checkin` |
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

## F-106 market benchmarks
A benchmark is a price a vendor actually asked for. The only price statement the platform can prove is a quote a vendor sent, so the observation is written by a trigger on `public.quotes` — there is no function that can write a price. A range is published only when two or more vendors hold a current price, so one vendor's private quote is never handed back to the market.

| Function | Who calls | Does |
|---|---|---|
| `public.read_market_benchmarks(categories, location)` | the planner's Host houses and staff with an `analytics` grant (authenticated) | the range per category and currency: the count, the vendor count, and the min/median/max **only when two or more vendors hold a current price**; the observation window (`oldest_observed_at`/`newest_observed_at`); refuses a caller in neither (`forbidden: market benchmarks`, 42501) and audits `benchmark.range_read` |
| `public.read_market_benchmark_sources(category, location)` | staff with an `analytics` grant only (authenticated) | the provenance behind a category: the vendor, the quote (`source_ref`, `source_revision`), the price, when it was seen and whether it is still current; refuses anyone without the grant (`forbidden: analytics grant required`, 42501) and audits `benchmark.sources_read` |
| `app_private.capture_market_benchmark()` | trigger on `public.quotes` (`after update … sent_at changed`) | records one observation per place the vendor serves, with the vendor's own price, the quote behind it and the moment it was seen; audits `benchmark.observed`, and audits `benchmark.superseded` for the price it replaces |
| `app_private.current_market_benchmarks(categories, location_key)` | the two read functions | the verified, not-withdrawn, still-current observations |
| `app_private.benchmark_locations(locations)` | the trigger | the places a vendor serves, split out of the profile's own line |

The `analytics` staff capability is **new in F-106**: it is added to the `staff_grants_capability_check` constraint, and it is what opens the provenance read. The six capabilities that already existed keep their meaning.

Pending note: the migration is unapplied and `f106_market_benchmarks.test.sql` has never been executed on this machine (no Postgres 16 binaries, Docker does not run here), so the database side of F-106 is **unverified**.

## F-107 OwanbeAI
OwanbeAI **reads** and **reports**. It has no money authority: the `ai_investigation` grant is a platform-staff capability that opens the two reads below, and no function on the AI path can allocate, refund, settle, freeze, unfreeze, complete or release. The zero-retention gate (`app_private.ai_zdr_confirmed()`) is **closed by default** and no application role can open it — only the owner can, by writing the contracted provider into `app_private.ai_settings`.

| Function | Who calls | Does |
|---|---|---|
| `public.ai_investigation_status()` | the AI panel (authenticated) | one read: `zdr_confirmed`, `has_grant`, `can_investigate`. The panel shows itself only when `can_investigate` is true |
| `public.ai_payment_log(booking, purpose)` | OwanbeAI (authenticated, staff with the `ai_investigation` grant) | the **minimised** payment trail: money and state only — totals, paid, held, released, refunded, frozen, the release and completion deadlines, the movement and event counts. No party name, no email address, no provider reference, no payload. Refused without the grant (42501) and while the contract is unconfirmed (22023 `zdr_contract_required`); every read is a sensitive read and is audited |
| `public.ai_payment_event_log(booking, purpose)` | OwanbeAI (authenticated, same grant) | the provider's own events: type, outcome, amount, currency, time. The payload and the reference are **not** returned, so a partner token cannot be read back out of the log; same refusals and same auditing |
| `public.log_ai_interaction(surface, request_summary, response_text, reason, model, outcome, booking)` | the AI surfaces (authenticated) | records the answer as it was shown, so it can be reported and so a case points back at the investigation that found it. The F-60 credential guard refuses a card-like number in the text |
| `public.open_ai_case(interaction, subject, reason, priority)` | OwanbeAI (authenticated) | opens the case the finding needs, pointing at the interaction. It opens one; it decides nothing about it |
| `public.report_ai_interaction(interaction, category, note)` | the reader of an answer (authenticated) | one report per answer; a second report is refused (`already_reported`, 22023) rather than merged |
| `app_private.ai_zdr_confirmed()` | the reads and the provider | whether sensitive AI processing is allowed right now; false until the owner records a contract |
| `app_private.keep_payment_event_booking()` | trigger on `public.payment_events` | a narrow F-102 repair: the write-back cleared the booking on a failed payment event, so the trail back to the booking was lost. It puts the booking back only when the outcome was never decided, and touches nothing else |

The `ai_investigation` staff capability is **new in F-107** and is added to `staff_grants_capability_check`, alongside F-106's `analytics`. It is a **platform-staff** capability, not a house capability: `public.my_houses()` exposes only house capabilities, so the app learns about it solely through `ai_investigation_status()`.

Pending note: the migration is unapplied and `f107_owanbe_ai.test.sql` has never been executed on this machine (no Postgres 16 binaries, Docker does not run here), so the database side of F-107 is **unverified**.

## F-107 OwanbeAI console
The console is the other half of F-107: without it a case the AI opened could never be worked, because no function anywhere moved `public.cases.status`, and the AI panel lived only inside a host house's payments panel, so a staff holder of the grant outside a host house could not reach OwanbeAI at all. It adds **no money path**: the console reads cases and answers and writes a case's status and a note, and nothing else.

| Function | Who calls | Does |
|---|---|---|
| `public.read_ai_cases(status)` | the console (authenticated, staff holding the `ai_investigation` grant) | the case queue: reference, subject, reason, status, priority, source, the opening interaction, the booking, the created and updated moments and the notes on the case. Refused without the grant (42501) and when signed out (28000); every read is audited as `ai.cases_viewed` against the grant id. The optional status filter narrows the queue; the result is capped at 50 |
| `public.read_ai_interactions(surface)` | the console (authenticated, same grant) | the answers OwanbeAI gave: the surface, the request, the response, the outcome, **the model that answered**, the booking, the linked case and the report state. This is a **sensitive read** — it is logged as `sensitive.read` against `ai_interactions` with the purpose and the grant id, because a list read has no single row to point at. Refused without the grant; capped at 50 |
| `public.update_ai_case(case, status, note)` | the console (authenticated, same grant) | moves a case and optionally leaves a note on it. The move must be one the database allows (`app_private.ai_case_may_move`): open → investigating / waiting_on_customer / resolved / closed, investigating → waiting_on_customer / resolved / closed, waiting_on_customer → investigating / resolved / closed, resolved → investigating / closed, closed → nothing. A refused move writes **nothing** — no status change, no note, no audit row. The audit row (`ai.case_updated`) records the from and the to and the **length** of the note, never the note itself |
| `public.my_ai_interactions()` | every signed-in person | the caller's **own** answers, with the request summary and the model that answered, so a person can see what the AI told them and report it. No grant is needed for one's own answers, and nobody else's answers are in the result |
| `app_private.ai_case_may_move(from, to)` | `update_ai_case` | the transition rule, in one place. The app mirrors it in `src/features/ai/console-contracts.ts` so the form only offers a legal move, but the **database is the authority** |

Refusals, all with their own code so the app can say something useful: `not_signed_in` (28000), `forbidden: ai_investigation grant required` (42501), `invalid_case_status` (22023), `case_not_found` (P0002), `invalid_case_transition` (22023), `invalid_case_note` (22023) and `case_note_no_credentials` (22023).

The AI's own identity (`investigation_only`, F-46) has **no** execute on any of these four functions and no table grant on `cases`, `ai_interactions` or `ai_case_notes` — the console belongs to a person, not to the AI.

Pending note: the migration is unapplied and `f107_ai_console.test.sql` has never been executed on this machine (no Postgres 16 binaries, Docker does not run here), so the database side of the F-107 console is **unverified**.

## F-126 observability dashboard
The dashboard reads the platform's **own operational records** and returns counters. It adds no table and no money path.

| Function | Who calls | Does |
|---|---|---|
| `public.observability_dashboard()` | the operations dashboard (authenticated, staff holding the existing `operations` grant) | twelve counters with a label, a detail and a severity: provider events with no outcome, the age of the oldest undecided event, bookings whose ledger does not add up, releases past their deadline, refunds owed and not settled, pools frozen by a dispute, failed charges in 24 hours, payment windows that closed unpaid, cases still open, AI answers needing a person, unread house alerts, sensitive reads in 24 hours. **No amount, currency, party name, email, provider reference or house identifier** is in the result. Refused without the grant (42501) and when signed out (28000); every permitted read is audited as `observability.viewed` against the grant id |

Severity on the dashboard is a **reading rule, not a threshold**: the page grades a counter for a human and never decides whether money moves.

Pending note: the migration is unapplied and `f126_observability_dashboard.test.sql` has never been executed on this machine (no Postgres 16 binaries, Docker does not run here), so the database side of F-126 is **unverified**.

## F-108 ticketing
An invitation is a **single secret**: the token exists once, in the host's hands, and the platform keeps only its hash. A guest claims a link without an account — the claim binds the invitation to a phone number, and a claim's capacity is counted under a row lock, so a couple's link admits two people and never three. Admission is a **derived credential**: `sha256('owanbe-admission:' || guest_session)`. The guest's QR carries that credential, the platform stores only `sha256(credential)`, and a scanner that is offline hashes what it scans and compares it with the hashes it cached — so the cache never holds anything that could be replayed.

| Function | Who calls | Does |
|---|---|---|
| `public.create_invitation(list, claim_limit, claim_deadline, admission_expires_at)` | the host (authenticated) | mints one invitation and returns the **raw token once**. Refused unless the caller hosts the list (`app_private.require_list_host`); the link stops being claimable at the claim deadline and the card stops working at the admission expiry |
| `public.reissue_invitation(invitation, expected_version)` | the host (authenticated) | takes a link back and mints a fresh one; the old token stops working at once. The version column is checked, so a stale screen is refused (`stale_version`) rather than overwriting a newer change |
| `public.revoke_invitation(invitation, expected_version)` | the host (authenticated) | revokes a link; a revoked invitation cannot be claimed and its card is refused |
| `public.host_invitations(list)` | the host (authenticated) | the host's own view of the list: status, capacity, deadlines, claim count and a **token fingerprint** — never the token |
| `public.claim_invitation(token, display_name, phone, device_id)` | the guest (**anon** — no account needed) | claims a place: the token is hashed and the row is locked `for update`, the capacity is counted under that lock, the phone is stored **only as a hash** (`phone_reference`), and a second claim on the same phone is refused. Returns the guest session and the admission credential |
| `public.my_claimed_card(guest_session)` | the guest (**anon**) | reads the card back with the guest's own session: the event title, the name, the slot, the state and the expiry; the credential is recomputed from the session, never read from the row |
| `public.issue_scanner_grant(list, device_id, grantee, expires_at)` | the host (authenticated) | hands a door device to a named person: a grant that is device-bound, time-boxed and revocable. The host cannot grant to themselves unless they host the list |
| `public.revoke_scanner_grant(grant, expected_version)` | the host (authenticated) | takes the door device back at once; a revoked grant stops admitting at the next scan |
| `public.host_scanner_grants(list)` | the host (authenticated) | the list's grants: the device, the person, the expiry and whether it was revoked |
| `public.grantee_for_list(list, email)` | the host's form (authenticated) | resolves the email to a user **on the platform**: a verified, active person who belongs to the host's house. An unknown, unverified or suspended person raises `grantee_not_found`; a malformed address raises `invalid_email` |
| `public.scanner_admissions(grant, device_id)` | the door device (authenticated, holding a live grant) | the **admission minimum** for one list: each card's credential hash, name, state, card expiry and the grant's own expiry as the cache's door window. No phone, no address, no other guest's details |
| `public.record_checkin(grant, credential, device_id, occurred_at, mode)` | the door device (authenticated, holding a live grant) | writes the admission the door made. `mode` is `online` or `queued_offline`, so a check-in made while the network was down is visibly reconciled later and not counted twice |
| `app_private.f108_hash(value)` / `app_private.f108_random_token()` / `app_private.f108_admission_credential(session)` | the functions above | the hashing, the token minting and the credential derivation — all with core PostgreSQL (`sha256`), so no extension is needed |
| `app_private.require_list_host(list)` | every host write | F-40's guard, reused: the caller must host the guest list |

The five tables (`invitations`, `invite_claims`, `admissions`, `scanner_grants`, `checkins`) have RLS enabled **and forced**, all access revoked from `public`, `anon` and `authenticated`, and are reachable only through the functions above.

**The door's cache is not a table — it is the device's own memory.** It holds the rows `scanner_admissions` returns plus the moment the platform last gave them (`synced_at`), in the phone's locked drawer. A door may only answer from a cache the platform gave it and only while the door window (the grant's expiry) is open; otherwise it answers `needs_sync` and admits nobody. The decision is `docs/decisions/f108-offline-cache-window.md`.

Pending note: the migration is unapplied and `f108_ticketing.test.sql` has never been executed on this machine (no Postgres 16 binaries, Docker does not run here), so the database side of F-108 is **unverified**. The Expo app under `mobile/` has also **never been installed or run** here (the npm registry is unreachable from this machine), so the phone side is code only (**unverified**).

## Planned tables (from `blueprint/tech-spec.md` §4; built by their own features)
vendor_profiles, services, verification_cases · events, plans, tasks, budget_lines, shortlists · conversations, messages · quotes, quote_items, calendar_holds, allocations · bookings, payments, payment_events · ledger_accounts, ledger_entries, refunds, outages · approvals, payout_references, recovery_locks · subscriptions, fee_entries, trust_events, reviews · disputes, no_show_tickets, case_updates, evidence · guests, guest_shares, health_details, consents · invitations, claims, scanner_grants, admissions · files, access_grants, ai_reports · notifications, deliveries, preferences · jobs, outbox, idempotency_keys, privacy_requests, sessions.
