-- F-100 in-app chat tests. Raises on the first failure.
-- Covers: a host and a vendor exchange messages before a quote exists, messages persist per
-- conversation, a conversation is invisible to every other house, and only vendor users whose
-- membership carries the 'chat' capability may speak for a vendor house.
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
-- Fixtures: a host, a vendor owner, vendor staff with and without the 'chat'
-- capability, and a host who takes no part in any of it.
-- ---------------------------------------------------------------------------
create temp table ids (alice uuid, bob uuid, dave uuid, erin uuid, frank uuid, greg uuid,
                       alice_host uuid, bob_host uuid, dave_vendor uuid, greg_vendor uuid);
create temp table c (id uuid);
create temp table c2 (id uuid);
grant select on ids, c, c2 to authenticated, anon;
grant insert, update on c, c2 to authenticated;

insert into public.users (auth0_sub, email, email_verified, display_name) values
  ('auth0|f100-alice', 'alice@example.test', true, 'Alice Adeyemi'),
  ('auth0|f100-bob',   'bob@example.test',   true, 'Bob Ogun'),
  ('auth0|f100-dave',  'dave@example.test',  true, 'Dave Oyelowo'),
  ('auth0|f100-erin',  'erin@example.test',  true, 'Erin Staff'),
  ('auth0|f100-frank', 'frank@example.test', true, 'Frank No Grant'),
  ('auth0|f100-greg',  'greg@example.test',  true, 'Greg Foods');

insert into ids (alice, bob, dave, erin, frank, greg)
  select (select id from public.users where auth0_sub = 'auth0|f100-alice'),
         (select id from public.users where auth0_sub = 'auth0|f100-bob'),
         (select id from public.users where auth0_sub = 'auth0|f100-dave'),
         (select id from public.users where auth0_sub = 'auth0|f100-erin'),
         (select id from public.users where auth0_sub = 'auth0|f100-frank'),
         (select id from public.users where auth0_sub = 'auth0|f100-greg');

insert into public.houses (kind, owner_user_id, display_name) select 'host', alice, 'Alice''s celebrations' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'host', bob, 'The Ogun wedding' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', dave, 'Dave Cakes Ltd' from ids;
insert into public.houses (kind, owner_user_id, display_name) select 'vendor', greg, 'Greg Foods' from ids;

update ids set
  alice_host  = (select id from public.houses where display_name = 'Alice''s celebrations'),
  bob_host    = (select id from public.houses where display_name = 'The Ogun wedding'),
  dave_vendor = (select id from public.houses where display_name = 'Dave Cakes Ltd'),
  greg_vendor = (select id from public.houses where display_name = 'Greg Foods');

insert into public.memberships (house_id, house_kind, user_id, role) select alice_host, 'host', alice, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select bob_host, 'host', bob, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select dave_vendor, 'vendor', dave, 'owner' from ids;
insert into public.memberships (house_id, house_kind, user_id, role) select greg_vendor, 'vendor', greg, 'owner' from ids;
-- Staff of the vendor house: Erin may chat, Frank may not.
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select dave_vendor, 'vendor', erin, 'staff', array['chat'] from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select dave_vendor, 'vendor', frank, 'staff', array['profile'] from ids;

-- The vendor publishes a profile, so hosts can find and message the business.
insert into public.vendor_profiles (house_id, slug, business_name, category, headline, about, published, published_at)
  select dave_vendor, 'dave-cakes', 'Dave Cakes Ltd', 'Cakes', 'Wedding cakes in Lagos',
         'We bake celebration cakes across Lagos.', true, now() from ids;
insert into public.vendor_profiles (house_id, slug, business_name, category, headline, about, published, published_at)
  select greg_vendor, 'greg-foods', 'Greg Foods', 'Food', 'Jollof for every celebration',
         'Traditional jollof and party trays.', true, now() from ids;

-- ---------------------------------------------------------------------------
-- 1. The host starts a conversation with a published vendor
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  insert into c select public.start_conversation('dave-cakes');
commit;

do $$ declare r public.conversations; begin
  select * into r from public.conversations where id = (select id from c);
  assert r.host_house_id = (select alice_host from ids), 'the conversation sits in the host house';
  assert r.vendor_house_id = (select dave_vendor from ids), 'the conversation names the vendor house';
  assert r.started_by = (select alice from ids), 'the host started it';
  assert r.host_house_kind = 'host' and r.vendor_house_kind = 'vendor', 'the two sides are fixed';
end $$;

-- The same pair shares one conversation, not two threads.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  insert into c select public.start_conversation('dave-cakes');
commit;

do $$ begin
  assert (select count(*) from public.conversations) = 1,
    'one conversation per house pair, got ' || (select count(*) from public.conversations)::text;
end $$;

-- A vendor without a published profile cannot be reached.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  select pg_temp.expect_error($q$select public.start_conversation('nobody-here')$q$, 'vendor_not_found');
  select pg_temp.expect_error($q$select public.start_conversation('   ')$q$, 'invalid_vendor');
commit;

-- A vendor house cannot start a conversation, and neither can a signed-out caller.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-dave'), true);
  select pg_temp.expect_error($q$select public.start_conversation('dave-cakes')$q$, 'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-bob'), true);
  select pg_temp.expect_error($q$select public.start_conversation('dave-cakes')$q$, 'forbidden');
