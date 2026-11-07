# Ówàńbè context

> Context version 7. Compiled at 2026-11-06T12:33:40.292Z.

## Project summary

Ówàńbè tracks 98 features across areas including event workflows, commerce, scheduling, user management, and security. Its feature inventory lists 27 built, 59 planned, 12 flagged, and none marked missing; reconciliation notes identify gaps in event-day vendor timelines, planner workspaces, aso-ebi ordering, and event-manager assignments.

## Current task spec

No buildable feature is mapped yet.

Read the [system overview](./system-overview.md) for the intended product scope.

## Current batch

No buildable batch right now: every remaining feature is blocked or done.

## Engineering Workflow & Blocker Rules

- No ungrounded completion claims: an infrastructure feature (CI, deployment, migrations) is only built when the audit finds the configuration files it needs in the repository, such as GitHub Actions workflow files, deployment descriptors and migration files. Cite the exact path in the feature's acceptance criteria and, for CI, the command the workflow runs. A commit message alone proves nothing.
- Blocker reporting: when a missing architectural choice, an environment dependency or a credential blocks you, call report_question with blocking: true, 2-3 concrete options and your recommendation, then stop and call get_answers. Do not guess past the blocker, and never paste a secret into the question; the owner sets credentials in the environment.
- Check owner answers: when the ## Answers from the owner section is present, every entry in it is an authoritative decision. Respect it in all later prompts; it overrides assumptions in earlier work and the default you would otherwise choose.

## Answers from the owner

Follow these; they override assumptions in earlier work.

- F-13 Decision: F-13: in-app chat comes first, under its own feature code → confirmed
- F-80 Decision: F-80: CI installs with npm, and must prove every test file loaded → confirmed
- F-80 Decision: F-80: CI's application job installs with npm from package-lock.json (bun removed from that job), because bun.lock still pins AI SDK versions the registry does not publish; bun.lock is left untouched and raised as an owner question rather than edited blind. → confirmed: I agree with using npm in the CI application job and leaving bun.lock unchanged for now. Please don’t describe CI as green until a workflow has actually run successfully. Keep the Bun lockfile and security-setting question open for me to decide, and leave formatting checks out for now. However, is the CI not a github action which is blocked through billing issue?
- F-13 Q: F-13 (Direct Search & Book Flow) names three dependencies and two of them do not exist yet - there is no in-app chat anywhere in the code or schema, and no payment router (F-48, still gated behind the wallet/licence question). Which way do you want it built? → answered: Reassign In-app chat to its own feature code, build it first, then return to F-13
- F-80 Decision: Applied the owner's answer to question 614b5ebe exactly: package.json now pins ai@^6.0.184, @ai-sdk/openai@^3.0.64 and the missing @testing-library/dom@^10.4.0 peer, with the lockfile refreshed by the owner (commit 3d89d2d). → confirmed: Thanks. Keep the applied versions and the fix. Before we confirm this as complete, please resolve or clearly document the install conflict, and make CI check that all test files load—not just that the tests that did load pass.
- F-78 Q: F-78 was applied twice: did you want it re-run, and which Supabase project is the database these migrations should land in? → answered: Ignore it: F-78's functions were confirmed by the 2026-11-04 audit, and leave the duplicate-apply note in the journal
- F-80 Q: F-80 CI: npm install still hits a peer-dependency conflict (@types/react 18 vs 19) that only resolves with --legacy-peer-deps. Should CI commit an .npmrc with legacy-peer-deps, or should the peer be pinned/overridden so a plain install works? → answered: Commit .npmrc with legacy-peer-deps=true (what the owner already does locally; simplest, but silently skips peer checks forever)
- F-80 Q: F-80 CI cannot install dependencies: which AI SDK versions should package.json pin, and may I add @testing-library/dom? → answered: Pin the intended AI SDK versions (owner decision - a downgrade changes the call surface vendor-profile was written against), then refresh the lockfile and add @testing-library/dom - recommended
- F-22 Q: F-22 Trust Score has no input data and no approved weights or suspension threshold - which should come first? → answered: Build F-26 (ratings/reviews) first, then compute the score from completed bookings + ratings - recommended
- F-57 Q: F-57 has no decision records to audit yet - what should it audit, and who is the second reviewer? → answered: Build F-53 first (verification queue + decision rows), then F-57 audits those decisions - recommended

## Plan

- Blocked F-19 Unanswered Enquiry Fallback: needs "Vendor vetting": did you mean F-10 Vendor Vetting at Sign-up?; needs "Recommendation engine": did you mean F-35 Emergency Replacement Vendor Recommendation?
- Blocked F-64 Subscription Cancellation & Billing Transparency: needs "Payment Router": did you mean F-48 Payment Router & Banking Integrations?
- Blocked F-37 In

## Decisions

