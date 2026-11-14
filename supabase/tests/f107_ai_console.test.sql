-- F-107 OwanbeAI console tests. Raises on the first failure.
-- Covers: the console is closed to anyone without the 'ai_investigation' grant and to anyone who
-- is not signed in; the case queue and the answer queue can be read; every read is audited, and
-- the read of the answers is a sensitive read with a purpose; a case can be worked through
-- investigating, waiting, resolved and closed, and the moves it may not make are refused; the
-- note a staff member leaves is kept and comes back with the case; the answers OwanbeAI gave the
-- caller are the caller's own and nobody else's; the AI's own identity cannot reach any of it;
-- and working a case moved no money.
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
-- Fixtures: an investigator, a host, an outsider and the root who grants
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f107c-investigator', 'investigator2@example.test', true, 'Ivy Investigator'),
  ('auth0|f107c-host',        'host2@example.test',        true, 'Ada Host'),
  ('auth0|f107c-outsider',    'outsider2@example.test',    true, 'Otto Outsider'),
  ('auth0|f107c-root',        'root2@example.test',        true, 'Root Admin');

insert into public.staff_grants (user_id, capability, scope_kind, granted_by)
  select u.id, 'ai_investigation', 'global', r.id
    from public.users u, public.users r
   where u.auth0_sub = 'auth0|f107c-investigator' and r.auth0_sub = 'auth0|f107c-root';

create temp table ids (investigator uuid, host uuid, outsider uuid, root uuid);
insert into ids
  select (select id from public.users where auth0_sub = 'auth0|f107c-investigator'),
         (select id from public.users where auth0_sub = 'auth0|f107c-host'),
         (select id from public.users where auth0_sub = 'auth0|f107c-outsider'),
         (select id from public.users where auth0_sub = 'auth0|f107c-root');

create temp table ai_grant (id uuid);
create temp table ai_interaction (id uuid);
create temp table ai_case (id uuid);
grant select, insert on ids, ai_grant, ai_interaction, ai_case to authenticated, anon, service_role;

insert into ai_grant select id from public.staff_grants
 where capability = 'ai_investigation'
   and user_id = (select investigator from ids);

-- The zero-retention contract is recorded by the owner. The suite opens the gate itself so it
-- does not depend on which suite ran before it.
update app_private.ai_settings
   set zdr_confirmed = true,
       zdr_provider = 'Lovable AI Gateway (OpenAI gpt, zero data retention)',
       zdr_contract_ref = 'owner confirmation 2026-11-10, Sage 7 question 3e793b14',
       zdr_confirmed_at = now(),
       zdr_confirmed_by = (select root from ids)
 where id;

-- The AI answers a question and opens a case, the way it does in the application.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  insert into ai_interaction select public.log_ai_interaction('payment_investigation',
    'Why has the last tranche not been released for this booking?',
    'The host paid in full. The first tranche went out and the last one is still held.',
    'The payment arrived and the completion window has not closed yet.',
    'openai/gpt-6-astra', 'answered', null);
  insert into ai_case select public.open_ai_case((select id from ai_interaction),
    'The last tranche is still held after the window opened',
    'The host paid in full and the completion window has opened, but the last tranche is still held.',
    'high');
commit;

-- ---------------------------------------------------------------------------
-- 1. The console is closed to anyone without the grant
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-host'), true);
  select pg_temp.expect_error($q$select * from public.read_ai_cases(null)$q$,
    'forbidden: ai_investigation grant required');
  select pg_temp.expect_error($q$select * from public.read_ai_interactions(null)$q$,
    'forbidden: ai_investigation grant required');
  select pg_temp.expect_error(format(
    $q$select public.update_ai_case(%L, 'investigating', 'I will look at this')$q$,
    (select id from ai_case)), 'forbidden: ai_investigation grant required');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-outsider'), true);
  select pg_temp.expect_error($q$select * from public.read_ai_cases(null)$q$,
    'forbidden: ai_investigation grant required');
  select pg_temp.expect_error($q$select * from public.read_ai_interactions(null)$q$,
    'forbidden: ai_investigation grant required');
