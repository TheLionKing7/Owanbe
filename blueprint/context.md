# Ówàńbè context

> Context version 6. Compiled at 2026-11-04T09:40:01.622Z.

## Current task spec

### F-38 Vendor Calendar Soft-hold

Category: Data & State | Priority: must | Status: planned

Accepting a quote starts a 24-hour payment window and softly holds the date; a vendor may engage multiple hosts on the same date but both are alerted, and the first confirmed payment wins while the other is auto-refunded and shown alternatives.
Open questions: What happens to the date if a payment is still mid-process when the 24 hours end?.

Technical notes: Race-condition handling: first confirmed payment wins; reversal job for the losing payment.

Design notes: Clear 'another host is engaging' alert copy to manage expectations.

Read the [full PRD](./prd.md), [design system](./design-system.md), [tech spec](./tech-spec.md) before starting.

Next after this: F-60 Payment Data Protection (Tokenization via Partner), F-57 Admin Decision Audit & Second-person Review.

## Current batch

- F-38 Vendor Calendar Soft-hold (ready)
  - Proposed acceptance: Acceptance opens 24-hour payment window; Competing hosts on same date are alerted; Atomic confirmed-payment selects single winner; Losing payment auto-refunds with alternatives shown
  - Must be wired (checked by code; built only when every line is found): table calendar_holds; fn allocateAtomicBookingWinner; api POST /quotes/:id/accept; table payments
  - Open: How many simultaneous soft-holds per vendor-date are allowed?
- F-60 Payment Data Protection (Tokenization via Partner) (ready)
  - Proposed acceptance: No raw card/account credentials stored on platform; Only tokens, balances and transactions persisted; Partner handles PCI-scope credential storage; Audit confirms absence of raw credential fields
  - Must be wired (checked by code; built only when every line is found): table wallets; table transactions; env PAYMENT_PARTNER_API_KEY
  - Open: Which payment partner certifies PCI tokenization compliance?;
- F-57 Admin Decision Audit & Second-person Review (ready)
  - Proposed acceptance: Every approve/reject decision logs staff rationale immutably; Second reviewer checks decisions weekly and monthly; Vendor can appeal and resubmit after rejection; Escalation never implies silent approval
  - Must be wired (checked by code; built only when every line is found): table decision_audit_log; fn logDecision; route /admin/decisions/review
  - Open: What exact cadence triggers weekly vs monthly review?; How does vendor appeal resubmission re-enter the queue?
- F-22 Trust Score System (ready)
  - Proposed acceptance: Score updates from ratings, reviews and completions; Cancellations reduce score without admin override; Low score reduces vendor visibility in search
  - Must be wired (checked by code; built only when every line is found): table trust_scores; fn computeTrustScore
  - Open: How are ratings/reviews features integrated since not in current feature set?
- F-13 Direct Search & Book Flow (ready)
  - Proposed acceptance: Search leads to profile, chat, quote, acceptance, payment flow; Booking confirmed only after successful payment
  - Must be wired (checked by code; built only when every line is found): route /search; route /vendor/:id; api POST /bookings; table bookings

## Answers from the owner

Follow these; they override assumptions in earlier work.

- F-82 Q: Do you approve shadcn/ui + Radix as the component library, or should new UI be hand-built from the brand tokens only? → answered: Shadcn + radix should be used to get rich components but structured with brand token
- F-76 Decision: TanStack Start runtime and Paystack payments → confirmed
- Decision: Owner decision: TanStack Start runtime and Paystack are approved architecture → confirmed
- F-79 Decision: F-79: Browser monitoring configuration → confirmed
- F-79 Decision: Owner requested one hosted Supabase project and GitHub commit mirroring to TheLionKing7/Owanbe; added fast-forward-only audit mirror and disposable local database CI, with no deployment automation. → confirmed
- F-78 Decision: Confirmed: a paid/not-paid status for event managers carries no amount, currency, instrument, or transaction reference — it is a state label only. → confirmed
- Q: Should an Auth0 subject that has no application user be auto-created (current ensure_user behaviour) or refused until invited/allow-listed? → answered: Admit but restrict: new users start in a limited state until verified
- F-79 Decision: Merging into main does not deploy anything: the repo has exactly one webhook (the Sage 7 push-sync endpoint) and no CI workflows, no deployments, and no Lovable/Vercel/Netlify configuration. → confirmed
- F-77 Decision: In the memory bank, "built" for F-75/F-76/F-77 records the Sage 7 audit run of 2026-11-01 07:35:28 UTC and nothing more; no feature is described as ready or secure. → confirmed: Year the other agent didn't know the status when recording the memory file.
- Q: Inside an assigned event, which fields may an event manager read, and must those reads be logged as sensitive? → answered: Let’s use Sage’s suggested approach: event managers can see only their assigned events, with no guest phone numbers, health details, or money authority. They may see a simple paid/not-paid status, and each time they view it should be recorded. Please confirm the status does not reveal amounts or other payment details.

## Plan

