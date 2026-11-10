-- F-13 / F-20 / F-21 / F-48 / F-60: cancellation, saved card references, DVA, quote requests.
-- Includes docs/sql/2026-11-10-cancellation-tokens-dva.sql so one script applies everything.
-- F-20 Host Cancellation Policy, F-21 Vendor Cancellation Handling,
-- F-60 Paystack authorisation references, F-48 Dedicated Virtual Accounts.
-- Owner decisions 2026-11-10: funds stay in Paystack / platform pool accounts; host refund
-- >30 days 80%, 14-30 days 50%, <14 days 0%; vendor cancel 100%; DVA on first checkout;
-- refunds above 50,000,000 kobo (NGN 500,000) need two distinct finance approvals.

create function app_private.cancellation_refund_minor(p_by text, p_paid bigint, p_days integer)
returns bigint language sql immutable set search_path = '' as $$
  select (p_paid * case
    when p_by = 'vendor' then 100
    when p_days > 30 then 80
    when p_days >= 14 then 50
    else 0 end) / 100
$$;

create table public.booking_cancellations (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null unique references public.bookings (id) on delete cascade,
  cancelled_by       text not null check (cancelled_by in ('host', 'vendor')),
  actor_id           uuid not null,
  reason             text not null check (length(reason) between 3 and 500),
  days_before        integer not null,
  paid_minor         bigint not null check (paid_minor >= 0),
  refund_minor       bigint not null check (refund_minor >= 0 and refund_minor <= paid_minor),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  approvals_required smallint not null check (approvals_required in (0, 2)),
  first_approver     uuid,
  second_approver    uuid,
  status             text not null default 'awaiting_approval'
                     check (status in ('awaiting_approval', 'approved', 'refund_sent', 'no_refund')),
  paystack_refund_reference text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint cancellation_distinct_approvers check (
    first_approver is null or second_approver is null or first_approver <> second_approver)
);
grant select on public.booking_cancellations to authenticated;
grant all on public.booking_cancellations to service_role;
alter table public.booking_cancellations enable row level security;
create policy booking_cancellations_parties on public.booking_cancellations
  for select to authenticated using (exists (
    select 1 from public.bookings b where b.id = booking_id
      and (app_private.member_can(b.host_house_id, 'bookings')
           or app_private.member_can(b.vendor_house_id, 'bookings'))));
create policy booking_cancellations_finance on public.booking_cancellations
  for select to authenticated using (app_private.staff_grant_for('finance') is not null);

create function public.cancel_booking(p_booking uuid, p_reason text)
returns public.booking_cancellations
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_booking public.bookings;
  v_actor uuid := app_private.current_user_id();
  v_by text;
  v_paid bigint;
  v_days integer;
  v_refund bigint;
  v_row public.booking_cancellations;
begin
  select * into v_booking from public.bookings where id = p_booking for update;
  if not found then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;

  if app_private.member_can(v_booking.host_house_id, 'bookings') then v_by := 'host';
  elsif app_private.member_can(v_booking.vendor_house_id, 'bookings') then v_by := 'vendor';
  else raise exception 'forbidden: not a party to this booking' using errcode = '42501';
  end if;

  select * into v_row from public.booking_cancellations where booking_id = p_booking;
  if found then return v_row; end if;

  if v_booking.status not in ('awaiting_payment', 'paid') then
    raise exception 'booking_not_cancellable' using errcode = '22023';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_reason) then
    raise exception 'reason_rejected' using errcode = '22023';
  end if;
  if exists (select 1 from public.fund_pool where booking_id = p_booking and frozen) then
    raise exception 'fund_pool_frozen' using errcode = '22023';
  end if;

  select coalesce(sum(paid_minor), 0) into v_paid from public.fund_pool where booking_id = p_booking;
  v_days := v_booking.service_date - (now() at time zone 'utc')::date;
  v_refund := app_private.cancellation_refund_minor(v_by, v_paid, v_days);

  insert into public.booking_cancellations
    (booking_id, cancelled_by, actor_id, reason, days_before, paid_minor, refund_minor, currency,
     approvals_required, status)
  values (p_booking, v_by, v_actor, left(trim(p_reason), 500), v_days, v_paid, v_refund,
          v_booking.currency,
          case when v_refund > 50000000 then 2 else 0 end,
          case when v_refund = 0 then 'no_refund'
               when v_refund > 50000000 then 'awaiting_approval'
               else 'approved' end)
  returning * into v_row;

  update public.bookings set status = 'cancelled', cancelled_at = now() where id = p_booking;

  perform app_private.audit(v_actor, 'booking.cancelled', 'booking', p_booking,
    case when v_by = 'host' then v_booking.host_house_id else v_booking.vendor_house_id end,
    jsonb_build_object('by', v_by, 'days_before', v_days, 'refund_minor', v_refund));
  return v_row;
