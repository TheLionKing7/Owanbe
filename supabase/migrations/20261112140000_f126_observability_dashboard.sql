-- F-126 Monitoring/observability tool: the platform's operational dashboard
-- The audit found that the monitoring modules exist (browser, config, privacy) but there is no
-- unified observability dashboard. This file is that dashboard's data source: one function that
-- reads the platform's operational records and answers with counters, so an operations lead can
-- see what needs a person without opening six tables.
--
-- The blueprint names the dashboard's content (blueprint/tech-spec.md §11 line 281):
--   "Dashboard: update latency, payment ambiguity, reconciliation differences, overdue timers,
--    retry exhaustion, verification SLA, notification failures, scanner conflicts and deletion
--    backlog."
-- and blueprint/architecture.md §Observability:
--   "Track payment reconciliation differences, webhook lag, outbox age, overdue timers, refund
--    backlog, verification SLA breaches, notification failures, and search freshness. The
--    monitoring dashboard reads operational records; an assigned on-call owner and tested alert
--    delivery are launch requirements."
--
-- What this file can honestly answer today, and why:
--   * payment ambiguity            -> public.payment_events.outcome is null
--   * webhook lag                  -> the age of the oldest event with no outcome
--   * reconciliation differences   -> public.fund_pool.paid_minor vs the ledger's 'in' movements
--   * overdue timers               -> public.fund_pool.release_30_due_at in the past
--   * refund backlog               -> public.fund_pool.status = 'refund_pending'
--   * notification failures        -> public.notifications kind 'payment_window_closed'
--   * frozen money, failed charges, open cases, AI hand-offs, unread alerts, sensitive reads
-- What it cannot answer, and does not pretend to:
--   * update latency               -> no latency is recorded anywhere in this platform yet
--   * retry exhaustion             -> F-73 (Real-time Job Monitoring & Alerting) has no job records
--   * verification SLA             -> F-53 (Vendor Verification Review Queue) has no queue yet
--   * scanner conflicts            -> F-62 (Upload Moderation & Takedown) is not built
--   * deletion backlog             -> F-58 (Data Rights) is not built
--   * outbox age                   -> no outbox table exists in this platform yet
--   * on-call owner and alert delivery -> F-73; the blueprint calls them launch requirements
--     and this file does not claim them.
--
-- Invariants this file owns:
--   * only a staff member holding the existing 'operations' capability may read the dashboard.
--     No new capability is invented: 'operations' already exists and already means the
--     platform-operations role (blueprint/tech-spec.md §14: "Operations: approvals, disputes,
--     no-shows, replacements, subscriptions, timers and monitoring").
--   * the dashboard returns counters only. No amount, no party name, no email address, no
--     provider reference and no house identifier leaves the database through this function, so
--     reading it cannot become a way to read a person's money.
--   * every read is audited: the dashboard writes one 'observability.viewed' row naming the grant
--     that was exercised, so "who looked at the platform's money" is answerable afterwards.
--   * the function is the only way in. The tables it reads are revoked from every application
--     role, so no caller can skip the gate by selecting the tables directly.
--
-- Depends on 20261109140000_f102_fund_pool.sql (fund_pool, payment_events, wallet_ledger,
-- notifications), 20261109180000_f107_owanbe_ai.sql (cases, ai_interactions) and
-- 20261101020000_f77_data_model.sql (staff_grants, audit_events).
-- Acceptance criteria: docs/journal/2026-11-13-F-126-observability-dashboard.md

-- ---------------------------------------------------------------------------
-- The dashboard
-- ---------------------------------------------------------------------------
-- One row per signal: the key, the label to show, the count, what the count means, and how
-- urgent it is.
--
-- Severity is a reading rule, not a threshold: a signal that says money is unaccounted for is
-- 'critical'; a signal that is a queue of work is 'attention'; a signal that only counts activity
-- is 'info'. No number here decides whether money moves.
create function public.observability_dashboard()
returns table (
  signal_key   text,
  signal_label text,
  signal_value bigint,
  detail       text,
  severity     text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_grant uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  v_grant := app_private.staff_grant_for('operations');
  if v_grant is null then
    raise exception 'forbidden: operations grant required' using errcode = '42501';
  end if;

  -- The read is recorded against the grant that allowed it. The grant is the honest target:
  -- there is no row in a table for "the dashboard", and the grant is what was exercised.
  perform app_private.audit(v_actor, 'observability.viewed', 'staff_grants', v_grant, null,
                            jsonb_build_object('scope', 'operations_dashboard'));

  return query
  with ambiguity as (
    -- A provider event with no outcome written back: the platform cannot say whether the money
    -- arrived. These are the rows a webhook retry or a manual decision still has to settle.
    select count(*)::bigint as n,
           coalesce(floor(extract(epoch from (now() - min(created_at))) / 60)::bigint, 0)::bigint
             as lag_minutes
      from public.payment_events
     where outcome is null
  ),
  reconciliation as (
    -- The recorded payment and the ledger trail for the same booking must agree. Where they do
    -- not, one of the two is wrong and a person has to look.
    select count(*)::bigint as n
      from public.fund_pool p
     where p.paid_minor <> coalesce((
             select sum(w.amount_minor)
               from public.wallet_ledger w
              where w.booking_id = p.booking_id
                and w.direction = 'in'), 0)
  ),
  overdue as (
    -- Money still held past the date it was due to be released, and not frozen: the deadline
    -- passed and nobody acted.
    select count(*)::bigint as n
      from public.fund_pool
     where release_30_due_at is not null
       and release_30_due_at < now()
       and held_minor > 0
       and not frozen
       and status in ('held', 'partially_released')
  ),
  refunds as (
    select count(*)::bigint as n from public.fund_pool where status = 'refund_pending'
  ),
  frozen as (
    select count(*)::bigint as n from public.fund_pool where frozen
  ),
  failures as (
    select count(*)::bigint as n
      from public.payment_events
     where event_type = 'charge.failed'
       and created_at > now() - interval '24 hours'
  ),
  closed_windows as (
    select count(*)::bigint as n
      from public.notifications
     where kind = 'payment_window_closed'
  ),
  open_cases as (
    select count(*)::bigint as n
      from public.cases
     where status in ('open', 'investigating', 'waiting_on_customer')
  ),
  ai_human as (
    select count(*)::bigint as n
      from public.ai_interactions
     where outcome = 'needs_human'
  ),
  unread as (
    select count(*)::bigint as n
      from public.notifications
     where read_at is null
  ),
  sensitive_reads as (
    select count(*)::bigint as n
      from public.audit_events
     where action = 'sensitive.read'
       and occurred_at > now() - interval '24 hours'
  )
  select t.signal_key, t.signal_label, t.signal_value, t.detail, t.severity
    from (values
      ('payment_ambiguity',
       'Provider events with no outcome',
       (select n from ambiguity),
       'A payment event nobody has decided yet, so the platform cannot say whether the money arrived.',
       'critical'),
      ('webhook_lag_minutes',
       'Oldest undecided payment event (minutes)',
       (select lag_minutes from ambiguity),
       'How long the oldest provider event has gone without an outcome being written back.',
       'critical'),
      ('reconciliation_differences',
       'Bookings whose ledger does not add up',
       (select n from reconciliation),
       'A booking where the recorded payment and its ledger trail disagree.',
       'critical'),
      ('overdue_release',
       'Releases past their deadline',
       (select n from overdue),
       'Money still held after the date it was due to be released.',
       'critical'),
      ('refund_backlog',
       'Refunds owed and not yet settled',
       (select n from refunds),
       'Bookings whose refund has been asked for but not settled.',
       'critical'),
      ('frozen_money',
       'Pools frozen by a dispute',
       (select n from frozen),
       'Held money an arbitrator has frozen. This is deliberate, not a fault.',
       'attention'),
      ('failed_charges_24h',
       'Failed charges in the last 24 hours',
       (select n from failures),
       'Charges the payment provider refused.',
       'attention'),
      ('payment_windows_closed',
       'Payment windows that closed unpaid',
       (select n from closed_windows),
       'Bookings whose payment window closed before the money arrived.',
       'attention'),
      ('open_cases',
       'Cases still open',
       (select n from open_cases),
       'Cases waiting for a person to work through them.',
       'attention'),
      ('ai_needs_human',
       'AI answers that need a person',
       (select n from ai_human),
       'Investigations the AI could not settle and handed to a person.',
       'attention'),
      ('unread_alerts',
       'Unread house alerts',
       (select n from unread),
       'Alerts written to a house that nobody has read.',
       'info'),
      ('sensitive_reads_24h',
       'Sensitive reads in the last 24 hours',
       (select n from sensitive_reads),
       'Every sensitive record read, with its purpose, in the last day.',
       'info')
    ) as t(signal_key, signal_label, signal_value, detail, severity);
end $$;
revoke all on function public.observability_dashboard() from public, anon;
grant execute on function public.observability_dashboard() to authenticated;

comment on function public.observability_dashboard() is
  'F-126: the operations dashboard. Counters only, for staff holding the ''operations'' capability. Every read is audited.';

notify pgrst, 'reload schema';
