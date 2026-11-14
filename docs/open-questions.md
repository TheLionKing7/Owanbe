# Open questions

Unanswered questions that block or shape work. Each entry names the owner, the
affected feature, the status and the release impact. Approved answers move to
`docs/decisions/`.

## F-14 Quote Lifecycle & Date Lock

### Q1. What stops a vendor from ignoring a counter-offer?

- **Owner:** Ola (product owner)
- **Status:** **answered 2026-11-12** — the feature spec's own answer is now built:
  a host counter starts a 24-hour vendor response deadline; if the vendor neither
  revises nor declines by then, the quote expires, the date lock is released and
  the host is told their counter went unanswered. See
  `docs/decisions/f14-counter-response-deadline.md`.
- **Affected:** F-14 (counter path), F-23 Quote Counter-Offer Controls (`planned`),
  F-22 Trust Score System (blocked), F-24 Multi-channel Notification Delivery (blocked)
- **Release impact:** the counter is recorded as a host-authored revision with a
  required message, and it now starts the vendor's own 24-hour window
  (`quotes.counter_response_due_at`). The expiry is audited as
  `vendor_response_overdue` and raises a `counter_ignored` alert in the host
  house. **Still not built:** the "show the host relevant alternatives" half of
  the spec answer — listing other vendors for that date needs vendor discovery
  and a relevance rule (F-13, F-35, F-27), the same gap Q5 records for F-38. The
  host is told the date is free again and that they can ask the vendor or look
  for another vendor. No reminder, penalty or ranking consequence was
  implemented, because inventing one would put an unapproved business rule into
  the database.

### Q2. Where does a vendor get the host house ID to quote for?

- **Owner:** Ola
- **Status:** open — dependency, not a design choice
- **Affected:** F-14 (vendor quote builder), F-19 Unanswered Enquiry Fallback
  (blocked), F-13 Direct Search & Book Flow (blocked)
- **Release impact:** the quote builder at `/vendor/quotes` asks the vendor to
  paste a host house ID, and says on screen why. It also accepts
  `?host=<uuid>&date=<yyyy-mm-dd>` so an enquiry rail can prefill it later. No
  mock enquiry list was built. Until F-19 or F-13 lands, a vendor cannot start a
  quote from inside the product without knowing the host house ID.

### Q3. When does `app_private.member_can` become `app_private.house_can`?

- **Owner:** Ola
- **Status:** open — sequencing
- **Affected:** F-14, F-78 Permission Scoping (`supabase/pending/`)
- **Release impact:** F-78's migration is still pending, so F-14 ships a local
  mirror of the same role matrix under a different name. When the pending F-78
  file is applied, the mirror must be dropped and F-14's policies and functions
  switched to `app_private.house_can` / `require_house_capability`, otherwise two
  copies of the permission rules drift apart.

### Q4. Which vendor services may a quote line name?

- **Owner:** Ola
- **Status:** open — dependency
- **Affected:** F-14 (typed line items), F-5 Unified Vendor House, vendor service
  catalogue (no feature code yet)
- **Release impact:** quote lines are free text with a checked length and a
  non-negative minor-unit amount. There is no catalogue to validate them against,
  so "Best price" or a misspelt service is accepted. Nothing was invented to fill
  the gap.

## F-38 Vendor Calendar Soft-hold

### Q5. How is a "show alternatives" list produced for the host who lost the date?

- **Owner:** Ola (product owner)
- **Status:** open — the feature text promises it, the spec does not define it
- **Affected:** F-38 (losing-host experience), F-35 Emergency Replacement Vendor
  Recommendation (blocked), F-27 AI 'Best Bargain' Ranking (blocked), F-4 (search)
- **Release impact:** F-38 records the outbid release, the refund obligation and a
  `date_outbid` alert saying the date is gone. It does not list replacement
  vendors, because ranking candidates needs F-35/F-27 and an approved relevance
  rule. Inventing a "similar vendors" query would be an unapproved commercial
  ranking, and Trust Score (F-22) is not built to feed one.

### Q6. What amount actually satisfies the 24-hour payment window?

