# 02 · Architecture

## Stack (what is installed today)
| Concern | Tech | In repo |
|---|---|---|
| Web | **TanStack Start** 1.168.60 + React 19.2 + Vite 8.1 + TypeScript 5.8; SSR through a nitro (Cloudflare target) build | ✅ `@lovable.dev/vite-tanstack-config` owns the plugin list — owner-ratified by ADR 0003 |
| Routing | `@tanstack/react-router` 1.170.41 file routes in `src/routes`, generated `src/routeTree.gen.ts`; `src/lib/router.tsx` re-exports a React-Router-shaped API so ported components kept working | ✅ |
| Styling / UI kit | Tailwind CSS 4 — tokens live in `@theme` inside `src/styles.css`, **no `tailwind.config.ts`** — plus shadcn/ui (`src/components/ui`, 45 generated files, `components.json` style `new-york`, 25 Radix packages) and lucide-react | ✅ — the runtime is ratified by ADR 0003, but **shadcn/ui + Radix have no owner decision of their own** (see `09`) |
| Data fetching | `@tanstack/react-query` 5 | installed; only the `QueryClient` router context is wired |
| Database / API | Supabase Postgres + RLS + RPC functions (`supabase/migrations`, `supabase/pending`) | ✅ code; F-78 migration not applied — no connected project **(unverified)** |
| Auth | Auth0 SPA (`@auth0/auth0-spa-js` 2.28.3) → Supabase third-party auth (`@supabase/supabase-js` ^2.118) | ✅ code; live tenant not exercised **(unverified)** |
| Payments | **Paystack** (HMAC-SHA512 webhook) — replaced Stripe at the owner's request in F-79; ratified by ADR 0003 | ✅ webhook shell only; no charge/transfer/ledger handling |
| Email / Jobs / Search / AI | Resend, Trigger.dev, Algolia, Vercel AI SDK | not started |
| Observability | `@sentry/react` 10, browser-only, sanitized by `src/lib/monitoring/privacy.ts` | ✅ code; no DSN in preview, ingestion unverified **(unverified)** |
| Hosting | Lovable (source repo `TheLionKing7/owanbe-project-studio`) | ✅ |
| Mobile | Expo / React Native | not started |
| Tests | Vitest 4 (jsdom) in `src/test`; plain SQL suites on Postgres 16 in `supabase/tests` | both run in CI (`verify.yml`); the owner's environment reports 25 tests / 6 files green, this machine could not run them **(unverified here)** |
| Package manager | **Bun** (`bun.lock`, `bunfig.toml`; CI pins bun 1.4.4) | `README.md` still tells people to use npm (see `09`) |

`drizzle/` (a 2-line schema stub plus an empty migration journal) and the `drizzle-orm` / `drizzle-kit` / `postgres` devDependencies are Lovable template leftovers. The authoritative schema is `supabase/migrations/` + `supabase/pending/`.

## Request / runtime flow
- Embedded sign-in uses `src/lib/auth/preview-navigation.ts` to open the same-origin sign-up/sign-in page outside the iframe before initializing a PKCE transaction. Tokens remain in memory; no token or transaction is copied between contexts. Standalone callback allowlisting remains required in Auth0 (unverified).
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
- Server-side `validateToken()` (`src/lib/auth/validate-token.server.ts`: jose `createRemoteJWKSet`, RS256, iss/aud/exp/sub, then maps the subject to one active user with the service-role key) has **no call sites yet**, and neither do `requireSupabaseAuth`, `supabaseAdmin`, `authenticateCronRequest`, `checkEnvIsolation`, `missingServerEnv`, `house_can()` or any export of `src/lib/permissions.ts`. **This is Sage 7 staging, not an oversight:** F-78 is a Foundation-layer feature, and the UI call sites belong to later "Rooms" features (F-1 Dual Workspace Switcher, F-43 Team Role Delegation). Until a route calls them, staff scoping and env isolation are code, not behaviour — do not present them as enforced.
- `AuthProvider` status is `unconfigured | loading | signedOut | signedIn | blocked | error`; with no env config it stays `unconfigured` and the houses remain locked (fail closed).

