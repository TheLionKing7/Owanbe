# Ówàńbè context

> Context version 13. Compiled at 2026-11-11T09:17:41.888Z.

## Project summary

Ówàńbè tracks 126 assessed features across workflows including commerce, scheduling, authentication, administration, integrations, and support; its status inventory lists 45 built, 59 planned, 12 flagged, and none missing. Implemented functionality includes quote creation and revision workflows, personalized onboarding with a welcome-plan dashboard, and Paystack payment webhook handling.

## Current task spec

No buildable feature is mapped yet.

Read the [system overview](./system-overview.md) for the intended product scope.

## Current batch

- F-13 Direct Search & Book Flow (blocked)
  - Proposed acceptance: Search leads to profile, chat, quote, acceptance, payment flow; Booking confirmed only after successful payment
  - Must be wired (checked by code; built only when every line is found): route /search; route /vendor/:id; api POST /bookings; table bookings

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

Release: MVP v1 (77 features). Build only these; 44 other feature(s) are planned for a later release, so don't start them.
Now: F-13 Direct Search & Book Flow.
Next: None recorded.
Blocked: 47 (wave 0: 19, wave 1: 19, wave 2: 7, wave 3: 2).
Why this is next: F-13 is the current priority because it is the only feature marked now. Full roadmap: /projects/cfbf39db-b40e-4f75-9039-f241e7b05bfd?tab=roadmap
Held (built out of order, not counted until what they stand on is verified; don't extend them): F-38 Vendor Calendar Soft-hold, F-23 Quote Counter-Offer Controls, F-79 Deployment.

- Blocked F-60 Payment Data Protection (Tokenization via Partner): walking skeleton not verified; needs Payment Router & Banking Integrations (built); needs Backup Payment Processor (built); needs Manual CAC/NIMC/BVN Verification Integration (built); needs Partner bank (deprecated)
- Blocked F-64 Subscription Cancellation & Billing Transparency: walking skeleton not verified; needs Payment Router & Banking Integrations (built)
- Blocked F-15 Split Payment & Completion Confirmation: walking skeleton not verified; needs Payment Router & Banking Integrations (built); needs Fund pool/escrow (reported built, awaiting audit)
- Blocked F-56 System Monitoring Dashboard: walking skeleton not verified; needs Real-time Job Monitoring & Alerting (planned)
- Blocked F-12 AI-Assisted Event Planning (OwanbePlann

## Decisions

- reconcile: Owner confirmed the agent's decision.
- reconcile: High-confidence verification against src/lib/monitoring/browser.ts, src/lib/monitoring/privacy.ts; auto-confirmed by Sage CTO.
- reconcile: Regression after the push: Browser error monitoring and Sentry config present, but no admin monitoring dashboard UI.
- reconcile: Code verified for F-89: src/routes/_public/vendors.index.tsx, src/routes/_public/vendors.$slug.tsx

## Engineering guardrails

- Decided stack: Web frontend: TanStack Start (owner); Mobile app: Expo (React Native); Backend: Supabase (Postgres, Auth, Storage, Edge Functions); Database: Supabase Postgres; Authentication: Auth0 (Okta); Payments: Paystack (owner); Email: Resend; Realtime: Supabase Realtime; Background jobs: Trigger.dev; File storage: Supabase Storage; Search: Algolia; AI integration: Vercel AI SDK; Hosting: Lovable hosting; Observability: Sentry. Do not add other frameworks, libraries or services without a recorded decision.
- Top quality drivers (ISO/IEC 25010): Security, Performance efficiency, Reliability, Flexibility, Safety, Compatibility, Maintainability.
- Architecture decision records are in blueprint/tech-spec.md.

## Active design tokens

- color accent = #007860 (Highlights and the signature motif; never for primary actions.)
- color background = #FEF9F4 (Page background.)
- color card = #FFFDFB (Raised surfaces: cards, popovers, dialogs.)
- color dark-destructive = #FFA096 (Dark mode destructive.)
- color dark-warning = #CF953A (Dark mode warning.)
- color destructive = #9B2D28 (Errors and irreversible actions.)
- color foreground = #181411 (Body text and icons.)
- color muted = #F0EAE3 (Subtle fills: table stripes, inputs, inactive tabs.)
- color muted-foreground = #4E4944 (Secondary text; still meets the contrast target.)
- color primary = #F09000 (Main actions and selected states. One primary action per view.)
- color ring = #FFB05F (Focus outline: 2px with 2px offset on every interactive element.)
- color success = #135127 (Confirmed and completed states.)
- component _rationale = Aso-Oke Ledger: Information is woven like aso-oke cloth, with warm stripe rhythms organizing vendor records, quotes and payments into trustworthy, legible bands. Signature: a thin alternating orange/teal selvage-stripe rule used as section dividers and step progress, echoing the woven edge of aso-oke (Avoids: generic white-and-gold luxury wedding template with script fonts and soft gradients)
- component Alert = Full-width banner, soft rounded corners, warm tone border-left in orange/teal selvage-stripe, subtle elevation, calm fade-in. (Used by: Backup Payment Processor outage, AI Chatbot Disclosure, Payment Caution Acknowledgment. Do: keep copy concise and persistent when required. Don't: auto-dismiss compliance alerts.)
- component Badge = Small soft-radius pill, muted base with a thin stripe edge accent, non-animated, subtle contrast for visibility without alarm. (Used by: Cross-house Alert Badges, Invitation Tiers. Do: keep badge count visible but low-contrast. Don't: use motion or pulsing to draw attention.)
- component Button = Soft radius-md pill button, primary fill with subtle elevation on hover, 48px min height, calm 150ms ease transition, selvage-stripe focus ring on keyboard nav. (Used by: Quote Lifecycle, Payment Caution Acknowledgment, Direct Search & Book. Do: keep label verbs clear (Accept/Book). Don't: stack more than one primary button per row.)
- component Card = Rounded-lg soft card, subtle shadow-sm, warm background with a thin orange/teal selvage-stripe top rule separating header from content. (Used by: Quote Cards, Vendor Profile, Media Showcase gallery. Do: use stripe rule to separate price/metadata. Don't: nest cards more than one level deep.)
- component Dialog = Centered modal, radius-lg, subtle elevation, selvage-stripe divider between identity-log section and action buttons, calm scale-in 150ms. (Used by: Second-approver for Large Fund Actions, Health Data Consent capture. Do: show both approver identitie

<!-- sage7:audit:start -->
## Valid audit evidence

Audit run: 2026-11-10T00:58:50.626576+00:00 against a confirmed target.

- F-1 Dual Workspace Switcher (Host/Vendor Houses): built - Host and Vendor houses have dedicated navigation and a switcher link in HouseLayout.
- F-2 Become a Vendor Empty State: built - OpenVendorHouse component renders empty state form to open a vendor house when none exists.
- F-5 Unified Vendor House (Single Vendor Type): built - Single unified Vendor House structure with category presets in ProfileCopyStudio.
- F-3 Cross-house Alert Badges: partial - Unread alert count badge exists inside HouseAlerts panel, not yet as cross-house nav badge.
- F-4 Unicode-normalized Search Alias: unverified - Possible evidence in blueprint/design-system.md; not counted as missing. No unicode-normalized search alias implementation found in the repository.
- F-6 Vendor Team Structure: partial - Role matrix and owner/staff membership structure defined in permissions and schema.
- F-7 AI Intent Capture: unverified - Possible evidence in blueprint/system-overview.md; not counted as missing. No AI intent capture onboarding flow implemented in code.
- F-9 Media Section & Event of the Week: unverified - Possible evidence in blueprint/design-system.md; not counted as missing. No media section or Event of the Week found.
- F-10 Vendor Vetting at Sign-up: unverified - Possible evidence in blueprint/tech-spec.md; not counted as missing. No vendor vetting at sign-up implemented; vendors open house directly.
- F-11 Payment Caution Acknowledgment: unverified - Possible evidence in blueprint/tech-spec.md; not counted as missing. No payment caution acknowledgment implemented.
- F-8 Personalised Dashboard: partial - Host and Vend

[Audit evidence truncated to the context budget.]

<!-- sage7:audit:end -->

> Trimmed to the 2500-token context budget: 52 lower-priority items left out from Project summary (1), Current batch (1), Plan (4), Decisions (19), Engineering guardrails (1), Active design tokens (26). The linked source documents have the full detail.
