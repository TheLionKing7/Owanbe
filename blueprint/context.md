# Ówàńbè context

> Context version 3. Compiled at 2026-11-01T01:46:41.453Z.

## Project summary

Source documents: [blueprint/prd.md](./prd.md), [blueprint/tech-spec.md](./tech-spec.md), [blueprint/system-overview.md](./system-overview.md).

## Current task spec

### F-75 Project setup

Category: Core Workflows | Priority: must | Status: planned

Scope. Build a celebration-commerce platform supporting separate Host and Vendor houses, AI-assisted planning, enquiries, quotes, payments, event operations, guest access, and staff oversight. The feature map controls scope; research context is not verified evidence. All must features are release requirements, including those blocked by unresolved commercial or regulatory dependencies. Web. React + Vite provides the SPA on Lovable hosting. Route-level loading, small initial bundles, and progressive vendor tools support mid-range phones and slow connections. Client-rendered public discovery has

Technical notes: From blueprint/tech-spec.md: Scope. Build a celebration-commerce platform supporting separate Host and Vendor houses, AI-assisted planning, enquiries, quotes, payments, event operations, guest access, and staff oversight. The feature map controls scope; research context is not verified evidence. All must features are release requirements, including those blocked by unresolved commercial or regulatory dependencies. Web. React + Vite provides the SPA on Lovable hosting. Route-level loading, small initial bundles, and progressive vendor tools support mid-range phones and slow connections. Client-rendered public discovery has

Read the [full PRD](./prd.md), [design system](./design-system.md), [tech spec](./tech-spec.md) before starting.

Next after this: F-76 Authentication, F-77 Data model.

## Current batch

Work on these features in order, one branch each. Acceptance criteria are Sage 7 proposals until the owner confirms them.

- F-75 Project setup (ready)
  - Proposed acceptance: SPA builds with route-level code splitting for slow connections; Separate Host and Vendor house navigation scaffolding exists; Initial bundle size stays small for mid-range phones
  - Must be wired (checked by code; built only when every line is found): route /; env APP_ORIGIN
- F-76 Authentication (ready)
  - Proposed acceptance: Auth0 tokens validated for signature, issuer, audience, expiry; Session status checked before granting application access; Auth0 subject maps uniquely to one application user
  - Must be wired (checked by code; built only when every line is found): env AUTH0_DOMAIN; env AUTH0_CLIENT_ID; env AUTH0_AUDIENCE; table users
  - Open: Is sent-quote advisory lock vs accepted-quote payment hold approved?; Which Auth0-to-Supabase token validation path is supported?
- F-77 Data model (ready)
  - Proposed acceptance: Tables use UUID ids, UTC timestamps, minor-unit amounts; Composite constraints prevent mismatched house identifiers; Cross-party records expose only authorized projections
  - Must be wired (checked by code; built only when every line is found): table users; table houses; table memberships; table staff_grants; table assignments
  - Open: What is the full authoritative list of required tables?
- F-78 Permission scoping (ready)
  - Proposed acceptance: Role matrix matches host/vendor-owner/staff/support permissions; Vendor staff cannot change payouts or member administration; Sensitive reads by support/managers are logged
  - Must be wired (checked by code; built only when every line is found): fn validateToken; table memberships; env SUPABASE_SERVICE_ROLE_KEY
  - Open: Confirm Auth0-to-Supabase token validation path for DB/Realtime access.
- F-79 Deployment (ready)
  - Proposed acceptance: Separate dev/staging/prod projects with isolated credentials; Backward-compatible migrations deploy before client release; Restoration and rollback are tested before each release
  - Must be wired (checked by code; built only when every line is found): env SUPABASE_URL; env SUPABASE_PUBLIC_KEY; env SENTRY_DSN; env STRIPE_SECRET_KEY; env STRIPE_WEBHOOK_SECRET

## Plan

Now: None recorded.
Next: F-75 Project setup, F-76 Authentication, F-77 Data model.
Blocked: 74 (wave 0: 74).
Why this is next: Project setup is next because it is a wave 0 feature marked must-priority. Full roadmap: /projects/cfbf39db-b40e-4f75-9039-f241e7b05bfd?tab=roadmap

- Blocked F-38 Vendor Calendar Soft-hold: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-60 Payment Data Protection (Tokenization via Partner): planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-57 Admin Decision Audit & Second-person Review: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-22 Trust Score System: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-51 WhatsApp/SMS Critical Alert Integration: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-13 Direct Search & Book Flow: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-19 Unanswered Enquiry Fallback: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-1 Dual Workspace Switcher (Host/Vendor Houses): planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-64 Subscription Cancellation & Billing Transparency: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-37 In-house Event Manager Fallback: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-25 Live Payment Status Tracker & AI Escalation: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-11 Payment Caution Acknowledgment: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-72 Automated Timed Jobs: planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked F-21 Vendor C

[Plan truncated to the context budget. Read the full document: /projects/cfbf39db-b40e-4f75-9039-f241e7b05bfd?tab=roadmap.]

