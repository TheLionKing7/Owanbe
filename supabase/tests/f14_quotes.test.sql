-- F-14 quote lifecycle & date lock tests. Raises on the first failure.
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

-- ---------------------------------------------------------------------------
-- Fixtures, created as the server: a vendor owner, vendor staff, and hosts
-- ---------------------------------------------------------------------------
create temp table ids (
  alice uuid, bob uuid, carol uuid, dave uuid,
  alice_vendor uuid, alice_host uuid, bob_host uuid, dave_host uuid, carol_membership uuid
);
grant select on ids to authenticated;

insert into public.users (auth0_sub, email, display_name) values
  ('auth0|f14-alice', 'alice@example.test', 'Alice Adeyemi'),
  ('auth0|f14-bob',   'bob@example.test',   'Bob Ogun'),
  ('auth0|f14-carol', 'carol@example.test', 'Carol Staff'),
  ('auth0|f14-dave',  'dave@example.test',  'Dave Oyelowo');

insert into ids (alice, bob, carol, dave)
  select (select id from public.users where auth0_sub = 'auth0|f14-alice'),
         (select id from public.users where auth0_sub = 'auth0|f14-bob'),
         (select id from public.users where auth0_sub = 'auth0|f14-carol'),
         (select id from public.users where auth0_sub = 'auth0|f14-dave');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', alice, 'Alice Events Ltd' from ids;
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', alice, 'Alice''s celebrations' from ids;
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', bob, 'The Ogun wedding' from ids;
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', dave, 'Dave''s 40th' from ids;

update ids set
  alice_vendor = (select id from public.houses where display_name = 'Alice Events Ltd'),
  alice_host   = (select id from public.houses where display_name = 'Alice''s celebrations'),
  bob_host     = (select id from public.houses where display_name = 'The Ogun wedding'),
  dave_host    = (select id from public.houses where display_name = 'Dave''s 40th');

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select alice_vendor, 'vendor', alice, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select alice_host, 'host', alice, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select bob_host, 'host', bob, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select dave_host, 'host', dave, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select alice_vendor, 'vendor', carol, 'staff', array['chat','quotes','calendar'] from ids;
update ids set carol_membership = (select id from public.memberships where user_id = ids.carol);

create temp table q1 (id uuid);
create temp table q2 (id uuid);
create temp table q3 (id uuid);
create temp table clock (expires_at timestamptz);
grant select, insert on q1, q2, q3 to authenticated;
grant select on clock to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Only a vendor-house member with the 'quotes' capability authors a quote
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-bob'), true);
  select pg_temp.expect_error(format(
    'select public.create_quote(%L, %L, %L, %L, %L, %L, %L)',
    (select alice_vendor from ids), (select bob_host from ids), (current_date + 60)::text, 'NGN',
    'Hall only', '[{"label":"Hall","line_total_minor":100000}]', '[]'), 'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  insert into q1
    select public.create_quote((select alice_vendor from ids), (select bob_host from ids),
      current_date + 60, 'NGN', 'Wedding package',
      '[{"label":"Hall","line_total_minor":100000},{"label":"Decor","line_total_minor":50000}]'::jsonb,
      '[{"label":"Extra lighting","line_total_minor":25000}]'::jsonb);
commit;

-- 2. A draft has no deadline, no lock, and its total is derived from the line items
do $$ declare r public.quotes; begin
  select * into r from public.quotes where id = (select id from q1);
  assert r.status = 'draft', 'a new quote is a draft';
  assert r.sent_at is null and r.expires_at is null and r.decided_at is null, 'a draft has no clock';
  assert r.total_minor = 175000, 'total is inclusions + extras, got ' || r.total_minor;
  assert r.currency = 'NGN' and r.current_revision = 1, 'revision 1 is current';
  assert not exists (select 1 from public.quote_date_locks), 'a draft locks nothing';
end $$;

-- 3. Revisions are append-only, and the totals must match the lines
select pg_temp.expect_error($q$update public.quote_revisions set total_minor = 1$q$, 'append-only');
select pg_temp.expect_error($q$delete from public.quote_revisions$q$, 'append-only');
select pg_temp.expect_error(format(
  $q$insert into public.quote_revisions (quote_id, number, authored_by_role, author_user_id, title,
      inclusions, extras, subtotal_minor, total_minor, currency)
    values (%L, 9, 'vendor', %L, 'Wrong total', '[{"label":"Hall","line_total_minor":100000}]'::jsonb,
      '[]'::jsonb, 100000, 999999, 'NGN')$q$, (select id from q1), (select alice from ids)),
  'revisions_totals_derived');
select pg_temp.expect_error(format(
  $q$insert into public.quote_revisions (quote_id, number, authored_by_role, author_user_id, title,
      inclusions, extras, subtotal_minor, total_minor, currency)
    values (%L, 9, 'vendor', %L, 'Unnamed line', '[{"line_total_minor":100}]'::jsonb,
      '[]'::jsonb, 100, 100, 'NGN')$q$, (select id from q1), (select alice from ids)),
  'revisions_lines_valid');
select pg_temp.expect_error(format(
  $q$insert into public.quote_revisions (quote_id, number, authored_by_role, author_user_id, title,
      inclusions, extras, subtotal_minor, total_minor, currency, message)
    values (%L, 9, 'host', %L, 'Host without words', '[]'::jsonb, '[]'::jsonb, 0, 0, 'NGN', null)$q$,
  (select id from q1), (select bob from ids)), 'revisions_host_counter_has_message');

-- 4. Editing a draft appends revision 2 and leaves revision 1 exactly as it was
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q1);
    assert public.revise_quote((select id from q1), v, 'Wedding package (updated)',
      '[{"label":"Hall","line_total_minor":120000}]'::jsonb, '[]'::jsonb) = 2, 'appends revision 2';
  end $$;
