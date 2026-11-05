# 2026-11-04 · F-38 Vendor calendar soft-hold

Written **before any F-38 code**, per the owner's arrangement for this feature ("I write them into
the journal as a proposal for your approval before any code, then build to them"). Sage 7 returns
F-38 with `acceptance_criteria: []`, so the criteria below are the ones this build is tested
against. They come from the feature description, the owner's answers to the F-38 question set on
2026-11-04, and F-14 as it was actually built (`supabase/migrations/20261104120000_f14_quotes.sql`).

Feature description (Sage 7): *"Accepting a quote starts a 24-hour payment window and softly holds
the date; a vendor may engage multiple hosts on the same date but both are alerted, and the first
confirmed payment wins while the other is auto-refunded and shown alternatives."*

## Interpretations the owner settled on 2026-11-04

| # | Question | Owner's answer | What it means in this build |
|---|---|---|---|
| 2 | What happens to the date if a payment is still mid-process when the 24 hours end? | (a) the date releases at the deadline; a later payment is refunded | The window closes on server time. A confirmation that arrives after it never grants the date — it records a refund obligation instead. |
| 3 | Who records the payment confirmation? | (a) an internal authorized server function records it now; the Paystack `charge.success` path is wired with F-48 | `public.record_payment_confirmation(...)` is `security definer`, revoked for `anon`/`authenticated`, executable by the server role. A browser can never assert that it paid. |
| 4 | How is capacity modelled? | (a) one `daily_capacity` integer per vendor, default 1, owner-editable | F-14 already ships it. A date is "full" when `daily_capacity` holds are **confirmed**, not when the first one is. |
| 5 | How is the losing payment reversed? | (a) an immutable ledger row recording the obligation, no provider call; fee handling deferred | `public.refund_obligations` is append-only (like `quote_revisions`). Nothing here moves money; F-42/F-48 act on the row later. |
| 6 | How is anyone alerted? | (a) in-app notification row only, email later | `public.notifications` rows, written only from inside definer functions, read through an authorized projection. No email, no Resend call. |
| 7 | Window length? | (a) fixed 24-hour constant | `app_private.payment_window_interval()`, server-owned. No vendor override, no client timer. |
| Q1 (Sage answer) | Proceed with F-38 now? | "Hold F-38 until F-14 is specified and accepted, then build them as one sequence" | F-14 is specified, built and reported; Sage now returns F-38 with prerequisites satisfied. This branch is stacked on `feat/F-14-quote-lifecycle` so the two are reviewed and merged as one sequence. |

## Acceptance criteria — proposed, then built to

1. **The window starts on acceptance and nobody owns the clock but the server.** When a quote
   becomes `accepted`, a soft hold on that vendor's `service_date` is created with
   `payment_due_at = now() + 24h`. The hold is created by a trigger inside the database, so no
   client or later feature can accept a quote and skip the window.
2. **A confirmation cannot be claimed by a browser.** `record_payment_confirmation` is refused for
   `authenticated` and `anon`, and succeeds for the server role. Calling it for a quote that was
   never accepted, or for a currency that is not the quote's currency, is refused.
3. **First confirmed payment wins, race-safe.** Two simultaneous confirmations for competing holds
   on the same vendor+date are serialised on the vendor's `vendor_availability` row (the same lock
   `send_quote` takes). The earlier one is `confirmed`; the later one sees the date full, keeps the
   date released, and gets a refund obligation. `daily_capacity = 3` behaves the same way: the
   third confirmation fills the date, the fourth is refunded.
4. **The winner's date becomes a real booking hold.** Its F-14 `quote_date_locks` row stays live,
   and once the date is full, every still-unpaid soft hold on that date is released as `outbid`
   with both parties alerted. A host who had not paid gets no refund obligation (nothing was
   taken).
5. **The window closing releases the date.** When `payment_due_at` passes without a confirmation,
   the hold is released (`window_closed`), its date lock is released, both houses are alerted, and
   the slot is available to another quote again. The sweep runs on read (scoped to the caller's
   house) and unscoped through `release_lapsed_payment_holds()` for the future scheduler (F-72).
6. **A mid-process payment that lands after the deadline is refunded, not honoured.** The hold is
   already `released`; the confirmation records an obligation with `reason = 'late_payment'` and
   alerts the host. The date is never re-granted by a late payment.
7. **The ledger is immutable and idempotent.** `refund_obligations` rejects update, delete and
   truncate; one obligation per hold and per payment reference, so a retried webhook cannot
   double-record a refund. Re-confirming the same reference on a confirmed hold is a no-op that
   returns the same outcome.
8. **Both sides are alerted, in plain language, from server data.** A competing hold alerts both
   houses that another host is engaging the same date. An outbid host is alerted that the date was
   secured elsewhere and that a refund is on its way. Alerts are house-scoped rows; only a member
   who can read that house's quotes or calendar can see them.
9. **Money stays integer minor units.** Every amount is `bigint *_minor` with an ISO-4217 currency
   column; totals are never trusted from a caller; the audit rows carry identifiers, not offer
   contents or payment payloads.
10. **No direct writes, default-deny everywhere.** New tables get RLS enabled and forced, `select`
    for `authenticated` only, no write grants for `authenticated`/`anon`, and every read is scoped
    through an authorized projection function that checks the caller's house membership first.
11. **The UI reflects the states, with empty, loading and error paths.** A vendor Calendar view
    shows each date with its slots, capacity, confirmed / competing / window-closed states and a
    countdown derived from `payment_due_at`. The host sees the same window on the accepted quote,
    plus outbid and refund-pending copy. Alerts are listed with a mark-as-seen action. No client
    timer decides anything business-visible.
