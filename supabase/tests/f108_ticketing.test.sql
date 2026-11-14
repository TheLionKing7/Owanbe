-- F-108 ticketing tests. Raises on the first failure.
\set ON_ERROR_STOP on
\o /dev/null
select app_private.configure_auth0('owanbe.us.auth0.com', 'https://api.owanbe.app');

create function pg_temp.claims(sub text) returns text language sql as $$
  select jsonb_build_object('sub', sub, 'iss', 'https://owanbe.us.auth0.com/', 'aud', 'https://api.owanbe.app',
    'role', 'authenticated', 'exp', extract(epoch from now())::bigint + 3600)::text
$$;
create function pg_temp.expect_error(stmt text, fragment text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected error containing "%" but statement succeeded: %', fragment, stmt;
exception when others then
  if position(fragment in sqlerrm) = 0 then
    raise exception 'expected error containing "%", got "%"', fragment, sqlerrm;
  end if;
end $$;
do $$ begin
  execute format('grant usage on schema %I to authenticated, anon, service_role',
                 pg_my_temp_schema()::regnamespace::text);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures: Alice hosts a list, Bob hosts another, Dee is the person at the door
-- and belongs to no house at all — a scanner grant, not a membership, is what
-- lets a device admit guests.
-- ---------------------------------------------------------------------------
create temp table ids (alice uuid, bob uuid, dee uuid, alice_host uuid, bob_host uuid);
create temp table l1 (id uuid);
create temp table inv (doc jsonb);
create temp table oldt (token text);
create temp table couple (doc jsonb);
create temp table claim1 (doc jsonb);
create temp table claim2 (doc jsonb);
create temp table grant1 (doc jsonb);
create temp table grant2 (doc jsonb);
create temp table checkin (doc jsonb);
create temp table cache (credential_hash text, display_name text, status text,
                         expires_at timestamptz, cache_expires_at timestamptz);
create temp table door (result text, display_name text, conflict boolean, mode text);
create temp table grantee (user_id uuid, display_name text);
grant select, insert, update on ids, l1, inv, oldt, couple, claim1, claim2, grant1, grant2,
                                 checkin, cache, door, grantee
  to authenticated, anon;

insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f108-alice', 'alice108@example.test', true, 'Alice Adeyemi'),
  ('auth0|f108-bob',   'bob108@example.test',   true, 'Bob Ogun'),
  ('auth0|f108-dee',   'dee108@example.test',   true, 'Dee Okafor'),
  ('auth0|f108-unverified', 'unverified108@example.test', false, 'Unverified Person'),
  ('auth0|f108-suspended',  'suspended108@example.test',  true, 'Suspended Person');

update public.users set status = 'suspended' where auth0_sub = 'auth0|f108-suspended';

insert into ids (alice, bob, dee)
  select (select id from public.users where auth0_sub = 'auth0|f108-alice'),
         (select id from public.users where auth0_sub = 'auth0|f108-bob'),
         (select id from public.users where auth0_sub = 'auth0|f108-dee');

insert into public.houses (kind, owner_user_id, display_name) select 'host', alice, 'Alice''s celebrations' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'host', bob, 'The Ogun wedding' from ids;

update ids set
  alice_host = (select id from public.houses where display_name = 'Alice''s celebrations'),
  bob_host   = (select id from public.houses where display_name = 'The Ogun wedding');

insert into public.memberships (house_id, house_kind, user_id, role)
  select alice_host, 'host', alice, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role)
  select bob_host, 'host', bob, 'owner' from ids;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  insert into l1 select public.create_guest_list((select alice_host from ids), 'Tunde & Ada''s wedding');
commit;

-- ---------------------------------------------------------------------------
-- 1. The host issues an invitation, and the token is never stored in the clear
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  insert into inv select public.create_invitation((select id from l1), 1,
    now() + interval '30 days', now() + interval '31 days');
  insert into oldt select doc ->> 'token' from inv;
commit;

do $$ declare r record; begin
  select * into r from public.invitations where id = ((select doc from inv) ->> 'invitation_id')::uuid;
  assert r.claim_limit = 1, 'a standard link allows one claim';
  assert r.generation = 1, 'the first issue is generation 1';
  assert r.status = 'issued', 'a new invitation is issued, got ' || r.status;
  assert r.house_kind = 'host', 'an invitation belongs to a host house';
  assert length(r.token_hash) = 64, 'the token is stored as a sha256 hash';
  assert r.token_hash <> (select doc ->> 'token' from inv), 'the raw token is not the stored hash';
  assert not exists (select 1 from public.invitations
                     where token_hash = (select doc ->> 'token' from inv)),
    'the raw token is nowhere in the table';
  assert exists (select 1 from public.audit_events
                  where action = 'invitation.created' and target_id = r.id),
    'the issue is audited';