commit;
do $$ begin
  assert (select total_minor from public.quote_revisions
           where quote_id = (select id from q1) and number = 1) = 175000, 'revision 1 is untouched';
  assert (select total_minor from public.quotes where id = (select id from q1)) = 120000,
    'the quote carries the latest offer';
  assert (select current_revision from public.quotes where id = (select id from q1)) = 2;
end $$;

-- 5. A stale version is refused rather than silently applied
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  select pg_temp.expect_error(format('select public.send_quote(%L, 1)', (select id from q1)),
    'stale_version');
commit;

-- 6. Sending starts the 24-hour clock and locks the date in slot 1
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ declare v integer; e timestamptz; begin
    select version into v from public.quotes where id = (select id from q1);
    e := public.send_quote((select id from q1), v);
    assert e > now() + interval '23 hours' and e <= now() + interval '24 hours',
      'expiry is 24 hours out, got ' || e;
  end $$;
commit;
do $$ declare r public.quotes; l public.quote_date_locks; begin
  select * into r from public.quotes where id = (select id from q1);
  assert r.status = 'sent', 'sent';
  select * into l from public.quote_date_locks where quote_id = (select id from q1);
  assert l.slot = 1 and l.released_at is null, 'the date is locked in slot 1';
  assert l.service_date = r.service_date, 'the lock covers the quoted date';
  assert exists (select 1 from public.audit_events where action = 'quote.date_locked'), 'lock audited';
end $$;

-- 7. A host cannot send the vendor's offer
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-bob'), true);
  select pg_temp.expect_error(format('select public.send_quote(%L, 99)', (select id from q1)),
    'forbidden');
commit;

-- 8. A second quote for the same date is held as a competing slot while capacity is 1
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  insert into q2
    select public.create_quote((select alice_vendor from ids), (select dave_host from ids),
      (select service_date from public.quotes where id = (select id from q1)), 'NGN',
      'Second hall offer', '[{"label":"Hall","line_total_minor":90000}]'::jsonb, '[]'::jsonb);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q2);
    perform public.send_quote((select id from q2), v);
  end $$;
commit;
do $$ begin
  assert (select slot from public.quote_date_locks where quote_id = (select id from q2)) = 2,
    'the second quote takes slot 2';
  assert (select daily_capacity from public.vendor_availability) = 1, 'capacity defaults to 1';
end $$;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ begin
    assert (select competing from public.my_quotes((select alice_vendor from ids))
             where quote_id = (select id from q2)) = true, 'slot 2 of 1 is competing';
    assert (select competing from public.my_quotes((select alice_vendor from ids))
             where quote_id = (select id from q1)) = false, 'slot 1 of 1 is exclusive';
  end $$;
commit;

