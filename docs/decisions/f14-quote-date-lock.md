# F-14: Quote date lock is a capacity slot, not an exclusive hold

A sent quote takes one numbered slot in `public.quote_date_locks` for its
`service_date`. The vendor's `daily_capacity` (one integer per vendor house,
default 1, editable by the vendor owner only) decides how many slots that date
has. A quote sent to a date that is already full is **not refused**: it is
recorded with the next slot number and flagged `competing = true`, and both
houses are told the date is competing. Accepting a competing quote still records
the booking; resolving two accepted quotes for one day is F-38's job, not F-14's.

The owner approved this reading on 2026-11-04, which lifts the AGENTS.md block
"Block booking rollout until the quote-lock versus competing-hold interpretation
is approved." Nothing else was assumed: no advisory locks, no
one-capacity-unit-per-date guess.

Settled with the same answers:

- Expiry is a fixed 24-hour constant (`app_private.quote_expiry_interval()`), and
  re-sending a revised quote restarts it. A host counter does **not** restart the
  clock — the vendor's deadline to respond is unchanged.
- The deadline is server-owned. `app_private.apply_expiry()` runs on every read
  and action, and `public.expire_due_quotes()` exists for the F-72 scheduler; it
  is revoked from `public`, `anon` and `authenticated`.
- A date releases its slot when a quote expires, is declined or is withdrawn, and
  keeps it when accepted. Released slot numbers are reused.
- Only the vendor house authors quotes and revisions; every edit appends an
  immutable `quote_revisions` row. Totals are derived from the line items in the
  database and never trusted from the caller. Money is `bigint` minor units with
  an ISO-4217 currency column.
- Every state change carries `p_expected_version`; a mismatch raises
  `stale_version` so two people editing one quote cannot silently overwrite each
  other.

Verification: `supabase/tests/f14_quotes.test.sql` (22 sections) is written to run
in the CI database job. It could not be executed on the authoring machine, which
has no PostgreSQL server and no running Docker daemon. Do not describe F-14 as
built or secure until that suite and the audit have run.
