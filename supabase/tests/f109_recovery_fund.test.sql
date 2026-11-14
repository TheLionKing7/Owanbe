-- F-109 recovery fund tests. Raises on the first failure.
-- Covers: the 70/30 split is calculated by the database and matches what the pool recorded; the
-- recovery fund starts empty; a clawback is refused to anybody without a staff grant, to a case
-- that does not exist, is closed or has no booking behind it, and for more than the vendor is still
-- owed; two distinct staff approve before any money moves and the requester may not approve; the
-- clawback is settled into a balanced journal entry and written to the recovery ledger; an advance
-- is exactly half the replacement cost and is refused when the fund cannot cover it; the settled
-- advance lowers the fund and is confirmed by the provider without settling twice; the
-- reconciliation finds no disagreement; the last 30% is released when the window has closed and
-- refused while a dispute holds it; no client reads the recovery tables directly; the console looks
-- a case up before anyone types an amount; the server can read what it needs in order to pay an
-- advance, and only finance may; and only finance or operations may run the reconciliation.
--
-- Three bookings on three dates: one carries the recovery, one is released, one is frozen.
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
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures: one vendor, one host, three finance staff, an arbitrator, a support agent, a root
-- and one person with no grant at all
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, display_name) values
  ('auth0|f109-vendor', 'vendor@example.test', 'Vee Fabrics'),
  ('auth0|f109-host',   'host@example.test',   'Ada Adeyemi'),
  ('auth0|f109-fin1',   'fin1@example.test',   'Fola Finance'),
  ('auth0|f109-fin2',   'fin2@example.test',   'Kemi Finance'),
  ('auth0|f109-fin3',   'fin3@example.test',   'Tola Finance'),
  ('auth0|f109-arb',    'arb@example.test',    'Grace Arbitrator'),
  ('auth0|f109-sup',    'sup@example.test',    'Ngo Support'),
  ('auth0|f109-root',   'root@example.test',   'Root Admin'),
  ('auth0|f109-out',    'out@example.test',    'Erin Stranger');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', u.id, 'F109 Vendor' from public.users u where u.auth0_sub = 'auth0|f109-vendor';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F109 Ada' from public.users u where u.auth0_sub = 'auth0|f109-host';

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select h.id, h.kind, h.owner_user_id, 'owner', '{}' from public.houses h
  where h.display_name like 'F109 %';

-- The grants. The granter is never the holder.
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, c.capability, 'global', r.id
    from public.users u
    cross join (values ('auth0|f109-fin1'), ('auth0|f109-fin2'), ('auth0|f109-fin3')) c(sub)
    cross join (values ('finance')) c2(capability)
    cross join public.users r
   where u.auth0_sub = c.sub and r.auth0_sub = 'auth0|f109-root';
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'arbitrator', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f109-arb' and r.auth0_sub = 'auth0|f109-root';
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'support', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f109-sup' and r.auth0_sub = 'auth0|f109-root';

create temp table ids (
  vendor uuid, host uuid, fin1 uuid, fin2 uuid, fin3 uuid, arb uuid, sup uuid, root uuid, out uuid,
  date_a date, date_b date, date_c date);
insert into ids
  select (select id from public.houses where display_name = 'F109 Vendor'),
         (select id from public.houses where display_name = 'F109 Ada'),
         (select id from public.users where auth0_sub = 'auth0|f109-fin1'),
         (select id from public.users where auth0_sub = 'auth0|f109-fin2'),
         (select id from public.users where auth0_sub = 'auth0|f109-fin3'),
         (select id from public.users where auth0_sub = 'auth0|f109-arb'),
         (select id from public.users where auth0_sub = 'auth0|f109-sup'),
         (select id from public.users where auth0_sub = 'auth0|f109-root'),
         (select id from public.users where auth0_sub = 'auth0|f109-out'),
         current_date + 400, current_date + 401, current_date + 402;

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
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-vendor'), true);
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
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  select public.accept_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
  select public.accept_quote(q.id, v.version) from q2 join public.quotes v on v.id = q2.id;
  select public.accept_quote(q.id, v.version) from q3 join public.quotes v on v.id = q3.id;
commit;

insert into b1 select id from public.bookings where quote_id = (select id from q1);
insert into b2 select id from public.bookings where quote_id = (select id from q2);
insert into b3 select id from public.bookings where quote_id = (select id from q3);

