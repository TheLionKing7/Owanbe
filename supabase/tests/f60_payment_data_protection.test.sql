-- F-60 payment data protection tests. Raises on the first failure.
-- Each suite file runs in its own psql session, so the fixtures below are rebuilt rather than
-- borrowed from f38_soft_hold.test.sql. Every refusal this feature promises is attempted for real —
-- a typo in a constraint name, a missing grant, or a detector that only looks right on paper fails
-- here instead of in front of an auditor.
\set ON_ERROR_STOP on
\o /dev/null
select app_private.configure_auth0('owanbe.us.auth0.com', 'https://api.owanbe.app');

create function pg_temp.claims(sub text) returns text language sql as $$
  select jsonb_build_object('sub', sub, 'iss', 'https://owanbe.us.auth0.com/', 'aud', 'https://api.owanbe.app',
    'role', 'authenticated', 'exp', extract(epoch from now())::bigint + 3600)::text
$$;
create function pg_temp.expect_error(stmt text, fragment text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected error containing "%" but statement succeeded: %', fragment, stmt;
exception when others then
  if position(fragment in sqlerrm) = 0 then
    raise exception 'expected error containing "%", got "%"', fragment, sqlerrm;
  end if;
end $$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixtures: one vendor, one host, one accepted quote with a payment window open
-- ---------------------------------------------------------------------------
insert into public.users (auth0_sub, email, display_name) values
  ('auth0|f60-viki', 'viki60@example.test', 'Viki Fabrics'),
  ('auth0|f60-ada',  'ada60@example.test',  'Ada Adebayo');

insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', u.id, 'F60 Vendor' from public.users u where u.auth0_sub = 'auth0|f60-viki';
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', u.id, 'F60 Ada' from public.users u where u.auth0_sub = 'auth0|f60-ada';

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select h.id, h.kind, h.owner_user_id, 'owner', '{}' from public.houses h
  where h.display_name like 'F60 %';

create temp table ids (vendor uuid, ada uuid, service_date date);
insert into ids
  select (select id from public.houses where display_name = 'F60 Vendor'),
         (select id from public.houses where display_name = 'F60 Ada'),
         current_date + 210;

create temp table q1 (id uuid);
create temp table outcome (which text, value text);
grant select on ids to authenticated, service_role;
grant select, insert on q1, outcome to authenticated, service_role;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f60-viki'), true);
  insert into q1 select public.create_quote(vendor, ada, service_date, 'NGN', 'Ada: aso ebi',
    '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb) from ids;
  select public.send_quote(q.id, q.version) from q1 join public.quotes q on q.id = q1.id;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f60-ada'), true);
  select public.accept_quote(q.id, q.version) from q1 join public.quotes q on q.id = q1.id;
commit;

do $$ begin
  assert exists (select 1 from public.quote_payment_holds
                  where quote_id = (select id from q1) and status = 'awaiting_payment'),
    'there is a live payment window for the guard to protect';
end $$;

-- ---------------------------------------------------------------------------
-- 1. The detector: what a credential is
-- ---------------------------------------------------------------------------
do $$ begin
  -- The published test card and every shape a person types it in.
  assert app_private.looks_like_payment_credential('4242424242424242'), 'bare PAN';
  assert app_private.looks_like_payment_credential('4242 4242 4242 4242'), 'spaced PAN';
  assert app_private.looks_like_payment_credential('4242-4242-4242-4242'), 'dashed PAN';
  assert app_private.looks_like_payment_credential('5555 5555 5555 4444'), 'second test card';
  assert app_private.looks_like_payment_credential('378282246310005'), 'amex-length card';
  assert app_private.looks_like_payment_credential('charge 4242424242424242 now'), 'inside a sentence';
  -- A printed card is refused even when its checksum is nonsense.
  assert app_private.looks_like_payment_credential('1234 5678 9012 3457'), 'four groups of four';
  -- A bank account, quoted the way one is handed over.
  assert app_private.looks_like_payment_credential('transfer to 0123456789'), 'transfer to';
  assert app_private.looks_like_payment_credential('Account Number: 1234567890'), 'account number';
  assert app_private.looks_like_payment_credential('pay my acct 12345678'), 'acct';
  assert app_private.looks_like_payment_credential('beneficiary 0987654321'), 'beneficiary';

  -- Everything a legitimate write actually contains.
  assert not app_private.looks_like_payment_credential('psp_ada_1'), 'partner reference';
  assert not app_private.looks_like_payment_credential('1730000000000'), 'epoch milliseconds';
  assert not app_private.looks_like_payment_credential('2026-11-05 09:00:00.000'), 'timestamp';
  assert not app_private.looks_like_payment_credential('invoice 20261105120000'), 'invoice stamp';
  assert not app_private.looks_like_payment_credential('3f2a1c9e-77d3-4f4d-9d3f-1a2b3c4d5e6f'), 'uuid';
  assert not app_private.looks_like_payment_credential('NGN 100000'), 'amount';
  assert not app_private.looks_like_payment_credential(''), 'empty text';

  -- The checksum, and why an unrelated long number is safe.
  assert app_private.luhn_valid('4242424242424242'), 'test card checksums';
  assert not app_private.luhn_valid('4242424242424243'), 'one digit off';
  assert not app_private.luhn_valid('4242 4242 4242 4242'), 'digits only';

  -- Null behaves like an absent column instead of a violation.
  assert app_private.looks_like_payment_credential(null) is null, 'strict, so null checks pass';

  -- Key names, whatever they carry. Partner tokens must stay legal.
  assert app_private.looks_like_credential_key('pan'), 'pan';
  assert app_private.looks_like_credential_key('card_number'), 'card_number';
  assert app_private.looks_like_credential_key('cardNo'), 'cardNo';
  assert app_private.looks_like_credential_key('cvv'), 'cvv';
  assert app_private.looks_like_credential_key('account_number'), 'account_number';
  assert app_private.looks_like_credential_key('iban'), 'iban';
  assert app_private.looks_like_credential_key('bvn'), 'bvn';
  assert app_private.looks_like_credential_key('password'), 'password';
  assert app_private.looks_like_credential_key('api_key'), 'api_key';
  assert not app_private.looks_like_credential_key('reference'), 'partner reference key';
  assert not app_private.looks_like_credential_key('access_code'), 'partner access code';
  assert not app_private.looks_like_credential_key('card_token'), 'partner card token';
  assert not app_private.looks_like_credential_key('house_id'), 'ordinary id';
  assert not app_private.looks_like_credential_key('line_total_minor'), 'amount key';
  assert not app_private.looks_like_credential_key('spending'), 'pin inside a word';

  -- Nested documents, including a PAN hidden under a harmless key and inside an array.
  assert app_private.jsonb_has_payment_credential(
    '{"note":"card 4242424242424242"}'::jsonb), 'credential value in an object';
  assert app_private.jsonb_has_payment_credential(
    '{"a":{"b":["safe","4242 4242 4242 4242"]}}'::jsonb), 'credential in a nested array';
  assert app_private.jsonb_has_payment_credential(
    '{"card_number":"never shown"}'::jsonb), 'credential key name';
  assert not app_private.jsonb_has_payment_credential(
    jsonb_build_object('quote_id', (select id from q1), 'service_date', (select service_date from ids),
                       'slot', 1, 'total_minor', 100000)), 'identifiers and amounts are fine';
  assert not app_private.jsonb_has_payment_credential(
    '{"reference":"psp_ada_1","access_code":"3f2a1c9e","card_token":"tk_9"}'::jsonb),
    'partner tokens are exactly what we keep';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The payment path: the service role cannot store a card in the reference
-- ---------------------------------------------------------------------------
begin;
  set local role service_role;
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from q1), '4242424242424242', 100000, 'NGN'), 'credential');
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from q1), '4242 4242 4242 4242', 100000, 'NGN'), 'credential');
  select pg_temp.expect_error(format(
    'select public.record_payment_confirmation(%L, %L, %L, %L)',
    (select id from q1), 'transfer to 0123456789', 100000, 'NGN'), 'credential');
