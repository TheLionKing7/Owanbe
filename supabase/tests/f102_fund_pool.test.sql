-- F-102 fund pool / escrow tests. Raises on the first failure.
-- Covers: accepting a quote creates the booking and its pool; the money is allocated 70/30 with
-- the commission taken off the vendor's share; every ledger entry balances; a replayed payment
-- posts nothing twice; the host completes the booking and the last 30% goes out; a host refund
-- of the money still held leaves no duplicate effect; a dispute freeze blocks the release; and
-- no client writes the ledger.
--
-- Three bookings on three dates, so nothing competes for a date and each scenario is its own
-- booking: one completed, one refunded, one frozen.
\set ON_ERROR_STOP on
\o /dev/null
select app_private.configure_auth0('owanbe.us.auth0.com', 'https://api.owanbe.app');

create function pg_temp.claims(sub text) returns text language sql as $$
  select jsonb_build_object('sub', sub, 'iss', 'https://api.owanbe.us.auth0.com/', 'aud', 'https://api.owanbe.app',
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
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures: one vendor, one host, one staff arbitrator, one house that is not a party
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, display_name) values
  ('auth0|f102-vendor', 'vendor@example.test', 'Vee Fabrics'),
  ('auth0|f102-host',   'host@example.test',   'Ada Adeyemi'),
  ('auth0|f102-staff',  'staff@example.test',  'Grace Arbitrator'),
  ('auth0|f102-root',   'root@example.test',   'Root Admin'),
  ('auth0|f102-out',    'out@example.test',    'Erin Stranger');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', u.id, 'F102 Vendor' from public.users u where u.auth0_sub = 'auth0|f102-vendor';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F102 Ada' from public.users u where u.auth0_sub = 'auth0|f102-host';

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select h.id, h.kind, h.owner_user_id, 'owner', '{}' from public.houses h
  where h.display_name like 'F102 %';

-- One arbitrator with a global grant. The grant needs a granter who is not the holder.
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'arbitrator', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f102-staff' and r.auth0_sub = 'auth0|f102-root';

create temp table ids (
  vendor uuid, host uuid, staff uuid, root uuid, outsider uuid,
  date_a date, date_b date, date_c date);
insert into ids
  select (select id from public.houses where display_name = 'F102 Vendor'),
         (select id from public.houses where display_name = 'F102 Ada'),
         (select id from public.users where auth0_sub = 'auth0|f102-staff'),
         (select id from public.users where auth0_sub = 'auth0|f102-root'),
         (select id from public.users where auth0_sub = 'auth0|f102-out'),
         current_date + 300, current_date + 301, current_date + 302;

create temp table q1 (id uuid);
create temp table q2 (id uuid);
create temp table q3 (id uuid);
create temp table b1 (id uuid);
create temp table b2 (id uuid);
create temp table b3 (id uuid);
create temp table outcome (which text, value text);
grant select on ids, q1, q2, q3, b1, b2, b3, outcome to authenticated, service_role;
grant insert on outcome to authenticated, service_role;