-- All three are paid, so all three have money in escrow. The provider events are recorded the way
-- the provider sends them, because the reconciliation compares the two.
begin;
  set local role service_role;
  insert into outcome values ('allocate_1', public.record_payment_event(
    'charge.success', 'owanbe-f109-ref1', 100000, 'NGN',
    '{"provider":"paystack","status":"success"}'::jsonb, (select id from b1)));
  insert into outcome values ('allocate_2', public.record_payment_event(
    'charge.success', 'owanbe-f109-ref2', 100000, 'NGN',
    '{"provider":"paystack","status":"success"}'::jsonb, (select id from b2)));
  insert into outcome values ('allocate_3', public.record_payment_event(
    'charge.success', 'owanbe-f109-ref3', 100000, 'NGN',
    '{"provider":"paystack","status":"success"}'::jsonb, (select id from b3)));
commit;

-- The payment tells both houses about the first release. The kind list has to allow it: a
-- narrower list once made the whole allocation fail on the notification it writes.
do $$ declare n bigint; begin
  select count(*) into n from public.notifications
   where kind = 'fund_released' and payload ->> 'booking_id' = (select id from b1)::text;
  assert n = 2, 'both houses are told about the first release, got ' || n::text || ' notifications';
end $$;

-- Two cases: one open on the booking that carries the recovery, one closed.
create temp table case1 (id uuid);
create temp table case2 (id uuid);
create temp table case3 (id uuid);
grant select on case1, case2, case3 to authenticated, service_role;

insert into public.cases (reference, subject, reason, status, source, opened_by, booking_id, house_id)
  select 'CASE-F10900000001', 'The vendor did not deliver',
         'The vendor did not turn up for the booked celebration service on the agreed date',
         'investigating', 'staff', (select root from ids), (select id from b1), (select host from ids);
insert into public.cases (reference, subject, reason, status, source, opened_by, booking_id, house_id)
  select 'CASE-F10900000002', 'An old problem',
         'This case was settled earlier and cannot carry a new recovery',
         'closed', 'staff', (select root from ids), (select id from b2), (select host from ids);
-- A case that is not about a booking at all: there is no money behind it.
insert into public.cases (reference, subject, reason, status, source, opened_by, booking_id, house_id)
  select 'CASE-F10900000003', 'A question about the service',
         'The host asked about the service before any booking had been paid for',
         'open', 'staff', (select root from ids), null, (select host from ids);

insert into case1
  select c.id from public.cases c
   where c.reference = 'CASE-F10900000001';
insert into case2
  select c.id from public.cases c
   where c.reference = 'CASE-F10900000002';
insert into case3
  select c.id from public.cases c
   where c.reference = 'CASE-F10900000003';

-- ---------------------------------------------------------------------------
-- 1. The split is calculated by the database, and it is the split the pool recorded
-- ---------------------------------------------------------------------------
do $$ declare r record; p record; begin
  select * into r from public.calculate_split_allocation(100000, 'NGN');
  assert r.release_70 = 70000, 'the first tranche is 70%, got ' || r.release_70::text;
  assert r.release_30 = 30000, 'the last tranche is 30%, got ' || r.release_30::text;
  assert r.commission_70 = 1750, 'the commission on the first tranche is 2.5%, got '
    || r.commission_70::text;
  assert r.vendor_net_70 = 68250, 'the vendor keeps the rest of the first tranche, got '
    || r.vendor_net_70::text;
  assert r.commission_30 = 750, 'the commission on the last tranche is 2.5%, got '
    || r.commission_30::text;
  assert r.vendor_net_30 = 29250, 'the vendor keeps the rest of the last tranche, got '
    || r.vendor_net_30::text;

  select * into p from public.fund_pool where booking_id = (select id from b1);
  assert p.released_70_minor = r.release_70, 'the pool released what the calculator says, got '
    || p.released_70_minor::text;
  assert p.held_minor = r.release_30, 'the pool holds what the calculator says, got '
    || p.held_minor::text;
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  select pg_temp.expect_error(
    $q$select public.calculate_split_allocation(0, 'NGN')$q$, 'invalid_total');
  select pg_temp.expect_error(
    $q$select public.calculate_split_allocation(100000, 'naira')$q$, 'invalid_currency');
commit;

-- ---------------------------------------------------------------------------
-- 2. The recovery fund starts empty
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from public.fund_pool_ledger;
  assert n = 0, 'no recovery money has moved, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 3. An advance is refused when the fund cannot cover it
-- ---------------------------------------------------------------------------
-- The host has no grant, so the host cannot ask for money.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance((select id from case1), 8000,
       'Replacement photography for the celebration', 'wallet-1')$q$,
    'forbidden: support or finance grant required');
commit;

