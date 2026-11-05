-- F-38 vendor calendar soft-hold tests. Raises on the first failure.
-- Suites share one database and run in filename order, so this file runs after f14_quotes.test.sql:
-- every assertion is scoped to F-38's own houses, and daily_capacity is only raised after the
-- capacity-1 scenarios are finished (capacity belongs to the vendor, not to a single date).
--
-- The service role has no table grants, so blocks that run as it only make calls and record the
-- outcome; every assertion about rows happens in the following top-level block.
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
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures, created as the server: one vendor and five hosts
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, display_name) values
  ('auth0|f38-viki',  'viki@example.test',  'Viki Fabrics'),
  ('auth0|f38-one',   'one@example.test',   'Ada Adebayo'),
  ('auth0|f38-two',   'two@example.test',   'Bola Adeyemi'),
  ('auth0|f38-three', 'three@example.test', 'Chidi Oke'),
  ('auth0|f38-four',  'four@example.test',  'Dele Bankole'),
  ('auth0|f38-out',   'out@example.test',   'Erin Stranger');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', u.id, 'F38 Vendor' from public.users u where u.auth0_sub = 'auth0|f38-viki';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F38 Ada'   from public.users u where u.auth0_sub = 'auth0|f38-one';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F38 Bola'  from public.users u where u.auth0_sub = 'auth0|f38-two';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F38 Chidi' from public.users u where u.auth0_sub = 'auth0|f38-three';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F38 Dele'  from public.users u where u.auth0_sub = 'auth0|f38-four';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F38 Erin'  from public.users u where u.auth0_sub = 'auth0|f38-out';

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select h.id, h.kind, h.owner_user_id, 'owner', '{}' from public.houses h
  where h.display_name like 'F38 %';

-- One row of ids every block below needs.
create temp table ids (vendor uuid, ada uuid, bola uuid, chidi uuid, dele uuid, erin uuid,
                       date_a date, date_b date, date_c date, date_d date);
insert into ids
  select (select id from public.houses where display_name = 'F38 Vendor'),
         (select id from public.houses where display_name = 'F38 Ada'),
         (select id from public.houses where display_name = 'F38 Bola'),
         (select id from public.houses where display_name = 'F38 Chidi'),
         (select id from public.houses where display_name = 'F38 Dele'),
         (select id from public.houses where display_name = 'F38 Erin'),
         current_date + 200, current_date + 201, current_date + 202, current_date + 203;

-- date A: three offers on one date against capacity 1 -> contested, first payment wins
-- date B: one offer whose window closes unpaid       -> a late payment is refunded, not honoured
-- date C: four offers after capacity rises to 3      -> capacity is honoured, not hard-coded to 1
-- date D: one offer that is never accepted           -> there is no window to pay into
create temp table qa1 (id uuid);
create temp table qa2 (id uuid);
create temp table qa3 (id uuid);
create temp table qb1 (id uuid);
create temp table qb2 (id uuid);
create temp table qc1 (id uuid);
create temp table qc2 (id uuid);
create temp table qc3 (id uuid);
create temp table qc4 (id uuid);
create temp table qd1 (id uuid);
create temp table outcome (which text, value text);
create temp table marker (nid uuid);
grant select on ids to authenticated, service_role;
grant select, insert on qa1, qa2, qa3, qb1, qb2, qc1, qc2, qc3, qc4, qd1, outcome, marker
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The vendor sends offers, and accepting one opens a 24-hour window
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-viki'), true);
  insert into qa1 select public.create_quote(vendor, ada,   date_a, 'Ada: aso ebi',
    '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  insert into qa2 select public.create_quote(vendor, bola,  date_a, 'Bola: aso ebi',
    '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  insert into qa3 select public.create_quote(vendor, chidi, date_a, 'Chidi: aso ebi',
    '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  insert into qb1 select public.create_quote(vendor, dele,  date_b, 'Dele: lace',
    '[{"label":"Lace","line_total_minor":90000}]'::jsonb, '[]'::jsonb) from ids;
  insert into qd1 select public.create_quote(vendor, ada,   date_d, 'Ada: never accepted',
    '[{"label":"Fabric","line_total_minor":1000}]'::jsonb, '[]'::jsonb) from ids;
  -- sent in this order, so the date-A slots are 1, 2 and 3 against a capacity of one
  select public.send_quote(qa1.id, q.version) from qa1 join public.quotes q on q.id = qa1.id;
  select public.send_quote(qa2.id, q.version) from qa2 join public.quotes q on q.id = qa2.id;
  select public.send_quote(qa3.id, q.version) from qa3 join public.quotes q on q.id = qa3.id;
  select public.send_quote(qb1.id, q.version) from qb1 join public.quotes q on q.id = qb1.id;
  select public.send_quote(qd1.id, q.version) from qd1 join public.quotes q on q.id = qd1.id;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-one'), true);
  select public.accept_quote(q.id, q.version)
    from qa1 a join public.quotes q on q.id = a.id;   -- Ada: slot 1 of 1, uncontested