end $$;

-- Only the host of the list may issue, and the dates and the limit are checked.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-bob'), true);
  select pg_temp.expect_error(format('select public.create_invitation(%L, 1, now(), now())',
    (select id from l1)), 'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  select pg_temp.expect_error(format('select public.create_invitation(%L, 3, now() + interval ''1 day'', now() + interval ''2 day'')',
    (select id from l1)), 'invalid_claim_limit');
  select pg_temp.expect_error(format('select public.create_invitation(%L, 1, now() - interval ''1 day'', now() + interval ''2 day'')',
    (select id from l1)), 'invalid_claim_deadline');
  select pg_temp.expect_error(format('select public.create_invitation(%L, 1, now() + interval ''2 day'', now() + interval ''1 day'')',
    (select id from l1)), 'invalid_admission_expiry');
commit;

-- ---------------------------------------------------------------------------
-- 2. A guest claims with a name and a phone, and no account at all
-- ---------------------------------------------------------------------------
begin;
  set local role anon;
  insert into claim1 select public.claim_invitation((select doc ->> 'token' from inv),
    'Tunde Adeyemi', '+2348012345678', 'phone-1');
commit;

do $$ declare r record; begin
  select * into r from public.invite_claims where display_name = 'Tunde Adeyemi';
  assert r.slot = 1, 'the first claim takes slot 1';
  assert r.status = 'active', 'the claim is active';
  assert length(r.phone_reference) = 64, 'the phone is stored as a hash';
  assert r.phone_reference <> '+2348012345678', 'the phone is not stored in the clear';
  assert length(r.session_hash) = 64, 'the guest session is stored as a hash';
  assert r.session_hash <> (select doc ->> 'guest_session' from claim1),
    'the guest session is not stored in the clear';
  assert exists (select 1 from public.admissions a where a.claim_id = r.id),
    'the claim has an entry card';
  assert exists (select 1 from public.audit_events
                  where action = 'invitation.claimed' and target_id = r.id),
    'the claim is audited';
  assert not exists (select 1 from public.audit_events where details::text like '%Tunde Adeyemi%'),
    'the audit trail does not carry the guest''s name';
  assert not exists (select 1 from public.audit_events where details::text like '%2348012345678%'),
    'the audit trail does not carry the phone number';
end $$;

-- A claim needs a name and a phone, and an unknown token is refused.
begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select doc ->> 'token' from inv), '   ', '+2348012345678'), 'invalid_guest_name');
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select doc ->> 'token' from inv), 'Tunde', '123'), 'invalid_phone');
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    'not-a-real-token-at-all-not-a-real-token', 'Tunde', '+2348012345678'), 'invitation_not_found');
commit;

-- ---------------------------------------------------------------------------
-- 3. The claim is atomic: one slot for a standard link, two for a couple's
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  insert into couple select public.create_invitation((select id from l1), 2,
    now() + interval '30 days', now() + interval '31 days');
commit;

begin;
  set local role anon;
  insert into claim2 select public.claim_invitation((select doc ->> 'token' from couple),
    'Ada Adeyemi', '+2348099999999', 'phone-2');
commit;

do $$ declare r record; begin
  select * into r from public.invite_claims where display_name = 'Ada Adeyemi';
  assert r.slot = 1, 'the first claim of a couple''s link takes slot 1';
end $$;

-- The same phone may not take a second slot of the same link.
begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select doc ->> 'token' from couple), 'Ada Again', '+2348099999999'), 'duplicate key');
commit;

begin;
  set local role anon;
  insert into claim2 select public.claim_invitation((select doc ->> 'token' from couple),
    'Kemi Adeyemi', '+2348088888888', 'phone-3');
commit;

do $$ declare r record; begin
  select * into r from public.invite_claims where display_name = 'Kemi Adeyemi';
  assert r.slot = 2, 'the second claim of a couple''s link takes slot 2';
end $$;

-- The third claim is refused: the couple's link is full.
begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select doc ->> 'token' from couple), 'Bola Adeyemi', '+2348077777777'), 'invitation_claimed');
commit;

