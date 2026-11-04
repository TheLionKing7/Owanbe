-- F-77 data model tests. Raises on the first failure.
\set ON_ERROR_STOP on
\o /dev/null
select app_private.configure_auth0('owanbe.us.auth0.com', 'https://api.owanbe.app');

create function pg_temp.claims(sub text, name text default null) returns text language sql as $$
  select jsonb_build_object('sub', sub, 'iss', 'https://owanbe.us.auth0.com/', 'aud', 'https://api.owanbe.app',
    'role', 'authenticated', 'exp', extract(epoch from now())::bigint + 3600, 'name', name)::text
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

-- 1. Admission provisions exactly one Host house with an owner membership (idempotent, audited)
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-alice', 'Alice Adeyemi'), true);
  select public.ensure_user(); select public.ensure_user();
  do $$ begin
    assert (select count(*) from public.my_houses()) = 1, 'one house';
    assert (select display_name from public.my_houses()) = 'Alice''s celebrations';
    assert (select role from public.my_houses()) = 'owner';
    assert (select count(*) from public.houses) = 1, 'alice reads her house';
  end $$;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-bob'), true);
  select public.ensure_user();
  do $$ begin
    assert (select display_name from public.my_houses()) = 'My celebrations';
    assert (select count(*) from public.houses) = 1, 'bob sees only his own house';
    assert (select count(*) from public.memberships) = 1, 'bob sees only his own membership';
  end $$;
commit;
do $$ begin
  assert (select count(*) from public.audit_events a join public.users u on u.id = a.actor_user_id
          where a.action = 'house.created' and u.auth0_sub like 'auth0|f77-%') = 2, 'house creation audited';
end $$;

-- fixtures (as the server)
create temp table ids as
  select (select id from public.users where auth0_sub = 'auth0|f77-alice') alice,
         (select id from public.users where auth0_sub = 'auth0|f77-bob') bob,
         (select h.id from public.houses h join public.users u on u.id = h.owner_user_id
            where u.auth0_sub = 'auth0|f77-alice' and h.kind = 'host') alice_host;
grant select on ids to authenticated;
insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', alice, 'Alice Events Ltd' from ids;
alter table ids add column alice_vendor uuid;
update ids set alice_vendor = (select id from public.houses where kind = 'vendor' and owner_user_id = ids.alice);
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select alice_vendor, 'vendor', alice, 'owner', array['chat','quotes','payouts','members','billing'] from ids;

-- 2. Composite and business constraints
select pg_temp.expect_error($q$insert into public.memberships (house_id, house_kind, user_id, role)
  select alice_host, 'host', bob, 'staff' from ids$q$, 'host_houses_owner_only');
select pg_temp.expect_error($q$insert into public.memberships (house_id, house_kind, user_id, role)
  select alice_host, 'vendor', bob, 'staff' from ids$q$, 'foreign key');
select pg_temp.expect_error($q$insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select alice_vendor, 'vendor', bob, 'staff', array['chat','payouts'] from ids$q$, 'staff_not_owner_capabilities');
select pg_temp.expect_error($q$insert into public.memberships (house_id, house_kind, user_id, role)
  select alice_vendor, 'vendor', bob, 'owner' from ids$q$, 'memberships_one_owner');
select pg_temp.expect_error($q$insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select alice_vendor, 'vendor', bob, 'staff', array['dance'] from ids$q$, 'capabilities_check');
select pg_temp.expect_error($q$insert into public.houses (kind, owner_user_id, display_name)
  select 'host', alice, 'Second host house' from ids$q$, 'houses_owner_user_id_kind_key');
select pg_temp.expect_error($q$insert into public.houses (kind, owner_user_id, display_name)
  select 'planner', alice, 'x' from ids$q$, 'houses_kind_check');

-- 3. Vendor staff membership: visible to the staff member only while active
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select alice_vendor, 'vendor', bob, 'staff', array['chat','quotes'] from ids;
select pg_temp.expect_error($q$insert into public.memberships (house_id, house_kind, user_id, role)
  select alice_vendor, 'vendor', bob, 'staff' from ids$q$, 'memberships_active_unique');
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-bob'), true);
  do $$ begin
    assert (select count(*) from public.my_houses()) = 2, 'bob: host + vendor (staff)';
    assert (select role from public.my_houses() where kind = 'vendor') = 'staff';
    assert (select count(*) from public.houses) = 2, 'bob reads both houses he belongs to';
    assert not exists (select 1 from public.houses where kind = 'host' and display_name like 'Alice%'),
      'bob cannot read alice''s host house';
  end $$;
