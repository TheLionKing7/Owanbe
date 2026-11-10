# 2026-11-08 · F-40 Guest list privacy controls

- **Feature:** F-40 Guest List Privacy Controls (`e63e01d0-783e-48e9-84d5-fe0d43d050cd`, must, Data &
  State / Privacy, release v1). Served by `get_next_task` on 2026-11-08 with
  `acceptance_state: confirmed` and `planner_confirmed_at: 2026-11-08T22:10:34Z`.
- **Feature description (Sage 7):** _"Guest lists are private by default and visible only to the
  host. The host can share a list with selected people or make it public, but phone and address
  fields never appear in shared or public views. Sharing can be revoked by the host at any time."_
- **Owner decisions (2026-11-08, asked before any code):**
  - **Who receives a shared list:** _platform users only_. A share grants one existing Ówàńbè account
    (verified email) a masked read of that list. Link/claim sharing stays with F-70 and F-71.
  - **What a list is:** _house-scoped with a title_. Lists live in the Host house and carry a title;
    there is no `events` table, because none is served and F-40 has no dependencies.

## Acceptance criteria — built to

1. **A list is private by default and only the host can see it.** `public.guest_lists` defaults to
   `visibility = 'private'`; the RLS policy on it, on `rsvps` and on `guest_list_shares` admits only
   active members of the owning house. A vendor-house account cannot create a list, and a host
   cannot read another house's list.
2. **The host can share with selected people and can make it public.** `share_guest_list(...)` and
   `set_guest_list_visibility(...)` are `security definer` functions; writes are revoked for
   `anon`/`authenticated`, so the browser can only reach them through an authorised path.
3. **Phone and address never appear in a shared or public view.** This is structural, not a UI
   convention: `guest_list_rsvps` is the only function that returns contacts, and the shared
   (`shared_guest_list`, `shared_with_me`) and public (`public_guest_list`) projections declare no
   `phone` or `address` column at all. `maskPreview()` builds the host's preview from two named
   fields, so a contact cannot ride along if the row shape grows.
4. **Sharing can be revoked at any time.** `revoke_guest_list_share(...)` ends the grant in the same
   transaction; the recipient's next read is refused by the policy. Switching a list back to
   `private` revokes every live grant at once.

## What changed

- `supabase/migrations/20261108120000_f40_guest_list_privacy.sql` — tables `guest_lists`, `rsvps`,
  `guest_list_shares`; RLS enabled **and forced**; write functions `create_guest_list`,
  `add_guest_rsvp`, `set_guest_list_visibility`, `share_guest_list`, `revoke_guest_list_share`;
  read projections `my_guest_lists`, `guest_list_rsvps` (host only), `guest_list_recipients`,
  `shared_with_me`, `shared_guest_list`, `public_guest_list`; audit rows through
  `app_private.audit` with identifiers only.
- `supabase/tests/f40_guest_privacy.test.sql` — 10 sections: default privacy, host-only writes,
  structural masking checked against `pg_get_function_result`, share validation, masked recipient
  reads, public read, instant revocation, private-revokes-all, cross-house isolation, audit rows
  that never contain a phone, address or email.
- `supabase/tests/db_state_check.sql` — 15 F-40 rows added so the read-only state check reports
  which F-40 objects are present in a given database.
- `supabase/tests/run-local.sh` — the migration loop no longer aborts when `supabase/pending/` is
  empty (the glob was unexpanded and the file did not exist).
- `src/features/guest-lists/` — `contracts.ts` (zod input validation and the shapes the UI renders),
  `api.ts` (RPC boundary and error classification), `share.server.ts` (server-only share route
  handler), `public.functions.ts` (anon read of a public list), `GuestListCard.tsx` (per-list
  visibility, sharing, revocation, guests, masked preview), `GuestListPanel.tsx` (the house's
  lists, the create form, and "shared with you").
- `src/routes/api/guest-lists/$id/share.ts` — `POST /api/guest-lists/:id/share`. The caller's own
  token is forwarded to PostgREST, so the database decides whether they own the list; the route
  grants nothing by itself and refuses a secret key.
- `src/routes/_public/guest-lists.$id.tsx` — the public page for a list the host made public. It
  shows names and responses only, is `noindex`, and answers "not available" identically for a
  missing list and a private one so the URL cannot be enumerated.
- `src/pages/HousePage.tsx` — the Host house "Guests" page now mounts the panel.

## Checks run

- `npx vitest run` — 21 files, 171 tests passed (25 of them new for F-40).
- `npm run test:load` — 21 of 21 test files loaded, 171/171 passed.
- `npx tsc --noEmit` — clean.
- `npm run build` — passes.
- `bash supabase/tests/run-local.sh` — **not run**: this machine has no Postgres 16+ binaries and the
  Docker daemon is not reachable, so `f40_guest_privacy.test.sql` has never been executed. It needs a
  machine with `initdb`/`pg_ctl`/`psql`, or `PG_BIN` pointing at them.
- CI is **disabled** in both repositories on the owner's instruction (2026-11-06, `40cf8a8e`), so no
  workflow has run for this feature.

## Not done / limits

- The "shared with you" list is shown on the Host house "Guests" page. A recipient with no host house
  has no other place to open a shared list; that placement is F-40's scope, not a new decision.
- Free-text notes, dietary and allergy information are deliberately absent from `rsvps`: that data is
  consent-gated and belongs to F-59.
- `add_guest_rsvp` stores phone and address as written; there is no third-party check, no masking and
  no retention job for them. F-39 (record retention) and F-62 (upload moderation) are separate
  features and were not touched.
- The public list page has no sharing link distribution, no indexing and no per-list analytics, so
  "public" means readable by anyone who has the URL.
