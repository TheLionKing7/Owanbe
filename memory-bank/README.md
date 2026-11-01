# Ówàńbè memory bank: start here

This folder is the **indexed memory of the codebase**. Read it before you touch any code. It tells you what exists, why, where, and which rules apply, so you don't have to open every file.
It is kept in sync with the code by a protocol (`00-protocol.md`) and a check (`npm run memory:check`) that fails CI when the code changes without a memory update.

## Read order
| When | Read |
|---|---|
| Always, first (≈5 min) | this file → `00-protocol.md` → `07-feature-status.md` |
| Before planning any feature | `01-project-brief.md`, `02-architecture.md`, `06-conventions.md` |
| Touching the database | `04-data-model.md` |
| Touching UI | `05-design-system.md` |
| Looking for a file | `03-codebase-map.md`, or `npm run memory:where -- <path>` |
| Before deciding something the spec doesn't cover | `08-decisions.md`, `09-open-questions.md` |

## Index
| # | File | Holds | Update when |
|---|---|---|---|
| 00 | `00-protocol.md` | How to read and update this bank; the rules for agents | The protocol itself changes |
| 01 | `01-project-brief.md` | Product, users, the two houses, scope source of truth | Product scope or roles change |
| 02 | `02-architecture.md` | Stack, runtime and auth flow, routing, bundle strategy, env | New service, route, flow or env var |
| 03 | `03-codebase-map.md` | Every indexed file with a one-line purpose (auto-maintained table) | Any file is added, removed or repurposed |
| 04 | `04-data-model.md` | Tables, constraints, RLS, SQL functions, DB conventions | Any migration |
| 05 | `05-design-system.md` | Visual authority, tokens, fonts, components, layout rules | Any UI or token change |
| 06 | `06-conventions.md` | Code, tests, commits, branches, security, performance rules | A rule is added or changed |
| 07 | `07-feature-status.md` | Sage 7 features: status, branch, commit, audit, next task | Every feature start, report or audit |
| 08 | `08-decisions.md` | ADRs and owner decisions (Sage 7) with status | Any decision made or answered |
| 09 | `09-open-questions.md` | Open questions, known gaps, gotchas, follow-ups | Something is found, asked or resolved |
| 10 | `10-changelog.md` | Append-only log of memory-bank updates | Every update (one line per change) |
| — | `index.json` | Machine index: doc list, path → doc coverage rules, file fingerprints | Only via `npm run memory:update` |

## Commands
```bash
npm run memory:check              # CI gate: map complete, descriptions present, fingerprints current
npm run memory:update             # after updating docs: refresh map rows + fingerprints
npm run memory:where -- src/App.tsx   # which memory doc(s) cover a file, plus its description
```

## Project facts in 10 lines
- **Ówàńbè** is AI-powered celebration commerce for Yoruba and Nigerian celebrations: hosts plan, vendors are discovered, booked and paid.
- **Scope source of truth:** Sage 7 project `cfbf39db-b40e-4f75-9039-f241e7b05bfd` (MCP `https://sage7.dev/mcp`). Specs are mirrored in `blueprint/`.
- **Stack:** a React 18 + Vite 5 + TS SPA on Lovable hosting, Supabase (Postgres/RLS), Auth0, Stripe, Resend, Trigger.dev, Algolia, the Vercel AI SDK and Sentry.
- **Two houses:** Host House (`/host/*`) and Vendor House (`/vendor/*`) never mix data or navigation.
- **Design authority:** the owner's mockup (`docs/design/homepage-mockup.png`) plus `owanbe-brand-kit/`. This overrides the Sage 7 tokens (owner-confirmed).
- **Auth:** Auth0 tokens go straight to Supabase (third-party auth). `public.ensure_user()` is the server session gate.
- **Built:** F-75 Project setup, F-76 Authentication and F-77 Data model — all three marked built by the Sage 7 audit of 2026-11-01 07:35:28 UTC (re-audited 08:55:36 UTC). "Built" records audit evidence only; live services are not provisioned and neither `npm run ci` nor the SQL tests have been run here. See `07-feature-status.md`.
- **Quality gates:** `npm run ci` covers typecheck, tests, build, the bundle budget (100 kB gzipped initial JS) and the memory check. DB tests: `bash supabase/tests/run-local.sh`.
- **Git:** one feature per branch, `feat(F-<n>): …` commits, `main` on github.com/TheLionKing7/Owanbe.
- **Never:** client-side authorization, secrets in `PUBLIC_ENV`, float money, direct client table writes, building ahead of `get_next_task`.