## Routes (file → URL)
| File | URL | Guard |
|---|---|---|
| `src/routes/_public/index.tsx` | `/` | public; SSR on; preloads `/images/hero.webp` |
| `src/routes/_public/sign-in.tsx` | `/sign-in` | signed-in users are redirected to `?next=` (default `/host`); `safeReturnTo` rejects `//host` style values |
| `src/routes/_public/sign-up.tsx` | `/sign-up` | public role picker (`src/pages/SignUp.tsx`, F-7): Host or Vendor, then Auth0 sign-up with `returnTo=/welcome?role=…`; a signed-in visitor goes straight to `/welcome` |
| `src/routes/welcome.tsx` | `/welcome?role=&next=` | `RequireAuth`; F-7 onboarding wizard (`src/pages/Welcome.tsx`): about you (name, phone, city) → host intent or vendor business → the house (`/host?welcome=1` or `/vendor/profile?welcome=1`, or a safe in-app `next`) |
| `src/routes/_public/auth.callback.tsx` | `/auth/callback` | public — must be in Auth0's Allowed Callback URLs for every origin |
| `src/routes/_public/$.tsx` | `/*` | splat: `discover, vendors, culture, about, help, get-started` → `PlaceholderPage`, anything else → `NotFound` |
| `src/routes/host.tsx` + `host/index.tsx` + `host/$section.tsx` | `/host`, `/host/:section` | `RequireAuth` → `OnboardingGate` (F-7: unfinished onboarding redirects to `/welcome?role=host&next=…`; staff of another house and a missing migration pass through) inside `HouseLayout houseId="host"` |
| `src/routes/vendor.tsx` + `vendor/*` | `/vendor`, `/vendor/:section` | same for the Vendor house |
| `src/routes/api/public/paystack/webhook.ts` | `/api/public/paystack/webhook` | POST only; rejects a bad signature with 401; then records the event and allocates once |
| `src/routes/api/bookings/$id/payments.ts` | `/api/bookings/:id/payments` | GET the caller's fund and movements; POST starts the Paystack charge |
| `src/routes/api/bookings/$id/complete.ts` | `/api/bookings/:id/complete` | POST the host's completion; releases the final tranche |
| `src/routes/api/bookings/$id/refund.ts` | `/api/bookings/:id/refund` | POST the host's refund ask for the money still held |
| `src/routes/api/bookings/$id/freeze.ts` | `/api/bookings/:id/freeze` | POST the staff freeze or unfreeze (arbitrator grant) |
| `src/routes/api/payments/verify.ts` | `/api/payments/verify` | POST the browser check of a Paystack reference |
| `src/routes/planner.tsx` | `/planner` | `RequireAuth`; the F-101 planner page (the database decides whether the caller is in a Host house) |
| `src/routes/api/planner/generate.ts` | `/api/planner/generate` | POST the planner's grounded answer; the caller's token is forwarded to the database |
| `src/routes/api/planner/report.ts` | `/api/planner/report` | POST one report on the caller's own answer |
| `src/routes/api/benchmarks.ts` | `/api/benchmarks` | POST the market range for the categories a host is comparing; the caller's token is forwarded to the database |
| `src/routes/api/ai/status.ts` | `/api/ai/status` | GET whether this caller may use OwanbeAI (the grant **and** the zero-retention contract); the caller's token is forwarded to the database |
| `src/routes/api/ai/investigate.ts` | `/api/ai/investigate` | POST OwanbeAI's reading of one booking's payment trail; the trail is read from the database first, and the model is called only after the read succeeded |
| `src/routes/api/ai/report.ts` | `/api/ai/report` | POST one report on the caller's own answer; the shared route for every AI surface (planner, vendor copy, OwanbeAI) |

