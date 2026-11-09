-- F-100 chat attachment tests. Raises on the first failure.
-- Covers: a host and a vendor share a document in their conversation, the file belongs to that
-- conversation, the type and size are checked again by the database, and neither the other houses
-- nor a client that writes directly can reach the attachment.
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
grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: a host, the vendor owner, vendor staff with and without the 'chat'
-- capability, and a host who takes no part in it.
-- ---------------------------------------------------------------------------
create temp table ids (alice uuid, bob uuid, dave uuid, erin uuid, frank uuid,
                       alice_host uuid, dave_vendor uuid);
create temp table c (id uuid);
create temp table c2 (id uuid);
grant select on ids, c, c2 to authenticated, anon;
grant insert, update on c, c2 to authenticated;

insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f100-alice', 'alice@example.test', true, 'Alice Adeyemi'),
  ('auth0|f100-bob',   'bob@example.test',   true, 'Bob Ogun'),
  ('auth0|f100-dave',  'dave@example.test',  true, 'Dave Oyelowo'),
  ('auth0|f100-erin',  'erin@example.test',  true, 'Erin Staff'),
  ('auth0|f100-frank', 'frank@example.test', true, 'Frank No Grant');

insert into ids (alice, bob, dave, erin, frank)
  select (select id from public.users where auth0_sub = 'auth0|f100-alice'),
         (select id from public.users where auth0_sub = 'auth0|f100-bob'),
         (select id from public.users where auth0_sub = 'auth0|f100-dave'),
         (select id from public.users where auth0_sub = 'auth0|f100-erin'),
         (select id from public.users where auth0_sub = 'auth0|f100-frank');

insert into public.houses (kind, owner_user_id, display_name) select 'host', alice, 'Alice''s celebrations' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'host', bob, 'The Ogun wedding' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', dave, 'Dave Cakes Ltd' from ids;

update ids set
  alice_host  = (select id from public.houses where display_name = 'Alice''s celebrations'),
  dave_vendor = (select id from public.houses where display_name = 'Dave Cakes Ltd');

insert into public.memberships (house_id, house_kind, user_id, role) select alice_host, 'host', alice, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select dave_vendor, 'vendor', dave, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select dave_vendor, 'vendor', erin, 'staff', array['chat'] from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select dave_vendor, 'vendor', frank, 'staff', array['profile'] from ids;

insert into public.vendor_profiles (house_id, slug, business_name, category, headline, about, published, published_at)
  select dave_vendor, 'dave-cakes', 'Dave Cakes Ltd', 'Cakes', 'Wedding cakes in Lagos',
         'We bake celebration cakes across Lagos.', true, now() from ids;

-- ---------------------------------------------------------------------------
-- 1. The host shares a document in the conversation
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  insert into c select public.start_conversation('dave-cakes');
  select public.send_document(
    (select id from c), 'Here is the quote.', 'quote.pdf', 'application/pdf', 2048,
    format('conversations/%s/quote.pdf', (select id from c)));
commit;

do $$ declare n bigint; begin
  select count(*) into n from public.message_attachments;
  assert n = 1, 'the attachment is recorded, got ' || n::text;
  select count(*) into n from public.messages where body = 'Here is the quote.';
  assert n = 1, 'the document rides on a message';
  select count(*) into n from public.message_attachments a
    join public.messages m on m.id = a.message_id
   where m.conversation_id = (select id from c);
  assert n = 1, 'the attachment hangs off the message of this conversation';
end $$;

-- The vendor reads the attachment in the thread.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-dave'), true);
  do $$ declare r record; begin
    select * into r from public.conversation_attachments((select id from c));
    assert r.file_name = 'quote.pdf', 'the vendor sees the file name, got ' || r.file_name;
    assert r.content_type = 'application/pdf', 'the vendor sees the type';
    assert r.size_bytes = 2048, 'the vendor sees the size';
  end $$;
commit;

-- The link route reads one attachment by id.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-dave'), true);
  do $$ declare r record; begin
    select * into r from public.conversation_attachment(
      (select id from c), (select id from public.message_attachments));
    assert r.file_name = 'quote.pdf', 'the link route finds the file';
  end $$;
commit;

-- A document may travel without a caption.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-dave'), true);
  select public.send_document(
    (select id from c), '', 'cake.png', 'image/png', 4096,
    format('conversations/%s/cake.png', (select id from c)));
commit;

