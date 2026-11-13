-- F-126 Monitoring/observability tool tests. Raises on the first failure.
-- Covers: the operations dashboard is closed to every caller who does not hold the existing
-- 'operations' capability; it opens to the one who does, and counts the platform's operational
-- records; every read is audited; the dashboard carries no money and no party detail; the tables
-- behind it cannot be read directly; and revoking the grant closes the dashboard again.
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
-- Fixtures: a root who grants, an operations lead, a support member, an outsider, and the two
-- houses whose bookings the dashboard will count.
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f126-root',     'root@example.test',     true, 'Root Admin'),
  ('auth0|f126-ops',      'ops@example.test',      true, 'Ola Operations'),
  ('auth0|f126-support',  'support@example.test',  true, 'Sam Support'),
  ('auth0|f126-outsider', 'outsider@example.test', true, 'Otto Outsider'),
  ('auth0|f126-host',     'host@example.test',     true, 'Ada Host'),
  ('auth0|f126-vendor',   'vendor@example.test',   true, 'Vee Vendor');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', u.id, 'F126 Vendor' from public.users u where u.auth0_sub = 'auth0|f126-vendor';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F126 Host' from public.users u where u.auth0_sub = 'auth0|f126-host';

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select h.id, h.kind, h.owner_user_id, 'owner', '{}' from public.houses h
   where h.display_name like 'F126 %';

-- 'operations' already exists and already means the platform-operations role. F-126 invents no
-- new capability: the operations lead reads the dashboard because they hold that grant.
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'operations', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f126-ops' and r.auth0_sub = 'auth0|f126-root';
-- Support keeps its own meaning and does not open the dashboard's door.
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'support', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f126-support' and r.auth0_sub = 'auth0|f126-root';

create temp table ids (
  host uuid, vendor uuid, ops uuid, support uuid, root uuid, outsider uuid);
insert into ids
  select (select id from public.houses where display_name = 'F126 Host'),
         (select id from public.houses where display_name = 'F126 Vendor'),
         (select id from public.users where auth0_sub = 'auth0|f126-ops'),
         (select id from public.users where auth0_sub = 'auth0|f126-support'),
         (select id from public.users where auth0_sub = 'auth0|f126-root'),
         (select id from public.users where auth0_sub = 'auth0|f126-outsider');

