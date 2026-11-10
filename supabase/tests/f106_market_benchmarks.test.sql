-- F-106 Market benchmark data tests. Raises on the first failure.
-- Covers: a sent quote becomes one observed price with its provenance, the observation a new
-- quote replaces is logged as superseded, an unverified or withdrawn quote never reaches the
-- market, a range names no vendor until two vendors hold a current price, and only the
-- planner's Host houses and platform staff with the 'analytics' capability can read any of it.
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

-- The quote a vendor sends, and the price it carries.
create function pg_temp.send_quote_for(p_vendor uuid, p_host uuid, p_total bigint, p_day integer)
returns uuid language plpgsql as $$
declare
  v_id      uuid;
  v_version integer;
begin
  v_id := public.create_quote(p_vendor, p_host, current_date + p_day, 'NGN', 'Wedding package',
    jsonb_build_array(jsonb_build_object('label', 'Package', 'line_total_minor', p_total)), '[]'::jsonb);
  select version into v_version from public.quotes where id = v_id;
  perform public.send_quote(v_id, v_version);
  return v_id;
end $$;

-- The vendor withdraws its own offer.
create function pg_temp.withdraw_quote(p_quote uuid) returns void language plpgsql as $$
declare
  v_version integer;
begin
  select version into v_version from public.quotes where id = p_quote;
  perform public.cancel_quote(p_quote, v_version, 'The date is gone.');
end $$;

grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: a host, three vendors (two published, one not) and two platform staff.
-- ---------------------------------------------------------------------------
create temp table ids (alice uuid, dave uuid, erin uuid, frank uuid, grace uuid, heidi uuid, ops uuid,
                       alice_host uuid, dave_vendor uuid, erin_vendor uuid, frank_vendor uuid);
create temp table q_dave (id uuid);
create temp table q_erin (id uuid);
create temp table q_frank (id uuid);
create temp table q_dave_second (id uuid);
grant select, insert on ids, q_dave, q_erin, q_frank, q_dave_second to authenticated;

insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f106-alice', 'alice@example.test', true, 'Alice Adeyemi'),
  ('auth0|f106-dave',  'dave@example.test',  true, 'Dave Cakes Ltd'),
  ('auth0|f106-erin',  'erin@example.test',  true, 'Erin Shoots'),
  ('auth0|f106-frank', 'frank@example.test', true, 'Frank Hidden'),
  ('auth0|f106-grace', 'grace@example.test', true, 'Grace Analyst'),
  ('auth0|f106-heidi', 'heidi@example.test', true, 'Heidi Support'),
  ('auth0|f106-ops',   'ops@example.test',   true, 'Ops Admin');

insert into ids (alice, dave, erin, frank, grace, heidi, ops)
  select (select id from public.users where auth0_sub = 'auth0|f106-alice'),
         (select id from public.users where auth0_sub = 'auth0|f106-dave'),
         (select id from public.users where auth0_sub = 'auth0|f106-erin'),
         (select id from public.users where auth0_sub = 'auth0|f106-frank'),
         (select id from public.users where auth0_sub = 'auth0|f106-grace'),
         (select id from public.users where auth0_sub = 'auth0|f106-heidi'),
         (select id from public.users where auth0_sub = 'auth0|f106-ops');

insert into public.houses (kind, owner_user_id, display_name) select 'host', alice, 'Alice''s celebrations' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', dave, 'Dave Cakes Ltd' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', erin, 'Erin Shoots' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', frank, 'Frank Hidden' from ids;

update ids set
  alice_host   = (select id from public.houses where display_name = 'Alice''s celebrations'),
  dave_vendor  = (select id from public.houses where display_name = 'Dave Cakes Ltd'),
  erin_vendor  = (select id from public.houses where display_name = 'Erin Shoots'),
  frank_vendor = (select id from public.houses where display_name = 'Frank Hidden');

insert into public.memberships (house_id, house_kind, user_id, role) select alice_host, 'host', alice, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select dave_vendor, 'vendor', dave, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select erin_vendor, 'vendor', erin, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select frank_vendor, 'vendor', frank, 'owner' from ids;

-- Two published vendors in Lagos, one vendor the platform does not publish.
insert into public.vendor_profiles
  (house_id, slug, business_name, category, locations, headline, about, published, published_at)
  select dave_vendor, 'dave-cakes', 'Dave Cakes Ltd', 'Cakes', 'Lagos, Ibadan',
         'Wedding cakes in Lagos', 'A cake studio in Lagos.', true, now() from ids;
insert into public.vendor_profiles
  (house_id, slug, business_name, category, locations, headline, about, published, published_at)
  select erin_vendor, 'erin-shoots', 'Erin Shoots', 'Cakes', 'Lagos',
         'Wedding cakes in Lagos', 'A cake studio in Lagos.', true, now() from ids;
