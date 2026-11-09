# 2026-11-09 · F-102 Fund Pool / Escrow

- **Feature:** F-102 Fund Pool / Escrow (`7aead243-21b6-4ba3-a436-9356b2683007`, must, category Core
  Workflows). The tracker names the wiring: `table fund_pool`, `table wallet_ledger`,
  `api POST /bookings/:id/payments`, `fn allocateSplitPayment`, `env PAYMENT_ROUTER_KEY`.
- **Acceptance criteria (confirmed):**
  1. Ledger allocates 70% at booking, 30% post-completion or 24h silence
  2. Active disputes block fund release
  3. All allocations reconcile against auditable wallet ledger
  4. Refunds and reversals leave no duplicate financial effects
- The plan was agreed with the owner before any code was written.

## Owner decisions taken before the build (2026-11-08/09)

1. **Scope** — "There is already paystack api payment rail so build everything needed." The Paystack
   rail is the only provider; no second processor was introduced.
2. **Table names** — "Both": the tracker's `fund_pool` and `wallet_ledger`, and the compliance
   spec's `ledger_accounts`, `journal_entries`, `postings`. The two live side by side: the
   double-entry ledger is the accounting truth, the wallet ledger is the readable trail.
3. **Commission** — 2.5% (250 bps) taken from the vendor's share. **Tax is pending**, so the tax
   rate is 0 bps until the owner sets it; the setting exists and the code path is written.
4. **Dispute freeze** — "Freeze flag set by an arbitrator". The freeze is a staff `arbitrator`
   grant, not a host or a vendor action.
5. **Refund scope** — the host may cancel their own booking **before the money is released**, and
   the refund covers the money the platform still holds.

## What the feature delivers

1. **A double-entry ledger.** `public.ledger_accounts`, `public.journal_entries` and
   `public.postings` hold the accounting. Every entry balances per currency, checked by a deferred
   constraint trigger (`postings_balanced` → `unbalanced_entry`). Entries are append-only: a
   correction is a reversing entry, never an edit.
2. **A booking and its money.** Accepting a quote creates a `public.bookings` row (a trigger, so no
   path can accept a quote without a booking to pay for) and a `public.fund_pool` row with the
   money's standing: held in escrow, released in two tranches, or refunded. A check constraint
   keeps the pool honest — `held + released_70 + released_30 + refunded = paid`, always.
3. **The 70/30 split.** `allocate_split_payment` posts the whole payment as a `booking_hold`
   entry, then releases 70% at booking confirmation (the vendor's net share plus the platform
   commission) and keeps 30% in escrow with a server deadline (`release_30_due_at`, 24 hours by
   default). The host completing the booking releases the rest; silence past the deadline lets
   `release_due_fund_tranches` sweep it.
4. **A dispute freezes the money.** `freeze_fund_pool` / `unfreeze_fund_pool` are arbitrator-only.
   A frozen pool is not released by the sweep, the host cannot complete it and the host cannot
   refund it; only staff with a finance or arbitrator grant may settle it.
5. **Refunds without double effects.** `request_fund_refund` records the obligation and the
   provider refund, `settle_refund` closes it against the ledger, and every step is keyed so a
   replay changes nothing.
6. **The provider events are idempotent.** `public.payment_events` is unique on
   `(event_type, reference)`, so a retried Paystack webhook is recognised (`duplicate`) instead of
   allocating twice.
7. **The trail the host reads.** `booking_fund`, `booking_movements`, `booking_payment_request` and
   `my_bookings` are the projections; the host panel (`PaymentsPanel`) shows the breakdown, the
   release deadline, the frozen notice, the payment link, the completion, the refund ask and the
   movements.

## The rules that live in the database

- `public.allocate_split_payment(booking, reference, amount, currency)` — the only way money is
  allocated. `service_role` only. Idempotent on the reference (`allocated` on a replay), refuses a
  second reference on the same booking (`payment_already_recorded`), an amount under the quote
  total (`payment_below_quote_total`) and a currency that is not the booking's
  (`currency_mismatch`).