commit;

do $$ begin
  assert (select status from public.quote_payment_holds
           where quote_id = (select id from q1)) = 'awaiting_payment',
    'a refused payment leaves the window exactly as it was';
  assert (select payment_reference from public.quote_payment_holds
           where quote_id = (select id from q1)) is null, 'nothing was written';
  assert not exists (select 1 from public.refund_obligations),
    'a refusal is not recorded as money owed';
  assert not exists (select 1 from public.audit_events where action = 'payment.confirmed'),
    'and it is not audited as a confirmation';
end $$;

begin;
  set local role service_role;
  insert into outcome select 'confirmation', public.record_payment_confirmation(
    (select id from q1), 'psp_f60_ada_1', 100000, 'NGN');
commit;

do $$ begin
  assert (select value from outcome where which = 'confirmation') = 'confirmed',
    'a real partner reference still gets through — the guard must not block payments';
  assert (select payment_reference from public.quote_payment_holds
           where quote_id = (select id from q1)) = 'psp_f60_ada_1', 'and it is stored';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The other four sinks refuse too
-- ---------------------------------------------------------------------------
begin;
  select pg_temp.expect_error($q$
    insert into public.refund_obligations (quote_id, hold_id, vendor_house_id, host_house_id,
      service_date, refund_minor, currency, payment_reference, reason)
    select q1.id, h.id, h.vendor_house_id, h.host_house_id, h.service_date, 100000, 'NGN',
           '4242424242424242', 'outbid'
      from pg_temp.q1 q1, public.quote_payment_holds h where h.quote_id = q1.id$q$,
    'refund_obligations_reference_not_credential');
  select pg_temp.expect_error($q$
    insert into public.audit_events (action, target_table, target_id, details)
    values ('payment.attempt', 'quote_payment_holds', gen_random_uuid(),
            '{"reference":"4242 4242 4242 4242"}'::jsonb)$q$,
    'audit_events_details_no_credentials');
  select pg_temp.expect_error($q$
    insert into public.audit_events (action, target_table, target_id, purpose)
    values ('payment.attempt', 'quote_payment_holds', gen_random_uuid(), 'card 4242424242424242')$q$,
    'audit_events_purpose_not_credential');
  select pg_temp.expect_error($q$
    insert into public.notifications (house_id, house_kind, kind, title, body, dedupe_key)
    select i.ada, 'host', 'refund_pending', 'Charge failed',
           'Card 4242424242424242 was declined, try again.', 'f60|body'
      from pg_temp.ids i$q$,
    'notifications_content_no_credentials');
  select pg_temp.expect_error($q$
    insert into public.notifications (house_id, house_kind, kind, title, body, dedupe_key, payload)
    select i.ada, 'host', 'refund_pending', 'Refund on its way', 'The date was already won.', 'f60|payload',
           jsonb_build_object('pan', '123456')
      from pg_temp.ids i$q$,
    'notifications_content_no_credentials');
  -- The offer conversation is where a host types a card number today. A revision row is appended,
  -- never updated (F-14 makes it append-only), so the attempt is an insert.
  select pg_temp.expect_error($q$
    insert into public.quote_revisions (quote_id, number, authored_by_role, author_user_id, title,
                                        inclusions, extras, subtotal_minor, total_minor, currency)
    select q1.id, 9, 'vendor', u.id, 'Card 4242424242424242',
           '[{"label":"Fabric","line_total_minor":100000}]'::jsonb, '[]'::jsonb, 100000, 100000, 'NGN'
      from pg_temp.q1 q1, public.users u where u.auth0_sub = 'auth0|f60-viki'$q$,
    'quote_revisions_text_no_credentials');
  select pg_temp.expect_error($q$
    update public.quotes set close_note = 'or send to account 1234567890'
     where id = (select id from pg_temp.q1)$q$,
    'quotes_close_note_not_credential');
  -- Legitimate wording in the same columns still writes.
  insert into public.notifications (house_id, house_kind, kind, title, body, dedupe_key, payload)
    select i.ada, 'host', 'refund_pending', 'Refund on its way',
           'You paid 100000 NGN for 2026-12-01 after the date was won elsewhere. Invoice 20261105120000.',
           'f60|legit', jsonb_build_object('quote_id', q1.id, 'reference', 'psp_f60_ada_1')
      from pg_temp.ids i, pg_temp.q1 q1;
