-- F-77 Data model (foundation)
-- Conventions every table follows (enforced by supabase/tests/schema_conventions.test.sql):
--   * uuid primary key `id` (gen_random_uuid)
--   * timestamptz only (UTC); created_at / updated_at maintained by app_private.touch()
--   * optimistic concurrency via integer `version` (bumped on every update)
--   * money as bigint `<name>_minor` + `currency` (ISO 4217), never float/numeric
--   * RLS enabled and forced; clients never write tables directly (server functions do)
-- Tenancy is derived through foreign keys. Composite (id, kind) keys stop a record that
-- needs a vendor house from pointing at a host house, and vice versa.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create function app_private.touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := old.created_at;  -- immutable
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

-- users adopts the shared trigger; the F-76 specific one is retired
drop trigger users_touch on public.users;
drop function app_private.touch_user();
create trigger users_touch before update on public.users
  for each row execute function app_private.touch();

-- Active application user for the current request (raises if the token is invalid).
create function app_private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from public.users u
  where u.auth0_sub = app_private.verified_sub() and u.status = 'active'
$$;
revoke all on function app_private.current_user_id() from public;
grant execute on function app_private.current_user_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only audit log
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid references public.users (id),
  action        text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_table  text not null,
  target_id     uuid not null,
  house_id      uuid,
  purpose       text,
  details       jsonb not null default '{}'::jsonb   -- identifiers only, never sensitive payloads
);
create index audit_events_target_idx on public.audit_events (target_table, target_id);
create index audit_events_house_idx on public.audit_events (house_id) where house_id is not null;

create function app_private.forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
create trigger audit_events_append_only before update or delete or truncate on public.audit_events
  for each statement execute function app_private.forbid_change();

create function app_private.audit(p_actor uuid, p_action text, p_table text, p_target uuid,
                                  p_house uuid default null, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (actor_user_id, action, target_table, target_id, house_id, details)
  values (p_actor, p_action, p_table, p_target, p_house, p_details);
$$;
revoke all on function app_private.audit(uuid, text, text, uuid, uuid, jsonb) from public;

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
revoke all on public.audit_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Houses: one Host house and at most one Vendor house per account
-- ---------------------------------------------------------------------------
create table public.houses (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('host', 'vendor')),
  owner_user_id uuid not null references public.users (id),
  display_name  text not null check (length(display_name) between 1 and 120),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  unique (owner_user_id, kind),
  unique (id, kind)                 -- target for kind-checked composite foreign keys
);
create trigger houses_touch before update on public.houses
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Memberships: owner of any house; staff only in vendor houses
-- ---------------------------------------------------------------------------
create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  house_id     uuid not null,
  house_kind   text not null,
  user_id      uuid not null references public.users (id),
  role         text not null check (role in ('owner', 'staff')),
  capabilities text[] not null default '{}'
               check (capabilities <@ array['chat','quotes','calendar','profile','bookings','payouts','members','billing']),
  revoked_at   timestamptz,
  revoked_by   uuid references public.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade,
  -- host houses have no delegated operators
  constraint host_houses_owner_only check (house_kind = 'vendor' or role = 'owner'),
  -- payouts, member administration and billing stay with the owner
  constraint staff_not_owner_capabilities
    check (role = 'owner' or not capabilities && array['payouts','members','billing']),
  constraint revocation_attributed check (revoked_at is null or revoked_by is not null)
);
create unique index memberships_active_unique on public.memberships (house_id, user_id) where revoked_at is null;
create unique index memberships_one_owner on public.memberships (house_id) where role = 'owner' and revoked_at is null;
create index memberships_user_idx on public.memberships (user_id) where revoked_at is null;
create trigger memberships_touch before update on public.memberships
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Platform staff grants and their scoped assignments
-- ---------------------------------------------------------------------------
create table public.staff_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id),
  capability  text not null check (capability in
              ('support', 'finance', 'operations', 'arbitrator', 'event_manager', 'verification_reviewer')),
  scope_kind  text not null check (scope_kind in ('global', 'event', 'case', 'verification_case')),
  granted_by  uuid not null references public.users (id),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  unique (id, scope_kind),
  constraint grant_not_self check (granted_by <> user_id),
  constraint grant_expiry_future check (expires_at is null or expires_at > created_at),
  -- event managers only ever work through event assignments
  constraint event_manager_scoped check (capability <> 'event_manager' or scope_kind = 'event')
);
create index staff_grants_user_idx on public.staff_grants (user_id) where revoked_at is null;
create trigger staff_grants_touch before update on public.staff_grants
  for each row execute function app_private.touch();