Page bodies are in `src/pages/` (`Home`, `SignIn`, `AuthCallback`, `HousePage`, `PlaceholderPage`, `NotFound`) even though `src/routes/README.md` says not to create that folder. House sections come from `src/lib/houses.ts`.

## Environment
- Browser (everything in `import.meta.env` is public by construction): `VITE_APP_ORIGIN`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, `VITE_SUPABASE_URL`, and the Supabase key accepted in the order `VITE_SUPABASE_PUBLISHABLE_KEY` → `VITE_SUPABASE_ANON_KEY` → `VITE_SUPABASE_PUBLIC_KEY`. `readAuthEnv()` returns `null` if any is missing.
- Server-only, listed in `src/config/server-env.ts` `REQUIRED_SERVER_ENV`: `APP_ENV`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` (Lovable reserves the `SUPABASE_` prefix; `src/lib/supabase-admin-env.server.ts` falls back to `SUPABASE_SERVICE_ROLE_KEY`), `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `SENTRY_DSN`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`.
- `checkEnvIsolation()` requires `sk_live_`/`pk_live_` in production and rejects them in every other environment — but nothing calls it yet.
- Also read ad hoc: `LOVABLE_CRON_SECRET`, `LOVABLE_CRON_SECRET_PREVIOUS`, `INITIAL_JS_BUDGET_KB`, and `AUTH0_TENANT` / `AUTH0_TENANT_REGION` in `supabase/config.toml`.
- F-107 added **`LOVABLE_API_KEY`** as the one key for every AI surface. It is read only by `src/lib/ai/provider.server.ts` (and by the older vendor copy path), never by the browser, and never logged. Without it the platform says "not set up in this environment" rather than failing silently.
- F-102 added `PAYMENT_ROUTER_KEY`: the platform's own gate on `src/lib/payments/router.server.ts`, the only module that may move money. It is not a third-party credential, it is never logged, and the module refuses to run without it (`unconfigured`). The Paystack secret stays in `PAYSTACK_SECRET_KEY` and is read inside the call.
- `docs/deployment.md` is the release runbook: one hosted Supabase project (owner's decision), env matrix, migrations-before-app order, backup/restore rehearsal, Paystack and Sentry setup per environment.

## Performance / bundle
- `scripts/check-bundle.mjs` enforces ≤ 100 kB gzipped initial JS (override with `INITIAL_JS_BUDGET_KB`) but is **not wired** into `package.json` or CI, and the rebuild's SSR bundle is far larger than the old 78 kB SPA figure — re-measure before re-stating a number.
- Keep the SDK lazy-import rule: never statically import `@auth0/auth0-spa-js` or `@supabase/supabase-js` outside `src/lib/auth/auth0Client.ts`.
- `src/lib/router.tsx`'s `Link`/`NavLink` render plain `<a>` and call `router.navigate()`, so TanStack's route preloading does not apply to them.

## Git hosting and what a push does
- Lovable syncs to **`TheLionKing7/owanbe-project-studio`** (source). `.github/workflows/mirror-to-owanbe.yml` forwards that `main` to `TheLionKing7/Owanbe/main` — the audit repo Sage 7 watches — with a plain push: no force, no deploy, no migration.
- `.github/workflows/verify.yml` runs on `main` pushes and PRs: `bun install --frozen-lockfile` → `bun run test` → `bun run build`, and a second job runs `bash supabase/tests/run-local.sh` against a disposable Postgres 16. It uses no hosted credentials and deploys nothing. **Both workflows exist at the owner's explicit request** — they are approved infrastructure, not a stack addition.
- Mirroring is not yet activated: the owner must add `OWANBE_MIRROR_TOKEN` to the source repo (`roadmap.md`). `Owanbe/main` also carries 7 `docs: sync Sage 7 blueprint` commits that `owanbe-project-studio/main` lacks, so the first mirror push will be rejected as non-fast-forward until they are reconciled (see `09`).
- Publishing the app happens through Lovable, never through a push to the audit repo.