commit;

-- ---------------------------------------------------------------------------
-- 2. The console is closed to anyone who is not signed in
-- ---------------------------------------------------------------------------
begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.read_ai_cases(null)$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.read_ai_interactions(null)$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.my_ai_interactions()$q$, 'permission denied');
  select pg_temp.expect_error(format(
    $q$select public.update_ai_case(%L, 'investigating', 'Nobody is signed in')$q$,
    (select id from ai_case)), 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 3. The investigator reads the case queue
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.read_ai_cases(null) where case_id = (select id from ai_case);
    assert r.case_id = (select id from ai_case), 'the queue holds the case, got ' || r.case_id::text;
    assert r.case_reference ~ '^CASE-[0-9A-F]{12}$', 'the case has its reference';
    assert r.status = 'open', 'the case is open, got ' || r.status;
    assert r.priority = 'high', 'the urgency is kept, got ' || r.priority;
    assert r.source = 'ai_investigation', 'the case says who raised it, got ' || r.source;
    assert r.ai_interaction_id = (select id from ai_interaction), 'the case points at the answer';
    assert r.updated_at is not null, 'the case says when it was last touched';
    assert r.notes = '[]'::jsonb, 'the case has no notes yet, got ' || r.notes::text;
  end $$;

  -- The queue can be filtered by status.
  do $$ declare n bigint; begin
    select count(*) into n from public.read_ai_cases('open');
    assert n >= 1, 'the open queue holds the case, got ' || n::text;
    select count(*) into n from public.read_ai_cases('closed');
    assert n = 0, 'the closed queue is empty, got ' || n::text;
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 4. The investigator reads the answer queue
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.read_ai_interactions(null) where interaction_id = (select id from ai_interaction);
    assert r.interaction_id = (select id from ai_interaction), 'the queue holds the answer';
    assert r.surface = 'payment_investigation', 'the answer names its surface, got ' || r.surface;
    assert r.model = 'openai/gpt-6-astra', 'the answer names the model, got ' || r.model;
    assert position('last tranche' in r.response_text) > 0, 'the answer is kept as it was shown';
    assert r.case_id = (select id from ai_case), 'the answer points at the case';
    assert r.case_reference ~ '^CASE-[0-9A-F]{12}$', 'the answer names the case reference';
    assert r.reported_at is null, 'the answer has not been reported';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 5. Every read is audited
-- ---------------------------------------------------------------------------
do $$ declare n bigint; d jsonb; begin
  select count(*) into n from public.audit_events
   where action = 'ai.cases_viewed'
     and actor_user_id = (select investigator from ids);
  assert n >= 1, 'the case read is on the trail, got ' || n::text;

  select count(*) into n from public.audit_events
   where action = 'sensitive.read' and target_table = 'ai_interactions';
  assert n >= 1, 'the answer read is on the trail, got ' || n::text;

  select details into d from public.audit_events
   where action = 'sensitive.read' and target_table = 'ai_interactions' limit 1;
  assert d ->> 'staff_grant_id' = (select id::text from ai_grant),
    'the audit row names the grant that opened the door';
end $$;

-- The sensitive read carries a purpose, so nobody reads the answers without saying why.
do $$ declare p text; begin
  select purpose into p from public.audit_events
   where action = 'sensitive.read' and target_table = 'ai_interactions' limit 1;
  assert p is not null and length(p) >= 10, 'the sensitive read carries a purpose';
end $$;

-- ---------------------------------------------------------------------------
-- 6. A case is worked through, and the trail says who moved it
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select public.update_ai_case((select id from ai_case), 'investigating',
    'Looking at the release window on this booking now.');
commit;

do $$ declare c record; begin
  select * into c from public.cases where id = (select id from ai_case);
  assert c.status = 'investigating', 'the case is being worked, got ' || c.status;
  assert c.version > 1, 'the case keeps its version, got ' || c.version::text;
  assert c.updated_at > c.created_at, 'the case says when it was last touched';
end $$;

do $$ declare n bigint; d jsonb; begin
  select count(*) into n from public.audit_events
   where action = 'ai.case_updated' and target_id = (select id from ai_case);
  assert n = 1, 'the move is on the trail, got ' || n::text;

  select details into d from public.audit_events
   where action = 'ai.case_updated' and target_id = (select id from ai_case);
  assert d ->> 'from' = 'open', 'the trail says where the case came from, got ' || (d ->> 'from');
  assert d ->> 'to' = 'investigating', 'the trail says where the case went, got ' || (d ->> 'to');
  assert d ? 'note', 'the trail says that a note was left';
  assert (d ->> 'note')::int = length('Looking at the release window on this booking now.'),
    'the trail counts the note rather than keeping it, got ' || (d ->> 'note');
end $$;

-- The note is kept, and it comes back with the case.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.read_ai_cases(null) where case_id = (select id from ai_case);
    assert jsonb_array_length(r.notes) = 1, 'the case carries one note, got ' || r.notes::text;
    assert r.notes -> 0 ->> 'body' = 'Looking at the release window on this booking now.',
      'the note reads back as it was written';
    assert r.notes -> 0 ->> 'author' = (select investigator::text from ids),
      'the note says who wrote it';
  end $$;
commit;

-- The rest of the way through: waiting, resolved, closed.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select public.update_ai_case((select id from ai_case), 'waiting_on_customer', null);
  select public.update_ai_case((select id from ai_case), 'resolved', 'The window closed; the host was paid.');
  select public.update_ai_case((select id from ai_case), 'closed', null);
commit;

do $$ declare c record; n bigint; begin
  select * into c from public.cases where id = (select id from ai_case);
  assert c.status = 'closed', 'the case is closed, got ' || c.status;

  select count(*) into n from public.audit_events
   where action = 'ai.case_updated' and target_id = (select id from ai_case);
  assert n = 4, 'every move is on the trail, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The moves that are refused
-- ---------------------------------------------------------------------------
-- A closed case stays closed.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select pg_temp.expect_error(format(
    $q$select public.update_ai_case(%L, 'investigating', 'Reopening a closed case')$q$,
    (select id from ai_case)), 'invalid_case_transition');
commit;

-- A status that is not one of the five.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select pg_temp.expect_error(format(
    $q$select public.update_ai_case(%L, 'done', 'A status that does not exist')$q$,
    (select id from ai_case)), 'invalid_case_status');
commit;

-- A case that is not there.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select pg_temp.expect_error(
    $q$select public.update_ai_case(gen_random_uuid(), 'investigating', 'A case that is not there')$q$,
    'case_not_found');
commit;

-- A note that says nothing, and a note that carries a card number.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select pg_temp.expect_error(format(
    $q$select public.update_ai_case(%L, 'resolved', '   ')$q$, (select id from ai_case)),
    'invalid_case_note');
  select pg_temp.expect_error(format(
    $q$select public.update_ai_case(%L, 'resolved', 'pay this 4111 1111 1111 1111')$q$,
    (select id from ai_case)), 'case_note_no_credentials');
commit;

-- A refused move leaves the case where it was and writes nothing.
do $$ declare c record; n bigint; begin
  select * into c from public.cases where id = (select id from ai_case);
  assert c.status = 'closed', 'the case stands where it stood, got ' || c.status;

  select count(*) into n from public.audit_events
   where action = 'ai.case_updated' and target_id = (select id from ai_case);
  assert n = 4, 'the refused moves wrote nothing, got ' || n::text;

  select count(*) into n from public.ai_case_notes where case_id = (select id from ai_case);
  assert n = 2, 'the refused notes were not kept, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 8. The answers OwanbeAI gave the caller are the caller's own
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  do $$ declare r record; begin
    select * into r from public.my_ai_interactions() where interaction_id = (select id from ai_interaction);
    assert r.interaction_id = (select id from ai_interaction), 'the caller sees their own answer';
    assert r.model = 'openai/gpt-6-astra', 'the answer names the model, got ' || r.model;
    assert r.case_id = (select id from ai_case), 'the answer points at the case';
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-host'), true);
  do $$ declare n bigint; begin
    select count(*) into n from public.my_ai_interactions();
    assert n = 0, 'the host sees none of the investigator''s answers, got ' || n::text;
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-outsider'), true);
  do $$ declare n bigint; begin
    select count(*) into n from public.my_ai_interactions();
    assert n = 0, 'an outsider sees none of the answers, got ' || n::text;
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 9. The AI's own identity cannot reach the console
-- ---------------------------------------------------------------------------
-- The identity OwanbeAI reads as (F-46) may not read the queue, read the answers, work a case or
-- read a case note. A person holds the grant; the AI does not.
do $$ declare n bigint; begin
  select count(*) into n from (values
    ('public.read_ai_cases(text)'::regprocedure),
    ('public.read_ai_interactions(text)'::regprocedure),
    ('public.update_ai_case(uuid,text,text)'::regprocedure),
    ('public.my_ai_interactions()'::regprocedure)
  ) as f(fn)
   where has_function_privilege('investigation_only', f.fn, 'execute');
  assert n = 0, 'the AI''s identity cannot call the console, got ' || n::text;
end $$;

do $$ declare n bigint; begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'investigation_only' and table_name in ('cases', 'ai_interactions', 'ai_case_notes');
  assert n = 0, 'the AI''s identity holds no grant on the console tables, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Nobody writes the tables directly
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select pg_temp.expect_error($q$select * from public.ai_case_notes$q$, 'permission denied');
  select pg_temp.expect_error(format(
    $q$insert into public.ai_case_notes (case_id, author_user_id, body) values (%L, %L, 'A note written straight to the table')$q$,
    (select id from ai_case), (select investigator from ids)), 'permission denied');
  select pg_temp.expect_error(format(
    $q$update public.ai_case_notes set body = 'A changed note'$q$), 'permission denied');
  select pg_temp.expect_error($q$delete from public.ai_case_notes$q$, 'permission denied');
  select pg_temp.expect_error(
    $q$update public.cases set status = 'closed'$q$, 'permission denied');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.ai_case_notes$q$, 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 11. Working a case moved no money
-- ---------------------------------------------------------------------------
do $$ declare n bigint; begin
  select count(*) into n from public.audit_events
   where actor_user_id = (select investigator from ids)
     and action in ('fund.frozen', 'fund.unfrozen', 'booking.completed', 'fund.released',
                    'fund.refund_requested', 'payment.allocated');
  assert n = 0, 'working a case moved no money, got ' || n::text;
end $$;

-- The case still holds no money fields, so it cannot carry an instruction to move money.
do $$ declare n bigint; begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'cases'
     and (column_name like '%minor%' or column_name like '%amount%' or column_name like '%paid%'
          or column_name like '%released%' or column_name like '%refunded%');
  assert n = 0, 'a case holds no money fields, got ' || n::text;
end $$;

-- The grant is revocable, and the console closes with it.
update public.staff_grants set revoked_at = now() where id = (select id from ai_grant);

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f107c-investigator'), true);
  select pg_temp.expect_error($q$select * from public.read_ai_cases(null)$q$,
    'forbidden: ai_investigation grant required');
  select pg_temp.expect_error($q$select * from public.read_ai_interactions(null)$q$,
    'forbidden: ai_investigation grant required');
  select pg_temp.expect_error(format(
    $q$select public.update_ai_case(%L, 'resolved', 'Trying again after the grant was revoked')$q$,
    (select id from ai_case)), 'forbidden: ai_investigation grant required');
commit;

\o
select 'F-107 OwanbeAI console tests passed' as result;
