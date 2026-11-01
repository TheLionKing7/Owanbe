# 08 · Decisions

| ID | Decision | Status | Source |
|---|---|---|---|
| ADR 0001 | UI libs: Tailwind, React Router, lucide-react, Vitest/Testing Library. **The owner's mockup and brand kit override the Sage 7 Aso-Oke Ledger tokens.** | ✅ owner-confirmed in Sage 7 | `docs/adr/0001-ui-foundation.md` |
| ADR 0002 | Auth0 → Supabase **third-party auth**; DB re-validates iss, aud and exp; `ensure_user()` is the session gate; SDKs lazy-loaded; tokens in memory | ✅ owner-confirmed | `docs/adr/0002-auth0-supabase-third-party.md` |
| F-77 scope | Foundation-only data model (5 wired tables plus conventions); domain tables arrive with their features | ✅ owner chose in session (2026-11-01) | `docs/journal/2026-11-01-F-77-data-model.md` |
| Fonts | Playfair Display (display) and Figtree (UI): the closest match to the mockup's lettering | follows ADR 0001 | `tailwind.config.ts` |
| Env exposure | Only exact names in `PUBLIC_ENV` reach the client | engineering rule | `vite.config.ts` |

## Owner instructions on record
- 2026-10-31: "This is exactly how I want the interface to look… the exact design to be replicated" (homepage mockup).
- 2026-11-01 (F-76 confirmation): test that tokens with the wrong audience, expired tokens and unrecognised accounts are rejected, and that valid users can reach only their own data. Covered by `supabase/tests/f76_auth.test.sql` and `f77_data_model.test.sql`. Re-verify against live Auth0 and Supabase before rollout.
- Keep one `main` branch on GitHub; Sage 7's auto branches were cleaned up (2026-11-01).
