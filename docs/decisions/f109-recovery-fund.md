# F-109: The recovery fund takes money back, advances half of a replacement, and writes down what disagrees

The blueprint leaves "recovery funding" as an unresolved policy gate and asks for two things it
does decide: a human-approved advance equal to 50% of the replacement cost
(blueprint/prd.md:102), and two distinct authorized staff approvals for every manual fund action
until the large-amount threshold is approved (blueprint/architecture.md:232). This file builds
what those lines allow and invents no funding policy: the money an advance pays comes from money
that was already taken back, and an advance the fund cannot cover is refused rather than half
paid (blueprint/prd.md:182).

**Decisions**

1. **The advance is exactly half the replacement cost, and the database computes it.**
   `request_recovery_advance` takes the cost of the replacement and works out
   `(cost * 50) / 100` itself; the caller cannot name an amount. A check constraint on
   `recovery_actions` refuses any advance that is not half of its replacement cost, so no path
   can post one that is.

2. **Two distinct finance approvals, and the requester may not be one of them.** The
   large-amount threshold is still unapproved, so *every* manual fund action needs two
   approvals (blueprint/architecture.md:232). `approve_recovery_action` counts one row per
   person per action, refuses the person who asked for it, and only the second distinct
   approval moves the request from `requested` to `approved`. A refusal refuses it outright.

3. **The clawback ceiling is the house's balance, not the booking's.** `vendor_payable` is a
   house-level ledger account, so the money the platform still owes a vendor is what that house
   has been credited with across its bookings. A clawback is refused above that balance
   (`nothing_to_recover`): the platform cannot take back money it has already paid out, and it
   cannot take back more than it holds.

4. **A clawback needs no provider call; an advance is a partial refund of the original
   charge.** Money taken back from a vendor stays with the provider — it is simply not paid out
   — so the clawback moves the ledger only. An advance sends the host money, so it is a refund
   of the charge they paid, and the provider's own refund reference is recorded on the action.
   The provider's confirmation of that refund is then news the ledger already has:
   `record_payment_event` recognises it and settles nothing twice.

5. **The fund is funded only by money already taken back.** `app_private.recovery_fund_balance`
   is the balance of the `recovery_fund` platform account, and an advance may not exceed
   `least(the fund, what the provider can still send back from that booking)`. When the fund
   cannot cover it, the request is refused with `insufficient_recovery_funds` and goes to the
   people who decide — no partial advance, no promise.

6. **The 70/30 split is calculated by the database only.** `calculate_split_allocation` returns
   both tranches and the commission and tax of each, so the app asks the database rather than
   repeating the arithmetic in the browser. The tax line is still 0 because the owner has not
   decided the rate or the base.

7. **The reconciliation is read-only and writes down what disagrees.**
   `reconcile_ledger` compares the provider's events with the ledger and the pools, records the
   outcome in `ledger_reconciliations`, and moves no money and repairs nothing. Only finance or
   operations staff may ask for a run (`can_run_reconciliation`), and the run itself is the
   platform's own sweep, so it goes through the payment router.

8. **The provider's reference for the money sent to a host never reaches the browser.**
   `recovery_payout_target` names it, and the function is granted to `authenticated` only for
   finance staff — but the app's own route reads it server-side and pays with it. The browser
   asks for a split, an approval or a settlement, and never holds a reference.

9. **The recovery fund wallet is configuration, not a choice.** `FUND_POOL_WALLET_ID` is read by
   the server and handed to the database; the browser never sends it and never sees it.

10. **The notification kinds were repaired.** F-14's migration (20261112100000) rewrote
    `notifications_kind_check` without F-102's `fund_released`, `fund_frozen` and `fund_refunded`
    kinds, so a payment allocation would have failed on the notification it writes. F-109 puts
    them back and adds `fund_advanced`.

**What stays open**

- **Where the money that was taken back is actually held.** The escrow records money Paystack
  holds; that is not a claim that the platform is licensed to hold funds. This is Q10 in
  `docs/open-questions.md` and stays open.
- **The funding policy for an advance the fund cannot cover.** This file refuses it. What
  happens then — an escalation, a top-up, a partial advance — is the owner's decision.
- **The large-amount threshold.** Until "large" is defined, every manual fund action needs two
  approvals (F-47).

**Verification**: the application layer is green (the console's boundary, the panel and the
route boundary are covered by Vitest; the TypeScript check and the lint of the touched files are
clean). The SQL suite has **not** been executed: this machine has no PostgreSQL server and the
owner has said Docker does not work on this system, so `supabase/tests/f109_recovery_fund.test.sql`
is written to be read, not proven to run.