-- 9. Only the vendor owner changes capacity; the change is audited
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-carol'), true);
  select pg_temp.expect_error(format('select public.set_vendor_daily_capacity(%L, 3)',
    (select alice_vendor from ids)), 'forbidden');
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-bob'), true);
  select pg_temp.expect_error(format('select public.set_vendor_daily_capacity(%L, 3)',
    (select alice_vendor from ids)), 'forbidden');
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  select pg_temp.expect_error(format('select public.set_vendor_daily_capacity(%L, 0)',
    (select alice_vendor from ids)), 'invalid_daily_capacity');
  select public.set_vendor_daily_capacity((select alice_vendor from ids), 2);
commit;
do $$ begin
  assert (select daily_capacity from public.vendor_availability) = 2, 'capacity updated';
  assert exists (select 1 from public.audit_events where action = 'availability.capacity_changed'),
    'capacity change audited';
end $$;

-- 10. Each party sees only its own side of the projection
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ begin
    assert (select count(*) from public.my_quotes((select alice_vendor from ids))) = 2,
      'the vendor sees both quotes';
    assert (select competing from public.my_quotes((select alice_vendor from ids))
             where quote_id = (select id from q2)) = false, 'slot 2 of 2 is no longer competing';
    assert (select counterparty_name from public.my_quotes((select alice_vendor from ids))
             where quote_id = (select id from q1)) = 'The Ogun wedding', 'the host house name only';
  end $$;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-bob'), true);
  do $$ begin
    assert (select count(*) from public.my_quotes((select bob_host from ids))) = 1,
      'bob sees his own quote, not dave''s';
    assert (select is_vendor_side from public.my_quotes((select bob_host from ids))) = false;
    assert (select count(*) from public.quotes) = 1, 'bob reads one quote row';
    assert (select count(*) from public.quote_revisions) = 2, 'bob reads that quote''s revisions';
    assert (select count(*) from public.quote_history((select id from q1))) = 2,
      'the history shows both revisions';
    assert (select authored_by_role from public.quote_history((select id from q1))
             order by number desc limit 1) = 'vendor', 'the latest revision is the vendor''s';
  end $$;
  select pg_temp.expect_error(format('select count(*) from public.my_quotes(%L)',
    (select alice_vendor from ids)), 'forbidden');
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-dave'), true);
  select pg_temp.expect_error(format('select count(*) from public.quote_history(%L)',
    (select id from q1)), 'forbidden');
commit;

-- 11. A host counter records words, keeps the clock running and holds the date
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  select pg_temp.expect_error(format(
    'select public.counter_quote(%L, (select version from public.quotes where id = %L), %L)',
    (select id from q1), (select id from q1), 'We can do better'), 'forbidden');
commit;
delete from clock;
insert into clock select expires_at from public.quotes where id = (select id from q1);
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-bob'), true);
  select pg_temp.expect_error(format(
    'select public.counter_quote(%L, (select version from public.quotes where id = %L), %L)',
    (select id from q1), (select id from q1), '   '), 'counter_message_required');
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q1);
    perform public.counter_quote((select id from q1), v, 'Can you do 110,000 with the lighting included?');
  end $$;
commit;
do $$ declare r public.quotes; rev public.quote_revisions; begin
  select * into r from public.quotes where id = (select id from q1);
  assert r.status = 'countered', 'countered';
  assert r.expires_at = (select expires_at from clock), 'a counter does not restart the clock';
  assert r.total_minor = 120000, 'the vendor''s offer still stands while countered';
  select * into rev from public.quote_revisions
    where quote_id = (select id from q1) and number = r.current_revision;
  assert rev.authored_by_role = 'host' and rev.message is not null, 'the counter is the host''s revision';
  assert exists (select 1 from public.quote_date_locks
                  where quote_id = (select id from q1) and released_at is null), 'the date stays locked';
end $$;

-- 12. The vendor revises and re-sends: the 24-hour clock restarts from the send
update public.quotes set expires_at = now() + interval '5 minutes' where id = (select id from q1);
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ declare v integer; e timestamptz; begin
    select version into v from public.quotes where id = (select id from q1);
    perform public.revise_quote((select id from q1), v, 'Wedding package (agreed)',
      '[{"label":"Hall","line_total_minor":110000}]'::jsonb,
      '[{"label":"Extra lighting","line_total_minor":0}]'::jsonb, 'Accepted your counter.');
    select version into v from public.quotes where id = (select id from q1);
    e := public.send_quote((select id from q1), v);
    assert e > now() + interval '23 hours', 'the revised quote restarted the clock, got ' || e;
  end $$;
