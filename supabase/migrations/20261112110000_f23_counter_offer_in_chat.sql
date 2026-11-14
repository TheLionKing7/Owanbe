-- F-23 Counter-offer embedded in the chat thread
--
-- The F-23 spec: "The host can counter a vendor's quote in chat; the vendor must issue a revised
-- quote, which the host can then accept or decline." Before this file the offer and the
-- conversation were two separate records: a host could write "can you include the lighting?" in
-- the thread and counter the same offer in the quotes panel, and nothing tied the two together.
--
-- Invariants this file owns:
--   * a counter made in a thread is a quote revision tied to that thread, so the offer and the
--     conversation are one history (quote_revisions.conversation_id)
--   * a sent offer and a counter each leave a structured message in the thread, so both houses
--     see the same event in the same place
--   * the counter deadline from F-14 still governs a counter made in chat: the same vendor window
--   * only the parties of the thread may read the quote it carries, and a draft offer never
--     reaches the thread: an unsent draft is the vendor's own business
--   * a message body is free text a person typed, so F-60's credential guard covers it as well
--
-- Money is not touched here: no funds move and no payment state changes.

-- ---------------------------------------------------------------------------
-- The message learns what it carries
-- ---------------------------------------------------------------------------
alter table public.messages add column kind text not null default 'text';
alter table public.messages add column quote_id uuid;
alter table public.messages add column revision integer;

comment on column public.messages.kind is
  'F-23: text, document, quote_offer or counter_offer. A structured message points at a quote.';
comment on column public.messages.quote_id is
  'F-23: the quote this message carries. Deliberately not a foreign key: messages are append-only, '
  'so a cascading delete would raise the append-only trigger instead of removing the row.';
comment on column public.messages.revision is
  'F-23: the quote revision this message carries.';

alter table public.messages
  add constraint messages_kind check (kind in ('text', 'document', 'quote_offer', 'counter_offer'));
alter table public.messages
  add constraint messages_revision_positive check (revision is null or revision >= 1);
-- Only a structured message points at a quote, and it always points at both the quote and the
-- revision. A plain message never carries either.
alter table public.messages
  add constraint messages_quote_shape check (
    (kind in ('quote_offer', 'counter_offer') and quote_id is not null and revision is not null)
    or (kind in ('text', 'document') and quote_id is null and revision is null)
  );

-- F-60's rule: "The next feature that adds a free-text column a person can type into adds it to
-- this list, in the same migration." A counter's words are typed by the host and now land in
-- public.messages as well as in quote_revisions, so the guard covers the thread too.
alter table public.messages
  add constraint messages_body_no_credentials check (
    not app_private.looks_like_payment_credential(body)
  );
comment on constraint messages_body_no_credentials on public.messages is
  'F-60/F-23: a chat body may not carry a card number or a quoted bank account.';

-- The thread a revision belongs to. No foreign key, for the same reason as messages.quote_id:
-- quote_revisions is append-only, so a cascade from the conversation would raise the append-only
-- trigger instead of removing the row.
alter table public.quote_revisions add column conversation_id uuid;
comment on column public.quote_revisions.conversation_id is
  'F-23: the thread this revision was made in. Null for a revision made outside a conversation.';

-- ---------------------------------------------------------------------------
-- The host's counter, in the thread or beside it
-- ---------------------------------------------------------------------------
drop function public.counter_quote(uuid, integer, text);

