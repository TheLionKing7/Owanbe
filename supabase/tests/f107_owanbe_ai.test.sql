-- F-107 OwanbeAI tests. Raises on the first failure.
-- Covers: the zero-retention gate is closed until the owner records a contract, and no
-- application role can open it; the 'ai_investigation' grant reads a minimised payment log and
-- every read is audited as a sensitive read; the AI cannot allocate, refund, settle, freeze,
-- complete or release anything; the AI opens its own case, and a case holds no money fields; one
-- answer can be reported once; and nobody writes the tables directly.
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
-- Fixtures: a host, a vendor, an investigator, a support member and an outsider
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f107-host',       'host@example.test',       true, 'Ada Host'),
  ('auth0|f107-vendor',     'vendor@example.test',     true, 'Vee Vendor'),
  ('auth0|f107-investigator','investigator@example.test',true, 'Ivy Investigator'),
  ('auth0|f107-support',    'support@example.test',    true, 'Sam Support'),
  ('auth0|f107-root',       'root@example.test',       true, 'Root Admin'),
  ('auth0|f107-outsider',   'outsider@example.test',   true, 'Otto Outsider');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', u.id, 'F107 Vendor' from public.users u where u.auth0_sub = 'auth0|f107-vendor';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F107 Host' from public.users u where u.auth0_sub = 'auth0|f107-host';

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select h.id, h.kind, h.owner_user_id, 'owner', '{}' from public.houses h
   where h.display_name like 'F107 %';

-- 'ai_investigation' is new in F-107. The investigator reads the payment log; support keeps its
-- own meaning and does not open the AI's door.
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'ai_investigation', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f107-investigator' and r.auth0_sub = 'auth0|f107-root';
insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'support', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f107-support' and r.auth0_sub = 'auth0|f107-root';

create temp table ids (
  host uuid, vendor uuid, investigator uuid, support uuid, root uuid, outsider uuid);
insert into ids
  select (select id from public.houses where display_name = 'F107 Host'),
         (select id from public.houses where display_name = 'F107 Vendor'),
         (select id from public.users where auth0_sub = 'auth0|f107-investigator'),
         (select id from public.users where auth0_sub = 'auth0|f107-support'),
         (select id from public.users where auth0_sub = 'auth0|f107-root'),
         (select id from public.users where auth0_sub = 'auth0|f107-outsider');

create temp table q1 (id uuid);
create temp table b1 (id uuid);
create temp table ai_interaction (id uuid);
create temp table ai_case (id uuid);
create temp table ai_grant (id uuid);
grant select, insert on ids, q1, b1, ai_interaction, ai_case, ai_grant to authenticated, anon, service_role;

insert into ai_grant select id from public.staff_grants
 where capability = 'ai_investigation'
   and user_id = (select investigator from ids);

-- The booking the AI will look at: a quote sent, accepted, paid and partly released.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-vendor'), true);
  insert into q1 select public.create_quote(vendor, host, current_date + 120, 'NGN', 'Ada: aso ebi',
    '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  select public.send_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-host'), true);
  select public.accept_quote(q.id, v.version) from q1 join public.quotes v on v.id = q1.id;
commit;

insert into b1 select id from public.bookings where quote_id = (select id from q1);

begin;
  set local role service_role;
  select public.record_payment_event('charge.success', 'owanbe-ref107', 100000, 'NGN',
    '{"status":"success"}'::jsonb, (select id from b1));
  -- A later charge attempt that failed. It keeps the booking it was sent for.
  select public.record_payment_event('charge.failed', 'owanbe-ref107-second', 100000, 'NGN',
    '{"status":"failed","reason":"insufficient"}'::jsonb, (select id from b1));
commit;

-- ---------------------------------------------------------------------------
-- 1. The zero-retention gate is closed until the owner records a contract
-- ---------------------------------------------------------------------------
do $$ declare c boolean; begin
  select zdr_confirmed into c from app_private.ai_settings where id;
  assert c = false, 'the gate starts closed';
end $$;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.ai_investigation_status();
    assert r.zdr_confirmed = false, 'the gate is still closed';
    assert r.has_grant = true, 'the investigator holds the grant';
    assert r.can_investigate = false, 'the grant is not enough while the gate is closed';
  end $$;
  -- The payment log is refused: the data would leave for a model that has not contracted to
  -- keep nothing.
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Tracing a failed payment for a booking')$q$,
    (select id from b1)), 'zdr_contract_required');
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_event_log(%L, 'Tracing a failed payment for a booking')$q$,
    (select id from b1)), 'zdr_contract_required');
  select pg_temp.expect_error(format(
    $q$select public.log_ai_interaction('payment_investigation', 'Why has this payment not been released?',
       'The last tranche is still held.', 'The money is held and the window has not closed.',
       'openai/gpt-6-astra', 'answered', %L)$q$,
    (select id from b1)), 'zdr_contract_required');