commit;
do $$ begin
  assert (select status from public.quotes where id = (select id from q1)) = 'sent', 'back to sent';
  assert (select total_minor from public.quotes where id = (select id from q1)) = 110000, 'the new offer';
  assert (select count(*) from public.quote_date_locks
           where quote_id = (select id from q1) and released_at is null) = 1, 'still one live lock';
end $$;

-- 13. Once the deadline has passed the offer cannot be revised, re-sent or accepted
delete from clock;
insert into clock select expires_at from public.quotes where id = (select id from q1);
update public.quotes set expires_at = now() - interval '1 minute' where id = (select id from q1);
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  select pg_temp.expect_error(format(
    'select public.revise_quote(%L, (select version from public.quotes where id = %L), %L, %L, %L, null)',
    (select id from q1), (select id from q1), 'Too late', '[]', '[]'), 'invalid_transition');
commit;
do $$ begin
  assert (select status from public.quotes where id = (select id from q1)) = 'expired',
    'the deadline expired the quote';
  assert (select release_reason from public.quote_date_locks
           where quote_id = (select id from q1)) = 'expired', 'expiry released the date';
end $$;
-- restore the fixture so the accept/decline paths can still be exercised
update public.quotes set status = 'sent', expires_at = (select expires_at from clock),
                         decided_at = null, close_note = null
  where id = (select id from q1);
update public.quote_date_locks set released_at = null, release_reason = null
  where quote_id = (select id from q1);

-- 14. Accept keeps the lock for the booking that follows; the vendor cannot accept
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  select pg_temp.expect_error(format(
    'select public.accept_quote(%L, (select version from public.quotes where id = %L))',
    (select id from q1), (select id from q1)), 'forbidden');
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-bob'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q1);
    perform public.accept_quote((select id from q1), v);
  end $$;
  select pg_temp.expect_error(format(
    'select public.accept_quote(%L, (select version from public.quotes where id = %L))',
    (select id from q1), (select id from q1)), 'invalid_transition');
commit;
do $$ begin
  assert (select status from public.quotes where id = (select id from q1)) = 'accepted';
  assert (select decided_at from public.quotes where id = (select id from q1)) is not null;
  assert exists (select 1 from public.quote_date_locks
                  where quote_id = (select id from q1) and released_at is null),
    'an accepted quote keeps the date locked';
  assert exists (select 1 from public.audit_events where action = 'quote.accepted'), 'acceptance audited';
end $$;

-- 15. Declining releases the date, and the vendor cannot cancel an accepted quote
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  select pg_temp.expect_error(format(
    'select public.cancel_quote(%L, (select version from public.quotes where id = %L), null)',
    (select id from q1), (select id from q1)), 'invalid_transition');
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-dave'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q2);
    perform public.decline_quote((select id from q2), v);
  end $$;
commit;
do $$ declare l public.quote_date_locks; begin
  select * into l from public.quote_date_locks where quote_id = (select id from q2);
  assert l.released_at is not null and l.release_reason = 'declined', 'declining releases the date';
end $$;

-- 16. A released slot is free again for that date
create temp table q4 (id uuid);
grant select, insert on q4 to authenticated;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ declare d date; v integer; nid uuid; begin
    select service_date into d from public.quotes where id = (select id from q1);
    nid := public.create_quote((select alice_vendor from ids), (select dave_host from ids), d, 'NGN',
      'Same day again', '[{"label":"Hall","line_total_minor":95000}]'::jsonb, '[]'::jsonb);
    insert into q4 values (nid);
    select version into v from public.quotes where id = nid;
    perform public.send_quote(nid, v);
    assert (select slot from public.quote_date_locks where quote_id = nid) = 2,
      'the slot released by the declined quote is reused';
  end $$;
commit;

-- 17. The vendor can withdraw an offer; a host cannot
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-dave'), true);
  select pg_temp.expect_error(format(
    'select public.cancel_quote(%L, (select version from public.quotes where id = %L), null)',
    (select id from q4), (select id from q4)), 'forbidden');
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q4);
    perform public.cancel_quote((select id from q4), v, 'Venue lost the date');
  end $$;
