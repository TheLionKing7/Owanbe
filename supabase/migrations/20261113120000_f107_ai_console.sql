-- F-107: the OwanbeAI console.
--
-- The F-107 migration left two reads that the application never called
-- (public.read_ai_cases and public.my_ai_interactions), and a case that could be opened but never
-- worked: public.cases.status could only ever be 'open', because nothing in the platform moved it.
-- A ticket the platform opens and nobody can see, work or close is a half-finished feature, so this
-- migration completes the loop:
--
--   * public.ai_case_notes          -- what the staff member who picks a case up wrote.
--   * public.read_ai_cases          -- the queue of cases, now with the notes on each case.
--   * public.read_ai_interactions   -- the queue of AI answers, including the ones a person reported.
--   * public.update_ai_case         -- the workflow: who moved the case, from what to what, and why.
--   * public.my_ai_interactions     -- what OwanbeAI has answered the caller, so it can be read again.
--
-- The rules are the same as everywhere else in this platform:
--   * the caller must hold the 'ai_investigation' staff capability; the database decides;
--   * every read is audited, and the read of the AI's answers is a SENSITIVE read, because an
--     answer may describe money and state;
--   * the AI itself has no authority here. It opened the case; a person works it. There is no
--     function on the AI path that moves a case, and none that moves money.

-- ---------------------------------------------------------------------------
-- 1. What the staff member who picks a case up wrote
-- ---------------------------------------------------------------------------
create table public.ai_case_notes (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.cases (id) on delete cascade,
  author_user_id uuid not null references public.users (id),
  body           text not null check (length(body) between 1 and 1000),
  created_at     timestamptz not null default now(),
  constraint ai_case_notes_body_no_credentials check (
    not app_private.looks_like_payment_credential(body)
  )
);
comment on table public.ai_case_notes is
  'F-107: the notes a staff member leaves on a case OwanbeAI opened. It holds no money fields.';

create index ai_case_notes_case_idx on public.ai_case_notes (case_id, created_at);

alter table public.ai_case_notes enable row level security;
alter table public.ai_case_notes force row level security;
revoke all on public.ai_case_notes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The queue of cases
-- ---------------------------------------------------------------------------
-- The F-107 migration created read_ai_cases with a fixed set of columns, so it is dropped and
-- created again with the notes and the moment the case was last touched. Nothing called it in
-- the meantime: the application had no console to call it from.
drop function public.read_ai_cases(text);

