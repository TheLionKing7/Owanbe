# Auth0 + Supabase setup (F-76)

Auth0 is the only sign-in authority. Supabase trusts Auth0 access tokens (third-party auth).
The database re-checks issuer, audience and expiry, maps each Auth0 subject to exactly one
row in `public.users`, and refuses access to suspended or deactivated accounts (`public.ensure_user()`).

Repeat these steps for each environment: dev, staging and prod.

## 1. Auth0 tenant
1. Create a tenant, for example `owanbe-dev` (region `us`). Its domain will be `owanbe-dev.us.auth0.com`.
2. **APIs → Create API**
   - Identifier (audience): `https://api.owanbe.app`
   - Signing algorithm: RS256
   - Allow offline access: on (for refresh tokens)
3. **Applications → Create → Single Page Application** ("Ówàńbè Web")
   - Allowed Callback URLs: `http://localhost:8080/auth/callback, https://<your-domain>/auth/callback`
   - Allowed Logout URLs and Allowed Web Origins: `http://localhost:8080, https://<your-domain>`
   - Refresh Token Rotation: on. Absolute expiry: 30 days. Inactivity: 7 days.
4. **Actions → Library → Create Action** (Login / Post Login), then add it to the Login flow:

```js
exports.onExecutePostLogin = async (event, api) => {
  // Supabase runs requests as the Postgres role named in the token's "role" claim.
  api.accessToken.setCustomClaim("role", "authenticated");
  // Optional profile hints for public.users (never used for authorization)
  api.accessToken.setCustomClaim("https://owanbe.app/email", event.user.email);
  api.accessToken.setCustomClaim("https://owanbe.app/email_verified", event.user.email_verified);
  api.accessToken.setCustomClaim("https://owanbe.app/name", event.user.name);
};
```

## 2. Supabase project
1. **Authentication → Sign In / Providers → Third-party auth → Add Auth0** and enter the tenant (`owanbe-dev`) and region (`us`). If you use the CLI, see `supabase/config.toml` (`AUTH0_TENANT`, `AUTH0_TENANT_REGION`).
2. Apply the migrations: `supabase db push`.
3. Tell the database which Auth0 issuer and audience to accept. Run this once in the SQL editor:

```sql
select app_private.configure_auth0('owanbe-dev.us.auth0.com', 'https://api.owanbe.app');
```

Until that runs, every session is refused (`auth_not_configured`).

## 3. Web app (`.env.local`)
```
APP_ORIGIN=http://localhost:8080
AUTH0_DOMAIN=owanbe-dev.us.auth0.com
AUTH0_CLIENT_ID=<SPA client id>
AUTH0_AUDIENCE=https://api.owanbe.app
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLIC_KEY=<publishable / anon key>
```
Only the variables above reach the browser (see `PUBLIC_ENV` in `vite.config.ts`). Never put secret keys here.

## Checks
- `npm test`: UI session gate (signed out, signed in, suspended, callback, error/retry, fail-closed).
- `bash supabase/tests/run-local.sh`: database tests against a throwaway Postgres 16. They cover issuer, audience, expiry and subject checks, the one-user-per-subject mapping, suspended accounts, row-level security, no direct writes, and failing closed when unconfigured.
