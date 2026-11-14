# 2026-11-14 · F-109 Fund Pool / Recovery Fund

- **Feature:** F-109 Fund pool/recovery fund (`must`, Core Workflows). The tracker names the
  wiring: `api POST /funds/allocate`, `api POST /funds/release`, `table fund_pool_ledger`,
  `fn calculateSplitAllocation`, `env FUND_POOL_WALLET_ID`, `call services/payment_router ->
  reconcileLedger`.
- **Acceptance criteria:**
  1. Fund pool holds 70% booking and 30% completion splits
  2. Dispute holds freeze balances pending judgement
  3. Recovery advances release 50% replacement cost
  4. Auditable ledger reconciles with payment router
- The first two criteria are F-102's and are read, not rebuilt: the split is now calculated by
  the database and the dispute freeze is F-102's `frozen` flag.

## What the feature delivers

1. **The recovery fund itself.** `public.recovery_actions` is one state machine for both kinds of
   recovery money: a `clawback` (money taken back from a vendor that did not deliver) and an
   `advance` (money paid to a host out of the fund, for a replacement booking). The states are
   `requested → approved → settled`, with `refused` and `void` as the two ways out. One table, so
   a request cannot be approved by a rule that exists for one kind of money only.
2. **Two distinct approvals before any money moves.** `public.recovery_approvals` holds one row
   per person per action. `approve_recovery_action` refuses the person who asked for the money,
   counts a person once, and only the second distinct approval moves the request to `approved`.
   A refusal refuses it outright. The large-amount threshold is still unapproved, so every
   manual fund action needs two (blueprint/architecture.md:232).
3. **The advance is exactly half the replacement cost.** `request_recovery_advance` works the
   amount out in SQL — `(cost * 50) / 100` — and a check constraint refuses any advance that is
   not half of its replacement cost (blueprint/prd.md:102). The caller never names an amount.
4. **The clawback cannot exceed what the platform still owes.** The ceiling is the vendor
   house's `vendor_payable` balance, because that is what the platform holds against the vendor
   across its bookings. Money already paid out cannot be taken back, and the request is refused
   with `nothing_to_recover` when the balance is short.
5. **The fund is funded only by money already taken back.** `app_private.recovery_fund_balance`
   is the balance of the `recovery_fund` platform account. An advance may not exceed
   `least(the fund, what the provider can still send back from that booking)`, so an advance the
   fund cannot cover is refused and goes to the people who decide — never half paid
   (blueprint/prd.md:182).
6. **The trail of the recovery money.** `public.fund_pool_ledger` records every movement against
   a pool. It is the trail, not the truth: the amount lives in the journal entry and the row
   names it. The table is append-only, like the ledger itself.
7. **The reconciliation.** `public.reconcile_ledger` compares the provider's events with the
   ledger and the pools, and writes the outcome down in `public.ledger_reconciliations`. It moves
   no money and repairs nothing: it names the disagreement and a person decides. Only finance or
   operations staff may ask for a run (`public.can_run_reconciliation`).
8. **The split is calculated by the database.** `public.calculate_split_allocation` returns both
   tranches and the commission and tax of each, so the app asks the database instead of
   repeating the arithmetic.
9. **A sweep for the last 30%.** `public.release_due_tranche` lets staff release a booking's
   final tranche whose completion window has closed. It is not a discretionary fund action: the
   rules decide, and the function only reports what happened (`released`, `not_due`, `frozen`).
