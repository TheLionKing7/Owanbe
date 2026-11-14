# 2026-11-13 · F-46 A distinct identity for the AI investigation

## What the audit found

The F-46 claim was graded **partial**. The audit note read: *"AI investigation gated by
grant (server.ts), but distinct role not confirmed"*, and the feature's own technical
note asks for a hard boundary: *"AI service account has read-only access to payment
logs."*

The gating was real: F-107 gave the payment log a staff capability
(`ai_investigation`), a zero-retention gate, a minimised projection and a sensitive-read
audit. But the identity behind the read was still the platform's own. `public.ai_payment_log`
was a `SECURITY DEFINER` function owned by the platform's owner, reading
`public.bookings` and `public.fund_pool` with the platform's rights. The AI's read and
the platform's read were the same read, and the only thing standing between the AI and
the money was a `GRANT` check on a capability — not an identity of its own.

## What was delivered

- `supabase/migrations/20261112130000_f46_investigation_only_role.sql`
  - **The identity.** A new role `investigation_only`: `nologin`, `nosuperuser`,
    `nocreatedb`, `nocreaterole`, `noinherit`. It is a member of no role, so no privilege
    reaches it by inheritance, and the only membership it may have is the platform's own
    administrator, which PostgreSQL itself records when the role is created and which
    holds no `SET` option, so nobody may act as it.
  - **What it may read, and nothing else.** Two minimised views in `app_private`:
    `investigation_payment_view` (what was paid, what is held, what was released, what
    was refunded, whether the money is frozen, the counts and the hours since payment)
    and `investigation_events_view` (the provider's event type, outcome, amount,
    currency and moment). No party name, no email address, no house identifier, no
    provider reference, no payload — the same minimisation F-107 wrote, now expressed
    as the only two projections the AI's identity can see.
  - **The read is owned by the identity.** `app_private.investigation_read` and
    `app_private.investigation_event_read` are owned by `investigation_only`. This is
    what makes the boundary hard rather than decorative: the body of a `SECURITY
    DEFINER` function runs with its owner's rights, so if a line in that body touched
    `public.fund_pool` or `public.payment_events` directly, Postgres would refuse it —
    the identity holds no grant on those tables. The platform could not have written
    that body by accident.
  - **The refusals did not move.** The AI-owned read keeps F-107's checks in F-107's
    order: not signed in (`28000`), the zero-retention contract (`22023`,
    `zdr_contract_required`), the `ai_investigation` grant (`42501`), a stated purpose
    (`22023`, `purpose_required`), and the booking (`P0002`). Each refusal is audited
    exactly as before, with the grant id and the purpose.
  - **The application did not change.** `public.ai_payment_log` and
    `public.ai_payment_event_log` keep their names, their shapes and their grants, and
    are now thin passthroughs to the AI-owned reads. `src/features/ai/server.ts` calls
    them by name, so no app code moved.
  - **The house is resolved platform-side.** `app_private.log_investigation_read`
    resolves the booking's house and writes the audit row, so the identity never sees
    a house identifier, and it cannot write an audit row of its own: it holds no
    privilege on `public.audit_events`.

### Why the read lives in `app_private`

Two PostgreSQL facts shape this, and both were checked against the PostgreSQL
documentation and source before the migration was written:

