# AGENTS.md — Ówàńbè

## How agents use Sage 7 (10 tools)
Sage 7 MCP never edits code, dispatches builds or marks a feature built. Its only writes are reports to the owner's inbox (report_question, report_decision); without MCP, write open questions and decisions in docs/journal/ and docs/decisions/ and they are picked up on push. This workflow applies even when MCP is not connected. The tools are list_projects, get_next_task, get_feature_spec, get_context_markdown, get_context_package, get_context_status, report_question, report_decision, report_progress, get_answers.

- Read AGENTS.md and the blueprint/ documents in the repository first. They survive when MCP is not connected.
- Call list_projects when you need the project ID. When the owner asks you to start work, call get_next_task once for the feature to build.
- Call get_feature_spec for that feature, and get_context_markdown or get_context_package when you need the full context.
- Ask the user to approve a plan before writing code. Use get_context_status with the last version you read before refreshing.
- Build in stage order, like a building: Foundation, then Structure (shared engines, data and services), then Rooms (features people use), then Finishes. Only build the task get_next_task returns; work built ahead of its stage or prerequisites is held and doesn't count. If a feature needs something that isn't built, say so with report_question naming the feature code.
- Build one feature per branch. Include its feature ID in every commit message, for example feat(F-123): ...
- When a feature is done, call report_progress with its feature ID and commits. It shows as awaiting audit; audit evidence decides what is built, commits are only build evidence. Then stop and tell the owner: don't pull or start another feature until they say so.
- When the spec doesn't answer something, call report_question (blocking=true if you can't continue) with plain_language the owner can follow without technical knowledge; report decisions you make with report_decision. Never decide or build a feature whose blocking question you asked is still unanswered. Call get_answers at the start of each session.

## Branching (owner decision, 2026-11-06; overrides "one feature per branch" above)
- `main` is production-ready only. Merge `develop` into `main` to release.
- `develop` is the single branch for all new work. Don't create feature branches.
- Keep the feature ID in every commit (`feat(F-123): …`) and a `docs/journal/` entry per feature. That is how Sage 7 traces each feature.

## Commit convention
Include the feature ID in every commit message, for example feat(F-123): ...

## Project context

Ówàńbè supports celebration planning and commerce through separate Host and Vendor houses, AI-assisted planning, vendor discovery, quotes, bookings, and payments.  
The platform provides vendor teams, event operations, private guest lists, invitation access, disputes, verification, and scoped staff oversight.

## Golden rules

- Treat the feature map as the scope authority; preserve `must`, `should`, and `could` priorities. Treat every `must` feature as a release requirement, including blocked dependencies.
- Follow the decided stack over conflicting historical implementation excerpts. Do not copy stale architecture or configuration blindly.
- Build only the assigned feature and its approved dependencies. Avoid unrelated refactors.
- Preserve house isolation, least privilege, financial correctness, consent, and auditability in every change.
- Enforce business rules on the server and in database policies; never rely on hidden controls or client checks.
- Target **OWASP ASVS Level 3**. Maintain requirement-to-control-and-test evidence; do not claim compliance from a checklist alone.
- Never invent thresholds, fees, permission grants, regulatory arrangements, or missing requirements.
- Include the assigned feature ID in **every commit message**:
  - Single project: `feat(F-123): add quote revision validation`
  - Multiple Sage 7 projects: `feat(<project-slug>/F-123): add quote revision validation`
  - Apply the same convention to `fix`, `test`, `docs`, `refactor`, and other commit types.
- Obtain the actual feature ID from the tracker or owner; do not fabricate IDs from feature names.

## How to approach a task

1. **Read first.**
   - Read the PRD, architecture, `blueprint/tech-spec.md` where present, and `design_system.md`.
   - Read the relevant feature-map entries, dependencies, open questions, and acceptance criteria.
   - Inspect repository instructions, manifests, existing tests, and adjacent implementations.
   - Consult `memory-bank/README.md`; run `scripts/memory-bank.mjs` according to its documented usage.
   - Verify referenced capabilities exist; do not treat truncated blueprint excerpts as complete specifications.
2. **Plan before editing.**
   - Identify the feature ID, affected houses and roles, data changes, failure paths, integrations, and tests.
   - Record scope, small implementation steps, rollout approach, and unresolved decisions.
   - Stop affected work when authorization, money movement, privacy, or stack choices remain unresolved.