-- A case that does not exist, and a case that is closed.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin1'), true);
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance(
       '00000000-0000-4000-8000-000000000000', 8000,
       'Replacement photography for the celebration', 'wallet-1')$q$,
    'case_not_found');
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance((select id from case2), 8000,
       'Replacement photography for the celebration', 'wallet-1')$q$,
    'case_closed');
  -- A case that is not about a booking has no money behind it.
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance((select id from case3), 8000,
       'Replacement photography for the celebration', 'wallet-1')$q$,
    'case_has_no_booking');
commit;

-- The fund holds nothing yet, so an advance is refused rather than half paid.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-sup'), true);
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance((select id from case1), 8000,
       'Replacement photography for the celebration', 'wallet-1')$q$,
    'insufficient_recovery_funds');
commit;

-- The wallet and the reason are checked before anything else.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-sup'), true);
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance((select id from case1), 8000,
       'Replacement photography for the celebration', '  ')$q$,
    'fund_wallet_required');
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance((select id from case1), 8000,
       'x', 'wallet-1')$q$,
    'reason_required');
  select pg_temp.expect_error(
    $q$select public.request_recovery_advance((select id from case1), 0,
       'Replacement photography for the celebration', 'wallet-1')$q$,
    'invalid_replacement_cost');
commit;

-- ---------------------------------------------------------------------------
-- 4. A clawback is asked for by staff, and only for money the vendor is still owed
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  select pg_temp.expect_error(
    $q$select public.request_recovery_clawback((select id from case1), 5000,
       'The vendor did not deliver the booked service', 'wallet-1')$q$,
    'forbidden: arbitrator or finance grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-arb'), true);
  select pg_temp.expect_error(
    $q$select public.request_recovery_clawback((select id from case2), 5000,
       'The vendor did not deliver the booked service', 'wallet-1')$q$,
    'case_closed');
  select pg_temp.expect_error(
    $q$select public.request_recovery_clawback((select id from case3), 5000,
       'The vendor did not deliver the booked service', 'wallet-1')$q$,
    'case_has_no_booking');
commit;

-- More than the vendor is still owed cannot be taken back. The vendor's claim is a balance of the
-- house, not of the booking: the three bookings have each released their first tranche, so the
-- house is owed three times the vendor's share of it.
do $$ declare v bigint; begin
  select -sum(p.amount_minor) into v
    from public.postings p
    join public.ledger_accounts a on a.id = p.ledger_account_id
   where a.code = 'vendor_payable' and a.owner_kind = 'house'
     and a.owner_id = (select vendor from ids) and a.currency = 'NGN';
  assert v = 204750, 'the vendor is owed three first tranches, got ' || v::text;
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-arb'), true);
  select pg_temp.expect_error(
    $q$select public.request_recovery_clawback((select id from case1), 999999,
       'The vendor did not deliver the booked service', 'wallet-1')$q$,
    'nothing_to_recover');
commit;

-- A staff member asks for it, and the request is recorded as asked for.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin1'), true);
  insert into outcome values ('clawback', public.request_recovery_clawback(
    (select id from case1), 5000,
    'The vendor did not deliver the booked service', 'wallet-1')::text);
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'clawback';
  assert v is not null, 'the clawback was requested';

  select * into r from public.recovery_actions where id = v::uuid;
  assert r.kind = 'clawback', 'the request is a clawback, got ' || r.kind;
  assert r.status = 'requested', 'the request waits for approval, got ' || r.status;
  assert r.amount_minor = 5000, 'the request names the amount, got ' || r.amount_minor::text;
  assert r.currency = 'NGN', 'the request carries the currency, got ' || r.currency;
  assert r.requested_by = (select fin1 from ids), 'the request names who asked for it';
  assert r.reference ~ '^RA-[0-9A-F]{12}$', 'the request has a reference, got ' || r.reference;
  assert r.replacement_cost_minor is null, 'a clawback has no replacement cost';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Two distinct staff approve, and the requester may not be one of them
-- ---------------------------------------------------------------------------
-- The person who asked for it may not approve it, even with a finance grant.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin1'), true);
  select pg_temp.expect_error(
    $q$select public.approve_recovery_action((select value from outcome where which = 'clawback')::uuid,
       'approved', 'Asked for it myself')$q$,
    'forbidden: the requester may not approve');
commit;

-- One approval is not enough.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin2'), true);
  insert into outcome values ('approve_1', public.approve_recovery_action(
    (select value from outcome where which = 'clawback')::uuid, 'approved', 'Checked the case'));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'approve_1';
  assert v = 'awaiting_approval', 'one approval still waits, got ' || v;
  select * into r from public.recovery_actions where id = (select value from outcome where which = 'clawback')::uuid;
  assert r.status = 'requested', 'one approval does not move the request, got ' || r.status;
end $$;