-- The vendor sends three offers on three dates, each worth 100,000 kobo.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-vendor'), true);
  insert into q1 select public.create_quote(vendor, host, date_a, 'NGN', 'Ada: aso ebi',
    '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  insert into q2 select public.create_quote(vendor, host, date_b, 'NGN', 'Ada: lace',
    '[{"label":"Lace","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  insert into q3 select public.create_quote(vendor, host, date_c, 'NGN', 'Ada: photos',
    '[{"label":"Photos","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  select public.send_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
  select public.send_quote(q.id, v.version) from q2 join public.quotes v on v.id = q2.id;
  select public.send_quote(q.id, v.version) from q3 join public.quotes v on v.id = q3.id;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  select public.accept_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
  select public.accept_quote(q.id, v.version) from q2 join public.quotes v on v.id = q2.id;
  select public.accept_quote(q.id, v.version) from q3 join public.quotes v on v.id = q3.id;
commit;

insert into b1 select id from public.bookings where quote_id = (select id from q1);
insert into b2 select id from public.bookings where quote_id = (select id from q2);
insert into b3 select id from public.bookings where quote_id = (select id from q3);

-- ---------------------------------------------------------------------------
-- 1. Accepting a quote creates the booking and the pool it is paid into
-- ---------------------------------------------------------------------------
do $$ declare r record; p record; begin
  select * into r from public.bookings where id = (select id from b1);
  assert r.id is not null, 'accepting a quote creates a booking';
  assert r.status = 'awaiting_payment', 'a new booking waits for its payment';
  assert r.total_minor = 100000 and r.currency = 'NGN', 'the booking carries the agreed total';
  assert r.host_house_id = (select host from ids) and r.vendor_house_id = (select vendor from ids),
    'the booking carries both houses';

  select * into p from public.fund_pool where booking_id = (select id from b1);
  assert p.id is not null, 'the booking has a fund pool';
  assert p.paid_minor = 0 and p.held_minor = 0, 'nothing is paid yet';
  assert p.total_minor = 100000 and p.currency = 'NGN', 'the pool carries the agreed total';
  assert p.status = 'awaiting_payment', 'the pool waits for its payment';
  assert p.frozen = false, 'the pool is not held';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The money arrives: 70% now, 30% after, the commission off the vendor's share
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome values ('allocate_1', public.allocate_split_payment(
    (select id from b1), 'owanbe-ref1', 100000, 'NGN'));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'allocate_1';
  assert v = 'allocated', 'the payment is allocated, got ' || v;

  select * into r from public.fund_pool where booking_id = (select id from b1);
  assert r.paid_minor = 100000, 'the whole amount is paid, got ' || r.paid_minor::text;
  assert r.released_70_minor = 70000, 'the first 70% goes out, got ' || r.released_70_minor::text;
  assert r.held_minor = 30000, 'the last 30% is held, got ' || r.held_minor::text;
  assert r.commission_minor = 1750, 'the commission is 2.5% of the first tranche, got '
    || r.commission_minor::text;
  assert r.tax_minor = 0, 'no tax is taken until the owner sets a rate';
  assert r.vendor_net_minor = 68250, 'the vendor keeps the rest of the tranche, got '
    || r.vendor_net_minor::text;
  assert r.status = 'partially_released', 'the pool is partly out, got ' || r.status;
  assert r.release_30_due_at is not null, 'the window for the last 30% is open';
  assert r.release_30_due_at > now(), 'the window is in the future';
  assert r.payment_reference = 'owanbe-ref1', 'the provider reference is kept';
end $$;

do $$ declare b record; begin
  select * into b from public.bookings where id = (select id from b1);
  assert b.status = 'paid', 'the booking is paid, got ' || b.status;
  assert b.confirmed_at is not null, 'the booking is confirmed';
end $$;

-- The ledger: one entry for the hold, one for the first release, and both balance.
do $$ declare n bigint; e bigint; begin
  select count(*) into e from public.journal_entries where booking_id = (select id from b1);
  assert e = 2, 'two entries for the booking, got ' || e::text;

  select count(*) into n from (
    select je.id
      from public.journal_entries je
      join public.postings p on p.entry_id = je.id
     where je.booking_id = (select id from b1)
     group by je.id, p.currency
    having sum(p.amount_minor) <> 0) unbalanced;
  assert n = 0, 'every entry balances, got ' || n::text || ' that do not';

  select count(*) into n from public.postings p
    join public.ledger_accounts a on a.id = p.ledger_account_id
   where p.entry_id in (select id from public.journal_entries where booking_id = (select id from b1))
     and a.code = 'paystack_clearing';
  assert n = 1, 'the money sits in the provider''s clearing account';
end $$;

-- The trail a host reads: the payment and the first release.
do $$ declare n bigint; begin
  select count(*) into n from public.wallet_ledger where booking_id = (select id from b1);
  assert n = 2, 'two movements for the booking, got ' || n::text;
  select count(*) into n from public.wallet_ledger
   where booking_id = (select id from b1) and movement = 'booking_hold' and amount_minor = 100000;
  assert n = 1, 'the payment is in the trail';
  select count(*) into n from public.wallet_ledger
   where booking_id = (select id from b1) and movement = 'release_70' and amount_minor = 70000;
  assert n = 1, 'the first release is in the trail';
end $$;

-- ---------------------------------------------------------------------------
-- 3. A replayed payment posts nothing twice
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome values ('replay_1', public.allocate_split_payment(
    (select id from b1), 'owanbe-ref1', 100000, 'NGN'));
commit;

do $$ declare v text; e bigint; begin
  select value into v from outcome where which = 'replay_1';
  assert v = 'allocated', 'the same payment is still allocated, got ' || v;
  select count(*) into e from public.journal_entries where booking_id = (select id from b1);
  assert e = 2, 'the replay posted nothing, got ' || e::text || ' entries';
end $$;

-- A second payment on a booking that is already paid is refused.
begin;
  set local role service_role;
  select pg_temp.expect_error(
    $q$select public.allocate_split_payment((select id from b1), 'owanbe-ref2', 100000, 'NGN')$q$,
    'payment_already_recorded');
commit;

-- The money has to match the booking.
begin;
  set local role service_role;
  select pg_temp.expect_error(
    $q$select public.allocate_split_payment((select id from b2), 'owanbe-ref3', 50000, 'NGN')$q$,
    'payment_below_quote_total');
  select pg_temp.expect_error(
    $q$select public.allocate_split_payment((select id from b2), 'owanbe-ref4', 100000, 'USD')$q$,
    'currency_mismatch');
  select pg_temp.expect_error(
    $q$select public.allocate_split_payment((select id from b2), '  ', 100000, 'NGN')$q$,
    'payment_reference_required');
commit;

-- ---------------------------------------------------------------------------
-- 4. The host confirms the celebration happened: the last 30% goes out
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  insert into outcome values ('complete_1', public.complete_booking((select id from b1)));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'complete_1';
  assert v = 'released', 'the last tranche is released, got ' || v;

  select * into r from public.fund_pool where booking_id = (select id from b1);
  assert r.released_30_minor = 30000, 'the last 30% goes out, got ' || r.released_30_minor::text;
  assert r.held_minor = 0, 'nothing is held any more, got ' || r.held_minor::text;
  assert r.status = 'released', 'the pool is fully out, got ' || r.status;
  assert r.commission_minor = 2500, 'the commission is 2.5% of the whole booking, got '
    || r.commission_minor::text;
  assert r.vendor_net_minor = 97500, 'the vendor keeps 97.5%, got ' || r.vendor_net_minor::text;
  assert r.completed_at is not null, 'the completion is recorded';
end $$;

do $$ declare n bigint; begin
  select count(*) into n from (
    select je.id
      from public.journal_entries je
      join public.postings p on p.entry_id = je.id
     where je.booking_id = (select id from b1)
     group by je.id, p.currency
    having sum(p.amount_minor) <> 0) unbalanced;
  assert n = 0, 'every entry still balances';

  select count(*) into n from public.wallet_ledger where booking_id = (select id from b1);
  assert n = 3, 'the trail holds the payment and both releases, got ' || n::text;
end $$;

-- The booking that is paid out holds nothing to refund.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  select pg_temp.expect_error(
    $q$select public.request_fund_refund((select id from b1), 'The date changed')$q$,
    'nothing_held_to_refund');
commit;

-- ---------------------------------------------------------------------------
-- 5. The host asks for the money back: one effect, never two
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome values ('allocate_2', public.allocate_split_payment(
    (select id from b2), 'owanbe-ref5', 100000, 'NGN'));
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  insert into outcome values ('refund_2', public.request_fund_refund(
    (select id from b2), 'The date changed and we cannot go ahead'));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'refund_2';
  assert v = 'refund_pending', 'the money is owed back, got ' || v;

  select * into r from public.fund_pool where booking_id = (select id from b2);
  assert r.refunded_minor = 30000, 'the money still held is refunded, got ' || r.refunded_minor::text;
  assert r.held_minor = 0, 'nothing is held any more, got ' || r.held_minor::text;
  assert r.status = 'refund_pending', 'the refund is waiting on the provider, got ' || r.status;
end $$;

-- The same request again changes nothing.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  insert into outcome values ('refund_2_again', public.request_fund_refund(
    (select id from b2), 'The date changed and we cannot go ahead'));
commit;

do $$ declare v text; n bigint; begin
  select value into v from outcome where which = 'refund_2_again';
  assert v = 'refunded', 'the second request changes nothing, got ' || v;
  select count(*) into n from public.wallet_ledger
   where booking_id = (select id from b2) and movement = 'refund';
  assert n = 1, 'the refund is in the trail once, got ' || n::text;
end $$;

-- The provider sends the money back, and the ledger follows.
begin;
  set local role service_role;
  insert into outcome values ('settle_2', public.settle_refund((select id from b2), 'owanbe-refund-2'));
commit;

do $$ declare v text; r record; n bigint; begin
  select value into v from outcome where which = 'settle_2';
  assert v = 'settled', 'the refund is settled, got ' || v;

  select * into r from public.fund_pool where booking_id = (select id from b2);
  assert r.status = 'refunded', 'the pool says refunded, got ' || r.status;

  select count(*) into n from public.wallet_ledger
   where booking_id = (select id from b2) and movement = 'refund_settled';
  assert n = 1, 'the settled refund is in the trail once, got ' || n::text;

  select count(*) into n from (
    select je.id
      from public.journal_entries je
      join public.postings p on p.entry_id = je.id
     where je.booking_id = (select id from b2)
     group by je.id, p.currency
    having sum(p.amount_minor) <> 0) unbalanced;
  assert n = 0, 'every entry still balances after the refund';
end $$;

-- A refund needs a reason, and a reason that is not a credential.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  select pg_temp.expect_error(
    $q$select public.request_fund_refund((select id from b3), '')$q$, 'reason_required');
  select pg_temp.expect_error(
    $q$select public.request_fund_refund((select id from b3), 'card 4242 4242 4242 4242')$q$,
    'reason_rejected');
commit;

-- ---------------------------------------------------------------------------
-- 6. A dispute freezes the money, and the release waits
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome values ('allocate_3', public.allocate_split_payment(
    (select id from b3), 'owanbe-ref6', 100000, 'NGN'));
commit;

-- Only a staff member with an arbitrator grant may freeze a pool.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  select pg_temp.expect_error(
    $q$select public.freeze_fund_pool((select id from b3), 'A dispute is open')$q$,
    'forbidden: arbitrator grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-staff'), true);
  select public.freeze_fund_pool((select id from b3), 'A dispute is open');