3. **Implement in small steps.**
   - Prefer a narrow, testable vertical slice.
   - Reuse existing components, domain rules, integration adapters, and test fixtures.
   - Add backward-compatible migrations and server-side protections before exposing UI actions.
4. **Verify each step.**
   - Run the repository’s formatting, lint, type, test, build, and memory-bank verification commands.
   - Test denied access, retries, concurrency, and degraded states—not only successful flows.
   - Review the diff for secrets, accidental scope, dependency changes, and destructive migrations.
5. **Report accurately.**
   - Summarize changes, feature IDs, checks actually run, limitations, and blockers.
   - Update architecture notes, contracts, and memory-bank records when behavior changes.
   - Never label an untested or blocked workflow production-ready.

## Design rules

- Always use tokens from **`design_system.md`**. Never hardcode colors.
- Reuse `src/components/ui/*`, existing homepage components, and approved patterns before creating alternatives.
- Inspect `owanbe-brand-kit/tokens/*`; reconcile differences with `design_system.md` rather than creating parallel token systems.
- Request missing tokens through the design system; do not invent local branding values.
- Provide **empty, loading, and error states for every view**.
  - For the personalized dashboard, handle zero results with useful approved fallback content rather than a blank dashboard.
  - Preserve retry paths, accessible status messages, and user input after recoverable failures.
- Use accessible labels, keyboard navigation, visible focus, adequate contrast, and clear validation.
- Optimize for mid-range phones and slow connections; use progressive disclosure for deeper vendor tools.
- Keep one Vendor house/profile model; do not split vendors into “listed” and “operating” types.
- Show per-house unread badges. Require confirmation before cross-house navigation; never auto-switch.
- Label AI conversations persistently and provide response-reporting controls.
- Explain payment warnings, expiry, refunds, locks, verification status, and approval requirements in plain language.
- Render countdowns from authoritative server deadlines, not client-owned business timers.

## Code conventions and folder structure suggestion

- Follow established repository conventions; avoid restructuring solely to match this suggestion.
- Prefer typed contracts and small, cohesive modules; avoid implicit types at security and payment boundaries.
- Separate UI, domain rules, authorization, persistence, and external integrations.
- Keep privileged clients and secrets in server-only modules.
- Centralize permissions and state transitions; do not duplicate them across web, mobile, and jobs.
- Use UUIDs, UTC timestamps, explicit currencies, integer minor-unit monetary amounts, and version columns.
- Derive tenancy through foreign keys; use composite constraints to prevent mismatched house references.
- Add migrations for every schema or policy change; never manually patch production data structures.
- Document non-obvious invariants and trade-offs rather than narrating code.

```text
src/
  routes/                 # TanStack Start routes
  components/
    ui/                   # Reusable token-driven primitives
    home/                 # Existing marketing components
  features/
    <feature>/            # UI, contracts, domain logic, colocated tests
  lib/                    # Shared utilities and existing error capture
  server/                 # Server-only authorization and integrations
  test/                   # Existing test support and suites
mobile/                   # Expo app, if consistent with repository layout
shared/                   # Platform-neutral contracts and domain rules
supabase/
  migrations/
  functions/              # Edge Functions
  tests/
trigger/                  # Trigger.dev jobs
memory-bank/
scripts/
docs/
  decisions/
  open-questions.md
```

- Preserve and reuse `src/lib/lovable-error-reporting.ts` and `src/lib/error-capture.ts` where applicable.
- Redact sensitive data before sending diagnostics to Sentry or existing error-reporting paths.

## Data & security rules

### Identity, authorization, and isolation

- Use Auth0 as the authentication authority; map its subject uniquely to the application user.
- Validate token signature, issuer, audience, expiry, and session status.
- Confirm the supported Auth0-to-Supabase token-validation path **before** implementing direct database or Realtime access.
- Apply default-deny row-level security to application data and storage policies to files.
- Enforce role, capability, assignment, and field restrictions at API boundaries as well as persistence boundaries.
- Scope search indexes, Realtime subscriptions, exports, cached data, and signed file access—not just database queries.
- Expose authorized projections for cross-party records; never expose either party’s entire private house.
- Prohibit host delegation. Allow only vendor owners to manage team membership and capabilities.
- Restrict payout changes to vendor owners with required step-up verification.
- Revoke removed members immediately, including active sessions and subscriptions; do not merely block their next login.
- Allow owners to see their business conversations. Deny vendor staff payout changes and member administration.
- Allow support to read authorized chats, but not payment details. Restrict event managers to assigned cases.
- Log every sensitive access without logging the sensitive content itself.

