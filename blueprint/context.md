# Ówàńbè context

> Context version 14. Compiled at 2026-11-13T03:59:07.987Z.

## Current task spec

### F-107 OwanbeAI

Category: Core Workflows | Priority: must | Status: planned

Needed before the features that name "OwanbeAI" can be built.

Build evidence: in progress, unverified (branch develop). Commits and audits never change the saved feature status; an owner must explicitly mark it built with a reason.

Read the [full PRD](./prd.md), [design system](./design-system.md), [tech spec](./tech-spec.md) before starting.

Next after this: F-108 Ticketing system, F-109 Fund pool/recovery fund.

## Current batch

- F-107 OwanbeAI (in progress)
  - Proposed acceptance: Persistent AI labeling shown on all OwanbeAI responses; Payment-log access is read-only; no approval or transfer capability; Sensitive processing uses contracted zero-retention AI provider; Tickets open automatically without any fund movement authority
  - Open: Which AI/LLM provider is contracted for zero data retention compliance?; What ticketing or payment-log APIs does OwanbeAI call internally?
- F-108 Ticketing system (ready)
  - Proposed acceptance: Claim binds invitation/phone without requiring full account; Atomic claims allow one person or two for couple links; QR/NFC admission supports offline scanner cache; Only host can invalidate or reissue invitation tokens
  - Must be wired (checked by code; built only when every line is found): table invitations; api POST /invitations/claim; route /invite/:token; fn claimInvitation
  - Open: Does ticketing cover Regular/VIP/VVIP/Diamond tiers or only basic invites?; Which service owns offline QR/NFC scanner cache sync logic?
- F-109 Fund pool/recovery fund (ready)
  - Proposed acceptance: Fund pool holds 70% booking and 30% completion splits; Dispute holds freeze balances pending judgement; Recovery advances release 50% replacement cost; Auditable ledger reconciles with payment router
  - Must be wired (checked by code; built only when every line is found): api POST /funds/allocate; api POST /funds/release; table fund_pool_ledger; fn calculateSplitAllocation; env FUND_POOL_WALLET_ID; call services/payment_router -> reconcileLedger
  - Open: Legal structure for fund segregation?; Regulatory compliance for recovery advances?
- F-113 Malware/file-type scanning (ready)
  - Proposed acceptance: All uploads are quarantined until scanning completes; Scanning blocks disallowed file types and detected malware; Ownership complaints support evidence review workflow; Approved takedown removes flagged content from visibility
  - Must be wired (checked by code; built only when every line is found): fn scanUpload; table uploads
  - Open: Which malware-scanning provider or service should be integrated?; What file types/extensions are explicitly allowed or blocked?
- F-115 Identity verification per country (ready)
  - Proposed acceptance: Verify identity via country-specific service (e.g., NIN/BVN); Queue verification during outages; allow limited signup; Store minimal verification data with explicit consent; Delete documents after completion when legally permitted
  - Must be wired (checked by code; built only when every line is found): api POST /verify/identity; table identity_verifications; fn verifyIdentity
  - Open: Which countries' verification services are in scope?; How to handle verification data retention per country?

## Engineering Workflow & Blocker Rules

- No ungrounded completion claims: an infrastructure feature (CI, deployment, migrations) is only built when the audit finds the configuration files it needs in the repository, such as GitHub Actions workflow files, deployment descriptors and migration files. Cite the exact path in the feature's acceptance criteria and, for CI, the command the workflow runs. A commit message alone proves nothing.
- Blocker reporting: when a missing architectural choice, an environment dependency or a credential blocks you, call report_question with blocking: true, 2-3 concrete options and your recommendation, then stop and call get_answers. Do not guess past the blocker, and never paste a secret into the question; the owner sets credentials in the environment.
- Check owner answers: when the ## Answers from the owner section is present, every entry in it is an authoritative decision. Respect it in all later prompts; it overrides assumptions in earlier work and the default you would otherwise choose.

## Answers from the owner

Follow these; they override assumptions in earlier work.

- F-107 Q: Who confirms the zero-data-retention contract for AI models, and with which provider? → answered: Lovable has ZDR and gpt also has ZDR in place so this is okay to function now.
- Decision: Payments owner answers — 2026-11-10 → confirmed
- F-40 Decision: F-40 shares a guest list only with existing Ówàńbè platform users (verified email), and a guest list is house-scoped with a title - there is no event-level scoping. → confirmed
- F-80 Decision: Applied owner answer 40cf8a8e: the Verify workflow is disabled in both repositories, and its triggers are not widened to develop. → confirmed
- F-80 Decision: F-80: stop triggering CI (owner answer 40cf8a8e, 2026-11-06) → confirmed
- F-80 Q: Should the CI workflow also run on pushes and pull requests to develop, now that all new work lands there? → answered: We should stop the CI, since its not working, there is no need to be triggering it.
- Decision: Use two branches only: main for production-ready code, and develop as the single branch for all new feature work. Per-feature branches are retired. → confirmed
- Decision: Feature requests from competitive review (2026-11-06) → confirmed: All request approved!
- F-13 Decision: F-13: in-app chat comes first, under its own feature code → confirmed
- F-80 Decision: F-80: CI installs with npm, and must prove every test file loaded → confirmed

## Plan

