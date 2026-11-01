# 02 · Architecture

## Stack (decided; adding anything else needs a recorded decision)
| Concern | Tech | Status in repo |
|---|---|---|
| Web | React 18.3 + Vite 5.4 + TypeScript 5.6 SPA, Tailwind 3.4, React Router 6.28, lucide-react | ✅ |
| Hosting | Lovable hosting | not wired yet (F-79) |
| Database / API | Supabase Postgres + RLS + RPC functions | ✅ migrations; no live project yet **(unverified)** |
| Auth | Auth0 SPA (`@auth0/auth0-spa-js` 2.28.3) → Supabase third-party auth (`@supabase/supabase-js` 2.117.3) | ✅ code; no live tenant **(unverified)** |
| Payments / Email / Jobs / Search / AI / Observability | Stripe, Resend, Trigger.dev, Algolia, Vercel AI SDK, Sentry | not yet |
| Mobile | Expo (React Native) | not yet |
| Tests | Vitest + Testing Library (UI) ✅; plain SQL suites need Postgres 16 (`supabase/tests`) — **not yet executed in this environment** **(unverified)** |

## Git hosting and what a push does

Remote is `github.com/TheLionKing7/Owanbe` (private). Pushing or merging into `main` **does not deploy anything**:
- One repository webhook (events `push`, `pull_request`, `issues`, `delete`) points at the Sage 7 sync endpoint, which is how Sage sees commits as build evidence. Its URL carries a private token parameter — never record it here.
- No `.github/` directory: no workflows, no Actions deployments, no environments; the repo reports zero deployments. No local git hooks.
- No Lovable/Vercel/Netlify configuration in the tree, so Lovable hosting is not connected to this repo yet (F-79 owns that).
- No branch protection is available on this plan, so PRs can merge with nothing having run `npm run ci` (F-80 adds CI).

## Request / runtime flow
```
Browser ──(first paint: index + react chunks only, ~78 kB gz)──► Home "/"
   │ idle → dynamic import auth0Client chunk (Auth0 SDK + Supabase client)
   ├─ restoreSession(): auth0.getTokenSilently()  (tokens in memory, rotating refresh tokens)
   └─ ensureAppUser(): supabase.rpc('ensure_user')  ◄── Bearer = Auth0 access token
          Supabase verifies the JWT signature (Auth0 JWKS) → auth.jwt()
          app_private.verified_sub(): iss / aud / exp / sub checks against app_private.auth_settings
          upsert public.users (1 row per auth0_sub) → refuse if status ≠ active
          provision Host house + owner membership (first time) → audit_events
      then listHouses(): supabase.rpc('my_houses') → HouseSummary[]
AuthProvider status: unconfigured | loading | signedOut | signedIn | blocked | error
```
- `RequireAuth` (in `HouseLayout`) renders children **only** when `status === "signedIn"`. When signed out, it calls `login({returnTo})`, which goes to Auth0 and back to `/auth/callback`, where `completeLogin` runs once (single-use code) and navigates to `returnTo`.
- With no env config the status is `unconfigured`, and the houses stay locked (fail closed).

## Routes (`src/App.tsx`)
| Path | Component | Loading | Auth |
|---|---|---|---|
| `/` | `routes/Home` inside `PublicLayout` | eager | public |
| `/discover`, `/discover/*`, `/vendors/*`, `/culture`, `/about`, `/help`, `/get-started` | `PlaceholderPage` | lazy | public |
| `/sign-in`, `/sign-up` (`?next=`) | `SignIn` → `RequireAuth` → `Navigate(next or /host)` | lazy | starts login |
| `/auth/callback` | `AuthCallback` | lazy | completes login |
| `/host`, `/host/:section` | `HouseLayout houseId="host"` → `HousePage` | lazy | RequireAuth |
| `/vendor`, `/vendor/:section` | `HouseLayout houseId="vendor"` → `HousePage` | lazy | RequireAuth |
| `*` | `NotFound` | lazy | public |
House sections come from `src/lib/houses.ts` (`HOUSES.host.nav`, `HOUSES.vendor.nav`). An unknown section renders NotFound.

## Environment (only these reach the browser: `PUBLIC_ENV` in `vite.config.ts`)
| Var | Used by | Purpose |
|---|---|---|
| `APP_ORIGIN` | `config/env.ts` `APP_ORIGIN`, `absoluteUrl()` | canonical origin; Auth0 redirect `APP_ORIGIN/auth/callback` |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` | `readAuthEnv()` | Auth0 SPA |
| `SUPABASE_URL`, `SUPABASE_PUBLIC_KEY` | `readAuthEnv()` | Supabase client (publishable key only) |
Server-only (never in `PUBLIC_ENV`): `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SENTRY_DSN` (F-79), Auth0 secrets. Supabase CLI: `AUTH0_TENANT`, `AUTH0_TENANT_REGION` (`supabase/config.toml`).

## Performance budget
- First-paint JS for `/` must stay ≤ 100 kB gzipped (`scripts/check-bundle.mjs`, part of `npm run ci`). It's currently about 78 kB.
- Every non-home route is `React.lazy`. Auth and Supabase load on idle (`whenIdle` in `AuthProvider`).
- `manualChunks` puts react, react-dom and react-router in a long-cached `react` chunk.
