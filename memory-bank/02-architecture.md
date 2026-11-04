# 02 · Architecture

## Stack (what is installed today)
| Concern | Tech | In repo |
|---|---|---|
| Web | **TanStack Start** 1.168.60 + React 19.2 + Vite 8.1 + TypeScript 5.8; SSR through a nitro (Cloudflare target) build | ✅ `@lovable.dev/vite-tanstack-config` owns the plugin list |
| Routing | `@tanstack/react-router` 1.170.41 file routes in `src/routes`, generated `src/routeTree.gen.ts`; `src/lib/router.tsx` re-exports a React-Router-shaped API so ported components kept working | ✅ |
| Styling / UI kit | Tailwind CSS 4 — tokens live in `@theme` inside `src/styles.css`, **no `tailwind.config.ts`** — plus shadcn/ui (`src/components/ui`, 45 generated files, `components.json` style `new-york`, 25 Radix packages) and lucide-react | ✅ — **no owner ADR yet**; `AGENTS.md` requires a recorded decision before adding a UI kit (see `09`) |
| Data fetching | `@tanstack/react-query` 5 | installed; only the `QueryClient` router context is wired |
| Database / API | Supabase Postgres + RLS + RPC functions (`supabase/migrations`, `supabase/pending`) | ✅ code; F-78 migration not applied — no connected project **(unverified)** |
| Auth | Auth0 SPA (`@auth0/auth0-spa-js` 2.28.3) → Supabase third-party auth (`@supabase/supabase-js` ^2.118) | ✅ code; live tenant not exercised **(unverified)** |
| Payments | **Paystack** (HMAC-SHA512 webhook) — replaced Stripe at the owner's request in F-79 | ✅ webhook shell only; no charge/transfer/ledger handling |
| Email / Jobs / Search / AI | Resend, Trigger.dev, Algolia, Vercel AI SDK | not started |
| Observability | `@sentry/react` 10, browser-only, sanitized by `src/lib/monitoring/privacy.ts` | ✅ code; no DSN in preview, ingestion unverified **(unverified)** |
| Hosting | Lovable (source repo `TheLionKing7/owanbe-project-studio`) | ✅ |
| Mobile | Expo / React Native | not started |
| Tests | Vitest 4 (jsdom) in `src/test`; plain SQL suites on Postgres 16 in `supabase/tests` | both run in CI (`verify.yml`); neither has been run on this machine **(unverified)** |
| Package manager | **Bun** (`bun.lock`, `bunfig.toml`; CI pins bun 1.4.4) | `README.md` still tells people to use npm (see `09`) |

`drizzle/` (a 2-line schema stub plus an empty migration journal) and the `drizzle-orm` / `drizzle-kit` / `postgres` devDependencies are Lovable template leftovers. The authoritative schema is `supabase/migrations/` + `supabase/pending/`.

## Request / runtime flow
```
Browser ── SSR HTML (src/server.ts → nitro) ──► "/" Home
   │ __root.tsx effect → initializeMonitoring()   (Sentry inits only if the server fn returns a DSN)
   │ AuthProvider effect (skipped on /auth/callback) → whenIdle() (requestIdleCallback, 2 s)
   │    └─ dynamic import("./auth0Client")        ← Auth0 + Supabase SDKs stay out of the first chunk
   ├─ client.restoreSession() → auth0.getTokenSilently()   (memory cache, rotating refresh tokens)
   ├─ client.ensureAppUser()  → supabase.rpc('ensure_user') ◄── Bearer = Auth0 access token
   └─ client.listHouses()     → supabase.rpc('my_houses')
```
- `src/start.ts` registers `attachSupabaseAuth` as `functionMiddleware`, plus error and CSRF middleware (`createCsrfMiddleware` over `serverFn` handlers).
- The database still does the authoritative token check: `app_private.verified_sub()` validates iss / aud / exp / sub against `app_private.auth_settings`, and `ensure_user()` is the session gate that upserts `public.users`, refuses non-active accounts (`account_suspended` / `account_deactivated`) and provisions the Host house.
- **Two Supabase token paths exist.** The browser client passes `accessToken: () => auth0.getTokenSilently()`, while `src/integrations/supabase/auth-attacher.ts` attaches the *Supabase* session token to server-function calls. Reconcile before adding more server data access (logged in `09`).
- Server-side `validateToken()` (`src/lib/auth/validate-token.server.ts`: jose `createRemoteJWKSet`, RS256, iss/aud/exp/sub, then maps the subject to one active user with the service-role key) has **no call sites yet**, and neither do `requireSupabaseAuth`, `supabaseAdmin`, `authenticateCronRequest`, `checkEnvIsolation`, `missingServerEnv`, `house_can()` or any export of `src/lib/permissions.ts`. The authorization code exists; nothing routes through it.
- `AuthProvider` status is `unconfigured | loading | signedOut | signedIn | blocked | error`; with no env config it stays `unconfigured` and the houses remain locked (fail closed).