- Blocked F-64 Subscription Cancellation & Billing Transparency: needs Payment Router & Banking Integrations (built)
- Blocked F-14 Quote Lifecycle & Date Lock: needs "Vendor service catalog", which isn't a feature yet; needs "Vendor calendar": did you mean F-38 Vendor Calendar Soft-hold or F-91 Vendor Calendar Soft-Hold & Refund Ledger?
- Blocked F-56 System Monitori

## Decisions

- reconcile: Yeah, very sure it has been built but I instructed the agent to downgrade the CI workflow runs
- reconcile: Code verified for F-94: src/pages/Home.tsx, components/home/Hero.tsx, FeaturedVendors.tsx
- reconcile: High-confidence verification against supabase/migrations/20261109160000_f106_market_benchmarks.sql:staff_grants capability; auto-confirmed by Sage CTO.
- reconcile: Regression after the push: Public vendor directory and category filtering exist, but direct booking flow is not complete.
- reconcile: Regression after the push: Database stores only payment_reference and minor units, never raw card data.

## Engineering guardrails

- Decided stack: Web frontend: TanStack Start (owner); Mobile app: Expo (React Native); Backend: Supabase (Postgres, Auth, Storage, Edge Functions); Database: Supabase Postgres; Authentication: Auth0 (Okta); Payments: Paystack (owner); Email: Resend; Realtime: Supabase Realtime; Background jobs: Trigger.dev; File storage: Supabase Storage; Search: Algolia; AI integration: Vercel AI SDK; Hosting: Lovable hosting; Observability: Sentry. Do not add other frameworks, libraries or services without a recorded decision.
- Top quality drivers (ISO/IEC 25010): Security, Performance efficiency, Reliability, Flexibility, Safety, Compatibility, Maintainability.

## Active design tokens

- color card = #FFFDFB (Raised surfaces: cards, popovers, dialogs.)
- color dark-warning = #CF953A (Dark mode warning.)
- color destructive = #9B2D28 (Errors and irreversible actions.)
- color foreground = #181411 (Body text and icons.)
- color muted = #F0EAE3 (Subtle fills: table stripes, inputs, inactive tabs.)
- color muted-foreground = #4E4944 (Secondary text; still meets the contrast target.)
- color primary = #F09000 (Main actions and selected states. One primary action per view.)
- color ring = #FFB05F (Focus outline: 2px with 2px offset on every interactive element.)
- component _rationale = Aso-Oke Ledger: Information is woven like aso-oke cloth, with warm stripe rhythms organizing vendor records, quotes and payments into trustworthy, legible bands. Signature: a thin alternating orange/teal selvage-stripe rule used as section dividers and step progress, echoing the woven edge of aso-oke (Avoids: generic white-and-gold luxury wedding template with script fonts and soft gradients)
- component Alert = Full-width banner, soft rounded corners, warm tone border-left in orange/teal selvage-stripe, subtle elevation, calm fade-in. (Used by: Backup Payment Processor outage, AI Chatbot Disclosure, Payment Caution Acknowledgment. Do: keep copy concise and persistent when required. Don't: auto-dismiss compliance alerts.)
- component Badge = Small soft-radius pill, muted base with a thin stripe edge accent, non-animated, subtle contrast for visibility without alarm. (Used by: Cross-house Alert Badges, Invitation Tiers. Do: keep badge count visible but low-contrast. Don't: use motion or pulsing to draw attention.)

<!-- sage7:audit:start -->
## Valid audit evidence

Audit run: 2026-11-13T01:41:51.175534+00:00 against a confirmed target.

- F-1 Dual Workspace Switcher (Host/Vendor Houses): partial - Host/vendor routes and HouseLayout exist; workspace switcher component unconfirmed
- F-4 Unicode-normalized Search Alias: unverified - Possible evidence in blueprint/design-system.md; not counted as missing. No unicode-normalized search alias implementation found in the repository.
- F-6 Vendor Team Structure: unverified - OpenVendorHouse.tsx exists but vendor team structure unconfirmed
- F-3 Cross-house Alert Badges: partial - Unread alert count badge exists inside HouseAlerts panel, not yet as cross-house nav badge.
- F-2 Become a Vendor Empty State: built - OpenVendorHouse component shown when no vendor house exists
- F-5 Unified Vendor House (Single Vendor Type): unverified - OpenVendorHouse.tsx exists but unified vendor house concept unconfirmed
- F-9 Media Section & Event of the Week: unverified - Possible evidence in blueprint/design-system.md; not counted as missing. No media section or Event of the Week found.
- F-10 Vendor Vetting at Sign-up: unverified - Possible evidence in blueprint/tech-spec.md; not counted as missing. No vendor vetting at sign-up implemented; vendors open house directly.
- F-11 Payment Caution Acknowledgment: unverified - Possible evidence in blueprint/tech-spec.md; not counted as missing. No payment caution acknowledgment implemented.
- F-8 Personalised Dashboard: partial - Host and Vendor house overview routes exist, though mostly scaffolding and alerts.
- F-7 AI Intent Capture: unverified - Possible evidence in blueprint/system-overview.md; not counted as missing. No AI intent capture onboarding flow impl

[Audit evidence truncated to the context budget.]

<!-- sage7:audit:end -->

> Trimmed to the 2500-token context budget: 64 lower-priority items left out from Project summary (2), Current batch (1), Plan (8), Decisions (18), Engineering guardrails (2), Active design tokens (33). The linked source documents have the full detail.
