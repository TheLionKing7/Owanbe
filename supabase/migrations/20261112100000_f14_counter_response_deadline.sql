-- F-14 counter-response deadline
--
-- The F-14 spec asks "What stops a vendor from ignoring a counter-offer?" and answers it with a
-- deadline: when a host counters, the vendor has 24 hours to revise or decline. If that window
-- closes, the quote expires, the date lock is released, and the host is free to look elsewhere.
--
-- Before this file a counter left `expires_at` alone, so a counter changed nothing about when the
-- offer died: the vendor's original 24 hours simply kept running and a host who countered could be
-- answered by an expiry instead of by a decision.
--
-- Invariants this file owns:
--   * a counter starts a vendor response deadline, measured on the server (now() + 24 hours)
--   * while a quote is 'countered', that deadline is the one that expires it: the original send
--     deadline stops governing the moment the host counters
--   * the vendor's re-send after a counter clears the counter deadline and restarts the 24-hour
--     offer deadline
--   * expiry releases the date lock and records why it happened
--   * the deadline lives on the quote row; the UI renders it, it never owns it
--
-- Money is not touched here: an expiry releases a calendar hold, it moves no funds.

-- ---------------------------------------------------------------------------
-- The column and the fixed window
-- ---------------------------------------------------------------------------
alter table public.quotes add column counter_response_due_at timestamptz;
comment on column public.quotes.counter_response_due_at is
  'F-14: when a host counters, the vendor has until this moment to revise or decline.';

-- Fixed 24 hours, like the offer deadline it sits beside. No per-vendor override exists.
create function app_private.quote_counter_response_interval()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '24 hours' $$;
revoke all on function app_private.quote_counter_response_interval() from public;

-- A quote that was already countered when this file landed gets a fresh window: the moment it was
-- countered is recorded nowhere, so the migration time is the only honest place to start from.
update public.quotes
   set counter_response_due_at = now() + app_private.quote_counter_response_interval()
 where status = 'countered' and counter_response_due_at is null;

-- ---------------------------------------------------------------------------
-- The state shape now says which deadline governs a quote
-- ---------------------------------------------------------------------------
alter table public.quotes drop constraint quotes_state_shape;
alter table public.quotes add constraint quotes_state_shape check (
  -- a draft has no clock at all
  (status = 'draft' and sent_at is null and expires_at is null and decided_at is null
      and counter_response_due_at is null)
  -- a sent offer waits for the host, on the deadline the send set
  or (status = 'sent' and sent_at is not null and expires_at is not null
      and decided_at is null and expires_at > sent_at
      and counter_response_due_at is null)
  -- a counter waits for the vendor, on the deadline the counter set
  or (status = 'countered' and sent_at is not null and expires_at is not null
      and decided_at is null and expires_at > sent_at
      and counter_response_due_at is not null and counter_response_due_at > sent_at)
  or (status in ('accepted','declined','expired') and sent_at is not null
      and expires_at is not null and decided_at is not null)
  -- a draft can be withdrawn before it was ever sent, so it has no deadline yet
  or (status = 'cancelled' and decided_at is not null)
);
comment on constraint quotes_state_shape on public.quotes is
  'F-14: which deadline governs a quote. A countered quote waits on the vendor response deadline.';

-- The sweep reads the open quotes by the deadline that ends them.
create index quotes_open_counter_response_idx on public.quotes (counter_response_due_at)
  where status = 'countered';

-- The host has to learn that the vendor ignored them. Without this the expiry is invisible: the
-- quote simply stops being open, and it reads like any other expired offer.
--
-- The kind check was written inline by F-38, so its name is Postgres' default for the column
-- check. The drop is guarded because that file may have been applied by hand against a database
-- where the constraint carries another name.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'notifications_kind_check'
       and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications drop constraint notifications_kind_check;
  end if;
end $$;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('date_competing', 'date_secured', 'date_outbid',
                   'payment_window_closed', 'refund_pending', 'counter_ignored'));
comment on constraint notifications_kind_check on public.notifications is
  'F-14: counter_ignored is the house alert for a counter the vendor never answered.';

-- ---------------------------------------------------------------------------
-- Expiry: the deadline decides, not the caller
-- ---------------------------------------------------------------------------
-- Scoped on purpose: a read sweeps only the caller's house (or one quote), so no request can
-- rewrite another house's rows and no read scans the whole table. The scheduler (F-72) runs the
-- unscoped sweep through expire_due_quotes() with the service role.
--
-- A countered quote is judged on the vendor response deadline, not on the deadline the send set:
-- the host's counter is a fresh question, so the vendor gets a fresh window to answer it.
create or replace function app_private.apply_expiry(p_house uuid default null, p_quote uuid default null)
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
    select q.id, q.vendor_house_id, q.host_house_id, q.service_date, q.status
    from public.quotes q
    where q.status in ('sent', 'countered')
      and case when q.status = 'countered'
               then q.counter_response_due_at is not null and q.counter_response_due_at <= now()
               else q.expires_at <= now()
               end
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
                                jsonb_build_object(
                                  'reason', case when v_row.status = 'countered'
                                                then 'vendor_response_overdue'
                                                else 'deadline_passed' end,
                                  'countered', v_row.status = 'countered'));
      -- The host is told their counter went unanswered and the date is free again. Identifiers
      -- only: no amounts, no offer contents, in the house's own words.
      if v_row.status = 'countered' then
        perform app_private.notify(v_row.host_house_id, 'host', 'counter_ignored',
          'The vendor did not answer your counter',
          'Your counter went unanswered, so the offer expired and the date is free again. You can '
          'ask the vendor for a new quote, or look for another vendor for this date.',
          jsonb_build_object('quote_id', v_row.id, 'service_date', v_row.service_date),
          'counter_ignored|' || v_row.id);
      end if;
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;
revoke all on function app_private.apply_expiry(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- The host's counter starts the clock; the vendor's re-send ends it
-- ---------------------------------------------------------------------------
-- A counter is the host's words, not a rewritten offer: the vendor must revise and re-send, which
-- is what restarts the offer deadline. The offer deadline itself is left alone on purpose — a host
-- cannot extend a vendor's offer by countering — but the counter starts its own vendor deadline.
create or replace function public.counter_quote(p_quote uuid, p_expected_version integer, p_message text)
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

  update public.quotes
     set status = 'countered',
         current_revision = v_number,
         counter_response_due_at = now() + app_private.quote_counter_response_interval()
   where id = p_quote;
  perform app_private.audit(v_actor, 'quote.countered', 'quotes', p_quote, v_q.host_house_id,
                            jsonb_build_object('revision', v_number));
end;
$$;
revoke all on function public.counter_quote(uuid, integer, text) from public, anon;
grant execute on function public.counter_quote(uuid, integer, text) to authenticated;

-- Sending locks the date: one slot per sent quote, taken under a row lock on the vendor's
-- availability so two concurrent sends cannot claim the same slot. The re-send after a counter
-- ends the vendor response deadline and starts the 24-hour offer deadline again.
create or replace function public.send_quote(p_quote uuid, p_expected_version integer)
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
         counter_response_due_at = null,
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

-- ---------------------------------------------------------------------------
-- The projection carries the deadline the UI renders
-- ---------------------------------------------------------------------------
drop function public.my_quotes(uuid);

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
  counter_response_due_at timestamptz,
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
           q.sent_at, q.expires_at, q.counter_response_due_at, q.decided_at, q.close_note, q.version,
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
