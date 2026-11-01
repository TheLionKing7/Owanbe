# 09 · Open questions, gaps and gotchas

## Open (owner / Sage 7)
| Topic | Detail | Blocks |
|---|---|---|
| Quote date lock vs soft hold | Proposal: a sent quote creates an advisory date lock, and an accepted quote creates competing 24-hour payment holds. Needs approval. | booking rollout |
| "Large" fund threshold | Monetary threshold for second-approver actions is undefined | refunds, job reruns |
| Event manager visibility | What can managers see beyond assigned events? | F-78, event manager features |
| Full table list | Owner chose to build tables per feature (F-77 decision); the planned list is in `04` | — |
| Diamond invitation tier logistics | Scheduling and proof of delivery | invitations |

## Known gaps / follow-ups
- Auth0 tenant and Supabase project aren't provisioned, so auth isn't verified end to end **(unverified)**.
- The homepage photography is cut from the mockup at 1536px. Replace it with high-resolution originals.
- `assignments.target_id` has no FK yet. Add it when the events and cases tables exist.
- Revoking live sessions and realtime subscriptions on membership removal is F-78 work.
- Lovable hosting, Sentry and Stripe aren't wired (F-79 and later).

## Gotchas
- `supabase/tests/run-local.sh` refuses to run as root (`initdb`). Use a normal user.
- On the Windows checkout keep `core.autocrlf=false`. The memory-bank fingerprints normalise CRLF anyway.
- `/auth/callback` must be listed in Auth0's Allowed Callback URLs for every `APP_ORIGIN`.
- The Supabase third-party auth role comes from the token's `role` claim, so an Auth0 Post-Login Action must set `role=authenticated` (see `docs/auth0-setup.md`). Without it, requests run as `anon` and are denied.
- React 18 doesn't know the `fetchPriority` prop. The hero uses the lowercase `fetchpriority` attribute.
- `blueprint/`, the `AGENTS.md` Sage 7 block and the `README.md` `<!-- sage7 -->` block are rewritten by Sage 7 syncs. Put repo notes outside those markers.