commit;

-- ---------------------------------------------------------------------------
-- 2. No application role can open the gate
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select pg_temp.expect_error(
    $q$update app_private.ai_settings set zdr_confirmed = true, zdr_provider = 'x',
       zdr_contract_ref = 'y', zdr_confirmed_at = now() where id$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from app_private.ai_settings$q$, 'permission denied');
commit;

begin;
  set local role service_role;
  select pg_temp.expect_error(
    $q$update app_private.ai_settings set zdr_confirmed = true, zdr_provider = 'x',
       zdr_contract_ref = 'y', zdr_confirmed_at = now() where id$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from app_private.ai_settings$q$, 'permission denied');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error(
    $q$update app_private.ai_settings set zdr_confirmed = true, zdr_provider = 'x',
       zdr_contract_ref = 'y', zdr_confirmed_at = now() where id$q$, 'permission denied');
commit;

-- The owner opens the gate in the database. No application path does it.
update app_private.ai_settings
   set zdr_confirmed = true,
       zdr_provider = 'owner-contracted-zdr-provider',
       zdr_contract_ref = 'OWNER-CONTRACT-2026-11-09',
       zdr_confirmed_at = now(),
       zdr_confirmed_by = (select root from ids)
 where id;

-- ---------------------------------------------------------------------------
-- 3. The investigator reads the payment log
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.ai_investigation_status();
    assert r.zdr_confirmed = true, 'the contract is recorded, so the gate is open';
    assert r.can_investigate = true, 'the investigator may investigate';
  end $$;

  do $$ declare r record; begin
    select * into r from public.ai_payment_log(
      (select id from b1), 'Tracing a failed payment for a booking');
    assert r.booking_id = (select id from b1), 'the log names the booking';
    assert r.currency = 'NGN', 'the currency is kept';
    assert r.total_minor = 100000, 'the agreed total, got ' || r.total_minor::text;
    assert r.paid_minor = 100000, 'the whole amount is paid, got ' || r.paid_minor::text;
    assert r.held_minor = 30000, 'the last tranche is still held, got ' || r.held_minor::text;
    assert r.released_minor = 70000, 'the first tranche is out, got ' || r.released_minor::text;
    assert r.refunded_minor = 0, 'nothing is refunded';
    assert r.frozen = false, 'the money is not frozen';
    assert r.event_count = 2, 'both provider events are on record, got ' || r.event_count::text;
    assert r.failed_event_count = 1, 'the failed charge is on record, got ' || r.failed_event_count::text;
    assert r.movement_count > 0, 'the movements are counted';
  end $$;

  do $$ declare r record; begin
    select * into r from public.ai_payment_event_log(
      (select id from b1), 'Tracing a failed payment for a booking');
    assert r.event_type = 'charge.failed', 'the failed charge is the newest event, got ' || r.event_type;
    assert r.outcome = 'ignored', 'the failed charge changed nothing';
  end $$;

  -- A second read of the same log, so the trail can be counted.
  select count(*) from public.ai_payment_log(
    (select id from b1), 'Tracing a failed payment for a booking');
commit;

-- ---------------------------------------------------------------------------
-- 4. The log is minimised: money and state, never a person
-- ---------------------------------------------------------------------------
do $$ declare r text; begin
  r := lower(pg_get_function_result('public.ai_payment_log(uuid,text)'::regprocedure));
  assert position('email' in r) = 0, 'the payment log carries no email address';
  assert position('reference' in r) = 0, 'the payment log carries no provider reference';
  assert position('name' in r) = 0, 'the payment log carries no party name';

  r := lower(pg_get_function_result('public.ai_payment_event_log(uuid,text)'::regprocedure));
  assert position('payload' in r) = 0, 'the event log carries no provider payload';
  assert position('reference' in r) = 0, 'the event log carries no provider reference';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Every read is a sensitive read, and it is audited
