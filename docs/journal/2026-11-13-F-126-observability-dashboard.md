# 2026-11-13 · F-126 The operations dashboard

## What the audit found

The F-126 claim was graded **partial**. The audit note read: *"Monitoring browser, config,
privacy files exist but no unified observability dashboard"*, and the evidence was
`src/lib/monitoring/browser.ts`, `src/lib/monitoring/config.functions.ts` and
`src/test/monitoring.test.ts`.

The audit was right about the monitoring module and right about the gap. What exists is the
observability tool's *ingestion* half: the browser SDK, the DSN and environment configuration
through a server function, and the privacy scrubber that redacts every exception before it
leaves the app. None of that is a dashboard. Nothing in the platform answered the question the
blueprint asks — "payment ambiguity, reconciliation differences, overdue timers, refund backlog,
verification SLA breaches, notification failures, search freshness" — and nothing showed a person
that something needed them.

## What was delivered

- `supabase/migrations/20261112140000_f126_observability_dashboard.sql`
  - **`public.observability_dashboard()`**, one function that reads the platform's operational
    records and answers with counters. It is `SECURITY DEFINER`, it checks the caller, and it is
    the only way in: the tables it reads are revoked from every application role.
  - **Twelve signals, each one grounded in a column that exists today**: `payment_ambiguity`
    (`payment_events.outcome is null`), `webhook_lag_minutes` (the age of the oldest such
    event), `reconciliation_differences` (`fund_pool.paid_minor` against the ledger's `'in'`
    movements), `overdue_release` (`release_30_due_at` in the past, money still held, not
    frozen), `refund_backlog` (`status = 'refund_pending'`), `frozen_money`, `failed_charges_24h`,
    `payment_windows_closed` (a window that closed unpaid), `open_cases`, `ai_needs_human`,
    `unread_alerts` and `sensitive_reads_24h`.
  - **Access is the existing `operations` capability.** No capability was invented: `operations`
    already exists and already means the platform-operations role in blueprint/tech-spec.md §14.
  - **Every read is audited.** One `observability.viewed` row per read, naming the staff grant
    that was exercised.
- `supabase/tests/f126_observability_dashboard.test.sql` — the SQL suite (written, unexecuted).
- `src/lib/monitoring/sentry.server.ts` — the observability tool's own numbers, read server-side
  through Sentry's management API. The token is server-only, never logged and never in a URL; a
  failure to reach Sentry is not a failure of the dashboard.
- `src/features/observability/` — `contracts.ts`, `api.ts`, `server.ts` and `ObservabilityPanel.tsx`
  with their tests.
- `src/routes/api/observability.ts` and `src/routes/observability.tsx` — the route and the page.
- `docs/decisions/f126-observability-dashboard.md` — the decisions above, in one place.

### The dashboard says what it cannot measure

The blueprint lists nine things the dashboard should show. This platform can measure five. The
rest belong to features that are not built: update latency (nothing records it), retry
exhaustion (F-73 has no job records), verification SLA (F-53 has no review queue), scanner
conflicts (F-62), deletion backlog (F-58), and on-call alert delivery (F-73 — the blueprint
calls it a launch requirement).

So the panel carries a "Not measured yet" section that names each gap and the feature that owns
it. A dashboard that quietly showed four counters would read as a healthy platform, and that
reading would be wrong.

### Counts, not money and not people

The function's result carries a key, a label, a count, a sentence and a severity. No amount, no
currency, no party name, no email address, no provider reference and no house identifier leaves
the database through it. Reading the dashboard is not a way to read a booking, and the SQL suite
asserts exactly that against the function's own signature.

Severity is a reading rule, not a threshold: a signal that says money is unaccounted for is
`critical`, a queue of work is `attention`, a count of activity is `info`. No number on the
dashboard decides whether money moves.

## How it was checked

- `node scripts/sql-shape-check.mjs` on the new migration and the new suite: shape OK.
- `npx vitest run` (whole suite): 60 files / 551 tests passed.
- `npx tsc --noEmit`: clean.
- `npx eslint` on the touched files: clean.
- `npm run build`: built, and `src/routeTree.gen.ts` regenerated with the two new routes.
- **Not run here:** `supabase/tests/run-local.sh`. This machine has no PostgreSQL server and the
  owner has said Docker does not work on this system, so the SQL suite could not be executed. It
  runs in the `database` job of `.github/workflows/verify.yml`. The SQL in this change is
  therefore **unexecuted**: it has been written to be read, not proven to run.
- **Not run here either:** the Sentry management call. No Sentry credentials exist on this
  machine, so the call has never touched a live Sentry project. Its behaviour is covered by
  tests against a stubbed network, which is not the same thing as a working integration.
- `supabase/tests/f126_observability_dashboard.test.sql` (written, unexecuted) asserts, over its
  own fixtures: the dashboard is closed to a caller with no grant, to a support member and to an
  outsider; `anon` and `service_role` cannot execute it at all; the operations lead's read
  returns the twelve expected counts, including that a frozen pool past its deadline counts as
  frozen and *not* as an overdue release; the read is on the audit trail and a refused read
  leaves nothing behind; the function's signature carries no amount, currency, email, name,
  provider reference or house identifier; the tables behind it cannot be selected directly by
  an application role; revoking the grant closes the dashboard again; and reading the dashboard
  moved no money.

## Not done, and why

- **The migration is not applied to any database.** It has never run. The function is unverified
  until the CI database job and the audit have run.
- **The dashboard is read-only on purpose.** It counts and explains. It does not release a hold,
  settle a refund, close a case or rerun a job: those actions belong to the features that own
  them, and a dashboard that could act would be a second, worse way to move money.
- **No alert delivery.** The blueprint calls an assigned on-call owner and tested alert delivery
  launch requirements; F-73 owns them and neither is built.
- **Two optional environment variables were added** for the Sentry management API:
  `SENTRY_ORG` and `SENTRY_PROJECT`, beside the already-approved server-only
  `SENTRY_AUTH_TOKEN` (blueprint/tech-spec.md §13 lists `SENTRY_AUTH_TOKEN` among the
  server-only variables). Sentry is the approved observability tool (ADR-14), so this is
  configuration for an existing service, not a new one. All three are optional: without them
  the dashboard says error tracking was not available.
