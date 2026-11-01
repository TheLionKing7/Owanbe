-- F-76 Authentication
-- Auth0 is the identity authority. Supabase verifies the token signature against the
-- Auth0 JWKS (third-party auth). This migration adds the application checks on top:
-- issuer, audience and expiry are re-validated in the database, each Auth0 subject maps
-- to exactly one application user, and account status is checked before any access.

create schema if not exists app_private;
revoke all on schema app_private from public;

-- Per-environment Auth0 settings (one row). Fail closed while unset.
create table app_private.auth_settings (
  id         boolean primary key default true check (id),
  issuer     text not null check (issuer ~ '^https://[^/]+/$'),
  audience   text not null check (length(audience) > 0),
  updated_at timestamptz not null default now()
);
revoke all on app_private.auth_settings from public;

-- Called by operators / CI with the service role:
--   select app_private.configure_auth0('owanbe.us.auth0.com', 'https://api.owanbe.app');
create function app_private.configure_auth0(p_domain text, p_audience text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into app_private.auth_settings (id, issuer, audience, updated_at)
  values (true, 'https://' || trim(both '/' from p_domain) || '/', p_audience, now())
  on conflict (id) do update
    set issuer = excluded.issuer, audience = excluded.audience, updated_at = now();
$$;
revoke all on function app_private.configure_auth0(text, text) from public;

-- Returns the verified Auth0 subject of the current request, or raises.
-- Signature is verified by Supabase before claims reach auth.jwt().
create function app_private.verified_sub()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims   jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  settings app_private.auth_settings;
  aud      jsonb;
  sub      text  := claims ->> 'sub';
begin
  select * into settings from app_private.auth_settings where id;
  if not found then
    raise exception 'auth_not_configured' using errcode = '28000';
  end if;

  if sub is null or length(sub) < 3 then
    raise exception 'invalid_token: missing subject' using errcode = '28000';
  end if;

  if claims ->> 'iss' is distinct from settings.issuer then
    raise exception 'invalid_token: issuer' using errcode = '28000';
  end if;

  aud := claims -> 'aud';
  if aud is null
     or (jsonb_typeof(aud) = 'string' and aud #>> '{}' <> settings.audience)
     or (jsonb_typeof(aud) = 'array' and not aud ? settings.audience)
     or jsonb_typeof(aud) not in ('string', 'array') then
    raise exception 'invalid_token: audience' using errcode = '28000';
  end if;

  if (claims ->> 'exp') is null
     or (claims ->> 'exp')::numeric <= extract(epoch from now()) then
    raise exception 'invalid_token: expired' using errcode = '28000';
  end if;

  return sub;
end;
$$;
revoke all on function app_private.verified_sub() from public;
grant usage on schema app_private to authenticated;
grant execute on function app_private.verified_sub() to authenticated;

-- Application users: exactly one per Auth0 subject.
create table public.users (
  id             uuid primary key default gen_random_uuid(),
  auth0_sub      text not null unique check (length(auth0_sub) between 3 and 255),
  email          text check (email is null or length(email) <= 320),
  email_verified boolean not null default false,
  display_name   text check (display_name is null or length(display_name) <= 120),
  status         text not null default 'active'
                 check (status in ('active', 'suspended', 'deactivated')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_seen_at   timestamptz,
  version        integer not null default 1
);
comment on table public.users is 'F-76: one application user per Auth0 subject (auth0_sub).';

create function app_private.touch_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger users_touch before update on public.users
  for each row execute function app_private.touch_user();

alter table public.users enable row level security;
alter table public.users force row level security;
revoke all on public.users from public, anon, authenticated;
grant select on public.users to authenticated;

-- A signed-in person can read only their own row; nobody writes directly.
create policy users_select_self on public.users
  for select to authenticated
  using (auth0_sub = app_private.verified_sub());

-- Session gate: validates the token, links the Auth0 subject to one user (creating it
-- on first sign-in) and refuses access unless the account is active.
create function public.ensure_user()
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

  return v_user;
end;
$$;
revoke all on function public.ensure_user() from public, anon;
grant execute on function public.ensure_user() to authenticated;