create temp table q1 (id uuid);
create temp table b1 (id uuid);
create temp table pools (booking uuid, pool uuid, service_date date);
create temp table dash (signal_key text, signal_label text, signal_value bigint, detail text, severity text);
grant select, insert on ids, q1, b1, pools, dash to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Four bookings, so every money signal has something to count
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f126-vendor'), true);
  insert into q1
    select public.create_quote(vendor, host, current_date + 100 + n, 'NGN',
             'F126 booking ' || n::text,
             '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb)
      from ids, generate_series(1, 4) n;
  select public.send_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f126-host'), true);
  select public.accept_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
commit;

insert into b1 select id from public.bookings where quote_id in (select id from q1);
insert into pools
  select b.id, p.id, b.service_date
    from public.bookings b
    join public.quotes q on q.id = b.quote_id
    join public.fund_pool p on p.booking_id = b.id
   where b.quote_id in (select id from q1);

-- A: paid, held, and past the release deadline. Its ledger agrees, so it is not a difference.
update public.fund_pool
   set paid_minor = 100000, held_minor = 100000, status = 'held',
       paid_at = now() - interval '3 days',
       release_30_due_at = now() - interval '1 day'
 where id = (select pool from pools where service_date = current_date + 101);

-- B: paid and held with no deadline, and no ledger movement: the recorded payment and the
-- ledger trail disagree.
update public.fund_pool
   set paid_minor = 50000, held_minor = 50000, status = 'held', paid_at = now() - interval '2 days'
 where id = (select pool from pools where service_date = current_date + 102);

-- C: a refund asked for and not yet settled.
update public.fund_pool
   set paid_minor = 100000, refunded_minor = 100000, held_minor = 0, status = 'refund_pending',
       paid_at = now() - interval '5 days'
 where id = (select pool from pools where service_date = current_date + 103);

-- D: money frozen by a dispute, and its deadline has also passed: a freeze is deliberate, so it
-- is counted as frozen and not as an overdue release.
update public.fund_pool
   set paid_minor = 100000, held_minor = 100000, status = 'held', frozen = true,
       frozen_at = now() - interval '1 day', frozen_reason = 'A dispute is open.',
       paid_at = now() - interval '5 days',
       release_30_due_at = now() - interval '2 days'
 where id = (select pool from pools where service_date = current_date + 104);

-- The ledger trails that make A, C and D add up, and leave B without one.
insert into public.wallet_ledger
  (pool_id, booking_id, movement, direction, amount_minor, currency, idempotency_key, memo)
select pool, booking, 'booking_hold', 'in', 100000, 'NGN',
       'f126:hold:' || booking::text, 'Payment received'
  from pools where service_date in (current_date + 101, current_date + 103, current_date + 104);

-- The provider events: one nobody has decided on, one refused charge, one settled charge.
insert into public.payment_events
  (event_type, reference, booking_id, amount_minor, currency, payload, outcome, created_at)
select 'charge.success', 'f126-undecided', b.booking, 100000, 'NGN', '{}'::jsonb, null,
       now() - interval '90 minutes'
  from pools b where b.service_date = current_date + 101;

insert into public.payment_events
  (event_type, reference, booking_id, amount_minor, currency, payload, outcome, created_at)
select 'charge.failed', 'f126-failed', b.booking, 100000, 'NGN', '{}'::jsonb, 'ignored',
       now() - interval '2 hours'
  from pools b where b.service_date = current_date + 101;

insert into public.payment_events
  (event_type, reference, booking_id, amount_minor, currency, payload, outcome, created_at)
select 'charge.success', 'f126-settled', b.booking, 100000, 'NGN', '{}'::jsonb, 'allocated',
       now() - interval '4 hours'
  from pools b where b.service_date = current_date + 102;

-- The alerts: one payment window that closed unpaid, and one that has been read.
insert into public.notifications (house_id, house_kind, kind, title, body, dedupe_key, read_at)
select host, 'host', 'payment_window_closed', 'Payment window closed',
       'The payment window for this booking closed before the money arrived.',
       'f126:window-closed', null
  from ids;

insert into public.notifications (house_id, house_kind, kind, title, body, dedupe_key, read_at)
select host, 'host', 'fund_released', 'Money released',
       'The first tranche of this booking was released.',
       'f126:fund-released', now()
  from ids;

-- A case waiting for a person, and an investigation the AI handed to a person.
insert into public.cases (subject, reason, status, priority, source, opened_by, house_id)
select 'A payment that never arrived', 'The host says they paid and the money is not on record.',
       'open', 'high', 'staff', root, host
  from ids;

insert into public.ai_interactions
  (surface, actor_user_id, request_summary, response_text, model, outcome)
select 'payment_investigation', ops, 'Why is this money still held?',
       'The trail does not show who received the money.', 'openai/gpt-6-astra', 'needs_human'
  from ids;

-- ---------------------------------------------------------------------------
-- 1. The dashboard is closed to everyone who does not hold the operations capability
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select pg_temp.expect_error(
    $q$select * from public.observability_dashboard()$q$, 'forbidden: operations grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f126-support'), true);
  select pg_temp.expect_error(
    $q$select * from public.observability_dashboard()$q$, 'forbidden: operations grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f126-outsider'), true);
  select pg_temp.expect_error(
    $q$select * from public.observability_dashboard()$q$, 'forbidden: operations grant required');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error(
    $q$select * from public.observability_dashboard()$q$, 'permission denied');
commit;

-- The function is not executable by the roles that must not reach it.
do $$ declare n bigint; begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'observability_dashboard'
     and has_function_privilege('anon', p.oid, 'execute');
  assert n = 0, 'anon cannot execute the dashboard';

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'observability_dashboard'
     and has_function_privilege('service_role', p.oid, 'execute');
  assert n = 0, 'service_role cannot execute the dashboard';

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'observability_dashboard'
     and has_function_privilege('authenticated', p.oid, 'execute');
  assert n = 1, 'a signed-in staff member may execute the dashboard';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The dashboard opens to the operations lead and counts the records
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f126-ops'), true);
  insert into dash select * from public.observability_dashboard();
commit;