commit;

do $$ begin
  assert exists (select 1 from public.notifications where dedupe_key = 'f60|legit'),
    'an alert that names amounts, dates and a partner reference is not blocked';
  assert not exists (select 1 from public.refund_obligations),
    'the refund ledger stayed empty because every attempt was refused';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Who may ask the detector
-- ---------------------------------------------------------------------------
-- A CHECK runs with the privileges of the writing role, so the roles that write need execute;
-- anon needs nothing.
begin;
  set local role anon;
  select pg_temp.expect_error(
    'select app_private.looks_like_payment_credential(''4242424242424242'')',
    'permission denied');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f60-ada'), true);
  insert into outcome select 'detector',
    app_private.looks_like_payment_credential('4242424242424242')::text;
commit;

do $$ begin
  assert (select value from outcome where which = 'detector') = 'true',
    'the writing role can evaluate the constraint it is subject to';
end $$;

-- ---------------------------------------------------------------------------
-- 5. The constraints exist, are enforced, and nothing in this database is a credential
-- ---------------------------------------------------------------------------
do $$ begin
  assert (select count(*) from pg_constraint c
           join pg_class r on r.oid = c.conrelid
           join pg_namespace n on n.oid = r.relnamespace
          where n.nspname = 'public' and contype = 'c' and c.conname in (
            'quote_payment_holds_reference_not_credential',
            'refund_obligations_reference_not_credential',
            'audit_events_details_no_credentials',
            'audit_events_purpose_not_credential',
            'notifications_content_no_credentials',
            'quote_revisions_text_no_credentials',
            'quotes_close_note_not_credential')) = 7,
    'every sink has its own named constraint';
  assert not exists (select 1 from pg_constraint where contype = 'c'
                      and conname in ('quote_payment_holds_reference_not_credential',
                                      'refund_obligations_reference_not_credential',
                                      'audit_events_details_no_credentials',
                                      'audit_events_purpose_not_credential',
                                      'notifications_content_no_credentials',
                                      'quote_revisions_text_no_credentials',
                                      'quotes_close_note_not_credential')
                      and convalidated = false),
    'none was added as not-valid';

  assert not exists (select 1 from public.quote_payment_holds h
                      where app_private.looks_like_payment_credential(h.payment_reference)),
    'no stored payment reference is a credential';
  assert not exists (select 1 from public.audit_events
                      where app_private.jsonb_has_payment_credential(details)),
    'no audit details are a credential';
  assert not exists (select 1 from public.audit_events
                      where app_private.looks_like_payment_credential(purpose)),
    'no audit purpose is a credential';
  assert not exists (select 1 from public.notifications n
                      where app_private.looks_like_payment_credential(n.title)
                         or app_private.looks_like_payment_credential(n.body)
                         or app_private.jsonb_has_payment_credential(n.payload)),
    'no alert text is a credential';
  assert not exists (select 1 from public.quote_revisions r
                      where app_private.looks_like_payment_credential(r.title)
                         or app_private.looks_like_payment_credential(r.message)),
    'no offer title or message is a credential';
  assert not exists (select 1 from public.quotes where app_private.looks_like_payment_credential(close_note)),
    'no closing note is a credential';
end $$;

\o
\pset tuples_only on
select 'F-60 payment data protection tests passed' as result;