commit;

-- ---------------------------------------------------------------------------
-- 2. The vendor replies, and the messages persist per conversation
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  select public.send_message((select id from c), 'Do you have 12 December free?');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-dave'), true);
  select public.send_message((select id from c), 'Yes, 12 December works.');
commit;

do $$ declare n bigint; begin
  select count(*) into n from public.messages where conversation_id = (select id from c);
  assert n = 2, 'both messages are stored, got ' || n::text;
  select count(*) into n from public.messages where conversation_id = (select id from c)
    and body = 'Yes, 12 December works.';
  assert n = 1, 'the vendor message is stored';
end $$;

-- Both sides read the same thread, and each side is marked for its own reader.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  do $$ declare r record; begin
    select * into r from public.conversation_messages((select id from c));
    assert r.side = 'host', 'the host reads the host side';
    assert r.counterparty_name = 'Dave Cakes Ltd', 'the host sees the vendor name, got ' || r.counterparty_name;
    assert r.body = 'Do you have 12 December free?', 'the first message is the host''s';
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-dave'), true);
  do $$ declare r record; begin
    select * into r from public.conversation_messages((select id from c));
    assert r.side = 'vendor', 'the vendor reads the vendor side';
    assert r.counterparty_name = 'Alice''s celebrations', 'the vendor sees the host house name';
  end $$;
commit;

-- A conversation with no messages still reads as a conversation.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  insert into c2 select public.start_conversation('greg-foods');
  do $$ declare r record; begin
    select * into r from public.conversation_messages((select id from c2));
    assert r.side = 'host', 'an empty conversation still names the reader''s side';
    assert r.counterparty_name = 'Greg Foods', 'the vendor name is there, got ' || r.counterparty_name;
    assert r.message_id is null, 'an empty conversation has no message rows';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 3. The conversation is scoped to the two houses
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-bob'), true);
  select pg_temp.expect_error(format('select * from public.conversation_messages(%L)', (select id from c)), 'forbidden');
  select pg_temp.expect_error(format('select public.send_message(%L, %L)', (select id from c), 'Hello'),
    'forbidden');
  do $$ begin
    assert (select count(*) from public.my_conversations()) = 0,
      'an unrelated house sees no conversations';
    assert not exists (select 1 from public.conversations where id = (select id from c)),
      'RLS hides the conversation from an unrelated house';
    assert not exists (select 1 from public.messages where conversation_id = (select id from c)),
      'RLS hides the messages from an unrelated house';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 4. Only vendor users the owner granted chat may speak for the vendor house
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-frank'), true);
  select pg_temp.expect_error(format('select * from public.conversation_messages(%L)', (select id from c)), 'forbidden');
  select pg_temp.expect_error(format('select public.send_message(%L, %L)', (select id from c), 'Let me in'),
    'forbidden');
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-erin'), true);
  select public.send_message((select id from c), 'I can answer this one.');
  do $$ begin
    assert (select count(*) from public.my_conversations()) = 1,
      'staff with the chat capability sees the vendor conversation';
  end $$;
commit;

-- A revoked grant takes the conversation away again.
update public.memberships set revoked_at = now(), revoked_by = (select dave from ids)
 where user_id = (select erin from ids);

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-erin'), true);
  select pg_temp.expect_error(format('select * from public.conversation_messages(%L)', (select id from c)), 'forbidden');
commit;

-- ---------------------------------------------------------------------------
-- 5. Messages are append-only and clients never write directly
-- ---------------------------------------------------------------------------
-- Append-only is the database's own rule, so it is checked as the owner.
select pg_temp.expect_error(format(
  $q$update public.messages set body = 'edited' where conversation_id = %L$q$, (select id from c)), 'append-only');
select pg_temp.expect_error(format(
  $q$delete from public.messages where conversation_id = %L$q$, (select id from c)), 'append-only');

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  select pg_temp.expect_error(format(
    $q$insert into public.messages (conversation_id, sender_user_id, sender_house_id, sender_side, body)
       values (%L, %L, %L, 'host', 'sneaky')$q$,
    (select id from c), (select alice from ids), (select alice_host from ids)), 'permission denied');
commit;

begin;
  set local role anon;
  select pg_temp.expect_error($q$select * from public.messages$q$, 'permission denied');
  select pg_temp.expect_error($q$select * from public.conversations$q$, 'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 6. An empty or oversized message is refused
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  select pg_temp.expect_error(format('select public.send_message(%L, %L)', (select id from c), '   '),
    'invalid_message');
  select pg_temp.expect_error(format('select public.send_message(%L, %L)', (select id from c),
    repeat('a', 4001)), 'invalid_message');
commit;

-- ---------------------------------------------------------------------------
-- 7. Each house sees its own conversations
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-alice'), true);
  do $$ declare r record; begin
    select * into r from public.my_conversations();
    assert r.side = 'host', 'the host is on the host side';
    assert r.message_count = 3, 'the host sees every message, got ' || r.message_count::text;
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f100-dave'), true);
  do $$ declare r record; begin
    select * into r from public.my_conversations();
    assert r.side = 'vendor', 'the vendor is on the vendor side';
    assert r.message_count = 3, 'the vendor sees every message, got ' || r.message_count::text;
  end $$;
commit;

\o
select 'F-100 chat tests passed' as result;