commit;

do $$
declare h public.quote_payment_holds; v_lock public.quote_date_locks;
begin
  select * into h from public.quote_payment_holds where quote_id = (select id from qa1);
  select * into v_lock from public.quote_date_locks where quote_id = (select id from qa1);
  assert h.id is not null, 'accepting a quote creates the soft hold';
  assert h.status = 'awaiting_payment', 'a fresh hold waits for payment';
  assert h.payment_due_at between now() + interval '23 hours 59 minutes'
                               and now() + interval '24 hours 1 minute',
    'the window is the server-owned 24 hours, got ' || h.payment_due_at;
  assert h.confirmed_at is null and h.released_at is null and h.paid_minor is null,
    'nothing has happened to it yet';
  assert h.vendor_house_id = (select vendor from ids) and h.host_house_id = (select ada from ids),
    'the hold carries both houses';
  assert h.lock_id = v_lock.id and h.service_date = v_lock.service_date,
    'the hold is the F-14 date lock, not a second calendar';
  assert v_lock.released_at is null, 'the date stays locked while the window is open';
  assert not exists (select 1 from public.notifications where kind = 'date_competing'
                       and house_id = (select ada from ids)),
    'a hold inside capacity is not contested';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Above capacity the date is contested, and both houses are told
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-two'), true);
  select public.accept_quote(q.id, q.version) from qa2 a join public.quotes q on q.id = a.id;
commit;

do $$
declare h public.quote_payment_holds;
begin
  select * into h from public.quote_payment_holds where quote_id = (select id from qa2);
  assert (select slot from public.quote_date_locks where id = h.lock_id) = 2,
    'the second live lock on the date is in slot 2';
  assert (select count(*) from public.notifications
          where kind = 'date_competing'
            and payload ->> 'quote_id' = (select id::text from qa2)) = 2,
    'one contested date alerts the host house and the vendor house; neither insert is swallowed';
  assert exists (select 1 from public.notifications where kind = 'date_competing'
                   and house_id = (select bola from ids) and title = 'Another host is engaging this date'),
    'the host is told another host is engaging the date';
  assert exists (select 1 from public.notifications where kind = 'date_competing'
                   and house_id = (select vendor from ids)), 'the vendor is told too';
end $$;

begin;  -- Chidi accepts as well: slot 3, contested
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-three'), true);
  select public.accept_quote(q.id, q.version) from qa3 a join public.quotes q on q.id = a.id;
commit;

begin;  -- the vendor's calendar projection, read as the vendor
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-viki'), true);
  insert into outcome
    select 'projection', coalesce(string_agg(h.lock_slot::text || ':' || h.competing::text || ':'
        || h.is_vendor_side::text || ':' || h.counterparty_name, ' ' order by h.lock_slot), 'none')
    from public.my_date_holds((select vendor from ids)) h
    where h.quote_id in (select id from qa1 union select id from qa2 union select id from qa3);