create table public.assignments (
  id             uuid primary key default gen_random_uuid(),
  staff_grant_id uuid not null,
  target_kind    text not null check (target_kind in ('event', 'case', 'verification_case')),
  target_id      uuid not null,   -- FK added when events/cases tables land (their features)
  assigned_by    uuid not null references public.users (id),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        integer not null default 1,
  -- an assignment can only use a grant scoped to the same kind of target
  foreign key (staff_grant_id, target_kind) references public.staff_grants (id, scope_kind),
  constraint assignment_expiry_future check (expires_at is null or expires_at > created_at)
);
create unique index assignments_active_unique on public.assignments (staff_grant_id, target_kind, target_id)
  where revoked_at is null;
create trigger assignments_touch before update on public.assignments
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Row-level security: read-only, least visibility; all writes via server functions
-- ---------------------------------------------------------------------------
alter table public.houses enable row level security;
alter table public.houses force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
alter table public.staff_grants enable row level security;
alter table public.staff_grants force row level security;
alter table public.assignments enable row level security;
alter table public.assignments force row level security;

revoke all on public.houses, public.memberships, public.staff_grants, public.assignments
  from public, anon, authenticated;
grant select on public.houses, public.memberships, public.staff_grants, public.assignments to authenticated;

-- Membership check without RLS recursion
create function app_private.is_active_member(p_house uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.house_id = p_house and m.user_id = app_private.current_user_id() and m.revoked_at is null
  )
$$;
revoke all on function app_private.is_active_member(uuid) from public;
grant execute on function app_private.is_active_member(uuid) to authenticated;

create policy houses_members_read on public.houses
  for select to authenticated using (archived_at is null and app_private.is_active_member(id));

create policy memberships_self_read on public.memberships
  for select to authenticated using (user_id = app_private.current_user_id());

create policy staff_grants_self_read on public.staff_grants
  for select to authenticated
  using (user_id = app_private.current_user_id() and revoked_at is null
         and (expires_at is null or expires_at > now()));

create policy assignments_self_read on public.assignments
  for select to authenticated
  using (revoked_at is null and (expires_at is null or expires_at > now())
         and exists (select 1 from public.staff_grants g
                     where g.id = staff_grant_id and g.user_id = app_private.current_user_id()
                       and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())));

-- ---------------------------------------------------------------------------
-- Server functions
-- ---------------------------------------------------------------------------
-- Every account gets its Host house (and owner membership) on first admission.
create function app_private.provision_host_house(p_user public.users)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house uuid;
begin
  insert into public.houses (kind, owner_user_id, display_name)
  values ('host', p_user.id, coalesce(nullif(split_part(p_user.display_name, ' ', 1), '') || '''s celebrations', 'My celebrations'))
  on conflict (owner_user_id, kind) do nothing
  returning id into v_house;

  if v_house is not null then
    insert into public.memberships (house_id, house_kind, user_id, role)
    values (v_house, 'host', p_user.id, 'owner');
    perform app_private.audit(p_user.id, 'house.created', 'houses', v_house, v_house, '{"kind":"host"}');
  end if;
end;
$$;
revoke all on function app_private.provision_host_house(public.users) from public;

-- F-76 session gate, extended: an admitted user always has a Host house.
create or replace function public.ensure_user()
returns public.users
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_sub  text  := app_private.verified_sub();
  v_user public.users;
begin
  insert into public.users as u (auth0_sub, email, email_verified, display_name, last_seen_at)
  values (
    v_sub,
    nullif(left(coalesce(claims ->> 'email', claims ->> 'https://owanbe.app/email'), 320), ''),
    coalesce((coalesce(claims ->> 'email_verified', claims ->> 'https://owanbe.app/email_verified'))::boolean, false),
    nullif(left(coalesce(claims ->> 'name', claims ->> 'https://owanbe.app/name'), 120), ''),
    now()
  )
  on conflict (auth0_sub) do update
    set last_seen_at   = now(),
        email          = coalesce(excluded.email, u.email),
        email_verified = excluded.email_verified or u.email_verified,
        display_name   = coalesce(u.display_name, excluded.display_name)
  returning * into v_user;

  if v_user.status <> 'active' then
    raise exception 'account_%', v_user.status using errcode = '42501';
  end if;

  perform app_private.provision_host_house(v_user);
  return v_user;
end;
$$;

-- Authorized projection of the caller's houses (no other party's data).
create function public.my_houses()
returns table (house_id uuid, kind text, display_name text, role text, capabilities text[])
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.kind, h.display_name, m.role, m.capabilities
  from public.memberships m
  join public.houses h on h.id = m.house_id and h.kind = m.house_kind
  where m.user_id = app_private.current_user_id()
    and m.revoked_at is null
    and h.archived_at is null
  order by h.kind
$$;
revoke all on function public.my_houses() from public, anon;
grant execute on function public.my_houses() to authenticated;
