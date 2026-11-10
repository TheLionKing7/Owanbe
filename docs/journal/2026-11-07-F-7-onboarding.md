# F-7 AI Intent Capture: sign-up onboarding (owner request, 2026-11-07)

- **Feature:** F-7 AI Intent Capture (`dbed79b9-7c92-409a-8f41-83b67a8e34cf`, must, Onboarding / Host First-run). Built at the owner's request, outside `get_next_task` order; F-7 has no confirmed build stage yet.
- **Owner decisions (2026-11-07):**
  - Roles at sign-up: **Host and Vendor**. Planner waits for F-98 (Planner workspace).
  - Required before a house opens: **name, phone, city** (answers F-7's open question "Which profile fields are mandatory before intent capture?"). Host: plus intent. Vendor: plus business name and category.
  - Host intent: **simple choice** (I'm hosting / I'm arranging it for someone), event type and date optional; OwanbePlanner picks it up from the Host overview. Not an AI conversation as the first step, so sign-up works even when the AI is down.
  - Phone is stored **unverified** until WhatsApp/SMS delivery (F-51) exists.
- **Flow:** `/sign-up` (pick Host or Vendor) → Auth0 creates the account (credentials stay in Auth0) → `/welcome` (progress bar, resumes where you left off) → Host overview with "Plan it with OwanbePlanner", or Vendor house → Profile & Showcase. Both houses sit behind `OnboardingGate`; staff of another vendor's house and a not-yet-applied migration pass through.
- **Database:** `supabase/migrations/20261107090000_f7_onboarding.sql` — `onboarding_profiles` (no client access) and `my_onboarding`, `save_onboarding`, `complete_onboarding`. The vendor path also needs `open_vendor_house` from `supabase/pending/20261105080000_vendor_profiles.sql`.
- **Checks run:** Vitest 146 passed; `tsc` clean; `vite build` passes; SQL `f7_onboarding.test.sql` passes with F-76/F-77/F-78 on Postgres 16. Pre-existing, unrelated: `f14_quotes.test.sql` fails at line 333 (`quotes_state_shape`) and `schema_conventions` flags `vendor_profiles` (pending) for its primary key; `bun install --frozen-lockfile` fails because `bun.lock` disagrees with `package.json` on `@ai-sdk/openai`.
- **Not done / limits:** the AI Planner page (F-12) is still a scaffold, so the hand-off shows the host's request but no AI reply yet; vendor verification documents (F-10/F-52) are not part of this flow; phone verification waits for F-51.