-- ---------------------------------------------------------------------------
do $$ declare n bigint; d jsonb; begin
  select count(*) into n from public.audit_events
   where action = 'sensitive.read' and target_table = 'fund_pool'
     and target_id = (select id from b1);
  assert n = 2, 'the payment log was read twice and both reads are on the trail, got ' || n::text;

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

-- The read carries a purpose, so nobody reads the money log without saying why.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'why')$q$, (select id from b1)), 'purpose_required');
commit;

-- ---------------------------------------------------------------------------
-- 6. Nobody else reads the payment log
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-host'), true);
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Looking at my own booking money')$q$,
    (select id from b1)), 'forbidden: ai_investigation grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-support'), true);
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Support is asking about the payment')$q$,
    (select id from b1)), 'forbidden: ai_investigation grant required');
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_event_log(%L, 'Support is asking about the payment')$q$,
    (select id from b1)), 'forbidden: ai_investigation grant required');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Nobody signed in at all')$q$,
    (select id from b1)), 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 7. The AI has no money authority
-- ---------------------------------------------------------------------------
-- The money functions are not granted to 'authenticated' at all, so an investigator cannot reach
-- them whatever they hold.
do $$ declare n bigint; begin
  select count(*) into n from (values
    ('public.allocate_split_payment(uuid,text,bigint,text)'::regprocedure),
    ('public.record_payment_event(text,text,bigint,text,jsonb,uuid)'::regprocedure),
    ('public.booking_for_payment_reference(text)'::regprocedure),
    ('public.release_due_fund_tranches()'::regprocedure),
    ('public.settle_refund(uuid,text)'::regprocedure)
  ) as f(fn)
   where has_function_privilege('authenticated', f.fn, 'execute');
  assert n = 0, 'no money function is executable by an application user, got ' || n::text;
end $$;

-- And the money functions that a signed-in user may call still refuse the investigator.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  select pg_temp.expect_error(format(
    $q$select public.complete_booking(%L)$q$, (select id from b1)),
    'forbidden: not the host of this booking');
  select pg_temp.expect_error(format(
    $q$select public.freeze_fund_pool(%L, 'The AI thinks this is a problem')$q$,
    (select id from b1)), 'forbidden: arbitrator grant required');
  select pg_temp.expect_error(format(
    $q$select public.unfreeze_fund_pool(%L)$q$, (select id from b1)),
    'forbidden: arbitrator grant required');
  select pg_temp.expect_error(format(
    $q$select public.request_fund_refund(%L, 'The AI thinks this should be refunded')$q$,
    (select id from b1)), 'forbidden: refund not allowed');
  select pg_temp.expect_error(format(
    $q$select public.allocate_split_payment(%L, 'owanbe-ai-ref', 50000, 'NGN')$q$,
    (select id from b1)), 'permission denied');
  select pg_temp.expect_error(format(
    $q$select public.settle_refund(%L, 'owanbe-ai-ref')$q$, (select id from b1)), 'permission denied');
  select pg_temp.expect_error(
    $q$select public.release_due_fund_tranches()$q$, 'permission denied');
commit;

-- The money did not move.
do $$ declare p record; begin
  select * into p from public.fund_pool where booking_id = (select id from b1);
  assert p.paid_minor = 100000, 'the amount paid has not changed, got ' || p.paid_minor::text;
  assert p.held_minor = 30000, 'the held amount has not changed, got ' || p.held_minor::text;
  assert p.released_70_minor = 70000, 'the first tranche has not changed';
  assert p.released_30_minor = 0, 'the last tranche has not moved';
  assert p.refunded_minor = 0, 'nothing has been refunded';
  assert p.frozen = false, 'the money has not been frozen';
  assert p.status = 'partially_released', 'the pool stands where it stood, got ' || p.status;
end $$;

-- And the investigator left no money trail on the audit log.
do $$ declare n bigint; begin
  select count(*) into n from public.audit_events
   where actor_user_id = (select investigator from ids)
     and action in ('fund.frozen', 'fund.unfrozen', 'booking.completed', 'fund.released');
  assert n = 0, 'the investigator moved no money, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The AI opens its own case
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  insert into ai_interaction select public.log_ai_interaction('payment_investigation',
    'Why has the last tranche not been released for this booking?',
    'The host paid in full. The first tranche went out and the last one is still held.',
    'The payment arrived and the completion window has not closed yet.',
    'openai/gpt-6-astra', 'answered', (select id from b1));
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  insert into ai_case select public.open_ai_case((select id from ai_interaction),
    'The last tranche is still held after the window opened',
    'The host paid in full and the completion window has opened, but the last tranche is still held.',
    'high');