## Decisions

- reconcile: Owner confirmed a rule-based foundation proposal from blueprint/tech-spec.md.

## Engineering guardrails

- Decided stack: Web frontend: React + Vite (SPA); Mobile app: Expo (React Native); Backend: Supabase (Postgres, Auth, Storage, Edge Functions); Database: Supabase Postgres; Authentication: Auth0 (Okta); Payments: Stripe (Billing, Checkout, Connect); Email: Resend; Realtime: Supabase Realtime; Background jobs: Trigger.dev; File storage: Supabase Storage; Search: Algolia; AI integration: Vercel AI SDK; Hosting: Lovable hosting; Observability: Sentry. Do not add other frameworks, libraries or services without a recorded decision.
- Top quality drivers (ISO/IEC 25010): Security, Performance efficiency, Reliability, Flexibility, Safety, Compatibility, Maintainability.
- Design concept: Aso-Oke Ledger. Signature: a thin alternating orange/teal selvage-stripe rule used as section dividers and step progress, echoing the woven edge of aso-oke
- Architecture decision records are in blueprint/tech-spec.md.

## Active design tokens

- color accent = #007860 (Highlights and the signature motif; never for primary actions.)
- color accent-foreground = #FFFFFF (Text on accent.)
- color background = #FEF9F4 (Page background.)
- color border = #E0DAD3 (Dividers and input borders.)
- color card = #FFFDFB (Raised surfaces: cards, popovers, dialogs.)
- color dark-background = #0F0C08 (Dark mode background.)
- color dark-destructive = #FFA096 (Dark mode destructive.)
- color dark-muted-foreground = #C9C3BD (Dark mode muted-foreground.)
- color dark-ring = #FFD6B1 (Dark mode ring.)
- color dark-success = #68B67A (Dark mode success.)
- color dark-warning = #CF953A (Dark mode warning.)
- color destructive = #9B2D28 (Errors and irreversible actions.)
- color destructive-foreground = #FFFFFF (Text on destructive.)
- color foreground = #181411 (Body text and icons.)
- color muted = #F0EAE3 (Subtle fills: table stripes, inputs, inactive tabs.)
- color muted-foreground = #4E4944 (Secondary text; still meets the contrast target.)
- color primary = #F09000 (Main actions and selected states. One primary action per view.)
- color ring = #FFB05F (Focus outline: 2px with 2px offset on every interactive element.)
- color success = #135127 (Confirmed and completed states.)
- color success-foreground = #FFFFFF (Text on success.)
- color warning = #795000 (Needs attention, not yet an error.)
- component _rationale = Aso-Oke Ledger: Information is woven like aso-oke cloth, with warm stripe rhythms organizing vendor records, quotes and payments into trustworthy, legible bands. Signature: a thin alternating orange/teal selvage-stripe rule used as section dividers and step progress, echoing the woven edge of aso-oke (Avoids: generic white-and-gold luxury wedding template with script fonts and soft gradients)
- component Alert = Full-width banner, soft rounded corners, warm tone border-left in orange/teal selvage-stripe, subtle elevation, calm fade-in. (Used by: Backup Payment Processor outage, AI Chatbot Disclosure, Payment Caution Acknowledgment. Do: keep copy concise and persistent when required. Don't: auto-dismiss compliance alerts.)
- component Avatar = Circular soft avatar with thin orange/teal stripe ring for identity verification state, subtle elevation on stacked groups. (Used by: Second-approver identities, Vendor Team listing. Do: use stripe ring to denote verified identity. Don't: overload with status colors beyond ring accent.)
- component Badge = Small soft-radius pill, muted base with a thin stripe edge accent, non-animated, subtle contrast for visibility without alarm. (Used by: Cross-house Alert Badges, Invitation Tiers. Do: keep badge count visible but low-contrast. Don't: use motion or pulsing to draw attention.)
- component Button = Soft radius-md pill button, primary fill with subtle elevation on hover, 48px min height, calm 150ms ease transition, selvage-stripe focus ring on keyboard nav. (Used by: Quote Lifecycle, Payment Caution Acknowledgment, Direct Search & Book. Do: keep label verbs clear (Accept/Book). Don't: stack more than one primary button per row.)
- component Card = Rounded-lg soft card, subtle shadow-sm, warm background with a thin orange/teal selvage-stripe top rule separating header from content. (Used by: Quote Cards, Vendor Profile, Media Showcase gallery. Do: use stripe rule to separate price/metadata. Don't: nest cards more than one level deep.)
- component Dialog = Centered modal, radius-lg, subtle elevation, selvage-stripe divider between identity-log section and action buttons, calm scale-in 150ms. (Used by: Second-approver for Large Fund Actions, Health Data Consent capture. Do: show both approver identitie

<!-- sage7:audit:start -->
## Valid audit evidence

No valid audit yet

<!-- sage7:audit:end -->

> Trimmed to the 2500-token context budget: 17 lower-priority items left out from Project summary (1), Active design tokens (16). The linked source documents have the full detail.
