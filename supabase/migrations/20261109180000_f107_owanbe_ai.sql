-- F-107 OwanbeAI
-- The platform's AI substrate. F-101 (the planner) and the vendor copy assistant were built as
-- one AI feature each; the blueprint names a third thing, OwanbeAI, and says it must exist before
-- the features that name it can be built. This file is that thing: one place where an AI response
-- is labelled, logged and reported, and one read-only window onto the payment log.
--
-- The blueprint's three "must" lines are what this file exists to satisfy
-- (blueprint/prd.md §9 and §12):
--   * AI investigation role: payment-log access is read-only and minimised; approvals and
--     transfers are denied.
--   * AI disclosure: every OwanbeAI response carries a persistent AI label and a reporting action.
--   * AI ZDR: sensitive processing requires a contracted zero-retention provider, and access
--     grants are revocable and audited.
--
-- Owner decisions (2026-11-09, this build):
--   * OwanbeAI is invoked by staff, from the booking's payments panel. The host never sees it.
--   * The zero-retention gate is built CLOSED. There is no application path that can open it: the
--     owner confirms the contract in the database. Until then sensitive processing is refused and
--     the panel says so plainly. F-65 (Zero Data Retention) stays open until the contract exists.
--   * The payment-log grant is a new platform-staff capability, 'ai_investigation', beside the
--     six that already exist. It grants reading and nothing else.
--   * Tickets land in a general 'cases' table that F-16 (Dispute Filing & Arbitration) will extend.
--
-- Invariants this file owns:
--   * the AI can read the payment log and write a case. It cannot allocate, refund, settle,
--     freeze, lift a freeze, complete a booking or release a tranche: none of those functions
--     are granted to 'authenticated', and the 'ai_investigation' grant carries no fund authority.
--   * the payment log is minimised: money and state, never a name, an email address or a provider
--     reference. Every read is a sensitive read and is written to the audit trail with a purpose.
--   * sensitive processing is refused while the zero-retention contract is unconfirmed, so no
--     payment data can reach a model that has not contracted to keep nothing.
--   * a case is a case: it carries a plain-language reason and no money fields at all, so a case
--     cannot become a payment instruction.
--   * every AI response is logged with what was shown, and a response can be reported once.
--
-- Depends on 20261109140000_f102_fund_pool.sql (bookings, fund_pool, wallet_ledger,
-- payment_events) and 20261109160000_f106_market_benchmarks.sql (the 'analytics' staff capability
-- this file's capability list continues). Acceptance criteria:
-- docs/journal/2026-11-09-F-107-owanbe-ai.md

-- ---------------------------------------------------------------------------
-- The AI investigation capability
-- ---------------------------------------------------------------------------
-- 'ai_investigation' is new in F-107: it is what lets platform staff read the payment log for an
-- AI investigation. The seven capabilities that already existed keep their meaning, and their
-- scope rules are untouched. The grant is revocable and expiring like every other staff grant.
alter table public.staff_grants
  drop constraint staff_grants_capability_check;
alter table public.staff_grants
  add constraint staff_grants_capability_check check (capability in
    ('support', 'finance', 'operations', 'arbitrator', 'event_manager',
     'verification_reviewer', 'analytics', 'ai_investigation'));
comment on column public.staff_grants.capability is
  'F-107: platform-staff capabilities. ''ai_investigation'' reads the payment log for an AI investigation; it carries no fund authority.';

-- ---------------------------------------------------------------------------
-- The zero-retention gate
-- ---------------------------------------------------------------------------
-- One row. The gate is closed until the owner records the contracted provider and the contract
-- reference here. Nothing in the application can open it: the table is revoked from every
-- application role, so the only way to set it is the owner running the statement themselves.
--
-- The shape constraint is what makes the gate honest: a confirmed gate cannot exist without a
-- provider, a contract reference and the moment it was confirmed, and an unconfirmed gate cannot
-- carry the shadow of a contract.
create table app_private.ai_settings (
  id               boolean primary key default true check (id),
  zdr_confirmed    boolean not null default false,
  zdr_provider     text check (zdr_provider is null or length(zdr_provider) between 1 and 120),
  zdr_contract_ref text check (zdr_contract_ref is null or length(zdr_contract_ref) between 1 and 120),
  zdr_confirmed_at timestamptz,
  zdr_confirmed_by uuid references public.users (id),
  updated_at       timestamptz not null default now(),
  constraint ai_settings_zdr_shape check (
    (zdr_confirmed
     and zdr_provider is not null
     and zdr_contract_ref is not null
     and zdr_confirmed_at is not null)
    or
    (not zdr_confirmed
     and zdr_provider is null
     and zdr_contract_ref is null
     and zdr_confirmed_at is null)
  )
);
comment on table app_private.ai_settings is
  'F-107: the platform''s AI settings. One row. The zero-retention gate is closed until the owner records a contracted provider here.';
insert into app_private.ai_settings (id) values (true);
revoke all on app_private.ai_settings from public, anon, authenticated, service_role;

-- Whether sensitive AI processing is allowed right now. Closed until the owner confirms the
-- contract. The application can read this; it cannot write it.
create function app_private.ai_zdr_confirmed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.zdr_confirmed from app_private.ai_settings s where s.id), false)
$$;
revoke all on function app_private.ai_zdr_confirmed() from public;