commit;

do $$ declare c record; i record; begin
  select * into c from public.cases where id = (select id from ai_case);
  assert c.id is not null, 'the AI opened a case';
  assert c.source = 'ai_investigation', 'the case says who raised it, got ' || c.source;
  assert c.ai_interaction_id = (select id from ai_interaction), 'the case points at the answer';
  assert c.booking_id = (select id from b1), 'the case names the booking';
  assert c.opened_by = (select investigator from ids), 'the case records who asked';
  assert c.priority = 'high', 'the case keeps the urgency, got ' || c.priority;
  assert c.status = 'open', 'the case is open, got ' || c.status;
  assert position('window' in c.reason) > 0, 'the case carries the plain-language reason';

  select * into i from public.ai_interactions where id = (select id from ai_interaction);
  assert i.outcome = 'opened_case', 'the answer records that it opened a case, got ' || i.outcome;
end $$;

-- A case holds no money fields, so it cannot carry an instruction to move money.
do $$ declare n bigint; begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'cases'
     and (column_name like '%minor%' or column_name like '%amount%' or column_name like '%paid%'
          or column_name like '%released%' or column_name like '%refunded%');
  assert n = 0, 'a case holds no money fields, got ' || n::text;
end $$;

-- The investigator reads the cases; support does not.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  do $$ declare n bigint; begin
    select count(*) into n from public.read_ai_cases(null);
    assert n = 1, 'the investigator sees the case, got ' || n::text;
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-support'), true);
  select pg_temp.expect_error($q$select * from public.read_ai_cases(null)$q$,
    'forbidden: ai_investigation grant required');
commit;

-- Opening a case moved no money.
do $$ declare p record; begin
  select * into p from public.fund_pool where booking_id = (select id from b1);
  assert p.held_minor = 30000 and p.released_30_minor = 0 and p.refunded_minor = 0,
    'opening a case changed no money';
end $$;

-- ---------------------------------------------------------------------------
-- 9. One answer can be reported once
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  select public.report_ai_interaction((select id from ai_interaction), 'wrong_facts',
    'The answer said the payment had failed when it had succeeded.');
  select pg_temp.expect_error(format(
    $q$select public.report_ai_interaction(%L, 'other', 'A second report')$q$,
    (select id from ai_interaction)), 'already_reported');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-support'), true);
  select pg_temp.expect_error(format(
    $q$select public.report_ai_interaction(%L, 'wrong_facts', 'Not my answer')$q$,
    (select id from ai_interaction)), 'interaction_not_found');
commit;

do $$ declare i record; begin
  select * into i from public.ai_interactions where id = (select id from ai_interaction);
  assert i.reported_at is not null, 'the report is on the answer';
  assert i.report_category = 'wrong_facts', 'the report says what was wrong, got ' || i.report_category;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Nobody writes the tables directly
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  select pg_temp.expect_error($q$select * from public.cases$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.ai_interactions$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$insert into public.cases (subject, reason, source) values ('A case', 'A reason that is long enough', 'staff')$q$,
    'permission denied');
  select pg_temp.expect_error(
    $q$update public.cases set status = 'closed'$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$insert into public.ai_interactions (surface, actor_user_id, request_summary, response_text, model, outcome)
     values ('payment_investigation', (select investigator from ids), 'A question', 'An answer', 'openai/gpt-6-astra', 'answered')$q$,
    'permission denied');
  select pg_temp.expect_error(
    $q$update public.ai_interactions set response_text = 'A different answer'$q$, 'permission denied');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.cases$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.ai_interactions$q$, 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 11. The grant is revocable, and the door closes with it
-- ---------------------------------------------------------------------------
update public.staff_grants set revoked_at = now()
 where id = (select id from ai_grant);

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.ai_investigation_status();
    assert r.has_grant = false, 'the revoked grant is gone';
    assert r.can_investigate = false, 'the door is closed';
  end $$;
  select pg_temp.expect_error(format(
    $q$select * from public.ai_payment_log(%L, 'Trying again after the grant was revoked')$q$,
    (select id from b1)), 'forbidden: ai_investigation grant required');
  select pg_temp.expect_error(format(
    $q$select public.open_ai_case(%L, 'A case', 'A reason that is long enough', 'normal')$q$,
    (select id from ai_interaction)), 'forbidden: ai_investigation grant required');
commit;

\o
select 'F-107 OwanbeAI tests passed' as result;
