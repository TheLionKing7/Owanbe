-- F-7 onboarding tests. Raises on the first failure.
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

-- 1. A host: nothing until started; contact then intent; completion is checked by the server.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f7-ada', 'Ada'), true);
  select public.ensure_user();
  do $$ begin
    assert (select count(*) from public.my_onboarding()) = 0, 'no row before onboarding starts';
  end $$;
  select pg_temp.expect_error($q$select public.complete_onboarding()$q$, 'onboarding_not_started');
  select pg_temp.expect_error($q$select public.save_onboarding('planner')$q$, 'invalid_role');
  select pg_temp.expect_error($q$select public.save_onboarding('host', p_phone => '0801234')$q$, 'onboarding_profiles_phone_e164_check');
  select pg_temp.expect_error($q$select public.save_onboarding('host', p_event_date => current_date - 1)$q$, 'event_date_in_past');

  select public.save_onboarding('host', 'Ada Okafor', '+2348012345678', 'Lagos');
  select pg_temp.expect_error($q$select public.complete_onboarding()$q$, 'onboarding_incomplete:intent');
  select public.save_onboarding('host', p_host_intent => 'hosting', p_event_type => 'Wedding', p_event_date => current_date + 60);
  do $$ begin
    assert (select display_name from public.my_onboarding()) = 'Ada Okafor', 'name saved on the user';
    assert (select phone_e164 from public.my_onboarding()) = '+2348012345678', 'earlier fields kept';
    assert (select host_intent from public.my_onboarding()) = 'hosting';
    assert (select completed_at from public.my_onboarding()) is null;
  end $$;
  select public.complete_onboarding();
  select public.complete_onboarding(); -- idempotent
  do $$ begin
    assert (select completed_at from public.my_onboarding()) is not null, 'completed';
  end $$;
  select pg_temp.expect_error($q$select public.save_onboarding('vendor')$q$, 'role_locked');
  -- Clients can't read or write the table directly.
  select pg_temp.expect_error($q$select * from public.onboarding_profiles$q$, 'permission denied');
  select pg_temp.expect_error($q$update public.onboarding_profiles set phone_verified = true$q$, 'permission denied');
commit;

do $$ begin
  assert (select count(*) from public.audit_events a join public.users u on u.id = a.actor_user_id
          where a.action = 'onboarding.completed' and u.auth0_sub = 'auth0|f7-ada') = 1, 'completion audited once';
  assert (select count(*) from public.audit_events a join public.users u on u.id = a.actor_user_id
          where u.auth0_sub = 'auth0|f7-ada' and a.details::text like '%2348012345678%') = 0, 'no phone in the audit log';
end $$;

-- 2. A vendor needs a business category and a Vendor house; another user sees none of it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f7-bayo', 'Bayo'), true);
  select public.ensure_user();
  select public.save_onboarding('vendor', 'Bayo Events', '+447700900123', 'London', p_business_category => 'Caterers');
  select pg_temp.expect_error($q$select public.complete_onboarding()$q$, 'onboarding_incomplete:business');
commit;
insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', id, 'Bayo Events Ltd' from public.users where auth0_sub = 'auth0|f7-bayo';
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f7-bayo', 'Bayo'), true);
  do $$ begin
    assert (select has_vendor_house from public.my_onboarding()), 'vendor house seen';
  end $$;
  select public.complete_onboarding();
  -- A new number resets verification.
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f7-ada', 'Ada'), true);
  do $$ begin
    assert (select count(*) from public.my_onboarding()) = 1, 'Ada sees only her own row';
    assert (select role from public.my_onboarding()) = 'host';
  end $$;
commit;
update public.onboarding_profiles set phone_verified = true
  where user_id = (select id from public.users where auth0_sub = 'auth0|f7-bayo');
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f7-bayo', 'Bayo'), true);
  select public.save_onboarding('vendor', p_phone => '+447700900124');
  do $$ begin
    assert not (select phone_verified from public.my_onboarding()), 'changed phone is unverified';
  end $$;
commit;

-- 3. Signed-out callers get nothing.
begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.my_onboarding()$q$, 'permission denied');
commit;

\o
\pset tuples_only on
select 'F-7 onboarding tests passed' as result;
