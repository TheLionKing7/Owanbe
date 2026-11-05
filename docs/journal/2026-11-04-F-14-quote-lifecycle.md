# 2026-11-04 · F-14 Quote lifecycle & date lock

## Acceptance criteria — proposed here, then built to after the owner approved the F-14 build

Sage 7 returns `acceptance_criteria: []` and `wiring: []` for F-14 (`44aaba1d-f666-41b5-9819-547d25f732d4`),
so these are written here for approval before the build is treated as the specification. Everything below
comes from the feature spec, `AGENTS.md`, and the owner's answers on 2026-11-04; nothing is invented.

1. **Only a vendor authors a quote.** A draft can be created and edited only by an active member of the
   Vendor house holding the `quotes` capability. A Host-house caller gets `42501` (forbidden).
2. **A quote is a set of immutable revisions.** Every edit appends a new numbered revision — in a
   draft as much as after a counter — and `quotes.current_revision` points at the latest one. A
   revision that exists is never rewritten or deleted (`quote_revisions` is append-only in the
   database), so what a host saw is what the audit trail still holds.
3. **Money is integer minor units + currency.** `currency` is ISO-4217, `total_minor` is `bigint >= 0`,
   line items carry `line_total_minor`, and the revision total must equal inclusions + extras (checked in
   the database, not in the browser).
4. **Sending a quote locks the date.** Sending sets `sent_at`, `expires_at = sent_at + 24 hours`
   (fixed constant, owner answer 7a) and creates one live row in `quote_date_locks` for that
   vendor house + service date. The lock is released only on expiry, decline or cancellation.
5. **Capacity is one integer per vendor house** (owner answer 4a): `vendor_availability.daily_capacity`,
   default 1, editable by the vendor **owner** only, audited on change. A lock takes the next free slot;
   slots above `daily_capacity` are still recorded but marked **competing** rather than rejected, so
   F-38 can alert both parties and let the first payment win (owner answers 2a/5a).
6. **A host may accept, decline or counter.** Accept moves `sent|countered -> accepted` and keeps the
   date locked. Decline moves to `declined` and releases the lock. Counter moves to `countered`, adds a
   host-authored revision and a message, and keeps the running clock — a host cannot extend a vendor's
   offer by countering.
7. **A revised quote restarts the 24-hour clock.** When the vendor re-sends after a counter, a new
   revision is appended, `sent_at`/`expires_at` are reset and the state returns to `sent`.
8. **Expiry is server-authoritative.** A quote whose `expires_at` has passed is expired by the database
   before any read or action, and its lock is released. The UI renders the countdown from `expires_at`,
   never from a browser-owned timer.
9. **Optimistic concurrency.** Every transition takes `p_expected_version`; a stale version fails with
   `40001` rather than silently overwriting.
10. **No client writes.** RLS is enabled and forced, `anon` cannot read, `authenticated` gets `select`
    only, and every mutation goes through a `security definer` function with `set search_path = ''`.
    Each transition writes an `audit_events` row with identifiers only.

## Interpretations the owner settled on 2026-11-04

- **Quote lock vs competing hold.** `AGENTS.md` blocks booking rollout until this is approved. The owner
  approved competing-hold semantics for F-38 (release at deadline, later payer refunded, immutable
  ledger obligation, no provider call). F-14 therefore implements the *lock* as a capacity slot: up to
  `daily_capacity` slots are exclusive, and further quotes for the same date are recorded as competing
  instead of being refused or silently assumed to fit. F-38 builds the alerting and the refund ledger on
  this table; F-14 does not move money.
- **Counters do not restart the clock** (spec: "revised quotes restart the 24-hour expiry clock"; a
  counter is not a revised quote).
- **Still unanswered in the spec:** *"What stops a vendor from ignoring a counter-offer?"* Nothing is
  implemented here. F-23 (Quote Counter-Offer Controls) is only `planned` and F-22 (Trust Score) is
  blocked, so no penalty, escalation or reminder is invented. Today a vendor may simply let the quote
  expire; the host sees the expiry and can re-enquire. Logged in `docs/open-questions.md`.

## Dependencies and gaps

