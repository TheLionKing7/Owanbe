-- F-46 AI Investigation-only Role. Raises on the first failure.
-- Covers: the identity exists and is powerless in itself; it holds no privilege on any payment
-- table, no privilege on a case or an interaction and no execute on any money function; nobody
-- can become it; the read it performs is owned by it, so the table read happens as the AI and
-- not as the platform; and the read an investigator gets is still the F-107 read, audited with
-- the grant and the purpose.
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
grant execute on all functions in schema pg_temp to authenticated, anon, service_role, investigation_only;

-- ---------------------------------------------------------------------------
-- Fixtures: a host, a vendor, an investigator with the grant, an outsider and an admin
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f46-host',        'host@example.test',        true, 'Ada Host'),
  ('auth0|f46-vendor',      'vendor@example.test',      true, 'Vee Vendor'),
  ('auth0|f46-investigator','investigator@example.test', true, 'Ivy Investigator'),
  ('auth0|f46-outsider',    'outsider@example.test',    true, 'Otto Outsider'),
  ('auth0|f46-root',        'root@example.test',        true, 'Root Admin');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', u.id, 'F46 Vendor' from public.users u where u.auth0_sub = 'auth0|f46-vendor';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F46 Host' from public.users u where u.auth0_sub = 'auth0|f46-host';

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select h.id, h.kind, h.owner_user_id, 'owner', '{}' from public.houses h
   where h.display_name like 'F46 %';

insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'ai_investigation', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f46-investigator' and r.auth0_sub = 'auth0|f46-root';

create temp table ids (
  host uuid, vendor uuid, investigator uuid, outsider uuid, root uuid);
insert into ids
  select (select id from public.houses where display_name = 'F46 Host'),
         (select id from public.houses where display_name = 'F46 Vendor'),
         (select id from public.users where auth0_sub = 'auth0|f46-investigator'),
         (select id from public.users where auth0_sub = 'auth0|f46-outsider'),
         (select id from public.users where auth0_sub = 'auth0|f46-root');

create temp table q1 (id uuid);
create temp table b1 (id uuid);
create temp table ai_grant (id uuid);
grant select, insert on ids, q1, b1, ai_grant to authenticated, anon, service_role, investigation_only;

insert into ai_grant select id from public.staff_grants
 where capability = 'ai_investigation'
   and user_id = (select investigator from ids);

-- The booking the AI will look at: a quote sent, accepted, paid and partly released.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f46-vendor'), true);
  insert into q1 select public.create_quote(vendor, host, current_date + 120, 'NGN', 'Ada: aso ebi',
    '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  select public.send_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f46-host'), true);
  select public.accept_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
commit;

insert into b1 select id from public.bookings where quote_id = (select id from q1);

begin;
  set local role service_role;
  select public.record_payment_event('charge.success', 'owanbe-ref46', 100000, 'NGN',
    '{"status":"success"}'::jsonb, (select id from b1));
  select public.record_payment_event('charge.failed', 'owanbe-ref46-second', 100000, 'NGN',
    '{"status":"failed","reason":"insufficient"}'::jsonb, (select id from b1));
commit;

-- ---------------------------------------------------------------------------
-- 1. The identity exists, and it is powerless in itself
-- ---------------------------------------------------------------------------
do $$ declare r record; begin
  select * into r from pg_roles where rolname = 'investigation_only';
  assert r is not null, 'the identity exists';
  assert r.rolcanlogin = false, 'the identity cannot sign in';
  assert r.rolsuper = false, 'the identity is not a superuser';
  assert r.rolcreatedb = false, 'the identity creates no databases';
  assert r.rolcreaterole = false, 'the identity creates no roles';
  assert r.rolinherit = false, 'the identity inherits nothing';
end $$;