1. A `SECURITY DEFINER` function **cannot** switch role. Postgres refuses
   `set role` inside one (*"cannot set parameter "role" within security-definer
   function"*), so a read cannot be re-pointed at a lesser identity from within a
   function. The identity has to *own* the function.
2. `ALTER FUNCTION … OWNER TO` requires the new owner to hold `CREATE` on the
   function's schema. The read therefore lives in `app_private`, which PostgREST does
   not expose, and the migration grants `CREATE` on that schema to the identity only
   for the moment the ownership moves and revokes it again immediately.

The read is `SECURITY DEFINER` so the *caller* is still the one who is checked: the
signed-in investigator, through the platform's own RPC. The identity is the **subject**
of the read, not a substitute caller.

## The handover failed on a non-superuser runner (2026-11-13)

The owner applied the migration to the platform's own database and it stopped here:

```
ERROR: 42501: must be able to SET ROLE "investigation_only"
```

That is the handover, not the identity. `ALTER FUNCTION … OWNER TO` requires the runner to
be able to `SET ROLE` the new owner, and the runner that created the role cannot:

- From PostgreSQL 16 on, a `CREATEROLE` user that creates a role is recorded as an **admin
  member** of it — granted by the bootstrap superuser, with `ADMIN` on and the `SET` option
  **off**. The runner may therefore administer the role but may not act as it, and the
  handover was refused. (`createrole_self_grant`, the setting that would have granted the
  `SET` option automatically, is empty by default.)
- Before PostgreSQL 16, membership alone was enough to `SET ROLE`, and a `CREATEROLE` user
  could grant membership in any non-superuser role outright.

The fix gives the runner the membership for the length of each handover and takes it
straight back:

- `grant investigation_only to <runner>` — one statement on every supported version, because
  from PostgreSQL 16 on a new membership carries the `SET` option by default.
- the `ALTER FUNCTION … OWNER TO`, inside the same block.
- `revoke investigation_only from <runner> granted by <runner>` on PostgreSQL 16 and later,
  plain `revoke` before that. The grantor is named on purpose: the administrative
  membership Postgres created itself was granted by the bootstrap superuser and must be
  left alone.
- if the handover fails, the membership is still taken back and the original error is
  re-raised with its SQLSTATE, so nothing is left behind and nothing is swallowed.

The suite got the same treatment around its `set local role investigation_only` block,
and one assertion was corrected rather than kept: the identity may have **one** member on
PostgreSQL 16 and later — the platform's own administrator, which Postgres itself
records, with the `SET` option off, so nobody may act as it. The suite now asserts that
no membership carries the `SET` option (and on PostgreSQL 15 and earlier, that the
identity has no member at all) rather than asserting that it has no members.

This is still **unexecuted** here: this machine has no PostgreSQL 16 and Docker does not
work on it, so the corrected SQL has been written to be read. It runs in the `database`
job of `.github/workflows/verify.yml`.

## How it was checked

- `node scripts/sql-shape-check.mjs` on the new migration and the new suite: shape OK.
- `npx vitest run` (whole suite): 57 files / 529 tests passed.
- `npx tsc --noEmit`: clean.
- `npx eslint` on the touched files: clean.
- `npm run memory:check`: ✓ memory bank current.
- **Not run here:** `supabase/tests/run-local.sh`. This machine has no PostgreSQL
  server and the owner has said Docker does not work on this system, so the SQL suite
  could not be executed. It runs in the `database` job of `.github/workflows/verify.yml`,
  which installs PostgreSQL 16 and applies every migration to a disposable database.
  The SQL in this change is therefore **unexecuted**: it has been written to be read,
  not proven to run.
- `supabase/tests/f46_investigation_only.test.sql` (written, unexecuted) asserts, over
  its own fixtures: the role exists and is powerless in itself; it is a member of nothing
  and nobody may act as it; it holds no `SELECT`, `INSERT`, `UPDATE` or `DELETE` on
  any of twelve tables including every payment table, `public.cases` and
  `public.ai_interactions`; it holds no `EXECUTE` on the nine money functions nor on
  the two payment RPCs; no application role may become it; both reads are owned by it
  and by nothing else; no application role may call the reads directly; it holds no
  `CREATE` on the schema it lives in; acting as the identity it may read the
  minimised view and nothing else; the investigator's read is unchanged and is still
  audited with the grant and the purpose; the refusals are unchanged; the gate still
  closes the read; and the money did not move.

## Not done, and why

- **The identity is not a login.** It is `nologin` on purpose: nothing signs in as it.
  It is the identity the AI's read runs *under*, not an account a person or a service
  uses to sign in. A service account that signs in would need credentials, and
  credentials for a role that must never hold money authority are a worse trade than
  a role that has none.
- **The application still calls the platform's RPC.** The identity is inside the
  database, not in the HTTP layer. `src/features/ai/server.ts` is unchanged and still
  forwards the caller's own token, so the caller's grant is still what is checked. What
  changed is that the read itself, once permitted, is performed by a role that
  provably cannot write.
- **The identity can write an audit row.** `app_private.log_investigation_read` is
  `SECURITY DEFINER` and owned by the platform, and it is what writes the
  `sensitive.read` row. The identity holds no privilege on `public.audit_events`
  itself; it can cause a row to be written for a read it was permitted to make, with
  the purpose supplied and the grant recorded, and nothing else.
- **No new capability was added.** F-46 asked for a role, not a capability. The
  capability list is unchanged: `ai_investigation` was already there from F-107.

## Open

- The SQL suite has not run. The identity is unverified until the CI database job and
  the audit have run.
