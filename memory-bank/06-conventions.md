# 06 · Conventions and rules

## Workflow (Sage 7)
1. Read the memory bank first, then call `get_answers` and `get_next_task` (only when the owner asks).
2. Read `get_feature_spec` and propose a plan; **the owner approves it before any code is written**.
3. Create one branch per feature, `feat/F-<n>-<slug>`. **Every commit** includes the ID: `feat(F-77): …`. Chores use `chore:` or `docs:`.
4. Definition of done: UI states, server function authorized, migrations, permissions enforced server-side, error states, tests, a journal entry in `docs/journal/YYYY-MM-DD-F-<n>-<slug>.md`, every Sage 7 wiring line present in code, no unused code, **memory bank updated**, and `npm run ci` plus the DB tests green.
5. Report with `report_progress` (feature code + commits), then **stop** and wait for the owner.
6. Spec gaps: `report_question` (blocking if needed). Choices the spec didn't cover: `report_decision`, plus an ADR in `docs/adr/`.

## Commands
| Command | Does |
|---|---|
| `npm run dev` | Vite on :8080 |
| `npm test` | Vitest (jsdom) |
| `npm run ci` | typecheck → test → build → bundle budget → memory check |
| `bash supabase/tests/run-local.sh` | SQL tests on a local Postgres 16 (needs `initdb`; run as a non-root user) |
| `npm run memory:check` / `memory:update` / `memory:where -- <path>` | memory bank |

## Code
- TypeScript strict; `noUnusedLocals` and `noUnusedParameters`. Use the alias `@/` for `src/`.
- Components are PascalCase files with named exports. Route components use a default export (for `React.lazy`).
- Data and copy live in `src/data/` and `src/lib/`, not in components.
- Never import `@auth0/auth0-spa-js` or `@supabase/supabase-js` statically outside `src/lib/auth/auth0Client.ts`; they must stay in the lazy chunk.
- The UI talks to auth and data only through the `AuthClient` interface (`src/lib/auth/types.ts`). This makes tests inject `fakeClient()` from `src/test/fakeAuth.tsx`.
- Pin dependency versions exactly, to a release at least two weeks old. New libraries need a recorded decision.

## Security (from `AGENTS.md` and `blueprint/`; target OWASP ASVS L3)
- Authorization is enforced in the DB and server only. UI guards are UX.
- Only names listed in `PUBLIC_ENV` reach the browser. Never add secrets there.
- Tokens stay in memory, never localStorage.
- Fail closed: missing config, invalid token or inactive account means no access.
- `security definer` functions always `set search_path = ''`, and revoke from `public` and `anon`.
- Never log or store raw card or bank data, health data in plain text, or secrets. Audit `details` holds identifiers only.
- Keep Host and Vendor separation in every query, route, cache and subscription.

## Tests
- UI: render through `renderApp(path, client)` from `src/test/fakeAuth.tsx` (memory router plus a fake auth client).
- SQL: one `*.test.sql` per feature, using `pg_temp.claims()` and `pg_temp.expect_error()`. Each test sets `role authenticated` and `request.jwt.claims` to simulate a user.
- Every new public table is automatically covered by `schema_conventions.test.sql`.