### Secrets and input protection

- Keep service-role keys, payment credentials, signing secrets, and privileged integration keys server-side.
- Validate inputs at every trust boundary: routes, jobs, webhooks, uploads, and AI tool calls.
- Verify webhook authenticity; defend against replay and duplicate delivery.
- Rate-limit authentication, recovery, OTPs, invitations, uploads, search, AI, and financial actions.
- Enforce upload size/type checks, malware scanning, quarantine, and access controls before making files available.
- Use encrypted private storage for identity documents. Do not introduce an unapproved scanning service.

### Financial and workflow integrity

- Model quotes as immutable revisions; permit only vendors to author quotes. Restart expiry when a revised quote is sent.
- **Block booking rollout until the quote-lock versus competing-hold interpretation is approved.** Do not treat advisory locks or one-capacity-unit-per-date assumptions as decisions.
- Resolve payment allocation atomically with database constraints and serialized transactions once approved.
- Make jobs, payment requests, reconciliation, refunds, and webhook handlers idempotent and safely retryable.
- Record immutable financial events and reconciliation outcomes; never infer success from a browser redirect.
- Enforce the 70/30 release rules, dispute freezes, cancellation rules, and 48-hour post-recovery payout lock server-side.
- Reconcile refund obligations with already-released funds; do not assume partner recovery is available.
- Require two distinct authorized staff approvals for large fund actions and qualifying reruns. Block threshold-dependent actions until “large” is defined.
- Keep AI payment investigations read-only. Never allow AI to move money or approve actions; require human approval for advances.
- Store only permitted balances, transaction records, and partner tokens; never raw PANs, bank account numbers, or account credentials.
- Implement timers through Trigger.dev with durable deadlines, outage pauses, retry handling, and catch-up behavior.

### Privacy and sensitive data

- Keep guest lists private by default; always mask phone numbers and addresses in shared/public projections.
- Capture explicit consent for dietary/allergy data; restrict visibility to the host and assigned caterer.
- Schedule post-event health-data deletion; obtain a decision on the exact retention deadline.
- Use revocable platform access grants for sharing. Never let AI reveal otherwise hidden data.
- Send sensitive data to AI models only under an approved zero-data-retention agreement.
- Capture biometric consent; encrypt templates and minimize raw-image retention.
- Delete verification documents after completion only under a legally approved policy resolving KYC retention conflicts.
- Support access, export, and deletion rights while preserving required financial audit records; resolve anonymization requirements explicitly.
- Separate marketing consent from transactional notices. Include unsubscribe links and the company postal address in marketing emails.
- Keep no-show evidence support-only; expose only an approved sanitized status projection for host progress.
- Protect offline guest caches; resolve offline revocation and identity-binding rules before enabling check-in.

## Stack rules

- Use **only** the decided technologies:

| Responsibility | Approved technology |
|---|---|
| Web frontend | TanStack Start |
| Mobile | Expo / React Native |
| Backend | Supabase: Postgres, Auth infrastructure, Storage, Edge Functions |
| Database | Supabase Postgres |
| Authentication authority | Auth0 (Okta) |
| Payments | Paystack |
| Email | Resend |
| Realtime | Supabase Realtime |
| Background jobs | Trigger.dev |
| File storage | Supabase Storage |
| Search | Algolia |
| AI integration | Vercel AI SDK |
| Hosting | Lovable hosting |
| Observability | Sentry |

- Obtain an **explicit owner decision before adding any other framework, library, or service**, including development/test dependencies and SDKs.
- Do not introduce a standalone React/Vite SPA or Stripe because historical excerpts mention them. Use TanStack Start and Paystack.
- Do not create a competing Supabase sign-in flow alongside Auth0.
- Verify TanStack Start deployment support on Lovable hosting; escalate incompatibilities rather than silently changing either choice.
- Treat unselected backup processors, banks, NIBSS/open-banking access, CAC/NIMC/BVN providers, WhatsApp/SMS providers, biometric services, AI models, scanning tools, and QR/NFC dependencies as owner-decision blockers.
- Do not interpret feature dependencies as authorization to procure or install them.
- Build approved interfaces and test doubles where useful; keep unavailable integrations disabled and clearly marked.
- Never activate regulated fund holding/routing without approved licensing and partner arrangements.