do $$ declare n bigint; begin
  select count(*) into n from public.messages where body = '';
  assert n = 1, 'a document may be sent without a caption, got ' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The database checks the file again
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  select pg_temp.expect_error(format(
    $q$select public.send_document(%L, 'Look', 'run.exe', 'application/x-msdownload', 10, %L)$q$,
    (select id from c), format('conversations/%s/run.exe', (select id from c))), 'invalid_attachment_type');
  select pg_temp.expect_error(format(
    $q$select public.send_document(%L, 'Look', 'big.pdf', 'application/pdf', 20971520, %L)$q$,
    (select id from c), format('conversations/%s/big.pdf', (select id from c))), 'invalid_attachment_size');
  select pg_temp.expect_error(format(
    $q$select public.send_document(%L, 'Look', 'quote.pdf', 'application/pdf', 10, %L)$q$,
    (select id from c), 'conversations/11111111-2222-3333-4444-555555555555/quote.pdf'),
    'forbidden: attachment path');
commit;

-- ---------------------------------------------------------------------------
-- 3. The attachment is scoped to the two houses
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-bob'), true);
  select pg_temp.expect_error(format('select * from public.conversation_attachments(%L)', (select id from c)),
    'forbidden');
  select pg_temp.expect_error(format(
    $q$select public.send_document(%L, 'Look', 'quote.pdf', 'application/pdf', 10, %L)$q$,
    (select id from c), format('conversations/%s/quote.pdf', (select id from c))), 'forbidden');
  do $$ begin
    assert not exists (select 1 from public.message_attachments),
      'RLS hides the attachment rows from an unrelated house';
  end $$;
commit;

-- Vendor staff need the chat capability, exactly as for a message.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-frank'), true);
  select pg_temp.expect_error(format('select * from public.conversation_attachments(%L)', (select id from c)),
    'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-erin'), true);
  do $$ declare n bigint; begin
    select count(*) into n from public.conversation_attachments((select id from c));
    assert n = 2, 'staff with the chat capability sees the attachments, got ' || n::text;
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 4. Clients never write the attachment table, and the bucket is private
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  select pg_temp.expect_error(format(
    $q$insert into public.message_attachments
       (message_id, conversation_id, uploaded_by, file_name, content_type, size_bytes, storage_path)
     values (%L, %L, %L, 'sneaky.pdf', 'application/pdf', 10, 'conversations/x/sneaky.pdf')$q$,
    (select id from public.messages limit 1), (select id from c), (select alice from ids)), 'permission denied');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.message_attachments$q$, 'permission denied');
commit;

-- The attachment cannot claim a conversation its message is not in.
-- A second conversation first, so both sides of the mismatch really exist.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-bob'), true);
  insert into c2 select public.start_conversation('dave-cakes');
  select public.send_message((select id from c2), 'Hello from Bob.');
commit;

do $$ declare v_message uuid; begin
  select id into v_message from public.messages where body = 'Hello from Bob.';
  assert v_message is not null, 'the second conversation has a message';

  begin
    insert into public.message_attachments
      (message_id, conversation_id, uploaded_by, file_name, content_type, size_bytes, storage_path)
    values (v_message, (select id from c), (select bob from ids), 'wrong.pdf', 'application/pdf', 10,
            'conversations/x/wrong.pdf');
    raise exception 'the attachment was accepted for the wrong conversation';
  exception when others then
    if position('foreign key' in sqlerrm) = 0 and position('row-level security' in sqlerrm) = 0 then
      raise exception 'unexpected error: %', sqlerrm;
    end if;
  end;

  assert exists (
    select 1 from pg_constraint
     where conrelid = 'public.message_attachments'::regclass
       and contype = 'f'
       and pg_get_constraintdef(oid) ilike '%(message_id, conversation_id)%'
  ), 'the attachment is tied to the conversation of its message';
end $$;

-- The bucket holds the files privately, with the size limit the route enforces.
do $$ declare r record; begin
  if to_regclass('storage.buckets') is null then
    raise notice 'the storage schema is not present; the bucket was not checked';
    return;
  end if;
  select * into r from storage.buckets where id = 'chat-attachments';
  assert r.id is not null, 'the chat attachment bucket exists';
  assert r.public = false, 'the bucket is private';
  assert r.file_size_limit = 10485760, 'the bucket refuses files over 10 MB';
  assert 'application/pdf' = any (r.allowed_mime_types), 'the bucket takes documents';
end $$;

\o
select 'F-100 chat attachment tests passed' as result;
