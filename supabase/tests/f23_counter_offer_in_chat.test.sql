-- F-23 counter-offer in chat: the offer and the conversation are one history.
--
-- Covers: a sent offer is announced in the thread as a structured message, a host counter made in
-- the thread is a quote revision tied to that thread and starts the vendor's window (F-14), a
-- counter that names another house's thread is refused, only the parties of the thread can read the
-- quote it carries, an unsent draft never reaches the thread, and clients cannot write the new
-- columns themselves.
--
-- Runs after the F-14 quote suite's own rules and before F-76's: it owns its fixtures and never
-- counts rows another suite created.
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
-- Fixtures: a host, a vendor, a second vendor, and a host who is in neither thread
-- ---------------------------------------------------------------------------
create temp table ids (
  host_user uuid, vendor_user uuid, vendor2_user uuid, outsider_user uuid,
  host_house uuid, vendor_house uuid, vendor2_house uuid, outsider_house uuid
);
grant select on ids to authenticated;

insert into public.users (auth0_sub, email, display_name) values
  ('auth0|f23-host',     'host@example.test',     'Hana Host'),
  ('auth0|f23-vendor',   'vendor@example.test',   'Vera Vendor'),
  ('auth0|f23-vendor2',  'vendor2@example.test',  'Sol Second'),
  ('auth0|f23-outsider', 'outsider@example.test', 'Obi Outsider');

insert into ids (host_user, vendor_user, vendor2_user, outsider_user)
  select (select id from public.users where auth0_sub = 'auth0|f23-host'),
         (select id from public.users where auth0_sub = 'auth0|f23-vendor'),
         (select id from public.users where auth0_sub = 'auth0|f23-vendor2'),
         (select id from public.users where auth0_sub = 'auth0|f23-outsider');

insert into public.houses (kind, owner_user_id, display_name)
  select 'host', host_user, 'Hana''s celebration' from ids;
insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', vendor_user, 'Vera Events' from ids;
insert into public.houses (kind, owner_user_id, display_name)
  select 'vendor', vendor2_user, 'Sol Events' from ids;
insert into public.houses (kind, owner_user_id, display_name)
  select 'host', outsider_user, 'Obi''s celebration' from ids;

update ids set
  host_house     = (select id from public.houses where display_name = 'Hana''s celebration'),
  vendor_house   = (select id from public.houses where display_name = 'Vera Events'),
  vendor2_house  = (select id from public.houses where display_name = 'Sol Events'),
  outsider_house = (select id from public.houses where display_name = 'Obi''s celebration');

insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select host_house, 'host', host_user, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select vendor_house, 'vendor', vendor_user, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select vendor2_house, 'vendor', vendor2_user, 'owner', '{}' from ids;
insert into public.memberships (house_id, house_kind, user_id, role, capabilities)
  select outsider_house, 'host', outsider_user, 'owner', '{}' from ids;

-- The vendors publish a profile, so a host can start the conversation the way a real one does.
insert into public.vendor_profiles
  (house_id, slug, business_name, category, headline, about, published, published_at)
  select vendor_house, 'vera-events', 'Vera Events', 'Events', 'Events in Lagos',
         'We plan celebrations across Lagos.', true, now() from ids;
insert into public.vendor_profiles
  (house_id, slug, business_name, category, headline, about, published, published_at)
  select vendor2_house, 'sol-events', 'Sol Events', 'Events', 'Events in Abuja',
         'We plan celebrations across Abuja.', true, now() from ids;

create temp table threads (name text primary key, id uuid);
create temp table quotes (name text primary key, id uuid);
grant select, insert on threads, quotes to authenticated;

-- The host starts a thread with each vendor.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-host'), true);
  insert into threads select 'pair', public.start_conversation('vera-events');
  insert into threads select 'other_pair', public.start_conversation('sol-events');
commit;

-- The outsider starts a thread with the vendor: they are not in this quote's conversation.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-outsider'), true);
  insert into threads select 'outsider', public.start_conversation('vera-events');
commit;

-- The vendor writes an offer and sends it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-vendor'), true);
  insert into quotes
    select 'sent', public.create_quote((select vendor_house from ids), (select host_house from ids),
      current_date + 60, 'NGN', 'Hall and decor',
      '[{"label":"Hall","line_total_minor":120000}]'::jsonb, '[]'::jsonb);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from quotes where name = 'sent');
    perform public.send_quote((select id from quotes where name = 'sent'), v);
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 1. The sent offer is announced in the thread
-- ---------------------------------------------------------------------------
do $$ begin
  assert exists (
    select 1 from public.messages m
     where m.conversation_id = (select id from threads where name = 'pair')
       and m.kind = 'quote_offer'
       and m.quote_id = (select id from quotes where name = 'sent')
       and m.revision = 1
       and m.sender_side = 'vendor'
  ), 'the offer is a structured message in the thread';
  assert (select count(*) from public.messages m
           where m.conversation_id = (select id from threads where name = 'pair')
             and m.kind = 'quote_offer'
             and m.quote_id = (select id from quotes where name = 'sent')) = 1,
    'the offer is announced once';
end $$;

-- The thread reads back what the message carries.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-host'), true);
  do $$ begin
    assert (select kind from public.conversation_messages((select id from threads where name = 'pair'))
             where quote_id = (select id from quotes where name = 'sent')) = 'quote_offer',
      'the thread projection carries the message kind';
    assert (select revision from public.conversation_messages((select id from threads where name = 'pair'))
             where quote_id = (select id from quotes where name = 'sent')) = 1,
      'the thread projection carries the revision';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 2. The host counters in the thread: a revision tied to it, and the vendor's window
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-host'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from quotes where name = 'sent');
    perform public.counter_quote((select id from quotes where name = 'sent'), v,
                                 'Can you include the lighting?',
                                 (select id from threads where name = 'pair'));
  end $$;