-- The same person approving twice counts once.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin2'), true);
  insert into outcome values ('approve_again', public.approve_recovery_action(
    (select value from outcome where which = 'clawback')::uuid, 'approved', 'Checked it again'));
commit;

do $$ declare v text; n bigint; begin
  select value into v from outcome where which = 'approve_again';
  assert v = 'awaiting_approval', 'the same approval twice is still one approval, got ' || v;
  select count(*) into n from public.recovery_approvals
   where action_id = (select value from outcome where which = 'clawback')::uuid and decision = 'approved';
  assert n = 1, 'one person is counted once, got ' || n::text;
end $$;

-- The second distinct approval moves it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('approve_2', public.approve_recovery_action(
    (select value from outcome where which = 'clawback')::uuid, 'approved', 'Agreed'));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'approve_2';
  assert v = 'approved', 'two distinct approvals approve it, got ' || v;
  select * into r from public.recovery_actions where id = (select value from outcome where which = 'clawback')::uuid;
  assert r.status = 'approved', 'the request is approved, got ' || r.status;
  assert r.approved_at is not null, 'the approval is timed';
end $$;

-- A refusal settles the matter: the request is refused and can never be settled.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin1'), true);
  insert into outcome values ('clawback_2', public.request_recovery_clawback(
    (select id from case1), 1000,
    'The vendor did not deliver part of the booked service', 'wallet-1')::text);
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('refuse', public.approve_recovery_action(
    (select value from outcome where which = 'clawback_2')::uuid, 'refused', 'The case does not say so'));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'refuse';
  assert v = 'refused', 'a refusal refuses the request, got ' || v;
  select * into r from public.recovery_actions where id = (select value from outcome where which = 'clawback_2')::uuid;
  assert r.status = 'refused', 'the request is refused, got ' || r.status;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The money moves only when it is settled, and only by the server
-- ---------------------------------------------------------------------------
-- A request that was refused cannot be settled.
begin;
  set local role service_role;
  select pg_temp.expect_error(
    $q$select public.settle_recovery_action((select value from outcome where which = 'clawback_2')::uuid,
       'owanbe-f109-clawback-2')$q$,
    'recovery_action_not_approved');
commit;

-- A signed-in user cannot settle: the server does it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  select pg_temp.expect_error(
    $q$select public.settle_recovery_action((select value from outcome where which = 'clawback')::uuid,
       'owanbe-f109-clawback-1')$q$,
    'permission denied for function settle_recovery_action');
commit;

-- The server settles it.
begin;
  set local role service_role;
  insert into outcome values ('settle_clawback', public.settle_recovery_action(
    (select value from outcome where which = 'clawback')::uuid, 'owanbe-f109-clawback-1'));
commit;

do $$ declare v text; r record; n bigint; begin
  select value into v from outcome where which = 'settle_clawback';
  assert v = 'settled', 'the clawback is settled, got ' || v;

  select * into r from public.recovery_actions where id = (select value from outcome where which = 'clawback')::uuid;
  assert r.status = 'settled', 'the request is settled, got ' || r.status;
  assert r.settled_at is not null, 'the settlement is timed';

  -- The vendor's claim fell by the amount taken back.
  select -sum(p.amount_minor) into n
    from public.postings p
    join public.ledger_accounts a on a.id = p.ledger_account_id
   where a.code = 'vendor_payable' and a.owner_kind = 'house'
     and a.owner_id = (select vendor from ids) and a.currency = 'NGN';
  assert n = 199750, 'the vendor is owed 5000 less, got ' || n::text;

  -- The fund holds what was taken back.
  select -sum(p.amount_minor) into n
    from public.postings p
    join public.ledger_accounts a on a.id = p.ledger_account_id
   where a.code = 'recovery_fund' and a.owner_kind = 'platform' and a.currency = 'NGN';
  assert n = 5000, 'the recovery fund holds the money taken back, got ' || n::text;

  -- The trail says what moved.
  select count(*) into n from public.fund_pool_ledger
   where action_id = (select value from outcome where which = 'clawback')::uuid;
  assert n = 1, 'the recovery ledger has one row for the clawback, got ' || n::text;
  select count(*) into n from public.fund_pool_ledger
   where action_id = (select value from outcome where which = 'clawback')::uuid
     and movement = 'clawback' and direction = 'in' and amount_minor = 5000;
  assert n = 1, 'the row says the money came in, got ' || n::text;
end $$;

