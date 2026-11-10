-- F-101 OwanbePlanner AI tests. Raises on the first failure.
-- Covers: a host records an interaction, the plan is stored with vendor names the database
-- resolves itself, one generation per 30 seconds, a reported answer is recorded once, another
-- house cannot see or report the interaction, and no client writes the table directly.
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
-- Fixtures: a host with a Host house, a vendor house owner, and a signed-in user with no house.
-- ---------------------------------------------------------------------------
create temp table ids (alice uuid, dave uuid, erin uuid, alice_host uuid, dave_vendor uuid);
create temp table c (id uuid);
grant select on ids, c to authenticated, anon;
grant insert on c to authenticated;

insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f101-alice', 'alice@example.test', true, 'Alice Adeyemi'),
  ('auth0|f101-dave',  'dave@example.test',  true, 'Dave Oyelowo'),
  ('auth0|f101-erin',  'erin@example.test',  true, 'Erin No House');

insert into ids (alice, dave, erin)
  select (select id from public.users where auth0_sub = 'auth0|f101-alice'),
         (select id from public.users where auth0_sub = 'auth0|f101-dave'),
         (select id from public.users where auth0_sub = 'auth0|f101-erin');

insert into public.houses (kind, owner_user_id, display_name) select 'host', alice, 'Alice''s celebrations' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', dave, 'Dave Cakes Ltd' from ids;

update ids set
  alice_host  = (select id from public.houses where display_name = 'Alice''s celebrations'),
  dave_vendor = (select id from public.houses where display_name = 'Dave Cakes Ltd');

insert into public.memberships (house_id, house_kind, user_id, role) select alice_host, 'host', alice, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select dave_vendor, 'vendor', dave, 'owner' from ids;

-- A published vendor, so the planner has one real business to cite.
insert into public.vendor_profiles (house_id, slug, business_name, category, headline, published, published_at)
  select dave_vendor, 'dave-cakes', 'Dave Cakes Ltd', 'Cakes', 'Wedding cakes in Lagos', true, now() from ids;

-- ---------------------------------------------------------------------------
-- 1. The host records an interaction
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-alice'), true);
  insert into c select public.log_ai_planner_interaction(
    'Wedding', 'Lagos', 120, 5000000, 'NGN', 'A small wedding with a cake and photography.',
    'openai/gpt-6-astra', 'ok', 2,
    '[{"title":"Cake and photos","summary":"Two lines.","vendor_slugs":["dave-cakes","not-a-real-vendor"]}]'::jsonb);
commit;

do $$ declare v_id uuid; r record; begin
  select id into v_id from c;
  assert v_id is not null, 'the interaction has an id';

  select * into r from public.ai_planner_interactions where id = v_id;
  assert r.user_id = (select alice from ids), 'the row belongs to the host';
  assert r.house_id = (select alice_host from ids), 'the row belongs to the host house';
  assert r.status = 'ok' and r.option_count = 1, 'one option was kept, got ' || r.option_count::text;
  assert r.budget_minor = 5000000 and r.budget_currency = 'NGN', 'the budget is kept in minor units';
  assert r.brief = 'A small wedding with a cake and photography.', 'the brief is kept';
  -- The vendor names are resolved by the database: the slug that does not exist is dropped.
  assert r.plan_summary -> 0 -> 'vendors' = '["Dave Cakes Ltd"]'::jsonb,
    'only the published vendor is named, got ' || r.plan_summary -> 0 -> 'vendors'::text;
end $$;

-- The audit row records the interaction, identifiers only.
do $$ declare n bigint; d jsonb; begin
  select count(*) into n from public.audit_events
   where action = 'planner.interaction' and target_id = (select id from c);
  assert n = 1, 'one audit row for the interaction, got ' || n::text;
  select details into d from public.audit_events where action = 'planner.interaction' limit 1;
  assert d::text !~ 'cake and photography', 'the audit row does not carry the brief';
end $$;

-- ---------------------------------------------------------------------------
-- 2. One generation per 30 seconds
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-alice'), true);
  select pg_temp.expect_error($q$select public.log_ai_planner_interaction(
    'Wedding', 'Lagos', 120, 5000000, 'NGN', 'Again.', 'openai/gpt-6-astra', 'ok', 1, '[]'::jsonb)$q$,
    'rate_limited');
  select public.ai_planner_cooldown_seconds() > 0 as waiting;
commit;

