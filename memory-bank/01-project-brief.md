# 01 · Project brief

**Ówàńbè: Your Celebration. Our Culture. Powered by AI.** A modern home for Yoruba celebrations. It connects hosts with vendors, creatives and cultural knowledge, and makes the celebration economy visible. Tagline in the UI: *Plan. Source. Celebrate.*

## Users and roles
| Role | Where | Notes |
|---|---|---|
| Host | Host House `/host/*` | Plans events (or books for someone else); owns decisions. Host houses have **no delegated operators**. |
| Vendor owner | Vendor House `/vendor/*` | Services, quotes, team, subscription, **payouts (owner only)** |
| Vendor staff | Vendor House | Only the capabilities delegated to them (`chat`, `quotes`, `calendar`, `profile`, `bookings`) |
| Guest / door operator | invitations (future) | Minimal access through claim links and scanner grants |
| Platform staff | back-office (future) | `support`, `finance`, `operations`, `arbitrator`, `event_manager`, `verification_reviewer`. Scoped by `staff_grants` and `assignments` |

One account can hold one Host house and at most one Vendor house. The Host house is created automatically on first sign-in.
The role matrix these rows imply is written in SQL (F-78, `supabase/pending/`) and mirrored for UI hints in `src/lib/permissions.ts` — **nothing calls either yet**, so today only "signed in and owns/reads their own rows" is actually enforced. See `04` and `09`.

## Scope source of truth
- **Sage 7** project "Ówàńbè", id `cfbf39db-b40e-4f75-9039-f241e7b05bfd`. Get work with `get_next_task`, then `get_feature_spec`, and report with `report_progress`, `report_decision` and `report_question`. Only an audit marks a feature built.
- `blueprint/` is synced by Sage 7. Don't edit it by hand. It contains `prd.md` (features and acceptance), `tech-spec.md` (data model, APIs, ADRs), `architecture.md`, `design-system.md` (generic tokens, overridden; see `05`), `system-overview.md` and `context.md`.
- Build order: Foundation → Structure → Rooms → Finishes. Build **only** the task `get_next_task` returns, then stop and wait for the owner.

## Product pillars (homepage feature strip)
AI Event Planner · Trusted Vendors · Smart Outsourcing · Secure Transactions · Cultural Intelligence · Unforgettable Moments.

## Business rules to remember (from `blueprint/prd.md`, not yet implemented)
- 70/30 payment release: 70% at booking, 30% after completion.
- 24-hour quote expiry and payment windows. Date locks and soft holds are pending owner approval; see `09`.
- Host cancellation within 24 hours of payment forfeits 20% of the full quote.
- AI may investigate but never moves money or approves anything. Large fund actions need a second approver.
