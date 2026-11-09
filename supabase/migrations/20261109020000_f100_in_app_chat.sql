-- F-100 In-app chat (host-vendor conversations)
-- The private messaging a host and a vendor use to negotiate before a quote exists. The blueprint
-- designs it (blueprint/tech-spec.md:87); nothing of it existed before this file.
--
-- Invariants this file owns:
--   * a conversation belongs to exactly one Host house and one Vendor house, and never to a third
--     party: the row carries both house ids and the policies admit only their members
--   * one conversation per house pair, so the same host and vendor cannot start parallel threads
--   * only a member with the 'chat' capability speaks for a house; vendor staff need the grant
--     their owner gave them (F-78 role matrix), and host houses stay owner-only
--   * messages are append-only: a sent message is never edited or deleted
--   * the body is text the party wrote; nothing else about the house is exposed to the other side
--
-- app_private.member_can() is the F-14 mirror of the F-78 role matrix (supabase/migrations/
-- 20261104120000_f14_quotes.sql:208). app_private.house_can() is the F-78 original and is
-- equivalent; member_can is used because it is the one applied in migration order.

-- ---------------------------------------------------------------------------
-- Conversations: one Host house, one Vendor house
-- ---------------------------------------------------------------------------
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  host_house_id     uuid not null,
  host_house_kind   text not null default 'host' check (host_house_kind = 'host'),
  vendor_house_id   uuid not null,
  vendor_house_kind text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  started_by        uuid not null references public.users (id),
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  foreign key (host_house_id, host_house_kind) references public.houses (id, kind) on delete cascade,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  -- one conversation per house pair, so a host and a vendor share one thread
  unique (host_house_id, vendor_house_id),
  constraint conversations_two_distinct_houses check (host_house_id <> vendor_house_id)
);
comment on table public.conversations is
  'F-100: one private thread between one Host house and one Vendor house.';
create index conversations_host_idx on public.conversations (host_house_id, updated_at desc);
create index conversations_vendor_idx on public.conversations (vendor_house_id, updated_at desc);
create trigger conversations_touch before update on public.conversations
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Messages: append-only, scoped to the conversation
-- ---------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_user_id  uuid not null references public.users (id),
  sender_house_id uuid not null references public.houses (id),
  sender_side     text not null check (sender_side in ('host', 'vendor')),
  body            text not null check (length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1
);
comment on table public.messages is
  'F-100: append-only chat messages. A message is never edited or deleted.';
create index messages_conversation_idx on public.messages (conversation_id, created_at, id);
create trigger messages_touch before update on public.messages
  for each row execute function app_private.touch();
create trigger messages_append_only
  before update or delete or truncate on public.messages
  for each statement execute function app_private.forbid_change();

-- ---------------------------------------------------------------------------
-- Row-level security: participants only, every write through a function
-- ---------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;

revoke all on public.conversations, public.messages from public, anon, authenticated;
grant select on public.conversations, public.messages to authenticated;

create policy conversations_party_read on public.conversations
  for select to authenticated
  using (app_private.member_can(host_house_id, 'chat')
         or app_private.member_can(vendor_house_id, 'chat'));

create policy messages_party_read on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (app_private.member_can(c.host_house_id, 'chat')
           or app_private.member_can(c.vendor_house_id, 'chat'))
  ));

-- ---------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------
-- The caller's role in a conversation: 'host', 'vendor', or null when they are not a participant.
create function app_private.my_conversation_side(p_conversation public.conversations)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app_private.member_can(p_conversation.host_house_id, 'chat') then 'host'
    when app_private.member_can(p_conversation.vendor_house_id, 'chat') then 'vendor'
    else null
  end
$$;
revoke all on function app_private.my_conversation_side(public.conversations) from public;

-- The conversation, loaded for a caller who is allowed to see it.
create function app_private.load_conversation(p_conversation uuid)
returns public.conversations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.conversations;
begin
  select * into v_c from public.conversations where id = p_conversation;
  if not found then
    raise exception 'conversation_not_found' using errcode = 'P0002';
  end if;
  if app_private.my_conversation_side(v_c) is null then
    raise exception 'forbidden: conversation' using errcode = '42501';
  end if;
  return v_c;
end;
$$;
revoke all on function app_private.load_conversation(uuid) from public;