commit;
select pg_temp.expect_error($q$update public.memberships set revoked_at = now()
  where user_id = (select bob from ids) and role = 'staff'$q$, 'revocation_attributed');
update public.memberships set revoked_at = now(), revoked_by = (select alice from ids)
  where user_id = (select bob from ids) and role = 'staff';
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-bob'), true);
  do $$ begin
    assert (select count(*) from public.my_houses()) = 1, 'revoked staff loses the vendor house at once';
    assert (select count(*) from public.houses) = 1;
  end $$;
commit;

-- 4. Staff grants and assignments
select pg_temp.expect_error($q$insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select bob, 'support', 'case', bob from ids$q$, 'grant_not_self');
select pg_temp.expect_error($q$insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select bob, 'event_manager', 'global', alice from ids$q$, 'event_manager_scoped');
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select bob, 'event_manager', 'event', alice from ids;
insert into public.staff_grants (user_id, capability, scope_kind, granted_by, expires_at)
  select bob, 'support', 'case', alice, now() + interval '1 second' from ids;
select pg_temp.expect_error($q$insert into public.assignments (staff_grant_id, target_kind, target_id, assigned_by)
  select g.id, 'case', gen_random_uuid(), ids.alice from public.staff_grants g, ids
  where g.capability = 'event_manager'$q$, 'foreign key');
insert into public.assignments (staff_grant_id, target_kind, target_id, assigned_by)
  select g.id, 'event', gen_random_uuid(), ids.alice from public.staff_grants g, ids where g.capability = 'event_manager';
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-bob'), true);
  do $$ begin
    assert (select count(*) from public.staff_grants) = 2, 'bob sees his active grants';
    assert (select count(*) from public.assignments) = 1, 'bob sees his assignment';
  end $$;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-alice'), true);
  do $$ begin
    assert (select count(*) from public.staff_grants) = 0, 'alice cannot see bob''s grants';
    assert (select count(*) from public.assignments) = 0, 'alice cannot see bob''s assignments';
  end $$;
commit;
select pg_sleep(1.1);
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-bob'), true);
  do $$ begin assert (select count(*) from public.staff_grants) = 1, 'expired grant is hidden'; end $$;
commit;
update public.staff_grants set revoked_at = now() where capability = 'event_manager';
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-bob'), true);
  do $$ begin assert (select count(*) from public.assignments) = 0, 'revoked grant hides its assignments'; end $$;
commit;

-- 5. No direct client writes; audit log is append-only and private
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f77-alice'), true);
  select pg_temp.expect_error($q$insert into public.houses (kind, owner_user_id, display_name) select 'vendor', bob, 'x' from ids$q$, 'permission denied');
  select pg_temp.expect_error($q$update public.houses set display_name = 'x'$q$, 'permission denied');
  select pg_temp.expect_error($q$delete from public.memberships$q$, 'permission denied');
  select pg_temp.expect_error($q$insert into public.staff_grants (user_id, capability, scope_kind, granted_by) select alice, 'finance', 'global', bob from ids$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.audit_events$q$, 'permission denied');
rollback;
select pg_temp.expect_error($q$update public.audit_events set action = 'x.y'$q$, 'append-only');
select pg_temp.expect_error($q$delete from public.audit_events$q$, 'append-only');

-- 6. version / updated_at / created_at behaviour
do $$ declare before public.houses; after public.houses; begin
  select * into before from public.houses where kind = 'vendor';
  update public.houses set display_name = 'Alice Events', created_at = now() - interval '1 year' where id = before.id;
  select * into after from public.houses where id = before.id;
  assert after.version = before.version + 1, 'version bumps';
  assert after.created_at = before.created_at, 'created_at is immutable';
  assert after.updated_at >= before.updated_at, 'updated_at moves forward';
end $$;

\o
\pset tuples_only on
select 'F-77 data model tests passed' as result;
