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
For local development, prefix these public values with `VITE_` in the ignored `.env.local` file. This file does not configure the published app.

For Lovable hosting, save `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, `EXTERNAL_SUPABASE_URL`, and `EXTERNAL_SUPABASE_ANON_KEY` (or `EXTERNAL_SUPABASE_PUBLISHABLE_KEY`) in project Secrets. The public configuration server function returns only these sign-in identifiers. External database settings take precedence over managed settings. Never expose `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` or `PAYSTACK_SECRET_KEY` to the browser.

After saving settings and updating the code, publish the app to apply the change to the live site. Auth0's allowed origins and callback URLs must include the published origin and `/auth/callback` respectively. Missing settings fail closed; temporary loading failures can be retried.

## Checks

### This project's preview allowlist
In the existing Auth0 SPA application's Settings, retain the production entries and add these exact values:

- **Allowed Callback URLs:** `https://id-preview--abc42661-c8be-4f74-a11c-497338954064.lovable.app/auth/callback`
- **Allowed Logout URLs:** `https://id-preview--abc42661-c8be-4f74-a11c-497338954064.lovable.app/`
- **Allowed Web Origins:** `https://id-preview--abc42661-c8be-4f74-a11c-497338954064.lovable.app`
- Keep the published callback `https://owanbe-vendors.lovable.app/auth/callback` and published origin `https://owanbe-vendors.lovable.app`.

Use exact entries, not `https://*.lovable.app`: a wildcard would trust unrelated apps. The preview opens the same app outside its iframe before starting Auth0, keeping the PKCE transaction and callback in one browsing context. If the browser blocks opening a tab, the sign-in/sign-up page offers an explicit new-tab link. This does not transfer a signed-in session into the editor iframe; continue in the standalone tab.

Auth0 settings have not been changed by these source edits. If Auth0 returns to the published sign-in page instead of Universal Login, verify the callback allowlist and Application Login URI in Auth0 first.

- `npm test`: UI session gate (signed out, signed in, suspended, callback, error/retry, fail-closed).
- `bash supabase/tests/run-local.sh`: database tests against a throwaway Postgres 16. They cover issuer, audience, expiry and subject checks, the one-user-per-subject mapping, suspended accounts, row-level security, no direct writes, and failing closed when unconfigured.
