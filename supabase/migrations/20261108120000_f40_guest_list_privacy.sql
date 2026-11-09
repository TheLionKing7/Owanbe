-- F-40 Guest List Privacy Controls
-- Guest lists and RSVPs start private and belong to one Host house. The host can share a list with
-- selected platform users or make it public, and can revoke either at any time.
--
-- Invariants this file owns:
--   * visibility defaults to 'private' and is server state; the UI renders it, never owns it
--   * only an active member of the owning Host house reads or writes a list. Host houses are
--     owner-only (memberships.host_houses_owner_only), so no capability is invented here and no
--     host delegation is possible.
--   * phone and address exist only on public.rsvps. No shared or public projection declares those
--     columns at all, so the fields cannot leak even if a caller forgets to mask them.
--   * a share grants one existing, email-verified platform user a masked read. Revoking it, or
--     switching the list back to private, removes that access on the next read.
--   * a public list is readable by anyone through public_guest_list(), which answers with the same
--     error for "missing" and "not public" so the endpoint cannot be used to enumerate lists.
--
-- Owner decisions 2026-11-08: recipients are platform users (link sharing stays with F-70/F-71);
-- a list is house-scoped with a title because no events feature is served yet.

-- ---------------------------------------------------------------------------
-- Guest lists: one per celebration, owned by a Host house
-- ---------------------------------------------------------------------------
create table public.guest_lists (
  id         uuid primary key default gen_random_uuid(),
  house_id   uuid not null,
  house_kind text not null default 'host' check (house_kind = 'host'),
  title      text not null check (length(title) between 1 and 120),
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'public')),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade
);
comment on table public.guest_lists is
  'F-40: a Host house''s guest list. visibility is private until the host changes it.';