-- ---------------------------------------------------------------------------
-- Host side: start a conversation with a published vendor
-- ---------------------------------------------------------------------------
-- The vendor is chosen by slug, not by house id: the public profile projection deliberately does
-- not expose house ids, and a host may only reach a vendor that has published a profile.
create function public.start_conversation(p_vendor_slug text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := app_private.current_user_id();
  v_slug       text := lower(btrim(coalesce(p_vendor_slug, '')));
  v_host_house uuid;
  v_vendor     uuid;
  v_id         uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if v_slug = '' or length(v_slug) > 60 then
    raise exception 'invalid_vendor' using errcode = '22023';
  end if;

  select h.id into v_host_house
    from public.houses h
    join public.memberships m on m.house_id = h.id and m.user_id = v_actor and m.revoked_at is null
   where h.kind = 'host' and h.archived_at is null
     and app_private.member_can(h.id, 'chat')
   limit 1;
  if v_host_house is null then
    raise exception 'forbidden: chat in house' using errcode = '42501';
  end if;

  select vp.house_id into v_vendor
    from public.vendor_profiles vp
    join public.houses h on h.id = vp.house_id and h.archived_at is null
   where vp.slug = v_slug and vp.published
   limit 1;
  if v_vendor is null then
    raise exception 'vendor_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.houses h where h.id = v_vendor and h.owner_user_id = v_actor) then
    raise exception 'forbidden: own vendor house' using errcode = '42501';
  end if;

  insert into public.conversations (host_house_id, vendor_house_id, started_by)
  values (v_host_house, v_vendor, v_actor)
  on conflict (host_house_id, vendor_house_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- The thread already exists: the same host and vendor keep one conversation.
    select id into v_id from public.conversations
     where host_house_id = v_host_house and vendor_house_id = v_vendor;
    return v_id;
  end if;

  perform app_private.audit(v_actor, 'conversation.started', 'conversations', v_id, v_host_house,
                            jsonb_build_object('vendor_house_id', v_vendor));
  return v_id;
end;
$$;
revoke all on function public.start_conversation(text) from public, anon;
grant execute on function public.start_conversation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read projections
-- ---------------------------------------------------------------------------
-- The caller's conversations, newest first. The counterparty name comes from the vendor profile
-- when there is one; the vendor house display name is used otherwise.
create function public.my_conversations()
returns table (
  conversation_id uuid,
  side            text,
  counterparty_name text,
  counterparty_slug text,
  last_message_at timestamptz,
  last_message_preview text,
  message_count   bigint,
  version         integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select c.id,
           app_private.my_conversation_side(c),
           case when app_private.my_conversation_side(c) = 'host'
                then coalesce(vp.business_name, vh.display_name)
                else hh.display_name end,
           case when app_private.my_conversation_side(c) = 'host' then vp.slug else null end,
           c.last_message_at,
           (select left(m.body, 120) from public.messages m
             where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1),
           (select count(*) from public.messages m where m.conversation_id = c.id),
           c.version
      from public.conversations c
      join public.houses hh on hh.id = c.host_house_id
      join public.houses vh on vh.id = c.vendor_house_id
      left join public.vendor_profiles vp on vp.house_id = c.vendor_house_id
     where app_private.my_conversation_side(c) is not null
     order by coalesce(c.last_message_at, c.created_at) desc, c.id desc
    limit 200;
end;
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- One conversation with its messages, newest last. Only a participant sees anything.
create function public.conversation_messages(p_conversation uuid)
returns table (
  conversation_id uuid,
  side            text,
  counterparty_name text,
  counterparty_slug text,
  message_id      uuid,
  sender_side     text,
  sender_name     text,
  body            text,
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
           m.sender_side,
           m.sender_name,
           m.body,
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
               msg.sender_side,
               coalesce(u.display_name, '') as sender_name,
               msg.body,
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
-- Writing a message
-- ---------------------------------------------------------------------------
-- The sender must be a participant whose house membership carries the 'chat' capability. Vendor
-- staff without that grant are refused here, not in the UI.
create function public.send_message(p_conversation uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_c       public.conversations := app_private.load_conversation(p_conversation);
  v_actor   uuid := app_private.current_user_id();
  v_side    text := app_private.my_conversation_side(v_c);
  v_house   uuid;
  v_text    text := btrim(coalesce(p_body, ''));
  v_id      uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if v_side is null then
    raise exception 'forbidden: conversation' using errcode = '42501';
  end if;
  if length(v_text) not between 1 and 4000 then
    raise exception 'invalid_message' using errcode = '22023';
  end if;

  v_house := case when v_side = 'host' then v_c.host_house_id else v_c.vendor_house_id end;

  insert into public.messages (conversation_id, sender_user_id, sender_house_id, sender_side, body)
  values (v_c.id, v_actor, v_house, v_side, v_text)
  returning id into v_id;

  update public.conversations set last_message_at = now() where id = v_c.id;
  return v_id;
end;
$$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

notify pgrst, 'reload schema';
