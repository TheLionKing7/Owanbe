# 06 · Conventions and rules

## Workflow (Sage 7)

`AGENTS.md` is regenerated whole by Sage 7 (context v4, `2929081`, 2026-11-04T02:06:19 UTC). Never hand-patch its stack table, golden rules or the `<!-- sage7:start --> … <!-- sage7:end -->` Now/Next block — record the decision in `docs/decisions/` + `report_decision` and let the next sync carry it. Its rules below are read as intent, not inventory: `design_system.md` actually lives at `blueprint/design-system.md`, and the suggested `src/features/`, `src/server/`, `mobile/`, `shared/`, `trigger/` folders do not exist yet (see `03`).

1. Read `memory-bank/README.md` → `00-protocol.md` → `07-feature-status.md`, then call `get_answers` and `get_next_task` (only when the owner asks). `get_answers` worked on 2026-11-04 (the MCP was unreachable 2026-11-03 and most of 2026-11-04). **When the MCP is offline**, work from `roadmap.md`, `docs/journal/` and this bank, and write open questions/decisions into `docs/journal/` + `docs/decisions/` — v4 now states this fallback itself, so it survives the sync.
2. Read `get_feature_spec`, propose a plan; **the owner approves it before any code is written**.
3. **Branches (owner decision, 2026-11-06):** `main` is production-ready only, and all new work happens on the single long-lived `develop` branch. Don't create per-feature branches. Release by merging `develop` into `main` once the checks pass. This replaces the Sage 7 default of one branch per feature; each feature is traced by its ID in commit messages and its `docs/journal/` entry. **Every commit message carries the ID**: `feat(F-78): …`; chores use `docs:` / `chore:`. ⚠️ The commits that landed F-78/F-79 through Lovable are titled "Changes", "Switched to Paystack", etc. — no feature ID, so Sage 7 can only trace them through `docs/journal/`. Keep journal entries complete, and put the ID on anything you commit.
4. Definition of done: all UI states, authorization enforced in the DB/server, migration added, tests, a journal entry `docs/journal/YYYY-MM-DD-F-<n>-<slug>.md`, every Sage 7 wiring line present, **no unused code** except what the owner explicitly staged for a later stage (the F-78 Foundation modules have no call sites by design — see `09`), memory bank updated, and the gates green.
5. Report with `report_progress` (feature code + commits), then **stop** and wait for the owner.
6. Spec gaps: `report_question` (blocking if needed). Choices the spec didn't cover: `report_decision`, plus an ADR in `docs/adr/`.
7. Stack pressure: v4 forbids reintroducing a React/Vite SPA or Stripe "because historical excerpts mention them" and asks that **TanStack Start deployment support on Lovable hosting be verified and incompatibilities escalated**, not silently swapped. Same rule for `blueprint/` — if a sync restores a provider name the code doesn't use, re-apply from ADR 0003 and report it.

## Commands
| Command | Does |
|---|---|
| `bun install` (CI pins bun 1.4.4) | install from `bun.lock`; `bunfig.toml` enforces a 1-day minimum release age, with Lovable/MCP packages excluded |
| `bun run dev` / `bun run preview` | TanStack Start dev server / preview |
| `bun run test` | Vitest (jsdom) — `src/test/*` |
| `bun run build` | production build (nitro/Cloudflare target) |
| `bun run lint` / `bun run format` | ESLint flat config / Prettier |
| `node scripts/check-bundle.mjs` | 100 kB gz initial-JS budget — **not wired to `package.json` or CI** |
| `bash supabase/tests/run-local.sh` | SQL suites on a disposable Postgres 16 (`initdb`, non-root user), then applies `supabase/pending/` after `supabase/migrations/` |
| `bun run memory:check` / `memory:update` / `memory:where -- <path>` | memory bank gate (also `node scripts/memory-bank.mjs …`) |

CI is `.github/workflows/verify.yml`: bun install → `bun run test` → `bun run build`, and a Postgres 16 job for the SQL suites. It does **not** run lint, typecheck, the bundle budget or `memory:check` — those are local duties until the owner widens the workflow. `package.json` declares no `engines` or `packageManager` field, so nothing enforces bun on a local machine — npm installs a second lockfile that CI never sees; always use bun here.