10. **The console.** `src/features/funds/` holds the boundary (the browser reads the database's
    own projections and writes only through the app's routes), the contracts and the panel. The
    panel shows what the fund holds, the requests and their approvals, the pools waiting for
    their last payment, the money of a case before anyone types an amount, the recovery trail
    of that pool, the split of a booking total and the outcome of a reconciliation.

## The rules that live in the database

- `public.request_recovery_clawback(case, amount, reason, wallet)` — staff with an arbitrator or
  finance grant ask for money to be taken back. Refused above the vendor's balance.
- `public.request_recovery_advance(case, replacement_cost, reason, wallet)` — staff with a
  support or finance grant ask for half of a replacement. Refused when the fund cannot cover it.
- `public.approve_recovery_action(action, decision, note)` — one of the two finance approvers.
- `public.settle_recovery_action(action, provider_reference)` — the money moves. `service_role`
  only: the server asks the provider to send the money and then records it.
- `public.void_recovery_action(action, reason)` — a request that is not wanted. Nothing has moved,
  so nothing is posted.
- `public.recovery_payout_target(action)` — what the platform needs in order to pay: the amount,
  the currency, the provider's reference for the charge and whether the fund can still cover it.
- `public.reconcile_ledger()` — the provider against the ledger. `service_role` only.
- `public.release_due_tranche(booking)` — the last tranche of a booking whose window has closed.
- `public.calculate_split_allocation(total, currency)` — the split, with the fees of each tranche.
- The projections the console reads: `recovery_fund_balances`, `list_recovery_actions`,
  `recovery_case_context`, `fund_pool_ledger_entries`, `due_fund_pools`.

Every one of them is a `security definer` function with `set search_path = ''`. The four tables
are revoked from every application role, RLS is enabled and forced on them, and no client reads
or writes them directly.

## The rules that live in the app

- The browser reads through the database's own projections, as the signed-in person, and every
  action that moves money goes through the app's own routes with the caller's own token, so the
  database decides what the caller may do.
- The two places the platform acts as itself — paying an advance and running a reconciliation —
  go through `src/lib/payments/router.server.ts`, the only place in the app that may move money.
- `FUND_POOL_WALLET_ID` is read by the server and handed to the database. The browser never
  chooses it and never sees it.
- The provider's reference for the money sent to a host stays on the server: the browser asks
  for a settlement and the server pays with it.
- Every refusal is turned into a sentence for the person, and the raw database text is not
  returned.

## What changed

- `supabase/migrations/20261114120000_f109_recovery_fund.sql` — the migration: four tables
  (`recovery_actions`, `recovery_approvals`, `fund_pool_ledger`, `ledger_reconciliations`), the
  recovery functions, the projections, the rewritten `settle_refund` and `record_payment_event`,
  and the `journal_entries` kinds `recovery_clawback` and `recovery_advance`.
- `supabase/tests/f109_recovery_fund.test.sql` — the SQL suite (15 sections).
- `src/features/funds/` — `contracts.ts`, `api.ts`, `server.ts`, `FundsPanel.tsx` and their
  tests.
- `src/routes/funds.tsx` and `src/routes/api/funds/{allocate,release,recovery,approvals,settle,reconcile}.ts`.
- `src/lib/payments/router.server.ts` — `reconcileLedger` and `settleRecoveryAction`.
- `src/lib/payments/currency.ts` — `toMinorUnits`.
- `.env.example` — `FUND_POOL_WALLET_ID`.
- `src/routeTree.gen.ts` — regenerated for the new routes.

### A defect repaired on the way

`20261112100000_f14_counter_response_deadline.sql` rewrote `notifications_kind_check` without
F-102's `fund_released`, `fund_frozen` and `fund_refunded` kinds, so **every payment allocation
would have failed** on the notification it writes. F-109 puts the fund kinds back and adds
`fund_advanced`. The migration also keeps the `journal_entries` kinds in step.

## Checks run

- `npx vitest run` — 75 files, 727 tests passed (the four F-109 files are 66 of them).
- `npx tsc --noEmit` — clean.
- `npx eslint` on the F-109 files — clean. (`npx eslint .` still reports the ~820 pre-existing
  prettier errors in files this feature did not touch; CI does not run eslint, so a whole-tree
  rewrap was left alone.)
- `npm run build` — the route tree regenerated for the six new routes.
- **A defect in the F-102 suite was found and fixed** (`test(F-102): date the freeze in the past
  so the unfreeze deadline can hold`): the suite moved the completion deadline back an hour
  *after* freezing the pool, then unfroze it and asserted the deadline was in the future again.
  `unfreeze_fund_pool` moves the deadline by the time the money was held, so a freeze lasting
  milliseconds could never undo an hour: the assertion could not hold, and because
  `supabase/tests/run-local.sh` runs every suite against **one shared database** and stops at the
  first failure, F-102 would have aborted the run before F-109's suite was reached.
- `bash supabase/tests/run-local.sh` — **not run**: this machine has no Postgres 16+ binaries and
  the Docker daemon does not work here (the owner stopped it on 2026-11-08), so
  `f109_recovery_fund.test.sql` has **never been executed**. It needs a machine with
  `initdb`/`pg_ctl`/`psql`, or `PG_BIN` pointing at them.

## Not done / limits

- **The migration has not been applied to any database**, and the SQL suite has never been
  executed. Every database-side claim in this entry is a claim about the SQL, not a test result.
- **The recovery funding policy is still open.** An advance the fund cannot cover is refused.
  What happens then — escalation, a top-up, a partial advance — is the owner's decision, and it
  is recorded in `docs/open-questions.md`.
- **Where the money is held is still open (Q10).** The escrow records money Paystack holds; that
  is not a claim that the platform is licensed to hold funds.
- **The clawback ceiling is the house's balance, not the booking's.** A vendor with three
  bookings has one pooled claim. If the platform needs the claim to be per booking, the ledger
  account has to change — a decision for the owner, not a rule this build invented.
- **No payout rail.** The money an advance sends goes back through Paystack as a partial refund
  of the original charge. Nothing else moves money (F-48 is blocked on the licensing answer).
- **The 24-hour sweep has no scheduler** (F-72), so a member of staff runs the release by hand.
- **The recovery fund holds no money of its own.** It is funded only by money taken back from
  vendors, so until the first clawback is settled, every advance is refused.

## Open questions raised by this build

1. **What happens to an advance the recovery fund cannot cover?** The PRD asks for human
   escalation without guarantees; this build refuses and says so on screen. The owner's policy
   for the refused case is what is missing.
2. **Should the clawback ceiling be the booking's or the vendor house's?** It is the house's,
   because that is how the ledger is built (F-102). A per-booking ceiling would need a per-
   booking vendor payable account.
