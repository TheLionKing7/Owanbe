# Ówàńbè memory bank: start here

This folder is the **indexed memory of the codebase**. Read it before you touch any code. It tells you what exists, why, where, and which rules apply, so you don't have to open every file.
It is kept in sync with the code by a protocol (`00-protocol.md`) and a check (`bun run memory:check` / `node scripts/memory-bank.mjs check`) that fails when code changes without a memory update. ⚠️ The check is **not yet part of CI** (`verify.yml` runs tests, build and the SQL suites) — run it locally as part of the definition of done.

## Read order
| When | Read |
|---|---|
| Always, first (≈5 min) | this file → `00-protocol.md` → `07-feature-status.md` |
| Before planning any feature | `01-project-brief.md`, `02-architecture.md`, `06-conventions.md` |
| Touching the database | `04-data-model.md` |
| Touching UI | `05-design-system.md` |
| Looking for a file | `03-codebase-map.md`, or `bun run memory:where -- <path>` |
| Before deciding something the spec doesn't cover | `08-decisions.md`, `09-open-questions.md` |

## Index
| # | File | Holds | Update when |
|---|---|---|---|
| 00 | `00-protocol.md` | How to read and update this bank; the rules for agents | The protocol itself changes |
| 01 | `01-project-brief.md` | Product, users, the two houses, scope source of truth | Product scope or roles change |
| 02 | `02-architecture.md` | Stack, runtime and auth flow, routing, env, performance, git hosting | New service, route, flow, workflow or env var |
| 03 | `03-codebase-map.md` | Every indexed file with a one-line purpose (auto-maintained table) | Any file is added, removed or repurposed |
| 04 | `04-data-model.md` | Tables, constraints, RLS, SQL functions, DB conventions | Any migration (including `supabase/pending/`) |
| 05 | `05-design-system.md` | Visual authority, tokens, fonts, components, layout rules | Any UI or token change |
| 06 | `06-conventions.md` | Code, tests, commits, branches, security, performance rules | A rule is added or changed |
| 07 | `07-feature-status.md` | Sage 7 features: status, branch, commit, audit, next task | Every feature start, report or audit |
| 08 | `08-decisions.md` | ADRs and owner decisions (Sage 7) with status | Any decision made or answered |
| 09 | `09-open-questions.md` | Open questions, known gaps, gotchas, follow-ups | Something is found, asked or resolved |
| 10 | `10-changelog.md` | Append-only log of memory-bank updates | Every update (one line per change) |
| — | `index.json` | Machine index: doc list, path → doc coverage rules, file fingerprints | Docs/coverage by hand; fingerprints only via `bun run memory:update` |

## Commands
```bash
bun run memory:check                     # gate: map complete, descriptions present, fingerprints current
bun run memory:update                    # after updating docs: refresh map rows + fingerprints
bun run memory:where -- src/router.tsx   # which memory doc(s) cover a file, plus its description
bun run test                             # Vitest (jsdom)
bash supabase/tests/run-local.sh         # SQL suites on a disposable Postgres 16
```

## Project facts in 10 lines
- **Ówàńbè** is AI-powered celebration commerce for Yoruba and Nigerian celebrations: hosts plan, vendors are discovered, booked and paid.
- **Scope source of truth:** Sage 7 project `cfbf39db-b40e-4f75-9039-f241e7b05bfd` (MCP `https://sage7.dev/mcp`). Specs are mirrored in `blueprint/`. The MCP was unreachable from this machine on 2026-11-03/04 and answered again on 2026-11-04 (`get_answers`: F-75…F-79 all audited built, the stack decision confirmed).
- **Stack today:** **TanStack Start** (React 19, Vite 8, SSR + nitro) with Tailwind 4 + shadcn/ui, Supabase (Postgres/RLS), Auth0, **Paystack** (replaced Stripe), Sentry; Resend, Trigger.dev, Algolia and the Vercel AI SDK not started. Bun is the package manager. **ADR 0003** (`docs/adr/0003-tanstack-start-runtime-and-paystack.md`) records the runtime and Paystack as owner-approved, and Sage 7 context v4 (`2929081`) now states the same in `AGENTS.md`'s stack table — so neither choice needs defending any more; shadcn/ui still needs its own decision (F-82/F-83).
- **Two repos:** Lovable syncs `owanbe-project-studio`; `.github/workflows/mirror-to-owanbe.yml` forwards `main` to `TheLionKing7/Owanbe` (the repo Sage 7 audits). Verify workflow = bun test + build + Postgres 16 SQL tests.
- **Two houses:** Host House (`/host/*`) and Vendor House (`/vendor/*`) never mix data or navigation.
- **Design authority:** the owner's mockup (`docs/design/homepage-mockup.png`) plus `owanbe-brand-kit/`, overriding the Sage 7 tokens (owner-confirmed). Tokens now live in `src/styles.css`.
- **Auth:** Auth0 tokens go straight to Supabase (third-party auth). `public.ensure_user()` is the session gate; the server-side `validateToken()` and F-78 role matrix exist but are **not called by anything yet**.
- **Status:** F-75/F-76/F-77 audited built (2026-11-01 07:35:28 UTC, re-audited 08:55:36); F-78/F-79 are coded and reported but **await audit** and depend on a connected Supabase. "Built" records audit evidence only — never "ready" or "secure".
- **Never:** client-side authorization, secrets in the browser bundle or in a committed `.env` (untracked and ignored now; the old copy still sits in `main`'s history), float money, direct client table writes, building ahead of `get_next_task`.
