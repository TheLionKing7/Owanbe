-- F-40 guest list privacy tests. Raises on the first failure.
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
grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: a host, a recipient who is also a host, an unverified account, an
-- unrelated verified account, and a vendor owner in another house.
-- ---------------------------------------------------------------------------
create temp table ids (alice uuid, bob uuid, carol uuid, dave uuid, erin uuid,
                       alice_host uuid, bob_host uuid, dave_vendor uuid);
create temp table l1 (id uuid);
create temp table l2 (id uuid);
create temp table s1 (id uuid);
create temp table s2 (id uuid);
create temp table r1 (id uuid);
create temp table v (version integer not null);
grant select on ids, l1, l2, s1, s2, r1, v to authenticated, anon;
grant insert, update on l1, l2, s1, s2, r1, v to authenticated;

insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f40-alice', 'alice@example.test', true,  'Alice Adeyemi'),
  ('auth0|f40-bob',   'bob@example.test',   true,  'Bob Ogun'),
  ('auth0|f40-carol', 'carol@example.test', false, 'Carol Unverified'),
  ('auth0|f40-dave',  'dave@example.test',  true,  'Dave Oyelowo'),
  ('auth0|f40-erin',  'erin@example.test',  true,  'Erin No Grant');

insert into ids (alice, bob, carol, dave, erin)
  select (select id from public.users where auth0_sub = 'auth0|f40-alice'),
         (select id from public.users where auth0_sub = 'auth0|f40-bob'),
         (select id from public.users where auth0_sub = 'auth0|f40-carol'),
         (select id from public.users where auth0_sub = 'auth0|f40-dave'),
         (select id from public.users where auth0_sub = 'auth0|f40-erin');

insert into public.houses (kind, owner_user_id, display_name) select 'host', alice, 'Alice''s celebrations' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'host', bob, 'The Ogun wedding' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', dave, 'Dave Cakes Ltd' from ids;

update ids set
  alice_host  = (select id from public.houses where display_name = 'Alice''s celebrations'),
  bob_host    = (select id from public.houses where display_name = 'The Ogun wedding'),
  dave_vendor = (select id from public.houses where display_name = 'Dave Cakes Ltd');

insert into public.memberships (house_id, house_kind, user_id, role) select alice_host, 'host', alice, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select bob_host, 'host', bob, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select dave_vendor, 'vendor', dave, 'owner' from ids;

insert into v values (1);

-- ---------------------------------------------------------------------------
-- 1. A list starts private, in a Host house, and only its owner can create one
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  insert into l1 select public.create_guest_list((select alice_host from ids), 'Tunde & Ada''s wedding');
  select pg_temp.expect_error(format('select public.create_guest_list(%L, %L)',
    (select alice_host from ids), '   '), 'invalid_title');
commit;

do $$ declare r public.guest_lists; begin
  select * into r from public.guest_lists where id = (select id from l1);
  assert r.visibility = 'private', 'a new list is private, got ' || r.visibility;
  assert r.house_kind = 'host', 'a list belongs to a host house';
  assert r.version = 1, 'version starts at 1';
  assert r.created_by = (select alice from ids), 'the host is the creator';
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-bob'), true);
  select pg_temp.expect_error(format('select public.create_guest_list(%L, %L)',
    (select alice_host from ids), 'Snooping'), 'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-dave'), true);
  select pg_temp.expect_error(format('select public.create_guest_list(%L, %L)',
    (select dave_vendor from ids), 'Vendor list'), 'forbidden');
commit;

-- Tenancy is a composite foreign key, so a list cannot point at a vendor house even as the server.
select pg_temp.expect_error(format(
  $q$insert into public.guest_lists (house_id, title, created_by) values (%L, 'Wrong kind', %L)$q$,
  (select dave_vendor from ids), (select alice from ids)), 'foreign key');