## Testing & definition of done checklist

- [ ] Link the change and every commit to a real feature ID.
- [ ] Satisfy approved acceptance criteria without silently omitting required dependencies.
- [ ] Pass repository formatting, lint, type checks, tests, and production builds.
- [ ] Test domain transitions, denied transitions, input validation, and migration constraints.
- [ ] Test cross-house and cross-role reads/writes across APIs, RLS, files, search, and Realtime.
- [ ] Verify field masking, live revocation, consent, deletion jobs, and audit logging.
- [ ] Test duplicate/reordered webhooks, simultaneous payments, post-provider-success crashes, retries, and reconciliation.
- [ ] Test timer boundaries, outage pauses, scheduler catch-up, dispute freezes, and dual approval.
- [ ] Test atomic invite claim limits, couple links, reissue invalidation, and approved offline behavior.
- [ ] Cover empty/loading/error states, accessibility, house-switch confirmation, and responsive behavior.
- [ ] Run applicable shared contract tests across web, iOS, and Android.
- [ ] Measure slow-connection journeys, bundles, query plans, and acceptance-load performance against approved budgets.
- [ ] Verify failure alerts, redacted Sentry reporting, delivery logs, and operational ownership.
- [ ] Keep development, staging, and production credentials, payment modes, indexes, and storage separate; use synthetic nonproduction data.
- [ ] Deploy backward-compatible migrations before clients; verify rollback and restoration before release.
- [ ] Update documentation, decision records, and memory-bank entries.
- [ ] Report blocked checks honestly; keep unresolved regulated or security-sensitive workflows feature-gated.

## What NOT to do

- Do not bypass RLS with service-role access merely to make a feature work.
- Do not trust client-supplied roles, house IDs, prices, payment status, or deadlines.
- Do not store secrets or sensitive records in logs, analytics, prompts, fixtures, or source control.
- Do not replace financial state machines with UI flags or browser timers.
- Do not let admins override Trust Score deductions.
- Do not let door staff release/reissue invitations or let AI approve fund movements.
- Do not disguise mocks as working integrations.
- Do not introduce hardcoded colors, duplicate components, or unapproved dependencies.
- Do not delete audit records, deploy destructive migrations casually, or use production data in development.
- Do not resolve legal, security, commercial, or contradictory product requirements by assumption.

## How to handle ambiguity

- Ask the owner a focused question with the feature reference, conflicting evidence, options, recommendation, and consequences.
- Log unanswered questions in the repository’s existing register or `docs/open-questions.md`; include owner, status, affected tasks, and release impact.
- Record approved decisions in `docs/decisions/` and update affected specifications and tests.
- Prioritize decisions on booking locks/capacity, fund-holding authority, approval thresholds, identity permissions, retention, and missing integration providers.
- Escalate conflicts between privacy restrictions and broader visibility features; retain the stricter boundary until approved otherwise.
- Continue only independent, reversible work while blocked. Never convert an assumption into shipped behavior silently.