- `public.record_payment_event(...)` — the webhook's own idempotency.
- `public.complete_booking(booking)` — the host's confirmation; releases the final tranche.
- `public.request_fund_refund(booking, reason)` / `public.settle_refund(booking, reference)` — the
  refund, then the settlement.
- `public.freeze_fund_pool(booking, reason)` / `public.unfreeze_fund_pool(booking)` — the
  arbitrator's freeze.
- `public.release_due_fund_tranches()` — the sweep that releases a 30% tranche 24 hours after the
  host said nothing. A frozen pool is skipped.
- RLS is enabled **and forced** on all seven new tables; `anon` reads nothing and no client writes
  the money tables directly. The caller-facing functions (`booking_fund`, `booking_movements`,
  `my_bookings`) are `authenticated` only and scope by house.

## The rules that live in the app

- `src/lib/payments/router.server.ts` is the **only** module that may move money, and it is behind
  `PAYMENT_ROUTER_KEY` — the platform's own gate, not a third-party credential. It never logs the
  key, and it calls the database with the service-role key because the money functions are
  `service_role`-only.
- `src/lib/payments/paystack.server.ts` keeps the Paystack secret server-side, verifies the
  HMAC-SHA512 signature on the raw body before anything is credited, and never leaks a provider
  refusal message to the browser.
- The user-facing routes forward the **caller's own bearer token** to PostgREST so the database
  decides who may see what; a `sb_secret_` key is refused on those routes.
- `src/lib/payments/currency.ts` holds the minor-unit table. No float money anywhere.

## The deviation from the spec's DDL

`postings.account_id` is `postings.ledger_account_id`. The F-60 credential guard treats any
`account_*` column as a bank account number and refuses it in a migration
(`src/lib/payments/credential-guard.test.ts`), so the column that holds a ledger account row id
is named `ledger_account_id`. This is the only place the spec's literal DDL was not followed.

## What changed

- `supabase/migrations/20261109140000_f102_fund_pool.sql` — `app_private.payment_settings`,
  `public.ledger_accounts`, `public.journal_entries`, `public.postings`, `public.bookings`,
  `public.fund_pool`, `public.wallet_ledger`, `public.payment_events`; the ten money functions; the
  projections; RLS enabled and forced on every new table.
- `supabase/tests/f102_fund_pool.test.sql` — 9 sections: accepting a quote creates the booking and
  its pool; the allocation and its split; the replay and the refusals; the completion; the refund
  and its settlement; the freeze; the provider-event idempotency; the append-only ledger and the
  balance check; and the house isolation (another house sees nothing, `anon` sees nothing, no
  client writes the money tables).
- `supabase/tests/db_state_check.sql` — the F-102 tables and functions added to the read-only
  "which migrations are actually present" check.
- `src/lib/payments/router.server.ts` — `paymentRouterKey`, `allocateSplitPayment`,
  `recordProviderEvent`, `settleRefund`, `releaseDueTranches`, `bookingForReference`,
  `startCharge`, `verifyCharge`, `sendRefund`, and the SQLSTATE classification.
- `src/lib/payments/paystack.server.ts` — the initialise, verify and refund calls against
  Paystack, with the secret read inside the call.
- `src/lib/payments/currency.ts` — the minor-unit table, `formatMoney` and `toMajorUnits`.
- `src/features/payments/contracts.ts` — the request schemas, the refusal copy, the fund-status
  and movement labels.
- `src/features/payments/server.ts` — the server handlers: the caller's token forwarded to the
  database, the payment, the verification, the completion, the refund and the freeze.
- `src/features/payments/api.ts` — the browser boundary.
- `src/features/payments/PaymentsPanel.tsx` — the host panel.
- `src/routes/api/bookings/$id/payments.ts` — `GET` the fund and the movements, `POST` start the
  payment.
- `src/routes/api/bookings/$id/complete.ts` — `POST` complete.
- `src/routes/api/bookings/$id/refund.ts` — `POST` refund.
- `src/routes/api/bookings/$id/freeze.ts` — `POST` freeze or unfreeze (staff).
- `src/routes/api/payments/verify.ts` — `POST` verify a reference.
- `src/routes/api/public/paystack/webhook.ts` — rewritten: the signature is verified, then the
  event is recorded and the allocation happens once.
