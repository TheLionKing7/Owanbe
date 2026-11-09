-- F-102 Fund pool/escrow
-- The ledger and the allocation of a booking's money: 70% is released to the vendor when the
-- booking is confirmed, the remaining 30% when the host confirms the celebration happened or when
-- the completion window closes with no dispute, and an open dispute freezes the release.
--
-- Owner decisions (2026-11-08, this build):
--   * Paystack is the payment rail. The platform never holds the money itself: the host pays
--     Paystack, the ledger records what Paystack holds and what is owed, and the payout to the
--     vendor stays with F-47/F-30 (verified recipient, 48-hour lock, second approval).
--   * The platform commission is 2.5% of each released tranche. The tax rate and its base are not
--     decided yet, so the tax line is 0 basis points until the owner sets it.
--   * The table names are both kept: the tracker's fund_pool and wallet_ledger, and the double
--     entry core of the owner's compliance spec (ledger_accounts, journal_entries, postings).
--   * A dispute freezes a pool through a flag that only a staff member with an active arbitrator
--     grant may set; F-16 attaches its case model to the same flag later.
--
-- Invariants this file owns:
--   * every naira moves through a double-entry ledger: each journal entry's postings sum to zero per
--     currency, checked by a deferred constraint trigger, so an unbalanced entry cannot commit
--   * the ledger is append-only: a correction is a reversing entry, never an edit
--   * every step is keyed (booking:<id>:<step>), so a retried webhook cannot post or release twice
--   * the browser never writes: every write goes through a security definer function, and the
--     money functions are granted to the server role only
--   * a release is refused while the pool is frozen, and the completion clock stops while frozen
--   * money is bigint minor units with an ISO-4217 currency; no float, numeric or money types
--
-- The escrow records money Paystack holds. It is not a claim that the platform is licensed to hold
-- funds: that question is Q10 in docs/open-questions.md and stays open. No ledger table may be
-- added for balances or transaction records until the owner answers it.
--
-- Depends on 20261104120000_f14_quotes.sql (quotes), 20261104160000_f38_vendor_calendar_soft_hold.sql
-- (the accepted quote's hold) and 20261105120000_f60_payment_data_protection.sql (the credential
-- guards). Acceptance criteria:
-- docs/journal/2026-11-09-F-102-fund-pool-escrow.md

-- ---------------------------------------------------------------------------
-- The platform's payment settings: one row, owned by the owner
-- ---------------------------------------------------------------------------
-- The commission is here rather than in code so a rate change needs no migration. The tax rate is
-- 0 until the owner decides the rate and the base, so no tax is invented. The large-amount
-- threshold stays null: F-47 owns the second approver and "large" is not defined yet.
create table app_private.payment_settings (
  id                            boolean primary key default true check (id),
  commission_bps                integer not null default 250 check (commission_bps between 0 and 10000),
  tax_bps                       integer not null default 0 check (tax_bps between 0 and 10000),
  tax_base                      text not null default 'commission' check (tax_base in ('commission', 'gross')),
  completion_window_hours       integer not null default 24 check (completion_window_hours between 1 and 168),
  payments_paused               boolean not null default false,
  large_amount_threshold_minor  bigint check (large_amount_threshold_minor is null or large_amount_threshold_minor > 0),
  updated_at                    timestamptz not null default now()
);
comment on table app_private.payment_settings is
  'F-102: the platform''s payment rules. One row. The commission is 2.5%; the tax is 0 until set.';
insert into app_private.payment_settings (id) values (true);
revoke all on app_private.payment_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The double-entry core (the owner's compliance spec, step 3)
-- ---------------------------------------------------------------------------
create table public.ledger_accounts (
  id           uuid primary key default gen_random_uuid(),
  code         text not null check (length(code) between 1 and 120),
  owner_kind   text not null check (owner_kind in ('platform', 'user', 'house', 'booking')),
  owner_id     uuid,
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  normal_side  text not null check (normal_side in ('debit', 'credit')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);
comment on table public.ledger_accounts is
  'F-102: one account per code, owner and currency. Platform: paystack_clearing, processor_fees, platform_fees, refunds_payable, tax_payable. Owned: escrow (a booking), vendor_payable (a house), user_wallet (a person).';
-- owner_id is null for platform accounts, and a plain unique constraint would let a null repeat,
-- so the null is folded into the index instead.
create unique index ledger_accounts_identity_idx
  on public.ledger_accounts (code, owner_kind, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), currency);
create trigger ledger_accounts_touch before update on public.ledger_accounts
  for each row execute function app_private.touch();

create table public.journal_entries (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique check (length(idempotency_key) between 1 and 200),
  kind             text not null check (kind in ('booking_hold', 'release_70', 'release_30', 'fee',
                                                  'refund', 'reversal', 'payout')),
  reverses_id      uuid references public.journal_entries (id) on delete restrict,
  booking_id       uuid,
  actor            text not null check (length(actor) between 1 and 120),
  memo             text check (memo is null or length(memo) <= 200),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  -- F-60: a free-text column a person can type into carries the credential guard.
  constraint journal_entries_memo_no_credentials check (
    memo is null or not app_private.looks_like_payment_credential(memo)
  )
);
comment on table public.journal_entries is
  'F-102: one ledger entry per step, keyed so a replay cannot post twice.';
create index journal_entries_booking_idx on public.journal_entries (booking_id, created_at desc);

create table public.postings (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.journal_entries (id) on delete cascade,
  -- named ledger_account_id, not account_id: the credential guard reserves 'account_*' for
  -- bank account numbers, and this column holds the row id of a ledger account.
  ledger_account_id uuid not null references public.ledger_accounts (id) on delete restrict,
  amount_minor bigint not null check (amount_minor <> 0),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1
);
comment on table public.postings is
  'F-102: the lines of a journal entry. Positive is a debit, negative is a credit.';
create index postings_ledger_account_idx on public.postings (ledger_account_id);
create index postings_entry_idx on public.postings (entry_id);

-- The entries are financial records: a correction is a reversing entry, never an edit.
create trigger journal_entries_append_only
  before update or delete or truncate on public.journal_entries
  for each statement execute function app_private.forbid_change();
create trigger postings_append_only
  before update or delete or truncate on public.postings
  for each statement execute function app_private.forbid_change();

-- Every entry balances per currency. The check is deferred to the end of the transaction, so a
-- function can post its lines and the entry is judged as a whole.
create function app_private.assert_entry_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.postings p
     where p.entry_id = new.entry_id
     group by p.currency
    having sum(p.amount_minor) <> 0
  ) then
    raise exception 'unbalanced_entry %', new.entry_id using errcode = '23514';
  end if;
  return null;