end $$;
revoke all on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

create function public.approve_cancellation_refund(p_cancellation uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_row public.booking_cancellations;
begin
  if v_actor is null or app_private.staff_grant_for('finance') is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_row from public.booking_cancellations where id = p_cancellation for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_row.status <> 'awaiting_approval' then return v_row.status; end if;
  if v_row.first_approver is null then
    update public.booking_cancellations set first_approver = v_actor, updated_at = now() where id = v_row.id;
    perform app_private.audit(v_actor, 'refund.first_approval', 'booking_cancellation', v_row.id, null, '{}'::jsonb);
    return 'awaiting_second_approval';
  end if;
  if v_row.first_approver = v_actor then
    raise exception 'second_approver_must_differ' using errcode = '42501';
  end if;
  update public.booking_cancellations
     set second_approver = v_actor, status = 'approved', updated_at = now() where id = v_row.id;
  perform app_private.audit(v_actor, 'refund.second_approval', 'booking_cancellation', v_row.id, null, '{}'::jsonb);
  return 'approved';
end $$;
revoke all on function public.approve_cancellation_refund(uuid) from public, anon;
grant execute on function public.approve_cancellation_refund(uuid) to authenticated;

-- F-60: Paystack reusable authorisation reference. Never a card number.
create table public.payment_authorizations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  authorization_code text not null unique check (authorization_code ~ '^AUTH_[A-Za-z0-9]+$'),
  card_brand         text,
  last4              text check (last4 ~ '^[0-9]{4}$'),
  exp_month          text check (exp_month ~ '^[0-9]{2}$'),
  exp_year           text check (exp_year ~ '^[0-9]{4}$'),
  reusable           boolean not null default false,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);
grant select (id, user_id, card_brand, last4, exp_month, exp_year, reusable, revoked_at, created_at)
  on public.payment_authorizations to authenticated;
grant all on public.payment_authorizations to service_role;
alter table public.payment_authorizations enable row level security;
create policy payment_authorizations_own on public.payment_authorizations
  for select to authenticated using (user_id = app_private.current_user_id());

-- F-48: one Paystack Dedicated Virtual Account per user, created on first checkout.
create table public.dedicated_accounts (
  user_id                uuid primary key,
  paystack_customer_code text not null,
  account_number         text not null check (account_number ~ '^[0-9]{10}$'),
  account_name           text not null,
  bank_name              text not null,
  currency               text not null default 'NGN',
  created_at             timestamptz not null default now()
);
grant select on public.dedicated_accounts to authenticated;
grant all on public.dedicated_accounts to service_role;
alter table public.dedicated_accounts enable row level security;
create policy dedicated_accounts_own on public.dedicated_accounts
  for select to authenticated using (user_id = app_private.current_user_id());

-- ---------------------------------------------------------------------------
-- F-60: the webhook saves a Paystack reusable authorisation reference. Service role only.
-- The card owner is the host house owner of the booking the charge belongs to.
-- ---------------------------------------------------------------------------
create function public.save_payment_authorization(
  p_booking uuid, p_code text, p_brand text, p_last4 text,
  p_exp_month text, p_exp_year text, p_reusable boolean)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid;