12. **Tests cover the behaviour, not the happy path.** SQL: acceptance creates the window;
    `authenticated` cannot record a payment; simultaneous and sequential competing confirmations;
    capacity 3; window close releases the date and frees the slot; late payment writes an
    obligation and no date; ledger immutability; idempotent retry; RLS scoping and anon refusal;
    audit and notification rows. Web: contracts, countdown copy, alert copy, and panel states with
    a stubbed API.

## What this slice deliberately does NOT do

- **No Paystack call of any kind.** Owner answer 3(a) and 5(a). `charge.success` wiring is F-48,
  and the actual reversal is F-42. The ledger row is the contract those features act on.
- **No "show alternatives" algorithm.** The description promises the losing host is shown
  alternatives; nothing in the built system can rank or recommend them (F-35 is unbuilt and
  blocked). The alert states the date is gone; computing replacements is recorded as an open
  question rather than invented here.
- **No deposit/partial-payment rule.** Whether a 70% deposit satisfies the window is F-15's
  decision; this build treats a confirmation as "the server says this quote's payment is
  confirmed" and records what was paid.
- **No email, SMS or push.** Owner answer 6(a).
- **No scheduler.** The unscoped sweep exists as a function for F-72 to call; nothing runs on a
  timer here.

## Dependencies and gaps

- **F-14 (this branch's base).** Holds attach to `quotes`, `quote_date_locks` and
  `vendor_availability`. Merging F-38 without F-14 leaves a migration that cannot apply.
- **F-48 Payment Router (unbuilt, and the owner's wallet/AI-router idea still needs an ADR).**
  Until it exists, `record_payment_confirmation` has no production caller. It is built and tested
  through the server role so the wiring is a call, not a rewrite. Regulated fund holding/routing
  stays disabled per AGENTS.md until licensing and partner arrangements are approved.
- **F-72 Automated Timed Jobs (unbuilt).** `release_lapsed_payment_holds()` waits for it; reads
  sweep their own house in the meantime.
- **`app_private.member_can` → `house_can`.** F-38 reuses the same local mirror as F-14 and switches
  over with it when pending F-78 is applied (see `docs/open-questions.md`).
- **Notifications vs F-24/F-31/F-3.** Those features own delivery channels, preferences and badge
  counts. F-38 only needs the row and an authorized read, which is what answer 6(a) approved.

## How it was checked

Ran in this environment (all against the F-38 working tree):

- `node node_modules/typescript/bin/tsc --noEmit` — clean for every F-38 and F-14 file. The only
  errors left in the repository are `Cannot find module '@auth0/auth0-spa-js' | 'jose' |
  '@sentry/react'` in `src/lib/auth/*` and `src/lib/monitoring/*`, plus two implicit-`any`
  parameters in `src/lib/monitoring/privacy.ts` that follow from the missing Sentry types. Those
  packages are in `package.json` but are not in `node_modules`.
- `node node_modules/eslint/bin/eslint.js src/features/holds src/features/quotes src/pages/HousePage.tsx`
  — no output, so lint (including the prettier rule) passed on everything F-38 wrote or changed.
  `eslint .` over the whole repository is **not** green and was not made green here: it reports 354
  pre-existing `prettier/prettier` errors in files this feature never touched
  (`src/integrations/supabase/*`, `src/routes/*`, `src/components/home/*`, `src/test/*` and others).
  That belongs to F-85 Test Suites / F-82 component library work, not to F-38, and fixing it would be
  the unrelated refactor AGENTS.md forbids.
- `node node_modules/prettier/bin/prettier.cjs --write` on the new and touched files.
- `node node_modules/vite/bin/vite.js build` — got as far as emitting asset bundles, then failed on
  the one unresolved import above (`@sentry/react` from `src/lib/monitoring/browser.ts`). That is
  the pre-existing install gap, not F-38: the build resolved F-38's module graph
  (`src/pages/HousePage.tsx` → `@/features/holds/*`) before reaching Sentry.

Could NOT be run — the gate is genuinely out of evidence, not assumed:

- `bun run test` (Vitest). `bun.lock` pins `vitest@4.1.11` but the installed tree carries
  `vitest@2.1.5` against `vite@8.1.5`; every suite, including F-14's, fails to collect with
  `ReferenceError: __vite_ssr_exportName__ is not defined`. Reproduced on
  `src/features/holds/contracts.test.ts`. So the eight new web tests are written but unexecuted.
- `bash supabase/tests/run-local.sh` — no Docker daemon and no `psql` on this machine, so the F-38
  SQL suite (`supabase/tests/f38_soft_hold.test.sql`) has never been executed. The races, the
  service-role refusal, the idempotent retry, the outbid refund and the RLS scoping are therefore
  asserted only by the text of that file. This is the main evidence gap for the feature.
- CI (`verify.yml`) — GitHub Actions refuses to start the job ("account is locked due to a billing
  issue"), so there is no hosted run either.
- The browser was not opened against a running app; the UI was not visually verified.

`bun install --frozen-lockfile` was retried for F-38 and still fails with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. TLS verification was not disabled to work around it, and no
package version was changed to make a gate pass.

Consequence, stated plainly: F-38 is coded, self-reviewed and committed with tests, and is not
verified. It is not "built", "ready" or "secure" — audit evidence decides that.

## Open

Recorded in `docs/open-questions.md` alongside F-14's.