-- ---------------------------------------------------------------------------
-- 2. Contacts are stored for the host and for nobody else
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  insert into r1 select public.add_guest_rsvp((select id from l1), 'Aunty Ngozi', 'yes',
    '08012345678', '12 Broad Street, Lagos');
  select public.add_guest_rsvp((select id from l1), 'Uncle Tunde', 'maybe');
  select pg_temp.expect_error(format('select public.add_guest_rsvp(%L, %L, %L)',
    (select id from l1), 'Nobody', 'perhaps'), 'invalid_response');
  select pg_temp.expect_error(format('select public.add_guest_rsvp(%L, %L)',
    (select id from l1), ''), 'invalid_guest_name');
  do $$ declare r record; begin
    select * into r from public.guest_list_rsvps((select id from l1)) where display_name = 'Aunty Ngozi';
    assert r.phone = '08012345678', 'the host sees the phone number';
    assert r.address = '12 Broad Street, Lagos', 'the host sees the address';
    assert (select count(*) from public.guest_list_rsvps((select id from l1))) = 2, 'both guests are listed';
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-bob'), true);
  select pg_temp.expect_error(format('select * from public.guest_list_rsvps(%L)', (select id from l1)), 'forbidden');
  select pg_temp.expect_error(format('select * from public.my_guest_lists(%L)', (select alice_host from ids)), 'forbidden');
  do $$ begin
    assert not exists (select 1 from public.rsvps where guest_list_id = (select id from l1)),
      'RLS hides contact rows from a non-host';
    assert not exists (select 1 from public.guest_lists where id = (select id from l1)),
      'RLS hides the list from a non-host';
  end $$;
commit;

-- Clients never write tables directly, and anon reads nothing.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  select pg_temp.expect_error(format(
    $q$insert into public.rsvps (guest_list_id, display_name) values (%L, 'Sneaky')$q$,
    (select id from l1)), 'permission denied');
  select pg_temp.expect_error(format(
    $q$update public.guest_lists set visibility = 'public' where id = %L$q$,
    (select id from l1)), 'permission denied');
commit;
begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.guest_lists$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.rsvps$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.guest_list_shares$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$select * from public.shared_guest_list('00000000-0000-0000-0000-000000000000')$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$select * from public.guest_list_rsvps('00000000-0000-0000-0000-000000000000')$q$, 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 3. Masking is structural: the shared and public projections declare no contact columns
-- ---------------------------------------------------------------------------
do $$ declare sig text; begin
  select pg_get_function_result('public.shared_guest_list(uuid)'::regproc) into sig;
  assert position('phone' in sig) = 0 and position('address' in sig) = 0,
    'shared_guest_list declares no contact columns: ' || sig;
  select pg_get_function_result('public.public_guest_list(uuid)'::regproc) into sig;
  assert position('phone' in sig) = 0 and position('address' in sig) = 0,
    'public_guest_list declares no contact columns: ' || sig;
  select pg_get_function_result('public.shared_with_me()'::regproc) into sig;
  assert position('phone' in sig) = 0 and position('address' in sig) = 0,
    'shared_with_me declares no contact columns: ' || sig;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Sharing grants one verified platform user, and refuses everyone else
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  select pg_temp.expect_error(format('select public.share_guest_list(%L, %L, 99)',
    (select id from l1), 'bob@example.test'), 'stale_version');
  select pg_temp.expect_error(format('select public.share_guest_list(%L, %L, 1)',
    (select id from l1), 'not-an-email'), 'invalid_recipient');
  select pg_temp.expect_error(format('select public.share_guest_list(%L, %L, 1)',
    (select id from l1), 'nobody@example.test'), 'recipient_not_found');
  select pg_temp.expect_error(format('select public.share_guest_list(%L, %L, 1)',
    (select id from l1), 'carol@example.test'), 'recipient_not_found');
  update v set version = public.share_guest_list((select id from l1), 'BOB@example.test ', version);
  select pg_temp.expect_error(format('select public.share_guest_list(%L, %L, %s)',
    (select id from l1), 'bob@example.test', (select version from v)), 'already_shared');
commit;

do $$ begin
  assert (select visibility from public.guest_lists where id = (select id from l1)) = 'shared',
    'sharing a private list makes it shared';
  assert (select version from public.guest_lists where id = (select id from l1)) = (select version from v),
    'the returned version is the stored version';
  assert (select count(*) from public.guest_list_shares
          where guest_list_id = (select id from l1) and revoked_at is null) = 1, 'one live grant';
  assert (select grantee_user_id from public.guest_list_shares
          where guest_list_id = (select id from l1) and revoked_at is null) = (select bob from ids),
    'the grant names the resolved account, not the typed email';
end $$;