<!-- sage7:start -->
## Now / Next / Open decisions
- Now: F-80 CI — **stopped by owner decision** (answer `40cf8a8e`, 2026-11-06: "We should stop the CI, since its not working, there is no need to be triggering it"). Do not widen the triggers to `develop`. The disable API call was blocked by the host permission classifier, so `verify.yml` is still `active` in GitHub; nothing triggers it in practice because all work lands on `develop`. See `docs/decisions/f80-stop-ci-triggering.md`. No CI gate has ever executed.
- Next: **F-100 In-app chat (host-vendor conversations)** — the proposal was approved and the code assigned 2026-11-06T23:20:01Z (`must`, stage `structure`, feature id `8619d25c-e294-45f9-a84a-a6332af4d650`). It is **not served** by `get_next_task`: `acceptance_criteria` is empty and `acceptance_state` is `unconfirmed`, `planner_confirmed_at` and `build_stage_confirmed_at` are null, `is_walking_skeleton` is false, and `dependencies`/`open_questions`/`blocked_by_decision_id` are all empty — so the gate is planner confirmation, not a dependency. The served context is version 7, compiled 2026-11-06T12:33:40Z and flagged `stale`, i.e. ~11 hours before F-100 existed. The owner must recompile in Context Compiler and confirm F-100 before it can be pulled.
- Blocked: F-38 Vendor Calendar Soft-hold — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-60 Payment Data Protection (Tokenization via Partner) — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-57 Admin Decision Audit & Second-person Review — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-22 Trust Score System — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-51 WhatsApp/SMS Critical Alert Integration — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-13 Direct Search & Book Flow — owner answered `9b9bc628` 2026-11-05: in-app chat gets its own feature code and is built first; its Payment Router dependency (F-48) is still gated behind Q10, and acceptance criteria remain empty.
- Blocked: F-19 Unanswered Enquiry Fallback — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-1 Dual Workspace Switcher (Host/Vendor Houses) — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-64 Subscription Cancellation & Billing Transparency — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-37 In-house Event Manager Fallback — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-25 Live Payment Status Tracker & AI Escalation — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-11 Payment Caution Acknowledgment — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-72 Automated Timed Jobs — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-21 Vendor Cancellation Handling — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-14 Quote Lifecycle & Date Lock — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-15 Split Payment & Completion Confirmation — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-56 System Monitoring Dashboard — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-42 Losing-bid Refund & Reversal Flow — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-43 Vendor Team Role Delegation — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-12 AI-Assisted Event Planning (OwanbePlanner) — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-17 Vendor No-show Recovery — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-66 Biometric Data Consent (Face Scan) — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-23 Quote Counter-Offer Controls — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-26 Post-booking Ratings & Reviews — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-32 Team, Roles & Billing Settings — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-39 Record Retention Policy — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-63 Marketing Email Unsubscribe + Postal Address — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-58 GDPR/UK-GDPR Data Rights for Diaspora Users — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-35 Emergency Replacement Vendor Recommendation — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-27 AI 'Best Bargain' Ranking — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-47 Second-approver for Large Fund Actions — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-70 Link Claim & Couple Sharing Rules — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-5 Unified Vendor House (Single Vendor Type) — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-68 Referral Program — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-4 Unicode-normalized Search Alias — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-18 Outsourcing / Book-on-behalf Flow — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-65 Zero Data Retention (ZDR) for AI Models — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-33 No-show Ticket & Evidence Flow — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-48 Payment Router & Banking Integrations — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-31 Notification Channel Preferences — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-54 Disputes & Refunds Console — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-44 Immediate Access Revocation on Removal — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-9 Media Section & Event of the Week — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-41 Invitation Tiers — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-67 ID Document Retention & Deletion Policy — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-71 Host-controlled Link Reissue — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-74 Manual Job Rerun with Second Approval — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-28 Payout Change Verification — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-50 NIN/BVN Identity Verification Integration — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-69 VIP Access Card (QR/NFC Check-in) — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-46 AI Investigation-only Role — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-62 Upload Moderation & Takedown Process — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-10 Vendor Vetting at Sign-up — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-29 Trusted Partner Recovery Flow — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-59 Health Data Protection (Dietary/Allergy Info) — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-24 Multi-channel Notification Delivery — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-7 AI Intent Capture — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-53 Vendor Verification Review Queue — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-30 Post-recovery Payout Lock — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-8 Personalised Dashboard — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-3 Cross-house Alert Badges — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-40 Guest List Privacy Controls — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-61 AI Chatbot Disclosure — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-36 Host-visible Ticket Progress — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-20 Host Cancellation Policy — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-6 Vendor Team Structure — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-16 Dispute Filing & Arbitration — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-34 Support Escalation Chain — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-73 Real-time Job Monitoring & Alerting — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-49 Backup Payment Processor — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-52 Manual CAC/NIMC/BVN Verification Integration — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-2 Become a Vendor Empty State — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-82 UI Component Library — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-83 Brand Design System — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-84 Homepage Marketing Sections — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-85 Test Suites — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Blocked: F-86 Error Reporting — planner confirmation missing; acceptance criteria unconfirmed; walking skeleton not verified
- Open: None recorded.
## Change summary
- Context version 4 compiled at 2026-11-04T02:06:19.544+00:00.
- Changed sources: feature map, planHash, decisions, audit evidence, confirmed targets, build evidence, agent_reports.
- Audit evidence: Valid audit included.
<!-- sage7:end -->