commit;

do $$
declare v text;
begin
  select value into v from outcome where which = 'projection';
  assert v like '1:false:true:F38 Ada%', 'Ada is the first slot, uncontested, vendor side: ' || v;
  assert v like '%2:true:true:F38 Bola%', 'Bola is a competing hold, slot 2 of 1: ' || v;
  assert v like '%3:true:true:F38 Chidi%', 'Chidi is competing too: ' || v;
end $$;

-- ---------------------------------------------------------------------------
-- 3. No client can record a payment, and the reported input is checked first
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-one'), true);
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from qa1), 'psp_self_claimed', 100000, 'NGN'), 'permission denied');
  select pg_temp.expect_error('select public.release_lapsed_payment_holds()', 'permission denied');
commit;
begin;
  set local role anon;
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from qa1), 'psp_anon', 100000, 'NGN'), 'permission denied');
commit;

begin;  -- the server validates the provider's report before believing any of it
  set local role service_role;
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from qa1), '', 100, 'NGN'), 'payment_reference_required');
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from qa1), 'psp_zero', 0, 'NGN'), 'invalid_paid_amount');
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    gen_random_uuid(), 'psp_ghost', 100, 'NGN'), 'quote_not_found');
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from qd1), 'psp_no_window', 100, 'NGN'), 'hold_not_found');
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from qa1), 'psp_wrong_ccy', 100, 'USD'), 'currency_mismatch');
commit;

do $$ begin
  -- a refused confirmation changed nothing: the quote is still accepted and its window still open
  assert (select status from public.quotes where id = (select id from qa1)) = 'accepted',
    'refused confirmations left the quote accepted and unpaid';
  assert (select status from public.quote_payment_holds where quote_id = (select id from qa1))
    = 'awaiting_payment', 'and left its window open';
  assert not exists (select 1 from public.refund_obligations), 'and recorded no obligation';
end $$;

-- ---------------------------------------------------------------------------
-- 4. First confirmed payment wins; the unpaid soft holds on that date lose
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome select 'ada_payment',
    public.record_payment_confirmation((select id from qa1), 'psp_ada_1', 100000, 'NGN');
commit;

do $$
declare h public.quote_payment_holds;
begin
  assert (select value from outcome where which = 'ada_payment') = 'confirmed',
    'the first payment wins';
  select * into h from public.quote_payment_holds where quote_id = (select id from qa1);
  assert h.status = 'confirmed' and h.confirmed_at is not null
    and h.paid_minor = 100000 and h.paid_currency = 'NGN' and h.payment_reference = 'psp_ada_1',
    'the confirmation is recorded with what was paid';
  assert h.released_at is null, 'a confirmed hold keeps its date';
  assert exists (select 1 from public.quote_date_locks where quote_id = (select id from qa1)
                   and released_at is null), 'the date lock stays live as the real booking';
  assert (select status from public.quote_payment_holds where quote_id = (select id from qa2)) = 'released',
    'Bola lost the date';
  assert (select release_reason from public.quote_payment_holds where quote_id = (select id from qa2)) = 'outbid',
    'and it is recorded as outbid';
  assert (select status from public.quote_payment_holds where quote_id = (select id from qa3)) = 'released',
    'Chidi lost it too';
  assert (select released_at from public.quote_date_locks where quote_id = (select id from qa2)) is not null,
    'the losing date locks were released';
  assert not exists (select 1 from public.refund_obligations),
    'nothing is owed to a host who never paid';
  assert (select count(*) from public.notifications where kind = 'date_outbid'
          and house_id = (select bola from ids)) = 1, 'Bola is told the date went elsewhere';
  assert (select count(*) from public.notifications where kind = 'date_outbid'
          and house_id = (select chidi from ids)) = 1, 'so is Chidi';
  assert exists (select 1 from public.notifications where kind = 'date_secured'
                   and house_id = (select ada from ids)), 'Ada is told her date is confirmed';
  assert exists (select 1 from public.notifications where kind = 'date_secured'
                   and house_id = (select vendor from ids)), 'the vendor is told the date is taken';
  assert (select count(*) from public.audit_events where action = 'payment.confirmed') = 1,
    'the confirmation is audited once';
