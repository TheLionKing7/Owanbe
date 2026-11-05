# Open questions

Unanswered questions that block or shape work. Each entry names the owner, the
affected feature, the status and the release impact. Approved answers move to
`docs/decisions/`.

## F-14 Quote Lifecycle & Date Lock

### Q1. What stops a vendor from ignoring a counter-offer?

- **Owner:** Ola (product owner)
- **Status:** open — asked in the F-14 feature spec, still unanswered
- **Affected:** F-14 (counter path), F-23 Quote Counter-Offer Controls (`planned`),
  F-22 Trust Score System (blocked), F-24 Multi-channel Notification Delivery (blocked)
- **Release impact:** a host can counter, and the vendor's 24-hour clock keeps
  running, but nothing in F-14 pressures the vendor to respond. The quote simply
  expires. No reminder, penalty or ranking consequence was implemented, because
  inventing one would put an unapproved business rule into the database.
- **What was built instead:** the counter is recorded as a host-authored revision
  with a required message, it does not restart the vendor's deadline, and the
  vendor can revise and re-send (which does restart it). That is the whole
  behaviour; the enforcement question is left to F-23/F-22.

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