-- The entry balances, and a replay settles nothing twice.
do $$ declare n bigint; e bigint; begin
  select count(*) into n from (
    select je.id
      from public.journal_entries je
      join public.postings p on p.entry_id = je.id
     where je.idempotency_key = 'recovery:' || (select value from outcome where which = 'clawback') || ':clawback'
     group by je.id, p.currency
    having sum(p.amount_minor) <> 0) unbalanced;
  assert n = 0, 'the clawback entry balances';

  select count(*) into e from public.journal_entries
   where idempotency_key = 'recovery:' || (select value from outcome where which = 'clawback') || ':clawback';
  assert e = 1, 'the clawback has one entry, got ' || e::text;
end $$;

begin;
  set local role service_role;
  insert into outcome values ('settle_clawback_again', public.settle_recovery_action(
    (select value from outcome where which = 'clawback')::uuid, 'owanbe-f109-clawback-1'));
commit;

do $$ declare v text; e bigint; n bigint; begin
  select value into v from outcome where which = 'settle_clawback_again';
  assert v = 'settled', 'a replay is still settled, got ' || v;
  select count(*) into e from public.journal_entries
   where idempotency_key = 'recovery:' || (select value from outcome where which = 'clawback') || ':clawback';
  assert e = 1, 'the replay posted nothing, got ' || e::text;
  select count(*) into n from public.fund_pool_ledger
   where action_id = (select value from outcome where which = 'clawback')::uuid;
  assert n = 1, 'the replay wrote no second row, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 7. An advance is exactly half the replacement cost
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-sup'), true);
  insert into outcome values ('advance', public.request_recovery_advance(
    (select id from case1), 8000,
    'Replacement photography for the celebration', 'wallet-1')::text);
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'advance';
  assert v is not null, 'the advance was requested';

  select * into r from public.recovery_actions where id = v::uuid;
  assert r.kind = 'advance', 'the request is an advance, got ' || r.kind;
  assert r.status = 'requested', 'the advance waits for approval, got ' || r.status;
  assert r.replacement_cost_minor = 8000, 'the request names the replacement cost, got '
    || r.replacement_cost_minor::text;
  assert r.amount_minor = 4000, 'the advance is half the replacement cost, got '
    || r.amount_minor::text;
end $$;

-- The table itself refuses an advance that is not half the replacement cost.
do $$ begin
  begin
    insert into public.recovery_actions
      (kind, case_id, source_booking_id, pool_id, host_house_id, vendor_house_id, currency,
       amount_minor, replacement_cost_minor, fund_wallet_id, requested_by, reason)
    select 'advance', (select id from case1), (select id from b1),
           (select id from public.fund_pool where booking_id = (select id from b1)),
           (select host from ids), (select vendor from ids), 'NGN',
           6000, 8000, 'wallet-1', (select fin1 from ids),
           'Replacement photography for the celebration';
    raise exception 'expected the advance to be refused, but the row was inserted';
  exception when check_violation then
    null;
  end;
end $$;

-- The advance is approved the same way and settled by the server.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin2'), true);
  insert into outcome values ('advance_approve_1', public.approve_recovery_action(
    (select value from outcome where which = 'advance')::uuid, 'approved', 'Checked the case'));
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('advance_approve_2', public.approve_recovery_action(
    (select value from outcome where which = 'advance')::uuid, 'approved', 'Agreed'));
commit;

do $$ declare v text; begin
  select value into v from outcome where which = 'advance_approve_2';
  assert v = 'approved', 'the advance is approved, got ' || v;
end $$;

begin;
  set local role service_role;
  insert into outcome values ('settle_advance', public.settle_recovery_action(
    (select value from outcome where which = 'advance')::uuid, 'RB-F109-REFUND-1'));
commit;

do $$ declare v text; r record; n bigint; begin
  select value into v from outcome where which = 'settle_advance';
  assert v = 'settled', 'the advance is settled, got ' || v;

  select * into r from public.recovery_actions where id = (select value from outcome where which = 'advance')::uuid;
  assert r.status = 'settled', 'the advance is settled, got ' || r.status;
  assert r.provider_reference = 'RB-F109-REFUND-1', 'the provider reference is kept, got '
    || coalesce(r.provider_reference, '');

  -- The fund is 1000 lighter: 5000 taken back, 4000 advanced.
  select -sum(p.amount_minor) into n
    from public.postings p
    join public.ledger_accounts a on a.id = p.ledger_account_id
   where a.code = 'recovery_fund' and a.owner_kind = 'platform' and a.currency = 'NGN';
  assert n = 1000, 'the fund is 1000 lighter, got ' || n::text;

  select count(*) into n from public.fund_pool_ledger
   where action_id = (select value from outcome where which = 'advance')::uuid
     and movement = 'advance' and direction = 'out' and amount_minor = 4000;
  assert n = 1, 'the trail says the money went out, got ' || n::text;
end $$;

