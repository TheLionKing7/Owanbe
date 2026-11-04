# ADR 0002: Auth0 → Supabase third-party auth

**Status:** accepted by the owner (2026-11-01, Cowork session). Reported to Sage 7.

## Decision
- Supabase accepts Auth0 access tokens through its built-in third-party auth (JWKS signature verification). There is no Supabase login and no token exchange.
- The database re-validates issuer, audience and expiry (`app_private.verified_sub()`) against per-environment settings. It fails closed when those settings are missing.
- `public.ensure_user()` is the session gate. It maps the Auth0 `sub` to one `public.users` row (unique constraint) and raises `account_<status>` unless the account is active. The web app grants access to the houses only after it succeeds.
- Web SDKs: `@auth0/auth0-spa-js` 2.28.3 and `@supabase/supabase-js` 2.117.3. Both belong to the decided stack (Auth0, Supabase). They are lazy-loaded so they stay out of the first-paint bundle.
- Tokens are kept in memory and refreshed with rotating refresh tokens; nothing is written to localStorage.

## Alternatives considered
- An Edge Function verifies every token and proxies all data access. That means more code, and the database's row-level security can't key off the caller directly.