## Code
- TypeScript strict via the Lovable preset; alias `@/` → `src/`.
- Route files are the only place TanStack route objects are created (`src/routes/`), each importing a page body from `src/pages/`; `src/routeTree.gen.ts` and `src/components/ui/*` are generated — never hand-edit them.
- Ported components keep using the React-Router-shaped adapter in `src/lib/router.tsx` (`Link`, `useNavigate`, `useParams`, `useSearchParams`, `Navigate`, `Outlet`); new code should still import from there rather than mixing two router APIs.
- Server-only code must live in `*.server.ts` (or `config/server-env.ts`, `lib/monitoring/config.functions.ts`) so nothing privileged reaches the client.
- Never import `@auth0/auth0-spa-js` or `@supabase/supabase-js` statically outside `src/lib/auth/auth0Client.ts`; they belong in the lazy chunk.
- The UI talks to auth/data only through the `AuthClient` interface (`src/lib/auth/types.ts`).
- Data and copy live in `src/data/` and `src/lib/`, not in components.
- New libraries need a recorded owner decision (`AGENTS.md` stack table; the runtime and Paystack are recorded in `docs/adr/0003-tanstack-start-runtime-and-paystack.md`). Versions are pinned through `bun.lock` + the minimum-release-age rule.
- v4's code rules that the repo already follows: UUIDs, UTC timestamps, explicit currency + integer minor units, version columns; tenancy derived through foreign keys with composite constraints so a host id can never be attached to a vendor row; permissions and state transitions centralized rather than duplicated; privileged clients confined to server-only modules.

## Security (target OWASP ASVS L3)
- Authorization is enforced in the DB and server only; UI guards (`RequireAuth`, `src/lib/permissions.ts`) are UX hints, never the decision point.
- Everything in `import.meta.env` / `VITE_*` is public. Secrets belong to the server list in `src/config/server-env.ts`. **Never commit real credentials** — `.env` is git-ignored and untracked (`.env.example` is the only tracked template); the pre-ignore copies are still in `main`'s history.
- Auth0 tokens stay in memory (`cacheLocation: "memory"`); the Supabase JS session uses `previewAuthStorage` (localStorage outside the Lovable editor) — that is the Supabase session, not the Auth0 token.
- Fail closed: missing config, unverifiable token, unknown capability, revoked/expired grant or inactive account ⇒ no access.
- `security definer` functions always `set search_path = ''`, `revoke … from public, anon`, and grant execute to `authenticated` only.
- Sensitive reads by support/event managers go through `authorize_sensitive_read()` / `support_house_members()` with a ≥10-character purpose, which writes `audit_events.action = 'sensitive.read'`. Audit `details` holds identifiers only.
- Money: `bigint *_minor` + currency; no float/numeric. Paystack webhook verifies HMAC-SHA512 over the raw body and must stay idempotent once it handles events (no replay guard yet).
- Sentry events are sanitized by `src/lib/monitoring/privacy.ts` (allowlist only, redacted message, no user/request/breadcrumbs/contexts/extra/tags). Keep it that way for anything new.
- Host/Vendor house separation in every query, route, cache and subscription.

## Tests
- SQL: one `*.test.sql` per feature using `pg_temp.claims()` and `pg_temp.expect_error()`, each block setting `role authenticated` + `request.jwt.claims`. Existing: `f76_auth`, `f77_data_model`, `f78_permissions`, `schema_conventions` (auto-covers every new `public` table).
- Vitest: `app-routing` (a real page matches `/`), `env`, `deployment` (env isolation + Paystack signature), `monitoring` (sanitizer), `permissions` (role matrix), `validate-token` (RS256 fixture: valid/other-key/wrong iss/wrong aud/expired/suspended/unknown/missing).
- **Gap:** the rebuild deleted `src/test/auth.test.tsx` and `src/test/fakeAuth.tsx`, so there is no test of the session gate, sign-in redirect, blocked account, or the house empty state. Re-create them through the `AuthClient` interface before touching auth UI.