end $$;

begin;  -- the same webhook delivered twice: same answer, nothing written twice
  set local role service_role;
  insert into outcome select 'ada_retry',
    public.record_payment_confirmation((select id from qa1), 'psp_ada_1', 100000, 'NGN');
  select pg_temp.expect_error(format(  -- a second payment for a paid date is refused, not taken
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from qa1), 'psp_ada_2', 100000, 'NGN'), 'payment_already_recorded');
commit;

do $$ begin
  assert (select value from outcome where which = 'ada_retry') = 'confirmed', 'the retry reports the same outcome';
  assert (select count(*) from public.audit_events where action = 'payment.confirmed') = 1,
    'the retry added no second audit row';
  assert (select count(*) from public.notifications where kind = 'date_secured'
          and house_id = (select ada from ids)) = 1, 'the retry added no second alert';
  assert (select paid_minor from public.quote_payment_holds where quote_id = (select id from qa1)) = 100000,
    'and did not change the amount';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Money that arrives after the date was won is owed back and never takes the date
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome select 'bola_payment',
    public.record_payment_confirmation((select id from qa2), 'psp_bola_1', 100000, 'NGN');
  insert into outcome select 'bola_retry',
    public.record_payment_confirmation((select id from qa2), 'psp_bola_1', 100000, 'NGN');
  insert into outcome select 'chidi_payment',
    public.record_payment_confirmation((select id from qa3), 'psp_chidi_1', 100000, 'NGN');
commit;

do $$
declare o public.refund_obligations;
begin
  assert (select value from outcome where which = 'bola_payment') = 'refund_required',
    'a losing payment is refunded';
  assert (select value from outcome where which = 'bola_retry') = 'refund_required',
    'the retry reports the same outcome';
  assert (select value from outcome where which = 'chidi_payment') = 'refund_required',
    'a payment onto a date that was lost while unpaid is also refunded';
  select * into o from public.refund_obligations where quote_id = (select id from qa2);
  assert o.refund_minor = 100000 and o.currency = 'NGN' and o.payment_reference = 'psp_bola_1',
    'the ledger row says what is owed and for which payment';
  assert o.reason = 'outbid' and o.hold_id = (select id from public.quote_payment_holds
                                              where quote_id = (select id from qa2)),
    'and why';
  assert (select reason from public.refund_obligations where quote_id = (select id from qa3)) = 'outbid',
    'the same rule covers the host who paid after being outbid';
  assert (select count(*) from public.refund_obligations) = 2,
    'a retried webhook cannot record the same refund twice, one obligation per hold';
  assert (select count(*) from public.quote_payment_holds
          where vendor_house_id = (select vendor from ids)
            and service_date = (select date_a from ids) and status = 'confirmed') = 1,
    'Ada is still the only confirmed booking on that date';
  assert (select status from public.quote_payment_holds where quote_id = (select id from qa2)) = 'released',
    'the losing hold never became a booking';
  assert exists (select 1 from public.notifications where kind = 'refund_pending'
                   and house_id = (select bola from ids)), 'Bola is told a refund is on its way';
  assert exists (select 1 from public.audit_events where action = 'payment.refund_obligation'),
    'and the obligation is audited';
end $$;

-- ---------------------------------------------------------------------------
-- 6. A window that closes releases the date; a payment that lands later is refunded
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-four'), true);
  select public.accept_quote(q.id, q.version) from qb1 b join public.quotes q on q.id = b.id;
commit;

update public.quote_payment_holds
   set payment_due_at = now() - interval '2 minutes'
 where quote_id = (select id from qb1);