- `src/pages/HousePage.tsx` — the Host house mounts the payments panel.

## Checks run

- `npx vitest run src/lib/payments src/features/payments` — 8 files, 143 tests passed.
- `npx tsc --noEmit` — clean.
- `npx eslint --fix src/lib/payments src/features/payments src/routes/api/bookings
  src/routes/api/payments src/routes/api/public/paystack` — clean afterwards.
- `npx eslint .` — the whole project still reports 761 pre-existing errors in files this feature
  did not touch (`src/test/permissions.test.ts`, `src/test/validate-token.test.ts`). They were left
  alone: a whole-tree rewrap is an unrelated refactor and CI is disabled (F-80, owner instruction
  2026-11-06).
- **A static shape check over every migration and SQL suite** (parentheses balanced inside function
  bodies, plpgsql `begin`/`end` blocks balanced, string literals properly terminated). It found and
  fixed three real defects in files that had never been executed:
  - `20261109120000_f101_ai_planner.sql:103` — one closing parenthesis too many in
    `ai_planner_cooldown_seconds()`, which stopped the F-101 migration at that line
    (`ERROR 42601: syntax error at or near ")"`).
  - `supabase/tests/f102_fund_pool.test.sql` — a stray `end;` after a `rollback;` in the
    unbalanced-entry section.
  - `supabase/tests/f102_fund_pool.test.sql:173` — an apostrophe inside a string literal that was
    not doubled (`provider's`), which ends the literal early.
- `npm run memory:check` and `npm run memory:update` — the map rows and fingerprints are current.
- `bash supabase/tests/run-local.sh` — **not run**: this machine has no Postgres 16+ binaries and
  the Docker daemon does not work here (the owner stopped it on 2026-11-08), so
  `f102_fund_pool.test.sql` has **never been executed**. It needs a machine with
  `initdb`/`pg_ctl`/`psql`, or `PG_BIN` pointing at them.
- CI is **disabled** in both repositories on the owner's instruction (2026-11-06, `40cf8a8e`), so
  no workflow has run for this feature.

## Not done / limits

- **The migration has not been applied to any database.** There is no database password or
  connection string in this repository, so the file was written and reviewed but never run.
- **The SQL suite has never been executed.** Every database-side claim in this entry is a claim
  about the SQL, not a test result.
- **The tax rate is 0.** The owner has not decided the rate or the base; `tax_bps` and `tax_base`
  exist and the code path is written, but nothing is taken until the owner sets it.
- **A host refund returns the money the platform still holds.** The 70% released at booking is the
  vendor's claim and is not clawed back, because recovering it would assume the vendor gives money
  back. The PRD's 80/20 forfeit on a host cancellation is F-20's policy and is not built here; the
  question is recorded in `docs/open-questions.md`.
- **"24 hours of silence" needs a job.** `release_due_fund_tranches()` is the sweep, but nothing
  calls it on a schedule; Trigger.dev (F-72) is not built. Until then the sweep can only be run by
  hand.
- **No payout rail.** The vendor's share is credited to `vendor_payable` in the ledger; nothing
  moves it to a bank account. That is F-48 (Payment Router & Banking Integrations), which is
  blocked on the owner's licensing and provider decisions — see Q10.
- **The large-amount second approval is not built.** `large_amount_threshold_minor` is null because
  "large" has never been defined (F-47).
- **The payments kill switch is a row, not a process.** `app_private.payment_settings.payments_paused`
  stops new allocations; nothing reads it in the app yet.
- **The Paystack dashboard callback URL must be set** to `/api/public/paystack/webhook` (or the
  absolute equivalent) in each environment before the webhook will arrive. This is a deployment
  step, not code.

## Open questions raised by this build

1. **F-13 booking table.** `public.bookings` is created here because the tracker names a booking
   payment route. F-13 (Direct Search & Book Flow) also plans a booking table. If F-13 builds its
   own, one of them must be dropped rather than kept in parallel.
2. **The 80/20 forfeit.** The PRD says a host cancelling within 24 hours of payment gets 80% back
   and forfeits 20% of the quote. F-102 refunds only the money still held. F-20 owns the
   cancellation penalty.