-- And the standard link is full after its one claim.
begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select doc ->> 'token' from inv), 'Bola Adeyemi', '+2348077777777'), 'invitation_claimed');
commit;

do $$ declare r record; begin
  select * into r from public.invitations where id = ((select doc from couple) ->> 'invitation_id')::uuid;
  assert r.status = 'claimed', 'a full link is marked claimed, got ' || r.status;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The guest's own card, read with the guest's own session
-- ---------------------------------------------------------------------------
do $$ declare r record; begin
  select * into r from public.my_claimed_card((select doc ->> 'guest_session' from claim1));
  assert r.event_title = 'Tunde & Ada''s wedding', 'the card names the celebration';
  assert r.display_name = 'Tunde Adeyemi', 'the card names the guest';
  assert r.admission_credential = (select doc ->> 'admission_credential' from claim1),
    'the card carries the credential the guest was given';
  assert r.status = 'issued', 'the card is issued';
end $$;

select pg_temp.expect_error(format('select public.my_claimed_card(%L)',
  'not-the-session-this-guest-was-given-at-all'), 'card_not_found');

-- ---------------------------------------------------------------------------
-- 5. Reissuing replaces the link, moves the generation on and kills the old claims
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  update inv set doc = public.reissue_invitation(
    ((select doc from inv) ->> 'invitation_id')::uuid, 1);
commit;

do $$ declare r record; begin
  select * into r from public.invitations where id = ((select doc from inv) ->> 'invitation_id')::uuid;
  assert r.generation = 2, 'the reissue is generation 2, got ' || r.generation;
  assert r.status = 'issued', 'a reissued link is open again';
  assert r.token_hash <> (select token from oldt), 'the reissued link is a different token';
end $$;

-- The old link no longer works.
begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select token from oldt), 'Late Comer', '+2348066666666'), 'invitation_not_found');
commit;

-- The old claim and its card are revoked, so the guest's card reads as revoked.
do $$ declare r record; begin
  select * into r from public.invite_claims where display_name = 'Tunde Adeyemi';
  assert r.status = 'revoked', 'the old claim is revoked';
  select * into r from public.admissions where claim_id = r.id;
  assert r.status = 'revoked', 'the old card is revoked';
  select * into r from public.my_claimed_card((select doc ->> 'guest_session' from claim1));
  assert r.admission_credential is null, 'a revoked card carries no credential';
  assert r.status = 'revoked', 'a revoked card reads as revoked';
end $$;

-- A stale version is refused.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  select pg_temp.expect_error(format('select public.reissue_invitation(%L, 1)',
    ((select doc from inv) ->> 'invitation_id')::uuid), 'stale_version');
commit;

-- Only the host may reissue.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-bob'), true);
  select pg_temp.expect_error(format('select public.reissue_invitation(%L, 2)',
    ((select doc from inv) ->> 'invitation_id')::uuid), 'forbidden');
commit;

-- ---------------------------------------------------------------------------
-- 6. Revoking kills the link for good
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  select public.revoke_invitation(((select doc from inv) ->> 'invitation_id')::uuid, 2);
commit;

begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select doc ->> 'token' from inv), 'Late Comer', '+2348066666666'), 'invitation_not_found');
commit;

do $$ declare r record; begin
  select * into r from public.invitations where id = ((select doc from inv) ->> 'invitation_id')::uuid;
  assert r.status = 'revoked', 'the invitation is revoked';
  assert r.revoked_at is not null and r.revoked_by = (select alice from ids),
    'the revocation names the host';
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-bob'), true);
  select pg_temp.expect_error(format('select public.revoke_invitation(%L, 3)',
    ((select doc from inv) ->> 'invitation_id')::uuid), 'forbidden');
commit;

-- ---------------------------------------------------------------------------
-- 7. The host reads their own invitations, and nobody else's
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  insert into cache select * from public.host_invitations((select id from l1));
commit;

do $$ declare n bigint; begin
  select count(*) into n from public.host_invitations((select id from l1));
  assert n = 2, 'the host sees both invitations, got ' || n;
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-bob'), true);
  select pg_temp.expect_error(format('select public.host_invitations(%L)', (select id from l1)), 'forbidden');
commit;

-- The host never sees a raw token, only a fingerprint of the stored hash.
do $$ declare r record; begin
  select * into r from public.host_invitations((select id from l1)) limit 1;
  assert length(r.token_fingerprint) = 8, 'the fingerprint is short';
  assert r.token_fingerprint <> (select doc ->> 'token' from inv), 'the fingerprint is not the token';