- **Owner:** Ola (product owner)
- **Status:** open — depends on the approved 70/30 release rules
- **Affected:** F-38 (`record_payment_confirmation`), F-15 Split Payment &
  Completion Confirmation (blocked), F-42 Losing-bid Refund (blocked)
- **Release impact:** the built function treats any server-recorded confirmation as
  satisfying the window and stores what was paid (`paid_minor` + currency). It does
  not compare the amount to the quote total, so a deposit — if F-15 allows one —
  secures the date exactly like a full payment. Whether it should is F-15's
  decision, not something F-38 may assume.

### Q7. What happens to a second, different payment for a quote that is already secured?

- **Owner:** Ola (product owner)
- **Status:** open — needs the provider's behaviour, which F-48 owns
- **Affected:** F-38 refund ledger, F-48 Payment Router (unbuilt), F-42 (blocked),
  F-60 Payment Data Protection (blocked)
- **Release impact:** `record_payment_confirmation` is idempotent per payment
  reference and refuses a second, different reference on a confirmed hold with
  `payment_already_recorded` — it does not write a refund obligation, because a
  refusal at that boundary does not prove money was taken. Once Paystack is wired,
  the webhook may still report a charge that the database refused; reconciling that
  (refund it, or reject the webhook) has to be decided with F-42/F-48, and the
  owner's wallet plus AI-powered router still needs an ADR before any real fund
  holding or routing is activated.

### Q8. Whose job is it to run `release_lapsed_payment_holds()`?

- **Owner:** Ola (product owner)
- **Status:** open — scheduling, not design
- **Affected:** F-38, F-72 Automated Timed Jobs (blocked), F-73 Real-time Job
  Monitoring (blocked)
- **Release impact:** a lapsed window is released as soon as either house reads its
  own projections, so the calendar is never lying. Nothing releases a date nobody
  looks at: the unscoped sweep is a `service_role` function with no caller until
  F-72 registers it with Trigger.dev.

### Q9. Do these alert rows belong to F-24, F-31 and F-3?

- **Owner:** Ola (product owner)
- **Status:** open — overlapping feature ownership
- **Affected:** F-38 (`public.notifications`), F-24 Multi-channel Notification
  Delivery (blocked), F-31 Notification Channel Preferences (blocked), F-3
  Cross-house Alert Badges (blocked)
- **Release impact:** F-38 writes house-scoped in-app rows and reads them back
  through `my_notifications`; the unread count shown next to "Date alerts" is only
  for that list. There is no email/push, no per-user channel preference, and no
  cross-house badge. Those three features will want the same table; whoever builds
  next should extend it rather than create a second notifications store.

### Q10. Does Ówàńbè ever hold money, and under what licence?

- **Owner:** Ola (product owner)
- **Status:** open — regulated, cannot be decided by an engineer
- **Affected:** F-60 Payment Data Protection (protection half built 2026-11-05), F-48 Payment
  Router & Banking Integrations (unbuilt), F-42 Losing-bid Refund (blocked), F-49 Backup Payment
  Processor, F-47 Large-fund second approval
- **Release impact:** the owner approved F-60 as a protection-only slice and said "this feature
  shouldn't be forgotten. AI payment router is key." What is built proves no raw card or bank
  credential can enter storage, logs or Sentry. What is *not* built is the other half of F-60 —
  wallet balances and transaction records — because a wallet is fund holding. `refund_obligations`
  therefore records who is owed what and moves nothing. Before any ledger table exists, the owner
  needs the licence/arrangement answer (held funds, settlement, NIBSS/open-banking access) and then
  F-48's provider choice. Until both exist, a losing payment is a manual refund, and the UI must
  keep saying so in plain language.

### Q11. Which AI SDK versions does this project actually depend on?

- **Owner:** Ola (product owner)
- **Status:** **answered 2026-11-05** — the owner pinned and installed the versions
- **Affected:** F-80 CI (next task), F-85 Test Suites, F-86 Error Reporting, F-12/F-46 AI features,
  `src/features/vendor-profile/copy.server.ts`