commit;

do $$ declare r record; begin
  select * into r from public.fund_pool where booking_id = (select id from b3);
  assert r.frozen = true, 'the pool is frozen';
  assert r.frozen_reason = 'A dispute is open', 'the reason is kept';
  assert r.frozen_at is not null, 'the freeze is dated';
end $$;

-- The host cannot complete a booking whose money is held.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  select pg_temp.expect_error(
    $q$select public.complete_booking((select id from b3))$q$, 'fund_pool_frozen');
commit;

-- The host cannot refund money that a dispute is holding either.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  select pg_temp.expect_error(
    $q$select public.request_fund_refund((select id from b3), 'The date changed')$q$,
    'fund_pool_frozen');
commit;

-- The sweep does not release a frozen pool, even when the window has closed.
update public.fund_pool set release_30_due_at = now() - interval '1 hour'
 where booking_id = (select id from b3);
begin;
  set local role service_role;
  select public.release_due_fund_tranches();
commit;

do $$ declare r record; begin
  select * into r from public.fund_pool where booking_id = (select id from b3);
  assert r.released_30_minor = 0, 'the frozen money stays where it is, got '
    || r.released_30_minor::text;
  assert r.held_minor = 30000, 'the money is still held, got ' || r.held_minor::text;
end $$;

-- Lifting the freeze moves the deadline by the time the money was held.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-staff'), true);
  select public.unfreeze_fund_pool((select id from b3));
