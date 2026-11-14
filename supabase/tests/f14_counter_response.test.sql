-- F-14 counter-response deadline: a host's counter starts a 24-hour window for the vendor, and
-- when that window closes the quote expires, the date is released and the host is told.
--
-- Runs after the F-14 quote suite's own rules and before F-76's: it owns its fixtures and never
-- counts rows another suite created.
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
-- Fixtures: one vendor house and one host house
-- ---------------------------------------------------------------------------
create temp table ids (
  vendor_user uuid, host_user uuid, vendor_house uuid, host_house uuid
);
grant select on ids to authenticated;

insert into public.users (auth0_sub, email, display_name) values
  ('auth0|f14cr-vendor', 'vera@example.test', 'Vera Vendor'),
  ('auth0|f14cr-host',   'hana@example.test',  'Hana Host');

insert into ids (vendor_user, host_user)
  select (select id from public.users where auth0_sub = 'auth0|f14cr-vendor'),
         (select id from public.users where auth0_sub = 'auth0|f14cr-host');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', vendor_user, 'Vera Events' from ids;
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', host_user, 'Hana''s celebration' from ids;

update ids set
  vendor_house = (select id from public.houses where display_name = 'Vera Events'),
  host_house   = (select id from public.houses where display_name = 'Hana''s celebration');

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select vendor_house, 'vendor', vendor_user, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select host_house, 'host', host_user, 'owner', '{}' from ids;

create temp table q1 (id uuid);
create temp table q2 (id uuid);
create temp table q3 (id uuid);
grant select, insert on q1, q2, q3 to authenticated;

-- ---------------------------------------------------------------------------
-- 1. A sent offer waits on the offer deadline, and has no counter deadline
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-vendor'), true);
  insert into q1
    select public.create_quote((select vendor_house from ids), (select host_house from ids),
      current_date + 45, 'NGN', 'Hall and decor',
      '[{"label":"Hall","line_total_minor":120000}]'::jsonb, '[]'::jsonb);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q1);
    perform public.send_quote((select id from q1), v);
  end $$;
commit;
do $$ declare r public.quotes; begin
  select * into r from public.quotes where id = (select id from q1);
  assert r.status = 'sent', 'the offer is sent';
  assert r.counter_response_due_at is null, 'a sent offer has no counter deadline';
  assert r.expires_at > now() + interval '23 hours', 'the offer deadline is 24 hours out';
  assert exists (select 1 from public.quote_date_locks
                  where quote_id = (select id from q1) and released_at is null), 'the date is locked';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The host's counter starts the vendor's 24 hours
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-host'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q1);
    perform public.counter_quote((select id from q1), v, 'Can you include the lighting at that price?');
  end $$;
commit;
do $$ declare r public.quotes; begin
  select * into r from public.quotes where id = (select id from q1);
  assert r.status = 'countered', 'the quote is countered';
  assert r.counter_response_due_at is not null, 'the counter started a vendor deadline';
  assert r.counter_response_due_at > now() + interval '23 hours'
     and r.counter_response_due_at <= now() + interval '24 hours',
    'the vendor has 24 hours, got ' || r.counter_response_due_at;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The offer deadline passing no longer ends a countered quote
-- ---------------------------------------------------------------------------
-- The deadline the send set is moved into the past. The vendor deadline still stands, so the quote
-- lives and the date is still held.
update public.quotes
   set sent_at = sent_at - interval '2 days', expires_at = now() - interval '1 day'
 where id = (select id from q1);
do $$ begin
  assert (select status from public.quotes where id = (select id from q1)) = 'countered',
    'a countered quote waits on the vendor deadline, not the offer deadline';
  assert exists (select 1 from public.quote_date_locks
                  where quote_id = (select id from q1) and released_at is null),
    'the date is still held while the vendor answers';
end $$;

-- ---------------------------------------------------------------------------
-- 4. When the vendor's window closes the quote expires, the date is released, the host is told
-- ---------------------------------------------------------------------------
update public.quotes set counter_response_due_at = now() - interval '1 minute'
 where id = (select id from q1);