- **Answer applied:** `ai@^6.0.184`, `@ai-sdk/openai@^3.0.64` and the missing
  `@testing-library/dom@^10.4.0` peer, committed by the owner as `3d89d2d`. The nonexistent `^7`/`^4`
  ranges are gone. Measured after the install: `tsc --noEmit` clean, `npm run build` green, and all
  15 vitest files collect with 134 tests passing — the 4 React suites that previously could not load
  now run, and 6 of their assertions failed on first execution (see
  `docs/journal/2026-11-05-F-60-payment-data-protection.md`). `copy.server.ts` compiles against the
  AI SDK v6 surface unchanged, so no feature code had to move.

### Q12. What should CI do about the `@types/react` peer conflict?

- **Owner:** Ola (product owner)
- **Status:** **answered 2026-11-05** — Sage 7 question `53116a71`: "Commit .npmrc with
  legacy-peer-deps=true"
- **Affected:** F-80 CI, F-85 Test Suites, any fresh clone
- **Answer applied:** `.npmrc` with `legacy-peer-deps=true` is committed, and the CI application job
  installs with `npm ci` against `package-lock.json`. Two consequences are written into
  `docs/journal/2026-11-05-F-80-ci-install-and-test-load-gate.md` rather than left implied: npm no
  longer warns when a future dependency really is peer-incompatible (the lockfile is the authority,
  not the peer graph), and `npm ci` itself has still never been executed by an agent — the registry is
  unreachable from this machine through the TLS-intercepting proxy, and certificate verification was
  not disabled.

### Q13. Which lockfile is real: regenerate `bun.lock` or drop it?

- **Owner:** Ola (product owner)
- **Status:** open — blocks a reproducible install for anyone who follows `bunfig.toml`
- **Affected:** F-80 CI, F-79 deployment, any fresh clone, and the 24-hour supply-chain guard in
  `bunfig.toml` (`minimumReleaseAge = 86400`), which npm does not enforce
- **Release impact:** the repo carries two lockfiles that disagree. `bun.lock` still pins
  `ai@7.0.162` and `@ai-sdk/openai@4.0.108`, versions the registry does not publish, while
  `package.json` pins `^6.0.184` / `^3.0.64` and `package-lock.json` resolves them. CI now uses the
  npm one. `bun install --frozen-lockfile` cannot be repaired from here (registry blocked, security
  check left on), so `bun.lock` needs either a real `bun install` on a machine with registry access or
  deletion. Leaving it means a bun-based install silently produces a tree that cannot match
  `package.json`, and dropping it loses the 24h freshness guard unless an npm equivalent (a lockfile
  age check, or `npm ci` against a reviewed lock) is adopted at the same time.

### Q14. What is the house print width — and does CI run lint at all?

- **Owner:** Ola (product owner)
- **Status:** open — formatting configuration, blocks adding lint to CI
- **Affected:** F-80 CI, F-82 UI Component Library, F-83 Brand Design System, every future PR diff
- **Release impact:** `.prettierrc` came from the template with `printWidth: 100`, but the code in the
  repo is written to roughly 120: `npx eslint .` reports 743 `prettier/prettier` errors and 11
  `react-refresh` warnings, while `npx prettier --print-width 120 --check .` flags zero files. CI
  therefore has no lint or format step, because it would fail on its first run over formatting rather
  than correctness. Two ways out, both owner calls: set `printWidth` to what the code already is, or
  keep 100 and accept one whole-tree rewrap commit that touches every feature's files. Related and
  smaller: `.prettierignore` omits Markdown, so documentation files are flagged too.

## F-102 Fund Pool / Escrow

### Q15. Which booking table is the real one — F-102's or F-13's?

- **Owner:** Ola (product owner)
- **Status:** open — sequencing, must be settled before F-13 is built
- **Affected:** F-102 (built), F-13 Direct Search & Book Flow (`blocked`), F-20 Host Cancellation
  Policy, F-42 Losing-bid Refund, F-54 Disputes & Refunds Console