insert into public.vendor_profiles
  (house_id, slug, business_name, category, locations, headline, about, published, published_at)
  select frank_vendor, 'frank-hidden', 'Frank Hidden', 'Cakes', 'Lagos', '', '', false, null from ids;

-- 'analytics' is new in F-106. Support keeps its own meaning and does not open the benchmarks.
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select grace, 'analytics', 'global', ops from ids;
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select heidi, 'support', 'global', ops from ids;

-- ---------------------------------------------------------------------------
-- 1. A sent quote becomes one observed price, with its provenance
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-dave'), true);
  insert into q_dave select pg_temp.send_quote_for(
    (select dave_vendor from ids), (select alice_host from ids), 500000, 60);
commit;

do $$ declare r public.market_benchmarks; q public.quotes; begin
  select * into r from public.market_benchmarks
   where vendor_house_id = (select dave_vendor from ids) and location_key = 'lagos';
  assert found, 'the sent quote became an observation';
  select * into q from public.quotes where id = (select id from q_dave);

  assert r.price_minor = 500000, 'the price is the quote total, got ' || r.price_minor::text;
  assert r.currency = 'NGN', 'the currency is kept';
  assert r.category = 'Cakes', 'the category comes from the vendor profile';
  assert r.location = 'Lagos', 'the location is the vendor''s own wording';
  assert r.source = 'vendor_quote', 'the source is recorded';
  assert r.source_ref = q.id, 'the quote behind the price is recorded';
  assert r.source_revision = 1, 'the revision behind the price is recorded';
  assert r.observed_at = q.sent_at, 'the price was observed when the quote was sent';
  assert r.verification_status = 'verified', 'a published vendor is a verified source';
  assert r.recorded_by = (select dave from ids), 'the vendor member who wrote the price is recorded';

  -- The vendor serves two places, so the price is observed in each of them.
  assert (select count(*) from public.market_benchmarks
           where vendor_house_id = (select dave_vendor from ids)) = 2,
    'the price is observed in Lagos and in Ibadan';
end $$;

-- The provenance and the freshness are on the audit trail.
do $$ declare n bigint; d jsonb; begin
  select count(*) into n from public.audit_events
   where action = 'benchmark.observed' and target_table = 'market_benchmarks';
  assert n = 2, 'one audit row per observed place, got ' || n::text;
  select details into d from public.audit_events
   where action = 'benchmark.observed' and details ->> 'location' = 'Lagos' limit 1;
  assert d ->> 'source' = 'vendor_quote', 'the audit row names the source';
  assert d ->> 'price_minor' = '500000', 'the audit row carries the price';
  assert d ->> 'verification_status' = 'verified', 'the audit row carries the verification';
  assert d ? 'observed_at', 'the audit row carries when it was seen';
end $$;

-- ---------------------------------------------------------------------------
-- 2. One vendor's price is not a market yet
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-alice'), true);
  do $$ declare r record; begin
    select * into r from public.read_market_benchmarks(array['Cakes'], 'Lagos');
    assert r.vendor_count = 1, 'one vendor holds a price, got ' || r.vendor_count::text;
    assert r.observation_count = 1, 'one price is on record';
    assert r.published = false, 'one vendor is not a range';
    assert r.min_price_minor is null and r.median_price_minor is null and r.max_price_minor is null,
      'the price is not published while one vendor holds it';
    assert r.source = 'vendor_quote', 'the source is shown';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 3. A second vendor makes it a range
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-erin'), true);
  insert into q_erin select pg_temp.send_quote_for(
    (select erin_vendor from ids), (select alice_host from ids), 300000, 61);
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-alice'), true);
  do $$ declare r record; begin
    select * into r from public.read_market_benchmarks(array['Cakes'], 'Lagos');
    assert r.vendor_count = 2, 'two vendors hold a price, got ' || r.vendor_count::text;
    assert r.observation_count = 2, 'two prices are on record';
    assert r.published = true, 'the range is published';
    assert r.min_price_minor = 300000, 'the lowest price, got ' || r.min_price_minor::text;
    assert r.max_price_minor = 500000, 'the highest price, got ' || r.max_price_minor::text;
    assert r.median_price_minor = 400000, 'the middle price, got ' || r.median_price_minor::text;
    assert r.oldest_observed_at is not null and r.newest_observed_at is not null,
      'the range says how fresh it is';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 4. A vendor the platform does not publish never reaches the market
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-frank'), true);
  insert into q_frank select pg_temp.send_quote_for(
    (select frank_vendor from ids), (select alice_host from ids), 100000, 62);
commit;