-- It belongs to no role and no role belongs to it, so there is no path in and no path out.
do $$ declare n bigint; begin
  select count(*) into n from pg_auth_members m join pg_roles r on r.oid = m.member
   where r.rolname = 'investigation_only';
  assert n = 0, 'the identity is a member of no role, got ' || n::text;

  select count(*) into n from pg_auth_members m join pg_roles r on r.oid = m.roleid
   where r.rolname = 'investigation_only';
  assert n = 0, 'the identity has no members, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 2. It holds no privilege on any table
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from (values
    ('public.bookings'), ('public.fund_pool'), ('public.payment_events'),
    ('public.wallet_ledger'), ('public.cases'), ('public.ai_interactions'),
    ('public.quotes'), ('public.users'), ('public.houses'), ('public.audit_events'),
    ('public.staff_grants'), ('public.memberships')
  ) as t(rel)
   where has_table_privilege('investigation_only', t.rel, 'select')
      or has_table_privilege('investigation_only', t.rel, 'insert')
      or has_table_privilege('investigation_only', t.rel, 'update')
      or has_table_privilege('investigation_only', t.rel, 'delete');
  assert n = 0, 'the identity holds no privilege on any table, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 3. It holds no execute on any money function, nor on the RPCs the application calls
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from (values
    ('public.allocate_split_payment(uuid,text,bigint,text)'::regprocedure),
    ('public.record_payment_event(text,text,bigint,text,jsonb,uuid)'::regprocedure),
    ('public.complete_booking(uuid)'::regprocedure),
    ('public.freeze_fund_pool(uuid,text)'::regprocedure),
    ('public.unfreeze_fund_pool(uuid)'::regprocedure),
    ('public.request_fund_refund(uuid,text)'::regprocedure),
    ('public.settle_refund(uuid,text)'::regprocedure),
    ('public.release_due_fund_tranches()'::regprocedure),
    ('public.booking_for_payment_reference(text)'::regprocedure),
    ('public.ai_payment_log(uuid,text)'::regprocedure),
    ('public.ai_payment_event_log(uuid,text)'::regprocedure)
  ) as f(fn)
   where has_function_privilege('investigation_only', f.fn, 'execute');
  assert n = 0, 'the identity can execute no money function and no payment RPC, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Nobody can become the identity
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from (values ('authenticated'), ('anon'), ('service_role')) as r(name)
   where pg_has_role(r.name, 'investigation_only', 'member')
      or pg_has_role(r.name, 'investigation_only', 'set');
  assert n = 0, 'no application role may become the identity, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The read belongs to the identity
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'app_private'
     and p.proname in ('investigation_read', 'investigation_event_read')
     and pg_get_userbyid(p.proowner) = 'investigation_only';
  assert n = 2, 'both reads are owned by the identity, got ' || n::text;

  -- Nothing else in app_private is owned by it.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'app_private'
     and pg_get_userbyid(p.proowner) = 'investigation_only'
     and p.proname not in ('investigation_read', 'investigation_event_read');
  assert n = 0, 'the identity owns nothing else, got ' || n::text;
end $$;

-- The reads live in app_private, which the API does not expose, and no application role may run
-- them directly.
do $$ declare n bigint; begin
  select count(*) into n from (values
    ('app_private.investigation_read(uuid,text)'::regprocedure),
    ('app_private.investigation_event_read(uuid,text)'::regprocedure)
  ) as f(fn)
   where has_function_privilege('authenticated', f.fn, 'execute')
      or has_function_privilege('anon', f.fn, 'execute');
  assert n = 0, 'no application role may call the reads directly, got ' || n::text;
end $$;

-- And the identity holds no CREATE on the schema it lives in, so it cannot add to itself.
do $$ declare ok boolean; begin
  select has_schema_privilege('investigation_only', 'app_private', 'create') into ok;
  assert ok = false, 'the identity cannot create in app_private';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Acting as the identity, it can read the minimised view and nothing else