- Blocked F-51 WhatsApp/SMS Critical Alert Integration: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-43 Vendor Team Role Delegation: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-66 Biometric Data Consent (Face Scan): planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-23 Quote Counter-Offer Controls: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-32 Team, Roles & Billing Settings: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-39 Record Retention Policy: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-63 Marketing Email Unsubscribe + Postal Address: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-58 GDPR/UK-GDPR Data Rights for Diaspora Users: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-35 Emergency Replacement Vendor Recommendation: planner confirmation missing; acceptance criteria unconfirmed
- Blocked F-27 AI 'Best Bargain' Ranking: planner confirmation missing; acceptance criteria unconfirmed

## Decisions

- reconcile: High-confidence verification against .github/workflows/verify.yml, scripts/check-bundle.mjs; auto-confirmed by Sage CTO.

## Engineering guardrails

- Decided stack: Web frontend: TanStack Start (owner); Mobile app: Expo (React Native); Backend: Supabase (Postgres, Auth, Storage, Edge Functions); Database: Supabase Postgres; Authentication: Auth0 (Okta); Payments: Paystack (owner); Email: Resend; Realtime: Supabase Realtime; Background jobs: Trigger.dev; File storage: Supabase Storage; Search: Algolia; AI integration: Vercel AI SDK; Hosting: Lovable hosting; Observability: Sentry. Do not add other frameworks, libraries or services without a recorded decision.
- Top quality drivers (ISO/IEC 25010): Security, Performance efficiency, Reliability, Flexibility, Safety, Compatibility, Maintainability.

## Active design tokens

- color background = #FEF9F4 (Page background.)
- color card = #FFFDFB (Raised surfaces: cards, popovers, dialogs.)
- color dark-warning = #CF953A (Dark mode warning.)
- color destructive = #9B2D28 (Errors and irreversible actions.)
- color foreground = #181411 (Body text and icons.)
- color muted = #F0EAE3 (Subtle fills: table stripes, inputs, inactive tabs.)
- color primary = #F09000 (Main actions and selected states. One primary action per view.)
- color ring = #FFB05F (Focus outline: 2px with 2px offset on every interactive element.)
- color success = #135127 (Confirmed and completed states.)
- component _rationale = Aso-Oke Ledger: Information is woven like aso-oke cloth, with warm stripe rhythms organizing vendor records, quotes and payments into trustworthy, legible bands. Signature: a thin alternating orange/teal selvage-stripe rule used as section dividers and step progress, echoing the woven edge of aso-oke (Avoids: generic white-and-gold luxury wedding template with script fonts and soft gradients)
- component Alert = Full-width banner, soft rounded corners, warm tone border-left in orange/teal selvage-stripe, subtle elevation, calm fade-in. (Used by: Backup Payment Processor outage, AI Chatbot Disclosure, Payment Caution Acknowledgment. Do: keep copy concise and persistent when required. Don't: auto-dismiss compliance alerts.)
- component Badge = Small soft-radius pill, muted base with a thin stripe edge accent, non-animated, subtle contrast for visibility without alarm. (Used by: Cross-house Alert Badges, Invitation Tiers. Do: keep badge count visible but low-contrast. Don't: use motion or pulsing to draw attention.)
- component Dialog = Centered modal, radius-lg, subtle elevation, selvage-stripe divider between identity-log section and action buttons, calm scale-in 150ms. (Used by: Second-approver for Large Fund Actions, Health Data Consent capture. Do: show both approver identitie

<!-- sage7:audit:start -->
## Valid audit evidence

Audit run: 2026-11-04T09:35:45.220974+00:00 against a confirmed target.

- F-2 Become a Vendor Empty State: unverified - Not assessed yet.
- F-3 Cross-house Alert Badges: unverified - Possible evidence in supabase/tests/f77_data_model.test.sql; not counted as missing. No cross-house alert badges found in header or route files.
- F-4 Unicode-normalized Search Alias: missing - No Unicode-normalized search alias implementation found.
- F-5 Unified Vendor House (Single Vendor Type): partial - Single unified /vendor workspace route and HouseSummary kind ('host' | 'vendor') defined.
- F-6 Vendor Team Structure: partial - HouseSummary defines owner/staff roles and capabilities array for house memberships.
- F-1 Dual Workspace Switcher (Host/Vendor Houses): partial - Host and Vendor house routes and my_houses RPC wiring exist; HouseLayout switcher not in read excerpts.
- F-7 AI Intent Capture: partial - Hero search captures celebration intent and popular searches, routing to /host/plan?q=.
- F-8 Personalised Dashboard: unverified - Not assessed yet.
- F-9 Media Section & Event of the Week: unverified - Possible evidence in src/routes/host/$section.tsx; not counted as missing. No media section or Event of the Week component found.
- F-10 Vendor Vetting at Sign-up: unverified - Possible evidence in src/lib/auth/AuthProvider.tsx; not counted as missing. Sign-up delegates directly to Auth0 without vendor vetting steps.
- F-11 Payment Caution Acknowledgment: unverified - Not assessed yet.
- F-12 AI-Assisted Event Planning (OwanbePlanner): partial - Hero search and nav link to /host/plan, but planner route renders generic HousePage.
- F-13 Direct Search & Book Flow: partial - Category 

[Audit evidence truncated to the context budget.]

<!-- sage7:audit:end -->

> Trimmed to the 2500-token context budget: 51 lower-priority items left out from Project summary (2), Current batch (1), Plan (9), Decisions (6), Engineering guardrails (2), Active design tokens (31). The linked source documents have the full detail.