## Routes (file → URL)
| File | URL | Guard |
|---|---|---|
| `src/routes/_public/index.tsx` | `/` | public; SSR on; preloads `/images/hero.webp` |
| `src/routes/_public/sign-in.tsx` · `sign-up.tsx` | `/sign-in` · `/sign-up` | signed-in users are redirected to `?next=` (default `/host`); `safeReturnTo` rejects `//host` style values |
| `src/routes/_public/auth.callback.tsx` | `/auth/callback` | public — must be in Auth0's Allowed Callback URLs for every origin |
| `src/routes/_public/$.tsx` | `/*` | splat: `discover, vendors, culture, about, help, get-started` → `PlaceholderPage`, anything else → `NotFound` |
| `src/routes/host.tsx` + `host/index.tsx` + `host/$section.tsx` | `/host`, `/host/:section` | `RequireAuth` inside `HouseLayout houseId="host"` |
| `src/routes/vendor.tsx` + `vendor/*` | `/vendor`, `/vendor/:section` | same for the Vendor house |
| `src/routes/api/public/paystack/webhook.ts` | `/api/public/paystack/webhook` | POST only; rejects a bad signature with 401 |

Page bodies are in `src/pages/` (`Home`, `SignIn`, `AuthCallback`, `HousePage`, `PlaceholderPage`, `NotFound`) even though `src/routes/README.md` says not to create that folder. House sections come from `src/lib/houses.ts`.

## Environment
- Browser (everything in `import.meta.env` is public by construction): `VITE_APP_ORIGIN`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, `VITE_SUPABASE_URL`, and the Supabase key accepted in the order `VITE_SUPABASE_PUBLISHABLE_KEY` → `VITE_SUPABASE_ANON_KEY` → `VITE_SUPABASE_PUBLIC_KEY`. `readAuthEnv()` returns `null` if any is missing.
- Server-only, listed in `src/config/server-env.ts` `REQUIRED_SERVER_ENV`: `APP_ENV`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (Lovable reserves the `SUPABASE_` prefix; `src/lib/supabase-admin-env.server.ts` falls back to `SUPABASE_SERVICE_ROLE_KEY`), `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `SENTRY_DSN`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`.
- `checkEnvIsolation()` requires `sk_live_`/`pk_live_` in production and rejects them in every other environment — but nothing calls it yet.
- Also read ad hoc: `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS`, `INITIAL_JS_BUDGET_KB`, and `AUTH0_TENANT` / `AUTH0_TENANT_REGION` in `supabase/config.toml`.
- `docs/deployment.md` is the release runbook: one hosted Supabase project (owner's decision), env matrix, migrations-before-app order, backup/restore rehearsal, Paystack and Sentry setup per environment.

## Performance / bundle
- `scripts/check-bundle.mjs` enforces ≤ 100 kB gzipped initial JS (override with `INITIAL_JS_BUDGET_KB`) but is **not wired** into `package.json` or CI, and the rebuild's SSR bundle is far larger than the old 78 kB SPA figure — re-measure before re-stating a number.
- Keep the SDK lazy-import rule: never statically import `@auth0/auth0-spa-js` or `@supabase/supabase-js` outside `src/lib/auth/auth0Client.ts`.
- `src/lib/router.tsx`'s `Link`/`NavLink` render plain `<a>` and call `router.navigate()`, so TanStack's route preloading does not apply to them.

## Git hosting and what a push does
- Lovable syncs to **`TheLionKing7/owanbe-project-studio`** (source). `.github/workflows/mirror-to-owanbe.yml` forwards that `main` to `TheLionKing7/Owanbe/main` — the audit repo Sage 7 watches — with a plain push: no force, no deploy, no migration.
- `.github/workflows/verify.yml` runs on `main` pushes and PRs: `bun install --frozen-lockfile` → `bun run test` → `bun run build`, and a second job runs `bash supabase/tests/run-local.sh` against a disposable Postgres 16. It uses no hosted credentials and deploys nothing.
- Mirroring is not yet activated: the owner must add `OWANBE_MIRROR_TOKEN` to the source repo (`roadmap.md`). `Owanbe/main` also carries 7 `docs: sync Sage 7 blueprint` commits that `owanbe-project-studio/main` lacks, so the first mirror push will be rejected as non-fast-forward until they are reconciled (see `09`).
- Publishing the app happens through Lovable, never through a push to the audit repo.