create index guest_lists_house_idx on public.guest_lists (house_id, created_at desc);
create trigger guest_lists_touch before update on public.guest_lists
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- RSVPs: the only place a guest's phone number or address is stored
-- ---------------------------------------------------------------------------
create table public.rsvps (
  id            uuid primary key default gen_random_uuid(),
  guest_list_id uuid not null references public.guest_lists (id) on delete cascade,
  display_name  text not null check (length(display_name) between 1 and 120),
  response      text not null default 'invited' check (response in ('invited', 'yes', 'no', 'maybe')),
  phone         text check (phone is null or length(phone) <= 32),
  address       text check (address is null or length(address) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1
);
comment on table public.rsvps is
  'F-40: host-only guest rows. phone/address are never selected by a shared or public projection.';
create index rsvps_list_idx on public.rsvps (guest_list_id, created_at);
create trigger rsvps_touch before update on public.rsvps
  for each row execute function app_private.touch();

-- No free-text note column: dietary and allergy details are F-59's consent-gated data, and a note
-- field would let a host store them here without consent.

-- ---------------------------------------------------------------------------
-- Shares: a revocable grant to one platform user
-- ---------------------------------------------------------------------------
create table public.guest_list_shares (
  id              uuid primary key default gen_random_uuid(),
  guest_list_id   uuid not null references public.guest_lists (id) on delete cascade,
  grantee_user_id uuid not null references public.users (id),
  granted_by      uuid not null references public.users (id),
  revoked_at      timestamptz,
  revoked_by      uuid references public.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  constraint shares_revocation_pair check ((revoked_at is null) = (revoked_by is null))
);
comment on table public.guest_list_shares is
  'F-40: one live grant per (list, recipient). revoked_at ends the read immediately.';
create unique index guest_list_shares_one_live on public.guest_list_shares (guest_list_id, grantee_user_id)
  where revoked_at is null;
create index guest_list_shares_grantee_idx on public.guest_list_shares (grantee_user_id)
  where revoked_at is null;
create trigger guest_list_shares_touch before update on public.guest_list_shares
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Row-level security: hosts read their own rows; everyone else goes through a projection
-- ---------------------------------------------------------------------------
alter table public.guest_lists enable row level security;
alter table public.guest_lists force row level security;
alter table public.rsvps enable row level security;
alter table public.rsvps force row level security;
alter table public.guest_list_shares enable row level security;
alter table public.guest_list_shares force row level security;

revoke all on public.guest_lists, public.rsvps, public.guest_list_shares
  from public, anon, authenticated;
grant select on public.guest_lists, public.rsvps, public.guest_list_shares to authenticated;
grant all on public.guest_lists, public.rsvps, public.guest_list_shares to service_role;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create function app_private.load_guest_list(p_list uuid)
returns public.guest_lists
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l public.guest_lists;
begin
  select * into v_l from public.guest_lists where id = p_list;
  if not found then
    raise exception 'guest_list_not_found' using errcode = 'P0002';
  end if;
  return v_l;
end;
$$;
revoke all on function app_private.load_guest_list(uuid) from public;

create function app_private.require_list_host(p_list uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l     public.guest_lists := app_private.load_guest_list(p_list);
  v_actor uuid := app_private.current_user_id();
begin
  if v_actor is null
     or not app_private.is_active_member(v_l.house_id)
     or exists (select 1 from public.houses h where h.id = v_l.house_id and h.archived_at is not null) then
    raise exception 'forbidden: guest lists in house' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function app_private.require_list_host(uuid) from public;
grant execute on function app_private.require_list_host(uuid) to authenticated;

create function app_private.expect_list_version(p_list public.guest_lists, p_expected integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_list.version <> p_expected then
    raise exception 'stale_version: expected %, found %', p_expected, p_list.version
      using errcode = '40001';
  end if;
end;
$$;
revoke all on function app_private.expect_list_version(public.guest_lists, integer) from public;

-- True when the caller holds a live grant on this list. Used by the masked recipient projection.
create function app_private.has_list_share(p_list uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.guest_list_shares s
    where s.guest_list_id = p_list
      and s.grantee_user_id = app_private.current_user_id()
      and s.revoked_at is null
  )
$$;
revoke all on function app_private.has_list_share(uuid) from public;
grant execute on function app_private.has_list_share(uuid) to authenticated;

create policy guest_lists_host_read on public.guest_lists
  for select to authenticated
  using (app_private.is_active_member(house_id)
         and exists (select 1 from public.houses h
                     where h.id = house_id and h.archived_at is null));

-- Contacts stay host-only: a recipient never reads this table, only the masked projection.
create policy rsvps_host_read on public.rsvps
  for select to authenticated
  using (exists (
    select 1 from public.guest_lists l
    join public.houses h on h.id = l.house_id and h.archived_at is null
    where l.id = guest_list_id and app_private.is_active_member(l.house_id)
  ));

create policy guest_list_shares_host_read on public.guest_list_shares
  for select to authenticated
  using (exists (
    select 1 from public.guest_lists l
    join public.houses h on h.id = l.house_id and h.archived_at is null
    where l.id = guest_list_id and app_private.is_active_member(l.house_id)
  ));

create policy guest_list_shares_grantee_read on public.guest_list_shares
  for select to authenticated
  using (grantee_user_id = app_private.current_user_id() and revoked_at is null);

-- ---------------------------------------------------------------------------
-- Host writes
-- ---------------------------------------------------------------------------
create function public.create_guest_list(p_house uuid, p_title text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.current_user_id();
  v_id    uuid;
begin
  if v_actor is null
     or not app_private.is_active_member(p_house)
     or not exists (select 1 from public.houses h
                    where h.id = p_house and h.kind = 'host' and h.archived_at is null) then
    raise exception 'forbidden: guest lists in house' using errcode = '42501';
  end if;
  if p_title is null or length(trim(p_title)) not between 1 and 120 then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  insert into public.guest_lists (house_id, title, created_by)
  values (p_house, trim(p_title), v_actor)
  returning id into v_id;

  perform app_private.audit(v_actor, 'guest_list.created', 'guest_lists', v_id, p_house,
                            '{"visibility":"private"}');
  return v_id;
end;
$$;
revoke all on function public.create_guest_list(uuid, text) from public, anon;
grant execute on function public.create_guest_list(uuid, text) to authenticated;

create function public.add_guest_rsvp(
  p_list uuid, p_display_name text, p_response text default 'invited',
  p_phone text default null, p_address text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_list_host(p_list);
  v_id    uuid;
begin
  if p_display_name is null or length(trim(p_display_name)) not between 1 and 120 then
    raise exception 'invalid_guest_name' using errcode = '22023';
  end if;
  if p_response is null or p_response not in ('invited', 'yes', 'no', 'maybe') then
    raise exception 'invalid_response' using errcode = '22023';
  end if;
  if length(coalesce(p_phone, '')) > 32 or length(coalesce(p_address, '')) > 300 then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;

  insert into public.rsvps (guest_list_id, display_name, response, phone, address)
  values (p_list, trim(p_display_name), p_response, nullif(trim(p_phone), ''), nullif(trim(p_address), ''))
  returning id into v_id;

  perform app_private.audit(v_actor, 'guest_list.rsvp_added', 'rsvps', v_id,
                            (select house_id from public.guest_lists where id = p_list),
                            jsonb_build_object('guest_list_id', p_list));
  return v_id;
end;
$$;
revoke all on function public.add_guest_rsvp(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_guest_rsvp(uuid, text, text, text, text) to authenticated;

-- Visibility is the host's switch. Going private revokes every live grant in the same transaction,
-- so "revoked" and "nobody can read it" cannot drift apart.
create function public.set_guest_list_visibility(p_list uuid, p_visibility text, p_expected_version integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := app_private.require_list_host(p_list);
  v_l       public.guest_lists := app_private.load_guest_list(p_list);
  v_version integer;
begin
  perform app_private.expect_list_version(v_l, p_expected_version);
  if p_visibility is null or p_visibility not in ('private', 'shared', 'public') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;

  if p_visibility = 'private' then
    update public.guest_list_shares
       set revoked_at = now(), revoked_by = v_actor
     where guest_list_id = p_list and revoked_at is null;
  end if;

  update public.guest_lists set visibility = p_visibility
   where id = p_list
  returning version into v_version;

  perform app_private.audit(v_actor, 'guest_list.visibility_changed', 'guest_lists', p_list, v_l.house_id,
                            jsonb_build_object('from', v_l.visibility, 'to', p_visibility));
  return v_version;
end;
$$;
revoke all on function public.set_guest_list_visibility(uuid, text, integer) from public, anon;
grant execute on function public.set_guest_list_visibility(uuid, text, integer) to authenticated;

-- Recipients are existing platform users with a verified email: a grant is enforced access, not a
-- promise to someone who cannot sign in. The email is resolved here and never returned or logged.
create function public.share_guest_list(p_list uuid, p_grantee_email text, p_expected_version integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := app_private.require_list_host(p_list);
  v_l       public.guest_lists := app_private.load_guest_list(p_list);
  v_email   text := lower(trim(coalesce(p_grantee_email, '')));
  v_grantee uuid;
  v_matches integer;
  v_version integer;
begin
  perform app_private.expect_list_version(v_l, p_expected_version);
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 320 then
    raise exception 'invalid_recipient' using errcode = '22023';
  end if;

  select count(*) into v_matches from public.users u
   where lower(u.email) = v_email and u.status = 'active' and u.email_verified;
  if v_matches = 0 then
    raise exception 'recipient_not_found' using errcode = 'P0002';
  end if;
  if v_matches > 1 then
    raise exception 'recipient_ambiguous' using errcode = '22023';
  end if;
  select u.id into v_grantee from public.users u
   where lower(u.email) = v_email and u.status = 'active' and u.email_verified;

  if exists (select 1 from public.guest_list_shares s
             where s.guest_list_id = p_list and s.grantee_user_id = v_grantee and s.revoked_at is null) then
    raise exception 'already_shared' using errcode = '22023';
  end if;

  insert into public.guest_list_shares (guest_list_id, grantee_user_id, granted_by)
  values (p_list, v_grantee, v_actor);

  -- A public list stays public; a private one becomes shared. Either way the aggregate advances.
  update public.guest_lists
     set visibility = case when visibility = 'public' then 'public' else 'shared' end
   where id = p_list
  returning version into v_version;

  perform app_private.audit(v_actor, 'guest_list.shared', 'guest_lists', p_list, v_l.house_id,
                            jsonb_build_object('grantee_user_id', v_grantee));
  return v_version;
end;
$$;
revoke all on function public.share_guest_list(uuid, text, integer) from public, anon;
grant execute on function public.share_guest_list(uuid, text, integer) to authenticated;

create function public.revoke_guest_list_share(p_list uuid, p_share uuid, p_expected_version integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := app_private.require_list_host(p_list);
  v_l       public.guest_lists := app_private.load_guest_list(p_list);
  v_version integer;
begin
  perform app_private.expect_list_version(v_l, p_expected_version);

  update public.guest_list_shares
     set revoked_at = now(), revoked_by = v_actor
   where id = p_share and guest_list_id = p_list and revoked_at is null;
  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;

  -- The last recipient leaving turns a shared list private again; a public list stays public.
  update public.guest_lists
     set visibility = case
           when visibility = 'shared'
                and not exists (select 1 from public.guest_list_shares s
                                where s.guest_list_id = p_list and s.revoked_at is null)
             then 'private'
           else visibility
         end
   where id = p_list
  returning version into v_version;

  perform app_private.audit(v_actor, 'guest_list.share_revoked', 'guest_list_shares', p_share, v_l.house_id,
                            jsonb_build_object('guest_list_id', p_list));
  return v_version;
end;
$$;
revoke all on function public.revoke_guest_list_share(uuid, uuid, integer) from public, anon;
grant execute on function public.revoke_guest_list_share(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Host projections
-- ---------------------------------------------------------------------------
create function public.my_guest_lists(p_house uuid)
returns table (
  list_id     uuid,
  title       text,
  visibility  text,
  version     integer,
  guest_count bigint,
  yes_count   bigint,
  share_count bigint,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_active_member(p_house)
     or not exists (select 1 from public.houses h
                    where h.id = p_house and h.kind = 'host' and h.archived_at is null) then
    raise exception 'forbidden: guest lists in house' using errcode = '42501';
  end if;

  return query
    select l.id, l.title, l.visibility, l.version,
           (select count(*) from public.rsvps r where r.guest_list_id = l.id),
           (select count(*) from public.rsvps r where r.guest_list_id = l.id and r.response = 'yes'),
           (select count(*) from public.guest_list_shares s
             where s.guest_list_id = l.id and s.revoked_at is null),
           l.created_at
    from public.guest_lists l
    where l.house_id = p_house
    order by l.created_at desc;
end;
$$;
revoke all on function public.my_guest_lists(uuid) from public, anon;
grant execute on function public.my_guest_lists(uuid) to authenticated;

-- The only function that returns phone or address, and only to the owning host.
create function public.guest_list_rsvps(p_list uuid)
returns table (
  rsvp_id      uuid,
  display_name text,
  response     text,
  phone        text,
  address      text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_list_host(p_list);

  return query
    select r.id, r.display_name, r.response, r.phone, r.address, r.created_at
    from public.rsvps r
    where r.guest_list_id = p_list
    order by r.created_at;
end;
$$;
revoke all on function public.guest_list_rsvps(uuid) from public, anon;
grant execute on function public.guest_list_rsvps(uuid) to authenticated;

create function public.guest_list_recipients(p_list uuid)
returns table (share_id uuid, display_name text, granted_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_list_host(p_list);

  return query
    select s.id, coalesce(u.display_name, 'Guest'), s.created_at
    from public.guest_list_shares s
    join public.users u on u.id = s.grantee_user_id
    where s.guest_list_id = p_list and s.revoked_at is null
    order by s.created_at;
end;
$$;
revoke all on function public.guest_list_recipients(uuid) from public, anon;
grant execute on function public.guest_list_recipients(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Masked projections: no phone column, no address column, at any visibility
-- ---------------------------------------------------------------------------
create function public.shared_with_me()
returns table (list_id uuid, title text, guest_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.title, (select count(*) from public.rsvps r where r.guest_list_id = l.id)
  from public.guest_list_shares s
  join public.guest_lists l on l.id = s.guest_list_id
  join public.houses h on h.id = l.house_id and h.archived_at is null
  where s.grantee_user_id = app_private.current_user_id() and s.revoked_at is null
  order by s.created_at desc
$$;
revoke all on function public.shared_with_me() from public, anon;
grant execute on function public.shared_with_me() to authenticated;

create function public.shared_guest_list(p_list uuid)
returns table (display_name text, response text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l public.guest_lists := app_private.load_guest_list(p_list);
begin
  if exists (select 1 from public.houses h where h.id = v_l.house_id and h.archived_at is not null) then
    raise exception 'guest_list_not_found' using errcode = 'P0002';
  end if;
  if not (app_private.has_list_share(p_list)
          or app_private.is_active_member(v_l.house_id)) then
    raise exception 'forbidden: guest list' using errcode = '42501';
  end if;

  return query
    select r.display_name, r.response
    from public.rsvps r
    where r.guest_list_id = p_list
    order by r.created_at;
end;
$$;
revoke all on function public.shared_guest_list(uuid) from public, anon;
grant execute on function public.shared_guest_list(uuid) to authenticated;

-- Public read, same shape as public_vendor_profiles: safe columns only, and one error for both
-- "no such list" and "not public" so the endpoint cannot enumerate private lists.
create function public.public_guest_list(p_list uuid)
returns table (list_title text, display_name text, response text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_l public.guest_lists;
begin
  select * into v_l from public.guest_lists l
   where l.id = p_list and l.visibility = 'public'
     and exists (select 1 from public.houses h where h.id = l.house_id and h.archived_at is null);
  if not found then
    raise exception 'guest_list_not_public' using errcode = 'P0002';
  end if;

  return query
    select v_l.title, r.display_name, r.response
    from public.rsvps r
    where r.guest_list_id = p_list
    order by r.created_at;
end;
$$;
revoke all on function public.public_guest_list(uuid) from public;
grant execute on function public.public_guest_list(uuid) to anon, authenticated;

notify pgrst, 'reload schema';