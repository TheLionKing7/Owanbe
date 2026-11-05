-- F-38 Vendor calendar soft-hold
-- Accepting a quote (F-14) starts a 24-hour payment window and keeps the date softly held. A vendor
-- can hold the same date for several hosts at once; once daily_capacity slots are paid for, the
-- first confirmed payments win and every later or late payment becomes a refund obligation.
--
-- Invariants this file owns:
--   * the window starts inside the database, on acceptance, and its deadline is server time
--     (payment_due_at) — no client, timer or later feature can accept a quote without one
--   * only the server records a payment confirmation; a browser can never assert that it paid
--     (this is the seam F-48's Paystack charge.success path calls into — no provider call exists yet)
--   * payment decisions for one vendor are serialised on that vendor's vendor_availability row, the
--     same row F-14's send_quote locks, so simultaneous confirmations cannot both win
--   * a confirmation that arrives after the window closed never grants the date (owner decision
--     2026-11-04): the money is recorded as a refund obligation instead
--   * refund_obligations is an append-only ledger: no update, no delete, one row per hold and per
--     payment reference, so a retried webhook cannot double-record a refund
--   * nothing here moves money and nothing here emails; F-42/F-48 act on the ledger, and alerts are
--     in-app rows only (owner decision 2026-11-04)
--   * money is bigint minor units with an ISO-4217 currency, and audit/notification payloads carry
--     identifiers, never offer contents or payment references
--
-- Depends on 20261104120000_f14_quotes.sql (quotes, quote_date_locks, vendor_availability,
-- member_can, require_actor, audit). Acceptance criteria:
-- docs/journal/2026-11-04-F-38-vendor-calendar-soft-hold.md

-- ---------------------------------------------------------------------------
-- The payment window: a fixed 24 hours, owned by the server
-- ---------------------------------------------------------------------------
-- Deliberately its own constant, separate from F-14's quote_expiry_interval(): one is the time a
-- host has to answer an offer, the other is the time a host has to pay after saying yes.
create function app_private.payment_window_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '24 hours' $$;

-- A date lock released because the window closed or the date was won elsewhere is not one of
-- F-14's three reasons, so the check is widened instead of duplicating the state in a new column.
alter table public.quote_date_locks
  drop constraint quote_date_locks_release_reason_check;
alter table public.quote_date_locks
  add constraint quote_date_locks_release_reason_check check (
    release_reason in ('expired', 'declined', 'cancelled', 'payment_window_closed', 'outbid'));

-- ---------------------------------------------------------------------------
-- Soft holds: one per accepted quote, with the authoritative payment deadline
-- ---------------------------------------------------------------------------
create table public.quote_payment_holds (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null references public.quotes (id) on delete cascade,
  lock_id           uuid not null references public.quote_date_locks (id) on delete restrict,
  vendor_house_id   uuid not null,
  vendor_house_kind text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  host_house_id     uuid not null,
  host_house_kind   text not null default 'host' check (host_house_kind = 'host'),
  service_date      date not null,
  status            text not null default 'awaiting_payment'
                    check (status in ('awaiting_payment', 'confirmed', 'released')),
  payment_due_at    timestamptz not null,
  confirmed_at      timestamptz,
  released_at       timestamptz,
  release_reason    text check (release_reason in ('payment_window_closed', 'outbid')),
  payment_reference text,
  paid_minor        bigint check (paid_minor is null or paid_minor >= 0),
  paid_currency     text check (paid_currency is null or paid_currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  foreign key (host_house_id, host_house_kind) references public.houses (id, kind) on delete cascade,
  constraint holds_two_distinct_houses check (vendor_house_id <> host_house_id),
  constraint holds_state_shape check (
    (status = 'awaiting_payment' and confirmed_at is null and released_at is null
     and payment_reference is null and paid_minor is null)
    or (status = 'confirmed' and confirmed_at is not null and released_at is null
        and payment_reference is not null and paid_minor is not null)
    or (status = 'released' and released_at is not null and confirmed_at is null
        and release_reason is not null)
  )
);
comment on table public.quote_payment_holds is
  'F-38: the 24-hour payment window and soft date hold created when a quote is accepted.';
create unique index quote_payment_holds_one_per_quote on public.quote_payment_holds (quote_id);
create unique index quote_payment_holds_reference_unique on public.quote_payment_holds (payment_reference)
  where payment_reference is not null;
create index quote_payment_holds_date_idx on public.quote_payment_holds (vendor_house_id, service_date);
create index quote_payment_holds_window_idx on public.quote_payment_holds (payment_due_at)
  where status = 'awaiting_payment';
create trigger quote_payment_holds_touch before update on public.quote_payment_holds
  for each row execute function app_private.touch();

-- The currency actually paid has to be the currency the offer was made in. A check constraint
-- cannot read another table, so this is enforced on write instead of being trusted to the reader.
create function app_private.holds_paid_currency_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_quote_currency text;
begin
  if new.paid_currency is null then
    return new;
  end if;
  select q.currency into v_quote_currency from public.quotes q where q.id = new.quote_id;
  if v_quote_currency is distinct from new.paid_currency then
    raise exception 'currency_mismatch: quote is in %', coalesce(v_quote_currency, 'unknown')
      using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function app_private.holds_paid_currency_matches() from public;
create trigger quote_payment_holds_paid_currency
  before update or insert on public.quote_payment_holds
  for each row execute function app_private.holds_paid_currency_matches();

-- ---------------------------------------------------------------------------
-- Refund obligations: the append-only ledger F-42 and F-48 act on later
-- ---------------------------------------------------------------------------
create table public.refund_obligations (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null references public.quotes (id) on delete restrict,
  hold_id           uuid not null references public.quote_payment_holds (id) on delete restrict,
  vendor_house_id   uuid not null,
  vendor_house_kind text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  host_house_id     uuid not null,
  host_house_kind   text not null default 'host' check (host_house_kind = 'host'),
  service_date      date not null,
  refund_minor      bigint not null check (refund_minor > 0),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  payment_reference text not null,
  -- 'outbid': paid, but the date was already won by another host.
  -- 'late_payment': the payment landed after the window closed and the date was released.
  reason            text not null check (reason in ('outbid', 'late_payment')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  foreign key (host_house_id, host_house_kind) references public.houses (id, kind) on delete cascade,
  unique (hold_id),
  unique (payment_reference)
);
comment on table public.refund_obligations is
  'F-38: immutable record that money was taken for a date the host will not get. Moves nothing.';
create index refund_obligations_vendor_idx on public.refund_obligations (vendor_house_id, service_date);
create trigger refund_obligations_touch before update on public.refund_obligations
  for each row execute function app_private.touch();
create trigger refund_obligations_append_only
  before update or delete or truncate on public.refund_obligations
  for each statement execute function app_private.forbid_change();

-- ---------------------------------------------------------------------------
-- In-app alerts (owner decision 2026-11-04: rows only; channels and badges are F-24/F-31/F-3)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null,
  house_kind text not null check (house_kind in ('host', 'vendor')),
  kind       text not null check (kind in ('date_competing', 'date_secured', 'date_outbid',
                                           'payment_window_closed', 'refund_pending')),
  title      text not null check (length(title) between 1 and 120),
  body       text not null check (length(body) between 1 and 500),
  -- identifiers only, never amounts, payment references or offer contents
  payload    jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  dedupe_key text not null unique,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade
);
comment on table public.notifications is
  'F-38: house-scoped in-app alerts, written only from inside server functions.';
create index notifications_house_idx on public.notifications (house_id, created_at desc);
create trigger notifications_touch before update on public.notifications
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Row-level security: read-only projections, every write through a function
-- ---------------------------------------------------------------------------
alter table public.quote_payment_holds enable row level security;
alter table public.quote_payment_holds force row level security;
alter table public.refund_obligations enable row level security;
alter table public.refund_obligations force row level security;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

revoke all on public.quote_payment_holds, public.refund_obligations, public.notifications
  from public, anon, authenticated;
grant select on public.quote_payment_holds, public.refund_obligations, public.notifications
  to authenticated;

create policy quote_payment_holds_party_read on public.quote_payment_holds
  for select to authenticated
  using (app_private.member_can(vendor_house_id, 'calendar')
         or app_private.member_can(vendor_house_id, 'quotes')
         or app_private.member_can(host_house_id, 'quotes'));

create policy refund_obligations_party_read on public.refund_obligations
  for select to authenticated
  using (app_private.member_can(vendor_house_id, 'calendar')
         or app_private.member_can(vendor_house_id, 'quotes')
         or app_private.member_can(host_house_id, 'quotes'));

create policy notifications_member_read on public.notifications
  for select to authenticated using (app_private.is_active_member(house_id));

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
-- The dedupe key is scoped to the house inside this function, so one logical event can put a
-- differently worded alert in both houses without one insert swallowing the other.
create function app_private.notify(
  p_house uuid, p_house_kind text, p_kind text, p_title text, p_body text,
  p_payload jsonb, p_dedupe text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.notifications (house_id, house_kind, kind, title, body, payload, dedupe_key)
  values (p_house, p_house_kind, p_kind, p_title, p_body, p_payload, p_house || '|' || p_dedupe)
  on conflict (dedupe_key) do nothing
$$;
revoke all on function app_private.notify(uuid, text, text, text, text, jsonb, text) from public;

create function app_private.record_refund_obligation(
  p_hold public.quote_payment_holds, p_reference text, p_amount bigint, p_currency text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- one obligation per hold and per reference: a retried confirmation changes nothing
  insert into public.refund_obligations
    (quote_id, hold_id, vendor_house_id, vendor_house_kind, host_house_id, host_house_kind,
     service_date, refund_minor, currency, payment_reference, reason)
  values (p_hold.quote_id, p_hold.id, p_hold.vendor_house_id, 'vendor', p_hold.host_house_id, 'host',
          p_hold.service_date, p_amount, p_currency, p_reference,
          case when p_hold.release_reason = 'outbid' then 'outbid' else 'late_payment' end)
  on conflict do nothing;
end $$;
revoke all on function
  app_private.record_refund_obligation(public.quote_payment_holds, text, bigint, text) from public;

-- How many confirmed holds this vendor has on this date.
create function app_private.confirmed_hold_count(p_vendor uuid, p_date date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.quote_payment_holds
  where vendor_house_id = p_vendor and service_date = p_date and status = 'confirmed'
$$;
revoke all on function app_private.confirmed_hold_count(uuid, date) from public;

-- A vendor that has never sent a quote has no availability row; one booking per date is the
-- default the table itself declares.
create function app_private.vendor_capacity(p_vendor uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.daily_capacity from public.vendor_availability a
                   where a.house_id = p_vendor), 1)
$$;
revoke all on function app_private.vendor_capacity(uuid) from public;

-- Release one hold and the F-14 date lock behind it. True when this call is what released it.
create function app_private.release_hold(p_hold public.quote_payment_holds, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.quote_payment_holds
     set status = 'released', released_at = now(), release_reason = p_reason
   where id = p_hold.id and status <> 'released';
  if not found then
    return false;
  end if;

  update public.quote_date_locks
     set released_at = now(), release_reason = p_reason
   where quote_id = p_hold.quote_id and released_at is null;

  perform app_private.audit(null, 'hold.' || p_reason, 'quote_payment_holds', p_hold.id,
                            p_hold.vendor_house_id,
                            jsonb_build_object('service_date', p_hold.service_date,
                                               'quote_id', p_hold.quote_id));
  return true;
end $$;
revoke all on function app_private.release_hold(public.quote_payment_holds, text) from public;

-- ---------------------------------------------------------------------------
-- Acceptance starts the window: a trigger so no path can skip it
-- ---------------------------------------------------------------------------
create function app_private.on_quote_accepted()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lock     public.quote_date_locks;
  v_capacity integer;
  v_hold     public.quote_payment_holds;
begin
  -- F-14 only lets a sent or countered quote be accepted, and both keep a live lock
  select * into v_lock from public.quote_date_locks
   where quote_id = new.id and released_at is null;
  if not found then
    raise exception 'hold_needs_live_lock' using errcode = '22023';
  end if;

  v_capacity := app_private.vendor_capacity(new.vendor_house_id);

  insert into public.quote_payment_holds
    (quote_id, lock_id, vendor_house_id, vendor_house_kind, host_house_id, host_house_kind,
     service_date, payment_due_at)
  values (new.id, v_lock.id, new.vendor_house_id, 'vendor', new.host_house_id, 'host',
          new.service_date, now() + app_private.payment_window_interval())
  on conflict (quote_id) do nothing;

  select * into v_hold from public.quote_payment_holds where quote_id = new.id;

  perform app_private.audit(null, 'hold.created', 'quote_payment_holds', v_hold.id,
                            v_hold.vendor_house_id,
                            jsonb_build_object('service_date', v_hold.service_date,
                                               'slot', v_lock.slot));

  -- Above capacity the date is contested, and both houses are told in the same words the vendor
  -- calendar uses. At or below it the host simply has 24 hours to pay.
  if v_lock.slot > v_capacity then
    perform app_private.notify(v_hold.host_house_id, 'host', 'date_competing',
      'Another host is engaging this date',
      'This vendor is holding the date for more hosts than they can take. The first confirmed '
      'payment keeps it.',
      jsonb_build_object('quote_id', v_hold.quote_id, 'service_date', v_hold.service_date,
                         'slot', v_lock.slot, 'daily_capacity', v_capacity),
      'date_competing|' || v_hold.id);
    perform app_private.notify(v_hold.vendor_house_id, 'vendor', 'date_competing',
      'Two hosts hold this date',
      'More hosts are holding this date than you can take. The first confirmed payment keeps it.',
      jsonb_build_object('quote_id', v_hold.quote_id, 'service_date', v_hold.service_date,
                         'slot', v_lock.slot, 'daily_capacity', v_capacity),
      'date_competing|' || v_hold.id);
  end if;
  return new;
end $$;
revoke all on function app_private.on_quote_accepted() from public;

create trigger quotes_accepted_hold
  after update on public.quotes
  for each row when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function app_private.on_quote_accepted();

-- ---------------------------------------------------------------------------
-- The deadline decides, not the caller
-- ---------------------------------------------------------------------------
-- Scoped on purpose, like F-14's apply_expiry: a read sweeps only the caller's house (or one
-- quote), so no request can rewrite another house's rows. The scheduler (F-72) runs the unscoped
-- sweep through release_lapsed_payment_holds() with the service role.
create function app_private.apply_hold_release(p_house uuid default null, p_quote uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row  public.quote_payment_holds;
  v_done integer := 0;
begin
  for v_row in
    select h.*
    from public.quote_payment_holds h
    join public.quotes q on q.id = h.quote_id
    where h.status = 'awaiting_payment'
      and h.payment_due_at <= now()
      and (p_quote is null or h.quote_id = p_quote)
      and (p_house is null or q.vendor_house_id = p_house or q.host_house_id = p_house)
    order by h.payment_due_at
  loop
    if app_private.release_hold(v_row, 'payment_window_closed') then
      perform app_private.notify(v_row.host_house_id, 'host', 'payment_window_closed',
        'The payment window closed',
        'This date was released because payment did not arrive in time. Paying now will be refunded.',
        jsonb_build_object('quote_id', v_row.quote_id, 'service_date', v_row.service_date),
        'payment_window_closed|' || v_row.id);
      perform app_private.notify(v_row.vendor_house_id, 'vendor', 'payment_window_closed',
        'A payment window closed',
        'A host did not pay in time, so this date is open again.',
        jsonb_build_object('quote_id', v_row.quote_id, 'service_date', v_row.service_date),
        'payment_window_closed|' || v_row.id);
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end $$;
revoke all on function app_private.apply_hold_release(uuid, uuid) from public;

create function public.release_lapsed_payment_holds()
returns integer
language sql
volatile
security definer
set search_path = ''
as $$ select app_private.apply_hold_release() $$;
comment on function public.release_lapsed_payment_holds() is
  'F-38: unscoped window sweep for the scheduler (F-72). Not callable by clients.';
revoke all on function public.release_lapsed_payment_holds() from public, anon, authenticated;
grant execute on function public.release_lapsed_payment_holds() to service_role;

-- ---------------------------------------------------------------------------
-- The server records a payment confirmation (F-48 wires the provider event to this)
-- ---------------------------------------------------------------------------
create function public.record_payment_confirmation(
  p_quote uuid, p_reference text, p_paid_minor bigint, p_paid_currency text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_quote     public.quotes;
  v_hold      public.quote_payment_holds;
  v_capacity  integer;
  v_row       public.quote_payment_holds;
  v_currency  text;
  v_reference text;
begin
  v_reference := trim(coalesce(p_reference, ''));
  if length(v_reference) not between 1 and 120 then
    raise exception 'payment_reference_required' using errcode = '22023';
  end if;
  if p_paid_minor is null or p_paid_minor < 1 then
    raise exception 'invalid_paid_amount' using errcode = '22023';
  end if;
  v_currency := upper(trim(coalesce(p_paid_currency, '')));

  select * into v_quote from public.quotes where id = p_quote;
  if not found then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  -- Every payment decision for this vendor is made one at a time, so two hosts confirming in the
  -- same instant cannot both take the date. A hold only exists for a sent quote, and sending an
  -- offer creates the availability row, so the lock is always on a real row.
  select a.daily_capacity into v_capacity from public.vendor_availability a
   where a.house_id = v_quote.vendor_house_id
   for update;
  if not found then
    raise exception 'availability_row_missing for house %', v_quote.vendor_house_id
      using errcode = 'P0002';
  end if;

  -- The deadline settles first: a window that has closed has already released the date (2(a)).
  perform app_private.apply_hold_release(null, p_quote);

  select * into v_hold from public.quote_payment_holds where quote_id = p_quote;
  if not found then
    raise exception 'hold_not_found: quote % has no payment window', p_quote using errcode = 'P0002';
  end if;
  if v_currency <> v_quote.currency then
    raise exception 'currency_mismatch: quote is in %', v_quote.currency using errcode = '22023';
  end if;

  if v_hold.status = 'confirmed' then
    if v_hold.payment_reference = v_reference then
      return 'confirmed';                       -- retry of the same payment changes nothing
    end if;
    raise exception 'payment_already_recorded' using errcode = '22023';
  end if;

  if v_hold.status = 'released' then
    -- Money for a date that is no longer this host's to win. It never re-grants the date.
    perform app_private.record_refund_obligation(v_hold, v_reference, p_paid_minor, v_currency);
    perform app_private.audit(null, 'payment.refund_obligation', 'quote_payment_holds', v_hold.id,
                              v_hold.vendor_house_id,
                              jsonb_build_object('service_date', v_hold.service_date,
                                                 'release_reason', v_hold.release_reason));
    perform app_private.notify(v_hold.host_house_id, 'host', 'refund_pending',
      'Payment received after the date was released',
      'You will be refunded. This date could not be kept for you.',
      jsonb_build_object('quote_id', v_hold.quote_id, 'service_date', v_hold.service_date),
      'refund_pending|' || v_hold.id);
    return 'refund_required';
  end if;

  -- awaiting_payment
  if app_private.confirmed_hold_count(v_quote.vendor_house_id, v_hold.service_date) >= v_capacity then
    -- Someone else's payment won the date first. This one is owed a refund, and the hold goes off
    -- the date so the vendor calendar stops showing it as a booking chance.
    perform app_private.release_hold(v_hold, 'outbid');
    perform app_private.record_refund_obligation(v_hold, v_reference, p_paid_minor, v_currency);
    perform app_private.audit(null, 'payment.outbid', 'quote_payment_holds', v_hold.id,
                              v_hold.vendor_house_id,
                              jsonb_build_object('service_date', v_hold.service_date));
    perform app_private.notify(v_hold.host_house_id, 'host', 'date_outbid',
      'Another host secured this date',
      'Their payment was confirmed first. You will be refunded.',
      jsonb_build_object('quote_id', v_hold.quote_id, 'service_date', v_hold.service_date),
      'date_outbid|' || v_hold.id);
    return 'refund_required';
  end if;

  update public.quote_payment_holds
     set status = 'confirmed', confirmed_at = now(), payment_reference = v_reference,
         paid_minor = p_paid_minor, paid_currency = v_currency
   where id = v_hold.id;

  perform app_private.audit(null, 'payment.confirmed', 'quote_payment_holds', v_hold.id,
                            v_hold.vendor_house_id,
                            jsonb_build_object('service_date', v_hold.service_date,
                                               'paid_currency', v_currency));
  perform app_private.notify(v_hold.host_house_id, 'host', 'date_secured',
    'Your date is confirmed',
    'Payment received. The vendor is keeping this date for you.',
    jsonb_build_object('quote_id', v_hold.quote_id, 'service_date', v_hold.service_date),
    'date_secured|' || v_hold.id);
  perform app_private.notify(v_hold.vendor_house_id, 'vendor', 'date_secured',
    'A host paid for this date',
    'This booking is paid and the date is now taken.',
    jsonb_build_object('quote_id', v_hold.quote_id, 'service_date', v_hold.service_date),
    'date_secured|' || v_hold.id);

  -- Once the date is full, hosts still holding it softly have lost it. They paid nothing, so
  -- nothing is owed to them — only the alert.
  if app_private.confirmed_hold_count(v_quote.vendor_house_id, v_hold.service_date) >= v_capacity then
    for v_row in
      select * from public.quote_payment_holds
      where vendor_house_id = v_quote.vendor_house_id
        and service_date = v_hold.service_date
        and status = 'awaiting_payment'
      order by created_at
    loop
      perform app_private.release_hold(v_row, 'outbid');
      perform app_private.notify(v_row.host_house_id, 'host', 'date_outbid',
        'Another host secured this date',
        'This vendor is fully booked on the date. Any payment you make now will be refunded.',
        jsonb_build_object('quote_id', v_row.quote_id, 'service_date', v_row.service_date),
        'date_outbid|' || v_row.id);
    end loop;
  end if;

  return 'confirmed';
end $$;
comment on function public.record_payment_confirmation(uuid, text, bigint, text) is
  'F-38: server-only payment fact. F-48 calls it from the verified Paystack charge.success path.';
revoke all on function public.record_payment_confirmation(uuid, text, bigint, text)
  from public, anon, authenticated;
-- Only the server role: no browser session, no JWT, no client key can record a payment.
grant execute on function public.record_payment_confirmation(uuid, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- Authorized projections
-- ---------------------------------------------------------------------------
create function public.my_date_holds(p_house uuid)
returns table (
  hold_id            uuid,
  quote_id           uuid,
  title              text,
  service_date       date,
  status             text,
  payment_due_at     timestamptz,
  confirmed_at       timestamptz,
  released_at        timestamptz,
  release_reason     text,
  lock_slot          integer,
  daily_capacity     integer,
  competing          boolean,
  is_vendor_side     boolean,
  counterparty_house uuid,
  counterparty_name  text,
  paid_minor         bigint,
  paid_currency      text,
  refund_minor       bigint,
  refund_currency    text,
  refund_reason      text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (app_private.member_can(p_house, 'calendar') or app_private.member_can(p_house, 'quotes')) then
    raise exception 'forbidden: calendar in house' using errcode = '42501';
  end if;
  perform app_private.apply_hold_release(p_house);

  return query
    select h.id, q.id, r.title, h.service_date, h.status, h.payment_due_at, h.confirmed_at,
           h.released_at, h.release_reason, l.slot,
           app_private.vendor_capacity(h.vendor_house_id),
           l.slot > app_private.vendor_capacity(h.vendor_house_id),
           h.vendor_house_id = p_house,
           case when h.vendor_house_id = p_house then h.host_house_id else h.vendor_house_id end,
           cp.display_name,
           h.paid_minor, h.paid_currency,
           o.refund_minor, o.currency, o.reason
    from public.quote_payment_holds h
    join public.quotes q on q.id = h.quote_id
    join public.quote_date_locks l on l.id = h.lock_id
    join public.houses cp on cp.id = (case when h.vendor_house_id = p_house
                                           then h.host_house_id else h.vendor_house_id end)
    left join public.quote_revisions r on r.quote_id = q.id and r.number = q.current_revision
    left join public.refund_obligations o on o.hold_id = h.id
    where q.vendor_house_id = p_house or q.host_house_id = p_house
    order by h.service_date desc, h.created_at desc;
end $$;
revoke all on function public.my_date_holds(uuid) from public, anon;
grant execute on function public.my_date_holds(uuid) to authenticated;

create function public.my_notifications(p_house uuid)
returns table (
  id         uuid,
  kind       text,
  title      text,
  body       text,
  payload    jsonb,
  read_at    timestamptz,
  created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app_private.is_active_member(p_house) then
    raise exception 'forbidden: not a member of this house' using errcode = '42501';
  end if;
  perform app_private.apply_hold_release(p_house);

  return query
    select n.id, n.kind, n.title, n.body, n.payload, n.read_at, n.created_at
    from public.notifications n
    where n.house_id = p_house
    order by n.created_at desc
    limit 50;
end $$;
revoke all on function public.my_notifications(uuid) from public, anon;
grant execute on function public.my_notifications(uuid) to authenticated;

create function public.mark_notification_read(p_notification uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.notifications;
begin
  select * into v_row from public.notifications where id = p_notification;
  if not found then
    raise exception 'notification_not_found' using errcode = 'P0002';
  end if;
  if not app_private.is_active_member(v_row.house_id) then
    raise exception 'forbidden: not a member of this house' using errcode = '42501';
  end if;

  update public.notifications set read_at = now() where id = p_notification and read_at is null;
end $$;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