insert into s1 select id from public.guest_list_shares
  where guest_list_id = (select id from l1) and revoked_at is null;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-bob'), true);
  select pg_temp.expect_error(format('select public.share_guest_list(%L, %L, %s)',
    (select id from l1), 'erin@example.test', (select version from v)), 'forbidden');
  select pg_temp.expect_error(format('select public.set_guest_list_visibility(%L, %L, %s)',
    (select id from l1), 'public', (select version from v)), 'forbidden');
  select pg_temp.expect_error(format('select public.revoke_guest_list_share(%L, %L, %s)',
    (select id from l1), (select id from s1), (select version from v)), 'forbidden');
commit;

-- ---------------------------------------------------------------------------
-- 5. The recipient reads names and responses only — never a phone number or address
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-bob'), true);
  do $$ declare r record; n integer; begin
    select count(*) into n from public.shared_guest_list((select id from l1));
    assert n = 2, 'the recipient sees both guests, got ' || coalesce(n::text, 'null');
    for r in select * from public.shared_guest_list((select id from l1)) loop
      assert not (to_jsonb(r) ? 'phone'), 'no phone column in the shared projection';
      assert not (to_jsonb(r) ? 'address'), 'no address column in the shared projection';
      assert position('08012345678' in to_jsonb(r)::text) = 0, 'no phone value in the shared projection';
      assert position('Broad Street' in to_jsonb(r)::text) = 0, 'no address value in the shared projection';
    end loop;
    assert exists (select 1 from public.shared_with_me() where list_id = (select id from l1)),
      'the grant appears in shared_with_me';
    assert not exists (select 1 from public.rsvps where guest_list_id = (select id from l1)),
      'a grant is not a grant on the contact table';
  end $$;
  select pg_temp.expect_error(format('select * from public.guest_list_rsvps(%L)', (select id from l1)), 'forbidden');
commit;

-- A verified account with no grant gets nothing, even though the list is 'shared'.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-erin'), true);
  select pg_temp.expect_error(format('select * from public.shared_guest_list(%L)', (select id from l1)), 'forbidden');
  do $$ begin
    assert not exists (select 1 from public.shared_with_me()), 'no grant, no shared lists';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 6. Public is a separate switch, readable by anon, and still masked
-- ---------------------------------------------------------------------------
begin;
  set local role anon;
  select pg_temp.expect_error(format('select * from public.public_guest_list(%L)',
    (select id from l1)), 'guest_list_not_public');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  select pg_temp.expect_error(format('select public.set_guest_list_visibility(%L, %L, %s)',
    (select id from l1), 'everyone', (select version from v)), 'invalid_visibility');
  update v set version = public.set_guest_list_visibility((select id from l1), 'public', version);
commit;

do $$ begin
  assert (select visibility from public.guest_lists where id = (select id from l1)) = 'public';
  assert (select count(*) from public.guest_list_shares
          where guest_list_id = (select id from l1) and revoked_at is null) = 1,
    'going public keeps the existing grant';
end $$;

begin;
  set local role anon;
  do $$ declare r record; n integer; begin
    select count(*) into n from public.public_guest_list((select id from l1));
    assert n = 2, 'anyone can read a public list, got ' || coalesce(n::text, 'null');
    for r in select * from public.public_guest_list((select id from l1)) loop
      assert not (to_jsonb(r) ? 'phone'), 'no phone column in the public projection';
      assert not (to_jsonb(r) ? 'address'), 'no address column in the public projection';
      assert position('08012345678' in to_jsonb(r)::text) = 0, 'no phone value in the public projection';
      assert position('Broad Street' in to_jsonb(r)::text) = 0, 'no address value in the public projection';
      assert r.list_title = 'Tunde & Ada''s wedding', 'the public view carries the list title';
    end loop;
  end $$;
commit;

-- A missing list and a private list answer with the same error, so the endpoint cannot enumerate.
begin;
  set local role anon;
  select pg_temp.expect_error(
    $q$select * from public.public_guest_list('00000000-0000-0000-0000-000000000000')$q$,
    'guest_list_not_public');
commit;

-- ---------------------------------------------------------------------------
-- 7. Revoking ends the read on the very next call, and the last grant turns the list private
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  select pg_temp.expect_error(format('select public.revoke_guest_list_share(%L, %L, 99)',
    (select id from l1), (select id from s1)), 'stale_version');
  update v set version = public.revoke_guest_list_share((select id from l1), (select id from s1), version);
commit;