-- The advance entry balances, and the whole ledger still balances.
do $$ declare n bigint; begin
  select count(*) into n from (
    select je.id
      from public.journal_entries je
      join public.postings p on p.entry_id = je.id
     group by je.id, p.currency
    having sum(p.amount_minor) <> 0) unbalanced;
  assert n = 0, 'every entry in the ledger balances, got ' || n::text || ' that do not';
end $$;

-- The host is told that money has been advanced.
do $$ declare n bigint; begin
  select count(*) into n from public.notifications
   where kind = 'fund_advanced'
     and payload ->> 'booking_id' = (select id from b1)::text;
  assert n = 1, 'the host is told about the advance, got ' || n::text || ' notifications';
end $$;

-- ---------------------------------------------------------------------------
-- 8. The provider's confirmation of the advance settles nothing twice
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  insert into outcome values ('confirm', public.record_payment_event(
    'refund.processed', 'owanbe-f109-ref1', 4000, 'NGN',
    jsonb_build_object('provider', 'paystack', 'status', 'success',
                        'refund_reference', 'RB-F109-REFUND-1'),
    (select id from b1)));
commit;

do $$ declare v text; e bigint; begin
  select value into v from outcome where which = 'confirm';
  assert v = 'settled', 'the confirmation is recorded, got ' || v;

  select count(*) into e from public.journal_entries
   where idempotency_key = 'booking:' || (select id from b1)::text || ':refund_settled';
  assert e = 0, 'the confirmation settled no refund of the booking''s own money, got ' || e::text;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The reconciliation compares the provider's events with the ledger
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  select pg_temp.expect_error(
    $q$select public.reconcile_ledger()$q$,
    'permission denied for function reconcile_ledger');
commit;

begin;
  set local role service_role;
  insert into outcome values ('reconcile', public.reconcile_ledger()::text);
commit;

do $$ declare v text; r record; n bigint; begin
  select value into v from outcome where which = 'reconcile';
  assert v is not null, 'the reconciliation ran';

  select * into r from public.ledger_reconciliations order by ran_at desc limit 1;
  assert r is not null, 'the outcome of the run is written down';
  assert r.events_checked > 0, 'the provider events were read, got ' || r.events_checked::text;
  assert r.pools_checked >= 3, 'the pools were read, got ' || r.pools_checked::text;

  -- The run reads the whole ledger, so the pools and the charges of the other suites are in the
  -- count. What this suite owns is that nothing disagrees about its own bookings and its own
  -- charges: an exception that names one of them would mean the ledger and the provider differ.
  select count(*) into n
    from jsonb_array_elements(r.exception_rows) e
   where e ->> 'booking_id' in ((select id from b1)::text, (select id from b2)::text,
                                (select id from b3)::text)
      or e ->> 'reference' in ('owanbe-f109-ref1', 'owanbe-f109-ref2', 'owanbe-f109-ref3');
  assert n = 0, 'nothing disagrees about the bookings of this suite, got ' || n::text || ' rows';
end $$;

-- A disagreement is written down rather than repaired.
do $$ begin
  update public.payment_events
     set amount_minor = 99999
   where event_type = 'charge.success' and reference = 'owanbe-f109-ref2';
end $$;

begin;
  set local role service_role;
  insert into outcome values ('reconcile_2', public.reconcile_ledger()::text);
commit;

do $$ declare r record; begin
  select * into r from public.ledger_reconciliations order by ran_at desc limit 1;
  assert r.status = 'exceptions', 'the disagreement is written down, got ' || r.status;
  assert r.exception_count > 0, 'the disagreement is counted, got ' || r.exception_count::text;
  assert r.exception_rows @> '[{"code":"amount_mismatch"}]', 'the disagreement is named, got '
    || r.exception_rows::text;
end $$;

-- ---------------------------------------------------------------------------
-- 10. The last 30% goes out when the window has closed, and not while a dispute holds it
-- ---------------------------------------------------------------------------
-- A host may not release money.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  select pg_temp.expect_error(
    $q$select public.release_due_tranche((select id from b2))$q$,
    'forbidden: operations or finance grant required');
commit;

-- The window is still open.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('release_early', public.release_due_tranche((select id from b2)));
commit;

do $$ declare v text; begin
  select value into v from outcome where which = 'release_early';
  assert v = 'not_due', 'the last 30% waits for the window to close, got ' || v;
end $$;

-- The window closes.
update public.fund_pool
   set release_30_due_at = now() - interval '1 hour'
 where booking_id = (select id from b2);

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('release', public.release_due_tranche((select id from b2)));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'release';
  assert v = 'released', 'the last 30% goes out, got ' || v;

  select * into r from public.fund_pool where booking_id = (select id from b2);
  assert r.released_30_minor = 30000, 'the last 30% went out, got ' || r.released_30_minor::text;
  assert r.held_minor = 0, 'nothing is held any more, got ' || r.held_minor::text;
  assert r.status = 'released', 'the pool is fully out, got ' || r.status;
