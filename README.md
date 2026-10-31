# Ówàńbè

Ówàńbè is a proposed platform for planning Nigerian celebrations and coordinating vendors.

Blueprint stage, no application code yet.

## Overview

The platform helps hosts plan events, discover vendors, compare quotes, and manage bookings, while vendors manage services, enquiries, quotes, and teams. Guests can claim invitations and use entry cards, and AI supports planning and issue investigation without approving commitments or moving money.

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
- Dual Workspace Switcher (Host/Vendor Houses): A single account can hold a Host workspace and a Vendor workspace, with a switcher to move between.
- Unified Vendor House (Single Vendor Type): Every vendor has one Vendor house and profile; there is no separate 'listed' vs 'operating' type, only different.
- Vendor Team Structure: A vendor business (the 'house') can have one or two team members (owner, staff) with some sections like.
- Become a Vendor Empty State: A host-only user sees an empty 'Become a vendor' state that lets them open a second (Vendor) house.
- Unicode-normalized Search Alias: Users who type 'Owambe' without diacritics can still find Ówàńbè via a normalized search alias.
### Onboarding
- AI Intent Capture: A new host's first interaction is with the AI assistant, which registers their intent: hosting a party/event, or.
- Payment Caution Acknowledgment: Before making their first payment (especially to an unverified vendor), a host must tick an acknowledgment accepting the.
- Personalised Dashboard: After profile and intent capture, hosts see a dashboard matched to their interest: vendors, event centres, MCs, fashion.
- Vendor Vetting at Sign-up: Vendors sign up providing company registration details; vetting also draws on user recommendations/referrals.
- Media Section & Event of the Week: Hosts can browse a media section with videos of parties, including a highlighted 'Event of the Week' showcase.
### Core workflows
- AI-Assisted Event Planning (OwanbePlanner): The host can ask the AI to plan within a budget; it proposes vendor options using market benchmarks.
- Direct Search & Book Flow: A host can search directly and book, which opens a chat with the vendor; the vendor sends a.
- Dispute Filing & Arbitration: A host can file a dispute within 24 hours of the event date with evidence; the platform and.
- Project setup: Scope.
- Quote Lifecycle & Date Lock: Vendors author quotes (price, inclusions, extras, expiry) via a dynamic auto-quote builder; a sent quote locks that date.
- Split Payment & Completion Confirmation: 70% of the booking is released to the vendor at booking; the remaining 30% releases after the host.
- Vendor No-show Recovery: If a host reports a vendor no-show, the platform opens a recovery case against the vendor; the vendor.
- Outsourcing / Book-on-behalf Flow: A host can arrange services on behalf of someone else using the same host account and flow; bookings.
- Unanswered Enquiry Fallback: If a vendor is slow to respond, the host is shown other relevant, vetted vendor alternatives rather than.
### Actions & controls
- Host Cancellation Policy: A host may cancel only within 24 hours of payment, forfeiting 20% of the full quote price to.
- Quote Counter-Offer Controls: The host can counter a vendor's quote in chat; the vendor must issue a revised quote, which the.
- Trust Score System: A vendor-facing score built from ratings, reviews and completed bookings, reduced by any cancellation; a low score strongly.
- Vendor Cancellation Handling: If a vendor cancels after payment, the host gets a full refund and the vendor receives a non-appealable.
### Feedback systems
- Live Payment Status Tracker & AI Escalation: Hosts see a live status for their payment; a failed payment triggers an AI agent that traces the.
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
- In-house Event Manager Fallback: The platform staffs in-house event managers who can step in and ensure an event proceeds when no replacement.
- Support Escalation Chain: If the vendor doesn't respond, customer service escalates by calling the vendor's team member or trusted partner (with.
### Data & state
- Data model: UUID identifiers, UTC timestamps, explicit currencies, integer minor-unit amounts, and version columns are standard.
- Guest List Privacy Controls: Guest lists and RSVPs are private by default, visible only to the host, who can choose to share.
- Losing-bid Refund & Reversal Flow: If a host loses a date race to another host, they are automatically refunded, sent a reversal receipt.
- Record Retention Policy: Chats, quotes and plans are kept until the user deletes them; payment records are never deleted, kept for.
- Vendor Calendar Soft-hold: Accepting a quote starts a 24-hour payment window and softly holds the date; a vendor may engage multiple.
- Invitation Tiers: Hosts can create invitations in Regular, VIP, VVIP and Diamond tiers; Diamond includes a premium branded-car hand-delivery by.
### Permissions & roles
- AI Investigation-only Role: The AI agent can investigate payment issues and report findings but cannot move money or approve anything itself.
- Immediate Access Revocation on Removal: When a team member is removed, they immediately lose access to all business operations including live sessions; the.
- Permission scoping: Auth0 subject maps uniquely to an application user.
- Scoped Support & Event Manager Visibility: Customer support can read host-vendor chats but not payment details; event managers see only the details of events/hosts.
- Second-approver for Large Fund Actions: Large refunds and large fund-related manual job re-runs require a second person's approval before taking effect.
- Vendor Team Role Delegation: Hosts cannot delegate; only vendor business owners can add team members and set per-person roles (e.g.
### Integrations & dependencies
- Backup Payment Processor: A backup payment processor exists for when the primary processor is down; during a full outage, the 24-hour.
- NIN/BVN Identity Verification Integration: Vendor and user identity verification integrates with NIN (NIMC) and BVN (bank) records; while the identity provider is.
- Payment Router & Banking Integrations: A proprietary Payment Router sits between host and vendor banks, integrating NIBSS and open-banking APIs with a partner.
- WhatsApp/SMS Critical Alert Integration: In-app and WhatsApp are default notification channels; SMS is used for critical events (failed payment, lapsing window, payout.
- Manual CAC/NIMC/BVN Verification Integration: When automated verification repeatedly fails, staff manually check vendors against CAC (company registration), NIMC (NIN) and BVN (bank).
### Admin / back-office
- Admin Decision Audit & Second-person Review: Every verification approve/reject decision is logged with staff rationale and reviewed by a second person weekly and monthly.
- Disputes & Refunds Console: Staff tool for reviewing disputed bookings, no-show cases, and approving refunds once evidence is confirmed.
- System Monitoring Dashboard: Back-office screen for monitoring platform health (payments, jobs, verification queue) with on-call alerting.
- Vendor Verification Review Queue: A back-office queue handles vendor verification, mostly automatic with a 24-hour maximum hold; unresolved cases escalate to manual.
- Event Manager Assignment System: Admin tool to assign in-house event managers to specific events/hosts, scoping their visibility to only assigned cases.
### Security & compliance
- AI Chatbot Disclosure: Users interacting with OwanbeAI (vendors) and OwanbePlanner (hosts) are clearly told they are talking to AI, with a.
- Authentication: Quotes are immutable revisions: draft → sent → countered/accepted/declined/expired.
- Biometric Data Consent (Face Scan): Face scan used for payout-change and account-recovery verification requires explicit consent and secure storage of biometric data.
- GDPR/UK-GDPR Data Rights for Diaspora Users: Some users are Nigerians in diaspora who may reside in the EU/UK, requiring GDPR/UK-GDPR-equivalent data rights (access, export.
- Health Data Protection (Dietary/Allergy Info): Guest dietary and allergy data collected for catering is treated as sensitive health data, with explicit consent, restricted.
- ID Document Retention & Deletion Policy: ID and CAC documents used for verification are deleted once verification completes, retaining only an audit-chain record.
- Marketing Email Unsubscribe + Postal Address: Newsletters and re-engagement emails are sent; every marketing email must include an unsubscribe link and the company's postal.
- Payment Data Protection (Tokenization via Partner): Card and bank details are stored only by payment partners; Ówàńbè stores only wallet balances and transaction records.
- Subscription Cancellation & Billing Transparency: Vendors pay monthly subscriptions and hosts pay transaction/AI-planner fees; cancellation is self-serve, with renewal reminders, receipts, failed-payment retries.
- Upload Moderation & Takedown Process: Users upload vendor portfolio photos, ID/CAC documents, contracts, and guest-list files; a review-based takedown process exists for ownership.
- Zero Data Retention (ZDR) for AI Models: Sensitive data (e.g.
### Growth & retention
- Link Claim & Couple Sharing Rules: An invite link can be claimed by only one person unless the host marks it as a couple's.
- VIP Access Card (QR/NFC Check-in): Invited guests download the Ówàńbè app and claim their invite link (tied to the link and their phone.
- Host-controlled Link Reissue: If the wrong person claims a forwarded invite link, only the host can release and reissue it; door.
- Referral Program: Hosts and vendors earn fee discounts and free premium time for referring others to the platform.
### Task / background systems
- Automated Timed Jobs: All timed operations run automatically: 24-hour booking/quote expiry, verification SLA, held-payment release, subscription renewals/downgrades, and event reminders.
- CI: | Quality scenario | Required automated/operational tests | |---|---| | Security | Cross-house read/write matrix across APIs, RLS.
- Deployment: Separate development, staging, and production projects, credentials, payment modes, indexes, and storage.
- Manual Job Rerun with Second Approval: Ops staff with granted access can fix and re-run failed background jobs; large fund-related reruns require a second.
- Real-time Job Monitoring & Alerting: A monitoring system reports job events in real time and immediately alerts the operations team on failure (e.g.

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

No code yet.

Start with the agent workflow:

1. Read `AGENTS.md` and the documents in `blueprint/` before proposing changes.
2. Connect the Sage 7 MCP server in `opencode.json`:

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

   Set `SAGE7_TOKEN` in your shell or local environment. Do not commit the token.
3. Ask the agent for a plan before it edits code.
4. Keep one feature per branch and include the feature ID in commit messages.
5. Run an audit against the feature map before merging.

## Contributing and agent workflow

Read `AGENTS.md` first. Keep changes small, use one branch per feature, include the feature ID in commit messages, and run an audit before merging.

The read-only, project-scoped Sage 7 MCP connection gives agents the next task and feature spec. Never commit its token.

## Security and privacy

Keep secrets and service credentials in server-side environment variables. Do not commit tokens, keys, or customer data. Blueprint files are project documentation, not a place for credentials.

## License

To be decided.

<!-- sage7:start -->
## Now / Next / Open decisions

- Now: Cross-house Alert Badges
- Next: Dual Workspace Switcher (Host/Vendor Houses)
- Next: Unified Vendor House (Single Vendor Type)
- Open: Diamond tier logistics scheduling and proof-of-delivery process.
- Open: What exactly can in-house event managers see beyond their assigned events?
- Open: What is the monetary threshold defining 'large'?
<!-- sage7:end -->