end $$;
revoke all on function app_private.assert_entry_balanced() from public;
create constraint trigger postings_balanced
  after insert on public.postings
  deferrable initially deferred
  for each row execute function app_private.assert_entry_balanced();

-- Balances, credit-normal accounts shown positive.
create view app_private.account_balances as
  select a.id, a.code, a.owner_kind, a.owner_id, a.currency,
         coalesce(sum(p.amount_minor), 0)
           * case a.normal_side when 'debit' then 1 else -1 end as balance_minor
    from public.ledger_accounts a
    left join public.postings p on p.ledger_account_id = a.id
   group by a.id;
revoke all on app_private.account_balances from public, anon, authenticated;

-- Resolve an account code to its account, creating it the first time it is used.
-- 'escrow:<booking>' belongs to a booking, 'vendor_payable:<house>' to a house,
-- 'user_wallet:<user>' to a user, and the rest to the platform.
create function app_private.ledger_account(p_code text, p_currency text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_base       text;
  v_owner_id   uuid;
  v_owner_kind text;
  v_account    uuid;
  v_tail       text;
begin
  if p_code is null or length(btrim(p_code)) not between 1 and 120 then
    raise exception 'invalid_account_code' using errcode = '22023';
  end if;
  v_base := split_part(btrim(p_code), ':', 1);
  if position(':' in btrim(p_code)) > 0 then
    v_tail := split_part(btrim(p_code), ':', 2);
    if v_tail !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_account_code' using errcode = '22023';
    end if;
    v_owner_id := v_tail::uuid;
  end if;
  v_owner_kind := case
    when v_base = 'escrow' then 'booking'
    when v_base = 'vendor_payable' then 'house'
    when v_base = 'user_wallet' then 'user'
    else 'platform'
  end;
  if v_owner_kind <> 'platform' and v_owner_id is null then
    raise exception 'invalid_account_code' using errcode = '22023';
  end if;

  insert into public.ledger_accounts (code, owner_kind, owner_id, currency, normal_side)
  values (v_base, v_owner_kind, v_owner_id, upper(p_currency),
          case when v_base in ('paystack_clearing', 'processor_fees') then 'debit' else 'credit' end)
  on conflict do nothing;

  select a.id into v_account
    from public.ledger_accounts a
   where a.code = v_base
     and a.owner_kind = v_owner_kind
     and a.owner_id is not distinct from v_owner_id
     and a.currency = upper(p_currency);
  return v_account;
end $$;
revoke all on function app_private.ledger_account(text, text) from public;

-- The only write path into the ledger: one call, one balanced entry, idempotent.
create function app_private.post_entry(
  p_key text, p_kind text, p_actor text, p_booking uuid, p_lines jsonb, p_reverses uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_line   jsonb;
  v_amount bigint;
begin
  if p_key is null or length(btrim(p_key)) not between 1 and 200 then
    raise exception 'idempotency_key_required' using errcode = '22023';
  end if;

  insert into public.journal_entries (idempotency_key, kind, actor, booking_id, reverses_id)
  values (btrim(p_key), p_kind, p_actor, p_booking, p_reverses)
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- A replay of a step that already posted: return the original entry, post nothing.
    select e.id into v_id from public.journal_entries e where e.idempotency_key = btrim(p_key);
    return v_id;
  end if;

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'invalid_posting_line' using errcode = '22023';
    end if;
    v_amount := (v_line ->> 'amount_minor')::bigint;
    if v_amount is null or v_amount = 0 then
      raise exception 'invalid_posting_amount' using errcode = '22023';
    end if;
    insert into public.postings (entry_id, ledger_account_id, amount_minor, currency)
    values (v_id,
            app_private.ledger_account(v_line ->> 'account', v_line ->> 'currency'),
            v_amount,
            upper(v_line ->> 'currency'));
  end loop;

  return v_id;
end $$;
comment on function app_private.post_entry(text, text, text, uuid, jsonb, uuid) is
  'F-102: the only write path into the ledger. One call posts one balanced entry, exactly once.';
revoke all on function app_private.post_entry(text, text, text, uuid, jsonb, uuid)
  from public, anon, authenticated;

-- Build the lines of an entry, dropping the lines that would be zero. A zero-amount posting is
-- refused by the postings table, and a rate of 0 must not stop a release.
create function app_private.entry_lines(p_lines jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(l), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
   where (l ->> 'amount_minor')::bigint is distinct from 0
$$;
revoke all on function app_private.entry_lines(jsonb) from public;

-- ---------------------------------------------------------------------------
-- The booking: what is being paid for
-- ---------------------------------------------------------------------------
-- F-13 (Direct Search & Book Flow) owns the booking flow and is not built. This is the minimum
-- F-102 needs: the accepted quote becomes a booking, and the booking is what the money is for.
create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null unique references public.quotes (id) on delete cascade,
  host_house_id     uuid not null,
  host_house_kind   text not null default 'host' check (host_house_kind = 'host'),
  vendor_house_id   uuid not null,
  vendor_house_kind text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  service_date      date not null,
  total_minor       bigint not null check (total_minor > 0),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  status            text not null default 'awaiting_payment'
                    check (status in ('awaiting_payment', 'paid', 'completed', 'cancelled', 'refunded')),
  confirmed_at      timestamptz,
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (host_house_id, host_house_kind) references public.houses (id, kind) on delete cascade,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  constraint bookings_two_distinct_houses check (host_house_id <> vendor_house_id),
  constraint bookings_state_shape check (
    (status = 'awaiting_payment' and confirmed_at is null and completed_at is null and cancelled_at is null)
    or (status = 'paid' and confirmed_at is not null and completed_at is null and cancelled_at is null)
    or (status = 'completed' and confirmed_at is not null and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (status = 'refunded' and confirmed_at is not null and cancelled_at is null)
  )
);
comment on table public.bookings is
  'F-102: what a host booked from a vendor. Created when the quote is accepted.';
create index bookings_host_idx on public.bookings (host_house_id, service_date desc);
create index bookings_vendor_idx on public.bookings (vendor_house_id, service_date desc);
create trigger bookings_touch before update on public.bookings
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- The fund pool: the money for one booking, and where it stands
-- ---------------------------------------------------------------------------
create table public.fund_pool (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null unique references public.bookings (id) on delete cascade,
  host_house_id      uuid not null,
  host_house_kind    text not null default 'host' check (host_house_kind = 'host'),
  vendor_house_id    uuid not null,
  vendor_house_kind  text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor        bigint not null check (total_minor > 0),
  paid_minor         bigint not null default 0 check (paid_minor >= 0),
  held_minor         bigint not null default 0 check (held_minor >= 0),
  released_70_minor  bigint not null default 0 check (released_70_minor >= 0),
  released_30_minor  bigint not null default 0 check (released_30_minor >= 0),
  commission_minor   bigint not null default 0 check (commission_minor >= 0),
  tax_minor          bigint not null default 0 check (tax_minor >= 0),
  vendor_net_minor   bigint not null default 0 check (vendor_net_minor >= 0),
  refunded_minor     bigint not null default 0 check (refunded_minor >= 0),
  status             text not null default 'awaiting_payment'
                     check (status in ('awaiting_payment', 'held', 'partially_released', 'released',
                                       'refund_pending', 'refunded')),
  payment_reference  text,
  paid_at            timestamptz,
  -- the server's deadline for the remaining 30%: the host's window to raise a problem
  release_30_due_at  timestamptz,
  completed_at       timestamptz,
  refunded_at        timestamptz,
  -- a dispute freezes the release; only a staff arbitrator may set it
  frozen             boolean not null default false,
  frozen_at          timestamptz,
  frozen_reason      text check (frozen_reason is null or length(frozen_reason) <= 200),
  frozen_by          uuid references public.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  foreign key (host_house_id, host_house_kind) references public.houses (id, kind) on delete cascade,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  -- the money is somewhere and somewhere only
  constraint fund_pool_balances check (
    held_minor + released_70_minor + released_30_minor + refunded_minor = paid_minor
  ),
  constraint fund_pool_state_shape check (
    (status = 'awaiting_payment' and paid_minor = 0 and refunded_minor = 0)
    or (status = 'held' and paid_minor > 0 and released_70_minor = 0 and refunded_minor = 0)
    or (status = 'partially_released' and released_70_minor > 0 and released_30_minor = 0
        and refunded_minor = 0)
    or (status = 'released' and released_30_minor > 0 and refunded_minor = 0)
    or (status in ('refund_pending', 'refunded') and refunded_minor > 0 and held_minor = 0)
  ),
  -- F-60: a free-text column a person can type into carries the credential guard.
  constraint fund_pool_reference_no_credentials check (
    payment_reference is null or not app_private.looks_like_payment_credential(payment_reference)
  ),
  constraint fund_pool_frozen_reason_no_credentials check (
    frozen_reason is null or not app_private.looks_like_payment_credential(frozen_reason)
  )
);
comment on table public.fund_pool is
  'F-102: the money for one booking and where it stands: held in escrow, released in two tranches, or refunded.';
create index fund_pool_due_idx on public.fund_pool (release_30_due_at)
  where released_70_minor > 0 and released_30_minor = 0 and frozen = false;
create index fund_pool_host_idx on public.fund_pool (host_house_id, created_at desc);
create index fund_pool_vendor_idx on public.fund_pool (vendor_house_id, created_at desc);
create trigger fund_pool_touch before update on public.fund_pool
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- The wallet ledger: the pool-scoped movement log
-- ---------------------------------------------------------------------------
-- The double-entry ledger above is the accounting truth; this is the readable trail of what moved
-- for one booking. It is append-only, so a movement is never edited away.
create table public.wallet_ledger (
  id               uuid primary key default gen_random_uuid(),
  pool_id          uuid not null references public.fund_pool (id) on delete restrict,
  booking_id       uuid not null references public.bookings (id) on delete restrict,
  entry_id         uuid references public.journal_entries (id) on delete restrict,
  movement         text not null check (movement in ('booking_hold', 'release_70', 'release_30', 'fee',
                                                     'refund', 'refund_settled', 'payout')),
  direction        text not null check (direction in ('in', 'out')),
  amount_minor     bigint not null check (amount_minor > 0),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  idempotency_key  text not null unique check (length(idempotency_key) between 1 and 200),
  reference        text,
  memo             text check (memo is null or length(memo) <= 200),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  constraint wallet_ledger_reference_no_credentials check (
    reference is null or not app_private.looks_like_payment_credential(reference)
  ),
  constraint wallet_ledger_memo_no_credentials check (
    memo is null or not app_private.looks_like_payment_credential(memo)
  )
);
comment on table public.wallet_ledger is
  'F-102: the append-only trail of money moving for one booking.';
create index wallet_ledger_booking_idx on public.wallet_ledger (booking_id, created_at desc);
create trigger wallet_ledger_touch before update on public.wallet_ledger
  for each row execute function app_private.touch();
create trigger wallet_ledger_append_only
  before update or delete or truncate on public.wallet_ledger
  for each statement execute function app_private.forbid_change();

-- ---------------------------------------------------------------------------
-- Provider events: the webhook's own idempotency
-- ---------------------------------------------------------------------------
create table public.payment_events (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null default 'paystack' check (provider = 'paystack'),
  event_type     text not null check (event_type in ('charge.success', 'refund.processed', 'charge.failed')),
  reference      text not null check (length(reference) between 1 and 120),
  booking_id     uuid references public.bookings (id) on delete set null,
  amount_minor   bigint check (amount_minor is null or amount_minor >= 0),
  currency       text check (currency is null or currency ~ '^[A-Z]{3}$'),
  payload        jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  outcome        text check (outcome in ('allocated', 'refund_required', 'settled', 'ignored', 'duplicate')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,
  -- the same reference can be both a charge and a refund, so the pair is what is unique
  unique (event_type, reference),
  constraint payment_events_payload_no_credentials check (
    not app_private.jsonb_has_payment_credential(payload)
  ),
  constraint payment_events_reference_no_credentials check (
    not app_private.looks_like_payment_credential(reference)
  )
);
comment on table public.payment_events is
  'F-102: one row per provider event, so a retried webhook is recognised and changes nothing.';
create index payment_events_booking_idx on public.payment_events (booking_id, created_at desc);
create trigger payment_events_touch before update on public.payment_events
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- The alerts F-102 needs on top of F-38's
-- ---------------------------------------------------------------------------
alter table public.notifications
  drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in
    ('date_competing', 'date_secured', 'date_outbid', 'payment_window_closed', 'refund_pending',
     'fund_released', 'fund_frozen', 'fund_refunded'));

-- ---------------------------------------------------------------------------
-- The acceptance creates the booking and its pool
-- ---------------------------------------------------------------------------
-- A trigger, so no path can accept a quote without a booking to pay for.
create function app_private.on_quote_accepted_booking()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  if new.current_revision < 1 then
    raise exception 'accepted_quote_needs_an_offer' using errcode = '22023';
  end if;

  insert into public.bookings
    (quote_id, host_house_id, host_house_kind, vendor_house_id, vendor_house_kind,
     service_date, total_minor, currency)
  values (new.id, new.host_house_id, 'host', new.vendor_house_id, 'vendor',
          new.service_date, new.total_minor, new.currency)
  on conflict (quote_id) do nothing;

  select * into v_booking from public.bookings where quote_id = new.id;

  insert into public.fund_pool
    (booking_id, host_house_id, host_house_kind, vendor_house_id, vendor_house_kind,
     currency, total_minor)
  values (v_booking.id, v_booking.host_house_id, 'host', v_booking.vendor_house_id, 'vendor',
          v_booking.currency, v_booking.total_minor)
  on conflict (booking_id) do nothing;

  perform app_private.audit(null, 'booking.created', 'bookings', v_booking.id,
                            v_booking.host_house_id,
                            jsonb_build_object('service_date', v_booking.service_date,
                                               'total_minor', v_booking.total_minor,
                                               'currency', v_booking.currency));
  return new;
end $$;
revoke all on function app_private.on_quote_accepted_booking() from public;
create trigger quotes_accepted_booking
  after update on public.quotes
  for each row when (new.status = 'accepted' and old.status is distinct from 'accepted')
  execute function app_private.on_quote_accepted_booking();

-- ---------------------------------------------------------------------------
-- The shares: 70% now, 30% after
-- ---------------------------------------------------------------------------
-- The 70/30 split is integer arithmetic, so the remainder of the rounding goes to the 30%, and
-- the commission is taken from what the vendor is owed, never added on top.
create function app_private.tranche_split(p_total bigint)
returns table (release_70 bigint, release_30 bigint)
language sql
immutable
set search_path = ''
as $$
  select (p_total * 70) / 100, p_total - ((p_total * 70) / 100)
$$;
revoke all on function app_private.tranche_split(bigint) from public;

-- What the platform takes off a tranche, and what the vendor keeps.
create function app_private.tranche_fees(p_gross bigint, p_settings app_private.payment_settings)
returns table (commission bigint, tax bigint, vendor_net bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_commission bigint;
  v_tax       bigint;
begin
  v_commission := (p_gross * p_settings.commission_bps) / 10000;
  if p_settings.tax_base = 'commission' then
    v_tax := (v_commission * p_settings.tax_bps) / 10000;
  else
    v_tax := (p_gross * p_settings.tax_bps) / 10000;
  end if;
  return query select v_commission, v_tax, p_gross - v_commission - v_tax;
end $$;
revoke all on function app_private.tranche_fees(bigint, app_private.payment_settings) from public;

-- ---------------------------------------------------------------------------
-- Releasing a tranche
-- ---------------------------------------------------------------------------
-- 'released' | 'already_released' | 'frozen' | 'not_due'. The function never raises for a frozen or
-- a not-yet-due pool: the sweep calls it for every pool in turn, and one frozen pool must not stop
-- the others from being released.
create function app_private.release_tranche(
  p_booking uuid, p_tranche text, p_actor text, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pool      public.fund_pool;
  v_settings  app_private.payment_settings;
  v_gross     bigint;
  v_commission bigint;
  v_tax       bigint;
  v_net       bigint;
  v_entry     uuid;
  v_key       text;
  v_escrow    text;
begin
  if p_tranche not in ('70', '30') then
    raise exception 'unknown_tranche' using errcode = '22023';
  end if;

  select * into v_settings from app_private.payment_settings where id;
  select * into v_pool from public.fund_pool where booking_id = p_booking for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;
  if v_pool.frozen then
    return 'frozen';
  end if;
  if v_pool.paid_minor = 0 then
    raise exception 'nothing_paid' using errcode = '22023';
  end if;

  v_escrow := 'escrow:' || v_pool.booking_id::text;

  if p_tranche = '70' then
    if v_pool.released_70_minor > 0 then
      return 'already_released';
    end if;
    v_gross := (v_pool.total_minor * 70) / 100;
    v_key := 'booking:' || v_pool.booking_id::text || ':release_70';
  else
    if v_pool.released_30_minor > 0 then
      return 'already_released';
    end if;
    if v_pool.released_70_minor = 0 then
      raise exception 'first_tranche_not_released' using errcode = '22023';
    end if;
    -- The completion window is the host's chance to raise a problem. The host confirming is
    -- enough on its own; otherwise the deadline decides.
    if p_reason <> 'completed'
       and (v_pool.release_30_due_at is null or v_pool.release_30_due_at > now()) then
      return 'not_due';
    end if;
    v_gross := v_pool.total_minor - ((v_pool.total_minor * 70) / 100);
    v_key := 'booking:' || v_pool.booking_id::text || ':release_30';
  end if;

  select f.commission, f.tax, f.vendor_net into v_commission, v_tax, v_net
    from app_private.tranche_fees(v_gross, v_settings) f;

  v_entry := app_private.post_entry(v_key,
    case p_tranche when '70' then 'release_70' else 'release_30' end,
    p_actor, v_pool.booking_id,
    app_private.entry_lines(jsonb_build_array(
      jsonb_build_object('account', v_escrow, 'amount_minor', v_gross, 'currency', v_pool.currency),
      jsonb_build_object('account', 'vendor_payable:' || v_pool.vendor_house_id::text,
                         'amount_minor', -v_net, 'currency', v_pool.currency),
      jsonb_build_object('account', 'platform_fees',
                         'amount_minor', -v_commission, 'currency', v_pool.currency),
      jsonb_build_object('account', 'tax_payable',
                         'amount_minor', -v_tax, 'currency', v_pool.currency)
    )));

  insert into public.wallet_ledger
    (pool_id, booking_id, entry_id, movement, direction, amount_minor, currency,
     idempotency_key, reference, memo)
  values (v_pool.id, v_pool.booking_id, v_entry,
          case p_tranche when '70' then 'release_70' else 'release_30' end,
          'out', v_gross, v_pool.currency, v_key, v_pool.payment_reference,
          case p_tranche when '70' then 'First release to the vendor' else 'Final release to the vendor' end)
  on conflict (idempotency_key) do nothing;

  update public.fund_pool
     set released_70_minor = released_70_minor + case when p_tranche = '70' then v_gross else 0 end,
         released_30_minor = released_30_minor + case when p_tranche = '30' then v_gross else 0 end,
         commission_minor = commission_minor + v_commission,
         tax_minor = tax_minor + v_tax,
         vendor_net_minor = vendor_net_minor + v_net,
         held_minor = held_minor - v_gross,
         status = case when p_tranche = '30' then 'released' else 'partially_released' end,
         -- the completion window starts when the booking is confirmed
         release_30_due_at = case
           when p_tranche = '70'
             then now() + make_interval(hours => v_settings.completion_window_hours)
           else release_30_due_at end
   where id = v_pool.id;

  perform app_private.audit(null, 'fund.released', 'fund_pool', v_pool.id, v_pool.host_house_id,
                            jsonb_build_object('tranche', p_tranche, 'amount_minor', v_gross,
                                               'reason', p_reason));
  return 'released';
end $$;
revoke all on function app_private.release_tranche(uuid, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- The allocation: the money arrives, the 70% goes out
-- ---------------------------------------------------------------------------
-- Called by the server after Paystack has confirmed the charge, never by a browser. F-38 owns the
-- date: if the host lost the date, the money is recorded as a refund obligation instead and this
-- function says so rather than allocating it.
create function public.allocate_split_payment(
  p_booking uuid, p_reference text, p_amount_minor bigint, p_currency text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking   public.bookings;
  v_pool      public.fund_pool;
  v_settings  app_private.payment_settings;
  v_confirmed text;
  v_currency  text;
  v_reference text;
  v_release30 bigint;
  v_release   text;
  v_entry     uuid;
  v_key       text;
  v_escrow    text;
begin
  select * into v_settings from app_private.payment_settings where id;
  if v_settings.payments_paused then
    raise exception 'payments_paused' using errcode = '22023';
  end if;

  v_reference := trim(coalesce(p_reference, ''));
  if length(v_reference) not between 1 and 120 then
    raise exception 'payment_reference_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(v_reference) then
    raise exception 'payment_reference_rejected' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor < 1 then
    raise exception 'invalid_paid_amount' using errcode = '22023';
  end if;
  v_currency := upper(trim(coalesce(p_currency, '')));
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;

  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  select * into v_pool from public.fund_pool where booking_id = p_booking for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;

  if v_pool.paid_minor > 0 then
    -- The money is already in. The same reference changes nothing; another one is a second
    -- payment on a booking that is already paid.
    if v_pool.payment_reference = v_reference then
      return 'allocated';
    end if;
    raise exception 'payment_already_recorded' using errcode = '22023';
  end if;

  if v_currency <> v_pool.currency then
    raise exception 'currency_mismatch' using errcode = '22023';
  end if;
  if p_amount_minor < v_booking.total_minor then
    raise exception 'payment_below_quote_total' using errcode = '22023';
  end if;

  -- F-38 decides the date first: the money is only held if the host won it.
  v_confirmed := public.record_payment_confirmation(v_booking.quote_id, v_reference,
                                                    p_amount_minor, v_currency);
  if v_confirmed <> 'confirmed' then
    return v_confirmed;
  end if;

  v_escrow := 'escrow:' || v_booking.id::text;
  v_key := 'booking:' || v_booking.id::text || ':hold';

  v_entry := app_private.post_entry(v_key, 'booking_hold', 'paystack', v_booking.id,
    app_private.entry_lines(jsonb_build_array(
      jsonb_build_object('account', 'paystack_clearing',
                         'amount_minor', p_amount_minor, 'currency', v_currency),
      jsonb_build_object('account', v_escrow,
                         'amount_minor', -p_amount_minor, 'currency', v_currency)
    )));

  insert into public.wallet_ledger
    (pool_id, booking_id, entry_id, movement, direction, amount_minor, currency,
     idempotency_key, reference, memo)
  values (v_pool.id, v_booking.id, v_entry, 'booking_hold', 'in', p_amount_minor, v_currency,
          v_key, v_reference, 'Payment received')
  on conflict (idempotency_key) do nothing;

  update public.fund_pool
     set paid_minor = p_amount_minor,
         held_minor = p_amount_minor,
         payment_reference = v_reference,
         paid_at = now(),
         status = 'held'
   where id = v_pool.id;

  update public.bookings
     set status = 'paid', confirmed_at = now()
   where id = v_booking.id and status = 'awaiting_payment';

  -- The 70% goes out now. The 30% waits for the completion or for the window to close.
  v_release := app_private.release_tranche(p_booking, '70', 'paystack', 'booking');
  if v_release <> 'released' then
    raise exception 'first_release_failed: %', v_release using errcode = '22023';
  end if;

  select * into v_pool from public.fund_pool where booking_id = p_booking;
  select f.release_30 into v_release30 from app_private.tranche_split(v_booking.total_minor) f;

  perform app_private.audit(null, 'fund.allocated', 'fund_pool', v_pool.id, v_pool.host_house_id,
                            jsonb_build_object('paid_minor', p_amount_minor,
                                               'release_70_minor', v_pool.released_70_minor,
                                               'release_30_minor', v_release30));

  perform app_private.notify(v_pool.vendor_house_id, 'vendor', 'fund_released',
    'The first payment has been released to you',
    'Most of the booking payment is now yours. The rest is released when the celebration is done.',
    jsonb_build_object('booking_id', v_booking.id, 'amount_minor', v_pool.released_70_minor),
    'fund_released|' || v_booking.id || '|70');
  perform app_private.notify(v_pool.host_house_id, 'host', 'fund_released',
    'Most of your payment has been released',
    'The vendor has received the first part of your payment. The rest is released when you confirm '
    'the celebration happened.',
    jsonb_build_object('booking_id', v_booking.id, 'amount_minor', v_pool.released_70_minor),
    'fund_released|' || v_booking.id || '|70');

  return 'allocated';
end $$;
comment on function public.allocate_split_payment(uuid, text, bigint, text) is
  'F-102: the server records a paid booking, holds the money in escrow and releases the first 70%.';
revoke all on function public.allocate_split_payment(uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.allocate_split_payment(uuid, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------------
-- The provider event: one row, then the money
-- ---------------------------------------------------------------------------
-- The event row and the money move in the same transaction: if the money cannot be recorded, the
-- event row goes too, so a retry of the webhook is not swallowed.
create function public.record_payment_event(
  p_event_type text, p_reference text, p_amount_minor bigint, p_currency text,
  p_payload jsonb, p_booking uuid default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event    uuid;
  v_booking  uuid;
  v_outcome  text;
begin
  if p_event_type not in ('charge.success', 'refund.processed', 'charge.failed') then
    raise exception 'unknown_event_type' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reference, ''))) not between 1 and 120 then
    raise exception 'payment_reference_required' using errcode = '22023';
  end if;

  insert into public.payment_events
    (event_type, reference, booking_id, amount_minor, currency, payload)
  values (p_event_type, trim(p_reference), p_booking, p_amount_minor,
          upper(nullif(trim(coalesce(p_currency, '')), '')), coalesce(p_payload, '{}'::jsonb))
  on conflict (event_type, reference) do nothing
  returning id into v_event;

  if v_event is null then
    return 'duplicate';
  end if;

  if p_event_type = 'charge.success' then
    v_booking := p_booking;
    if v_booking is null then
      v_booking := public.booking_for_payment_reference(trim(p_reference));
    end if;
    if v_booking is null then
      raise exception 'booking_not_found for reference' using errcode = 'P0002';
    end if;
    v_outcome := public.allocate_split_payment(v_booking, trim(p_reference), p_amount_minor, p_currency);
  elsif p_event_type = 'refund.processed' then
    v_booking := p_booking;
    if v_booking is null then
      v_booking := public.booking_for_payment_reference(trim(p_reference));
    end if;
    if v_booking is null then
      raise exception 'booking_not_found for reference' using errcode = 'P0002';
    end if;
    perform public.settle_refund(v_booking, trim(p_reference));
    v_outcome := 'settled';
  else
    v_outcome := 'ignored';
  end if;

  update public.payment_events
     set outcome = v_outcome, booking_id = v_booking
   where id = v_event;

  return v_outcome;
end $$;
comment on function public.record_payment_event(text, text, bigint, text, jsonb, uuid) is
  'F-102: one provider event, recorded once. The event and the money move together.';
revoke all on function public.record_payment_event(text, text, bigint, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_payment_event(text, text, bigint, text, jsonb, uuid)
  to service_role;

-- Which booking a provider reference belongs to. The server needs it to match a refund event to
-- the charge it refunds.
create function public.booking_for_payment_reference(p_reference text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select fp.booking_id
    from public.fund_pool fp
   where fp.payment_reference = trim(coalesce(p_reference, ''))
$$;
comment on function public.booking_for_payment_reference(text) is
  'F-102: the booking a provider payment reference belongs to.';
revoke all on function public.booking_for_payment_reference(text) from public, anon, authenticated;
grant execute on function public.booking_for_payment_reference(text) to service_role;

-- ---------------------------------------------------------------------------
-- The completion window: the 30% after the celebration
-- ---------------------------------------------------------------------------
-- The host confirms the celebration happened, and the last tranche goes out.
create function public.complete_booking(p_booking uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_status  text;
begin
  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not app_private.member_can(v_booking.host_house_id, 'bookings') then
    raise exception 'forbidden: not the host of this booking' using errcode = '42501';
  end if;

  if v_booking.status = 'completed' then
    return 'already_completed';
  end if;
  if v_booking.status <> 'paid' then
    raise exception 'booking_not_paid' using errcode = '22023';
  end if;

  update public.bookings
     set status = 'completed', completed_at = now()
   where id = p_booking;

  update public.fund_pool
     set completed_at = now()
   where booking_id = p_booking;

  v_status := app_private.release_tranche(p_booking, '30', 'host', 'completed');
  if v_status = 'frozen' then
    raise exception 'fund_pool_frozen' using errcode = '22023';
  end if;

  perform app_private.audit(app_private.current_user_id(), 'booking.completed', 'bookings',
                            p_booking, v_booking.host_house_id,
                            jsonb_build_object('release', v_status));
  return v_status;
end $$;
comment on function public.complete_booking(uuid) is
  'F-102: the host confirms the celebration happened, and the last 30% is released.';
revoke all on function public.complete_booking(uuid) from public, anon;
grant execute on function public.complete_booking(uuid) to authenticated;

-- The sweep for the pools whose window has closed with no dispute. The scheduler (F-72) calls it.
create function public.release_due_fund_tranches()
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
    select booking_id from public.fund_pool
     where paid_minor > 0
       and released_70_minor > 0
       and released_30_minor = 0
       and refunded_minor = 0
       and frozen = false
       and release_30_due_at is not null
       and release_30_due_at <= now()
     order by release_30_due_at
  loop
    if app_private.release_tranche(v_row.booking_id, '30', 'scheduler', 'silence') = 'released' then
      v_done := v_done + 1;
      perform app_private.notify(
        (select host_house_id from public.fund_pool where booking_id = v_row.booking_id), 'host',
        'fund_released', 'The last payment has been released',
        'Nobody raised a problem, so the rest of the payment has been released to the vendor.',
        jsonb_build_object('booking_id', v_row.booking_id),
        'fund_released|' || v_row.booking_id || '|30');
      perform app_private.notify(
        (select vendor_house_id from public.fund_pool where booking_id = v_row.booking_id), 'vendor',
        'fund_released', 'The last payment has been released to you',
        'The rest of the booking payment is now yours.',
        jsonb_build_object('booking_id', v_row.booking_id),
        'fund_released|' || v_row.booking_id || '|30');
    end if;
  end loop;
  return v_done;
end $$;
comment on function public.release_due_fund_tranches() is
  'F-102: release the last 30% of every pool whose completion window has closed.';
revoke all on function public.release_due_fund_tranches() from public, anon, authenticated;
grant execute on function public.release_due_fund_tranches() to service_role;

-- ---------------------------------------------------------------------------
-- The dispute freeze
-- ---------------------------------------------------------------------------
-- Only a staff member with an active arbitrator grant may freeze a pool, and only while the money
-- is still in it. F-16 attaches its case model to the same flag.
create function public.freeze_fund_pool(p_booking uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pool  public.fund_pool;
  v_actor uuid;
  v_grant uuid;
begin
  v_actor := app_private.current_user_id();
  v_grant := app_private.staff_grant_for('arbitrator');
  if v_actor is null or v_grant is null then
    raise exception 'forbidden: arbitrator grant required' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_reason) then
    raise exception 'reason_rejected' using errcode = '22023';
  end if;

  select * into v_pool from public.fund_pool where booking_id = p_booking for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;
  if v_pool.frozen then
    return;
  end if;
  if v_pool.held_minor = 0 then
    raise exception 'nothing_held_to_freeze' using errcode = '22023';
  end if;

  update public.fund_pool
     set frozen = true, frozen_at = now(), frozen_reason = left(trim(p_reason), 200), frozen_by = v_actor
   where id = v_pool.id;

  perform app_private.audit(v_actor, 'fund.frozen', 'fund_pool', v_pool.id, v_pool.host_house_id,
                            jsonb_build_object('booking_id', p_booking));
  perform app_private.notify(v_pool.host_house_id, 'host', 'fund_frozen',
    'A payment is on hold',
    'Someone has raised a problem about this booking, so the money is held until it is settled.',
    jsonb_build_object('booking_id', p_booking), 'fund_frozen|' || p_booking);
  perform app_private.notify(v_pool.vendor_house_id, 'vendor', 'fund_frozen',
    'A payment is on hold',
    'Someone has raised a problem about this booking, so the money is held until it is settled.',
    jsonb_build_object('booking_id', p_booking), 'fund_frozen|' || p_booking);
end $$;
comment on function public.freeze_fund_pool(uuid, text) is
  'F-102: an arbitrator freezes a pool. The completion clock stops until it is lifted.';
revoke all on function public.freeze_fund_pool(uuid, text) from public, anon;
grant execute on function public.freeze_fund_pool(uuid, text) to authenticated;

-- Lifting the freeze pushes the deadline back by the time the money was held, so a frozen pool
-- never releases itself while nobody was watching.
create function public.unfreeze_fund_pool(p_booking uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pool  public.fund_pool;
  v_actor uuid;
  v_grant uuid;
begin
  v_actor := app_private.current_user_id();
  v_grant := app_private.staff_grant_for('arbitrator');
  if v_actor is null or v_grant is null then
    raise exception 'forbidden: arbitrator grant required' using errcode = '42501';
  end if;

  select * into v_pool from public.fund_pool where booking_id = p_booking for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;
  if not v_pool.frozen then
    return;
  end if;

  update public.fund_pool
     set frozen = false,
         frozen_at = null,
         frozen_reason = null,
         frozen_by = null,
         release_30_due_at = case
           when release_30_due_at is null then null
           else release_30_due_at + (now() - frozen_at) end
   where id = v_pool.id;

  perform app_private.audit(v_actor, 'fund.unfrozen', 'fund_pool', v_pool.id, v_pool.host_house_id,
                            jsonb_build_object('booking_id', p_booking));
end $$;
comment on function public.unfreeze_fund_pool(uuid) is
  'F-102: an arbitrator lifts a freeze. The completion deadline moves by the frozen time.';
revoke all on function public.unfreeze_fund_pool(uuid) from public, anon;
grant execute on function public.unfreeze_fund_pool(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The refund
-- ---------------------------------------------------------------------------
-- The host may cancel their own booking before the money is released, and staff with a finance or
-- arbitrator grant may refund a frozen pool. The vendor cannot cancel here: F-21 owns vendor
-- cancellation, and F-20 owns the penalty split. Until then a refund is the whole held amount.
create function public.request_fund_refund(p_booking uuid, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pool   public.fund_pool;
  v_actor  uuid;
  v_staff  uuid;
  v_amount bigint;
  v_key    text;
  v_entry  uuid;
begin
  v_actor := app_private.current_user_id();
  select * into v_pool from public.fund_pool where booking_id = p_booking for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;

  v_staff := app_private.staff_grant_for('finance');
  if v_staff is null then
    v_staff := app_private.staff_grant_for('arbitrator');
  end if;
  if v_actor is null
     or not (app_private.member_can(v_pool.host_house_id, 'bookings') or v_staff is not null) then
    raise exception 'forbidden: refund not allowed' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_reason) then
    raise exception 'reason_rejected' using errcode = '22023';
  end if;

  if v_pool.refunded_minor > 0 then
    -- Already refunded. The same request changes nothing.
    return 'refunded';
  end if;
  if v_pool.held_minor = 0 then
    raise exception 'nothing_held_to_refund' using errcode = '22023';
  end if;
  if v_pool.frozen and v_staff is null then
    -- A dispute is open on this money, so an arbitrator decides what happens to it, not the
    -- host. Staff with a finance or arbitrator grant may still settle it.
    raise exception 'fund_pool_frozen' using errcode = '22023';
  end if;

  -- The refund is the money the platform still holds for this host. The 70% released at booking
  -- is the vendor's claim and is not clawed back here: recovering it would assume the vendor
  -- gives money back, which the platform cannot promise. The PRD's 80/20 forfeit on a host
  -- cancellation is F-20's policy and is not built; see docs/open-questions.md.

  v_amount := v_pool.held_minor;
  v_key := 'booking:' || p_booking::text || ':refund';

  -- The hold entry is what the refund reverses, so the two are linked.
  select e.id into v_entry
    from public.journal_entries e
   where e.idempotency_key = 'booking:' || p_booking::text || ':hold';

  perform app_private.post_entry(v_key, 'refund', coalesce(v_actor::text, 'host'), p_booking,
    app_private.entry_lines(jsonb_build_array(
      jsonb_build_object('account', 'escrow:' || p_booking::text,
                         'amount_minor', v_amount, 'currency', v_pool.currency),
      jsonb_build_object('account', 'refunds_payable',
                         'amount_minor', -v_amount, 'currency', v_pool.currency)
    )), v_entry);

  insert into public.wallet_ledger
    (pool_id, booking_id, movement, direction, amount_minor, currency, idempotency_key, memo)
  values (v_pool.id, p_booking, 'refund', 'out', v_amount, v_pool.currency, v_key,
          left(trim(p_reason), 200))
  on conflict (idempotency_key) do nothing;

  update public.fund_pool
     set refunded_minor = refunded_minor + v_amount,
         held_minor = held_minor - v_amount,
         status = 'refund_pending',
         refunded_at = now()
   where id = v_pool.id;

  update public.bookings
     set status = 'refunded'
   where id = p_booking and status in ('paid', 'completed');

  perform app_private.audit(v_actor, 'fund.refund_requested', 'fund_pool', v_pool.id,
                            v_pool.host_house_id,
                            jsonb_build_object('booking_id', p_booking, 'amount_minor', v_amount));
  return 'refund_pending';
end $$;
comment on function public.request_fund_refund(uuid, text) is
  'F-102: the money is owed back to the host. The provider moves it, then settle_refund records it.';
revoke all on function public.request_fund_refund(uuid, text) from public, anon;
grant execute on function public.request_fund_refund(uuid, text) to authenticated;

-- The provider says the money has gone back. The ledger follows.
create function public.settle_refund(p_booking uuid, p_reference text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pool  public.fund_pool;
  v_ref   text;
begin
  v_ref := trim(coalesce(p_reference, ''));
  if length(v_ref) not between 1 and 120 then
    raise exception 'payment_reference_required' using errcode = '22023';
  end if;

  select * into v_pool from public.fund_pool where booking_id = p_booking for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;
  if v_pool.status = 'refunded' then
    return 'settled';
  end if;
  if v_pool.status <> 'refund_pending' then
    raise exception 'no_refund_pending' using errcode = '22023';
  end if;

  perform app_private.post_entry('booking:' || p_booking::text || ':refund_settled', 'reversal',
    'paystack', p_booking,
    app_private.entry_lines(jsonb_build_array(
      jsonb_build_object('account', 'refunds_payable',
                         'amount_minor', v_pool.refunded_minor, 'currency', v_pool.currency),
      jsonb_build_object('account', 'paystack_clearing',
                         'amount_minor', -v_pool.refunded_minor, 'currency', v_pool.currency)
    )));

  insert into public.wallet_ledger
    (pool_id, booking_id, movement, direction, amount_minor, currency, idempotency_key,
     reference, memo)
  values (v_pool.id, p_booking, 'refund_settled', 'out', v_pool.refunded_minor, v_pool.currency,
          'booking:' || p_booking::text || ':refund_settled', v_ref, 'Refund sent to the host')
  on conflict (idempotency_key) do nothing;

  update public.fund_pool set status = 'refunded' where id = v_pool.id;

  perform app_private.audit(null, 'fund.refund_settled', 'fund_pool', v_pool.id,
                            v_pool.host_house_id,
                            jsonb_build_object('booking_id', p_booking,
                                               'amount_minor', v_pool.refunded_minor));
  return 'settled';
end $$;
comment on function public.settle_refund(uuid, text) is
  'F-102: the provider has sent the money back, so the ledger follows.';
revoke all on function public.settle_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_refund(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security: every read is a projection, every write is a function
-- ---------------------------------------------------------------------------
alter table public.ledger_accounts enable row level security;
alter table public.ledger_accounts force row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
alter table public.postings enable row level security;
alter table public.postings force row level security;
alter table public.bookings enable row level security;
alter table public.bookings force row level security;
alter table public.fund_pool enable row level security;
alter table public.fund_pool force row level security;
alter table public.wallet_ledger enable row level security;
alter table public.wallet_ledger force row level security;
alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;

revoke all on public.ledger_accounts, public.journal_entries, public.postings,
                public.bookings, public.fund_pool, public.wallet_ledger, public.payment_events
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authorized projections
-- ---------------------------------------------------------------------------
-- One booking's money, for the two houses that are party to it.
create function public.booking_fund(p_booking uuid)
returns table (
  booking_id        uuid,
  quote_id          uuid,
  service_date      date,
  total_minor       bigint,
  currency          text,
  booking_status    text,
  pool_status       text,
  paid_minor        bigint,
  held_minor        bigint,
  released_70_minor bigint,
  released_30_minor bigint,
  commission_minor  bigint,
  tax_minor         bigint,
  vendor_net_minor  bigint,
  refunded_minor    bigint,
  release_30_due_at timestamptz,
  paid_at           timestamptz,
  completed_at      timestamptz,
  refunded_at       timestamptz,
  frozen            boolean,
  frozen_reason     text,
  payment_reference text,
  is_host_side      boolean,
  counterparty_house uuid,
  counterparty_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking     public.bookings;
  v_pool        public.fund_pool;
  v_is_host     boolean;
  v_counterparty uuid;
  v_name        text;
begin
  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not (app_private.member_can(v_booking.host_house_id, 'bookings')
          or app_private.member_can(v_booking.vendor_house_id, 'bookings')
          or app_private.member_can(v_booking.vendor_house_id, 'payouts')) then
    raise exception 'forbidden: not a party to this booking' using errcode = '42501';
  end if;

  select * into v_pool from public.fund_pool where booking_id = p_booking;

  v_is_host := app_private.member_can(v_booking.host_house_id, 'bookings');
  v_counterparty := case when v_is_host then v_booking.vendor_house_id
                          else v_booking.host_house_id end;
  select h.display_name into v_name from public.houses h where h.id = v_counterparty;

  return query
    select v_booking.id, v_booking.quote_id, v_booking.service_date, v_booking.total_minor,
           v_booking.currency, v_booking.status, v_pool.status, v_pool.paid_minor, v_pool.held_minor,
           v_pool.released_70_minor, v_pool.released_30_minor, v_pool.commission_minor,
           v_pool.tax_minor, v_pool.vendor_net_minor, v_pool.refunded_minor,
           v_pool.release_30_due_at, v_pool.paid_at, v_pool.completed_at, v_pool.refunded_at,
           v_pool.frozen, v_pool.frozen_reason, v_pool.payment_reference,
           v_is_host, v_counterparty, coalesce(v_name, '');
end $$;
revoke all on function public.booking_fund(uuid) from public, anon;
grant execute on function public.booking_fund(uuid) to authenticated;

-- The trail of what moved for one booking.
create function public.booking_movements(p_booking uuid)
returns table (
  movement     text,
  direction    text,
  amount_minor bigint,
  currency     text,
  reference    text,
  memo         text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not (app_private.member_can(v_booking.host_house_id, 'bookings')
          or app_private.member_can(v_booking.vendor_house_id, 'bookings')
          or app_private.member_can(v_booking.vendor_house_id, 'payouts')) then
    raise exception 'forbidden: not a party to this booking' using errcode = '42501';
  end if;

  return query
    select w.movement, w.direction, w.amount_minor, w.currency, w.reference, w.memo, w.created_at
      from public.wallet_ledger w
     where w.booking_id = p_booking
     order by w.created_at;
end $$;
revoke all on function public.booking_movements(uuid) from public, anon;
grant execute on function public.booking_movements(uuid) to authenticated;

-- What a payment needs to start: the amount, the currency and who to charge. Only the host side
-- may ask, so the vendor house never sees the host's email address.
create function public.booking_payment_request(p_booking uuid)
returns table (
  total_minor bigint,
  currency    text,
  host_email  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_email  text;
begin
  select * into v_booking from public.bookings where id = p_booking;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not app_private.member_can(v_booking.host_house_id, 'bookings') then
    raise exception 'forbidden: only the host may pay' using errcode = '42501';
  end if;

  select u.email into v_email
    from public.houses h
    join public.users u on u.id = h.owner_user_id
   where h.id = v_booking.host_house_id;

  return query select v_booking.total_minor, v_booking.currency, coalesce(v_email, '');
end $$;
revoke all on function public.booking_payment_request(uuid) from public, anon;
grant execute on function public.booking_payment_request(uuid) to authenticated;

-- A house's bookings and what each one owes.
create function public.my_bookings(p_house uuid)
returns table (
  booking_id        uuid,
  quote_id          uuid,
  service_date      date,
  total_minor       bigint,
  currency          text,
  booking_status    text,
  pool_status       text,
  paid_minor        bigint,
  held_minor        bigint,
  released_minor    bigint,
  refunded_minor    bigint,
  release_30_due_at timestamptz,
  frozen            boolean,
  is_host_side      boolean,
  counterparty_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_active_member(p_house) then
    raise exception 'forbidden: not a member of this house' using errcode = '42501';
  end if;

  return query
    select b.id, b.quote_id, b.service_date, b.total_minor, b.currency, b.status, p.status,
           p.paid_minor, p.held_minor, p.released_70_minor + p.released_30_minor, p.refunded_minor,
           p.release_30_due_at, p.frozen,
           b.host_house_id = p_house,
           cp.display_name
      from public.bookings b
      join public.fund_pool p on p.booking_id = b.id
      join public.houses cp on cp.id = (case when b.host_house_id = p_house
                                             then b.vendor_house_id else b.host_house_id end)
     where b.host_house_id = p_house or b.vendor_house_id = p_house
     order by b.service_date desc, b.created_at desc;
end $$;
revoke all on function public.my_bookings(uuid) from public, anon;
grant execute on function public.my_bookings(uuid) to authenticated;