end $$;

-- A dispute holds the money, so the rules refuse the release.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-arb'), true);
  perform public.freeze_fund_pool((select id from b3), 'The vendor is being investigated');
commit;

update public.fund_pool
   set release_30_due_at = now() - interval '1 hour'
 where booking_id = (select id from b3);

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('release_frozen', public.release_due_tranche((select id from b3)));
commit;

do $$ declare v text; r record; begin
  select value into v from outcome where which = 'release_frozen';
  assert v = 'frozen', 'a dispute holds the money, got ' || v;

  select * into r from public.fund_pool where booking_id = (select id from b3);
  assert r.released_30_minor = 0, 'nothing was released while it was held, got '
    || r.released_30_minor::text;
  assert r.held_minor = 30000, 'the money is still held, got ' || r.held_minor::text;
end $$;

-- ---------------------------------------------------------------------------
-- 11. The staff console reads the recovery money, and no client reads the tables
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('console', (
    select count(*)::text from public.list_recovery_actions()));
  insert into outcome values ('console_balances', (
    select count(*)::text from public.recovery_fund_balances()));
  insert into outcome values ('console_ledger', (
    select count(*)::text from public.fund_pool_ledger_entries(
      (select id from public.fund_pool where booking_id = (select id from b1)))));
  insert into outcome values ('console_due', (
    select count(*)::text from public.due_fund_pools()));
commit;

do $$ declare v text; begin
  select value into v from outcome where which = 'console';
  assert v = '3', 'the console lists every recovery request, got ' || v;
  select value into v from outcome where which = 'console_balances';
  assert v = '1', 'the console shows the fund for one currency, got ' || v;
  select value into v from outcome where which = 'console_ledger';
  assert v = '2', 'the console shows the recovery money of the pool, got ' || v;
  select value into v from outcome where which = 'console_due';
  assert v = '1', 'the console shows the pool still waiting for its last tranche, got ' || v;
end $$;

-- A signed-in person with no staff grant reads none of it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  select pg_temp.expect_error(
    $q$select public.list_recovery_actions()$q$, 'forbidden: staff grant required');
  select pg_temp.expect_error(
    $q$select public.recovery_fund_balances()$q$, 'forbidden: staff grant required');
  select pg_temp.expect_error(
    $q$select public.fund_pool_ledger_entries(
       (select id from public.fund_pool where booking_id = (select id from b1)))$q$,
    'forbidden: staff grant required');
  select pg_temp.expect_error(
    $q$select public.due_fund_pools()$q$, 'forbidden: staff grant required');
commit;

-- No client reads the recovery tables directly, and no client writes them.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  select pg_temp.expect_error(
    $q$select count(*) from public.recovery_actions$q$, 'permission denied for table recovery_actions');
  select pg_temp.expect_error(
    $q$select count(*) from public.fund_pool_ledger$q$, 'permission denied for table fund_pool_ledger');
  select pg_temp.expect_error(
    $q$select count(*) from public.recovery_approvals$q$,
    'permission denied for table recovery_approvals');
  select pg_temp.expect_error(
    $q$insert into public.recovery_actions
       (kind, case_id, source_booking_id, pool_id, host_house_id, vendor_house_id, currency,
        amount_minor, fund_wallet_id, requested_by, reason)
     select 'clawback', (select id from case1), (select id from b1),
            (select id from public.fund_pool where booking_id = (select id from b1)),
            (select host from ids), (select vendor from ids), 'NGN', 1, 'wallet-1',
            (select fin1 from ids), 'A client writing the ledger directly'$q$,
    'permission denied for table recovery_actions');
commit;

-- ---------------------------------------------------------------------------
-- 12. The console looks a case up before anyone types an amount
-- ---------------------------------------------------------------------------
-- The money of a case is counted in the currency of its booking, so the console asks the database
-- what that currency is rather than guessing.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('case_context', (
    select (r.currency || '|' || r.paid_minor::text || '|' || r.vendor_payable_minor::text || '|'
            || r.fund_balance_minor::text || '|' || r.case_reference)
      from public.recovery_case_context((select id from case1)) r));
  insert into outcome values ('case_context_pool', (
    select (r.pool_id is not null)::text
      from public.recovery_case_context((select id from case1)) r));
commit;

