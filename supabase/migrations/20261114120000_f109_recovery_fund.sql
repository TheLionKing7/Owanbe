-- F-109 Fund pool / recovery fund
-- The recovery fund: the money the platform has taken back from a vendor that did not deliver,
-- held aside for the host who was left with nothing, and the advance that pays a replacement
-- vendor out of it.
--
-- What F-102 already owns and this file does not rebuild:
--   * the 70/30 split and the two tranches (app_private.tranche_split, app_private.release_tranche)
--   * the double-entry core (public.ledger_accounts, public.journal_entries, public.postings)
--   * the dispute freeze (public.freeze_fund_pool / public.unfreeze_fund_pool)
--   * the refund path (public.request_fund_refund / public.settle_refund)
-- This file adds what was missing: the recovery fund itself, the advance that draws on it, the
-- ledger that reconciles with the payment router, and the split calculator the app asks the
-- database for instead of recomputing.
--
-- Owner decisions and the blueprint behind this file:
--   * blueprint/prd.md:102 — "human-approved advances equal 50% of replacement cost". The advance
--     is exactly half the replacement cost, computed in SQL so no caller can set it.
--   * blueprint/prd.md:182 — "insufficient recovery funds require human escalation without
--     guarantees". An advance that the recovery fund cannot cover is refused, not half-paid.
--   * blueprint/architecture.md:232 — "Until thresholds are approved, all manual fund actions
--     require two distinct authorized staff approvals." The large-amount threshold is still
--     unapproved, so every manual fund action here needs two distinct finance approvals, and the
--     person who asked for it may not be one of them.
--   * blueprint/architecture.md — "recovery funding" is still an unresolved policy gate, so this
--     file does not invent a funding policy: it takes the money from the money that exists, and
--     refuses when there is not enough. What stays open is written down in docs/open-questions.md.
--
-- Invariants this file owns:
--   * every movement of recovery money is a balanced journal entry, and every entry is keyed, so a
--     retried request cannot move money twice
--   * the recovery fund is money the platform took back: it is never spent without an approval
--     from two distinct staff, and an advance never exceeds what the fund holds
--   * the ledger of the recovery money is append-only, and it points at the journal entry that
--     carries the amount: the double-entry core stays the only source of truth
--   * reconciliation compares the provider's events with the ledger and moves no money
--
-- Depends on 20261109140000_f102_fund_pool.sql (the pool, the ledger and the tranches) and
-- 20261109180000_f107_owanbe_ai.sql (public.cases, the case a recovery is recorded against).
-- Acceptance criteria: docs/journal/2026-11-14-F-109-recovery-fund.md

-- ---------------------------------------------------------------------------
-- The journal entry kinds the recovery money needs
-- ---------------------------------------------------------------------------
alter table public.journal_entries drop constraint journal_entries_kind_check;
alter table public.journal_entries add constraint journal_entries_kind_check check (kind in
  ('booking_hold', 'release_70', 'release_30', 'fee', 'refund', 'reversal', 'payout',
   'recovery_clawback', 'recovery_advance'));

-- The host is told when money is advanced to them.
--
-- The kind list is the union of every kind the migrations write: F-38's date alerts, F-14's
-- counter_ignored, F-102's fund alerts and this file's fund_advanced. F-14 (20261112100000) last
-- rewrote the check and left F-102's fund_* kinds out of it, so a payment allocation failed on
-- the notification it writes. This list puts them back.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('date_competing', 'date_secured', 'date_outbid', 'payment_window_closed', 'refund_pending',
   'counter_ignored', 'fund_released', 'fund_frozen', 'fund_refunded', 'fund_advanced'));
comment on constraint notifications_kind_check on public.notifications is
  'Every kind of house alert the migrations write: the date alerts, the counter alert, the fund alerts and the recovery advance.';

-- ---------------------------------------------------------------------------
-- The recovery actions: one state machine for both kinds of money
-- ---------------------------------------------------------------------------
-- A clawback takes money back from a vendor that did not deliver; an advance pays a host out of
-- the recovery fund. Both are manual fund actions, so both are asked for by staff, approved by
-- two distinct staff, and only then settled. One table, one state machine, so a request cannot be
-- approved by a rule that only exists for one kind of money.
create table public.recovery_actions (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique
                           default 'RA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
                           check (reference ~ '^RA-[0-9A-F]{12}$'),
  kind                   text not null check (kind in ('clawback', 'advance')),
  status                 text not null default 'requested'
                           check (status in ('requested', 'approved', 'settled', 'refused', 'void')),
  -- the case that carries the decision. F-16 owns the dispute model and F-17 the no-show case:
  -- this table records the money that follows from that decision, and owns no part of it.
  case_id                uuid not null references public.cases (id) on delete restrict,
  source_booking_id      uuid not null references public.bookings (id) on delete restrict,
  pool_id                uuid not null references public.fund_pool (id) on delete restrict,
  host_house_id          uuid not null references public.houses (id) on delete restrict,
  vendor_house_id        uuid not null references public.houses (id) on delete restrict,
  currency               text not null check (currency ~ '^[A-Z]{3}$'),
  -- the clawback: how much is taken back from the vendor.
  -- the advance: how much is paid to the host.
  amount_minor           bigint not null check (amount_minor > 0),
  -- the advance only: what the replacement costs. The advance is half of it.
  replacement_cost_minor bigint check (replacement_cost_minor is null or replacement_cost_minor > 0),
  -- the platform wallet the recovery fund is held in. Without it no advance can be funded.
  fund_wallet_id         text not null check (length(btrim(fund_wallet_id)) between 1 and 120),
  requested_by           uuid not null references public.users (id),
  reason                 text not null check (length(reason) between 3 and 200),
  provider_reference     text,
  requested_at           timestamptz not null default now(),
  approved_at            timestamptz,
  settled_at             timestamptz,
  voided_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                integer not null default 1,
  -- an advance is exactly half the replacement cost, and only an advance has a replacement cost.
  constraint recovery_actions_advance_is_half check (
    (kind = 'advance' and replacement_cost_minor is not null
       and amount_minor = (replacement_cost_minor * 50) / 100)
    or (kind = 'clawback' and replacement_cost_minor is null)
  ),
  -- F-60: a free-text column a person can type into carries the credential guard.
  constraint recovery_actions_reason_no_credentials check (
    not app_private.looks_like_payment_credential(reason)
  ),
  constraint recovery_actions_wallet_no_credentials check (
    not app_private.looks_like_payment_credential(fund_wallet_id)
  ),
  constraint recovery_actions_reference_no_credentials check (
    provider_reference is null or not app_private.looks_like_payment_credential(provider_reference)
  )
);
comment on table public.recovery_actions is
  'F-109: money taken back from a vendor that did not deliver, or money advanced to a host out of the recovery fund. Two distinct staff approve before it may settle.';