-- ---------------------------------------------------------------------------
-- Cases
-- ---------------------------------------------------------------------------
-- A general case, not an AI case: F-16 attaches the dispute model to it later. What F-107 needs
-- is a ticket the AI can open by itself, so a finding is never lost in a chat window.
--
-- There are no money fields here on purpose. No amount, no provider reference, no account: a
-- case cannot carry an instruction to move money, because there is nowhere in it to put one.
create table public.cases (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique
                    default 'CASE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
                    check (reference ~ '^CASE-[0-9A-F]{12}$'),
  subject           text not null check (length(subject) between 3 and 200),
  -- the plain-language reason, in the words of whoever raised it
  reason            text not null check (length(reason) between 10 and 1000),
  status            text not null default 'open'
                    check (status in ('open', 'investigating', 'waiting_on_customer', 'resolved', 'closed')),
  priority          text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),
  source            text not null check (source in ('ai_investigation', 'staff', 'host', 'vendor')),
  opened_by         uuid references public.users (id),
  ai_interaction_id uuid,
  booking_id        uuid references public.bookings (id) on delete set null,
  house_id          uuid references public.houses (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  constraint cases_subject_no_credentials check (
    not app_private.looks_like_payment_credential(subject)
  ),
  constraint cases_reason_no_credentials check (
    not app_private.looks_like_payment_credential(reason)
  )
);
comment on table public.cases is
  'F-107: a case anyone can raise, including OwanbeAI. F-16 attaches the dispute model. It holds no money fields.';
