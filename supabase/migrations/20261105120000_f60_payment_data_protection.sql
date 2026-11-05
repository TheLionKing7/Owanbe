-- F-60 Payment Data Protection (tokenization via partner) — protection half only
-- Owner decision 2026-11-05 (Sage 7 question 0bf44f83): "Approve the protection-only slice now:
-- enforce and prove no raw card/bank credential can ever enter storage, logs or Sentry; no money
-- state, no licence needed. But this feature shouldn't be forgotten. AI payment router is key."
--
-- What this file owns:
--   * one rule set, shared with src/lib/payments/credential-guard.ts, refusing anything shaped like
--     a card number, a quoted bank account, or a credential-named field
--   * the rule as CHECK constraints, so every write path is covered — including the service-role
--     payment confirmation, security-definer functions, and any feature added later. A before-insert
--     trigger would not be bypassed either, but a constraint is visible in the schema itself, which
--     is what an audit can then rely on.
--   * every sink that exists today: the two payment references, the offer conversation and closing
--     note, the alert copy, and the three jsonb documents (audit details, notification payload)
--
-- What this file deliberately does NOT do:
--   * it stores no wallet balance and no payment instrument. Ówàńbè holds no one's money here: the
--     "wallet balances and transaction records" half of F-60 stays un-built until the licence/partner
--     arrangement question is answered and the Payment Router (F-48) exists. Owner action: answer
--     docs/open-questions.md Q10 before any ledger table is created.
--   * it moves no money, refunds nothing, and adds no provider call.
--
-- Trade-off: a card is refused by checksum or by the printed 4-4-4-4 shape, and a bank account only
-- when quoted with the word that means "pay this". Unrelated digit strings — epoch milliseconds,
-- prices, uuid hex, timestamps — pass, so a legitimate audit write cannot be aborted by a number
-- that merely looks long. The published test card is refused, which is the case that matters.
--
-- Depends on 20261101020000_f77_data_model.sql (audit_events, notifications arrives with F-38) and
-- 20261104160000_f38_vendor_calendar_soft_hold.sql (quote_payment_holds, refund_obligations,
-- notifications). Merge after F-14 and F-38, in that order.

