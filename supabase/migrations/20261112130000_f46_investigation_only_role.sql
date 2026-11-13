-- F-46 AI Investigation-only Role
--
-- The F-46 spec: "The AI agent can investigate payment issues and report findings but cannot move
-- money or approve anything itself; a human always approves advances and large fund actions." Its
-- technical note asks for a hard permission boundary: "AI service account has read-only access to
-- payment logs."
--
-- F-107 built the behaviour — the 'ai_investigation' grant, the minimised payment log, the
-- sensitive-read audit — but the identity behind it was still the platform's own. The audit said
-- exactly that: "AI investigation gated by grant (server.ts), but distinct role not confirmed".
-- This file gives the AI an identity of its own and makes that identity powerless.
--
-- How Postgres allows this:
--   * A SECURITY DEFINER function cannot switch role. Postgres refuses 'set role' inside one
--     ("cannot set parameter "role" within security-definer function"), so a read cannot be
--     re-pointed at a lesser identity from within a function.
--   * Therefore the identity has to OWN the function that reads. A role that owns an object needs
--     CREATE on the schema that holds it, so the read lives in app_private — which PostgREST does
--     not expose — and never in public.
--   * public.ai_payment_log and public.ai_payment_event_log are then thin passthroughs: the RPCs
--     the application already calls. They carry no table access of their own.
--
-- Invariants this file owns:
--   * investigation_only cannot sign in and is a member of no role. The only membership it may
--     have is the platform's own administrator: from Postgres 16 on, Postgres records the role
--     that created a role as an admin member of it, with the SET option off, so that member may
--     administer the role but may not act as it. Nobody may become the identity; the only way
--     to act as it is through the two functions it owns, and both check the caller first.
--   * it can read the two minimised views and call four helpers. Nothing else.
--   * it holds no grant on any payment table, no grant on a case or an interaction, and no
--     execute on any money function, so it cannot allocate, refund, settle, freeze, unfreeze,
--     complete or release — not even if the function it owns were rewritten to try.
--   * the read it performs is the read F-107 wrote, audited the same way and with the same
--     refusals, so nothing an investigator sees today changes.
--
-- Depends on 20261109180000_f107_owanbe_ai.sql (the grant, the gate, the audit helper) and
-- 20261109140000_f102_fund_pool.sql (the payment tables).

-- ---------------------------------------------------------------------------
-- The identity
-- ---------------------------------------------------------------------------
-- It cannot sign in, it is not a superuser, it creates nothing, and it inherits nothing. The
-- migration runner creates it, and from Postgres 16 on Postgres makes that runner an admin
-- member of the role it created — with the SET option off, so the runner may administer the
-- role but may not act as it. The runner takes the membership for the length of each handover
-- below and gives it straight back.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'investigation_only') then
    create role investigation_only nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
alter role investigation_only noinherit;

comment on role investigation_only is
  'F-46: the identity OwanbeAI reads the payment log as. It can read the two minimised payment '
  'views and call four helpers. It holds no grant on any payment table, none on a case or an '
  'interaction, and no execute on any money function, so it cannot allocate, refund, settle, '
  'freeze, unfreeze, complete or release. It cannot sign in and nobody can become it.';

-- ---------------------------------------------------------------------------
-- The minimised views
-- ---------------------------------------------------------------------------
-- Money and state only: what was paid, what is held, what was released, what failed. No party
-- name, no house identifier, no email address, no provider reference and no payload. This is the
-- whole of what the AI's identity may read.
--
-- The views are owned by the platform's owner and read the payment tables with the platform's own
-- rights, the same rights every other read path uses. The role cannot read the tables; it can
-- only read these two projections of them.
create view app_private.investigation_payment_view as
select b.id                as booking_id,
       b.status            as booking_status,
       coalesce(p.status, '') as pool_status,
       b.currency          as currency,
       b.total_minor       as total_minor,
       coalesce(p.paid_minor, 0) as paid_minor,
       coalesce(p.held_minor, 0) as held_minor,
       coalesce(p.released_70_minor, 0) + coalesce(p.released_30_minor, 0) as released_minor,
       coalesce(p.refunded_minor, 0) as refunded_minor,
       coalesce(p.frozen, false) as frozen,
       p.release_30_due_at,
       p.paid_at,
       p.completed_at,
       p.refunded_at,
       (select count(*)::integer from public.wallet_ledger w where w.booking_id = b.id) as movement_count,
       (select count(*)::integer from public.payment_events e where e.booking_id = b.id) as event_count,
       (select count(*)::integer from public.payment_events e
         where e.booking_id = b.id and e.event_type = 'charge.failed') as failed_event_count,
       (case when p.paid_at is null then null
             else floor(extract(epoch from (now() - p.paid_at)) / 3600)::integer end) as hours_since_paid
  from public.bookings b
  left join public.fund_pool p on p.booking_id = b.id;
comment on view app_private.investigation_payment_view is
  'F-46: the only payment data the AI''s identity may read. Money and state, never a person.';