do $$ declare r public.market_benchmarks; begin
  select * into r from public.market_benchmarks
   where vendor_house_id = (select frank_vendor from ids);
  assert found, 'the quote is still observed, so the audit trail can show it';
  assert r.verification_status = 'unverified', 'an unpublished vendor is not a verified source';
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-alice'), true);
  do $$ declare r record; begin
    select * into r from public.read_market_benchmarks(array['Cakes'], 'Lagos');
    assert r.vendor_count = 2, 'the unpublished vendor is not counted, got ' || r.vendor_count::text;
    assert r.min_price_minor = 300000, 'the unpublished price is not in the range';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 5. A quote the vendor withdrew is not a market price
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-erin'), true);
  select pg_temp.withdraw_quote((select id from q_erin));
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-alice'), true);
  do $$ declare r record; begin
    select * into r from public.read_market_benchmarks(array['Cakes'], 'Lagos');
    assert r.vendor_count = 1, 'the withdrawn price is out of the range, got ' || r.vendor_count::text;
    assert r.published = false, 'one vendor is not a range again';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 6. A new price replaces the old one, and the audit trail says so
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-dave'), true);
  insert into q_dave_second select pg_temp.send_quote_for(
    (select dave_vendor from ids), (select alice_host from ids), 700000, 63);
commit;

do $$ declare n bigint; begin
  select count(*) into n from public.audit_events
   where action = 'benchmark.superseded' and target_table = 'market_benchmarks';
  assert n = 2, 'the earlier observation is logged as superseded in both places, got ' || n::text;
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-grace'), true);
  do $$ declare n bigint; current_count bigint; begin
    select count(*) into n from public.read_market_benchmark_sources('Cakes', 'Lagos')
     where vendor_house_id = (select dave_vendor from ids);
    assert n = 2, 'both observations are kept, got ' || n::text;
    select count(*) into current_count from public.read_market_benchmark_sources('Cakes', 'Lagos')
     where vendor_house_id = (select dave_vendor from ids) and current;
    assert current_count = 1, 'only the newest price is current, got ' || current_count::text;
  end $$;
commit;

-- The old price is still on record: the history is not rewritten.
do $$ declare n bigint; begin
  select count(*) into n from public.market_benchmarks
   where vendor_house_id = (select dave_vendor from ids) and price_minor = 500000;
  assert n = 2, 'the earlier price is still on record, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Only the planner's Host houses and the analytics capability read a range
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-dave'), true);
  select pg_temp.expect_error($q$select * from public.read_market_benchmarks(array['Cakes'], 'Lagos')$q$,
    'forbidden: market benchmarks');
  select pg_temp.expect_error($q$select * from public.read_market_benchmark_sources('Cakes', 'Lagos')$q$,
    'forbidden: analytics grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-heidi'), true);
  -- Support is not analytics: the benchmark provenance stays closed.
  select pg_temp.expect_error($q$select * from public.read_market_benchmarks(array['Cakes'], 'Lagos')$q$,
    'forbidden: market benchmarks');
  select pg_temp.expect_error($q$select * from public.read_market_benchmark_sources('Cakes', 'Lagos')$q$,
    'forbidden: analytics grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-grace'), true);
  do $$ declare r record; begin
    select * into r from public.read_market_benchmarks(array['Cakes'], 'Lagos');
    assert r.category = 'Cakes', 'the analyst reads the range';
  end $$;
  do $$ declare r record; begin
    select * into r from public.read_market_benchmark_sources('Cakes', 'Lagos')
     where vendor_house_id = (select dave_vendor from ids) and current;
    assert r.business_name = 'Dave Cakes Ltd', 'the analyst sees the vendor behind the price';
    assert r.source_ref is not null, 'the analyst sees the quote behind the price';
  end $$;
commit;

begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.read_market_benchmarks(array['Cakes'], 'Lagos')$q$,
    'permission denied');
  select pg_temp.expect_error($q$select * from public.read_market_benchmark_sources('Cakes', 'Lagos')$q$,
    'permission denied');
  select pg_temp.expect_error($q$select * from public.market_benchmarks$q$, 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 8. Nobody writes the observations directly
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f106-grace'), true);
  select pg_temp.expect_error(format(
    $q$insert into public.market_benchmarks (vendor_house_id, category, location, location_key,
       price_minor, currency, source, source_ref, source_revision, observed_at, verification_status)
       values (%L, 'Cakes', 'Lagos', 'lagos', 1, 'NGN', 'vendor_quote',
       (select id from q_dave), 1, now(), 'verified')$q$,
    (select dave_vendor from ids)), 'permission denied');
  select pg_temp.expect_error(format(
    $q$update public.market_benchmarks set price_minor = 1 where vendor_house_id = %L$q$,
    (select dave_vendor from ids)), 'permission denied');
  select pg_temp.expect_error(format(
    $q$delete from public.market_benchmarks where vendor_house_id = %L$q$,
    (select dave_vendor from ids)), 'permission denied');
commit;

-- The observations are there, and they are append-only.
do $$ declare n bigint; begin
  select count(*) into n from public.market_benchmarks;
  assert n = 6, 'every observed price is on record, got ' || n::text;
end $$;

\o
select 'F-106 market benchmark tests passed' as result;