create index cases_status_idx on public.cases (status, created_at desc);
create index cases_booking_idx on public.cases (booking_id, created_at desc);
create trigger cases_touch before update on public.cases
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- The OwanbeAI log
-- ---------------------------------------------------------------------------
-- One row per AI interaction, whatever surface produced it. The log keeps what was shown, so a
-- host or a staff member can report an answer that was wrong and the platform can see it.
create table public.ai_interactions (
  id               uuid primary key default gen_random_uuid(),
  surface          text not null
                   check (surface in ('payment_investigation', 'vendor_profile_copy')),
  actor_user_id    uuid not null references public.users (id),
  request_summary  text not null check (length(request_summary) between 1 and 500),
  response_text    text not null check (length(response_text) between 1 and 4000),
  -- the human-readable reason for the suggestion, stored with it
  reason           text check (reason is null or length(reason) between 10 and 1000),
  model            text not null check (length(model) between 1 and 120),
  outcome          text not null
                   check (outcome in ('answered', 'opened_case', 'no_issue', 'needs_human')),
  booking_id       uuid references public.bookings (id) on delete set null,
  reported_at      timestamptz,
  report_category  text check (report_category is null or report_category in
                     ('wrong_facts', 'not_relevant', 'missing_vendor', 'price_or_availability',
                      'harmful', 'other')),
  report_note      text check (report_note is null or length(report_note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  -- one report per interaction
  constraint ai_interactions_one_report check (
    (reported_at is null and report_category is null and report_note is null)
    or (reported_at is not null and report_category is not null)
  ),
  constraint ai_interactions_request_no_credentials check (
    not app_private.looks_like_payment_credential(request_summary)
  ),
  constraint ai_interactions_response_no_credentials check (
    not app_private.looks_like_payment_credential(response_text)
  ),
  constraint ai_interactions_reason_no_credentials check (
    reason is null or not app_private.looks_like_payment_credential(reason)
  )
);
comment on table public.ai_interactions is
  'F-107: one row per OwanbeAI interaction, with the answer as it was shown and any report.';
create index ai_interactions_actor_idx on public.ai_interactions (actor_user_id, created_at desc);
create index ai_interactions_surface_idx on public.ai_interactions (surface, created_at desc);
create trigger ai_interactions_touch before update on public.ai_interactions
  for each row execute function app_private.touch();

-- The case points at the interaction that raised it. Added here because both tables had to exist
-- before either could carry the other.
alter table public.cases
  add constraint cases_ai_interaction_fkey foreign key (ai_interaction_id)
  references public.ai_interactions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Row-level security: nobody selects the tables
-- ---------------------------------------------------------------------------
-- Every read goes through a function that checks the caller first, and no application role holds
-- a grant on the tables themselves.
alter table public.cases enable row level security;
alter table public.cases force row level security;
alter table public.ai_interactions enable row level security;
alter table public.ai_interactions force row level security;

revoke all on public.cases from public, anon, authenticated;
revoke all on public.ai_interactions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the caller may do here
-- ---------------------------------------------------------------------------
-- One read for the panel: is the zero-retention contract in place, does this caller hold the
-- grant, and may they investigate at all.
create function public.ai_investigation_status()
returns table (
  zdr_confirmed  boolean,
  has_grant      boolean,
  can_investigate boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.ai_zdr_confirmed(),
         (app_private.staff_grant_for('ai_investigation') is not null),
         (app_private.ai_zdr_confirmed()
          and app_private.staff_grant_for('ai_investigation') is not null)
$$;
revoke all on function public.ai_investigation_status() from public, anon;
grant execute on function public.ai_investigation_status() to authenticated;

-- ---------------------------------------------------------------------------
-- A failed payment keeps its booking
-- ---------------------------------------------------------------------------
-- F-102 writes the provider event and then writes its outcome back onto the row. For a failed
-- charge there is no outcome to write, and the write-back cleared the booking the event was sent
-- for, so a failed payment could not be traced back to the booking it belongs to. F-107 needs
-- that trail, so the booking is put back.
--
-- The repair is narrow: it only applies to a row whose outcome has never been decided, which is
-- exactly the write-back path. It does not touch the booking being deleted, because by then the
-- outcome is already set.
create function app_private.keep_payment_event_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_id is null and old.booking_id is not null and old.outcome is null then
    new.booking_id := old.booking_id;
  end if;
  return new;
end $$;
revoke all on function app_private.keep_payment_event_booking() from public;
create trigger payment_events_keep_booking before update on public.payment_events
  for each row execute function app_private.keep_payment_event_booking();

-- ---------------------------------------------------------------------------
-- The payment log, minimised
-- ---------------------------------------------------------------------------
-- Money and state only: what was paid, what is held, what has been released, what has failed.
-- No party name, no email address, no provider reference and no payload: the AI is here to trace
-- a payment, not to read a person.
--
-- The read is refused in two ways. Without the 'ai_investigation' grant it is forbidden. While the
-- zero-retention contract is unconfirmed it is refused as well, because that is the moment the
-- data would leave for a model.
create function public.ai_payment_log(p_booking uuid, p_purpose text)
returns table (
  booking_id         uuid,
  booking_status     text,
  pool_status        text,
  currency           text,
  total_minor        bigint,
  paid_minor         bigint,
  held_minor         bigint,
  released_minor     bigint,
  refunded_minor     bigint,
  frozen             boolean,
  release_30_due_at  timestamptz,
  paid_at            timestamptz,
  completed_at       timestamptz,
  refunded_at        timestamptz,
  movement_count     integer,
  event_count        integer,
  failed_event_count integer,
  hours_since_paid   integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := app_private.current_user_id();
  v_grant   uuid;
  v_booking public.bookings;
  v_pool    public.fund_pool;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not app_private.ai_zdr_confirmed() then
    raise exception 'zdr_contract_required' using errcode = '22023';
  end if;
  v_grant := app_private.staff_grant_for('ai_investigation');
  if v_grant is null then
    raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
  end if;
  if p_purpose is null or length(trim(p_purpose)) < 10 then
    raise exception 'purpose_required' using errcode = '22023';
  end if;

  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  select * into v_pool from public.fund_pool where booking_id = p_booking;

  perform app_private.log_sensitive_read(v_actor, v_grant, 'fund_pool', p_booking,
                                         v_booking.host_house_id, p_purpose);

  return query
    select v_booking.id,
           v_booking.status,
           coalesce(v_pool.status, ''),
           v_booking.currency,
           v_booking.total_minor,
           coalesce(v_pool.paid_minor, 0),
           coalesce(v_pool.held_minor, 0),
           coalesce(v_pool.released_70_minor, 0) + coalesce(v_pool.released_30_minor, 0),
           coalesce(v_pool.refunded_minor, 0),
           coalesce(v_pool.frozen, false),
           v_pool.release_30_due_at,
           v_pool.paid_at,
           v_pool.completed_at,
           v_pool.refunded_at,
           (select count(*)::integer from public.wallet_ledger w where w.booking_id = p_booking),
           (select count(*)::integer from public.payment_events e where e.booking_id = p_booking),
           (select count(*)::integer from public.payment_events e
             where e.booking_id = p_booking and e.event_type = 'charge.failed'),
           (case when v_pool.paid_at is null then null
                 else floor(extract(epoch from (now() - v_pool.paid_at)) / 3600)::integer end);
end $$;
revoke all on function public.ai_payment_log(uuid, text) from public, anon;
grant execute on function public.ai_payment_log(uuid, text) to authenticated;

-- The provider's own events for the booking: what came in, what failed, what was decided. The
-- payload is not returned and neither is the reference, so a partner token cannot be read back
-- out of the log.
create function public.ai_payment_event_log(p_booking uuid, p_purpose text)
returns table (
  event_id     uuid,
  event_type   text,
  outcome      text,
  amount_minor bigint,
  currency     text,
  occurred_at  timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := app_private.current_user_id();
  v_grant   uuid;
  v_booking public.bookings;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not app_private.ai_zdr_confirmed() then
    raise exception 'zdr_contract_required' using errcode = '22023';
  end if;
  v_grant := app_private.staff_grant_for('ai_investigation');
  if v_grant is null then
    raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
  end if;
  if p_purpose is null or length(trim(p_purpose)) < 10 then
    raise exception 'purpose_required' using errcode = '22023';
  end if;

  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  perform app_private.log_sensitive_read(v_actor, v_grant, 'payment_events', p_booking,
                                         v_booking.host_house_id, p_purpose);

  return query
    select e.id, e.event_type, coalesce(e.outcome, ''), e.amount_minor,
           coalesce(e.currency, ''), e.created_at
      from public.payment_events e
     where e.booking_id = p_booking
     order by e.created_at desc, e.id desc
     limit 100;
end $$;
revoke all on function public.ai_payment_event_log(uuid, text) from public, anon;
grant execute on function public.ai_payment_event_log(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Logging the interaction
-- ---------------------------------------------------------------------------
-- The surface decides who may log it. A payment investigation needs the 'ai_investigation' grant
-- and the zero-retention contract. The vendor copy assistant needs a vendor house; it never sees
-- a payment.
create function public.log_ai_interaction(
  p_surface         text,
  p_request_summary text,
  p_response_text   text,
  p_reason          text,
  p_model           text,
  p_outcome         text,
  p_booking         uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_vendor uuid;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_surface is null or p_surface not in ('payment_investigation', 'vendor_profile_copy') then
    raise exception 'invalid_ai_surface' using errcode = '22023';
  end if;
  if p_request_summary is null or length(btrim(p_request_summary)) not between 1 and 500 then
    raise exception 'invalid_ai_input' using errcode = '22023';
  end if;
  if p_response_text is null or length(btrim(p_response_text)) not between 1 and 4000 then
    raise exception 'invalid_ai_input' using errcode = '22023';
  end if;
  if p_reason is not null and length(btrim(p_reason)) not between 10 and 1000 then
    raise exception 'invalid_ai_input' using errcode = '22023';
  end if;
  if p_model is null or length(btrim(p_model)) not between 1 and 120 then
    raise exception 'invalid_ai_input' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('answered', 'opened_case', 'no_issue', 'needs_human') then
    raise exception 'invalid_ai_input' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_request_summary)
     or app_private.looks_like_payment_credential(p_response_text)
     or (p_reason is not null and app_private.looks_like_payment_credential(p_reason)) then
    raise exception 'ai_input_rejected' using errcode = '22023';
  end if;

  if p_surface = 'payment_investigation' then
    if not app_private.ai_zdr_confirmed() then
      raise exception 'zdr_contract_required' using errcode = '22023';
    end if;
    if app_private.staff_grant_for('ai_investigation') is null then
      raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
    end if;
  else
    select h.id into v_vendor
      from public.houses h
      join public.memberships m on m.house_id = h.id and m.user_id = v_actor and m.revoked_at is null
     where h.kind = 'vendor' and h.archived_at is null
     limit 1;
    if v_vendor is null then
      raise exception 'forbidden: vendor house required' using errcode = '42501';
    end if;
  end if;

  insert into public.ai_interactions (
    surface, actor_user_id, request_summary, response_text, reason, model, outcome, booking_id
  ) values (
    p_surface, v_actor, btrim(p_request_summary), btrim(p_response_text),
    nullif(left(btrim(coalesce(p_reason, '')), 1000), ''),
    btrim(p_model), p_outcome, p_booking
  ) returning id into v_id;

  perform app_private.audit(v_actor, 'ai.interaction', 'ai_interactions', v_id, null,
                            jsonb_build_object('surface', p_surface,
                                               'outcome', p_outcome,
                                               'booking_id', p_booking));
  return v_id;
end $$;
revoke all on function public.log_ai_interaction(text, text, text, text, text, text, uuid)
  from public, anon;
grant execute on function public.log_ai_interaction(text, text, text, text, text, text, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The case the AI opens
-- ---------------------------------------------------------------------------
-- The AI opens its own ticket when it finds something a person should look at. The reason is the
-- AI's own words, in plain language, so the staff member who picks the case up can see why it
-- exists without reading the investigation again.
--
-- This function can only insert a case. It holds no grant on any money function, so there is no
-- path from here to the ledger.
create function public.open_ai_case(
  p_interaction uuid,
  p_subject     text,
  p_reason      text,
  p_priority    text default 'normal'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := app_private.current_user_id();
  v_interaction public.ai_interactions;
  v_case        uuid;
  v_house       uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if app_private.staff_grant_for('ai_investigation') is null then
    raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
  end if;
  if p_interaction is null then
    raise exception 'interaction_not_found' using errcode = 'P0002';
  end if;
  if p_subject is null or length(btrim(p_subject)) not between 3 and 200 then
    raise exception 'invalid_case_subject' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then
    raise exception 'invalid_case_reason' using errcode = '22023';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_case_priority' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_subject)
     or app_private.looks_like_payment_credential(p_reason) then
    raise exception 'case_rejected' using errcode = '22023';
  end if;

  select * into v_interaction from public.ai_interactions where id = p_interaction;
  if not found or v_interaction.actor_user_id <> v_actor then
    raise exception 'interaction_not_found' using errcode = 'P0002';
  end if;
  if v_interaction.surface <> 'payment_investigation' then
    raise exception 'invalid_case_source' using errcode = '22023';
  end if;
  if v_interaction.reported_at is not null then
    raise exception 'already_reported' using errcode = '22023';
  end if;

  select b.host_house_id into v_house
    from public.bookings b
   where b.id = v_interaction.booking_id;

  insert into public.cases (
    subject, reason, priority, source, opened_by, ai_interaction_id, booking_id, house_id
  ) values (
    btrim(p_subject), btrim(p_reason), p_priority, 'ai_investigation', v_actor,
    p_interaction, v_interaction.booking_id, v_house
  ) returning id into v_case;

  update public.ai_interactions
     set outcome = 'opened_case'
   where id = p_interaction;

  perform app_private.audit(v_actor, 'ai.case_opened', 'cases', v_case, v_house,
                            jsonb_build_object('ai_interaction_id', p_interaction,
                                               'booking_id', v_interaction.booking_id,
                                               'priority', p_priority,
                                               'source', 'ai_investigation'));
  return v_case;
end $$;
revoke all on function public.open_ai_case(uuid, text, text, text) from public, anon;
grant execute on function public.open_ai_case(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reporting an answer
-- ---------------------------------------------------------------------------
-- The person who was shown the answer reports it. One report per interaction; a second report is
-- refused rather than merged.
create function public.report_ai_interaction(
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
  v_row   public.ai_interactions;
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

  select * into v_row from public.ai_interactions where id = p_interaction;
  if not found or v_row.actor_user_id <> v_actor then
    raise exception 'interaction_not_found' using errcode = 'P0002';
  end if;
  if v_row.reported_at is not null then
    raise exception 'already_reported' using errcode = '22023';
  end if;

  update public.ai_interactions
     set reported_at = now(),
         report_category = p_category,
         report_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_interaction;

  perform app_private.audit(v_actor, 'ai.interaction_reported', 'ai_interactions', p_interaction,
                            null, jsonb_build_object('category', p_category));
end $$;
revoke all on function public.report_ai_interaction(uuid, text, text) from public, anon;
grant execute on function public.report_ai_interaction(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading the log and the cases
-- ---------------------------------------------------------------------------
-- The caller's own interactions, and the case one of them opened.
create function public.my_ai_interactions()
returns table (
  interaction_id uuid,
  created_at     timestamptz,
  surface        text,
  response_text  text,
  reason         text,
  outcome        text,
  booking_id     uuid,
  case_id        uuid,
  case_reference text,
  reported_at    timestamptz,
  report_category text
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.created_at, i.surface, i.response_text, i.reason, i.outcome, i.booking_id,
         c.id, coalesce(c.reference, ''), i.reported_at, i.report_category
    from public.ai_interactions i
    left join public.cases c on c.ai_interaction_id = i.id
   where i.actor_user_id = app_private.current_user_id()
   order by i.created_at desc, i.id desc
   limit 20
$$;
revoke all on function public.my_ai_interactions() from public, anon;
grant execute on function public.my_ai_interactions() to authenticated;

-- The cases an investigator may see. The AI's reason is on the case, so the staff member who
-- picks it up sees why it was opened.
create function public.read_ai_cases(p_status text default null)
returns table (
  case_id        uuid,
  case_reference text,
  subject        text,
  reason         text,
  status         text,
  priority       text,
  source         text,
  opened_by      uuid,
  ai_interaction_id uuid,
  booking_id     uuid,
  created_at     timestamptz
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
  if app_private.staff_grant_for('ai_investigation') is null then
    raise exception 'forbidden: ai_investigation grant required' using errcode = '42501';
  end if;

  return query
    select c.id, c.reference, c.subject, c.reason, c.status, c.priority, c.source, c.opened_by,
           c.ai_interaction_id, c.booking_id, c.created_at
      from public.cases c
     where (p_status is null or c.status = p_status)
     order by c.created_at desc, c.id desc
     limit 50;
end $$;
revoke all on function public.read_ai_cases(text) from public, anon;
grant execute on function public.read_ai_cases(text) to authenticated;

notify pgrst, 'reload schema';