commit;

do $$ declare r record; begin
  select * into r from public.fund_pool where booking_id = (select id from b3);
  assert r.frozen = false, 'the pool is free again';
  assert r.frozen_reason is null, 'the reason is cleared';
  assert r.release_30_due_at > now(), 'the window moved by the time the money was held';
end $$;

-- ---------------------------------------------------------------------------
-- 7. A provider event is recorded once, however many times it arrives
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome values ('event_1', public.record_payment_event(
    'charge.success', 'owanbe-ref6', 100000, 'NGN', '{"provider":"paystack"}'::jsonb,
    (select id from b3)));
  insert into outcome values ('event_2', public.record_payment_event(
    'charge.success', 'owanbe-ref6', 100000, 'NGN', '{"provider":"paystack"}'::jsonb,
    (select id from b3)));
commit;

do $$ declare v text; v2 text; n bigint; begin
  select value into v from outcome where which = 'event_1';
  select value into v2 from outcome where which = 'event_2';
  assert v = 'allocated', 'the event is recorded, got ' || v;
  assert v2 = 'duplicate', 'the same event again changes nothing, got ' || v2;
  select count(*) into n from public.payment_events where reference = 'owanbe-ref6';
  assert n = 1, 'the event is stored once, got ' || n::text;
end $$;

