-- F-100 chat attachments: the documents a host and a vendor share in a conversation.
-- The thread in 20261109020000_f100_in_app_chat.sql carries text only; this file adds the file
-- sharing a negotiating pair actually needs (a quote PDF, a floor plan, a photo of the cake).
--
-- Invariants this file owns:
--   * a document belongs to one conversation and one message: the composite foreign key ties the
--     attachment to the message and to the conversation that message is in
--   * the file itself lives in a private bucket; only the two parties of the conversation can
--     read or write it, and the path carries the conversation id so the policy can decide
--   * the bytes are type- and size-checked twice: by the bucket, and again by the database, so a
--     file that reached the bucket another way still cannot be attached
--   * a document message may carry no caption, so the message body is allowed to be empty
--
-- Malware scanning is deliberately absent: no scanning provider has been approved (AGENTS.md,
-- "Do not introduce an unapproved scanning service"). The bucket is private, files are only
-- reachable by the two parties, and the attachment table records who uploaded what.

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
-- The message and its conversation are unique together, so an attachment can be tied to both.
alter table public.messages
  add constraint messages_id_conversation_key unique (id, conversation_id);

create table public.message_attachments (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  uploaded_by     uuid not null references public.users (id),
  file_name       text not null check (length(file_name) between 1 and 200),
  content_type    text not null check (length(content_type) between 1 and 120),
  size_bytes      bigint not null check (size_bytes between 1 and 10485760),
  storage_path    text not null unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  -- The attachment cannot claim a conversation it does not belong to.
  foreign key (message_id, conversation_id)
    references public.messages (id, conversation_id) on delete cascade
);
comment on table public.message_attachments is
  'F-100: documents shared inside one conversation. The bytes live in a private storage bucket.';

create index message_attachments_message_idx on public.message_attachments (message_id);
create index message_attachments_conversation_idx on public.message_attachments (conversation_id);

create trigger message_attachments_touch before update on public.message_attachments
  for each row execute function app_private.touch();

alter table public.message_attachments enable row level security;
alter table public.message_attachments force row level security;

revoke all on public.message_attachments from public, anon, authenticated;
grant select on public.message_attachments to authenticated;

create policy message_attachments_party_read on public.message_attachments
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (app_private.member_can(c.host_house_id, 'chat')
           or app_private.member_can(c.vendor_house_id, 'chat'))
  ));

-- ---------------------------------------------------------------------------
-- A message may be a document without a caption
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname from pg_constraint
     where conrelid = 'public.messages'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%length(body)%'
  loop
    execute format('alter table public.messages drop constraint %I', v_constraint.conname);
  end loop;
end $$;

alter table public.messages
  add constraint messages_body_length check (length(body) between 0 and 4000);

-- ---------------------------------------------------------------------------
-- Participants of a conversation, by conversation id
-- ---------------------------------------------------------------------------
-- True when the caller is a member of one of the conversation's two houses and that membership
-- carries the 'chat' capability. Used by the storage policies and by the attachment functions.
create function app_private.can_chat_in(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and (app_private.member_can(c.host_house_id, 'chat')
           or app_private.member_can(c.vendor_house_id, 'chat'))
  )
$$;
revoke all on function app_private.can_chat_in(uuid) from public;
grant execute on function app_private.can_chat_in(uuid) to authenticated;

-- The conversation a stored file belongs to, taken from its path.
-- Files are stored as 'conversations/<conversation id>/<file id><ext>'.
create function app_private.conversation_id_from_path(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  v_segment text;
begin
  v_segment := split_part(coalesce(p_name, ''), '/', 2);
  if v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_segment::uuid;
end;
$$;
revoke all on function app_private.conversation_id_from_path(text) from public;
grant execute on function app_private.conversation_id_from_path(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The private bucket
-- ---------------------------------------------------------------------------
-- The bucket is not public: a file is only reachable through a signed link, and the storage
-- policies below admit only the parties of the conversation the path names.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema is not present; the chat attachment bucket was not created';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'chat-attachments',
    'chat-attachments',
    false,
    10485760,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv'
    ]
  )
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  if to_regclass('storage.objects') is null then
    return;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'chat_attachments_read'
  ) then
    execute $p$
      create policy chat_attachments_read on storage.objects
        for select to authenticated
        using (
          bucket_id = 'chat-attachments'
          and app_private.can_chat_in(app_private.conversation_id_from_path(name))
        )
    $p$;
    execute $p$
      create policy chat_attachments_insert on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'chat-attachments'
          and app_private.can_chat_in(app_private.conversation_id_from_path(name))
        )
    $p$;
    execute $p$
      create policy chat_attachments_delete on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'chat-attachments'
          and app_private.can_chat_in(app_private.conversation_id_from_path(name))
        )
    $p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Sharing a document
-- ---------------------------------------------------------------------------
-- The sender must be a participant whose house membership carries the 'chat' capability, exactly
-- as for a text message. The file must already sit in this conversation's folder: the path is
-- checked against the conversation so a file uploaded elsewhere cannot be attached here.
create function public.send_document(
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

  insert into public.messages (conversation_id, sender_user_id, sender_house_id, sender_side, body)
  values (v_c.id, v_actor, v_house, v_side, v_text)
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
-- Reading the attachments of a conversation
-- ---------------------------------------------------------------------------
create function public.conversation_attachments(p_conversation uuid)
returns table (
  message_id    uuid,
  attachment_id uuid,
  file_name     text,
  content_type  text,
  size_bytes    bigint,
  uploaded_by   uuid,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.conversations := app_private.load_conversation(p_conversation);
begin
  return query
    select a.message_id, a.id, a.file_name, a.content_type, a.size_bytes, a.uploaded_by, a.created_at
      from public.message_attachments a
     where a.conversation_id = v_c.id
     order by a.created_at, a.id;
end;
$$;
revoke all on function public.conversation_attachments(uuid) from public, anon;
grant execute on function public.conversation_attachments(uuid) to authenticated;

-- One attachment, for the signed link the reader is about to ask for.
create function public.conversation_attachment(p_conversation uuid, p_attachment uuid)
returns table (
  attachment_id uuid,
  file_name     text,
  content_type  text,
  size_bytes    bigint,
  storage_path  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.conversations := app_private.load_conversation(p_conversation);
begin
  return query
    select a.id, a.file_name, a.content_type, a.size_bytes, a.storage_path
      from public.message_attachments a
     where a.conversation_id = v_c.id
       and a.id = p_attachment;
  if not found then
    raise exception 'attachment_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.conversation_attachment(uuid, uuid) from public, anon;
grant execute on function public.conversation_attachment(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