select public.expire_due_quotes();
do $$ begin
  assert (select status from public.quotes where id = (select id from q1)) = 'expired',
    'the vendor deadline expired the quote';
  assert (select release_reason from public.quote_date_locks
           where quote_id = (select id from q1)) = 'expired', 'the date was released';
  assert exists (select 1 from public.audit_events
                  where action = 'quote.expired' and target_id = (select id from q1)),
    'the expiry is audited';
  assert exists (select 1 from public.audit_events
                  where action = 'quote.expired' and target_id = (select id from q1)
                    and details ->> 'reason' = 'vendor_response_overdue'),
    'the audit says the vendor ran out of time';
  assert exists (select 1 from public.notifications
                  where kind = 'counter_ignored'
                    and house_id = (select host_house from ids)
                    and payload ->> 'quote_id' = (select id from q1)::text),
    'the host was told their counter went unanswered';
  assert not exists (select 1 from public.notifications
                      where kind = 'counter_ignored'
                        and house_id = (select vendor_house from ids)),
    'the vendor is not told about their own silence';
end $$;

-- A quote the vendor let run out cannot be countered or accepted afterwards.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-host'), true);
  select pg_temp.expect_error(format(
    'select public.counter_quote(%L, (select version from public.quotes where id = %L), %L)',
    (select id from q1), (select id from q1), 'One more try'), 'invalid_transition');
  select pg_temp.expect_error(format(
    'select public.accept_quote(%L, (select version from public.quotes where id = %L))',
    (select id from q1), (select id from q1)), 'invalid_transition');
commit;

-- ---------------------------------------------------------------------------
-- 5. The vendor's re-send ends the counter window and starts the offer deadline again
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-vendor'), true);
  insert into q2
    select public.create_quote((select vendor_house from ids), (select host_house from ids),
      current_date + 46, 'NGN', 'Hall only',
      '[{"label":"Hall","line_total_minor":90000}]'::jsonb, '[]'::jsonb);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q2);
    perform public.send_quote((select id from q2), v);
  end $$;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-host'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q2);
    perform public.counter_quote((select id from q2), v, 'A smaller package would work for us.');
  end $$;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-vendor'), true);
  do $$ declare v integer; e timestamptz; begin
    select version into v from public.quotes where id = (select id from q2);
    perform public.revise_quote((select id from q2), v, 'Hall only (agreed)',
      '[{"label":"Hall","line_total_minor":90000}]'::jsonb, '[]'::jsonb,
      'Accepted your counter.');
    select version into v from public.quotes where id = (select id from q2);
    e := public.send_quote((select id from q2), v);
    assert e > now() + interval '23 hours', 'the offer deadline restarted';
  end $$;
commit;
do $$ declare r public.quotes; begin
  select * into r from public.quotes where id = (select id from q2);
  assert r.status = 'sent', 'the quote is sent again';
  assert r.counter_response_due_at is null, 'the counter window is closed';
  assert r.expires_at > now() + interval '23 hours', 'the offer deadline runs again';
  assert exists (select 1 from public.quote_date_locks
                  where quote_id = (select id from q2) and released_at is null),
    'the date is still held';
  assert (select count(*) from public.quote_date_locks
           where quote_id = (select id from q2) and released_at is null) = 1,
    'the re-send did not take a second hold on the date';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Both houses read the vendor deadline the counter set
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-vendor'), true);
  insert into q3
    select public.create_quote((select vendor_house from ids), (select host_house from ids),
      current_date + 47, 'NGN', 'Full package',
      '[{"label":"Hall","line_total_minor":150000}]'::jsonb, '[]'::jsonb);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q3);
    perform public.send_quote((select id from q3), v);
  end $$;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-host'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q3);
    perform public.counter_quote((select id from q3), v, 'Please confirm the catering is included.');
  end $$;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-host'), true);
  do $$ begin
    assert (select counter_response_due_at from public.my_quotes((select host_house from ids))
             where quote_id = (select id from q3)) is not null,
      'the host reads the vendor deadline';
    assert (select counter_response_due_at from public.my_quotes((select host_house from ids))
             where quote_id = (select id from q3))
         = (select counter_response_due_at from public.quotes where id = (select id from q3)),
      'the projection carries the server deadline unchanged';
  end $$;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-vendor'), true);
  do $$ begin
    assert (select counter_response_due_at from public.my_quotes((select vendor_house from ids))
             where quote_id = (select id from q3)) is not null,
      'the vendor reads the same deadline';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 7. Clients never write the new column
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14cr-vendor'), true);
  select pg_temp.expect_error(format(
    $q$update public.quotes set counter_response_due_at = now() + interval '10 days' where id = %L$q$,
    (select id from q3)), 'permission denied');
commit;

\o
\pset tuples_only on
select 'F-14 counter-response deadline tests passed' as result;