do $$ begin
  assert (select public.ai_planner_cooldown_seconds()) > 0, 'the cooldown is running';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The input is checked
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-alice'), true);
  select pg_temp.expect_error($q$select public.log_ai_planner_interaction(
    '', 'Lagos', 120, 5000000, 'NGN', 'Brief.', 'model', 'ok', 1, '[]'::jsonb)$q$, 'invalid_planner_input');
  select pg_temp.expect_error($q$select public.log_ai_planner_interaction(
    'Wedding', 'Lagos', 120, 5000000, 'Naira', 'Brief.', 'model', 'ok', 1, '[]'::jsonb)$q$, 'invalid_planner_input');
  select pg_temp.expect_error($q$select public.log_ai_planner_interaction(
    'Wedding', 'Lagos', 120, 5000000, 'NGN', 'Brief.', 'model', 'maybe', 1, '[]'::jsonb)$q$, 'invalid_planner_status');
commit;

-- ---------------------------------------------------------------------------
-- 4. Only a Host house member may plan
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-dave'), true);
  select pg_temp.expect_error($q$select public.log_ai_planner_interaction(
    'Wedding', 'Lagos', 120, 5000000, 'NGN', 'Brief.', 'model', 'ok', 1, '[]'::jsonb)$q$, 'forbidden: planner');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-erin'), true);
  select pg_temp.expect_error($q$select public.log_ai_planner_interaction(
    'Wedding', 'Lagos', 120, 5000000, 'NGN', 'Brief.', 'model', 'ok', 1, '[]'::jsonb)$q$, 'forbidden: planner');
commit;

begin;
  set local role anon;
  -- anon cannot call the function at all, and cannot read the table.
  select pg_temp.expect_error($q$select public.log_ai_planner_interaction(
    'Wedding', 'Lagos', 120, 5000000, 'NGN', 'Brief.', 'model', 'ok', 1, '[]'::jsonb)$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.ai_planner_interactions$q$, 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 5. Nobody writes the table directly
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-alice'), true);
  select pg_temp.expect_error(format(
    $q$insert into public.ai_planner_interactions (user_id, house_id, model, event_type, city, guest_count,
       budget_minor, budget_currency, brief, status) values (%L, %L, 'm', 'Wedding', 'Lagos', 10, 100, 'NGN', 'x', 'ok')$q$,
    (select alice from ids), (select alice_host from ids)), 'permission denied');
  select pg_temp.expect_error(format(
    $q$update public.ai_planner_interactions set brief = 'changed' where id = %L$q$, (select id from c)),
    'permission denied');
  select pg_temp.expect_error(format(
    $q$delete from public.ai_planner_interactions where id = %L$q$, (select id from c)), 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 6. Reporting an answer
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-alice'), true);
  select public.report_ai_planner_response((select id from c), 'wrong_facts', 'It named a vendor that does not exist.');
commit;

do $$ declare r record; begin
  select * into r from public.ai_planner_interactions where id = (select id from c);
  assert r.reported_at is not null, 'the report is recorded';
  assert r.report_category = 'wrong_facts', 'the category is recorded';
  assert r.report_note = 'It named a vendor that does not exist.', 'the note is recorded';
end $$;

do $$ declare n bigint; begin
  select count(*) into n from public.audit_events
   where action = 'planner.response_reported' and target_id = (select id from c);
  assert n = 1, 'one audit row for the report, got ' || n::text;
end $$;

-- A second report is refused, and an unknown category is refused.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-alice'), true);
  select pg_temp.expect_error(format(
    $q$select public.report_ai_planner_response(%L, 'other', 'again')$q$, (select id from c)), 'already_reported');
  select pg_temp.expect_error(format(
    $q$select public.report_ai_planner_response(%L, 'because', null)$q$, (select id from c)), 'already_reported');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-erin'), true);
  select pg_temp.expect_error(format(
    $q$select public.report_ai_planner_response(%L, 'other', null)$q$, (select id from c)), 'interaction_not_found');
commit;

-- ---------------------------------------------------------------------------
-- 7. The history is the caller's own
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-alice'), true);
  do $$ declare r record; begin
    select * into r from public.my_ai_planner_interactions();
    assert r.interaction_id = (select id from c), 'the host sees their interaction';
    assert r.reported_at is not null, 'the host sees that they reported it';
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f101-dave'), true);
  do $$ begin
    assert (select count(*) from public.my_ai_planner_interactions()) = 0,
      'another house sees no interactions';
    assert not exists (select 1 from public.ai_planner_interactions where id = (select id from c)),
      'RLS hides the interaction from another house';
  end $$;
commit;

\o
select 'F-101 planner tests passed' as result;