create function public.counter_quote(
  p_quote uuid,
  p_expected_version integer,
  p_message text,
  p_conversation uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_q            public.quotes := app_private.load_quote(p_quote);
  v_actor        uuid;
  v_number       integer;
  v_conversation uuid;
  v_thread       public.conversations;
begin
  v_actor := app_private.require_actor(v_q.host_house_id, 'quotes');
  perform app_private.expect_version(v_q, p_expected_version);
  perform app_private.require_status(v_q, array['sent', 'countered']);
  if coalesce(length(trim(p_message)), 0) not between 1 and 2000 then
    raise exception 'counter_message_required' using errcode = '22023';
  end if;

  -- The thread this counter belongs to. A caller may name the thread, and then that thread must
  -- be this quote's thread; a caller who names none gets the pair's thread when there is one.
  if p_conversation is not null then
    v_thread := app_private.load_conversation(p_conversation);
    if v_thread.host_house_id <> v_q.host_house_id
       or v_thread.vendor_house_id <> v_q.vendor_house_id then
      raise exception 'forbidden: conversation' using errcode = '42501';
    end if;
    v_conversation := v_thread.id;
  else
    select c.id into v_conversation
      from public.conversations c
     where c.host_house_id = v_q.host_house_id
       and c.vendor_house_id = v_q.vendor_house_id;
  end if;

  select coalesce(max(number), 0) + 1 into v_number from public.quote_revisions where quote_id = p_quote;

  insert into public.quote_revisions
    (quote_id, number, authored_by_role, author_user_id, title, inclusions, extras,
     subtotal_minor, total_minor, currency, message, conversation_id)
  select p_quote, v_number, 'host', v_actor, r.title, r.inclusions, r.extras,
         r.subtotal_minor, r.total_minor, r.currency, trim(p_message), v_conversation
  from public.quote_revisions r
  where r.quote_id = p_quote and r.number = v_q.current_revision;

  -- The counter starts the vendor's window, exactly as a counter made outside the thread does.
  update public.quotes
     set status = 'countered',
         current_revision = v_number,
         counter_response_due_at = now() + app_private.quote_counter_response_interval()
   where id = p_quote;

  -- The counter is a message in the thread: the words the host wrote and the revision they made
  -- are one event.
  if v_conversation is not null then
    insert into public.messages
      (conversation_id, sender_user_id, sender_house_id, sender_side, body, kind, quote_id, revision)
    values (v_conversation, v_actor, v_q.host_house_id, 'host', trim(p_message),
            'counter_offer', p_quote, v_number);
    update public.conversations set last_message_at = now() where id = v_conversation;
  end if;

  perform app_private.audit(v_actor, 'quote.countered', 'quotes', p_quote, v_q.host_house_id,
                            jsonb_build_object('revision', v_number,
                                               'conversation_id', v_conversation));
end;
$$;
revoke all on function public.counter_quote(uuid, integer, text, uuid) from public, anon;
grant execute on function public.counter_quote(uuid, integer, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The vendor's offer leaves a message in the thread
-- ---------------------------------------------------------------------------
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
  v_q            public.quotes := app_private.load_quote(p_quote);
  v_actor        uuid;
  v_avail        public.vendor_availability;
  v_slot         integer;
  v_expires      timestamptz;
  v_conversation uuid;
  v_revision     integer;
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

  -- The offer is announced in the thread when the two houses have one. No thread, no message: the
  -- quote still stands on its own.
  select c.id into v_conversation
    from public.conversations c
   where c.host_house_id = v_q.host_house_id
     and c.vendor_house_id = v_q.vendor_house_id;
  if v_conversation is not null then
    select max(number) into v_revision from public.quote_revisions where quote_id = p_quote;
    insert into public.messages
      (conversation_id, sender_user_id, sender_house_id, sender_side, body, kind, quote_id, revision)
    values (v_conversation, v_actor, v_q.vendor_house_id, 'vendor', '',
            'quote_offer', p_quote, v_revision);
    update public.conversations set last_message_at = now() where id = v_conversation;
  end if;

  perform app_private.audit(v_actor, 'quote.sent', 'quotes', p_quote, v_q.vendor_house_id,
                            jsonb_build_object('service_date', v_q.service_date));
  return v_expires;
end;
$$;
revoke all on function public.send_quote(uuid, integer) from public, anon;
grant execute on function public.send_quote(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- A document message says what it is
-- ---------------------------------------------------------------------------
create or replace function public.send_document(
  p_conversation uuid,
  p_body text,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_storage_path text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_c      public.conversations := app_private.load_conversation(p_conversation);
  v_actor  uuid := app_private.current_user_id();
  v_side   text := app_private.my_conversation_side(v_c);
  v_house  uuid;
  v_text   text := btrim(coalesce(p_body, ''));
  v_name   text := btrim(coalesce(p_file_name, ''));
  v_type   text := lower(btrim(coalesce(p_content_type, '')));
  v_path   text := btrim(coalesce(p_storage_path, ''));
  v_size   bigint := coalesce(p_size_bytes, 0);
  v_message uuid;
  v_attachment uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if v_side is null then
    raise exception 'forbidden: conversation' using errcode = '42501';
  end if;
  if length(v_text) > 4000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;
  if length(v_name) not between 1 and 200 then
    raise exception 'invalid_attachment' using errcode = '22023';
  end if;
  if v_type not in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv'
  ) then
    raise exception 'invalid_attachment_type' using errcode = '22023';
  end if;
  if v_size not between 1 and 10485760 then
    raise exception 'invalid_attachment_size' using errcode = '22023';
  end if;
  -- The file must belong to this conversation's folder.
  if app_private.conversation_id_from_path(v_path) is distinct from v_c.id then
    raise exception 'forbidden: attachment path' using errcode = '42501';
  end if;

  v_house := case when v_side = 'host' then v_c.host_house_id else v_c.vendor_house_id end;

  insert into public.messages (conversation_id, sender_user_id, sender_house_id, sender_side, body, kind)
  values (v_c.id, v_actor, v_house, v_side, v_text, 'document')
  returning id into v_message;

  insert into public.message_attachments
    (message_id, conversation_id, uploaded_by, file_name, content_type, size_bytes, storage_path)
  values (v_message, v_c.id, v_actor, v_name, v_type, v_size, v_path)
  returning id into v_attachment;

  update public.conversations set last_message_at = now() where id = v_c.id;

  perform app_private.audit(v_actor, 'message.attachment_shared', 'message_attachments', v_attachment,
                            v_house,
                            jsonb_build_object('conversation_id', v_c.id,
                                               'message_id', v_message,
                                               'content_type', v_type,
                                               'size_bytes', v_size));
  return v_message;
end;
$$;
revoke all on function public.send_document(uuid, text, text, text, bigint, text) from public, anon;
grant execute on function public.send_document(uuid, text, text, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The thread carries what the message holds
-- ---------------------------------------------------------------------------
drop function public.conversation_messages(uuid);

create function public.conversation_messages(p_conversation uuid)
returns table (
  conversation_id uuid,
  side            text,
  counterparty_name text,
  counterparty_slug text,
  message_id      uuid,
  kind            text,
  sender_side     text,
  sender_name     text,
  body            text,
  quote_id        uuid,
  revision        integer,
  sent_at         timestamptz,
  mine            boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c    public.conversations := app_private.load_conversation(p_conversation);
  v_side text := app_private.my_conversation_side(v_c);
begin
  return query
    select v_c.id,
           v_side,
           case when v_side = 'host'
                then coalesce(vp.business_name, vh.display_name)
                else hh.display_name end,
           case when v_side = 'host' then vp.slug else null end,
           m.id,
           m.kind,
           m.sender_side,
           m.sender_name,
           m.body,
           m.quote_id,
           m.revision,
           m.sent_at,
           m.mine
      from public.conversations c2
      join public.houses hh on hh.id = c2.host_house_id
      join public.houses vh on vh.id = c2.vendor_house_id
      left join public.vendor_profiles vp on vp.house_id = c2.vendor_house_id
      -- A conversation with no messages yet still returns its header, so the reader knows the
      -- conversation exists instead of seeing a missing thread.
      left join lateral (
        select msg.id,
               msg.kind,
               msg.sender_side,
               coalesce(u.display_name, '') as sender_name,
               msg.body,
               msg.quote_id,
               msg.revision,
               msg.created_at as sent_at,
               msg.sender_user_id = app_private.current_user_id() as mine
          from public.messages msg
          join public.users u on u.id = msg.sender_user_id
         where msg.conversation_id = c2.id
         order by msg.created_at, msg.id
      ) m on true
     where c2.id = v_c.id
     order by m.sent_at nulls last, m.id nulls last;
end;
$$;
revoke all on function public.conversation_messages(uuid) from public, anon;
grant execute on function public.conversation_messages(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The quote the thread is about
-- ---------------------------------------------------------------------------
-- The live quote of a thread: the offers the two houses sent to each other, with their revisions.
-- Only a participant may read it, and only an offer that was actually sent: a draft is the
-- vendor's own business until they send it.
create function public.thread_quotes(p_conversation uuid)
returns table (
  quote_id           uuid,
  service_date       date,
  status             text,
  currency           text,
  total_minor        bigint,
  current_revision   integer,
  sent_at            timestamptz,
  expires_at         timestamptz,
  counter_response_due_at timestamptz,
  decided_at         timestamptz,
  version            integer,
  is_vendor_side     boolean,
  title              text,
  revisions          jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_c    public.conversations := app_private.load_conversation(p_conversation);
  v_side text := app_private.my_conversation_side(v_c);
begin
  -- The deadline is decided by the database, so the sweep runs before the reader looks.
  perform app_private.apply_expiry(v_c.host_house_id);
  perform app_private.apply_expiry(v_c.vendor_house_id);

  return query
    select q.id, q.service_date, q.status, q.currency, q.total_minor, q.current_revision,
           q.sent_at, q.expires_at, q.counter_response_due_at, q.decided_at, q.version,
           v_side = 'vendor',
           r.title,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                        'number', rv.number,
                        'authored_by_role', rv.authored_by_role,
                        'title', rv.title,
                        'inclusions', rv.inclusions,
                        'extras', rv.extras,
                        'currency', rv.currency,
                        'subtotal_minor', rv.subtotal_minor,
                        'total_minor', rv.total_minor,
                        'message', rv.message,
                        'created_at', rv.created_at,
                        'conversation_id', rv.conversation_id)
                      order by rv.number)
               from public.quote_revisions rv
              where rv.quote_id = q.id
           ), '[]'::jsonb)
      from public.quotes q
      left join public.quote_revisions r on r.quote_id = q.id and r.number = q.current_revision
     where q.host_house_id = v_c.host_house_id
       and q.vendor_house_id = v_c.vendor_house_id
       and q.sent_at is not null
     order by q.created_at desc;
end;
$$;
revoke all on function public.thread_quotes(uuid) from public, anon;
grant execute on function public.thread_quotes(uuid) to authenticated;

notify pgrst, 'reload schema';