begin;  -- reading the calendar is what settles the closed window, scoped to this house
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-four'), true);
  insert into outcome
    select 'dele_hold', h.status || '/' || h.release_reason
    from public.my_date_holds((select dele from ids)) h
    where h.quote_id = (select id from qb1);
commit;

do $$
declare l public.quote_date_locks;
begin
  assert (select value from outcome where which = 'dele_hold') = 'released/payment_window_closed',
    'the deadline, not the caller, decided';
  select * into l from public.quote_date_locks where quote_id = (select id from qb1);
  assert l.released_at is not null, 'the F-14 date lock was released';
  assert l.release_reason = 'payment_window_closed', 'with the same reason';
  assert exists (select 1 from public.notifications where kind = 'payment_window_closed'
                   and house_id = (select dele from ids)), 'the host is told the window closed';
  assert exists (select 1 from public.notifications where kind = 'payment_window_closed'
                   and house_id = (select vendor from ids)), 'so is the vendor';
  assert exists (select 1 from public.audit_events where action = 'hold.payment_window_closed'),
    'and it is audited';
end $$;

begin;  -- the freed slot is usable again: a new offer on that date takes slot 1
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-viki'), true);
  insert into qb2 select public.create_quote(vendor, dele, date_b, 'Dele: second try',
    '[{"label":"Lace","line_total_minor":80000}]'::jsonb, '[]'::jsonb) from ids;
  select public.send_quote(q.id, q.version) from qb2 b join public.quotes q on q.id = b.id;
commit;
do $$ begin
  assert (select slot from public.quote_date_locks where quote_id = (select id from qb2)) = 1,
    'the released date is available again, so the new lock is in slot 1';
end $$;

begin;  -- Dele pays for the window that already closed
  set local role service_role;
  insert into outcome select 'dele_late',
    public.record_payment_confirmation((select id from qb1), 'psp_dele_late', 90000, 'NGN');
  insert into outcome select 'dele_late_retry',
    public.record_payment_confirmation((select id from qb1), 'psp_dele_late', 90000, 'NGN');
commit;
do $$
declare o public.refund_obligations;
begin
  assert (select value from outcome where which = 'dele_late') = 'refund_required',
    'a late payment never takes the date';
  assert (select value from outcome where which = 'dele_late_retry') = 'refund_required',
    'and a retry says the same';
  select * into o from public.refund_obligations where quote_id = (select id from qb1);
  assert o.reason = 'late_payment' and o.refund_minor = 90000 and o.currency = 'NGN',
    'the obligation is recorded as a late payment';
  assert (select status from public.quote_payment_holds where quote_id = o.quote_id) = 'released',
    'the lapsed hold was not reopened';
  assert (select count(*) from public.refund_obligations) = 3, 'and recorded exactly once';
end $$;

begin;  -- the scheduler entry point works for the server
  set local role service_role;
  insert into outcome select 'sweep', public.release_lapsed_payment_holds()::text;
commit;
do $$ begin
  assert (select value from outcome where which = 'sweep') = '0',
    'the unscoped sweep finds nothing left to close, because reads already settled this house';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Capacity is honoured: with three slots three payments win and the fourth is refunded
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-viki'), true);
  select public.set_vendor_daily_capacity(vendor, 3) from ids;
  insert into qc1 select public.create_quote(vendor, ada,   date_c, 'Ada: capacity test',
    '[{"label":"Fabric","line_total_minor":10000}]'::jsonb, '[]'::jsonb) from ids;
  insert into qc2 select public.create_quote(vendor, bola,  date_c, 'Bola: capacity test',
    '[{"label":"Fabric","line_total_minor":10000}]'::jsonb, '[]'::jsonb) from ids;
  insert into qc3 select public.create_quote(vendor, chidi, date_c, 'Chidi: capacity test',
    '[{"label":"Fabric","line_total_minor":10000}]'::jsonb, '[]'::jsonb) from ids;
  insert into qc4 select public.create_quote(vendor, dele,  date_c, 'Dele: capacity test',
    '[{"label":"Fabric","line_total_minor":10000}]'::jsonb, '[]'::jsonb) from ids;
  select public.send_quote(q.id, q.version) from qc1 c join public.quotes q on q.id = c.id;
  select public.send_quote(q.id, q.version) from qc2 c join public.quotes q on q.id = c.id;
  select public.send_quote(q.id, q.version) from qc3 c join public.quotes q on q.id = c.id;
  select public.send_quote(q.id, q.version) from qc4 c join public.quotes q on q.id = c.id;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-one'), true);
  select public.accept_quote(q.id, q.version) from qc1 c join public.quotes q on q.id = c.id;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-two'), true);
  select public.accept_quote(q.id, q.version) from qc2 c join public.quotes q on q.id = c.id;
