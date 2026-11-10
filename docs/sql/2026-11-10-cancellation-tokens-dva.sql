-- Superseded: run docs/sql/2026-11-10-f13-booking-completion.sql instead (it contains this script plus F-13 quote requests).
-- Safe to rerun in the existing SQL editor after the F-102 fund pool script; existing rows are retained.
-- F-20 Host Cancellation Policy, F-21 Vendor Cancellation Handling,
-- F-60 Paystack authorisation references, F-48 Dedicated Virtual Accounts.
-- Owner decisions 2026-11-10: funds stay in Paystack / platform pool accounts; host refund
-- >30 days 80%, 14-30 days 50%, <14 days 0%; vendor cancel 100%; DVA on first checkout;
-- refunds above 50,000,000 kobo (NGN 500,000) need two distinct finance approvals.

-- Atomic installation: an error rolls back this run, without dropping tables or records.
begin;

create or replace function app_private.cancellation_refund_minor(p_by text, p_paid bigint, p_days integer)
returns bigint language sql immutable set search_path = '' as $$
  select (p_paid * case
    when p_by = 'vendor' then 100
    when p_days > 30 then 80
    when p_days >= 14 then 50
    else 0 end) / 100
$$;

create table if not exists public.booking_cancellations (
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
drop policy if exists booking_cancellations_parties on public.booking_cancellations;
create policy booking_cancellations_parties on public.booking_cancellations
  for select to authenticated using (exists (
    select 1 from public.bookings b where b.id = booking_id
      and (app_private.member_can(b.host_house_id, 'bookings')
           or app_private.member_can(b.vendor_house_id, 'bookings'))));
drop policy if exists booking_cancellations_finance on public.booking_cancellations;
create policy booking_cancellations_finance on public.booking_cancellations
  for select to authenticated using (app_private.staff_grant_for('finance') is not null);

create or replace function public.cancel_booking(p_booking uuid, p_reason text)
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

create or replace function public.approve_cancellation_refund(p_cancellation uuid)
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
create table if not exists public.payment_authorizations (
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
drop policy if exists payment_authorizations_own on public.payment_authorizations;
create policy payment_authorizations_own on public.payment_authorizations
  for select to authenticated using (user_id = app_private.current_user_id());

-- F-48: one Paystack Dedicated Virtual Account per user, created on first checkout.
create table if not exists public.dedicated_accounts (
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
drop policy if exists dedicated_accounts_own on public.dedicated_accounts;
create policy dedicated_accounts_own on public.dedicated_accounts
  for select to authenticated using (user_id = app_private.current_user_id());


commit;