- **Release impact:** F-102's tracker names a booking payment route (`api POST
  /bookings/:id/payments`), so `public.bookings` was created in
  `supabase/migrations/20261109140000_f102_fund_pool.sql` — one row per accepted quote, with the
  host house, the vendor house, the service date, the total and the status. F-13 also plans a
  booking table for the direct search and book flow. If F-13 builds its own, two booking tables
  will exist with two different shapes, and the fund pool, the refunds and the disputes will point
  at one of them. Whoever builds F-13 must extend this table rather than create a second one, or
  the owner decides which table is dropped.

### Q16. What does a host who cancels within 24 hours actually get back?

- **Owner:** Ola (product owner)
- **Status:** open — policy, and it is the PRD's rule against F-102's conservative behaviour
- **Affected:** F-102 (built, conservatively), F-20 Host Cancellation Policy, F-42 Losing-bid
  Refund & Reversal Flow, F-15 Split Payment & Completion Confirmation
- **Release impact:** the PRD says a host cancelling within 24 hours of payment gets 80% back and
  forfeits 20% of the full quote. F-102 refunds only the money the platform still holds: the 70%
  released to the vendor at booking stays the vendor's claim, because clawing it back would assume
  the vendor gives money back — which the platform cannot promise (AGENTS.md: "Reconcile refund
  obligations with already-released funds; do not assume partner recovery is available"). The
  forfeited 20% and the 80% figure are F-20's policy and were not invented here. A host who
  cancels therefore gets the still-held 30% back, not 80% of the quote. The panel says so in plain
  language rather than promising the PRD's number.

## F-106 Market benchmark data

### Q17. Where do benchmark prices come from once the quotes are not enough?

- **Owner:** Ola (product owner)
- **Status:** open — the owner chose the derived path for F-106; an external provider is still a
  policy gate
- **Affected:** F-106 (built, derived from quotes), F-27 AI 'Best Bargain' Ranking, F-8 Personalised
  Dashboard, F-46 AI Investigation-only Role, the PRD's benchmark-provenance gate
- **Release impact:** the PRD treats "benchmark provenance" as a policy gate and the tech spec
  lists "benchmark sources" as an open question. F-106 therefore derives every benchmark from a
  quote a vendor actually sent (owner decision 2026-11-09: "Provenance = quote id + vendor +
  observed_at = quote sent date. Nothing fabricated, no new service needed"), and publishes a range
  only when two or more vendors hold a current price in the same place and category. That means a
  new market shows "Not enough published prices yet" for a long while, and no external price feed
  is used. If the owner later wants an outside benchmark — a scraped or paid market index, a
  category price guide — it needs a provider decision, a licence and its own provenance rules
  (who may see the raw feed, how it is refreshed, what happens when the feed disagrees with the
  quotes), and it must not be blended into the quote-derived range without saying which is which.



## F-108 Ticketing system

### Q19. How long may an offline door device keep admitting from its cache?

- **Owner:** Ola (product owner)
- **Status:** **answered** (asked 2026-11-13, answered 2026-11-13). The decision is
  `docs/decisions/f108-offline-cache-window.md`: the offline cache is bounded by the **door
  window** (the grant's own expiry, which the host sets), a device that has never synced or
  whose window has closed admits nobody and answers `needs_sync`, and the door has one
  reconciliation action — **sync the door** — that sends the waiting check-ins and fetches the
  guest list again. No new threshold was invented; the platform's answer still wins whenever
  the platform can be reached. The residual exposure is written down in the decision: while the
  device is dark it cannot see a revocation, so the window is the bound on that.
- **Detail:** The scanner's cache holds **hashes** of the admission credentials, never the
  credentials themselves, and a scan is hashed on the device before it is compared. That is the
  protection that lets the device work with no network. What is *not* settled is how a cache
  behaves once the authority behind it has gone: a host who revokes a scanner grant, an
  invitation the host revokes, or a card whose admission has expired will still match a hash
  the device cached while it was offline. Today the cache is bounded by the **grant's** expiry,
  and a queued check-in is reconciled against the database when the network returns — a check-in
  the database refuses is refused in the reconciliation, not accepted silently. What is missing
  is the owner's rule for the window itself: how long a cached hash may be trusted, whether the
  device must wipe its cache on a revocation it learns about, and whether a door that has been
  offline across a revocation must refuse the next scan rather than admit it.
- **Affected:** F-108 Ticketing system (built; the door app under `mobile/`), F-16 Dispute
  Filing & Arbitration, F-17 Vendor No-show Recovery (both read the check-in record), F-33
  No-show Ticket & Evidence Flow
- **Release impact:** the door device can admit a guest the platform has since stopped
  admitting, and the check-in is recorded — so the record and the truth can differ until the
  device is online. The **check-in row** says which it was (`mode` = `online` or
  `queued_offline`), so the disagreement is visible rather than hidden, but it is not resolved
  by the code. Recommendation: bound the cache by the grant's expiry **and** require a
  reconciliation pass before a device is trusted again after a revocation, rather than letting
  the offline window be however long the outage was.

## F-107 OwanbeAI

### Q18. Who confirms the zero-data-retention contract, and with which provider?

- **Owner:** Ola (product owner)
- **Status:** **answered 2026-11-10** (Sage 7 question `3e793b14`): "Lovable has ZDR and gpt also
  has ZDR in place so this is okay to function now." The gate is open, recorded by
  `supabase/migrations/20261110203000_f107_open_zdr_gate.sql`. F-65 stays open — the contract
  paperwork is a separate feature.
- **Affected:** F-107 OwanbeAI (built, the gate is now open), F-65 Zero Data Retention (ZDR) for
  AI Models (`blocked`), F-46 AI Investigation-only Role, any future AI surface that reads
  sensitive data
- **Release impact:** the platform talks to one AI gateway (`ai.gateway.lovable.dev`, model
  `openai/gpt-6-astra`), and the owner confirms that both the gateway operator and the model
  vendor hold a zero-data-retention agreement. `app_private.ai_settings` holds the record and
  `app_private.ai_zdr_confirmed()` reads it; the table is still revoked from every application
  role, so no application path can open or close the gate — the owner can, and the migration
  records that act. The trail is still minimised in the database and every read is still a
  sensitive read with a purpose, so what reaches the model is unchanged: money and state, never a
  person and never a provider reference. **Not** answered by this: whether the platform should
  *verify* the contract rather than record it (a signed document the platform checks, or a
  contractual setting it can read), and the retention deadlines for other data (F-39 Record
  Retention Policy, F-59 Health Data Protection) — F-65 owns the first, the others own the rest.


## F-109 Fund pool / recovery fund

### Q20. What happens to a recovery advance the fund cannot cover?

- **Owner:** Ola (product owner)
- **Status:** open — policy, not a build choice
- **Affected:** F-109 Fund pool/recovery fund (built), F-17 Vendor No-show Recovery (blocked),
  F-16 Dispute Filing & Arbitration (blocked), F-20 Host Cancellation Policy (blocked)
- **Release impact:** the recovery fund is funded only by money already taken back from vendors,
  and an advance may not exceed `least(the fund, what the provider can still send back from that
  booking)`. When it cannot be covered the request is **refused** with
  `insufficient_recovery_funds` and the console says "The recovery fund cannot cover this, so it
  has gone to the people who decide". The PRD asks for human escalation without guarantees
  (blueprint/prd.md:182), and this build implements the refusal, not the escalation. Until the
  owner answers, a host whose replacement cannot be funded gets nothing from the platform, and
  the case has to be handled by staff outside the product. Recommendation: decide the escalation
  path (who is notified, in which surface, and whether the host is told anything) and whether a
  partial advance is ever allowed — the current build refuses rather than half pays, and that
  refusal should stay until the owner says otherwise.

### Q21. Is a clawback capped by the booking or by the vendor house?

- **Owner:** Ola (product owner)
- **Status:** open — consequence of F-102's ledger, not of F-109
- **Affected:** F-109 Fund pool/recovery fund (built), F-102 Fund pool/escrow (built), F-16
  Dispute Filing & Arbitration (blocked)
- **Release impact:** the money the platform owes a vendor is the `vendor_payable` account of the
  **vendor house**, so a clawback is capped by that house's whole balance across its bookings,
  not by the single booking the case is about. The money that has already been paid out to the
  vendor is not counted and cannot be recovered. If the platform needs the claim to be per
  booking, the ledger needs a per-booking vendor payable account (F-102's `ledger_account`
  mapping would change, and every existing posting would have to be restated). Recommendation:
  leave the cap at the house while the money is pooled per house, and revisit it only if the
  owner decides a vendor's claim must be ring-fenced per booking.