commit;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-three'), true);
  select public.accept_quote(q.id, q.version) from qc3 c join public.quotes q on q.id = c.id;
commit;
begin;  -- Dele is slot 4 against capacity 3, so accepting him contests the date
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-four'), true);
  select public.accept_quote(q.id, q.version) from qc4 c join public.quotes q on q.id = c.id;
commit;

do $$ begin
  assert (select count(*) from public.notifications where kind = 'date_competing'
          and payload ->> 'service_date' = (select date_c::text from ids)) = 2,
    'only the fourth host on that date is contested, and both houses hear about it';
  assert (select count(distinct payload ->> 'quote_id') from public.notifications
          where kind = 'date_competing'
            and payload ->> 'service_date' = (select date_c::text from ids)) = 1,
    'and it is the same quote on both sides';
end $$;

begin;  -- three payments fill three slots; the fourth hold loses when the date becomes full
  set local role service_role;
  insert into outcome select 'c1', public.record_payment_confirmation((select id from qc1), 'psp_c1', 10000, 'NGN');
  insert into outcome select 'c2', public.record_payment_confirmation((select id from qc2), 'psp_c2', 10000, 'NGN');
  insert into outcome select 'c3', public.record_payment_confirmation((select id from qc3), 'psp_c3', 10000, 'NGN');
  insert into outcome select 'c4', public.record_payment_confirmation((select id from qc4), 'psp_c4', 10000, 'NGN');
commit;

do $$ begin
  assert (select count(*) from outcome where which in ('c1','c2','c3') and value = 'confirmed') = 3,
    'three bookings fit in three slots';
  assert (select value from outcome where which = 'c4') = 'refund_required',
    'the fourth is owed its money back';
  assert (select count(*) from public.quote_payment_holds
          where service_date = (select date_c from ids) and status = 'confirmed') = 3,
    'the vendor has exactly three confirmed bookings on that date';
  assert (select release_reason from public.quote_payment_holds
          where quote_id = (select id from qc4)) = 'outbid',
    'the fourth lost its chance as soon as the date filled up';
  assert (select reason from public.refund_obligations
          where quote_id = (select id from qc4)) = 'outbid';
  assert (select count(*) from public.quote_date_locks
          where service_date = (select date_c from ids) and released_at is null) = 3,
    'only the three paid date locks remain live';
end $$;

-- ---------------------------------------------------------------------------
-- 8. The ledger and the money columns are protected in the database
-- ---------------------------------------------------------------------------
select pg_temp.expect_error('update public.refund_obligations set refund_minor = 1', 'append-only');
select pg_temp.expect_error('delete from public.refund_obligations', 'append-only');
select pg_temp.expect_error('truncate public.refund_obligations', 'append-only');
select pg_temp.expect_error(format(
  'update public.quote_payment_holds set paid_currency = %L where quote_id = (select id from qa1)', 'USD'),
  'currency_mismatch');

