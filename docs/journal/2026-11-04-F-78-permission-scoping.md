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

**Applied — and a duplicate-apply note the owner closed on 2026-11-05**
Supabase is now connected. Re-running the migration returned
`ERROR 42723: function "owner_only_capabilities" already exists with same argument types`, which is
the expected result for a file that was already applied: the script creates its functions from
scratch and has no `or replace` / `drop`, so it aborts on the very first statement and changes
nothing else. The owner's answer (Sage 7 question `374ee9ac`) is to leave it there — F-78's functions
were confirmed by the 2026-11-04 audit, so the error is a bookkeeping artefact, not a defect, and no
re-run is wanted. Two things this does **not** prove, and no one should repeat as fact: that the
original apply was complete (a 42723 tells you the first statement found a collision, nothing about
the other ten), and that the F-14 / F-38 / F-60 SQL suites have ever executed — they still need a
machine with `initdb`/`psql`, so `supabase/tests/db_state_check.sql` exists as a read-only substitute
that can be pasted into the Dashboard.
Separately, the working tree on the F-60/F-80 branch holds this file under `supabase/migrations/`
while `HEAD` still has it under `supabase/pending/` (identical content, deliberately uncommitted —
that is F-78's deployment-ordering question, not part of either feature).