create index recovery_actions_case_idx on public.recovery_actions (case_id, created_at desc);
create index recovery_actions_status_idx on public.recovery_actions (status, created_at desc);
create index recovery_actions_pool_idx on public.recovery_actions (pool_id, created_at desc);
create trigger recovery_actions_touch before update on public.recovery_actions
  for each row execute function app_private.touch();

-- The approvals. One row per person per action, so the same person cannot count twice.
create table public.recovery_approvals (
  id             uuid primary key default gen_random_uuid(),
  action_id      uuid not null references public.recovery_actions (id) on delete cascade,
  staff_user_id  uuid not null references public.users (id),
  decision       text not null check (decision in ('approved', 'refused')),
  note           text check (note is null or length(note) <= 200),
  decided_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,
  unique (action_id, staff_user_id),
  constraint recovery_approvals_note_no_credentials check (
    note is null or not app_private.looks_like_payment_credential(note)
  )
);
comment on table public.recovery_approvals is
  'F-109: who approved a recovery action. Two distinct staff are needed before it may settle.';
create index recovery_approvals_action_idx on public.recovery_approvals (action_id, decided_at);
create trigger recovery_approvals_touch before update on public.recovery_approvals
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- The ledger of the recovery money
-- ---------------------------------------------------------------------------
-- One row for every movement of recovery money against a pool. It is the trail, not the truth:
-- the amount lives in the journal entry, and this row names it. The direction is relative to the
-- recovery fund: a clawback brings money in, an advance sends it out.
create table public.fund_pool_ledger (
  id               uuid primary key default gen_random_uuid(),
  pool_id          uuid not null references public.fund_pool (id) on delete restrict,
  booking_id       uuid not null references public.bookings (id) on delete restrict,
  action_id        uuid not null references public.recovery_actions (id) on delete restrict,
  entry_id         uuid references public.journal_entries (id) on delete restrict,
  movement         text not null check (movement in ('clawback', 'advance')),
  direction        text not null check (direction in ('in', 'out')),
  amount_minor     bigint not null check (amount_minor > 0),
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  idempotency_key  text not null unique check (length(idempotency_key) between 1 and 200),
  memo             text check (memo is null or length(memo) <= 200),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  constraint fund_pool_ledger_memo_no_credentials check (
    memo is null or not app_private.looks_like_payment_credential(memo)
  )
);
comment on table public.fund_pool_ledger is
  'F-109: the trail of the recovery money for one fund pool. The amount lives in the journal entry.';
create index fund_pool_ledger_pool_idx on public.fund_pool_ledger (pool_id, created_at desc);
create index fund_pool_ledger_action_idx on public.fund_pool_ledger (action_id);
create trigger fund_pool_ledger_touch before update on public.fund_pool_ledger
  for each row execute function app_private.touch();
-- A movement of money is never edited away.
create trigger fund_pool_ledger_append_only
  before update or delete or truncate on public.fund_pool_ledger
  for each statement execute function app_private.forbid_change();

