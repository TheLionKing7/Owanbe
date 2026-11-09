-- Read-only database state check. Plain SQL, no psql metacommands: paste the whole file into the
-- Supabase Dashboard SQL editor (or run it with any client) and it answers one question — which of
-- this repository's migrations are actually present in THIS database.
--
-- It exists because migrations here have been applied by hand, more than once, in no recorded order.
-- Re-running an applied file fails with 42723 "function ... already exists" (that is what F-78 did on
-- 2026-11-05) and aborts at its first statement, so a duplicate apply tells you nothing about whether
-- the rest of the file landed. This check does.
--
-- Nothing here writes, so it is safe on production.

select
  w.kind,
  w.object,
  case
    when w.kind = 'table' then exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = w.schema and c.relname = w.name and c.relkind in ('r', 'p')
    )
    when w.kind = 'constraint' then exists (
      select 1 from pg_constraint k where k.conname = w.name
    )
    else exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = w.schema and p.proname = w.name
    )
  end as present,
  w.migration
from (values
  -- F-77 data model (and the app_private schema every later file writes into)
  ('schema', 'schema',    'app_private',                            '20261101020000_f77'),
  ('table',  'public',    'houses',                                 '20261101020000_f77'),
  ('table',  'public',    'users',                                  '20261101020000_f77'),
  ('table',  'public',    'memberships',                             '20261101020000_f77'),
  ('table',  'public',    'staff_grants',                            '20261101020000_f77'),
  ('table',  'public',    'assignments',                             '20261101020000_f77'),
  ('table',  'public',    'audit_events',                            '20261101020000_f77'),
  -- F-14 quote lifecycle
  ('table',  'public',    'quotes',                                  '20261104120000_f14'),
  ('table',  'public',    'quote_revisions',                         '20261104120000_f14'),
  ('table',  'public',    'quote_date_locks',                        '20261104120000_f14'),
  ('function','public',   'create_quote',                            '20261104120000_f14'),
  ('function','public',   'send_quote',                              '20261104120000_f14'),
  ('function','public',   'accept_quote',                            '20261104120000_f14'),
  ('function','app_private','quote_lines_valid',                     '20261104120000_f14'),
  -- F-38 soft holds, payment windows, notifications
  ('table',  'public',    'quote_payment_holds',                     '20261104160000_f38'),
  ('table',  'public',    'refund_obligations',                      '20261104160000_f38'),
  ('table',  'public',    'notifications',                           '20261104160000_f38'),
  ('function','public',   'record_payment_confirmation',             '20261104160000_f38'),
  ('function','public',   'my_date_holds',                           '20261104160000_f38'),
  ('function','public',   'my_notifications',                        '20261104160000_f38'),
  ('function','public',   'set_vendor_daily_capacity',               '20261104160000_f38'),
  -- F-60 credential detectors and the constraints that use them
  ('function','app_private','luhn_valid',                            '20261105120000_f60'),
  ('function','app_private','looks_like_payment_credential',         '20261105120000_f60'),
  ('function','app_private','looks_like_credential_key',             '20261105120000_f60'),
  ('function','app_private','jsonb_has_payment_credential',          '20261105120000_f60'),
  ('constraint','public',  'quote_payment_holds_reference_not_credential', '20261105120000_f60'),
  ('constraint','public',  'refund_obligations_reference_not_credential',  '20261105120000_f60'),
  ('constraint','public',  'audit_events_details_no_credentials',          '20261105120000_f60'),
  ('constraint','public',  'audit_events_purpose_not_credential',          '20261105120000_f60'),
  ('constraint','public',  'notifications_content_no_credentials',         '20261105120000_f60'),
  ('constraint','public',  'quote_revisions_text_no_credentials',          '20261105120000_f60'),
  ('constraint','public',  'quotes_close_note_not_credential',             '20261105120000_f60'),
  -- F-78 permission scoping: the file that reported 42723
  ('function','app_private','owner_only_capabilities',               '20261104000000_f78'),
  ('function','app_private','all_house_capabilities',                '20261104000000_f78'),
  ('function','app_private','house_can',                             '20261104000000_f78'),
  ('function','public',   'house_can',                               '20261104000000_f78'),
  ('function','app_private','require_house_capability',              '20261104000000_f78'),
  ('function','public',   'set_member_capabilities',                 '20261104000000_f78'),
  ('function','public',   'revoke_member',                           '20261104000000_f78'),
  ('function','app_private','staff_grant_for',                       '20261104000000_f78'),
  ('function','app_private','log_sensitive_read',                    '20261104000000_f78'),
  ('function','public',   'support_house_members',                   '20261104000000_f78'),
  ('function','public',   'authorize_sensitive_read',                '20261104000000_f78'),
  -- F-7 sign-up onboarding
  ('table',  'public',    'onboarding_profiles',                     '20261107090000_f7'),
  ('function','public',   'my_onboarding',                           '20261107090000_f7'),
  ('function','public',   'save_onboarding',                         '20261107090000_f7'),
  ('function','public',   'complete_onboarding',                     '20261107090000_f7'),
  -- F-40 guest list privacy
  ('table',  'public',    'guest_lists',                             '20261108120000_f40'),
  ('table',  'public',    'rsvps',                                   '20261108120000_f40'),
  ('table',  'public',    'guest_list_shares',                       '20261108120000_f40'),
  ('function','public',   'create_guest_list',                       '20261108120000_f40'),
  ('function','public',   'add_guest_rsvp',                          '20261108120000_f40'),
  ('function','public',   'set_guest_list_visibility',               '20261108120000_f40'),
  ('function','public',   'share_guest_list',                        '20261108120000_f40'),
  ('function','public',   'revoke_guest_list_share',                 '20261108120000_f40'),
  ('function','public',   'my_guest_lists',                          '20261108120000_f40'),
  ('function','public',   'guest_list_rsvps',                        '20261108120000_f40'),
  ('function','public',   'guest_list_recipients',                   '20261108120000_f40'),
  ('function','public',   'shared_with_me',                          '20261108120000_f40'),
  ('function','public',   'shared_guest_list',                       '20261108120000_f40'),
  ('function','public',   'public_guest_list',                       '20261108120000_f40')
) as w(kind, schema, name, migration)
order by w.migration, w.kind, w.name;

-- F-78 is the only one of these files that both creates functions and drops them again would be a
-- regression, so a partial apply is repaired by re-creating only what is missing. This lists exactly
-- which F-78 signatures are present, argument types included, so a re-run can be scoped to the gap.
select
  n.nspname as schema,
  p.proname as function,
  pg_get_function_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('app_private', 'public')
  and p.proname in ('owner_only_capabilities', 'all_house_capabilities', 'house_can',
                    'require_house_capability', 'set_member_capabilities', 'revoke_member',
                    'staff_grant_for', 'log_sensitive_read', 'support_house_members',
                    'authorize_sensitive_read')
order by 1, 2, 3;

-- Default-deny check. A table with relrowsecurity = false is readable by every role that has grants
-- on it, which is the one thing AGENTS.md does not allow for application data. This is deliberately
-- a catalog read rather than a count: counting from a table that a later migration has not created
-- would abort the whole script before the answers above were returned.
select
  n.nspname as schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname not in ('spatial_ref_sys')
order by c.relrowsecurity, c.relname;