end $$;

-- ---------------------------------------------------------------------------
-- 8. A scanner grant: one device, one person, one list, until it is revoked
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  insert into grant1 select public.issue_scanner_grant((select id from l1), 'door-1',
    (select dee from ids), now() + interval '1 day');
  insert into grant2 select public.issue_scanner_grant((select id from l1), 'door-2',
    (select dee from ids), now() + interval '1 day');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-bob'), true);
  select pg_temp.expect_error(format('select public.issue_scanner_grant(%L, %L, %L, now() + interval ''1 day'')',
    (select id from l1), 'door-9', (select dee from ids)), 'forbidden');
commit;

-- The person holding the grant reads the cache; another person does not.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  insert into cache select * from public.scanner_admissions(
    (select doc ->> 'grant_id' from grant1), 'door-1');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  select pg_temp.expect_error(format('select public.scanner_admissions(%L, %L)',
    (select doc ->> 'grant_id' from grant1), 'door-1'), 'forbidden: scanner grant');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  select pg_temp.expect_error(format('select public.scanner_admissions(%L, %L)',
    (select doc ->> 'grant_id' from grant1), 'door-9'), 'forbidden: scanner device');
commit;

-- ---------------------------------------------------------------------------
-- 9. The cache is the admission minimum: a name, a state and an expiry
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from cache;
  assert n >= 1, 'the cache holds the couple''s claims, got ' || n;
end $$;

do $$ declare r record; begin
  select * into r from cache limit 1;
  assert r.display_name is not null, 'the cache names the guest';
  assert length(r.credential_hash) = 64, 'the cache holds the credential hash';
  assert r.expires_at is not null, 'the cache says when the card expires';
  assert r.cache_expires_at is not null, 'the cache says when it must be refreshed';
end $$;

-- The projection has no contact column at all, so a number cannot leak through it.
do $$ begin
  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'scanner_admissions'
                       and column_name in ('phone', 'address')),
    'the scanner cache declares no phone or address';
  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'scanner_admissions'
                       and column_name like '%payload%'),
    'the scanner cache declares no payload';
end $$;

-- ---------------------------------------------------------------------------
-- 10. The admission itself, and the duplicate an offline scanner cannot prevent
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  select pg_temp.expect_error(format('select public.record_checkin(%L, %L, %L, now(), %L)',
    (select doc ->> 'grant_id' from grant1),
    (select doc ->> 'admission_credential' from claim1), 'door-1', 'sideways'), 'invalid_checkin_mode');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  insert into checkin select public.record_checkin((select doc ->> 'grant_id' from grant1),
    (select doc ->> 'admission_credential' from claim1), 'door-1', now(), 'online');
commit;

do $$ declare r record; begin
  select * into r from public.checkins order by created_at desc limit 1;
  assert r.result = 'admitted', 'the guest was admitted, got ' || r.result;
  assert r.mode = 'online', 'the check-in was made online';
  assert r.device_id = 'door-1', 'the check-in names the device';
end $$;

do $$ declare r record; begin
  select * into r from public.admissions where claim_id = (select id from public.invite_claims
                                                           where display_name = 'Ada Adeyemi');
  assert r.status = 'issued', 'a different guest is untouched';
end $$;

-- A second device admitting the same guest is a duplicate, and it is kept.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  insert into checkin select public.record_checkin((select doc ->> 'grant_id' from grant2),
    (select doc ->> 'admission_credential' from claim1), 'door-2', now(), 'queued_offline');
commit;

do $$ declare r record; begin
  select * into r from public.checkins order by created_at desc limit 1;
  assert r.result = 'duplicate', 'the second admission is a duplicate, got ' || r.result;
  assert r.mode = 'queued_offline', 'the duplicate came from the offline queue';
end $$;

-- An unknown card is refused without saying anything about the list.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  insert into checkin select public.record_checkin((select doc ->> 'grant_id' from grant1),
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'door-1', now(), 'online');
commit;

do $$ declare r record; begin
  select * into r from public.checkins order by created_at desc limit 1;
  assert r.result = 'unknown', 'an unknown card is unknown, got ' || r.result;
  assert r.admission_id is null, 'an unknown card names no admission';
end $$;