do $$ declare n bigint; begin
  select signal_value into n from dash where signal_key = 'payment_ambiguity';
  assert n = 1, 'one provider event has no outcome, got ' || coalesce(n::text, 'null');

  select signal_value into n from dash where signal_key = 'webhook_lag_minutes';
  assert n between 89 and 92, 'the undecided event is about ninety minutes old, got ' || n::text;

  select signal_value into n from dash where signal_key = 'reconciliation_differences';
  assert n = 1, 'one booking does not add up, got ' || n::text;

  select signal_value into n from dash where signal_key = 'overdue_release';
  assert n = 1, 'one release is past its deadline, got ' || n::text;

  select signal_value into n from dash where signal_key = 'refund_backlog';
  assert n = 1, 'one refund is not settled, got ' || n::text;

  select signal_value into n from dash where signal_key = 'frozen_money';
  assert n = 1, 'one pool is frozen, got ' || n::text;

  select signal_value into n from dash where signal_key = 'failed_charges_24h';
  assert n = 1, 'one charge failed in the day, got ' || n::text;

  select signal_value into n from dash where signal_key = 'payment_windows_closed';
  assert n = 1, 'one payment window closed unpaid, got ' || n::text;

  select signal_value into n from dash where signal_key = 'open_cases';
  assert n = 1, 'one case is open, got ' || n::text;

  select signal_value into n from dash where signal_key = 'ai_needs_human';
  assert n = 1, 'one investigation needs a person, got ' || n::text;

  select signal_value into n from dash where signal_key = 'unread_alerts';
  assert n = 1, 'one alert is unread, got ' || n::text;

  select signal_value into n from dash where signal_key = 'sensitive_reads_24h';
  assert n = 0, 'no sensitive record was read in the day, got ' || n::text;

  select count(*) into n from dash;
  assert n = 12, 'the dashboard answers with twelve signals, got ' || n::text;

  -- Every signal says what it means and how urgent it is.
  select count(*) into n from dash
   where signal_label is null or length(trim(signal_label)) < 3
      or detail is null or length(trim(detail)) < 10
      or severity not in ('critical', 'attention', 'info');
  assert n = 0, 'every signal is labelled, explained and graded';

  -- The critical signals are the ones that say money is unaccounted for.
  select count(*) into n from dash where severity = 'critical';
  assert n = 5, 'five signals are critical, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Every read is audited
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from public.audit_events
   where action = 'observability.viewed'
     and target_table = 'staff_grants'
     and target_id = (select id from public.staff_grants
                       where user_id = (select ops from ids) and capability = 'operations')
     and actor_user_id = (select ops from ids);
  assert n = 1, 'the dashboard read is on the audit trail, got ' || n::text;
end $$;

-- A refused read leaves nothing behind.
do $$ declare n bigint; begin
  select count(*) into n from public.audit_events
   where action = 'observability.viewed'
     and actor_user_id = (select support from ids);
  assert n = 0, 'a refused read is not recorded as a read';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The dashboard carries counters, not money and not people
-- ---------------------------------------------------------------------------
do $$ declare r text; begin
  r := lower(pg_get_function_result('public.observability_dashboard()'::regprocedure));
  assert position('amount' in r) = 0, 'the dashboard carries no amount';
  assert position('currency' in r) = 0, 'the dashboard carries no currency';
  assert position('email' in r) = 0, 'the dashboard carries no email address';
  assert position('name' in r) = 0, 'the dashboard carries no party name';
  assert position('reference' in r) = 0, 'the dashboard carries no provider reference';
  assert position('house' in r) = 0, 'the dashboard carries no house identifier';
end $$;

-- ---------------------------------------------------------------------------
-- 5. The records behind the dashboard cannot be read directly
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select pg_temp.expect_error($q$select * from public.fund_pool$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.payment_events$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.wallet_ledger$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.notifications$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.audit_events$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.cases$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.ai_interactions$q$, 'permission denied');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.observability_dashboard()$q$, 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 6. Revoking the grant closes the dashboard again
-- ---------------------------------------------------------------------------
update public.staff_grants
   set revoked_at = now()
 where user_id = (select ops from ids) and capability = 'operations';

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f126-ops'), true);
  select pg_temp.expect_error(
    $q$select * from public.observability_dashboard()$q$, 'forbidden: operations grant required');
commit;

-- ---------------------------------------------------------------------------
-- 7. Reading the dashboard moved no money
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from public.wallet_ledger;
  assert n = 3, 'the ledger still holds its three movements, got ' || n::text;

  select count(*) into n from public.fund_pool
   where (held_minor + released_70_minor + released_30_minor + refunded_minor) <> paid_minor;
  assert n = 0, 'every pool still balances';
end $$;

\o
select 'f126 observability dashboard: all assertions passed' as result;