-- ---------------------------------------------------------------------------
-- 9. Default-deny: strangers read nothing, and nobody writes a table directly
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-out'), true);
  do $$ begin
    assert (select count(*) from public.quote_payment_holds) = 0, 'a stranger sees no holds';
    assert (select count(*) from public.refund_obligations) = 0, 'a stranger sees no ledger rows';
    assert (select count(*) from public.notifications) = 0, 'a stranger sees no alerts';
  end $$;
  select pg_temp.expect_error(format('select count(*) from public.my_date_holds(%L)',
    (select vendor from ids)), 'forbidden');
  select pg_temp.expect_error(format('select count(*) from public.my_notifications(%L)',
    (select vendor from ids)), 'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-viki'), true);
  select pg_temp.expect_error(
    $q$insert into public.quote_payment_holds (quote_id, lock_id, vendor_house_id, host_house_id,
       service_date, payment_due_at)
     select quote_id, lock_id, vendor_house_id, host_house_id, service_date, now()
       from public.quote_payment_holds$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$insert into public.notifications (house_id, house_kind, kind, title, body, dedupe_key)
     values (gen_random_uuid(), 'vendor', 'date_secured', 'forged', 'forged', 'forged-1')$q$,
    'permission denied');
  select pg_temp.expect_error($q$update public.quote_payment_holds set payment_due_at = now()$q$,
    'permission denied');
  select pg_temp.expect_error($q$update public.notifications set read_at = now()$q$,
    'permission denied');
commit;
begin;
  set local role anon;
  select pg_temp.expect_error('select * from public.quote_payment_holds', 'permission denied');
  select pg_temp.expect_error('select * from public.refund_obligations', 'permission denied');
  select pg_temp.expect_error('select * from public.notifications', 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 10. Alerts stay inside their house; dismissing one is idempotent
-- ---------------------------------------------------------------------------
insert into marker select id from public.notifications where house_id = (select vendor from ids) limit 1;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f38-one'), true);
  do $$
  declare v_id uuid; v_all integer; v_unread integer;
  begin
    select id into v_id from public.my_notifications((select ada from ids)) limit 1;
    perform public.mark_notification_read(v_id);
    perform public.mark_notification_read(v_id);   -- already read: still fine
    select count(*) into v_all from public.my_notifications((select ada from ids));
    select count(*) into v_unread from public.my_notifications((select ada from ids))
      where read_at is null;
    assert (select read_at from public.my_notifications((select ada from ids)) where id = v_id) is not null,
      'Ada can dismiss her own alert';
    assert v_all >= 1 and v_unread = v_all - 1,
      'dismissing one alert left exactly one fewer unread, got ' || v_all || '/' || v_unread;
  end $$;
  select pg_temp.expect_error(format('select public.mark_notification_read(%L)', (select nid from marker)),
    'forbidden');
commit;

do $$ begin
  assert not exists (select 1 from public.notifications
                     where split_part(dedupe_key, '|', 1) <> house_id::text),
    'each alert is deduped inside its own house, so both parties get their own wording';
  assert not exists (select 1 from public.notifications
                     where house_id = (select ada from ids)
                       and dedupe_key like (select vendor::text || '%' from ids)),
    'no house carries another house''s alert key';
end $$;

-- ---------------------------------------------------------------------------
-- 11. Diagnostics and alerts never carry money, references or offer contents
-- ---------------------------------------------------------------------------
do $$ begin
  assert not exists (select 1 from public.audit_events
                     where details::text ilike '%psp_%'
                        or details::text ilike '%payment_reference%'
                        or details::text ilike '%refund_minor%'),
    'audit details carry identifiers, not payment references or amounts';
  assert not exists (select 1 from public.notifications
                     where payload ?& array['payment_reference', 'paid_minor', 'refund_minor', 'inclusions']),
    'alert payloads carry dates and ids, not payment data or offer lines';
  assert exists (select 1 from public.audit_events where action = 'hold.created'),
    'every window start is audited';
  assert (select count(*) from public.audit_events where action like 'hold.%') >= 5,
    'releases are audited too';
end $$;

\o
\pset tuples_only on
select 'F-38 vendor calendar soft-hold tests passed' as result;