begin
  select h.owner_user_id into v_user
    from public.bookings b join public.houses h on h.id = b.host_house_id
   where b.id = p_booking;
  if v_user is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;
  insert into public.payment_authorizations
    (user_id, authorization_code, card_brand, last4, exp_month, exp_year, reusable)
  values (v_user, p_code, p_brand, p_last4, p_exp_month, p_exp_year, coalesce(p_reusable, false))
  on conflict (authorization_code) do nothing;
  return 'saved';
end $$;
revoke all on function public.save_payment_authorization(uuid, text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.save_payment_authorization(uuid, text, text, text, text, text, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- F-48: who is checking out, and their Dedicated Virtual Account if one exists.
-- ---------------------------------------------------------------------------
create function public.my_checkout_identity()
returns table (user_id uuid, email text, display_name text, has_account boolean,
               account_number text, account_name text, bank_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := app_private.current_user_id();
begin
  if v_actor is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  return query
    select u.id, coalesce(u.email, ''), coalesce(u.display_name, ''), d.user_id is not null,
           d.account_number, d.account_name, d.bank_name
      from public.users u left join public.dedicated_accounts d on d.user_id = u.id
     where u.id = v_actor;
end $$;
revoke all on function public.my_checkout_identity() from public, anon;
grant execute on function public.my_checkout_identity() to authenticated;

create function public.store_dedicated_account(
  p_user uuid, p_customer text, p_number text, p_name text, p_bank text)
returns text language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.dedicated_accounts
    (user_id, paystack_customer_code, account_number, account_name, bank_name)
  values (p_user, p_customer, p_number, p_name, p_bank)
  on conflict (user_id) do nothing;
  return 'stored';
end $$;
revoke all on function public.store_dedicated_account(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.store_dedicated_account(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- F-13: a host asks a vendor for a quote from the vendor's public page.
-- Only vendors author quotes; a request only carries the host's date, size, budget and notes.
-- ---------------------------------------------------------------------------
create table public.quote_requests (
  id              uuid primary key default gen_random_uuid(),
  host_house_id   uuid not null references public.houses (id),
  vendor_house_id uuid not null references public.houses (id),
  requested_by    uuid not null references public.users (id),
  service_date    date not null,
  guest_count     integer check (guest_count is null or guest_count between 1 and 100000),
  budget_minor    bigint check (budget_minor is null or budget_minor >= 0),
  currency        text not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  notes           text check (notes is null or length(notes) <= 1000),
  status          text not null default 'open' check (status in ('open', 'quoted', 'declined', 'withdrawn')),
  quote_id        uuid references public.quotes (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index quote_requests_vendor on public.quote_requests (vendor_house_id, status);
create index quote_requests_host on public.quote_requests (host_house_id, status);
revoke all on public.quote_requests from public, anon, authenticated;
grant all on public.quote_requests to service_role;
alter table public.quote_requests enable row level security;
alter table public.quote_requests force row level security;

create function public.request_quote(
  p_vendor_slug text, p_service_date date, p_guest_count integer,
  p_budget_minor bigint, p_notes text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor  uuid := app_private.current_user_id();
  v_slug   text := lower(btrim(coalesce(p_vendor_slug, '')));
  v_host   uuid;
  v_vendor uuid;
  v_id     uuid;
begin
  if v_actor is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if p_service_date is null or p_service_date <= (now() at time zone 'utc')::date then
    raise exception 'service_date_in_past' using errcode = '22023';
  end if;
  if p_notes is not null and app_private.looks_like_payment_credential(p_notes) then
    raise exception 'notes_rejected' using errcode = '22023';
  end if;

  select h.id into v_host from public.houses h
    join public.memberships m on m.house_id = h.id and m.user_id = v_actor and m.revoked_at is null
   where h.kind = 'host' and h.archived_at is null and app_private.member_can(h.id, 'quotes')
   limit 1;
  if v_host is null then raise exception 'forbidden: no host house' using errcode = '42501'; end if;

  select vp.house_id into v_vendor from public.vendor_profiles vp
    join public.houses h on h.id = vp.house_id and h.archived_at is null
   where vp.slug = v_slug and vp.published limit 1;
  if v_vendor is null then raise exception 'vendor_not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.houses where id = v_vendor and owner_user_id = v_actor) then
    raise exception 'forbidden: own vendor house' using errcode = '42501';
  end if;
  if (select count(*) from public.quote_requests
       where host_house_id = v_host and vendor_house_id = v_vendor and status = 'open') >= 3 then
    raise exception 'too_many_open_requests' using errcode = '22023';
  end if;

  insert into public.quote_requests
    (host_house_id, vendor_house_id, requested_by, service_date, guest_count, budget_minor, notes)
  values (v_host, v_vendor, v_actor, p_service_date, p_guest_count, p_budget_minor,
          nullif(left(btrim(coalesce(p_notes, '')), 1000), ''))
  returning id into v_id;

  -- The host and vendor keep one conversation; the request opens it if needed.
  insert into public.conversations (host_house_id, vendor_house_id, started_by)
  values (v_host, v_vendor, v_actor)
  on conflict (host_house_id, vendor_house_id) do nothing;

  perform app_private.audit(v_actor, 'quote_request.created', 'quote_requests', v_id, v_host,
                            jsonb_build_object('vendor_house_id', v_vendor));
  return v_id;
end $$;
revoke all on function public.request_quote(text, date, integer, bigint, text) from public, anon;
grant execute on function public.request_quote(text, date, integer, bigint, text) to authenticated;

create function public.my_quote_requests(p_house uuid)
returns table (request_id uuid, host_house_id uuid, vendor_house_id uuid, service_date date,
               guest_count integer, budget_minor bigint, currency text, notes text, status text,
               quote_id uuid, is_host_side boolean, counterparty_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.member_can(p_house, 'quotes') then
    raise exception 'forbidden: quotes' using errcode = '42501';
  end if;
  return query
    select r.id, r.host_house_id, r.vendor_house_id, r.service_date, r.guest_count,
           r.budget_minor, r.currency, r.notes, r.status, r.quote_id,
           r.host_house_id = p_house, cp.display_name, r.created_at
      from public.quote_requests r
      join public.houses cp on cp.id = case when r.host_house_id = p_house
                                            then r.vendor_house_id else r.host_house_id end
     where r.host_house_id = p_house or r.vendor_house_id = p_house
     order by r.created_at desc;
end $$;
revoke all on function public.my_quote_requests(uuid) from public, anon;
grant execute on function public.my_quote_requests(uuid) to authenticated;

-- The vendor marks a request quoted (with the quote it sent) or declined; the host withdraws.
create function public.respond_quote_request(p_request uuid, p_status text, p_quote uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_r public.quote_requests;
begin
  select * into v_r from public.quote_requests where id = p_request for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if v_r.status <> 'open' then return v_r.status; end if;
  if p_status in ('quoted', 'declined') then
    if not app_private.member_can(v_r.vendor_house_id, 'quotes') then
      raise exception 'forbidden: vendor only' using errcode = '42501';
    end if;
    if p_status = 'quoted' and not exists (
      select 1 from public.quotes q where q.id = p_quote
        and q.vendor_house_id = v_r.vendor_house_id and q.host_house_id = v_r.host_house_id) then
      raise exception 'quote_mismatch' using errcode = '22023';
    end if;
  elsif p_status = 'withdrawn' then
    if not app_private.member_can(v_r.host_house_id, 'quotes') then
      raise exception 'forbidden: host only' using errcode = '42501';
    end if;
  else
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.quote_requests
     set status = p_status, quote_id = case when p_status = 'quoted' then p_quote else null end,
         updated_at = now()
   where id = p_request;
  perform app_private.audit(v_actor, 'quote_request.' || p_status, 'quote_requests', p_request,
    case when p_status = 'withdrawn' then v_r.host_house_id else v_r.vendor_house_id end, '{}'::jsonb);
  return p_status;
end $$;
revoke all on function public.respond_quote_request(uuid, text, uuid) from public, anon;
grant execute on function public.respond_quote_request(uuid, text, uuid) to authenticated;