commit;

do $$ begin
  assert (select status from public.quotes where id = (select id from quotes where name = 'sent')) = 'countered',
    'the quote is countered';
  assert (select counter_response_due_at from public.quotes where id = (select id from quotes where name = 'sent'))
           > now() + interval '23 hours',
    'the counter starts the vendor window';
  assert (select conversation_id from public.quote_revisions
           where quote_id = (select id from quotes where name = 'sent') and number = 2)
           = (select id from threads where name = 'pair'),
    'the counter revision belongs to the thread';
  assert (select authored_by_role from public.quote_revisions
           where quote_id = (select id from quotes where name = 'sent') and number = 2) = 'host',
    'the counter revision is the host''s';
  assert exists (
    select 1 from public.messages m
     where m.conversation_id = (select id from threads where name = 'pair')
       and m.kind = 'counter_offer'
       and m.quote_id = (select id from quotes where name = 'sent')
       and m.revision = 2
       and m.body = 'Can you include the lighting?'
  ), 'the counter is a structured message in the thread';
end $$;

-- ---------------------------------------------------------------------------
-- 3. A counter may not name another house's thread
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-host'), true);
  -- A thread that does not exist at all.
  select pg_temp.expect_error(format(
    'select public.counter_quote(%L, (select version from public.quotes where id = %L), %L, %L)',
    (select id from quotes where name = 'sent'), (select id from quotes where name = 'sent'),
    'One more try', '00000000-0000-0000-0000-000000000000'), 'conversation_not_found');
  -- The host's thread with the other vendor: the host may talk there, but this quote is not in it.
  select pg_temp.expect_error(format(
    'select public.counter_quote(%L, (select version from public.quotes where id = %L), %L, %L)',
    (select id from quotes where name = 'sent'), (select id from quotes where name = 'sent'),
    'One more try', (select id from threads where name = 'other_pair')), 'forbidden: conversation');
commit;

-- The outsider is not in this quote's conversation, so they can neither read it nor counter in it.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-outsider'), true);
  select pg_temp.expect_error(format(
    'select * from public.thread_quotes(%L)', (select id from threads where name = 'pair')),
    'forbidden: conversation');
  select pg_temp.expect_error(format(
    'select public.counter_quote(%L, (select version from public.quotes where id = %L), %L, %L)',
    (select id from quotes where name = 'sent'), (select id from quotes where name = 'sent'),
    'One more try', (select id from threads where name = 'pair')), 'forbidden: quotes in house');
commit;

-- ---------------------------------------------------------------------------
-- 4. Only the parties of the thread read the quote it carries
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-host'), true);
  do $$ declare r record; begin
    select * into r from public.thread_quotes((select id from threads where name = 'pair'));
    assert r.quote_id = (select id from quotes where name = 'sent'), 'the host reads the thread''s quote';
    assert r.is_vendor_side = false, 'the host is on the host side';
    assert jsonb_array_length(r.revisions) = 2, 'the host reads both revisions';
    assert r.revisions -> 0 ->> 'authored_by_role' = 'vendor', 'the first revision is the vendor''s';
    assert r.revisions -> 1 ->> 'conversation_id' = (select id from threads where name = 'pair')::text,
      'the counter revision names the thread';
  end $$;
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-vendor'), true);
  do $$ declare r record; begin
    select * into r from public.thread_quotes((select id from threads where name = 'pair'));
    assert r.quote_id = (select id from quotes where name = 'sent'), 'the vendor reads the thread''s quote';
    assert r.is_vendor_side = true, 'the vendor is on the vendor side';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 5. A draft offer never reaches the thread
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-vendor'), true);
  insert into quotes
    select 'draft', public.create_quote((select vendor_house from ids), (select host_house from ids),
      current_date + 61, 'NGN', 'Not sent yet',
      '[{"label":"Hall","line_total_minor":90000}]'::jsonb, '[]'::jsonb);
commit;

begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-host'), true);
  do $$ begin
    assert not exists (
      select 1 from public.thread_quotes((select id from threads where name = 'pair'))
       where quote_id = (select id from quotes where name = 'draft')
    ), 'the draft is not in the thread';
  end $$;
commit;

-- ---------------------------------------------------------------------------
-- 6. Clients never write the new columns
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-vendor'), true);
  select pg_temp.expect_error(format(
    'update public.messages set kind = %L where conversation_id = %L',
    'text', (select id from threads where name = 'pair')), 'permission denied');
  select pg_temp.expect_error(format(
    'update public.quote_revisions set conversation_id = %L where quote_id = %L',
    (select id from threads where name = 'pair'), (select id from quotes where name = 'sent')),
    'permission denied');
commit;

-- ---------------------------------------------------------------------------
-- 7. The counter is refused once the quote is closed
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', pg_temp.claims('auth0|f23-host'), true);
  do $$ declare v integer; begin
    select version into v from public.quotes where id = (select id from quotes where name = 'sent');
    perform public.decline_quote((select id from quotes where name = 'sent'), v);
  end $$;
  select pg_temp.expect_error(format(
    'select public.counter_quote(%L, (select version from public.quotes where id = %L), %L, %L)',
    (select id from quotes where name = 'sent'), (select id from quotes where name = 'sent'),
    'Another try', (select id from threads where name = 'pair')), 'invalid_transition');
commit;

\o
\pset tuples_only on
select 'F-23 counter-offer in chat tests passed' as result;
