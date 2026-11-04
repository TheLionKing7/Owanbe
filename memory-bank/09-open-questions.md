# 09 · Open questions, gaps and gotchas

## Open (owner / Sage 7)
| Topic | Detail | Blocks |
|---|---|---|
| Ratify the rebuild stack | TanStack Start + React 19 + Vite 8 + Tailwind 4 + shadcn/Radix + nitro replaced the approved SPA stack, and no ADR records it. `AGENTS.md` still says "React + Vite SPA" and lists Stripe. Owner to ratify, or scope the UI kit back. | every new feature's stack baseline; `report_decision` to Sage 7 |
| Restricted-state capabilities | What a newly admitted, not-yet-verified user may do is still undefined; `users.status` has no `restricted` value, so "admit but restrict" (owner, 2026-11-01 10:58 UTC) cannot be honoured | any verification/onboarding feature, and F-78's usefulness |
| Who applies F-78 | The pending migration sits in `supabase/pending/`; Lovable diagnostics report no linked backend. Owner must connect the existing Supabase project (no second database) and confirm the generated config before it is applied. | F-78 acceptance, live RLS tests |
| F-78/F-79 audit | Both were reported per `roadmap.md`, but the Sage 7 MCP was unreachable from this machine, so their audit status is unknown here **(unverified)** | starting the next feature |
| Quote date lock vs soft hold | Proposal: a sent quote creates an advisory date lock; an accepted quote creates competing 24-hour payment holds. Needs approval. | booking rollout |
| "Large" fund threshold | Monetary threshold for second-approver actions is undefined | refunds, job reruns |
| Diamond invitation tier logistics | Scheduling and proof of delivery | invitations |
| Full table list | Owner chose tables per feature (F-77 decision); the planned list is in `04` | — |

## Known gaps / follow-ups
- **Dead authorization code (highest value to fix).** `validateToken` / `validateRequestToken`, `requireSupabaseAuth`, `supabaseAdmin`, `authenticateCronRequest`, `checkEnvIsolation`, `missingServerEnv`, all of `src/lib/permissions.ts`, and the SQL `house_can` / `authorize_sensitive_read` family have **no call sites**. Today only `ensure_user()` and `my_houses()` run through the RLS path. Until a route calls them, staff scoping and env isolation are code, not behaviour.
- **Two Supabase token paths**: the browser client uses the Auth0 token (`accessToken: () => auth0.getTokenSilently()`), while `src/integrations/supabase/auth-attacher.ts` attaches the Supabase session token to server functions. Decide one before more server data access is added.
- **UI test coverage lost.** The rebuild deleted `src/test/auth.test.tsx` and `src/test/fakeAuth.tsx`: nothing tests the session gate, `?next=` redirect, blocked account or the house empty state, and no test renders an authenticated house page.
- **`.env` is committed** (`.env` + `.env.example` are both tracked; `.gitignore` has no `.env` rule; last touched by `fb4ae06`). Owner must confirm whether it holds real values, rotate anything live, and add the ignore rule + `git rm --cached` in a reviewed change. This agent did not read its contents.
- **Mirror will be rejected on first run.** `Owanbe/main` carries 7 `docs: sync Sage 7 blueprint` commits absent from `owanbe-project-studio/main`; `mirror-to-owanbe.yml` deliberately stops rather than force-pushing. Reconcile by bringing those blueprint commits into the source repo.
- **Orphaned audited commits.** `a1a4987` / `50ee4bb` / `4992cba` / `dbfcd11` (and branches `feat/F-76-authentication`, `feat/F-77-data-model`, `chore/memory-bank`) are not ancestors of the rebuilt `main`; the SQL files are byte-identical, the UI files are not. See `07`.
- Commit messages on rebuilt `main` carry no `feat(F-<n>):` IDs, so Sage 7 traceability now depends on `docs/journal/`.
- **Gates on this machine (measured 2026-11-04 02:57 UTC):** `npx vitest run` gives **17 tests passed, 4 of 6 files collected**; `src/test/app-routing.test.tsx` and `validate-token.test.ts` fail to resolve their imports because the local `node_modules` is stale (`node_modules/jose` absent, TanStack packages missing) and `npm install` dies on `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. This is an environment gap, not a proven repo defect — CI installs from `bun.lock` — but nothing has been verified green here. `bash supabase/tests/run-local.sh` still cannot run (no Postgres 16 `initdb`; Docker would not start headless, WSL is v1) **(unverified)**. **Never disable TLS verification.** Fix: run `bun install` (or a working `npm ci`) on a machine with network trust configured.
- `scripts/check-bundle.mjs` is unwired and the last measured figure (78 kB gz) belongs to the deleted SPA; re-measure the TanStack build before quoting a budget.
- Supabase third-party auth role: an Auth0 Post-Login Action must set `role=authenticated` (see `docs/auth0-setup.md`) or requests run as `anon` and are denied.
- F-76 SQL tests miss: absent `exp`, absent `aud`, `status = 'deactivated'`, subject shorter than 3 characters, and JWKS signature verification (needs a live tenant).
- `assignments.target_id` has no FK yet — add it when the events/cases tables exist. Revoking live sessions and Realtime subscriptions on membership removal is still unowned.
- Paystack webhook has no idempotency/replay guard, no charge/transfer handling, and `PAYSTACK_PUBLIC_KEY` has no consumer.
- Sentry ingestion unverified: the DSN is not present in the preview runtime (`docs/decisions/f79-monitoring-configuration.md` — "do not describe monitoring as active yet").
- Homepage art (`public/images/*.webp`) began as 1536px mockup crops; confirm the current files are high-resolution.
- Housekeeping: `src/components/house/` is an empty directory; `drizzle/` (stub schema + empty journal) and the drizzle/postgres devDependencies are template leftovers; `README.md` still instructs `npm i` while CI uses bun; `src/routes/README.md` forbids `src/pages/`, which the app uses.
- Open PR #5 (`sage7/readme-proposal`) replaces `README.md` wholesale and is unmerged.

## Gotchas
- **`main` was recreated** from the Lovable template root `4c3b15c`; the old history is orphaned. Do not try to merge the pre-rebuild branches — no merge base. Port files instead (that's how this memory bank landed).
- Lovable owns `blueprint/`, the `AGENTS.md` Sage 7 block, the `README.md` `<!-- sage7 -->` block and `src/routes/README.md`; Sage 7 syncs rewrite them, so keep repo notes outside those markers.
- `supabase/pending/*` only runs after `supabase/migrations/*` inside `run-local.sh`; a pending file is not applied anywhere until the project is connected.
- `src/routeTree.gen.ts` and `src/components/ui/*` are generated — never hand-edit; they are also excluded from the memory map.
- `publish-to-github.ps1` (repo root, untracked) pushes `main` **and deletes every other remote branch**, merging `origin/main` with `-X ours`. Never run it while feature branches still need to survive.
- `supabase/tests/run-local.sh` refuses to run as root (`initdb`).
- Keep `core.autocrlf=false` on the Windows checkout; the memory-bank fingerprints normalise CRLF anyway.
- `/auth/callback` must be in Auth0's Allowed Callback URLs for every app origin.
- `src/lib/router.tsx`'s `Link` renders a plain `<a>` and calls `router.navigate()`, so TanStack preloading does not apply through it.
