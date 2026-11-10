-- F-101 OwanbePlanner AI
-- The assistant a host asks for a celebration plan. The blueprint expects it (blueprint/prd.md:143,
-- blueprint/tech-spec.md:44) and F-7's sign-up hand-off already points at it.
--
-- Invariants this file owns:
--   * the planner writes one row per generation, and a row is written for a failed attempt too:
--     an interaction that never happened leaves no trace, so the audit trail stays honest
--   * the caller must be an active member of a Host house; the planner is a host tool
--   * one generation per user every 30 seconds, so the AI cannot be run up a bill
--   * a reported answer is recorded once; a second report is refused rather than merged
--   * the log keeps what was shown, but the vendor names in it are resolved from the published
--     profiles by the database, so a caller cannot log a vendor that does not exist
--
-- The plan itself is built in the app (src/features/planner) and checked there against the
-- published vendor profiles; this file stores the result and the reports.

-- ---------------------------------------------------------------------------
-- One row per planner interaction
-- ---------------------------------------------------------------------------
create table public.ai_planner_interactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id),
  house_id         uuid not null,
  house_kind       text not null default 'host' check (house_kind = 'host'),
  model            text not null check (length(model) between 1 and 120),
  event_type       text not null check (length(event_type) between 1 and 60),
  city             text not null check (length(city) between 1 and 60),
  guest_count      integer not null check (guest_count between 1 and 5000),
  budget_minor     bigint not null check (budget_minor > 0),
  budget_currency  text not null check (budget_currency ~ '^[A-Z]{3}$'),
  brief            text not null check (length(brief) between 1 and 500),
  status           text not null check (status in ('ok', 'error')),
  option_count     integer not null default 0 check (option_count between 0 and 6),
  -- the plan as it was shown, minus anything the database resolves itself
  plan_summary     jsonb not null default '[]'::jsonb check (jsonb_typeof(plan_summary) = 'array'),
  reported_at      timestamptz,
  report_category  text check (report_category is null or report_category in
                     ('wrong_facts', 'not_relevant', 'missing_vendor', 'price_or_availability',
                      'harmful', 'other')),
  report_note      text check (report_note is null or length(report_note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade,
  -- one report per interaction
  constraint ai_planner_interactions_one_report check (
    (reported_at is null and report_category is null and report_note is null)
    or (reported_at is not null and report_category is not null)
  )
);
comment on table public.ai_planner_interactions is
  'F-101: one row per OwanbePlanner generation, with the host''s brief, the plan as shown, and any report.';
create index ai_planner_interactions_user_idx
  on public.ai_planner_interactions (user_id, created_at desc);
create trigger ai_planner_interactions_touch before update on public.ai_planner_interactions
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Row-level security: the host reads their own interactions, nobody writes directly
-- ---------------------------------------------------------------------------
alter table public.ai_planner_interactions enable row level security;
alter table public.ai_planner_interactions force row level security;

revoke all on public.ai_planner_interactions from public, anon, authenticated;
grant select on public.ai_planner_interactions to authenticated;

create policy ai_planner_interactions_owner_read on public.ai_planner_interactions
  for select to authenticated
  using (user_id = app_private.current_user_id());

-- ---------------------------------------------------------------------------
-- The caller's Host house
-- ---------------------------------------------------------------------------
create function app_private.planner_host_house(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id
    from public.houses h
    join public.memberships m on m.house_id = h.id and m.user_id = p_user and m.revoked_at is null
   where h.kind = 'host' and h.archived_at is null
   limit 1
$$;
revoke all on function app_private.planner_host_house(uuid) from public;

-- ---------------------------------------------------------------------------
-- One generation per 30 seconds
-- ---------------------------------------------------------------------------
-- The server asks before it spends anything on the model; the log function checks again, so two
-- requests that race cannot both be recorded.
create function public.ai_planner_cooldown_seconds()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when max(i.created_at) is null then 0
    else greatest(0, ceil(extract(epoch from (interval '30 seconds' - (now() - max(i.created_at)))))::integer)
  end
    from public.ai_planner_interactions i
   where i.user_id = app_private.current_user_id()
$$;
revoke all on function public.ai_planner_cooldown_seconds() from public, anon;
grant execute on function public.ai_planner_cooldown_seconds() to authenticated;

-- ---------------------------------------------------------------------------
-- Writing the interaction
-- ---------------------------------------------------------------------------
-- The vendor names in the plan are resolved here from the published profiles, so a caller cannot
-- record a business that is not on the platform. The prose (title, summary) is what the host saw.
create function public.log_ai_planner_interaction(
  p_event_type      text,
  p_city            text,
  p_guest_count     integer,
  p_budget_minor    bigint,
  p_budget_currency text,
  p_brief           text,
  p_model           text,
  p_status          text,
  p_option_count    integer default 0,
  p_plan_summary    jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app_private.current_user_id();
  v_house  uuid;
  v_id     uuid;
  v_plan   jsonb;
  v_count  integer;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  v_house := app_private.planner_host_house(v_actor);
  if v_house is null then
    raise exception 'forbidden: planner' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('ok', 'error') then
    raise exception 'invalid_planner_status' using errcode = '22023';
  end if;
  if p_event_type is null or length(btrim(p_event_type)) not between 1 and 60 then
    raise exception 'invalid_planner_input' using errcode = '22023';
  end if;
  if p_city is null or length(btrim(p_city)) not between 1 and 60 then
    raise exception 'invalid_planner_input' using errcode = '22023';
  end if;
  if p_guest_count is null or p_guest_count not between 1 and 5000 then
    raise exception 'invalid_planner_input' using errcode = '22023';
  end if;
  if p_budget_minor is null or p_budget_minor <= 0 then
    raise exception 'invalid_planner_input' using errcode = '22023';
  end if;
  if p_budget_currency is null or p_budget_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_planner_input' using errcode = '22023';
  end if;
  if p_brief is null or length(btrim(p_brief)) not between 1 and 500 then
    raise exception 'invalid_planner_input' using errcode = '22023';
  end if;
  if p_model is null or length(btrim(p_model)) not between 1 and 120 then
    raise exception 'invalid_planner_input' using errcode = '22023';
  end if;

  -- The backstop for two requests that race: the second one is refused.
  if exists (
    select 1 from public.ai_planner_interactions i
     where i.user_id = v_actor and i.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'rate_limited: planner' using errcode = '22023';
  end if;

  -- Keep at most six options, and only the fields the log needs.
  select coalesce(jsonb_agg(jsonb_build_object(
             'title', left(coalesce(o ->> 'title', ''), 120),
             'summary', left(coalesce(o ->> 'summary', ''), 400),
             'vendors', coalesce((
               select jsonb_agg(vp.business_name order by vp.business_name)
                 from jsonb_array_elements_text(coalesce(o -> 'vendor_slugs', '[]'::jsonb)) as s(slug)
                 join public.vendor_profiles vp on vp.slug = s.slug and vp.published
             ), '[]'::jsonb)
           )), '[]'::jsonb)
    into v_plan
    from (
      select o from jsonb_array_elements(coalesce(p_plan_summary, '[]'::jsonb)) with ordinality as e(o, n)
       where jsonb_typeof(o) = 'object'
       order by e.n
       limit 6
    ) kept;

  v_count := coalesce(jsonb_array_length(v_plan), 0);

  insert into public.ai_planner_interactions (
    user_id, house_id, model, event_type, city, guest_count, budget_minor, budget_currency,
    brief, status, option_count, plan_summary
  ) values (
    v_actor, v_house, btrim(p_model), btrim(p_event_type), btrim(p_city), p_guest_count,
    p_budget_minor, upper(p_budget_currency), btrim(p_brief), p_status, v_count, v_plan
  ) returning id into v_id;

  perform app_private.audit(v_actor, 'planner.interaction', 'ai_planner_interactions', v_id, v_house,
                            jsonb_build_object('status', p_status, 'option_count', v_count));
  return v_id;
end;
$$;
revoke all on function public.log_ai_planner_interaction(text, text, integer, bigint, text, text, text, text, integer, jsonb)
  from public, anon;
grant execute on function public.log_ai_planner_interaction(text, text, integer, bigint, text, text, text, text, integer, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Reporting an answer
-- ---------------------------------------------------------------------------
create function public.report_ai_planner_response(
  p_interaction uuid,
  p_category    text,
  p_note        text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_row   public.ai_planner_interactions;
  v_house uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_interaction is null then
    raise exception 'interaction_not_found' using errcode = 'P0002';
  end if;
  if p_category not in ('wrong_facts', 'not_relevant', 'missing_vendor', 'price_or_availability',
                        'harmful', 'other') then
    raise exception 'invalid_report_category' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'invalid_report_note' using errcode = '22023';
  end if;

  select * into v_row from public.ai_planner_interactions where id = p_interaction;
  if not found or v_row.user_id <> v_actor then
    raise exception 'interaction_not_found' using errcode = 'P0002';
  end if;
  if v_row.reported_at is not null then
    raise exception 'already_reported' using errcode = '22023';
  end if;

  update public.ai_planner_interactions
     set reported_at = now(),
         report_category = p_category,
         report_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_interaction;

  v_house := v_row.house_id;
  perform app_private.audit(v_actor, 'planner.response_reported', 'ai_planner_interactions',
                            p_interaction, v_house,
                            jsonb_build_object('category', p_category));
end;
$$;
revoke all on function public.report_ai_planner_response(uuid, text, text) from public, anon;
grant execute on function public.report_ai_planner_response(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The caller's own history
-- ---------------------------------------------------------------------------
create function public.my_ai_planner_interactions()
returns table (
  interaction_id  uuid,
  created_at      timestamptz,
  event_type      text,
  city            text,
  guest_count     integer,
  budget_minor    bigint,
  budget_currency text,
  status          text,
  option_count    integer,
  reported_at     timestamptz,
  report_category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.created_at, i.event_type, i.city, i.guest_count, i.budget_minor,
         i.budget_currency, i.status, i.option_count, i.reported_at, i.report_category
    from public.ai_planner_interactions i
   where i.user_id = app_private.current_user_id()
   order by i.created_at desc, i.id desc
   limit 20
$$;
revoke all on function public.my_ai_planner_interactions() from public, anon;
grant execute on function public.my_ai_planner_interactions() to authenticated;

notify pgrst, 'reload schema';
