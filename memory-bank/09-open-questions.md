# 09 · Open questions, gaps and gotchas

## Open (owner / Sage 7)
| Topic | Detail | Blocks |
|---|---|---|
| Quote date lock vs soft hold | Proposal: a sent quote creates an advisory date lock, and an accepted quote creates competing 24-hour payment holds. Needs approval. | booking rollout |
| "Large" fund threshold | Monetary threshold for second-approver actions is undefined | refunds, job reruns |
| Unknown Auth0 subject admission | **Answered 2026-11-01 10:58 UTC:** admit but restrict — a new user starts in a limited state until verified. Open sub-question: which feature owns the migration, and what exactly is blocked while restricted (quoting? payments? being discoverable?) | F-78 (needs the restricted state to exist before role scoping is meaningful) |
| Event manager visibility | **Answered 2026-11-01 10:52 UTC:** assigned events only; no guest phone numbers, no health details, no financial authority; paid/not-paid status visible with every view logged as a sensitive read | F-78 implementation |
| Restricted-state capabilities | What a newly admitted, not-yet-verified user may do before verification is undefined; `users.status` has no restricted value today | F-78 |
| Full table list | Owner chose to build tables per feature (F-77 decision); the planned list is in `04` | — |
| Diamond invitation tier logistics | Scheduling and proof of delivery | invitations |

## Known gaps / follow-ups
- Auth0 tenant and Supabase project aren't provisioned, so auth isn't verified end to end **(unverified)**.
- `supabase/tests/f76_auth.test.sql`, `f77_data_model.test.sql` and `schema_conventions.test.sql` have never run here: no Postgres 16 `initdb`/`psql`, Docker Desktop would not start headless, and WSL defaults to v1. Treat the schema as unexecuted until someone runs `bash supabase/tests/run-local.sh` **(unverified)**.
- F-76 SQL tests cover wrong audience, expired, wrong issuer, missing subject, suspended account and anon/direct-write denial. Not covered: an absent `exp`, an absent `aud`, `status = 'deactivated'`, a subject shorter than 3 characters, and JWKS signature verification (impossible at SQL level; needs a live tenant).
- The homepage photography is cut from the mockup at 1536px. Replace it with high-resolution originals.
- `assignments.target_id` has no FK yet. Add it when the events and cases tables exist.
- Revoking live sessions and realtime subscriptions on membership removal is F-78 work.
- Lovable hosting, Sentry and Stripe aren't wired (F-79 and later).

## Gotchas
- `publish-to-github.ps1` (repo root) pushes `main` **and deletes every other remote branch**, merging `origin/main` with `-X ours` so the local tree wins on conflicts. Never run it while feature branches still need to survive.
- `supabase/tests/run-local.sh` refuses to run as root (`initdb`). Use a normal user.
- On the Windows checkout keep `core.autocrlf=false`. The memory-bank fingerprints normalise CRLF anyway.
- `/auth/callback` must be listed in Auth0's Allowed Callback URLs for every `APP_ORIGIN`.
- The Supabase third-party auth role comes from the token's `role` claim, so an Auth0 Post-Login Action must set `role=authenticated` (see `docs/auth0-setup.md`). Without it, requests run as `anon` and are denied.
- React 18 doesn't know the `fetchPriority` prop. The hero uses the lowercase `fetchpriority` attribute.
- `blueprint/`, the `AGENTS.md` Sage 7 block and the `README.md` `<!-- sage7 -->` block are rewritten by Sage 7 syncs. Put repo notes outside those markers.