- reconcile: A coding agent found that the plan needs "Cultural guides hub with Ask OwanbePlanner", which isn't a feature yet. A public library of guides to Yoruba and Nigerian ceremonies (introduction, engagement, naming, wedding, burial, birthday), covering etiquette, what to buy and typical costs. Visitors can ask OwanbePlanner questions about traditions. It builds cultural authority and search traffic, and every guide links into planning and vendor discovery.
- reconcile: Product grew beyond the blueprint; made official.
- reconcile: Regression after the push: Outbid and late-payment refund tracking and notifications implemented in soft-hold schema and UI; actual payout reversal pending.
- reconcile: Regression after the push: Suspended user status revocation tested in auth SQL, full member removal revocation flow not read.
- reconcile: Regression after the push: Capability-based scoping for house sections exists in HousePage and permissions.
- reconcile: Regression aft

[Decisions truncated to the context budget.]

## Engineering guardrails

- Decided stack: Web frontend: TanStack Start (owner); Mobile app: Expo (React Native); Backend: Supabase (Postgres, Auth, Storage, Edge Functions); Database: Supabase Postgres; Authentication: Auth0 (Okta); Payments: Paystack (owner); Email: Resend; Realtime: Supabase Realtime; Background jobs: Trigger.dev; File storage: Supabase Storage; Search: Algolia; AI integration: Vercel AI SDK; Hosting: Lovable hosting; Observability: Sentry. Do not add other frameworks, libraries or services without a recorded decision.
- Top quality drivers (ISO/IEC 25010): Security, Performance efficiency, Reliability, Flexibility, Safety, Compatibility, Maintainability.
- Architecture decision records are in blueprint/tech-spec.md.

## Active design tokens

- color card = #FFFDFB (Raised surfaces: cards, popovers, dialogs.)
- color dark-warning = #CF953A (Dark mode warning.)
- color destructive = #9B2D28 (Errors and irreversible actions.)
- color foreground = #181411 (Body text and icons.)
- color muted = #F0EAE3 (Subtle fills: table stripes, inputs, inactive tabs.)
- color primary = #F09000 (Main actions and selected states. One primary action per view.)
- color ring = #FFB05F (Focus outline: 2px with 2px offset on every interactive element.)
- component _rationale = Aso-Oke Ledger: Information is woven like aso-oke cloth, with warm stripe rhythms organizing vendor records, quotes and payments into trustworthy, legible bands. Signature: a thin alternating orange/teal selvage-stripe rule used as section dividers and step progress, echoing the woven edge of aso-oke (Avoids: generic white-and-gold luxury wedding template with script fonts and soft gradients)
- component Alert = Full-width banner, soft rounded corners, warm tone border-left in orange/teal selvage-stripe, subtle elevation, calm fade-in. (Used by: Backup Payment Processor outage, AI Chatbot Disclosure, Payment Caution Acknowledgment. Do: keep copy concise and persistent when required. Don't: auto-dismiss compliance alerts.)
- component Badge = Small soft-radius pill, muted base with a thin stripe edge accent, non-animated, subtle contrast for visibility without alarm. (Used by: Cross-house Alert Badges, Invitation Tiers. Do: keep badge count visible but low-contrast. Don't: use motion or pulsing to draw attention.)
- component Dialog = Centered modal, radius-lg, subtle elevation, selvage-stripe divider between identity-log section and action buttons, calm scale-in 150ms. (Used by: Second-approver for Large Fund Actions, Health Data Consent capture. Do: show both approver identitie

<!-- sage7:audit:start -->
## Valid audit evidence

Audit run: 2026-11-06T12:25:47.751338+00:00 against a confirmed target.

- F-4 Unicode-normalized Search Alias: unverified - Possible evidence in src/features/holds/VendorCalendarPanel.test.tsx; not counted as missing. No unicode-normalized search alias implementation found in read files.
- F-2 Become a Vendor Empty State: built - OpenVendorHouse component provides onboarding empty state to become a vendor.
- F-6 Vendor Team Structure: partial - Vendor house supports owner/staff roles and capabilities in schema/auth, but lacks team management UI.
- F-3 Cross-house Alert Badges: built - Cross-house alert badges and unread counts implemented in HouseAlerts.
- F-5 Unified Vendor House (Single Vendor Type): built - Unified vendor house model and routes implemented.
- F-1 Dual Workspace Switcher (Host/Vendor Houses): built - Host and vendor houses with layout and house switching support implemented.
- F-7 AI Intent Capture: unverified - Possible evidence in supabase/migrations/20261104160000_f38_vendor_calendar_soft_hold.sql; not counted as missing. No AI intent capture onboarding flow found.
- F-8 Personalised Dashboard: unverified - Possible evidence in supabase/migrations/20261104160000_f38_vendor_calendar_soft_hold.sql; not counted as missing. No personalised onboarding dashboard found.
- F-9 Media Section & Event of the Week: unverified - Possible evidence in src/routes/host/$section.tsx; not counted as missing. No media section or Event of the Week feature found.
- F-11 Payment Caution Acknowledgment: unverified - Possible evidence in supabase/migrations/20261104160000_f38_vendor_calendar_soft_hold.sql; not counted as missing. No payment caution acknowledgment UI found.

[Audit evidence truncated to the context budget.]

<!-- sage7:audit:end -->

> Trimmed to the 2500-token context budget: 56 lower-priority items left out from Project summary (1), Waiting for the owner (3), Built out of order (1), Plan (6), Decisions (11), Engineering guardrails (1), Active design tokens (33). The linked source documents have the full detail.