-- ---------------------------------------------------------------------------
begin;
  set local role investigation_only;
  select pg_temp.expect_error($q$select * from public.fund_pool$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.bookings$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.payment_events$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.audit_events$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.ai_interactions$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$insert into public.cases (subject, reason, source) values ('A case', 'A reason long enough', 'staff')$q$,
    'permission denied');
  select pg_temp.expect_error(
    $q$update public.payment_events set outcome = 'ignored'$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$select public.allocate_split_payment(null, 'owanbe-f46', 1, 'NGN')$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$select * from public.ai_payment_log(null, 'A purpose that is long enough')$q$,
    'permission denied');

  -- The whole of what it may read is the minimised view: money and state, no person.
  do $$ declare n bigint; begin
    select count(*) into n from app_private.investigation_payment_view v
     where v.booking_id = (select id from b1);
    assert n = 1, 'the identity sees the booking, got ' || n::text;
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 7. The investigator's read is unchanged, and it is still the AI's own read
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f46-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.ai_investigation_status();
    assert r.can_investigate = true, 'the investigator may investigate';
  end $$;

  do $$ declare r record; begin
    select * into r from public.ai_payment_log(
      (select id from b1), 'Tracing a failed payment for a booking');
    assert r.currency = 'NGN', 'the currency is kept';
    assert r.total_minor = 100000, 'the agreed total, got ' || r.total_minor::text;
    assert r.paid_minor = 100000, 'the whole amount is paid, got ' || r.paid_minor::text;
    assert r.held_minor = 30000, 'the last tranche is still held, got ' || r.held_minor::text;
    assert r.released_minor = 70000, 'the first tranche is out, got ' || r.released_minor::text;
    assert r.refunded_minor = 0, 'nothing is refunded';
    assert r.frozen = false, 'the money is not frozen';
    assert r.event_count = 2, 'both provider events are on record, got ' || r.event_count::text;
    assert r.failed_event_count = 1, 'the failed charge is on record, got ' || r.failed_event_count::text;
  end $$;

  do $$ declare r record; begin
    select * into r from public.ai_payment_event_log(
      (select id from b1), 'Tracing a failed payment for a booking');
    assert r.event_type = 'charge.failed', 'the failed charge is the newest event, got ' || r.event_type;
    assert r.outcome = 'ignored', 'the failed charge changed nothing';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 8. The read is still a sensitive read, and it is still audited
-- ---------------------------------------------------------------------------
do $$ declare n bigint; d jsonb; begin
  select count(*) into n from public.audit_events
   where action = 'sensitive.read' and target_table = 'fund_pool'
     and target_id = (select id from b1);
  assert n = 1, 'the payment log read is on the trail, got ' || n::text;

  select count(*) into n from public.audit_events
   where action = 'sensitive.read' and target_table = 'payment_events'
     and target_id = (select id from b1);
  assert n = 1, 'the event log read is on the trail, got ' || n::text;

  select details into d from public.audit_events
   where action = 'sensitive.read' and target_table = 'fund_pool'
     and target_id = (select id from b1) limit 1;
  assert d ->> 'staff_grant_id' = (select id::text from ai_grant),
    'the audit row names the grant that opened the door';
end $$;

-- ---------------------------------------------------------------------------
-- 9. The refusals are unchanged
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f46-outsider'), true);
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Looking at the payment trail')$q$,
    (select id from b1)), 'forbidden: ai_investigation grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f46-investigator'), true);
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'why')$q$, (select id from b1)), 'purpose_required');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Nobody signed in at all')$q$,
    (select id from b1)), 'permission denied');
commit;

-- The gate still closes the read, whoever is asking.
update app_private.ai_settings
   set zdr_confirmed = false,
       zdr_provider = null,
       zdr_contract_ref = null,
       zdr_confirmed_at = null,
       zdr_confirmed_by = null,
       updated_at = now()
 where id;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f46-investigator'), true);
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Tracing a failed payment for a booking')$q$,
    (select id from b1)), 'zdr_contract_required');
commit;

-- And the gate is opened again, the way the owner opens it.
update app_private.ai_settings
   set zdr_confirmed = true,
       zdr_provider = 'Lovable AI Gateway (OpenAI gpt, zero data retention)',
       zdr_contract_ref = 'owner confirmation 2026-11-10, Sage 7 question 3e793b14',
       zdr_confirmed_at = now(),
       zdr_confirmed_by = (select root from ids)
 where id;

-- ---------------------------------------------------------------------------
-- 10. The money did not move
-- ---------------------------------------------------------------------------
do $$ declare p record; begin
  select * into p from public.fund_pool where booking_id = (select id from b1);
  assert p.paid_minor = 100000, 'the amount paid has not changed, got ' || p.paid_minor::text;
  assert p.held_minor = 30000, 'the held amount has not changed, got ' || p.held_minor::text;
  assert p.released_70_minor = 70000, 'the first tranche has not changed';
  assert p.released_30_minor = 0, 'the last tranche has not moved';
  assert p.refunded_minor = 0, 'nothing has been refunded';
  assert p.frozen = false, 'the money has not been frozen';
end $$;

\o
select 'F-46 investigation-only role tests passed' as result;
