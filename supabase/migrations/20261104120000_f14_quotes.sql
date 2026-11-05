-- F-14 Quote lifecycle & date lock
-- Vendors author quotes (price, inclusions, extras, expiry); a sent quote locks that date on the
-- vendor calendar until it expires or is cancelled. Hosts accept, decline or counter; a revised
-- quote restarts the 24-hour clock.
--
-- Invariants this file owns:
--   * only a vendor-house member with the 'quotes' capability authors or revises an offer
--   * a sent revision is immutable: counters and re-quotes append a new numbered revision
--   * money is bigint minor units with an ISO-4217 currency; the total is recomputed in the
--     database from the line items, never trusted from the caller
--   * the deadline lives on quotes.expires_at (server time); the UI renders it, never owns it
--   * a lock occupies one capacity slot; slots beyond vendor_availability.daily_capacity are
--     recorded as competing instead of being refused (owner decision 2026-11-04: first payment
--     wins, the later payer is refunded by F-38). F-14 moves no money.
--
-- app_private.member_can() mirrors the F-78 role matrix. supabase/pending/*_f78_permission_scoping.sql
-- is not applied yet, so house_can() does not exist in migration order; switch this over to it when
-- that migration lands (docs/journal/2026-11-04-F-14-quote-lifecycle.md).

-- ---------------------------------------------------------------------------
-- Line items and the expiry constant
-- ---------------------------------------------------------------------------
create function app_private.quote_lines_valid(p_lines jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lines is not null
     and jsonb_typeof(p_lines) = 'array'
     and jsonb_array_length(p_lines) between 0 and 100
     and not exists (
       select 1 from jsonb_array_elements(p_lines) item
       where jsonb_typeof(item) <> 'object'
          or coalesce(length(trim(item ->> 'label')), 0) not between 1 and 120
          or (item ->> 'line_total_minor') !~ '^[0-9]{1,15}$'
     )
$$;

create function app_private.quote_lines_sum(p_lines jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((item ->> 'line_total_minor')::bigint), 0)
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) item
$$;

-- Fixed 24 hours (owner decision 2026-11-04). No per-vendor or per-category override exists.
create function app_private.quote_expiry_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '24 hours' $$;

-- ---------------------------------------------------------------------------
-- Vendor availability: how many bookings a vendor can take on one date
-- ---------------------------------------------------------------------------
create table public.vendor_availability (
  id             uuid primary key default gen_random_uuid(),
  house_id       uuid not null,
  house_kind     text not null default 'vendor' check (house_kind = 'vendor'),
  daily_capacity integer not null default 1 check (daily_capacity between 1 and 100),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,
  unique (house_id, house_kind),
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade
);
comment on table public.vendor_availability is
  'F-14/F-38: one daily_capacity integer per Vendor house. Slots above it are competing holds.';
create trigger vendor_availability_touch before update on public.vendor_availability
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Quotes: identity, state and the authoritative deadline
-- ---------------------------------------------------------------------------
create table public.quotes (
  id                uuid primary key default gen_random_uuid(),
  vendor_house_id   uuid not null,
  vendor_house_kind text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  host_house_id     uuid not null,
  host_house_kind   text not null default 'host' check (host_house_kind = 'host'),
  created_by        uuid not null references public.users (id),
  service_date      date not null,
  status            text not null default 'draft'
                    check (status in ('draft','sent','countered','accepted','declined','expired','cancelled')),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor       bigint not null check (total_minor >= 0),
  current_revision  integer not null default 0 check (current_revision >= 0),
  sent_at           timestamptz,
  expires_at        timestamptz,
  decided_at        timestamptz,
  close_note        text check (close_note is null or length(close_note) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  foreign key (host_house_id, host_house_kind) references public.houses (id, kind) on delete cascade,
  -- one party cannot quote to itself, and the deadline is always after the send
  constraint quotes_two_distinct_houses check (vendor_house_id <> host_house_id),
  constraint quotes_state_shape check (
    (status = 'draft' and sent_at is null and expires_at is null and decided_at is null)
    or (status in ('sent','countered') and sent_at is not null and expires_at is not null
        and decided_at is null and expires_at > sent_at)
    or (status in ('accepted','declined','expired') and sent_at is not null
        and expires_at is not null and decided_at is not null)
    -- a draft can be withdrawn before it was ever sent, so it has no deadline yet
    or (status = 'cancelled' and decided_at is not null)
  )
);
comment on table public.quotes is 'F-14: quote aggregate. status + expires_at are server-authoritative.';
create index quotes_vendor_house_idx on public.quotes (vendor_house_id, service_date);
create index quotes_host_house_idx on public.quotes (host_house_id, service_date);
create index quotes_open_expiry_idx on public.quotes (expires_at)
  where status in ('sent', 'countered');
create trigger quotes_touch before update on public.quotes
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Quote revisions: the offer as it was written, append-only once sent
-- ---------------------------------------------------------------------------
create table public.quote_revisions (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null references public.quotes (id) on delete cascade,
  number           integer not null check (number >= 1),
  authored_by_role text not null check (authored_by_role in ('vendor', 'host')),
  author_user_id   uuid not null references public.users (id),
  title            text not null check (length(title) between 1 and 120),
  inclusions       jsonb not null default '[]'::jsonb,
  extras           jsonb not null default '[]'::jsonb,
  subtotal_minor   bigint not null check (subtotal_minor >= 0),
  total_minor      bigint not null check (total_minor >= 0),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  message          text check (message is null or length(message) between 1 and 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  unique (quote_id, number),
  constraint revisions_lines_valid
    check (app_private.quote_lines_valid(inclusions) and app_private.quote_lines_valid(extras)),
  -- totals are derived from the line items, so a caller cannot state a price the lines disagree with
  constraint revisions_totals_derived
    check (subtotal_minor = app_private.quote_lines_sum(inclusions)
           and total_minor = app_private.quote_lines_sum(inclusions)
                           + app_private.quote_lines_sum(extras)),
  -- a host counter carries words, not a rewritten vendor offer (that is the vendor's revision)
  constraint revisions_host_counter_has_message
    check (authored_by_role = 'vendor' or message is not null)
);
comment on table public.quote_revisions is
  'F-14: immutable offer revisions. Every edit appends one; current_revision points at the latest.';
create trigger quote_revisions_touch before update on public.quote_revisions
  for each row execute function app_private.touch();
create trigger quote_revisions_append_only
  before update or delete or truncate on public.quote_revisions
  for each statement execute function app_private.forbid_change();

-- ---------------------------------------------------------------------------
-- Date locks: the calendar hold a sent quote creates
-- ---------------------------------------------------------------------------
create table public.quote_date_locks (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null references public.quotes (id) on delete cascade,
  vendor_house_id   uuid not null,
  vendor_house_kind text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  service_date      date not null,
  slot              integer not null check (slot >= 1),
  released_at       timestamptz,
  release_reason    text check (release_reason in ('expired', 'declined', 'cancelled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  constraint locks_release_reason_matches check ((released_at is null) = (release_reason is null))
);
comment on table public.quote_date_locks is
  'F-14: one live lock per sent quote. slot <= daily_capacity is exclusive; above it, competing.';
create unique index quote_date_locks_one_live_per_quote on public.quote_date_locks (quote_id)
  where released_at is null;
create unique index quote_date_locks_one_per_slot on public.quote_date_locks
  (vendor_house_id, service_date, slot) where released_at is null;
create index quote_date_locks_date_idx on public.quote_date_locks (vendor_house_id, service_date)
  where released_at is null;
create trigger quote_date_locks_touch before update on public.quote_date_locks
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Row-level security: read-only projections, every write through a function
-- ---------------------------------------------------------------------------
alter table public.vendor_availability enable row level security;
alter table public.vendor_availability force row level security;
alter table public.quotes enable row level security;
alter table public.quotes force row level security;
alter table public.quote_revisions enable row level security;
alter table public.quote_revisions force row level security;
alter table public.quote_date_locks enable row level security;
alter table public.quote_date_locks force row level security;

revoke all on public.vendor_availability, public.quotes, public.quote_revisions, public.quote_date_locks
  from public, anon, authenticated;
grant select on public.vendor_availability, public.quotes, public.quote_revisions, public.quote_date_locks
  to authenticated;

-- Local mirror of the F-78 role matrix (see the header note). Fails closed.
create function app_private.member_can(p_house uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p_capability not in ('chat','quotes','calendar','profile','bookings','payouts','members','billing') then false
      when m.role = 'owner' then true
      when p_capability in ('payouts','members','billing') then false
      else p_capability = any (m.capabilities)
    end
    from public.memberships m
    join public.houses h on h.id = m.house_id and h.archived_at is null
    where m.house_id = p_house
      and m.user_id = app_private.current_user_id()
      and m.revoked_at is null
  ), false)
$$;
revoke all on function app_private.member_can(uuid, text) from public;
grant execute on function app_private.member_can(uuid, text) to authenticated;

create function app_private.require_actor(p_house uuid, p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := app_private.current_user_id();
begin
  if v_user is null or not app_private.member_can(p_house, p_capability) then
    raise exception 'forbidden: % in house', p_capability using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function app_private.require_actor(uuid, text) from public;
grant execute on function app_private.require_actor(uuid, text) to authenticated;

create policy vendor_availability_vendor_read on public.vendor_availability
  for select to authenticated
  using (app_private.member_can(house_id, 'calendar') or app_private.member_can(house_id, 'quotes'));

create policy quotes_party_read on public.quotes
  for select to authenticated
  using (app_private.member_can(vendor_house_id, 'quotes')
         or app_private.member_can(host_house_id, 'quotes'));

create policy quote_revisions_party_read on public.quote_revisions
  for select to authenticated
  using (exists (
    select 1 from public.quotes q
    where q.id = quote_id
      and (app_private.member_can(q.vendor_house_id, 'quotes')
           or app_private.member_can(q.host_house_id, 'quotes'))
  ));

create policy quote_date_locks_party_read on public.quote_date_locks
  for select to authenticated
  using (app_private.member_can(vendor_house_id, 'calendar')
         or app_private.member_can(vendor_house_id, 'quotes')
         or exists (select 1 from public.quotes q
                    where q.id = quote_id and app_private.member_can(q.host_house_id, 'quotes')));

-- ---------------------------------------------------------------------------
-- Expiry: the deadline decides, not the caller
-- ---------------------------------------------------------------------------
-- Scoped on purpose: a read sweeps only the caller's house (or one quote), so no request can
-- rewrite another house's rows and no read scans the whole table. The scheduler (F-72) runs the
-- unscoped sweep through expire_due_quotes() with the service role.
create function app_private.apply_expiry(p_house uuid default null, p_quote uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row  record;
  v_done integer := 0;
begin
  for v_row in
    select q.id, q.vendor_house_id
    from public.quotes q
    where q.status in ('sent', 'countered')
      and q.expires_at <= now()
      and (p_quote is null or q.id = p_quote)
      and (p_house is null or q.vendor_house_id = p_house or q.host_house_id = p_house)
  loop
    update public.quotes
       set status = 'expired', decided_at = now(), close_note = 'expired'
     where id = v_row.id and status in ('sent', 'countered');
    if found then
      update public.quote_date_locks
         set released_at = now(), release_reason = 'expired'
       where quote_id = v_row.id and released_at is null;
      perform app_private.audit(null, 'quote.expired', 'quotes', v_row.id, v_row.vendor_house_id,
                                '{"reason":"deadline_passed"}'::jsonb);
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;
revoke all on function app_private.apply_expiry(uuid, uuid) from public;

create function public.expire_due_quotes()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$ select app_private.apply_expiry() $$;
comment on function public.expire_due_quotes() is
  'F-14: unscoped expiry sweep for the scheduler (F-72). Not callable by clients.';
revoke all on function public.expire_due_quotes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared guards
-- ---------------------------------------------------------------------------
create function app_private.load_quote(p_quote uuid)
returns public.quotes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q public.quotes;
begin
  perform app_private.apply_expiry(null, p_quote);
  select * into v_q from public.quotes where id = p_quote;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  return v_q;
end;
$$;
revoke all on function app_private.load_quote(uuid) from public;

create function app_private.expect_version(p_quote public.quotes, p_expected integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_quote.version <> p_expected then
    raise exception 'stale_version: expected %, found %', p_expected, p_quote.version
      using errcode = '40001';
  end if;
end;
$$;
revoke all on function app_private.expect_version(public.quotes, integer) from public;

create function app_private.require_status(p_quote public.quotes, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not (p_quote.status = any (p_allowed)) then
    raise exception 'invalid_transition: quote is %', p_quote.status using errcode = '22023';
  end if;
end;
$$;
revoke all on function app_private.require_status(public.quotes, text[]) from public;

create function app_private.release_lock(p_quote uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.quote_date_locks
     set released_at = now(), release_reason = p_reason
   where quote_id = p_quote and released_at is null;
end;
$$;
revoke all on function app_private.release_lock(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Vendor side
-- ---------------------------------------------------------------------------
create function public.create_quote(
  p_vendor_house uuid, p_host_house uuid, p_service_date date, p_currency text,
  p_title text, p_inclusions jsonb, p_extras jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_actor(p_vendor_house, 'quotes');
  v_id    uuid;
  v_total bigint;
begin
  if not exists (select 1 from public.houses h
                 where h.id = p_host_house and h.kind = 'host' and h.archived_at is null) then
    raise exception 'invalid_host_house' using errcode = '22023';
  end if;
  if p_service_date is null then
    raise exception 'service_date_required' using errcode = '22023';
  end if;
  if not app_private.quote_lines_valid(coalesce(p_inclusions, '[]'::jsonb))
     or not app_private.quote_lines_valid(coalesce(p_extras, '[]'::jsonb)) then
    raise exception 'invalid_quote_lines' using errcode = '22023';
  end if;

  v_total := app_private.quote_lines_sum(p_inclusions) + app_private.quote_lines_sum(p_extras);

  insert into public.quotes (vendor_house_id, host_house_id, created_by, service_date, currency,
                             total_minor, current_revision)
  values (p_vendor_house, p_host_house, v_actor, p_service_date, upper(trim(p_currency)), v_total, 1)
  returning id into v_id;

  insert into public.quote_revisions
    (quote_id, number, authored_by_role, author_user_id, title, inclusions, extras,
     subtotal_minor, total_minor, currency)
  values (v_id, 1, 'vendor', v_actor, p_title, coalesce(p_inclusions, '[]'::jsonb),
          coalesce(p_extras, '[]'::jsonb), app_private.quote_lines_sum(p_inclusions), v_total,
          upper(trim(p_currency)));

  perform app_private.audit(v_actor, 'quote.created', 'quotes', v_id, p_vendor_house,
                            jsonb_build_object('host_house_id', p_host_house, 'service_date', p_service_date));
  return v_id;
end;
$$;
revoke all on function public.create_quote(uuid, uuid, date, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_quote(uuid, uuid, date, text, text, jsonb, jsonb) to authenticated;

-- Every vendor edit appends a revision, in a draft as much as after a counter: a revision that
-- exists is never rewritten. Sending is what restarts the 24-hour clock.
create function public.revise_quote(
  p_quote uuid, p_expected_version integer, p_title text, p_inclusions jsonb, p_extras jsonb,
  p_message text default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q      public.quotes := app_private.load_quote(p_quote);
  v_actor  uuid;
  v_number integer;
begin
  v_actor := app_private.require_actor(v_q.vendor_house_id, 'quotes');
  perform app_private.expect_version(v_q, p_expected_version);
  perform app_private.require_status(v_q, array['draft', 'countered']);
  if not app_private.quote_lines_valid(coalesce(p_inclusions, '[]'::jsonb))
     or not app_private.quote_lines_valid(coalesce(p_extras, '[]'::jsonb)) then
    raise exception 'invalid_quote_lines' using errcode = '22023';
  end if;

  select coalesce(max(number), 0) + 1 into v_number from public.quote_revisions where quote_id = p_quote;

  insert into public.quote_revisions
    (quote_id, number, authored_by_role, author_user_id, title, inclusions, extras,
     subtotal_minor, total_minor, currency, message)
  values (p_quote, v_number, 'vendor', v_actor, p_title, coalesce(p_inclusions, '[]'::jsonb),
          coalesce(p_extras, '[]'::jsonb), app_private.quote_lines_sum(p_inclusions),
          app_private.quote_lines_sum(p_inclusions) + app_private.quote_lines_sum(p_extras),
          v_q.currency, nullif(trim(coalesce(p_message, '')), ''));

  update public.quotes
     set current_revision = v_number,
         total_minor = app_private.quote_lines_sum(p_inclusions) + app_private.quote_lines_sum(p_extras)
   where id = p_quote;

  perform app_private.audit(v_actor, 'quote.revised', 'quotes', p_quote, v_q.vendor_house_id,
                            jsonb_build_object('revision', v_number));
  return v_number;
end;
$$;
revoke all on function public.revise_quote(uuid, integer, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.revise_quote(uuid, integer, text, jsonb, jsonb, text) to authenticated;

-- Sending locks the date: one slot per sent quote, taken under a row lock on the vendor's
-- availability so two concurrent sends cannot claim the same slot.
create function public.send_quote(p_quote uuid, p_expected_version integer)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q       public.quotes := app_private.load_quote(p_quote);
  v_actor   uuid;
  v_avail   public.vendor_availability;
  v_slot    integer;
  v_expires timestamptz;
begin
  v_actor := app_private.require_actor(v_q.vendor_house_id, 'quotes');
  perform app_private.expect_version(v_q, p_expected_version);
  perform app_private.require_status(v_q, array['draft', 'countered']);
  if v_q.current_revision = 0 then
    raise exception 'quote_has_no_offer' using errcode = '22023';
  end if;

  insert into public.vendor_availability (house_id, house_kind)
  values (v_q.vendor_house_id, 'vendor')
  on conflict (house_id, house_kind) do nothing;
  select * into v_avail from public.vendor_availability
   where house_id = v_q.vendor_house_id
   for update;

  update public.quotes
     set status = 'sent',
         sent_at = now(),
         expires_at = now() + app_private.quote_expiry_interval(),
         current_revision = (select max(number) from public.quote_revisions where quote_id = p_quote),
         close_note = null
   where id = p_quote
  returning expires_at into v_expires;

  if not exists (select 1 from public.quote_date_locks
                 where quote_id = p_quote and released_at is null) then
    select coalesce(max(slot), 0) + 1 into v_slot
    from public.quote_date_locks
    where vendor_house_id = v_q.vendor_house_id
      and service_date = v_q.service_date
      and released_at is null;

    insert into public.quote_date_locks (quote_id, vendor_house_id, vendor_house_kind, service_date, slot)
    values (p_quote, v_q.vendor_house_id, 'vendor', v_q.service_date, v_slot);

    perform app_private.audit(v_actor, 'quote.date_locked', 'quote_date_locks', p_quote,
                              v_q.vendor_house_id,
                              jsonb_build_object('service_date', v_q.service_date, 'slot', v_slot,
                                                 'daily_capacity', v_avail.daily_capacity,
                                                 'competing', v_slot > v_avail.daily_capacity));
  end if;

  perform app_private.audit(v_actor, 'quote.sent', 'quotes', p_quote, v_q.vendor_house_id,
                            jsonb_build_object('service_date', v_q.service_date));
  return v_expires;
end;
$$;
revoke all on function public.send_quote(uuid, integer) from public, anon;
grant execute on function public.send_quote(uuid, integer) to authenticated;

-- Vendor withdraws an offer. The date is released at once.
create function public.cancel_quote(p_quote uuid, p_expected_version integer, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q     public.quotes := app_private.load_quote(p_quote);
  v_actor uuid;
begin
  v_actor := app_private.require_actor(v_q.vendor_house_id, 'quotes');
  perform app_private.expect_version(v_q, p_expected_version);
  perform app_private.require_status(v_q, array['draft', 'sent', 'countered']);

  update public.quotes
     set status = 'cancelled', decided_at = now(),
         close_note = nullif(left(trim(coalesce(p_reason, '')), 500), '')
   where id = p_quote;
  perform app_private.release_lock(p_quote, 'cancelled');
  perform app_private.audit(v_actor, 'quote.cancelled', 'quotes', p_quote, v_q.vendor_house_id);
end;
$$;
revoke all on function public.cancel_quote(uuid, integer, text) from public, anon;
grant execute on function public.cancel_quote(uuid, integer, text) to authenticated;

-- Owner-only: how many bookings this vendor can take on one date (owner decision 2026-11-04).
create function public.set_vendor_daily_capacity(p_house uuid, p_capacity integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_actor(p_house, 'calendar');
begin
  if not exists (select 1 from public.memberships m
                 where m.house_id = p_house and m.user_id = v_actor
                   and m.role = 'owner' and m.revoked_at is null) then
    raise exception 'forbidden: only the vendor owner sets capacity' using errcode = '42501';
  end if;
  if p_capacity is null or p_capacity not between 1 and 100 then
    raise exception 'invalid_daily_capacity' using errcode = '22023';
  end if;

  insert into public.vendor_availability (house_id, house_kind, daily_capacity)
  values (p_house, 'vendor', p_capacity)
  on conflict (house_id, house_kind) do update set daily_capacity = excluded.daily_capacity;

  perform app_private.audit(v_actor, 'availability.capacity_changed', 'vendor_availability', p_house,
                            p_house, jsonb_build_object('daily_capacity', p_capacity));
end;
$$;
revoke all on function public.set_vendor_daily_capacity(uuid, integer) from public, anon;
grant execute on function public.set_vendor_daily_capacity(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Host side
-- ---------------------------------------------------------------------------
-- A counter is the host's words, not a rewritten offer: the vendor must revise and re-send,
-- which is what restarts the clock. The running deadline is left alone on purpose.
create function public.counter_quote(p_quote uuid, p_expected_version integer, p_message text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q      public.quotes := app_private.load_quote(p_quote);
  v_actor  uuid;
  v_number integer;
begin
  v_actor := app_private.require_actor(v_q.host_house_id, 'quotes');
  perform app_private.expect_version(v_q, p_expected_version);
  perform app_private.require_status(v_q, array['sent', 'countered']);
  if coalesce(length(trim(p_message)), 0) not between 1 and 2000 then
    raise exception 'counter_message_required' using errcode = '22023';
  end if;

  select coalesce(max(number), 0) + 1 into v_number from public.quote_revisions where quote_id = p_quote;

  insert into public.quote_revisions
    (quote_id, number, authored_by_role, author_user_id, title, inclusions, extras,
     subtotal_minor, total_minor, currency, message)
  select p_quote, v_number, 'host', v_actor, r.title, r.inclusions, r.extras,
         r.subtotal_minor, r.total_minor, r.currency, trim(p_message)
  from public.quote_revisions r
  where r.quote_id = p_quote and r.number = v_q.current_revision;

  update public.quotes set status = 'countered', current_revision = v_number where id = p_quote;
  perform app_private.audit(v_actor, 'quote.countered', 'quotes', p_quote, v_q.host_house_id,
                            jsonb_build_object('revision', v_number));
end;
$$;
revoke all on function public.counter_quote(uuid, integer, text) from public, anon;
grant execute on function public.counter_quote(uuid, integer, text) to authenticated;

create function public.accept_quote(p_quote uuid, p_expected_version integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q     public.quotes := app_private.load_quote(p_quote);
  v_actor uuid;
begin
  v_actor := app_private.require_actor(v_q.host_house_id, 'quotes');
  perform app_private.expect_version(v_q, p_expected_version);
  perform app_private.require_status(v_q, array['sent', 'countered']);

  -- The date stays locked: payment and booking (F-15) pick the accepted quote up from here.
  update public.quotes set status = 'accepted', decided_at = now() where id = p_quote;
  perform app_private.audit(v_actor, 'quote.accepted', 'quotes', p_quote, v_q.host_house_id,
                            jsonb_build_object('revision', v_q.current_revision,
                                               'total_minor', v_q.total_minor,
                                               'currency', v_q.currency));
end;
$$;
revoke all on function public.accept_quote(uuid, integer) from public, anon;
grant execute on function public.accept_quote(uuid, integer) to authenticated;

create function public.decline_quote(p_quote uuid, p_expected_version integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q     public.quotes := app_private.load_quote(p_quote);
  v_actor uuid;
begin
  v_actor := app_private.require_actor(v_q.host_house_id, 'quotes');
  perform app_private.expect_version(v_q, p_expected_version);
  perform app_private.require_status(v_q, array['sent', 'countered']);

  update public.quotes set status = 'declined', decided_at = now() where id = p_quote;
  perform app_private.release_lock(p_quote, 'declined');
  perform app_private.audit(v_actor, 'quote.declined', 'quotes', p_quote, v_q.host_house_id);
end;
$$;
revoke all on function public.decline_quote(uuid, integer) from public, anon;
grant execute on function public.decline_quote(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Authorized projection: one house's quotes, never the other house's data
-- ---------------------------------------------------------------------------
create function public.my_quotes(p_house uuid)
returns table (
  quote_id          uuid,
  service_date      date,
  status            text,
  currency          text,
  total_minor       bigint,
  current_revision  integer,
  sent_at           timestamptz,
  expires_at        timestamptz,
  decided_at        timestamptz,
  close_note        text,
  version           integer,
  is_vendor_side    boolean,
  counterparty_house uuid,
  counterparty_name text,
  title             text,
  lock_slot         integer,
  daily_capacity    integer,
  competing         boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_actor(p_house, 'quotes');
  perform app_private.apply_expiry(p_house);

  return query
    select q.id, q.service_date, q.status, q.currency, q.total_minor, q.current_revision,
           q.sent_at, q.expires_at, q.decided_at, q.close_note, q.version,
           q.vendor_house_id = p_house,
           case when q.vendor_house_id = p_house then q.host_house_id else q.vendor_house_id end,
           cp.display_name,
           r.title,
           l.slot,
           coalesce(a.daily_capacity, 1),
           l.slot is not null and l.slot > coalesce(a.daily_capacity, 1)
    from public.quotes q
    join public.houses cp on cp.id = case when q.vendor_house_id = p_house
                                          then q.host_house_id else q.vendor_house_id end
    left join public.quote_revisions r on r.quote_id = q.id and r.number = q.current_revision
    left join public.quote_date_locks l on l.quote_id = q.id and l.released_at is null
    left join public.vendor_availability a on a.house_id = q.vendor_house_id
    where q.vendor_house_id = p_house or q.host_house_id = p_house
    order by q.service_date desc, q.created_at desc;
end;
$$;
revoke all on function public.my_quotes(uuid) from public, anon;
grant execute on function public.my_quotes(uuid) to authenticated;

-- The offer as it was written, revision by revision: both parties see the same history.
create function public.quote_history(p_quote uuid)
returns table (
  number           integer,
  authored_by_role text,
  title            text,
  inclusions       jsonb,
  extras           jsonb,
  currency         text,
  subtotal_minor   bigint,
  total_minor      bigint,
  message          text,
  created_at       timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q public.quotes;
begin
  perform app_private.apply_expiry(null, p_quote);
  select * into v_q from public.quotes where id = p_quote;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;
  if not (app_private.member_can(v_q.vendor_house_id, 'quotes')
          or app_private.member_can(v_q.host_house_id, 'quotes')) then
    raise exception 'forbidden: quotes in house' using errcode = '42501';
  end if;

  return query
    select r.number, r.authored_by_role, r.title, r.inclusions, r.extras, r.currency,
           r.subtotal_minor, r.total_minor, r.message, r.created_at
    from public.quote_revisions r
    where r.quote_id = p_quote
    order by r.number;
end;
$$;
revoke all on function public.quote_history(uuid) from public, anon;
grant execute on function public.quote_history(uuid) to authenticated;