-- ---------------------------------------------------------------------------
-- The shared detector
-- ---------------------------------------------------------------------------
-- Every real card number satisfies this checksum, which is what lets unrelated digit strings
-- (epoch milliseconds, prices, ids) through without aborting somebody's legitimate write.
create function app_private.luhn_valid(p_digits text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_sum    integer := 0;
  v_double boolean := false;
  v_value  integer;
  v_index  integer;
begin
  if p_digits !~ '^[0-9]+$' then
    return false;
  end if;
  v_index := char_length(p_digits);
  while v_index > 0 loop
    v_value := substring(p_digits from v_index for 1)::integer;
    if v_double then
      v_value := v_value * 2;
      if v_value > 9 then v_value := v_value - 9; end if;
    end if;
    v_sum := v_sum + v_value;
    v_double := not v_double;
    v_index := v_index - 1;
  end loop;
  return v_sum % 10 = 0;
end $$;

-- A number is a credential when it is (a) 12-19 digits with the ISO 7812 checksum, (b) printed in
-- four groups of four, or (c) a 7-18 digit account quoted next to the word that means "pay this".
-- ':' and '/' are not treated as separators, so timestamps and paths cannot be mistaken for a card.
create function app_private.looks_like_payment_credential(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_run    text;
  v_digits text;
begin
  if p_value ~* '(account|acct|transfer to|beneficiary)[^0-9]{0,24}[0-9]{7,18}' then
    return true;
  end if;

  for v_run in
    select run[1] from (
      select regexp_matches(p_value, '[0-9][0-9 .-]{10,}[0-9]', 'g') as run
    ) r
  loop
    v_digits := regexp_replace(v_run, '[^0-9]', '', 'g');
    if char_length(v_digits) between 12 and 19
       and (app_private.luhn_valid(v_digits)
            or v_run ~ '[0-9]{4}[ .-][0-9]{4}[ .-][0-9]{4}[ .-][0-9]{4}') then
      return true;
    end if;
  end loop;

  return false;
end $$;

-- Field names that are credential vocabulary whatever the value is. Partner tokens (reference,
-- access_code, card_token) are deliberately absent: they are what we are allowed to keep.
create function app_private.looks_like_credential_key(p_key text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select lower(p_key) ~
    '(^|[^a-z0-9])(pan|card_?[a-z0-9]*number|card_?no|card_?pan|cvv|cvc|cid|expiry|expire_?[a-z0-9]+|exp_?date|account_?number|bank_?account|bank_?code|sort_?code|routing_?number|iban|bvn|nin|ssn|pin|password|secret_?key|api_?key)($|[^a-z0-9])'
$$;

-- Any depth of a jsonb document: a credential key, or a credential value hiding under a harmless
-- key name.
create function app_private.jsonb_has_payment_credential(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_key  text;
  v_item jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_item in select key, value from jsonb_each(p_value) loop
      if app_private.looks_like_credential_key(v_key) then
        return true;
      end if;
      if app_private.jsonb_has_payment_credential(v_item) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    return exists (
      select 1 from jsonb_array_elements(p_value) as e(value)
      where app_private.jsonb_has_payment_credential(e.value)
    );
  end if;

  if jsonb_typeof(p_value) in ('string', 'number') then
    -- The scalar text, with quotes and JSON escapes stripped so "4242 4242 ..." cannot hide.
    return app_private.looks_like_payment_credential(
      replace(replace(p_value #>> '{}', '"', ''), chr(92), ''));
  end if;

  return false;
end $$;

-- A CHECK expression is evaluated with the privileges of the role writing the row, so the roles
-- that legitimately write need the detectors. They expose a rule, not any data, and anon keeps
-- nothing.
revoke all on function app_private.luhn_valid(text) from public;
revoke all on function app_private.looks_like_payment_credential(text) from public;
revoke all on function app_private.looks_like_credential_key(text) from public;
revoke all on function app_private.jsonb_has_payment_credential(jsonb) from public;
grant execute on function app_private.luhn_valid(text) to authenticated, service_role;
grant execute on function app_private.looks_like_payment_credential(text) to authenticated, service_role;
grant execute on function app_private.looks_like_credential_key(text) to authenticated, service_role;
grant execute on function app_private.jsonb_has_payment_credential(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The four sinks that exist today
-- ---------------------------------------------------------------------------
-- F-38 validated the payment reference for length only, so a PAN was accepted into
-- quote_payment_holds. The service role can still record a real confirmation; it just cannot store
-- anything that looks like the card itself.
alter table public.quote_payment_holds
  add constraint quote_payment_holds_reference_not_credential check (
    payment_reference is null or not app_private.looks_like_payment_credential(payment_reference)
  );

alter table public.refund_obligations
  add constraint refund_obligations_reference_not_credential check (
    not app_private.looks_like_payment_credential(payment_reference)
  );

-- audit_events.details is written by every feature that exists today. If a later payment feature
-- logs a card number inside it, the transaction aborts instead of the PAN being stored.
alter table public.audit_events
  add constraint audit_events_details_no_credentials check (
    not app_private.jsonb_has_payment_credential(details)
  );

-- Alert copy and its payload reach both houses, so they are covered too.
alter table public.notifications
  add constraint notifications_content_no_credentials check (
    not app_private.looks_like_payment_credential(title)
    and not app_private.looks_like_payment_credential(body)
    and not app_private.jsonb_has_payment_credential(payload)
  );

-- The offer conversation is where a host types, today: "here is my card, just charge it" is the
-- message this stops. Both sides author revisions, and a closing note is free text as well.
alter table public.quote_revisions
  add constraint quote_revisions_text_no_credentials check (
    not app_private.looks_like_payment_credential(title)
    and (message is null or not app_private.looks_like_payment_credential(message))
  );

alter table public.quotes
  add constraint quotes_close_note_not_credential check (
    close_note is null or not app_private.looks_like_payment_credential(close_note)
  );

-- Every column, including the jsonb documents, is checked the same way audit details are.
alter table public.audit_events
  add constraint audit_events_purpose_not_credential check (
    purpose is null or not app_private.looks_like_payment_credential(purpose)
  );

-- Deliberately not covered: houses.display_name, users.display_name and users email. They are not
-- payment sinks, and a business legitimately names itself something that reads as a digit run.
-- The next feature that adds a free-text column a person can type into adds it to this list, in the
-- same migration, or writes its own credential guard test.