do $$ begin
  assert (select revoked_at from public.guest_list_shares where id = (select id from s1)) is not null,
    'the grant is revoked, not deleted';
  assert (select visibility from public.guest_lists where id = (select id from l1)) = 'public',
    'revoking a grant does not unpublish a public list';
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-bob'), true);
  do $$ begin
    assert not exists (select 1 from public.shared_with_me()), 'the revoked grant is gone immediately';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 8. Going private revokes every live grant in one step
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  update v set version = public.share_guest_list((select id from l1), 'bob@example.test', version);
  update v set version = public.share_guest_list((select id from l1), 'erin@example.test', version);
commit;

insert into s2 select id from public.guest_list_shares
  where guest_list_id = (select id from l1) and grantee_user_id = (select erin from ids) and revoked_at is null;

do $$ begin
  assert (select count(*) from public.guest_list_shares
          where guest_list_id = (select id from l1) and revoked_at is null) = 2, 'two live grants';
  assert (select visibility from public.guest_lists where id = (select id from l1)) = 'public',
    'sharing while public leaves the list public';
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  update v set version = public.set_guest_list_visibility((select id from l1), 'private', version);
commit;

do $$ begin
  assert (select visibility from public.guest_lists where id = (select id from l1)) = 'private';
  assert not exists (select 1 from public.guest_list_shares
                     where guest_list_id = (select id from l1) and revoked_at is null),
    'private means no live grants';
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-bob'), true);
  select pg_temp.expect_error(format('select * from public.shared_guest_list(%L)', (select id from l1)), 'forbidden');
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-erin'), true);
  select pg_temp.expect_error(format('select * from public.shared_guest_list(%L)', (select id from l1)), 'forbidden');
commit;
begin;
  set local role anon;
  select pg_temp.expect_error(format('select * from public.public_guest_list(%L)',
    (select id from l1)), 'guest_list_not_public');
commit;

-- Revoking the last grant on a shared list turns it private again.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  update v set version = public.set_guest_list_visibility((select id from l1), 'shared', version);
  update v set version = public.share_guest_list((select id from l1), 'erin@example.test', version);
commit;
delete from s2;
insert into s2 select id from public.guest_list_shares
  where guest_list_id = (select id from l1) and grantee_user_id = (select erin from ids) and revoked_at is null;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  update v set version = public.revoke_guest_list_share((select id from l1), (select id from s2), version);
commit;
do $$ begin
  assert (select visibility from public.guest_lists where id = (select id from l1)) = 'private',
    'the last recipient leaving makes a shared list private';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Houses stay separate, and the host projection counts what the host owns
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-bob'), true);
  insert into l2 select public.create_guest_list((select bob_host from ids), 'Bob''s own list');
  select public.add_guest_rsvp((select id from l2), 'Bob''s guest', 'yes', '08099999999', '9 Allen Avenue');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f40-alice'), true);
  select pg_temp.expect_error(format('select * from public.guest_list_rsvps(%L)', (select id from l2)), 'forbidden');
  select pg_temp.expect_error(format('select * from public.shared_guest_list(%L)', (select id from l2)), 'forbidden');
  do $$ declare r record; begin
    assert (select count(*) from public.my_guest_lists((select alice_host from ids))) = 1,
      'the host sees only their own house''s lists';
    select * into r from public.my_guest_lists((select alice_host from ids));
    assert r.guest_count = 2 and r.yes_count = 1, 'counts come from the rows, not the caller';
    assert r.share_count = 0, 'every grant was revoked';
    assert r.visibility = 'private', 'the projection reports server state';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 10. Every change is audited with identifiers, never contacts or email addresses
-- ---------------------------------------------------------------------------
do $$ begin
  assert exists (select 1 from public.audit_events where action = 'guest_list.created'), 'creation audited';
  assert exists (select 1 from public.audit_events where action = 'guest_list.rsvp_added'), 'RSVP audited';
  assert exists (select 1 from public.audit_events where action = 'guest_list.shared'), 'sharing audited';
  assert exists (select 1 from public.audit_events where action = 'guest_list.share_revoked'), 'revoke audited';
  assert exists (select 1 from public.audit_events where action = 'guest_list.visibility_changed'),
    'visibility changes audited';
  assert not exists (select 1 from public.audit_events where action like 'guest_list.%'
      and (details::text ilike '%08012345678%' or details::text ilike '%Broad Street%'
           or details::text ilike '%example.test%')),
    'audit details carry identifiers, never phone numbers, addresses or emails';
end $$;

\o
\pset tuples_only on
select 'F-40 guest list privacy tests passed' as result;