create function public.read_ai_cases(p_status text default null)
returns table (
  case_id           uuid,
  case_reference    text,
  subject           text,
  reason            text,
  status            text,
  priority          text,
  source            text,
  opened_by         uuid,
  ai_interaction_id uuid,
  booking_id        uuid,
  created_at        timestamptz,
  updated_at        timestamptz,
  notes             jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_grant uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  v_grant := app_private.staff_grant_for('ai_investigation');
  if v_grant is null then
    raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
  end if;

  perform app_private.audit(v_actor, 'ai.cases_viewed', 'staff_grants', v_grant, null,
                            jsonb_build_object('scope', 'ai_console'));

  return query
    select c.id, c.reference, c.subject, c.reason, c.status, c.priority, c.source, c.opened_by,
           c.ai_interaction_id, c.booking_id, c.created_at, c.updated_at,
           coalesce((select jsonb_agg(jsonb_build_object(
                          'id', n.id,
                          'author', n.author_user_id,
                          'body', n.body,
                          'at', n.created_at
                        ) order by n.created_at)
                       from public.ai_case_notes n where n.case_id = c.id), '[]'::jsonb)
      from public.cases c
     where (p_status is null or c.status = p_status)
     order by c.created_at desc, c.id desc
     limit 50;
end $$;
revoke all on function public.read_ai_cases(text) from public, anon;
grant execute on function public.read_ai_cases(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The queue of AI answers
-- ---------------------------------------------------------------------------
-- Every answer OwanbeAI gave, whoever asked for it, with the finding it made and whether a person
-- reported it. This is a SENSITIVE read: an answer may describe what was paid, what is held and
-- what was released, so it is audited the way a sensitive read is audited, with a purpose.
create function public.read_ai_interactions(p_surface text default null)
returns table (
  interaction_id   uuid,
  created_at       timestamptz,
  surface          text,
  request_summary  text,
  response_text    text,
  outcome          text,
  model            text,
  booking_id       uuid,
  case_id          uuid,
  case_reference   text,
  reported_at      timestamptz,
  report_category  text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_grant uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  v_grant := app_private.staff_grant_for('ai_investigation');
  if v_grant is null then
    raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
  end if;

  -- A list read has no single row to point at, so the target of the audit row is the grant that
  -- opened the read: from the trail you find the grant, and from the grant you find the reader.
  perform app_private.log_sensitive_read(v_actor, v_grant, 'ai_interactions', v_grant, null,
                                         'Reviewing the AI answers a person reported or that need a person');

  return query
    select i.id, i.created_at, i.surface, i.request_summary, i.response_text, i.outcome, i.model,
           i.booking_id, c.id, coalesce(c.reference, ''), i.reported_at, i.report_category
      from public.ai_interactions i
      left join public.cases c on c.ai_interaction_id = i.id
     where (p_surface is null or i.surface = p_surface)
     order by i.created_at desc, i.id desc
     limit 50;
end $$;
revoke all on function public.read_ai_interactions(text) from public, anon;
grant execute on function public.read_ai_interactions(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Working a case
-- ---------------------------------------------------------------------------
-- The moves a staff member may make. 'closed' is final: a closed case is closed until somebody
-- opens a new one. 'resolved' may be reopened, because a resolution can turn out to be wrong.
create function app_private.ai_case_may_move(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
           when 'open' then p_to in ('investigating', 'waiting_on_customer', 'resolved', 'closed')
           when 'investigating' then p_to in ('waiting_on_customer', 'resolved', 'closed')
           when 'waiting_on_customer' then p_to in ('investigating', 'resolved', 'closed')
           when 'resolved' then p_to in ('investigating', 'closed')
           when 'closed' then false
           else false
         end
$$;
revoke all on function app_private.ai_case_may_move(text, text) from public;

-- The AI cannot call this: it is granted to authenticated, and the grant is checked inside, so
-- only a person holding the 'ai_investigation' capability can move a case. The AI has no path to
-- it at all, and this function moves no money: it changes a case's status and writes a note.
create function public.update_ai_case(p_case uuid, p_status text, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_grant uuid;
  v_from text;
  v_body text;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  v_grant := app_private.staff_grant_for('ai_investigation');
  if v_grant is null then
    raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('investigating', 'waiting_on_customer', 'resolved', 'closed') then
    raise exception 'invalid_case_status' using errcode = '22023';
  end if;

  select c.status into v_from from public.cases c where c.id = p_case;
  if not found then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;

  if not app_private.ai_case_may_move(v_from, p_status) then
    raise exception 'invalid_case_transition' using errcode = '22023';
  end if;

  if p_note is not null then
    v_body := trim(p_note);
    if length(v_body) < 1 or length(v_body) > 1000 then
      raise exception 'invalid_case_note' using errcode = '22023';
    end if;
    if app_private.looks_like_payment_credential(v_body) then
      raise exception 'case_note_no_credentials' using errcode = '22023';
    end if;
    insert into public.ai_case_notes (case_id, author_user_id, body)
    values (p_case, v_actor, v_body);
  end if;

  -- The cases_touch trigger sets updated_at and bumps the version; this statement only moves the
  -- status, so the version the platform keeps is the trigger's.
  update public.cases
     set status = p_status
   where id = p_case;

  perform app_private.audit(v_actor, 'ai.case_updated', 'cases', p_case, null,
                            jsonb_build_object('from', v_from, 'to', p_status,
                                               'note' , case when p_note is null then null
                                                             else length(trim(p_note)) end));

  return p_case;
end $$;
revoke all on function public.update_ai_case(uuid, text, text) from public, anon;
grant execute on function public.update_ai_case(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What OwanbeAI has answered you
-- ---------------------------------------------------------------------------
-- The F-107 migration created this read and the application never called it: a person was shown
-- an answer, could report it while it was on screen, and then could never see it again or say it
-- was wrong later. The console calls it, so it is created again with the two columns that make the
-- list honest — which model answered, and what was asked — and with the same refusal for a
-- caller who is not signed in that every other read here gives.
drop function public.my_ai_interactions();

create function public.my_ai_interactions()
returns table (
  interaction_id  uuid,
  created_at      timestamptz,
  surface         text,
  request_summary text,
  response_text   text,
  reason          text,
  outcome         text,
  model           text,
  booking_id      uuid,
  case_id         uuid,
  case_reference  text,
  reported_at     timestamptz,
  report_category text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  return query
    select i.id, i.created_at, i.surface, i.request_summary, i.response_text, i.reason, i.outcome,
           i.model, i.booking_id, c.id, coalesce(c.reference, ''), i.reported_at, i.report_category
      from public.ai_interactions i
      left join public.cases c on c.ai_interaction_id = i.id
     where i.actor_user_id = v_actor
     order by i.created_at desc, i.id desc
     limit 20;
end $$;
revoke all on function public.my_ai_interactions() from public, anon;
grant execute on function public.my_ai_interactions() to authenticated;

notify pgrst, 'reload schema';
