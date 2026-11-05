# 2026-11-05 · F-60 Payment Data Protection (Tokenization via Partner)

Sage 7 returned F-60 with empty acceptance criteria and the standard blocker note. The spec's own
scope was ambiguous between two very different builds — refusing credentials, and running a wallet —
so the split was put to the owner as a question. The owner's answer (Sage 7 question `0bf44f83`,
2026-11-05) is what this file is written against:

> "Approve the protection-only slice now: enforce and prove no raw card/bank credential can ever
> enter storage, logs or Sentry; no money state, no licence needed. But this feature shouldn't be
> forgotten. AI payment router is key."

So this branch builds the **protection half only**. The wallet half stays unbuilt and is now
`docs/open-questions.md` Q10 — a wallet is fund holding, which needs the licence/partner arrangement
and F-48's router decision. Recorded as a decision rather than assumed: nothing here stores, moves
or authorises money.

## What "protection" means here, concretely

Paystack keeps the card. Ówàńbè is only ever supposed to hold a partner reference (`psp_…`,
`access_code`, `card_token`). The risk is not that someone steals a PAN we never intended to keep —
it is that a developer, a webhook handler or an alert template pastes one in and it silently becomes
a regulated data set. So the rule is enforced where a write actually happens, and separately where a
log line is produced.

One rule, expressed twice, deliberately kept in step by cross-reference in both files:

| Where | File | Mechanism |
|---|---|---|
| Storage | `supabase/migrations/20261105120000_f60_payment_data_protection.sql` | `app_private.looks_like_payment_credential(text)` + `jsonb_has_payment_credential(jsonb)`, used by 7 CHECK constraints |
| Process | `src/lib/payments/credential-guard.ts` | the same detector, plus `sanitizeForLog`/`redactPaymentCredentials`, wired into `console.error` in `src/lib/error-capture.ts` and into the Paystack webhook's event name |
| Sentry | `src/lib/monitoring/browser.ts` + `privacy.ts` | already strict (`beforeBreadcrumb: () => null`, allowlisted `beforeSend`); the console sink it can inherit is now scrubbed too |

A CHECK constraint rather than a trigger, because a constraint is visible in the schema itself — that
is the artefact an auditor can rely on without reading function bodies — and because it covers every
path, including `security definer` functions and features that do not exist yet.

## The rule, and why it is narrower than "any long number"

Refused:

1. 12–19 digits that satisfy the ISO 7812 (Luhn) checksum — every real card does;
2. four groups of four (`4242 4242 4242 4242`, dashed or dotted) — refused even when the checksum is
   nonsense, because a person typing a card types it in groups;
3. a 7–18 digit run quoted next to `account`/`acct`/`transfer to`/`beneficiary` — a bank account;
4. any object key in the credential vocabulary (`pan`, `card_number`, `cvv`, `iban`, `bvn`, `nin`,
   `password`, `api_key`, …) at any depth, whatever its value.

Deliberately allowed, each with a test that pins it:

- `psp_ada_1`, `access_code`, `card_token` — partner tokens are exactly what we are allowed to keep;
  a first draft of the key pattern refused `card_token`, which would have broken the payment path;
- `1730000000000` (epoch milliseconds), `2026-11-05 09:00:00.000`, `invoice 20261105120000`, uuid
  hex, `NGN 100000`. A second draft treated `:` and `/` as card separators, which made a timestamp a
  19-digit run — every legitimate audit write would have aborted. Separators are space, dot and dash
  only, and the checksum is what decides.
- `houses.display_name`, `users.display_name`, `users.email` — not payment sinks, and a business can
  legitimately be named something that reads as a digit run. Stated in the migration, not left as an
  accident.

## Acceptance criteria built to

1. **No credential column exists, and none can be added unnoticed.** The suite scans every
   `create table` block in `supabase/migrations` for credential-shaped column names, and fails with
   the offending `file: column`. Currently zero. (`credential-guard.test.ts`, "proof of absence".)
