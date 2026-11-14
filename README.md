# Ówàńbè

Ówàńbè is a platform for planning Nigerian celebrations, connecting hosts, vendors, and guests with tools for coordination and payment management.

Application code is present in TheLionKing7/Owanbe on the main branch.

## Overview

Ówàńbè provides a platform for Nigerian celebration planning, serving hosts, vendors, and guests. Hosts can build plans, compare quotes, and manage bookings, while vendors can showcase services and handle operations. The platform includes guest admission, payment processing, and support tools, with AI assisting planning and issue investigation without financial authority.

## Who it is for

| Role | What they do |
| --- | --- |
| Host | Plans celebrations or books for another person; owns decisions and reviews. |
| Vendor owner | Manages services, quotes, team, subscriptions and payouts. |
| Vendor staff | Performs explicitly delegated business tasks. |
| Guest/door operator | Claims invitations or validates admission with minimal access. |
| Support, finance, operations, arbitrator | Resolve cases through separated permissions. |

## Planned features

### Navigation & IA
- Cross-house Alert Badges: Unread activity for the other house (e.g.
- Dual Workspace Switcher (Host/Vendor Houses) (built): A single account can hold a Host workspace and a Vendor workspace, with a switcher to move between.
- Unified Vendor House (Single Vendor Type) (built): Every vendor has one Vendor house and profile; there is no separate 'listed' vs 'operating' type, only different.
- Vendor Team Structure: A vendor business (the 'house') can have one or two team members (owner, staff) with some sections like.
- Become a Vendor Empty State (built): A host-only user sees an empty 'Become a vendor' state that lets them open a second (Vendor) house.
- Unicode-normalized Search Alias: Users who type 'Owambe' without diacritics can still find Ówàńbè via a normalized search alias.
### Onboarding
- AI Intent Capture: A new host's first interaction is with the AI assistant, which registers their intent: hosting a party/event, or.
- Payment Caution Acknowledgment: Before making their first payment (especially to an unverified vendor), a host must tick an acknowledgment accepting the.
- Personalised Dashboard: After profile and intent capture, hosts see a dashboard matched to their interest: vendors, event centres, MCs, fashion.
- Vendor Vetting at Sign-up: Vendors sign up providing company registration details; vetting also draws on user recommendations/referrals.
- Media Section & Event of the Week: Hosts can browse a media section with videos of parties, including a highlighted 'Event of the Week' showcase.
### Core workflows
- AI investigation agent: Needed before the features that name "AI investigation agent" can be built.
- AI model provider contract (built): Needed before the features that name "AI model provider contract" can be built.
- AI-Assisted Event Planning (OwanbePlanner): The host can ask the AI to plan within a budget; it proposes vendor options using market benchmarks.
- Booking completion confirmation (built): Needed before the features that name "Booking completion confirmation" can be built.
- Booking history (built): Needed before the features that name "Booking history" can be built.
- BVN/bank API: Needed before the features that name "BVN/bank API" can be built.
- Case/evidence storage: Needed before the features that name "Case/evidence storage" can be built.
- Direct Search & Book Flow: A host can search directly and book, which opens a chat with the vendor; the vendor sends a.
- Dispute Filing & Arbitration: A host can file a dispute within 24 hours of the event date with evidence; the platform and.
- Email service: Needed before the features that name "Email service" can be built.
- File storage: Needed before the features that name "File storage" can be built.
- Fund pool/escrow (built): Needed before the features that name "Fund pool/escrow" can be built.
- Fund pool/recovery fund: Needed before the features that name "Fund pool/recovery fund" can be built.
- Identity verification per country: Needed before the features that name "Identity verification per country" can be built.
- In-app chat (host-vendor conversations) (built): You decided that in-app chat should be built before the search-and-book flow, but chat has no entry in.
- Liveness/face-match provider: Needed before the features that name "Liveness/face-match provider" can be built.
- Malware/file-type scanning: Needed before the features that name "Malware/file-type scanning" can be built.
- Market benchmark data (built): Needed before the features that name "Market benchmark data" can be built.
- Monitoring/observability tool (built): Needed before the features that name "Monitoring/observability tool" can be built.
- NIBSS API: Needed before the features that name "NIBSS API" can be built.
- NIMC API: Needed before the features that name "NIMC API" can be built.
- Open banking API: Needed before the features that name "Open banking API" can be built.
- OwanbeAI (Guest & Visitor Concierge): Public AI for site visitors (general platform questions) and event guests (event details after verifying an invitation or.
- OwanbeAssistant (AI Infrastructure & Staff Console): Foundation only.
- OwanbePlanner (built): Private, signed-in AI planner for hosts, event managers and vendors: budgets, timelines, vendor discovery and quote drafting.
- Partner bank: Needed before the features that name "Partner bank" can be built.
- Project setup (built): Scope.
- Quote Lifecycle & Date Lock (built): Vendors author quotes (price, inclusions, extras, expiry) via a dynamic auto-quote builder; a sent quote locks that date.
- Split Payment & Completion Confirmation: 70% of the booking is released to the vendor at booking; the remaining 30% releases after the host.
- Ticketing system: Needed before the features that name "Ticketing system" can be built.
- Vendor data (built): Needed before the features that name "Vendor data" can be built.
- Vendor No-show Recovery: If a host reports a vendor no-show, the platform opens a recovery case against the vendor; the vendor.
- Wallet ledger: Needed before the features that name "Wallet ledger" can be built.
- Aso-ebi ordering: The host picks the aso-ebi fabric, colour, price and vendor, and shares a link.
- Benchmark disclosure constant (built): Verified code capability linked by Sage CTO: src/features/benchmarks/contracts.ts:BENCHMARK_DISCLOSURE.
- BVN API: Needed before the features that name "BVN API" can be built.
- CAC API: Needed before the features that name "CAC API" can be built.
- Cultural guides hub with Ask OwanbePlanner: A public library of guides to Yoruba and Nigerian ceremonies (introduction, engagement, naming, wedding, burial, birthday), covering etiquette.
- Event-day run of show (shared vendor timeline): One timeline for the event day that every booked vendor (decorator, caterer, MC, DJ, photographer) can see and.
- Homepage Marketing Sections (built): Verified code capability linked by Sage CTO: src/components/home/* (Hero, ExploreCategories, etc.).
- Landing Page (built): Verified code capability linked by Sage CTO: src/components/home/, routes/_public/index.tsx.
- Logistics/delivery operations: Needed before the features that name "Logistics/delivery operations" can be built.
- Onboarding Flow (built): Verified code capability linked by Sage CTO: src/features/onboarding/.
- Outsourcing / Book-on-behalf Flow: A host can arrange services on behalf of someone else using the same host account and flow; bookings.
- Ówàńbè Moments: user-uploaded celebration photos & videos: Extends the existing "Media Section & Event of the Week" so hosts and their guests can upload photos.
- Paystack Payment Processing (built): Verified code capability linked by Sage CTO: src/lib/payments/.
- Planner disclosure constant (built): Verified code capability linked by Sage CTO: src/features/planner/contracts.ts:PLANNER_DISCLOSURE.
- Planner workspace with client portal: Lets a professional event planner run several clients' celebrations from one Ówàńbè account.
- Public celebration budget calculator (built): A free calculator anyone can use without signing in: choose the event type, city and guest count, and.
- Staff analytics capability (built): Verified code capability linked by Sage CTO: supabase/migrations/20261109160000_f106_market_benchmarks.sql:staff_grants capability.
- UI Component Library (built): Verified code capability linked by Sage CTO: src/components/ui/* (40+ components).
- Unanswered Enquiry Fallback: If a vendor is slow to respond, the host is shown other relevant, vetted vendor alternatives rather than.
- Vendor lead-capture link and enquiry pipeline: Each vendor (and planner) gets a shareable enquiry link for their Instagram bio or WhatsApp.
### Actions & controls
- Host Cancellation Policy: A host may cancel only within 24 hours of payment, forfeiting 20% of the full quote price to.
- Quote Counter-Offer Controls (built): The host can counter a vendor's quote in chat; the vendor must issue a revised quote, which the.
- Trust Score System: A vendor-facing score built from ratings, reviews and completed bookings, reduced by any cancellation; a low score strongly.
- Vendor Cancellation Handling: If a vendor cancels after payment, the host gets a full refund and the vendor receives a non-appealable.
### Feedback systems
- Live Payment Status Tracker & AI Escalation (built): Hosts see a live status for their payment; a failed payment triggers an AI agent that traces the.
- Multi-channel Notification Delivery: Hosts and vendors are notified via in-app, WhatsApp and email; if WhatsApp fails or there's no opt-in, the.
- Post-booking Ratings & Reviews: After a completed booking, hosts leave ratings and written reviews; reviews are only accepted from people who actually.
- AI 'Best Bargain' Ranking: The AI uses reviews, ratings and price/value of offers to surface the 'best bargain' recommendations to hosts.
### Settings & preferences
- Payout Change Verification: Changing a vendor's payout/bank details requires identity verification via face scan, secret PIN, or 2FA before the change.
- Post-recovery Payout Lock: After a successful account recovery, payout changes are locked for 48 hours, with alerts sent to old contact.
- Team, Roles & Billing Settings: Vendor account settings include team member management, role assignment, billing/subscription details, and service catalog management.
- Notification Channel Preferences: Users can set preferred notification channels (in-app, WhatsApp, email) and preferred currency, and update event details after setup.
- Trusted Partner Recovery Flow: Users can opt in to a 'trusted partner' backup contact; recovery requires correctly naming the partner's saved nickname.
### Help & support
- Emergency Replacement Vendor Recommendation: When a no-show is reported, the platform immediately recommends available vetted vendors for that date to save the.
- No-show Ticket & Evidence Flow: A host facing a vendor no-show can file a support ticket with evidence; only customer service can view.
- Host-visible Ticket Progress: Hosts can see the real-time progress of their support ticket/case.
- In-house Event Manager Fallback (built): The platform staffs in-house event managers who can step in and ensure an event proceeds when no replacement.
- Support Escalation Chain: If the vendor doesn't respond, customer service escalates by calling the vendor's team member or trusted partner (with.
### Data & state
- Data model (built): UUID identifiers, UTC timestamps, explicit currencies, integer minor-unit amounts, and version columns are standard.
- Guest List Privacy Controls (built): Guest lists and RSVPs are private by default, visible only to the host, who can choose to share.
- Losing-bid Refund & Reversal Flow: If a host loses a date race to another host, they are automatically refunded, sent a reversal receipt.
- Record Retention Policy: Chats, quotes and plans are kept until the user deletes them; payment records are never deleted, kept for.
- Vendor Calendar Soft-hold (built): Accepting a quote starts a 24-hour payment window and softly holds the date; a vendor may engage multiple.
- Invitation Tiers: Hosts can create invitations in Regular, VIP, VVIP and Diamond tiers; Diamond includes a premium branded-car hand-delivery by.
### Permissions & roles
- AI Investigation-only Role (built): The AI agent can investigate payment issues and report findings but cannot move money or approve anything itself.
- Immediate Access Revocation on Removal: When a team member is removed, they immediately lose access to all business operations including live sessions; the.
- Permission scoping (built): Auth0 subject maps uniquely to an application user.
- Scoped Support & Event Manager Visibility: Customer support can read host-vendor chats but not payment details; event managers see only the details of events/hosts.
- Second-approver for Large Fund Actions: Large refunds and large fund-related manual job re-runs require a second person's approval before taking effect.
- Vendor Team Role Delegation: Hosts cannot delegate; only vendor business owners can add team members and set per-person roles (e.g.
### Integrations & dependencies
- Backup Payment Processor (built): A backup payment processor exists for when the primary processor is down; during a full outage, the 24-hour.
- NIN/BVN Identity Verification Integration: Vendor and user identity verification integrates with NIN (NIMC) and BVN (bank) records; while the identity provider is.
- Payment Router & Banking Integrations (built): A proprietary Payment Router sits between host and vendor banks, integrating NIBSS and open-banking APIs with a partner.
- WhatsApp/SMS Critical Alert Integration: In-app and WhatsApp are default notification channels; SMS is used for critical events (failed payment, lapsing window, payout.
- Brand Design System (built): Verified code capability linked by Sage CTO: owanbe-brand-kit/tokens/*.
- Manual CAC/NIMC/BVN Verification Integration (built): When automated verification repeatedly fails, staff manually check vendors against CAC (company registration), NIMC (NIN) and BVN (bank).
- Paystack Webhook Signature Verification (built): Found in audit: src/lib/payments/paystack.server.ts, src/routes/api/public/paystack/webhook.ts.
### Admin / back-office
- Admin Decision Audit & Second-person Review: Every verification approve/reject decision is logged with staff rationale and reviewed by a second person weekly and monthly.
- Disputes & Refunds Console: Staff tool for reviewing disputed bookings, no-show cases, and approving refunds once evidence is confirmed.
- System Monitoring Dashboard: Back-office screen for monitoring platform health (payments, jobs, verification queue) with on-call alerting.
- Vendor Verification Review Queue: A back-office queue handles vendor verification, mostly automatic with a 24-hour maximum hold; unresolved cases escalate to manual.
- Event Manager Assignment System: Admin tool to assign in-house event managers to specific events/hosts, scoping their visibility to only assigned cases.
### Security & compliance
- AI Chatbot Disclosure (built): Users interacting with OwanbeAI (vendors) and OwanbePlanner (hosts) are clearly told they are talking to AI, with a.
- Authentication (built): Quotes are immutable revisions: draft → sent → countered/accepted/declined/expired.
- Biometric Data Consent (Face Scan): Face scan used for payout-change and account-recovery verification requires explicit consent and secure storage of biometric data.
- GDPR/UK-GDPR Data Rights for Diaspora Users: Some users are Nigerians in diaspora who may reside in the EU/UK, requiring GDPR/UK-GDPR-equivalent data rights (access, export.
- Health Data Protection (Dietary/Allergy Info) (built): Guest dietary and allergy data collected for catering is treated as sensitive health data, with explicit consent, restricted.
- ID Document Retention & Deletion Policy: ID and CAC documents used for verification are deleted once verification completes, retaining only an audit-chain record.
- Marketing Email Unsubscribe + Postal Address: Newsletters and re-engagement emails are sent; every marketing email must include an unsubscribe link and the company's postal.
- Payment Data Protection (Tokenization via Partner): Card and bank details are stored only by payment partners; Ówàńbè stores only wallet balances and transaction records.
- Subscription Cancellation & Billing Transparency: Vendors pay monthly subscriptions and hosts pay transaction/AI-planner fees; cancellation is self-serve, with renewal reminders, receipts, failed-payment retries.
- Upload Moderation & Takedown Process (built): Users upload vendor portfolio photos, ID/CAC documents, contracts, and guest-list files; a review-based takedown process exists for ownership.
- Zero Data Retention (ZDR) for AI Models: Sensitive data (e.g.
- Payment Credential Guard (built): Verified code capability linked by Sage CTO: src/lib/payments/credential-guard.ts.
- Payment Safe Authorization (built): Verified code capability linked by Sage CTO: src/lib/payments/safe-authorization.test.ts.
### Growth & retention
- Link Claim & Couple Sharing Rules: An invite link can be claimed by only one person unless the host marks it as a couple's.
- VIP Access Card (QR/NFC Check-in) (built): Invited guests download the Ówàńbè app and claim their invite link (tied to the link and their phone.
- Host-controlled Link Reissue: If the wrong person claims a forwarded invite link, only the host can release and reissue it; door.
- Referral Program: Hosts and vendors earn fee discounts and free premium time for referring others to the platform.
### Task / background systems
- Automated Timed Jobs: All timed operations run automatically: 24-hour booking/quote expiry, verification SLA, held-payment release, subscription renewals/downgrades, and event reminders.
- CI (built): | Quality scenario | Required automated/operational tests | |---|---| | Security | Cross-house read/write matrix across APIs, RLS.
- Deployment (built): Separate development, staging, and production projects, credentials, payment modes, indexes, and storage.
- Manual Job Rerun with Second Approval: Ops staff with granted access can fix and re-run failed background jobs; large fund-related reruns require a second.
- Real-time Job Monitoring & Alerting: A monitoring system reports job events in real time and immediately alerts the operations team on failure (e.g.
- Error Reporting (built): Verified code capability linked by Sage CTO: src/lib/lovable-error-reporting.ts, src/lib/error-capture.ts.
- Indexed codebase memory bank and verification script (built): Verified code capability linked by Sage CTO: memory-bank/README.md, scripts/memory-bank.mjs.
- Test Suites (built): Verified code capability linked by Sage CTO: src/test/*, supabase/tests/*.
### Other
- Auth0 & Supabase Authentication (built): Found in audit: src/lib/auth/AuthProvider.tsx, supabase/migrations/20261101000000_f76_users_auth.sql.
- Public Vendor Directory & Profiles (built): Found in audit: src/routes/_public/vendors.index.tsx, src/routes/_public/vendors.$slug.tsx.
- Quotes Lifecycle & Revisions (built): Found in audit: src/features/quotes/api.ts, supabase/migrations/20261104120000_f14_quotes.sql.
- Vendor Calendar Soft-Hold & Refund Ledger (built): Found in audit: src/features/holds/api.ts, supabase/migrations/20261104160000_f38_vendor_calendar_soft_hold.sql.

## Architecture and technology

The system design and implementation plan are in the [architecture](./blueprint/architecture.md) and [tech spec](./blueprint/tech-spec.md).

See the tech spec for the technology choices.

## Repository map

- `AGENTS.md`: Instructions for AI coding agents.
- `README.md`: Project overview and agent workflow.
- `blueprint/system-overview.md`: Plain-language system overview.
- `blueprint/prd.md`: Product requirements and acceptance criteria.
- `blueprint/architecture.md`: System architecture and data flow.
- `blueprint/tech-spec.md`: Technical specification and implementation plan.
- `blueprint/design-system.md`: Design tokens and UI rules.

## Getting started

Install dependencies:

```bash
bun install
```

Copy `.env.example` to `.env` and fill in the values for `APP_ORIGIN`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, `SUPABASE_URL`, `SUPABASE_PUBLIC_KEY`. Do not commit `.env`.

Start the app:

```bash
bun run dev
```

## Contributing and agent workflow

Read `AGENTS.md` first. Keep changes small and work only on the `develop` branch (never create or push feature branches). Include the feature ID in every commit message; Sage 7 audits `develop` and promotes it to `main` only when the audit passes.

Connect the Sage 7 MCP server in `opencode.json`:

```json
{
  "mcp": {
    "sage7": {
      "type": "remote",
      "url": "https://sage7.dev/mcp",
      "headers": { "Authorization": "Bearer {env:SAGE7_TOKEN}" }
    }
  }
}
```

Set `SAGE7_TOKEN` locally and never commit it. The connection is read-only and scoped to this project.

## Security and privacy

Keep secrets and service credentials in server-side environment variables. Do not commit tokens, keys, or customer data. Blueprint files are project documentation, not a place for credentials.

## License

To be decided.

<!-- sage7:start -->
## Now / Next / Open decisions

- Now: Cross-house Alert Badges
- Next: Vendor Team Structure
- Next: AI Intent Capture
- Open: None recorded.
<!-- sage7:end -->
