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

## Gates actually run on 2026-11-05

| Gate | Result |
|---|---|
| `npx vitest run` (whole repo) | 11 of 15 files collect; **99 tests pass, 0 fail**. The 4 that fail to load are the React component suites, and they fail on `Cannot find module '@testing-library/dom'` — a required peer missing from `node_modules` and the lockfile, not a code failure. |
| `npx vitest run src/lib/payments/credential-guard.test.ts` | 35 tests, all pass |
| `npx tsc --noEmit` | no error in any F-60 file. The remaining errors are `@testing-library/react` member exports (same missing peer) and `copy.server.ts` importing `ai`/`@ai-sdk/openai`, which are not installed. See Q11. |
| `npx eslint` on changed files | run, see the commit note |
| `bash supabase/tests/run-local.sh` (F-14, F-38, F-60 SQL) | **not run — cannot run here.** No `initdb`/`psql` on this machine and the Docker daemon is down, so the throwaway Postgres the suites need does not exist. The SQL is written to be executed, and is unverified until someone with Postgres runs it. |
| GitHub Actions | not run: the account is behind a billing lock, and `npm ci` would fail on the nonexistent AI SDK versions (Q11) |

One real defect was found while trying to run the SQL suites: `supabase/tests/f38_soft_hold.test.sql`
called `public.create_quote` with 6 arguments for a 7-argument function (currency was missing at all
10 call sites). It is fixed in this branch. That suite has never been executed anywhere, which is
the reason it was still passing inspection while being wrong — the honest answer to "did the
database tests run" is still no.