2. **The service role cannot store a card in a payment reference.** F-38 validated only length, so a
   PAN was acceptable. `record_payment_confirmation(quote, '4242424242424242', …)` now aborts, leaves
   the hold `awaiting_payment` with a null reference, writes no refund obligation and no
   `payment.confirmed` audit row — and the same call with `psp_f60_ada_1` still returns `confirmed`.
   A guard that blocks payments is a defect, so the passing case is asserted in the same suite.
3. **The free-text sinks people actually type into are covered.** Both payment references, the offer
   title and message, the closing note, alert title/body/payload, and audit details/purpose — each
   with its own named, validated constraint, each refused for real in the SQL suite.
4. **A stray credential cannot reach a log.** `console.error` masks credential-shaped values in
   strings, arrays and nested objects, and turns a credential-named key into
   `[redacted payment credential]`. The Paystack webhook handler repeats nothing from a signed body
   except an event name, and only when it is a bare identifier (`safeEventName` → `unknown`
   otherwise); the body itself is parsed, discarded, and never stored or forwarded.
5. **The roles that write can evaluate the rule; `anon` cannot.** A CHECK runs with the privileges of
   the writing role, so `authenticated` and `service_role` are granted execute on the detectors and
   `anon` is refused — asserted both ways.
6. **Nothing moves money.** No provider call, no balance, no settlement, no refund execution. F-42
   and F-48 act on the ledger later.

## Why the SQL gap could not be closed from here (and what to run instead)

The owner applied `20261104000000_f78_permission_scoping.sql` by hand today and Postgres answered:

> `ERROR: 42723: function "owner_only_capabilities" already exists with same argument types`

That is not a defect in F-78. The file declares `app_private.owner_only_capabilities()` exactly once,
at line 12, so 42723 means the function was **already in that database** — the file had been applied
before, while it sat in `supabase/pending/` carrying the note "apply through the migration tool once
the project's Supabase is connected", and F-78 was audited built on 2026-11-04. Because the statement
that failed is the *first* one, the re-run aborted immediately and changed nothing; it did not
half-apply. What stays unknown is whether the original apply got through all eleven functions.

Two things blocked a direct answer from this machine, both recorded rather than worked around:

- `https://<ref>.supabase.co/rest/v1/` fails certificate verification here. The same
  TLS-intercepting proxy that blocked `npm install` earlier today. Verification was **not** disabled
  and no CA was exported from the system store to route around it.
- The repository points at two different hosted projects: `supabase/config.toml` declares
  `project_id = "voaseybakdiohzhvmait"` while `.env.local`'s `SUPABASE_URL` is
  `faiknjzbpaxrsedmhbsn.supabase.co`. A hand-pasted migration therefore lands in whichever dashboard
  tab happens to be open — which is how a duplicate apply happens in the first place. Raised as a
  question, not decided here.

`supabase/tests/db_state_check.sql` is the replacement for "trust me": read-only, plain SQL with no
psql metacommands, so it can be pasted into the Dashboard SQL editor. It returns which objects from
F-77/F-14/F-38/F-60/F-78 exist, the F-78 signatures with argument types and `prosecdef`, and every
public table's `relrowsecurity` plus its policy count. Run it against the project that is meant to be
production, then apply the migrations in order for anything it reports missing.

One consequence worth repeating for the audits: **the F-14, F-38 and F-60 SQL suites are still
unexecuted.** The new unit-test evidence does not touch them, and no part of the database half of
F-60 should be called verified until `db_state_check.sql` and the suites have been run somewhere with
Postgres.

## Gates actually run on 2026-11-05

