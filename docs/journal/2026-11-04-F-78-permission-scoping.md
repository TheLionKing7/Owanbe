# 2026-11-04 · F-78 Permission scoping

**What changed**
- `supabase/pending/20261104000000_f78_permission_scoping.sql`:
  - `house_can()`: owners can use everything. Staff can use only their granted capabilities, never payouts, members or billing. Revoked or unknown members get nothing.
  - `set_member_capabilities()` and `revoke_member()`: owner only, and audited.
  - `support_house_members()` and `authorize_sensitive_read()`: support and event managers need an active grant (event managers only for assigned events) and a stated purpose. Every read is written to `audit_events` as `sensitive.read`.
- `src/lib/auth/validate-token.server.ts` (`validateToken`): checks the Auth0 signature (JWKS, RS256), issuer, audience and expiry, then maps the subject to one active user using the service role key.
- `src/lib/permissions.ts`: a copy of the role matrix that the UI uses for hints.

**How it was checked**
`supabase/tests/f78_permissions.test.sql` passes alongside the F-76 and F-77 tests. `src/test/permissions.test.ts` and `src/test/validate-token.test.ts` pass.

**Open**
The migration is pending until the owner connects Supabase.
