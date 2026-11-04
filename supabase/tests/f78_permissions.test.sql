-- F-78 permission scoping tests. Raises on the first failure.
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

-- Fixtures: owner Ada (vendor house), staff Bisi, outsider Chidi, support agent Dayo, manager Efe
do $$
declare s text;
begin
  foreach s in array array['auth0|f78-ada','auth0|f78-bisi','auth0|f78-chidi','auth0|f78-dayo','auth0|f78-efe','auth0|f78-root'] loop
    insert into public.users (auth0_sub) values (s);
  end loop;
end $$;
create temp table f as select
  (select id from public.users where auth0_sub='auth0|f78-ada') ada,
  (select id from public.users where auth0_sub='auth0|f78-bisi') bisi,
  (select id from public.users where auth0_sub='auth0|f78-dayo') dayo,
  (select id from public.users where auth0_sub='auth0|f78-efe') efe,
  (select id from public.users where auth0_sub='auth0|f78-root') root,
  gen_random_uuid() event_a, gen_random_uuid() event_b;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', ada, 'Ada Catering' from f;
alter table f add column house uuid;
update f set house = (select id from public.houses where display_name = 'Ada Catering');
insert into public.memberships (house_id, house_kind, user_id, role) select house, 'vendor', ada, 'owner' from f;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select house, 'vendor', bisi, 'staff', array['chat','quotes'] from f;
alter table f add column bisi_m uuid;
update f set bisi_m = (select id from public.memberships where user_id = f.bisi);
insert into public.staff_grants (user_id, capability, scope_kind, granted_by) select dayo, 'support', 'global', root from f;
insert into public.staff_grants (user_id, capability, scope_kind, granted_by) select efe, 'event_manager', 'event', root from f;
insert into public.assignments (staff_grant_id, target_kind, target_id, assigned_by)
  select g.id, 'event', f.event_a, f.root from public.staff_grants g, f where g.capability = 'event_manager';
grant select on f to authenticated;

-- 1. Role matrix: owner has every capability; staff only what was granted, never owner-only
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-ada'), true);
  do $$ begin
    assert public.house_can((select house from f), 'payouts'), 'owner: payouts';
    assert public.house_can((select house from f), 'members'), 'owner: members';
    assert not public.house_can((select house from f), 'dance'), 'unknown capability denied';
  end $$;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-bisi'), true);
  do $$ begin
    assert public.house_can((select house from f), 'quotes'), 'staff: granted quotes';
    assert not public.house_can((select house from f), 'calendar'), 'staff: ungranted calendar';
    assert not public.house_can((select house from f), 'payouts'), 'staff: never payouts';
    assert not public.house_can((select house from f), 'members'), 'staff: never members';
    assert not public.house_can((select house from f), 'billing'), 'staff: never billing';
  end $$;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-chidi'), true);
  do $$ begin
    assert not public.house_can((select house from f), 'chat'), 'outsider: nothing';
  end $$;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-dayo'), true);
  do $$ begin
    assert not public.house_can((select house from f), 'chat'), 'support has no house capability';
  end $$;
commit;

-- 2. Vendor staff cannot administer members
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-bisi'), true);
  select pg_temp.expect_error($q$select public.set_member_capabilities((select bisi_m from f), array['chat','quotes','calendar'])$q$, 'forbidden');
  select pg_temp.expect_error($q$select public.revoke_member((select bisi_m from f))$q$, 'forbidden');
rollback;

-- 3. Owner administers staff, but can never hand out owner-only capabilities
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-ada'), true);
  select pg_temp.expect_error($q$select public.set_member_capabilities((select bisi_m from f), array['chat','payouts'])$q$, 'staff cannot hold');
  select public.set_member_capabilities((select bisi_m from f), array['chat','quotes','calendar']);
commit;
do $$ begin
  assert (select capabilities from public.memberships where id = (select bisi_m from f)) = array['chat','quotes','calendar'];
  assert exists (select 1 from public.audit_events where action = 'membership.capabilities_changed' and target_id = (select bisi_m from f)),
    'capability change audited';
end $$;

-- 4. Support sensitive reads require a purpose and are logged
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-dayo'), true);
  select pg_temp.expect_error($q$select * from public.support_house_members((select house from f), 'x')$q$, 'purpose_required');
  do $$ begin
    assert (select count(*) from public.support_house_members((select house from f), 'Ticket 4411: vendor login issue')) = 2;
  end $$;
commit;
do $$ begin
  assert (select count(*) from public.audit_events where action = 'sensitive.read'
          and actor_user_id = (select dayo from f) and purpose = 'Ticket 4411: vendor login issue') = 1,
    'support read logged with purpose';
end $$;

-- 5. Non-support users cannot use the support read path
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-ada'), true);
  select pg_temp.expect_error($q$select * from public.support_house_members((select house from f), 'Looking at my own team')$q$, 'forbidden');
rollback;

-- 6. Event managers read only assigned events, and those reads are logged
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-efe'), true);
  select public.authorize_sensitive_read('event_manager', 'event', (select event_a from f), 'Day-of run sheet check');
  select pg_temp.expect_error($q$select public.authorize_sensitive_read('event_manager', 'event', (select event_b from f), 'Day-of run sheet check')$q$, 'forbidden');
commit;
do $$ begin
  assert (select count(*) from public.audit_events where action = 'sensitive.read' and actor_user_id = (select efe from f)) = 1,
    'manager read logged once';
end $$;

-- 7. Revoked staff lose access immediately
update public.memberships set revoked_at = now(), revoked_by = (select ada from f) where id = (select bisi_m from f);
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f78-bisi'), true);
  do $$ begin assert not public.house_can((select house from f), 'chat'), 'revoked staff denied'; end $$;
commit;

\o
\echo F-78 permission tests passed
