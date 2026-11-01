# 08 · Decisions

| ID | Decision | Status | Source |
|---|---|---|---|
| ADR 0001 | UI libs: Tailwind, React Router, lucide-react, Vitest/Testing Library. **The owner's mockup and brand kit override the Sage 7 Aso-Oke Ledger tokens.** | ✅ owner-confirmed in Sage 7 | `docs/adr/0001-ui-foundation.md` |
| ADR 0002 | Auth0 → Supabase **third-party auth**; DB re-validates iss, aud and exp; `ensure_user()` is the session gate; SDKs lazy-loaded; tokens in memory | ✅ owner-confirmed | `docs/adr/0002-auth0-supabase-third-party.md` |
| F-77 scope | Foundation-only data model (5 wired tables plus conventions); domain tables arrive with their features | ✅ owner chose in session (2026-11-01) | `docs/journal/2026-11-01-F-77-data-model.md` |
| F-76 admission | **Admit but restrict**: an Auth0 subject with no application user is created, but starts in a limited state until verified. Replaces the earlier "reject unrecognised accounts" wording. | ✅ owner answered 2026-11-01 10:58 UTC | Sage 7 question `61aaf0a2` — **not implemented**: `users.status` only allows active/suspended/deactivated |
| Event manager scope | Assigned events only; no guest phone numbers, no health details, no financial authority; a paid/not-paid status is visible and **every view of it is logged as a sensitive read**; the status must not expose amounts | ✅ owner answered 2026-11-01 10:52 UTC | Sage 7 question `2a668438`; `blueprint/tech-spec.md` §7 |
| Release path | Merging to `main` deploys nothing (one Sage 7 push-sync webhook, no workflows, no Lovable connection) | ✅ owner-confirmed 2026-11-01 10:57 UTC | Sage 7 decision `1bdb1010`; `02-architecture.md` |
| Fonts | Playfair Display (display) and Figtree (UI): the closest match to the mockup's lettering | follows ADR 0001 | `tailwind.config.ts` |
| Env exposure | Only exact names in `PUBLIC_ENV` reach the client | engineering rule | `vite.config.ts` |

## Owner instructions on record
- 2026-10-31: "This is exactly how I want the interface to look… the exact design to be replicated" (homepage mockup).
- 2026-11-01 (F-76 confirmation): test that tokens with the wrong audience, expired tokens and unrecognised accounts are rejected, and that valid users can reach only their own data. Wrong audience (string and array), expired, wrong issuer and missing subject are covered by `supabase/tests/f76_auth.test.sql`; "unrecognised account" was **not** covered — `ensure_user()` creates the user — and the owner resolved it as *admit but restrict* (see the table above). Re-verify against live Auth0 and Supabase before rollout.
- 2026-11-01 10:50: run both quality gates (`npm run ci` and `bash supabase/tests/run-local.sh`) on another suitable machine before merging to `main`, and share the results. **Never disable TLS verification** to get `npm install` through; if the setup cannot be fixed, report what is needed and how long it takes.
- Keep one `main` branch on GitHub; Sage 7's auto branches were cleaned up (2026-11-01).