-- ---------------------------------------------------------------------------
-- The reconciliation: the provider's events against the ledger
-- ---------------------------------------------------------------------------
-- The outcome of a reconciliation run. It names references and codes, never a payload.
create table public.ledger_reconciliations (
  id              uuid primary key default gen_random_uuid(),
  ran_at          timestamptz not null default now(),
  provider        text not null default 'paystack' check (provider = 'paystack'),
  events_checked  integer not null default 0 check (events_checked >= 0),
  pools_checked   integer not null default 0 check (pools_checked >= 0),
  matched         integer not null default 0 check (matched >= 0),
  exception_count integer not null default 0 check (exception_count >= 0),
  status          text not null check (status in ('matched', 'exceptions')),
  exception_rows  jsonb not null default '[]'::jsonb check (jsonb_typeof(exception_rows) = 'array'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  constraint ledger_reconciliations_rows_no_credentials check (
    not app_private.jsonb_has_payment_credential(exception_rows)
  )
);
comment on table public.ledger_reconciliations is
  'F-109: the outcome of comparing the provider''s events with the ledger. It moves no money.';
create index ledger_reconciliations_ran_idx on public.ledger_reconciliations (ran_at desc);
create trigger ledger_reconciliations_touch before update on public.ledger_reconciliations
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- The recovery fund's balance
-- ---------------------------------------------------------------------------
-- The fund is a platform account per currency: money taken back from vendors, less money
-- advanced to hosts. It is credit-normal, so the balance is the negative of the postings.
create function app_private.recovery_fund_balance(p_currency text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((-sum(p.amount_minor))::bigint, 0)
    from public.postings p
    join public.ledger_accounts a on a.id = p.ledger_account_id
   where a.code = 'recovery_fund'
     and a.owner_kind = 'platform'
     and a.owner_id is null
     and a.currency = upper(p_currency)
$$;
revoke all on function app_private.recovery_fund_balance(text) from public;

-- What a vendor is still owed, and may therefore have taken back.
create function app_private.vendor_payable_balance(p_house uuid, p_currency text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((-sum(p.amount_minor))::bigint, 0)
    from public.postings p
    join public.ledger_accounts a on a.id = p.ledger_account_id
   where a.code = 'vendor_payable'
     and a.owner_kind = 'house'
     and a.owner_id = p_house
     and a.currency = upper(p_currency)
$$;
revoke all on function app_private.vendor_payable_balance(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Asking for a clawback: money taken back from a vendor that did not deliver
-- ---------------------------------------------------------------------------
-- The case carries the decision; this function only moves what follows from it. Staff with an
-- arbitrator or finance grant ask for it, and it needs two distinct finance approvals before it
-- may settle (blueprint/architecture.md:232).
create function public.request_recovery_clawback(
  p_case uuid, p_amount_minor bigint, p_reason text, p_fund_wallet text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_case    public.cases;
  v_pool    public.fund_pool;
  v_booking public.bookings;
  v_amount  bigint;
  v_balance bigint;
  v_id      uuid;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('arbitrator') is null
         and app_private.staff_grant_for('finance') is null) then
    raise exception 'forbidden: arbitrator or finance grant required' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_reason) then
    raise exception 'reason_rejected' using errcode = '22023';
  end if;
  if p_fund_wallet is null or length(btrim(p_fund_wallet)) not between 1 and 120 then
    raise exception 'fund_wallet_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_fund_wallet) then
    raise exception 'fund_wallet_rejected' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor < 1 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select * into v_case from public.cases where id = p_case;
  if not found then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  if v_case.booking_id is null then
    raise exception 'case_has_no_booking' using errcode = '22023';
  end if;
  if v_case.status = 'closed' then
    raise exception 'case_closed' using errcode = '22023';
  end if;

  select * into v_booking from public.bookings where id = v_case.booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  select * into v_pool from public.fund_pool where booking_id = v_booking.id for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;

  -- Only what the platform still owes the vendor may be taken back. Money already paid out to
  -- them cannot be recovered, so it is never counted here.
  v_balance := app_private.vendor_payable_balance(v_pool.vendor_house_id, v_pool.currency);
  if v_balance < p_amount_minor then
    raise exception 'nothing_to_recover' using errcode = '22023';
  end if;
  v_amount := p_amount_minor;

  insert into public.recovery_actions
    (kind, case_id, source_booking_id, pool_id, host_house_id, vendor_house_id,
     currency, amount_minor, fund_wallet_id, requested_by, reason)
  values ('clawback', v_case.id, v_booking.id, v_pool.id, v_pool.host_house_id,
          v_pool.vendor_house_id, v_pool.currency, v_amount, trim(p_fund_wallet), v_actor,
          left(trim(p_reason), 200))
  returning id into v_id;

  perform app_private.audit(v_actor, 'fund.recovery_requested', 'recovery_actions', v_id,
                            v_pool.host_house_id,
                            jsonb_build_object('kind', 'clawback', 'booking_id', v_booking.id,
                                               'amount_minor', v_amount,
                                               'case_id', v_case.id));
  return v_id;
end $$;
comment on function public.request_recovery_clawback(uuid, bigint, text, text) is
  'F-109: staff ask for money to be taken back from a vendor that did not deliver.';
revoke all on function public.request_recovery_clawback(uuid, bigint, text, text)
  from public, anon;
grant execute on function public.request_recovery_clawback(uuid, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Asking for an advance: money for a replacement, out of the recovery fund
-- ---------------------------------------------------------------------------
-- The advance is half the replacement cost (blueprint/prd.md:102). It is refused when the
-- recovery fund cannot cover it: the PRD asks for human escalation, not a guarantee
-- (blueprint/prd.md:182).
create function public.request_recovery_advance(
  p_case uuid, p_replacement_cost_minor bigint, p_reason text, p_fund_wallet text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_case    public.cases;
  v_pool    public.fund_pool;
  v_booking public.bookings;
  v_advance bigint;
  v_available bigint;
  v_id      uuid;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('support') is null
         and app_private.staff_grant_for('finance') is null) then
    raise exception 'forbidden: support or finance grant required' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_reason) then
    raise exception 'reason_rejected' using errcode = '22023';
  end if;
  if p_fund_wallet is null or length(btrim(p_fund_wallet)) not between 1 and 120 then
    raise exception 'fund_wallet_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_fund_wallet) then
    raise exception 'fund_wallet_rejected' using errcode = '22023';
  end if;
  if p_replacement_cost_minor is null or p_replacement_cost_minor < 1 then
    raise exception 'invalid_replacement_cost' using errcode = '22023';
  end if;

  select * into v_case from public.cases where id = p_case;
  if not found then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  if v_case.booking_id is null then
    raise exception 'case_has_no_booking' using errcode = '22023';
  end if;
  if v_case.status = 'closed' then
    raise exception 'case_closed' using errcode = '22023';
  end if;

  select * into v_booking from public.bookings where id = v_case.booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  select * into v_pool from public.fund_pool where booking_id = v_booking.id for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;

  -- Half the replacement cost. The caller does not choose the amount.
  v_advance := (p_replacement_cost_minor * 50) / 100;
  if v_advance < 1 then
    raise exception 'advance_too_small' using errcode = '22023';
  end if;

  -- What the platform can do: the fund holds money taken back from vendors, and the provider can
  -- only send back what was charged on this booking.
  v_available := least(
    app_private.recovery_fund_balance(v_pool.currency),
    v_pool.paid_minor - v_pool.refunded_minor);
  if v_available < v_advance then
    raise exception 'insufficient_recovery_funds' using errcode = '22023';
  end if;

  insert into public.recovery_actions
    (kind, case_id, source_booking_id, pool_id, host_house_id, vendor_house_id,
     currency, amount_minor, replacement_cost_minor, fund_wallet_id, requested_by, reason)
  values ('advance', v_case.id, v_booking.id, v_pool.id, v_pool.host_house_id,
          v_pool.vendor_house_id, v_pool.currency, v_advance, p_replacement_cost_minor,
          trim(p_fund_wallet), v_actor, left(trim(p_reason), 200))
  returning id into v_id;

  perform app_private.audit(v_actor, 'fund.recovery_requested', 'recovery_actions', v_id,
                            v_pool.host_house_id,
                            jsonb_build_object('kind', 'advance', 'booking_id', v_booking.id,
                                               'amount_minor', v_advance,
                                               'replacement_cost_minor', p_replacement_cost_minor,
                                               'case_id', v_case.id));
  return v_id;
end $$;
comment on function public.request_recovery_advance(uuid, bigint, text, text) is
  'F-109: staff ask for half the replacement cost to be advanced to the host out of the recovery fund.';
revoke all on function public.request_recovery_advance(uuid, bigint, text, text)
  from public, anon;
grant execute on function public.request_recovery_advance(uuid, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Approving a recovery action
-- ---------------------------------------------------------------------------
-- Two distinct staff with a finance grant, and neither of them the person who asked for it. The
-- second approval is what moves the action out of 'requested'.
create function public.approve_recovery_action(p_action uuid, p_decision text, p_note text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor    uuid;
  v_action   public.recovery_actions;
  v_approved integer := 0;
  v_refused  integer := 0;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null or app_private.staff_grant_for('finance') is null then
    raise exception 'forbidden: finance grant required' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'refused') then
    raise exception 'unknown_decision' using errcode = '22023';
  end if;
  if p_note is not null and length(trim(p_note)) > 200 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;
  if p_note is not null and app_private.looks_like_payment_credential(p_note) then
    raise exception 'note_rejected' using errcode = '22023';
  end if;

  select * into v_action from public.recovery_actions where id = p_action for update;
  if not found then
    raise exception 'recovery_action_not_found' using errcode = 'P0002';
  end if;
  if v_action.status not in ('requested', 'approved') then
    raise exception 'recovery_action_closed' using errcode = '22023';
  end if;
  if v_action.requested_by = v_actor then
    raise exception 'forbidden: the requester may not approve' using errcode = '42501';
  end if;

  insert into public.recovery_approvals (action_id, staff_user_id, decision, note)
  values (p_action, v_actor, p_decision, nullif(trim(p_note), ''))
  on conflict (action_id, staff_user_id) do nothing;

  select count(*) into v_approved from public.recovery_approvals
   where action_id = p_action and decision = 'approved';
  select count(*) into v_refused from public.recovery_approvals
   where action_id = p_action and decision = 'refused';

  if v_refused > 0 then
    update public.recovery_actions set status = 'refused' where id = p_action;
    perform app_private.audit(v_actor, 'fund.recovery_refused', 'recovery_actions', p_action,
                              null, jsonb_build_object('approvals', v_approved));
    return 'refused';
  end if;

  if v_approved >= 2 then
    update public.recovery_actions
       set status = 'approved', approved_at = coalesce(approved_at, now())
     where id = p_action;
    perform app_private.audit(v_actor, 'fund.recovery_approved', 'recovery_actions', p_action,
                              null, jsonb_build_object('approvals', v_approved,
                                                       'amount_minor', v_action.amount_minor));
    return 'approved';
  end if;

  perform app_private.audit(v_actor, 'fund.recovery_approval_recorded', 'recovery_actions',
                            p_action, null, jsonb_build_object('approvals', v_approved));
  return 'awaiting_approval';
end $$;
comment on function public.approve_recovery_action(uuid, text, text) is
  'F-109: one of the two staff who must approve a recovery action.';
revoke all on function public.approve_recovery_action(uuid, text, text) from public, anon;
grant execute on function public.approve_recovery_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Settling a recovery action
-- ---------------------------------------------------------------------------
-- The server asks the provider to send the money and then records it, so the money and the
-- ledger move together. A clawback needs no provider call: the money stays with the provider and
-- is simply not paid out to the vendor.
--
-- The clawback entry: the vendor is owed A less, and the recovery fund takes it.
--   vendor_payable:<vendor>  +A    the vendor's claim falls
--   recovery_fund             -A    the fund's balance rises
--
-- The advance entry: the fund pays the host A.
--   recovery_fund             +A    the fund's balance falls
--   paystack_clearing         -A    the cash leaves the provider
create function public.settle_recovery_action(p_action uuid, p_provider_reference text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_action  public.recovery_actions;
  v_key     text;
  v_entry   uuid;
  v_amount  bigint;
  v_available bigint;
begin
  select * into v_action from public.recovery_actions where id = p_action for update;
  if not found then
    raise exception 'recovery_action_not_found' using errcode = 'P0002';
  end if;
  if v_action.status = 'settled' then
    return 'settled';
  end if;
  if v_action.status <> 'approved' then
    raise exception 'recovery_action_not_approved' using errcode = '22023';
  end if;

  v_amount := v_action.amount_minor;

  if v_action.kind = 'advance' then
    if p_provider_reference is null
       or length(trim(p_provider_reference)) not between 1 and 120 then
      raise exception 'payment_reference_required' using errcode = '22023';
    end if;
    if app_private.looks_like_payment_credential(p_provider_reference) then
      raise exception 'payment_reference_rejected' using errcode = '22023';
    end if;

    -- The fund must still hold the money: it may have been drawn down since the approval.
    v_available := least(
      app_private.recovery_fund_balance(v_action.currency),
      (select paid_minor - refunded_minor from public.fund_pool where id = v_action.pool_id));
    if v_available < v_amount then
      raise exception 'insufficient_recovery_funds' using errcode = '22023';
    end if;

    v_key := 'recovery:' || p_action::text || ':advance';
    v_entry := app_private.post_entry(v_key, 'recovery_advance', 'paystack',
      v_action.source_booking_id,
      app_private.entry_lines(jsonb_build_array(
        jsonb_build_object('account', 'recovery_fund',
                           'amount_minor', v_amount, 'currency', v_action.currency),
        jsonb_build_object('account', 'paystack_clearing',
                           'amount_minor', -v_amount, 'currency', v_action.currency)
      )));

    insert into public.fund_pool_ledger
      (pool_id, booking_id, action_id, entry_id, movement, direction, amount_minor, currency,
       idempotency_key, memo)
    values (v_action.pool_id, v_action.source_booking_id, p_action, v_entry, 'advance', 'out',
            v_amount, v_action.currency, v_key, 'Advanced to the host for a replacement')
    on conflict (idempotency_key) do nothing;

    update public.recovery_actions
       set status = 'settled', settled_at = now(),
           provider_reference = trim(p_provider_reference)
     where id = p_action;

    perform app_private.audit(null, 'fund.recovery_settled', 'recovery_actions', p_action,
                              v_action.host_house_id,
                              jsonb_build_object('kind', 'advance', 'amount_minor', v_amount));
    perform app_private.notify(v_action.host_house_id, 'host', 'fund_advanced',
      'Money has been advanced to you',
      'We have advanced part of the cost of your replacement booking to you.',
      jsonb_build_object('booking_id', v_action.source_booking_id, 'amount_minor', v_amount),
      'fund_advanced|' || p_action);
  else
    v_key := 'recovery:' || p_action::text || ':clawback';
    v_entry := app_private.post_entry(v_key, 'recovery_clawback', 'staff',
      v_action.source_booking_id,
      app_private.entry_lines(jsonb_build_array(
        jsonb_build_object('account', 'vendor_payable:' || v_action.vendor_house_id::text,
                           'amount_minor', v_amount, 'currency', v_action.currency),
        jsonb_build_object('account', 'recovery_fund',
                           'amount_minor', -v_amount, 'currency', v_action.currency)
      )));

    insert into public.fund_pool_ledger
      (pool_id, booking_id, action_id, entry_id, movement, direction, amount_minor, currency,
       idempotency_key, memo)
    values (v_action.pool_id, v_action.source_booking_id, p_action, v_entry, 'clawback', 'in',
            v_amount, v_action.currency, v_key, 'Taken back from the vendor')
    on conflict (idempotency_key) do nothing;

    update public.recovery_actions
       set status = 'settled', settled_at = now()
     where id = p_action;

    perform app_private.audit(null, 'fund.recovery_settled', 'recovery_actions', p_action,
                              v_action.host_house_id,
                              jsonb_build_object('kind', 'clawback', 'amount_minor', v_amount));
  end if;

  return 'settled';
end $$;
comment on function public.settle_recovery_action(uuid, text) is
  'F-109: the money has moved, so the ledger follows.';
revoke all on function public.settle_recovery_action(uuid, text)
  from public, anon, authenticated;
grant execute on function public.settle_recovery_action(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- What the platform needs in order to pay an advance
-- ---------------------------------------------------------------------------
-- The charge the money came from, how much is owed to the host, and whether the recovery fund can
-- still cover it. The database answers all three, so the server never works them out for itself.
--
-- Only finance staff may ask. The answer names the provider's reference for the charge, so it is
-- never returned to a browser: the server reads it and pays with it.
create function public.recovery_payout_target(p_action uuid)
returns table (
  action_id         uuid,
  kind              text,
  status            text,
  amount_minor      bigint,
  currency          text,
  available_minor   bigint,
  payment_reference text,
  ready             boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor     uuid;
  v_action    public.recovery_actions;
  v_pool      public.fund_pool;
  v_available bigint;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null or app_private.staff_grant_for('finance') is null then
    raise exception 'forbidden: finance grant required' using errcode = '42501';
  end if;

  select * into v_action from public.recovery_actions where id = p_action;
  if not found then
    raise exception 'recovery_action_not_found' using errcode = 'P0002';
  end if;

  select * into v_pool from public.fund_pool where id = v_action.pool_id;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;

  -- The same bound the settlement applies: what the fund holds, and what the provider can still
  -- send back from this booking.
  v_available := least(
    app_private.recovery_fund_balance(v_action.currency),
    v_pool.paid_minor - v_pool.refunded_minor);

  return query select v_action.id, v_action.kind, v_action.status, v_action.amount_minor,
                      v_action.currency, v_available,
                      case when v_action.kind = 'advance'
                           then v_pool.payment_reference else null end,
                      v_action.status = 'approved'
                        and (v_action.kind = 'clawback'
                             or (v_available >= v_action.amount_minor
                                 and v_pool.payment_reference is not null));
end $$;
comment on function public.recovery_payout_target(uuid) is
  'F-109: what the platform needs in order to pay an approved recovery action.';
revoke all on function public.recovery_payout_target(uuid) from public, anon;
grant execute on function public.recovery_payout_target(uuid) to authenticated;

-- A recovery action that was asked for and is not wanted: nothing has moved, so nothing is
-- posted, and the trail says so.
create function public.void_recovery_action(p_action uuid, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid;
  v_action public.recovery_actions;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null or app_private.staff_grant_for('finance') is null then
    raise exception 'forbidden: finance grant required' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if app_private.looks_like_payment_credential(p_reason) then
    raise exception 'reason_rejected' using errcode = '22023';
  end if;

  select * into v_action from public.recovery_actions where id = p_action for update;
  if not found then
    raise exception 'recovery_action_not_found' using errcode = 'P0002';
  end if;
  if v_action.status in ('settled', 'void') then
    raise exception 'recovery_action_closed' using errcode = '22023';
  end if;

  update public.recovery_actions
     set status = 'void', voided_at = now()
   where id = p_action;

  perform app_private.audit(v_actor, 'fund.recovery_voided', 'recovery_actions', p_action,
                            v_action.host_house_id,
                            jsonb_build_object('reason', left(trim(p_reason), 200)));
  return 'void';
end $$;
comment on function public.void_recovery_action(uuid, text) is
  'F-109: a recovery action that was asked for and is not wanted. No money has moved.';
revoke all on function public.void_recovery_action(uuid, text) from public, anon;
grant execute on function public.void_recovery_action(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The split, calculated by the database
-- ---------------------------------------------------------------------------
-- The app asks the database what the 70/30 split is, rather than repeating the arithmetic. The
-- two tranches carry their own commission and tax, because each tranche is released on its own.
create function public.calculate_split_allocation(p_total_minor bigint, p_currency text)
returns table (
  release_70        bigint,
  release_30        bigint,
  commission_70     bigint,
  tax_70            bigint,
  vendor_net_70     bigint,
  commission_30     bigint,
  tax_30            bigint,
  vendor_net_30     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings app_private.payment_settings;
  v_70       bigint;
  v_30       bigint;
  v_fees70   record;
  v_fees30   record;
begin
  if p_total_minor is null or p_total_minor < 1 then
    raise exception 'invalid_total' using errcode = '22023';
  end if;
  if upper(trim(coalesce(p_currency, ''))) !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using errcode = '22023';
  end if;

  select * into v_settings from app_private.payment_settings where id;
  select s.release_70, s.release_30 into v_70, v_30
    from app_private.tranche_split(p_total_minor) s;

  select f.commission, f.tax, f.vendor_net into v_fees70
    from app_private.tranche_fees(v_70, v_settings) f;
  select f.commission, f.tax, f.vendor_net into v_fees30
    from app_private.tranche_fees(v_30, v_settings) f;

  return query select v_70, v_30,
                      v_fees70.commission, v_fees70.tax, v_fees70.vendor_net,
                      v_fees30.commission, v_fees30.tax, v_fees30.vendor_net;
end $$;
comment on function public.calculate_split_allocation(bigint, text) is
  'F-109: the 70/30 split of a booking total, with the fees of each tranche. The database is the only place it is calculated.';
revoke all on function public.calculate_split_allocation(bigint, text) from public, anon;
grant execute on function public.calculate_split_allocation(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Releasing a tranche whose window has closed
-- ---------------------------------------------------------------------------
-- The sweep (F-102's release_due_fund_tranches) has no scheduler yet, so a member of staff may run
-- it. This is not a discretionary fund action: the release happens only when the rules already
-- allow it — the window has closed, nothing is frozen and nothing has been refunded.
create function public.release_due_tranche(p_booking uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_state text;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('operations') is null
         and app_private.staff_grant_for('finance') is null) then
    raise exception 'forbidden: operations or finance grant required' using errcode = '42501';
  end if;

  v_state := app_private.release_tranche(p_booking, '30', 'staff', 'window_closed');
  if v_state = 'released' then
    perform app_private.audit(v_actor, 'fund.released', 'fund_pool',
                              (select id from public.fund_pool where booking_id = p_booking),
                              (select host_house_id from public.fund_pool where booking_id = p_booking),
                              jsonb_build_object('tranche', '30', 'reason', 'window_closed'));
  end if;
  return v_state;
end $$;
comment on function public.release_due_tranche(uuid) is
  'F-109: staff release the last 30% of a booking whose completion window has closed. The rules decide, not the person.';
revoke all on function public.release_due_tranche(uuid) from public, anon;
grant execute on function public.release_due_tranche(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reconciling the ledger with the payment router
-- ---------------------------------------------------------------------------
-- Who may ask for a reconciliation run. The answer is the database's, so the server never decides
-- on its own who may look at the money.
create function public.can_run_reconciliation()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.current_user_id() is not null
     and (app_private.staff_grant_for('finance') is not null
          or app_private.staff_grant_for('operations') is not null)
$$;
revoke all on function public.can_run_reconciliation() from public, anon;
grant execute on function public.can_run_reconciliation() to authenticated;

-- The provider's events and the ledger are compared. Nothing is moved and nothing is repaired:
-- the run says what disagrees, and a person decides. Every check is read-only.
create function public.reconcile_ledger()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_events    integer := 0;
  v_pools     integer := 0;
  v_matched   integer := 0;
  v_exceptions jsonb := '[]'::jsonb;
  v_row       record;
  v_pool      public.fund_pool;
  v_escrow    uuid;
  v_sum       bigint;
  v_keys      text[];
  v_has_entry boolean;
  v_recovery  record;
begin
  -- Every provider event that says money moved must have a journal entry behind it.
  for v_row in
    select e.event_type, e.reference, e.booking_id, e.amount_minor, e.outcome
      from public.payment_events e
     where e.outcome in ('allocated', 'settled')
  loop
    v_events := v_events + 1;
    if v_row.booking_id is null then
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
        'code', 'event_without_booking', 'event_type', v_row.event_type,
        'reference', v_row.reference));
      continue;
    end if;

    -- The booking's own money is keyed by the booking; a recovery advance is keyed by the action.
    -- A booking may have both, so every key that could carry the money counts.
    v_keys := case v_row.event_type
                when 'charge.success' then array['booking:' || v_row.booking_id::text || ':hold']
                else array['booking:' || v_row.booking_id::text || ':refund_settled']
              end;
    for v_recovery in
      select a.id from public.recovery_actions a
       where a.source_booking_id = v_row.booking_id
         and a.kind = 'advance'
         and a.status = 'settled'
    loop
      v_keys := v_keys || ('recovery:' || v_recovery.id::text || ':advance');
    end loop;

    select exists (select 1 from public.journal_entries j where j.idempotency_key = any(v_keys))
      into v_has_entry;
    if v_has_entry then
      v_matched := v_matched + 1;
    else
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
        'code', 'event_without_entry', 'event_type', v_row.event_type,
        'reference', v_row.reference));
    end if;
  end loop;

  -- Every pool's escrow must still say what the pool says it holds. The account is looked up, not
  -- created: a reconciliation that writes is not a reconciliation.
  for v_pool in select * from public.fund_pool where paid_minor > 0 loop
    v_pools := v_pools + 1;
    select a.id into v_escrow
      from public.ledger_accounts a
     where a.code = 'escrow'
       and a.owner_kind = 'booking'
       and a.owner_id = v_pool.booking_id
       and a.currency = v_pool.currency;
    if v_escrow is null then
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
        'code', 'pool_without_escrow_account', 'booking_id', v_pool.booking_id,
        'held_minor', v_pool.held_minor));
    else
      select coalesce(sum(p.amount_minor), 0)::bigint into v_sum
        from public.postings p where p.ledger_account_id = v_escrow;
      if -v_sum <> v_pool.held_minor then
        v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
          'code', 'pool_out_of_balance', 'booking_id', v_pool.booking_id,
          'held_minor', v_pool.held_minor, 'ledger_minor', -v_sum));
      else
        v_matched := v_matched + 1;
      end if;
    end if;
  end loop;

  -- The provider's charge and the pool must agree on the amount.
  for v_row in
    select e.reference, e.booking_id, e.amount_minor, p.paid_minor
      from public.payment_events e
      join public.fund_pool p on p.booking_id = e.booking_id
     where e.event_type = 'charge.success' and e.amount_minor is not null
  loop
    if v_row.amount_minor <> v_row.paid_minor then
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object(
        'code', 'amount_mismatch', 'reference', v_row.reference,
        'provider_minor', v_row.amount_minor, 'ledger_minor', v_row.paid_minor));
    end if;
  end loop;

  insert into public.ledger_reconciliations
    (provider, events_checked, pools_checked, matched, exception_count, status, exception_rows)
  values ('paystack', v_events, v_pools, v_matched,
          jsonb_array_length(v_exceptions),
          case when jsonb_array_length(v_exceptions) = 0 then 'matched' else 'exceptions' end,
          v_exceptions);

  return jsonb_build_object(
    'events_checked', v_events,
    'pools_checked', v_pools,
    'matched', v_matched,
    'exception_count', jsonb_array_length(v_exceptions),
    'exceptions', v_exceptions);
end $$;
comment on function public.reconcile_ledger() is
  'F-109: compare the provider''s events with the ledger and write down what disagrees. No money moves.';
revoke all on function public.reconcile_ledger() from public, anon, authenticated;
grant execute on function public.reconcile_ledger() to service_role;

-- ---------------------------------------------------------------------------
-- The refund that settles a recovery advance
-- ---------------------------------------------------------------------------
-- F-102's settle_refund raises unless the pool is waiting for a refund. The provider confirms the
-- advance's refund with an event of its own, and that event must not be an error: the money has
-- already been recorded by settle_recovery_action.
create or replace function public.settle_refund(p_booking uuid, p_reference text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pool  public.fund_pool;
  v_ref   text;
  v_recovery uuid;
begin
  v_ref := trim(coalesce(p_reference, ''));
  if length(v_ref) not between 1 and 120 then
    raise exception 'payment_reference_required' using errcode = '22023';
  end if;

  select * into v_pool from public.fund_pool where booking_id = p_booking for update;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;

  -- The provider is confirming a recovery advance this booking already settled. The provider's
  -- own refund reference names the advance; the charge reference names the booking, and it is the
  -- advance's confirmation only when the host has no refund of their own outstanding.
  select a.id into v_recovery
    from public.recovery_actions a
   where a.source_booking_id = p_booking
     and a.kind = 'advance'
     and a.status = 'settled'
     and a.provider_reference is not null
     and (a.provider_reference = v_ref
          or (v_ref = v_pool.payment_reference and v_pool.refunded_minor = 0));
  if v_recovery is not null then
    return 'settled';
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
  'F-102: the provider has sent the money back, so the ledger follows. F-109: a recovery advance on this booking is already recorded, so the provider''s confirmation changes nothing.';
revoke all on function public.settle_refund(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_refund(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The provider event, with the recovery advance in it
-- ---------------------------------------------------------------------------
-- F-102's record_payment_event is unchanged except for one thing: a recovery advance is settled
-- when the server asks the provider to send the money, so the provider's confirmation of it is
-- news the ledger already has. The provider names the refund it sent with its own refund
-- reference, and that is what identifies the confirmation. Without this the confirmation would be
-- read as a refund of the booking's own money and would settle it early.
create or replace function public.record_payment_event(
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
    -- F-109: the confirmation of a recovery advance. The money was recorded when the server asked
    -- the provider to send it, so nothing is settled twice.
    if exists (
      select 1 from public.recovery_actions a
       where a.source_booking_id = v_booking
         and a.kind = 'advance'
         and a.status = 'settled'
         and a.provider_reference is not null
         and a.provider_reference = coalesce(p_payload ->> 'refund_reference', '')
    ) then
      v_outcome := 'settled';
    else
      perform public.settle_refund(v_booking, trim(p_reference));
      v_outcome := 'settled';
    end if;
  else
    v_outcome := 'ignored';
  end if;

  update public.payment_events
     set outcome = v_outcome, booking_id = v_booking
   where id = v_event;

  return v_outcome;
end $$;
comment on function public.record_payment_event(text, text, bigint, text, jsonb, uuid) is
  'F-102: one provider event, recorded once. The event and the money move together. F-109: the confirmation of a recovery advance settles nothing, because the advance was settled when it was sent.';
revoke all on function public.record_payment_event(text, text, bigint, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.record_payment_event(text, text, bigint, text, jsonb, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security: every read is a projection, every write is a function
-- ---------------------------------------------------------------------------
alter table public.recovery_actions enable row level security;
alter table public.recovery_actions force row level security;
alter table public.recovery_approvals enable row level security;
alter table public.recovery_approvals force row level security;
alter table public.fund_pool_ledger enable row level security;
alter table public.fund_pool_ledger force row level security;
alter table public.ledger_reconciliations enable row level security;
alter table public.ledger_reconciliations force row level security;

revoke all on public.recovery_actions, public.recovery_approvals, public.fund_pool_ledger,
                public.ledger_reconciliations
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authorized projections for the staff console
-- ---------------------------------------------------------------------------
-- The recovery fund: what it holds, what was taken back and what was advanced, per currency.
create function public.recovery_fund_balances()
returns table (
  currency         text,
  balance_minor    bigint,
  clawed_back_minor bigint,
  advanced_minor   bigint,
  open_actions     integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row   record;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('finance') is null
         and app_private.staff_grant_for('operations') is null
         and app_private.staff_grant_for('support') is null) then
    raise exception 'forbidden: staff grant required' using errcode = '42501';
  end if;

  for v_row in
    select c.currency
      from (select distinct currency from public.fund_pool
             union select distinct currency from public.fund_pool_ledger) c
  loop
    return query
      select v_row.currency,
             app_private.recovery_fund_balance(v_row.currency),
             coalesce((select sum(l.amount_minor) from public.fund_pool_ledger l
                        where l.currency = v_row.currency and l.movement = 'clawback'), 0)::bigint,
             coalesce((select sum(l.amount_minor) from public.fund_pool_ledger l
                        where l.currency = v_row.currency and l.movement = 'advance'), 0)::bigint,
             (select count(*)::integer from public.recovery_actions a
               where a.currency = v_row.currency and a.status in ('requested', 'approved'));
  end loop;
end $$;
comment on function public.recovery_fund_balances() is
  'F-109: what the recovery fund holds, per currency.';
revoke all on function public.recovery_fund_balances() from public, anon;
grant execute on function public.recovery_fund_balances() to authenticated;

-- The recovery actions, newest first, with who asked and who approved.
create function public.list_recovery_actions(p_status text default null)
returns table (
  action_id         uuid,
  reference         text,
  kind              text,
  status            text,
  case_id           uuid,
  case_reference    text,
  booking_id        uuid,
  pool_id           uuid,
  currency          text,
  amount_minor      bigint,
  replacement_cost_minor bigint,
  requested_by      uuid,
  requested_by_name text,
  approvals         integer,
  requested_at      timestamptz,
  approved_at       timestamptz,
  settled_at        timestamptz,
  reason            text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('finance') is null
         and app_private.staff_grant_for('operations') is null
         and app_private.staff_grant_for('support') is null) then
    raise exception 'forbidden: staff grant required' using errcode = '42501';
  end if;

  return query
    select a.id, a.reference, a.kind, a.status, a.case_id, c.reference, a.source_booking_id,
           a.pool_id,
           a.currency, a.amount_minor, a.replacement_cost_minor, a.requested_by,
           coalesce(u.display_name, ''),
           (select count(*)::integer from public.recovery_approvals ap
             where ap.action_id = a.id and ap.decision = 'approved'),
           a.requested_at, a.approved_at, a.settled_at, a.reason
      from public.recovery_actions a
      join public.cases c on c.id = a.case_id
      left join public.users u on u.id = a.requested_by
     where p_status is null or a.status = p_status
     order by a.created_at desc;
end $$;
comment on function public.list_recovery_actions(text) is
  'F-109: the recovery actions, for the staff console.';
revoke all on function public.list_recovery_actions(text) from public, anon;
grant execute on function public.list_recovery_actions(text) to authenticated;

-- ---------------------------------------------------------------------------
-- What a case is about, before money is asked to move
-- ---------------------------------------------------------------------------
-- The console needs the currency and the pool before anyone types an amount: the money of a case
-- is counted in the currency of its booking, and the recovery fund is a balance per currency. It
-- also shows what the platform still owes the vendor, which is the ceiling of a clawback.
create function public.recovery_case_context(p_case uuid)
returns table (
  case_id              uuid,
  case_reference       text,
  case_status          text,
  booking_id           uuid,
  pool_id              uuid,
  currency             text,
  paid_minor           bigint,
  refunded_minor       bigint,
  vendor_payable_minor bigint,
  fund_balance_minor   bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_case  public.cases;
  v_pool  public.fund_pool;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('finance') is null
         and app_private.staff_grant_for('operations') is null
         and app_private.staff_grant_for('support') is null
         and app_private.staff_grant_for('arbitrator') is null) then
    raise exception 'forbidden: staff grant required' using errcode = '42501';
  end if;

  select * into v_case from public.cases where id = p_case;
  if not found then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  if v_case.booking_id is null then
    raise exception 'case_has_no_booking' using errcode = '22023';
  end if;

  select * into v_pool from public.fund_pool where booking_id = v_case.booking_id;
  if not found then
    raise exception 'fund_pool_not_found' using errcode = 'P0002';
  end if;

  return query select v_case.id, v_case.reference, v_case.status, v_case.booking_id, v_pool.id,
                      v_pool.currency, v_pool.paid_minor, v_pool.refunded_minor,
                      app_private.vendor_payable_balance(v_pool.vendor_house_id, v_pool.currency),
                      app_private.recovery_fund_balance(v_pool.currency);
end $$;
comment on function public.recovery_case_context(uuid) is
  'F-109: the money a case is about, so staff can see the currency and the ceiling before asking.';
revoke all on function public.recovery_case_context(uuid) from public, anon;
grant execute on function public.recovery_case_context(uuid) to authenticated;

-- The recovery money that moved for one pool.
create function public.fund_pool_ledger_entries(p_pool uuid)
returns table (
  movement     text,
  direction    text,
  amount_minor bigint,
  currency     text,
  memo         text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('finance') is null
         and app_private.staff_grant_for('operations') is null
         and app_private.staff_grant_for('support') is null) then
    raise exception 'forbidden: staff grant required' using errcode = '42501';
  end if;

  return query
    select l.movement, l.direction, l.amount_minor, l.currency, l.memo, l.created_at
      from public.fund_pool_ledger l
     where l.pool_id = p_pool
     order by l.created_at;
end $$;
comment on function public.fund_pool_ledger_entries(uuid) is
  'F-109: the recovery money that moved for one fund pool.';
revoke all on function public.fund_pool_ledger_entries(uuid) from public, anon;
grant execute on function public.fund_pool_ledger_entries(uuid) to authenticated;

-- The pools whose completion window has closed and whose last tranche is waiting.
create function public.due_fund_pools()
returns table (
  pool_id           uuid,
  booking_id       uuid,
  host_house_id    uuid,
  vendor_house_id  uuid,
  currency         text,
  total_minor      bigint,
  paid_minor       bigint,
  held_minor       bigint,
  released_70_minor bigint,
  release_30_due_at timestamptz,
  frozen           boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := app_private.current_user_id();
  if v_actor is null
     or (app_private.staff_grant_for('finance') is null
         and app_private.staff_grant_for('operations') is null) then
    raise exception 'forbidden: staff grant required' using errcode = '42501';
  end if;

  return query
    select p.id, p.booking_id, p.host_house_id, p.vendor_house_id, p.currency, p.total_minor,
           p.paid_minor, p.held_minor, p.released_70_minor, p.release_30_due_at, p.frozen
      from public.fund_pool p
     where p.paid_minor > 0
       and p.released_70_minor > 0
       and p.released_30_minor = 0
       and p.refunded_minor = 0
       and p.release_30_due_at is not null
       and p.release_30_due_at <= now()
     order by p.release_30_due_at;
end $$;
comment on function public.due_fund_pools() is
  'F-109: the pools whose completion window has closed and whose last tranche is waiting.';
revoke all on function public.due_fund_pools() from public, anon;
grant execute on function public.due_fund_pools() to authenticated;