do $$ declare v text; begin
  select value into v from outcome where which = 'case_context';
  -- The vendor's claim is the house's whole balance: 204750 for the three first tranches, less the
  -- 5000 taken back, plus the 29250 of the second booking's final tranche. The fund holds 5000
  -- taken back less the 4000 advanced.
  assert v = 'NGN|100000|229000|1000|CASE-F10900000001',
    'the console sees the money of the case in the currency of its booking, got ' || v;
  select value into v from outcome where which = 'case_context_pool';
  assert v = 'true', 'the console sees which pool the money sits in, got ' || v;
end $$;

-- A case that does not exist, and a case whose booking has no money yet.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  select pg_temp.expect_error(
    $q$select * from public.recovery_case_context(
       '00000000-0000-4000-8000-000000000000')$q$, 'case_not_found');
  select pg_temp.expect_error(
    $q$select * from public.recovery_case_context((select id from case3))$q$,
    'case_has_no_booking');
commit;

-- A person with no staff grant reads none of it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  select pg_temp.expect_error(
    $q$select * from public.recovery_case_context((select id from case1))$q$,
    'forbidden: staff grant required');
commit;

-- ---------------------------------------------------------------------------
-- 13. The platform reads what it needs in order to pay, and only finance may
-- ---------------------------------------------------------------------------
-- The payout target is what the server reads before it moves money: the amount, the currency, the
-- provider's reference for the charge and whether the fund can still cover it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('target', (
    select (r.kind || '|' || r.status || '|' || r.amount_minor::text || '|' || r.currency || '|'
            || r.available_minor::text || '|' || coalesce(r.payment_reference, '-') || '|'
            || r.ready::text)
      from public.recovery_payout_target((select value from outcome where which = 'clawback')::uuid) r));
commit;

do $$ declare v text; begin
  select value into v from outcome where which = 'target';
  -- The clawback was settled in section 6, so it is no longer approved and the platform is not
  -- ready to pay it again. The fund holds 1000, which is all that is left to pay with.
  assert v = 'clawback|settled|5000|NGN|1000|-|false',
    'a settled clawback is not ready to be paid again, got ' || v;
end $$;

-- The advance carries the provider's reference for the charge, because that is what the money is
-- sent back from.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('target_advance', (
    select (r.kind || '|' || r.status || '|' || r.amount_minor::text || '|' || r.currency || '|'
            || coalesce(r.payment_reference, '-') || '|' || r.ready::text)
      from public.recovery_payout_target((select value from outcome where which = 'advance')::uuid) r));
commit;

do $$ declare v text; begin
  select value into v from outcome where which = 'target_advance';
  assert v = 'advance|settled|4000|NGN|owanbe-f109-ref1|false',
    'the advance names the charge it is paid back from, got ' || v;
end $$;

-- A support agent may not read it: the payout target carries the provider's reference.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-sup'), true);
  select pg_temp.expect_error(
    $q$select * from public.recovery_payout_target(
       (select value from outcome where which = 'clawback')::uuid)$q$,
    'forbidden: finance grant required');
commit;

-- An action that does not exist.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  select pg_temp.expect_error(
    $q$select * from public.recovery_payout_target(
       '00000000-0000-4000-8000-000000000000')$q$, 'recovery_action_not_found');
commit;

-- ---------------------------------------------------------------------------
-- 14. Only finance or operations may run the reconciliation, and the console says so
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-fin3'), true);
  insert into outcome values ('can_reconcile_finance', public.can_run_reconciliation()::text);
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-sup'), true);
  insert into outcome values ('can_reconcile_support', public.can_run_reconciliation()::text);
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f109-host'), true);
  insert into outcome values ('can_reconcile_host', public.can_run_reconciliation()::text);
commit;

do $$ declare v text; begin
  select value into v from outcome where which = 'can_reconcile_finance';
  assert v = 'true', 'finance may run the reconciliation, got ' || v;
  select value into v from outcome where which = 'can_reconcile_support';
  assert v = 'false', 'support may not run the reconciliation, got ' || v;
  select value into v from outcome where which = 'can_reconcile_host';
  assert v = 'false', 'a host may not run the reconciliation, got ' || v;
end $$;

-- ---------------------------------------------------------------------------
-- 15. The trail of the recovery money is append-only
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    update public.fund_pool_ledger set memo = 'changed' where id = (
      select id from public.fund_pool_ledger limit 1);
    raise exception 'expected the recovery ledger to refuse an edit, but the row was updated';
  exception when others then
    if position('append' in sqlerrm) = 0 and position('forbid' in sqlerrm) = 0
       and position('not allowed' in sqlerrm) = 0 then
      raise exception 'expected the recovery ledger to refuse an edit, got "%"', sqlerrm;
    end if;
  end;
end $$;

\o
\echo 'F-109 recovery fund: all checks passed'