-- An expired card is refused as expired, not as unknown.
update public.admissions a
   set expires_at = now() - interval '1 hour'
 where a.claim_id = (select id from public.invite_claims where display_name = 'Ada Adeyemi');

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  insert into checkin select public.record_checkin((select doc ->> 'grant_id' from grant1),
    (select doc ->> 'admission_credential' from claim2), 'door-1', now(), 'online');
commit;

do $$ declare r record; begin
  select * into r from public.checkins order by created_at desc limit 1;
  assert r.result = 'expired', 'an expired card is expired, got ' || r.result;
end $$;

-- An invitation whose claim deadline has passed is refused.
update public.invitations i
   set claim_deadline = now() - interval '1 hour'
 where i.id = ((select doc from couple) ->> 'invitation_id')::uuid;

begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.claim_invitation(%L, %L, %L, null)',
    (select doc ->> 'token' from couple), 'Late Comer', '+2348066666666'), 'invitation_expired');
commit;

-- ---------------------------------------------------------------------------
-- 11. The host reads the door's record; another host does not
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  insert into door select result, display_name, false, mode from public.host_checkins((select id from l1));
commit;

do $$ declare n bigint; begin
  select count(*) into n from door;
  assert n >= 4, 'the host sees the check-ins, got ' || n;
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-bob'), true);
  select pg_temp.expect_error(format('select public.host_checkins(%L)', (select id from l1)), 'forbidden');
commit;

-- ---------------------------------------------------------------------------
-- 12. A revoked grant stops the device at once
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  select public.revoke_scanner_grant((select doc ->> 'grant_id' from grant1), 1);
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-dee'), true);
  select pg_temp.expect_error(format('select public.scanner_admissions(%L, %L)',
    (select doc ->> 'grant_id' from grant1), 'door-1'), 'scanner_grant_revoked');
  select pg_temp.expect_error(format('select public.record_checkin(%L, %L, %L, now(), %L)',
    (select doc ->> 'grant_id' from grant1),
    (select doc ->> 'admission_credential' from claim1), 'door-1', 'online'), 'scanner_grant_revoked');
commit;

-- ---------------------------------------------------------------------------
-- 13. The tables are closed to clients, and the host's functions to everyone else
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['invitations', 'invite_claims', 'admissions', 'scanner_grants', 'checkins'] loop
    assert not has_table_privilege('anon', 'public.' || t, 'SELECT'),
      'anon must not read ' || t;
    assert not has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE'),
      'clients must not write ' || t;
  end loop;
end $$;

begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.host_invitations(%L)', (select id from l1)),
    'permission denied');
  select pg_temp.expect_error(format('select public.scanner_admissions(%L, %L)',
    (select doc ->> 'grant_id' from grant1), 'door-1'), 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 14. The host names the person at the door, and only a person who exists
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  insert into grantee select user_id, display_name from public.grantee_for_list(
    (select id from l1), '  Dee108@Example.Test  ');
commit;

do $$ declare r record; begin
  select * into r from grantee;
  assert r.user_id = (select dee from ids), 'the lookup finds the right person';
  assert r.display_name = 'Dee Okafor', 'the lookup carries the name, got ' || coalesce(r.display_name, 'null');
end $$;

-- A stranger, an unverified account and a suspended account are all refused.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-alice'), true);
  select pg_temp.expect_error(format('select public.grantee_for_list(%L, %L)',
    (select id from l1), 'nobody108@example.test'), 'grantee_not_found');
  select pg_temp.expect_error(format('select public.grantee_for_list(%L, %L)',
    (select id from l1), 'unverified108@example.test'), 'grantee_not_found');
  select pg_temp.expect_error(format('select public.grantee_for_list(%L, %L)',
    (select id from l1), 'suspended108@example.test'), 'grantee_not_found');
  select pg_temp.expect_error(format('select public.grantee_for_list(%L, %L)',
    (select id from l1), 'not-an-address'), 'invalid_email');
commit;

-- Another host cannot use their own list to look a person up.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f108-bob'), true);
  select pg_temp.expect_error(format('select public.grantee_for_list(%L, %L)',
    (select id from l1), 'dee108@example.test'), 'forbidden');
commit;

-- The lookup is closed to guests.
begin;
  set local role anon;
  select pg_temp.expect_error(format('select public.grantee_for_list(%L, %L)',
    (select id from l1), 'dee108@example.test'), 'permission denied');
commit;

\o
select 'F-108 ticketing tests passed' as result;