| Gate | Result |
|---|---|
| `npx vitest run` (whole repo) | **15 of 15 files, 134 tests, all pass.** Earlier in the day this same command could only collect 11 files and 99 tests: the 4 React suites died on `Cannot find module '@testing-library/dom'`, a peer that was missing from both the manifest and the lockfile. The owner pinned `ai@^6` / `@ai-sdk/openai@^3` / `@testing-library/dom@^10` and installed on a clean network (commit `3d89d2d`), which is what made them executable. |
| `npx vitest run src/lib/payments/credential-guard.test.ts` | 35 tests, all pass |
| `npx tsc --noEmit` | **clean, zero errors** (previously it reported the missing peer and the uninstalled AI SDK imports in `copy.server.ts`) |
| `npm run build` | **green** — `vite build` completed and nitro emitted `.output` |
| `npx eslint` / `npm run format` | **not run at the time** — `eslint` and `prettier` are declared in `devDependencies` but were not present in `node_modules`, and installing them from this machine hits the TLS-intercepting proxy that blocked every download that day. Formatting was matched by hand against the surrounding files. <br> **Addendum, later the same day:** the owner's install brought both tools, and they were then run on the F-60 files — `credential-guard.ts`, `error-capture.ts`, `QuoteBuilder.tsx` and the three component suites are all clean. One line in `src/routes/api/public/paystack/webhook.ts` still differs from the declared `printWidth: 100` (1 error), left alone rather than mixed into an unrelated branch. Repo-wide lint is not clean for a configuration reason, not a code reason — see `docs/journal/2026-11-05-F-80-ci-install-and-test-load-gate.md` and Q14. |
| `bash supabase/tests/run-local.sh` (F-14, F-38, F-60 SQL) | **still not run — cannot run here.** No `initdb`/`psql` on this machine and the Docker daemon is down, so the throwaway Postgres the suites need does not exist. The SQL is written to be executed, and is unverified until someone with Postgres runs it. |
| GitHub Actions | not run: the account is behind a billing lock |

## What running the suites for the first time found

Six assertions failed the moment the four React suites became executable. None of the six was an
F-60 problem; all of them were tests that had never been run since they were written.

| Test | Real cause | Fix |
|---|---|---|
| `QuotesPanel` builder: create never called, and two wrong alert texts | `newQuoteSchema` validates `host_house_id`/`vendor_house_id` as **uuids**, but the fixtures used `"host-1"`/`"vendor-1"`, so the builder refused its own submit and displayed "Invalid uuid" where the test expected the server-refusal copy | fixtures now use real uuid constants (`HOST_HOUSE_ID`, `VENDOR_HOUSE_ID`) and the assertions reference them |
| `QuotesPanel` "stops an incomplete offer before it reaches the database" | **a real defect, not a test bug.** A named line with a non-numeric amount became `line_total_minor: 0` in `toLines`, the zod schema happily accepted `0`, and the amount check lived only inside the `if (!parsed.success)` branch — so the vendor silently quoted that line as free work | the amount check in `QuoteBuilder.submit()` now runs whether or not the schema passed, and blocks the submit |
| `VendorCalendarPanel` "Slot 1 of 1 per day" | the component capitalises and ends with a full stop; the assertion did not | match the rendered text |
| `VendorCalendarPanel` paid amount | assertion regex was `/1,?2500\.00/` for `1_250_000` minor → `12,500.00` — a typo that could only ever have failed | `/12,?500\.00/` |
| `HouseAlerts` first row | `getByTestId("alert-row")` with three rows rendered throws on the multiple-match guard | `getAllByTestId("alert-row")[0]` |

The lesson for F-80 CI is the same one the SQL suites already taught: a test file that cannot load is
not a passing test, and the suite count is the thing to watch, not the failure count.

## Open consequence for F-80 (CI)

`npm install` still resolves into an ERESOLVE conflict — a `peerOptional` wants `@types/react@^18`
while the app is on `@types/react@19.2.17`. `--legacy-peer-deps` installs cleanly and every gate then
passes, so the conflict is benign today, but CI cannot rely on a flag nobody wrote down. F-80 needs
an explicit owner decision between a committed `.npmrc` with `legacy-peer-deps=true` and pinning the
`@types/react` peer. Raised as a decision, not decided here.

One real defect was found while trying to run the SQL suites: `supabase/tests/f38_soft_hold.test.sql`
called `public.create_quote` with 6 arguments for a 7-argument function (currency was missing at all
10 call sites). It is fixed in this branch. That suite has never been executed anywhere, which is
the reason it was still passing inspection while being wrong — the honest answer to "did the
database tests run" is still no.

