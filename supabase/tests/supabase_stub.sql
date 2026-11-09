-- Minimal stand-in for the parts of Supabase the migrations rely on (local tests only).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  -- the server-side identity (webhooks, jobs): migrations grant it execute on server-only functions
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's file storage, reduced to the parts the chat attachment bucket needs.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata   jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;