-- An event for a reference nobody paid is refused.
begin;
  set local role service_role;
  select pg_temp.expect_error(
    $q$select public.record_payment_event('charge.success', 'owanbe-unknown', 100000, 'NGN',
       '{}'::jsonb, null)$q$, 'booking_not_found');
commit;

-- ---------------------------------------------------------------------------
-- 8. The ledger cannot be edited, and an unbalanced entry cannot commit
-- ---------------------------------------------------------------------------
do $$ begin
  assert (select count(*) from public.journal_entries where booking_id = (select id from b1)) > 0,
    'there is an entry to try to change';
end $$;

-- The append-only rule is a trigger on the table, so it holds for everyone who writes.
select pg_temp.expect_error(
  $q$update public.journal_entries set actor = 'someone else' where booking_id = (select id from b1)$q$,
  'append-only');
select pg_temp.expect_error(
  $q$delete from public.journal_entries where booking_id = (select id from b1)$q$, 'append-only');

do $$ declare n bigint; begin
  select count(*) into n from public.journal_entries where booking_id = (select id from b1);
  assert n = 3, 'the entries are still there, got ' || n::text;
end $$;

-- An entry whose lines do not add up cannot commit. The check is a deferred constraint, so it
-- is made immediate here to see the refusal inside the transaction.
begin;
  set constraints all immediate;
  insert into public.journal_entries (idempotency_key, kind, actor, booking_id)
    values ('f102-test-unbalanced', 'fee', 'test', (select id from b1));
  select pg_temp.expect_error(
    $q$insert into public.postings (entry_id, ledger_account_id, amount_minor, currency)
       select e.id, a.id, 100, 'NGN'
         from public.journal_entries e, public.ledger_accounts a
        where e.idempotency_key = 'f102-test-unbalanced'
          and a.code = 'paystack_clearing' and a.currency = 'NGN'$q$,
    'unbalanced_entry');
  rollback;

-- ---------------------------------------------------------------------------
-- 9. The money is not readable or writable by a client
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  -- The host reads their own booking through the projection.
  do $$ declare r record; begin
    select * into r from public.booking_fund((select id from b1));
    assert r.booking_id = (select id from b1), 'the host reads their own booking';
    assert r.is_host_side, 'the host is the host side';
    assert r.counterparty_name = 'F102 Vendor', 'the host sees who they booked';
  end $$;
  select count(*) from public.booking_movements((select id from b1));

  -- Another house sees nothing.
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-out'), true);
  select pg_temp.expect_error(
    $q$select * from public.booking_fund((select id from b1))$q$, 'forbidden');
  select pg_temp.expect_error(
    $q$select * from public.booking_movements((select id from b1))$q$, 'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  -- Nobody writes the ledger directly.
  select pg_temp.expect_error($q$select * from public.fund_pool$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.wallet_ledger$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.journal_entries$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.postings$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.payment_events$q$, 'permission denied');
  select pg_temp.expect_error(format(
    $q$insert into public.fund_pool (booking_id, host_house_id, vendor_house_id, currency, total_minor)
       values (%L, %L, %L, 'NGN', 100)$q$,
    (select id from b1), (select host from ids), (select vendor from ids)), 'permission denied');
  -- The money functions are the server's alone.
  select pg_temp.expect_error(
    $q$select public.allocate_split_payment((select id from b3), 'owanbe-ref7', 100000, 'NGN')$q$,
    'permission denied');
  select pg_temp.expect_error(
    $q$select public.settle_refund((select id from b2), 'owanbe-refund-7')$q$, 'permission denied');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.fund_pool$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$select public.allocate_split_payment((select id from b3), 'owanbe-ref8', 100000, 'NGN')$q$,
    'permission denied');
commit;

-- The house sees its own bookings and what each one owes.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f102-host'), true);
  do $$ declare n bigint; begin
    select count(*) into n from public.my_bookings((select host from ids));
    assert n = 3, 'the host sees their three bookings, got ' || n::text;
  end $$;
commit;

\o
select 'F-102 fund pool tests passed' as result;