create view app_private.investigation_events_view as
select e.id              as event_id,
       e.booking_id      as booking_id,
       e.event_type      as event_type,
       coalesce(e.outcome, '') as outcome,
       e.amount_minor    as amount_minor,
       coalesce(e.currency, '') as currency,
       e.created_at      as occurred_at
  from public.payment_events e;
comment on view app_private.investigation_events_view is
  'F-46: the provider events the AI''s identity may read. No reference, no payload.';

revoke all on app_private.investigation_payment_view from public, anon, authenticated;
revoke all on app_private.investigation_events_view from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The audit the read leaves
-- ---------------------------------------------------------------------------
-- The read is a sensitive read and it is written to the append-only trail with a purpose, exactly
-- as F-107 wrote it. The house is resolved here, by the platform's owner, so the AI's identity
-- never sees a house identifier.
create function app_private.log_investigation_read(
  p_actor   uuid,
  p_grant   uuid,
  p_table   text,
  p_booking uuid,
  p_purpose text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
begin
  if p_table not in ('fund_pool', 'payment_events') then
    raise exception 'invalid_investigation_read' using errcode = '22023';
  end if;
  if p_purpose is null or length(trim(p_purpose)) < 10 then
    raise exception 'purpose_required' using errcode = '22023';
  end if;
  select b.host_house_id into v_house from public.bookings b where b.id = p_booking;
  perform app_private.log_sensitive_read(p_actor, p_grant, p_table, p_booking, v_house, p_purpose);
end $$;
revoke all on function app_private.log_investigation_read(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function app_private.log_investigation_read(uuid, uuid, text, uuid, text)
  to investigation_only;

-- ---------------------------------------------------------------------------
-- The read, owned by the AI's identity
-- ---------------------------------------------------------------------------
-- The checks are the same ones F-107 wrote: a signed-in caller, the zero-retention contract, the
-- 'ai_investigation' grant and a stated purpose. Only the identity behind the read changes.
create function app_private.investigation_read(p_booking uuid, p_purpose text)
returns table (
  booking_id           uuid,
  booking_status       text,
  pool_status          text,
  currency             text,
  total_minor          bigint,
  paid_minor           bigint,
  held_minor           bigint,
  released_minor       bigint,
  refunded_minor       bigint,
  frozen               boolean,
  release_30_due_at    timestamptz,
  paid_at              timestamptz,
  completed_at         timestamptz,
  refunded_at          timestamptz,
  movement_count       integer,
  event_count          integer,
  failed_event_count   integer,
  hours_since_paid     integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_grant uuid;
  v_found boolean;
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

  select exists (select 1 from app_private.investigation_payment_view v
                  where v.booking_id = p_booking) into v_found;
  if not v_found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  perform app_private.log_investigation_read(v_actor, v_grant, 'fund_pool', p_booking, p_purpose);

  return query
    select v.booking_id,
           v.booking_status,
           v.pool_status,
           v.currency,
           v.total_minor,
           v.paid_minor,
           v.held_minor,
           v.released_minor,
           v.refunded_minor,
           v.frozen,
           v.release_30_due_at,
           v.paid_at,
           v.completed_at,
           v.refunded_at,
           v.movement_count,
           v.event_count,
           v.failed_event_count,
           v.hours_since_paid
      from app_private.investigation_payment_view v
     where v.booking_id = p_booking;
end $$;

-- The read belongs to the AI's identity. Owning it is what makes the boundary hard: the body
-- runs with the role's grants and nothing else, so a line that touched a payment table would be
-- refused by Postgres rather than merely discouraged.
--
-- The order matters. The runner owns the function at this point, so the revoke of the default
-- grant and the grant to the runner both happen while it can still change the privileges. The
-- runner keeps an explicit EXECUTE so that the public passthrough below can still reach the
-- AI-owned read; the grant is made before the ownership moves, because afterwards the runner is
-- no longer the owner and could not grant it.
revoke all on function app_private.investigation_read(uuid, text) from public, anon, authenticated;
do $$ begin
  execute format(
    'grant execute on function app_private.investigation_read(uuid, text) to %I', current_user);
end $$;
grant create on schema app_private to investigation_only;

-- Handing the function over needs the runner to be able to SET ROLE the new owner. A
-- non-superuser runner that created the role cannot: from Postgres 16 on, such a creator is
-- recorded as an admin member of the role with the SET option off, so it may administer the
-- role but may not act as it. The runner takes the membership for the length of the handover
-- and gives it straight back, so nobody is left able to act as the identity.
--
-- The membership grant is one statement on every supported version: from Postgres 16 on a new
-- membership carries the SET option by default, and before that membership alone was enough to
-- SET ROLE. The revoke names the runner as the grantor, because from Postgres 16 on the
-- administrative membership Postgres created itself was granted by the bootstrap superuser and
-- must be left alone.
do $$
declare
  v_runner text := current_user;
  v_state  text;
  v_error  text;
begin
  execute format('grant investigation_only to %I', v_runner);
  begin
    execute 'alter function app_private.investigation_read(uuid, text) owner to investigation_only';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_error = message_text;
  end;
  if current_setting('server_version_num')::int >= 160000 then
    execute format('revoke investigation_only from %I granted by %I', v_runner, v_runner);
  else
    execute format('revoke investigation_only from %I', v_runner);
  end if;
  if v_error is not null then
    raise exception '%', v_error using errcode = v_state;
  end if;
end $$;

revoke create on schema app_private from investigation_only;

create function app_private.investigation_event_read(p_booking uuid, p_purpose text)
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
  v_actor uuid := app_private.current_user_id();
  v_grant uuid;
  v_found boolean;
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

  select exists (select 1 from app_private.investigation_payment_view v
                  where v.booking_id = p_booking) into v_found;
  if not v_found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  perform app_private.log_investigation_read(v_actor, v_grant, 'payment_events', p_booking,
                                             p_purpose);

  return query
    select v.event_id,
           v.event_type,
           v.outcome,
           v.amount_minor,
           v.currency,
           v.occurred_at
      from app_private.investigation_events_view v
     where v.booking_id = p_booking
     order by v.occurred_at desc, v.event_id desc
     limit 100;
end $$;

revoke all on function app_private.investigation_event_read(uuid, text)
  from public, anon, authenticated;
do $$ begin
  execute format(
    'grant execute on function app_private.investigation_event_read(uuid, text) to %I', current_user);
end $$;
grant create on schema app_private to investigation_only;

-- The same handover as above, for the second read.
do $$
declare
  v_runner text := current_user;
  v_state  text;
  v_error  text;
begin
  execute format('grant investigation_only to %I', v_runner);
  begin
    execute 'alter function app_private.investigation_event_read(uuid, text) owner to investigation_only';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_error = message_text;
  end;
  if current_setting('server_version_num')::int >= 160000 then
    execute format('revoke investigation_only from %I granted by %I', v_runner, v_runner);
  else
    execute format('revoke investigation_only from %I', v_runner);
  end if;
  if v_error is not null then
    raise exception '%', v_error using errcode = v_state;
  end if;
end $$;

revoke create on schema app_private from investigation_only;

-- ---------------------------------------------------------------------------
-- What the identity may do
-- ---------------------------------------------------------------------------
-- Four helpers, and nothing else. current_user_id and staff_grant_for answer about the caller,
-- not about the money; the gate is a boolean; the fourth writes the audit row.
grant usage on schema app_private to investigation_only;
grant execute on function app_private.current_user_id() to investigation_only;
grant execute on function app_private.staff_grant_for(text, text, uuid) to investigation_only;
grant execute on function app_private.ai_zdr_confirmed() to investigation_only;
grant select on app_private.investigation_payment_view to investigation_only;
grant select on app_private.investigation_events_view to investigation_only;

-- ---------------------------------------------------------------------------
-- The RPCs the application calls
-- ---------------------------------------------------------------------------
-- Same names, same shape, same refusals as F-107 wrote: the application does not change. The
-- body is a passthrough, because the read belongs to the AI's identity and the identity's
-- functions live in app_private, which the API does not expose.
create or replace function public.ai_payment_log(p_booking uuid, p_purpose text)
returns table (
  booking_id           uuid,
  booking_status       text,
  pool_status          text,
  currency             text,
  total_minor          bigint,
  paid_minor           bigint,
  held_minor           bigint,
  released_minor       bigint,
  refunded_minor       bigint,
  frozen               boolean,
  release_30_due_at    timestamptz,
  paid_at              timestamptz,
  completed_at         timestamptz,
  refunded_at          timestamptz,
  movement_count       integer,
  event_count          integer,
  failed_event_count   integer,
  hours_since_paid     integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
    select r.booking_id,
           r.booking_status,
           r.pool_status,
           r.currency,
           r.total_minor,
           r.paid_minor,
           r.held_minor,
           r.released_minor,
           r.refunded_minor,
           r.frozen,
           r.release_30_due_at,
           r.paid_at,
           r.completed_at,
           r.refunded_at,
           r.movement_count,
           r.event_count,
           r.failed_event_count,
           r.hours_since_paid
      from app_private.investigation_read(p_booking, p_purpose) r;
end $$;
revoke all on function public.ai_payment_log(uuid, text) from public, anon;
grant execute on function public.ai_payment_log(uuid, text) to authenticated;

create or replace function public.ai_payment_event_log(p_booking uuid, p_purpose text)
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
begin
  return query
    select r.event_id,
           r.event_type,
           r.outcome,
           r.amount_minor,
           r.currency,
           r.occurred_at
      from app_private.investigation_event_read(p_booking, p_purpose) r;
end $$;
revoke all on function public.ai_payment_event_log(uuid, text) from public, anon;
grant execute on function public.ai_payment_event_log(uuid, text) to authenticated;

notify pgrst, 'reload schema';