commit;
do $$ begin
  assert (select status from public.quotes where id = (select id from q4)) = 'cancelled';
  assert (select close_note from public.quotes where id = (select id from q4)) = 'Venue lost the date';
  assert (select release_reason from public.quote_date_locks
           where quote_id = (select id from q4)) = 'cancelled', 'cancelling releases the date';
  assert exists (select 1 from public.audit_events where action = 'quote.cancelled'), 'cancellation audited';
end $$;

-- 18. A draft can be withdrawn before it was ever sent, and it locked nothing
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  do $$ declare nid uuid; v integer; begin
    nid := public.create_quote((select alice_vendor from ids), (select bob_host from ids),
      current_date + 120, 'NGN', 'Unsent', '[{"label":"Hall","line_total_minor":1000}]'::jsonb,
      '[]'::jsonb);
    select version into v from public.quotes where id = nid;
    perform public.cancel_quote(nid, v, null);
    assert (select status from public.quotes where id = nid) = 'cancelled', 'a draft can be withdrawn';
    assert (select sent_at from public.quotes where id = nid) is null, 'it was never sent';
    assert not exists (select 1 from public.quote_date_locks where quote_id = nid), 'a draft locked nothing';
  end $$;
commit;

-- 19. The scheduler sweep expires overdue quotes (service-role entry point)
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  insert into q3
    select public.create_quote((select alice_vendor from ids), (select bob_host from ids),
      current_date + 90, 'NGN', 'Later date', '[{"label":"Hall","line_total_minor":80000}]'::jsonb,
      '[]'::jsonb);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from q3);
    perform public.send_quote((select id from q3), v);
  end $$;
commit;
update public.quotes set expires_at = now() - interval '2 minutes' where id = (select id from q3);
select public.expire_due_quotes();
do $$ begin
  assert (select status from public.quotes where id = (select id from q3)) = 'expired',
    'the sweep expired the overdue quote';
  assert (select release_reason from public.quote_date_locks
           where quote_id = (select id from q3)) = 'expired', 'the sweep released its date';
end $$;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-bob'), true);
  select pg_temp.expect_error(format(
    'select public.accept_quote(%L, (select version from public.quotes where id = %L))',
    (select id from q3), (select id from q3)), 'invalid_transition');
commit;

-- 20. Revoked staff lose the quotes capability at once
update public.memberships set revoked_at = now(), revoked_by = (select alice from ids)
  where id = (select carol_membership from ids);
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-carol'), true);
  select pg_temp.expect_error(format(
    'select public.create_quote(%L, %L, %L, %L, %L, %L, %L)',
    (select alice_vendor from ids), (select bob_host from ids), (current_date + 30)::text, 'NGN',
    'Nope', '[{"label":"Hall","line_total_minor":1}]', '[]'), 'forbidden');
commit;

-- 21. Clients never write these tables, and anon cannot read them
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f14-alice'), true);
  select pg_temp.expect_error(format(
    $q$insert into public.quotes (vendor_house_id, host_house_id, created_by, service_date, currency,
      total_minor, current_revision) values (%L, %L, %L, current_date, 'NGN', 1, 1)$q$,
    (select alice_vendor from ids), (select bob_host from ids), (select alice from ids)),
    'permission denied');
  select pg_temp.expect_error($q$update public.quotes set status = 'accepted'$q$, 'permission denied');
  select pg_temp.expect_error($q$update public.quote_date_locks set released_at = now()$q$,
    'permission denied');
  select pg_temp.expect_error($q$update public.vendor_availability set daily_capacity = 99$q$,
    'permission denied');
  select pg_temp.expect_error($q$delete from public.vendor_availability$q$, 'permission denied');
commit;
begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.quotes$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.quote_date_locks$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.quote_revisions$q$, 'permission denied');
commit;

-- 22. Every transition left an audit row carrying identifiers, not offer contents
do $$ begin
  assert (select count(distinct action) from public.audit_events where action like 'quote.%') >= 7,
    'quote transitions are audited';
  assert not exists (select 1 from public.audit_events where details::text ilike '%inclusions%'),
    'audit details never carry the offer lines';
end $$;

\o
\pset tuples_only on
select 'F-14 quote lifecycle tests passed' as result;
