-- F-76 database tests. Each block raises on failure; the runner stops at the first error.
\set ON_ERROR_STOP on
\o /dev/null
select app_private.configure_auth0('owanbe.us.auth0.com', 'https://api.owanbe.app');

create function pg_temp.claims(sub text, iss text default 'https://owanbe.us.auth0.com/',
  aud jsonb default '["https://api.owanbe.app","https://owanbe.us.auth0.com/userinfo"]',
  exp_in int default 3600, extra jsonb default '{}') returns text language sql as $$
  select (jsonb_build_object('sub', sub, 'iss', iss, 'aud', aud, 'role', 'authenticated',
    'exp', extract(epoch from now())::bigint + exp_in) || extra)::text
$$;

-- helper: expect a call to fail with a message fragment
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

-- 1. Valid token creates exactly one user, idempotently
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|alice', extra => '{"email":"alice@example.com","email_verified":true}'), true);
  do $$ declare a public.users; b public.users; begin
    a := public.ensure_user(); b := public.ensure_user();
    assert a.id = b.id, 'same subject must map to the same user';
    assert a.email = 'alice@example.com' and b.email_verified, 'claims copied';
    assert (select count(*) from public.users) = 1, 'RLS: alice sees only herself';
  end $$;
commit;

-- 2. Different subject → different user; cannot read alice
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('google-oauth2|bob'), true);
  do $$ declare b public.users; begin
    b := public.ensure_user();
    assert (select count(*) from public.users) = 1, 'bob sees only his own row';
    assert (select auth0_sub from public.users) = 'google-oauth2|bob';
  end $$;
commit;
do $$ begin assert (select count(*) from public.users) = 2; end $$;

-- 3. Token checks: issuer, audience, expiry, subject
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|eve', iss => 'https://evil.auth0.com/'), true);
  select pg_temp.expect_error('select public.ensure_user()', 'invalid_token: issuer');
  select set_config('request.jwt.claims', pg_temp.claims('auth0|eve', aud => '"https://other.api"'), true);
  select pg_temp.expect_error('select public.ensure_user()', 'invalid_token: audience');
  select set_config('request.jwt.claims', pg_temp.claims('auth0|eve', aud => '["x","y"]'), true);
  select pg_temp.expect_error('select public.ensure_user()', 'invalid_token: audience');
  select set_config('request.jwt.claims', pg_temp.claims('auth0|eve', exp_in => -5), true);
  select pg_temp.expect_error('select public.ensure_user()', 'invalid_token: expired');
  select set_config('request.jwt.claims', '{"iss":"https://owanbe.us.auth0.com/","aud":"https://api.owanbe.app","exp":99999999999}', true);
  select pg_temp.expect_error('select public.ensure_user()', 'missing subject');
  select set_config('request.jwt.claims', pg_temp.claims('auth0|eve', aud => '"https://api.owanbe.app"'), true);
  do $$ begin perform public.ensure_user(); end $$; -- string audience accepted
rollback;

-- 4. Session status: suspended account is refused and nothing is updated
update public.users set status = 'suspended' where auth0_sub = 'google-oauth2|bob';
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('google-oauth2|bob'), true);
  select pg_temp.expect_error('select public.ensure_user()', 'account_suspended');
commit;

-- 5. No direct writes; anon has no access
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|alice'), true);
  select pg_temp.expect_error($q$update public.users set status = 'active'$q$, 'permission denied');
  select pg_temp.expect_error($q$insert into public.users (auth0_sub) values ('auth0|mallory')$q$, 'permission denied');
  select pg_temp.expect_error('select app_private.configure_auth0(''x'', ''y'')', 'permission denied');
rollback;
begin;
  set local role anon;
  select pg_temp.expect_error('select public.ensure_user()', 'permission denied');
  select pg_temp.expect_error('select * from public.users', 'permission denied');
rollback;

-- 6. Unique mapping is enforced by the database
select pg_temp.expect_error($q$insert into public.users (auth0_sub) values ('auth0|alice')$q$, 'duplicate key');

-- 7. Fail closed when Auth0 settings are missing
begin;
  delete from app_private.auth_settings;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|alice'), true);
  select pg_temp.expect_error('select public.ensure_user()', 'auth_not_configured');
rollback;

\o
\pset tuples_only on
select 'F-76 database tests passed' as result;