- `dependencies: ["Vendor service catalog", "Vendor calendar"]`. Neither exists in the tree. F-14
  carries the minimum its own spec needs: `vendor_availability` (capacity) and `quote_date_locks`
  (the calendar lock). A vendor **service catalog** (reusable priced items a vendor picks from) is not
  built; the quote builder takes typed line items instead. That is recorded as a gap, not a substitute.
- `supabase/pending/20261104000000_f78_permission_scoping.sql` is **not applied**, so `house_can()`
  does not exist in the migration order. F-14 defines
  `app_private.member_can()` with the same semantics (owner: everything; staff: granted capabilities,
  never payouts/members/billing; revoked/unknown: nothing) and must be switched to `house_can()` when
  the pending migration is applied.
- No notification table exists, so counter-offers and expiries raise no in-app notice here; F-24 /
  F-31 own delivery. The audit log is the only record.

## What was built

- `supabase/migrations/20261104120000_f14_quotes.sql`: `vendor_availability`, `quotes`,
  `quote_revisions` (append-only trigger), `quote_date_locks`; RLS enabled and forced on all four,
  `authenticated` gets `select` only, every mutation runs through a `security definer` function with
  `set search_path = ''`. Server functions: `create_quote`, `revise_quote`, `send_quote`,
  `counter_quote`, `accept_quote`, `decline_quote`, `cancel_quote`, `set_vendor_daily_capacity`,
  plus the read projections `my_quotes` and `quote_history`. Expiry is applied by
  `app_private.apply_expiry()` on every read and action, and `public.expire_due_quotes()` is the
  scheduler entry point (revoked from `public`, `anon` and `authenticated`).
- `src/features/quotes/contracts.ts`: the trust-boundary validation (zod) and the pure domain rules
  the UI mirrors — money in integer minor units, the 24-hour constant, `actionsFor(status, side)`,
  and `countdownFrom()` which only describes a deadline the server set.
- `src/features/quotes/api.ts`: the persistence boundary. One narrow cast over `supabase.rpc`, a
  `QuoteError` carrying a classified code, and plain-language copy for each refusal.
- `src/features/quotes/QuoteCard.tsx`, `QuoteBuilder.tsx`, `QuotesPanel.tsx`: the host and vendor
  quote views, wired into `/host/quotes` and `/vendor/quotes` through `src/pages/HousePage.tsx`, with
  loading, empty and error states, the competing-date warning, the revision history, and the
  vendor-owner capacity control.
- `docs/decisions/f14-quote-date-lock.md` records the approved capacity-slot reading; the four open
  items are in `docs/open-questions.md`.
- `supabase/tests/f76_auth.test.sql`: one assertion counted every row in `public.users`. The suites
  share one database and run in filename order, so `f14_quotes.test.sql` now runs before it and its
  fixtures made that count wrong. The assertion is scoped to F-76's own two subjects; no behaviour
  changed. Any future lower-numbered feature would have hit the same fragility.

## How it was checked

- `tsc --noEmit`: clean for every F-14 file and for `src/pages/HousePage.tsx`. The only errors
  elsewhere are `Cannot find module` for `@auth0/auth0-spa-js`, `jose` and `@sentry/react`, which are
  not installed on this machine.
- `eslint src/features/quotes src/pages/HousePage.tsx`: no errors, no warnings.
- `prettier --write` applied to the F-14 files.
- **Not run here:** `bun run test`, `bun run build` and `supabase/tests/run-local.sh`. The working
  tree's `node_modules` is stale and incomplete (`vitest` 2.1.5 against `vite` 8.1.5, so even the
  pre-existing suites fail with `__vite_ssr_exportName__ is not defined`), `bun install` cannot
  complete because the registry's TLS leaf signature cannot be verified on this network, and TLS
  verification was not disabled. There is no PostgreSQL server and the Docker daemon is not running,
  so the SQL suite could not be executed either. `.github/workflows/verify.yml` runs
  `bun install --frozen-lockfile`, `bun run test`, `bun run build` and the disposable-database SQL
  suite on the pull request; that is the verification path for this change.

## Open

- The four questions in `docs/open-questions.md` (counter-offer enforcement, the host-house entry
  point, the `member_can` → `house_can` switch-over, and quote-line validation against a service
  catalogue).
- The migration is not applied anywhere. F-14 is unverified until the CI suites and the audit have run.
