-- Vendor house opening + vendor profiles (Profile & Showcase).
-- Run once in the Supabase SQL Editor (external project). Idempotent guards are not used:
-- running twice fails on "already exists", which is harmless.
-- The profile belongs to the vendor house, never to a person. Writes go only through
-- security-definer functions that check membership + the 'profile' capability. Public
-- readers get a safe projection of published profiles only (no brief, no house internals).

create table public.vendor_profiles (
  house_id      uuid primary key,
  house_kind    text not null default 'vendor' check (house_kind = 'vendor'),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  business_name text not null check (length(business_name) between 2 and 80),
  category      text not null check (length(category) between 2 and 40),
  locations     text not null default '' check (length(locations) <= 120),
  price_note    text not null default '' check (length(price_note) <= 160),
  brief         jsonb not null default '{}'::jsonb check (pg_column_size(brief) <= 16000),
  headline      text not null default '' check (length(headline) <= 100),
  tagline       text not null default '' check (length(tagline) <= 160),
  about         text not null default '' check (length(about) <= 2000),
  services      jsonb not null default '[]'::jsonb check (jsonb_typeof(services) = 'array' and jsonb_array_length(services) <= 12),
  highlights    jsonb not null default '[]'::jsonb check (jsonb_typeof(highlights) = 'array' and jsonb_array_length(highlights) <= 6),
  published     boolean not null default false,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade,
  constraint publish_needs_copy check (not published or (length(headline) > 0 and length(about) > 0))
);
create trigger vendor_profiles_touch before update on public.vendor_profiles
  for each row execute function app_private.touch();

revoke all on public.vendor_profiles from public, anon, authenticated;
grant select on public.vendor_profiles to authenticated;
grant all on public.vendor_profiles to service_role;
alter table public.vendor_profiles enable row level security;
alter table public.vendor_profiles force row level security;

-- Members of the vendor house can read their own profile (drafts included).
create policy vendor_profiles_members_read on public.vendor_profiles
  for select to authenticated using (app_private.is_active_member(house_id));

-- Opens the caller's Vendor house (idempotent). Only the account holder becomes its owner.
create function public.open_vendor_house(p_display_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app_private.current_user_id();
  v_name text := left(btrim(coalesce(p_display_name, '')), 80);
  v_house uuid;
begin
  if v_user is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if length(v_name) < 2 then raise exception 'invalid_name' using errcode = '22023'; end if;

  select id into v_house from public.houses where owner_user_id = v_user and kind = 'vendor';
  if v_house is not null then return v_house; end if;

  insert into public.houses (kind, owner_user_id, display_name)
  values ('vendor', v_user, v_name)
  on conflict (owner_user_id, kind) do nothing
  returning id into v_house;
  if v_house is null then
    select id into v_house from public.houses where owner_user_id = v_user and kind = 'vendor';
    return v_house;
  end if;
  insert into public.memberships (house_id, house_kind, user_id, role)
  values (v_house, 'vendor', v_user, 'owner');
  perform app_private.audit(v_user, 'house.created', 'houses', v_house, v_house, '{"kind":"vendor"}');
  return v_house;
end;
$$;
revoke all on function public.open_vendor_house(text) from public, anon;
grant execute on function public.open_vendor_house(text) to authenticated;

create function app_private.slugify(p text)
returns text language sql immutable set search_path = '' as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), 50)
$$;

-- Saves the profile for a vendor house the caller can edit ('profile' capability).
create function public.save_vendor_profile(p_house uuid, p_profile jsonb, p_publish boolean)
returns public.vendor_profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app_private.current_user_id();
  v_row public.vendor_profiles;
  v_base text;
  v_slug text;
  n int := 1;
begin
  if v_user is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if not exists (select 1 from public.houses where id = p_house and kind = 'vendor' and archived_at is null)
     or not app_private.member_can(p_house, 'profile') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.vendor_profiles where house_id = p_house;
  v_slug := v_row.slug;
  if v_slug is null then
    v_base := app_private.slugify(p_profile ->> 'business_name');
    if length(v_base) < 3 then v_base := 'vendor-' || left(replace(p_house::text, '-', ''), 8); end if;
    v_slug := v_base;
    while exists (select 1 from public.vendor_profiles where slug = v_slug) loop
      n := n + 1; v_slug := v_base || '-' || n;
    end loop;
  end if;

  insert into public.vendor_profiles as vp
    (house_id, slug, business_name, category, locations, price_note, brief,
     headline, tagline, about, services, highlights, published, published_at)
  values (
    p_house, v_slug,
    btrim(coalesce(p_profile ->> 'business_name', '')),
    coalesce(p_profile ->> 'category', ''),
    btrim(coalesce(p_profile ->> 'locations', '')),
    btrim(coalesce(p_profile ->> 'price_note', '')),
    coalesce(p_profile -> 'brief', '{}'::jsonb),
    btrim(coalesce(p_profile ->> 'headline', '')),
    btrim(coalesce(p_profile ->> 'tagline', '')),
    btrim(coalesce(p_profile ->> 'about', '')),
    coalesce(p_profile -> 'services', '[]'::jsonb),
    coalesce(p_profile -> 'highlights', '[]'::jsonb),
    coalesce(p_publish, false),
    case when coalesce(p_publish, false) then now() end
  )
  on conflict (house_id) do update set
    business_name = excluded.business_name, category = excluded.category,
    locations = excluded.locations, price_note = excluded.price_note, brief = excluded.brief,
    headline = excluded.headline, tagline = excluded.tagline, about = excluded.about,
    services = excluded.services, highlights = excluded.highlights,
    published = excluded.published,
    published_at = case when excluded.published then coalesce(vp.published_at, now()) end,
    version = vp.version + 1
  returning * into v_row;

  perform app_private.audit(v_user, case when v_row.published then 'vendor_profile.published' else 'vendor_profile.saved' end,
                            'vendor_profiles', p_house, p_house, '{}');
  return v_row;
end;
$$;
revoke all on function public.save_vendor_profile(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_vendor_profile(uuid, jsonb, boolean) to authenticated;

-- Public projection: published profiles only, safe columns only.
create function public.public_vendor_profiles(p_slug text default null)
returns table (slug text, business_name text, category text, locations text, price_note text,
               headline text, tagline text, about text, services jsonb, highlights jsonb, published_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select vp.slug, vp.business_name, vp.category, vp.locations, vp.price_note,
         vp.headline, vp.tagline, vp.about, vp.services, vp.highlights, vp.published_at
  from public.vendor_profiles vp
  join public.houses h on h.id = vp.house_id and h.archived_at is null
  where vp.published and (p_slug is null or vp.slug = p_slug)
  order by vp.published_at desc
  limit 100
$$;
revoke all on function public.public_vendor_profiles(text) from public;
grant execute on function public.public_vendor_profiles(text) to anon, authenticated;

notify pgrst, 'reload schema';
