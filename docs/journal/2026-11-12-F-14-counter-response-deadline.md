# 2026-11-12 · F-14 Counter-response deadline

## What the audit found

The audit on the previous commit called F-14's date lock "not confirmed in code". That
was wrong — `public.quote_date_locks`, `send_quote`, `release_lock` and
`app_private.apply_expiry()` all exist and are exercised by
`supabase/tests/f14_quotes.test.sql`. What was genuinely missing was the one part of
the F-14 spec that had no answer at all: **"What stops a vendor from ignoring a
counter-offer?"** The spec's answer is a deadline, and the code had none. A counter
(`public.counter_quote`) set `status = 'countered'` and left `expires_at` alone, so the
vendor's original 24 hours simply kept running: a host could counter, and the quote
could still die of an ordinary expiry rather than of a decision. The F-14 journal and
`docs/open-questions.md` Q1 both recorded this as unanswered.

## What was delivered

- `supabase/migrations/20261112100000_f14_counter_response_deadline.sql`
  - `public.quotes.counter_response_due_at`, set by `counter_quote` to
    `now() + app_private.quote_counter_response_interval()` (a fixed 24 hours, the same
    constant as the offer deadline; no per-vendor override).
  - `quotes_state_shape` re-created so each state names the deadline that governs it:
    a `sent` quote waits on `expires_at`, a `countered` quote waits on
    `counter_response_due_at`, and neither can exist without one. Quotes already
    countered when the file landed get a fresh window — the moment they were countered
    is recorded nowhere, so the migration time is the only honest starting point.
  - `app_private.apply_expiry()` re-created: a countered quote is judged on the vendor
    deadline, not on the deadline the send set. On expiry the date lock is released
    (`release_reason = 'expired'`) and the audit row records
    `reason = 'vendor_response_overdue'`, so an ignored counter is distinguishable
    from an offer that ran out of time on its own.
  - The host gets a house alert of kind `counter_ignored` (`public.notifications`, the
    F-38 table — extended, not duplicated) saying their counter went unanswered and
    the date is free again.
  - `public.send_quote()` clears the counter deadline and restarts the 24-hour offer
    deadline: the vendor's re-send is what answers the counter. A revision that is
    not re-sent does not.
  - `public.my_quotes()` re-created with `counter_response_due_at` in its projection.
- `src/features/quotes/api.ts`: `QuoteSummary.counter_response_due_at`.
- `src/features/quotes/contracts.ts`: `counterDeadlineLabel(side, countdown)` — the
  vendor sees "You have 9h 1m to respond", the host sees "The vendor has 9h 1m to
  respond", and both are told the date is released afterwards.
- `src/features/quotes/QuoteCard.tsx`: a countered quote renders the counter deadline
  instead of the stale offer deadline, with `data-deadline="counter"` on the countdown.
- `supabase/tests/f14_counter_response.test.sql`: 7 sections over its own fixtures.
- `docs/decisions/f14-counter-response-deadline.md` and the updated Q1 in
  `docs/open-questions.md`.

## How it was checked

- `npx vitest run src/features/quotes`: 39 tests passed across 3 files (6 new: three
  panel tests for the counter deadline, two contract tests for the label, and the
  existing suite).
- `npx vitest run` (whole suite): 57 files / 521 tests passed.
- `npx tsc --noEmit`: clean.
- `npx eslint` on the five touched TypeScript files: clean.
- `node scripts/sql-shape-check.mjs` on the new migration and the new suite: shape OK.
- `npm run memory:check`: ✓ memory bank current (319 files indexed, 12 docs).
- **Not run here:** `supabase/tests/run-local.sh`. This machine has no PostgreSQL
  server (`/usr/lib/postgresql/*/bin` is absent) and the owner has said Docker does not
  work on this system, so the SQL suite could not be executed. It runs in the
  `database` job of `.github/workflows/verify.yml`, which installs PostgreSQL 16 and
  applies every migration to a disposable database. The SQL in this change is
  therefore **unexecuted**: it has been written to be read, not proven to run.

## Not done, and why

- **"Show the host relevant alternatives."** The spec's sentence ends with it, and it
  is not built. Listing other vendors for that date needs vendor discovery and a
  relevance rule (F-13 Direct Search, F-35 Emergency Replacement, F-27 Best Bargain
  Ranking), none of which exist; an invented "similar vendors" query would be an
  unapproved commercial ranking, and F-22 Trust Score is not built to feed one. The
  host is told the date is free again and that they can ask the vendor or look for
  another vendor. Recorded in Q1 and in the same gap Q5 records for F-38.
- **No reminder, penalty or ranking consequence** for a vendor who lets the window
  close. That would be a new business rule, which is the owner's to make; F-23 and
  F-22 own it.
- **The backfill bumps `quotes.version` on quotes that were already countered**, because
  `app_private.touch()` increments the version on every update. A client holding a
  stale version gets `stale_version` and re-reads. That is the intended optimistic
  concurrency behaviour, not a silent overwrite.
- **F-14's `app_private.member_can` mirror was not switched to `app_private.house_can`**
  (Q3). F-78's file has moved into `supabase/migrations/`, so the switch-over is now
  possible, but it touches every F-14 policy and function and belongs to its own
  change, not to this one.

## Open

- The SQL suite has not run. F-14's deadline is unverified until the CI database job
  and the audit have run.
