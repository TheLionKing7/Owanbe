-- F-7 AI Intent Capture: sign-up onboarding.
-- Owner decisions (2026-11-07): roles at sign-up are Host and Vendor; name, phone and city are
-- required before the dashboard; a host states their intent with a simple choice (hosting /
-- arranging for someone) and OwanbePlanner picks it up afterwards. The phone is stored
-- unverified until WhatsApp/SMS delivery (F-51) exists.
-- Clients never touch the table: they read and write only through the functions below, which
-- act on the caller's own row.

create table public.onboarding_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references public.users (id) on delete cascade,
  role              text not null check (role in ('host', 'vendor')),
  phone_e164        text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified    boolean not null default false,
  city              text check (city is null or length(city) between 2 and 80),
  host_intent       text check (host_intent is null or host_intent in ('hosting', 'arranging')),
  event_type        text check (event_type is null or length(event_type) between 2 and 60),
  event_date        date,
  business_category text check (business_category is null or length(business_category) between 2 and 60),
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1
);
comment on table public.onboarding_profiles is
  'F-7: what a new account told us before reaching its house (role, contact, first intent). One row per user.';
create trigger onboarding_profiles_touch before update on public.onboarding_profiles
  for each row execute function app_private.touch();

alter table public.onboarding_profiles enable row level security;
alter table public.onboarding_profiles force row level security;
revoke all on public.onboarding_profiles from public, anon, authenticated;

-- The caller's onboarding state. No row means onboarding hasn't started.
create function public.my_onboarding()
returns table (
  role text,
  display_name text,
  phone_e164 text,
  phone_verified boolean,
  city text,
  host_intent text,
  event_type text,
  event_date date,
  business_category text,
  has_vendor_house boolean,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.role, u.display_name, o.phone_e164, o.phone_verified, o.city, o.host_intent,
         o.event_type, o.event_date, o.business_category,
         exists (select 1 from public.houses h
                 where h.owner_user_id = u.id and h.kind = 'vendor' and h.archived_at is null),
         o.completed_at
  from public.users u
  join public.onboarding_profiles o on o.user_id = u.id
  where u.id = app_private.current_user_id()
$$;
revoke all on function public.my_onboarding() from public, anon;
grant execute on function public.my_onboarding() to authenticated;

-- Saves one step. Null leaves a field as it is; the role can change only until onboarding is done.
create function public.save_onboarding(
  p_role text,
  p_display_name text default null,
  p_phone text default null,
  p_city text default null,
  p_host_intent text default null,
  p_event_type text default null,
  p_event_date date default null,
  p_business_category text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app_private.current_user_id();
  v_row  public.onboarding_profiles;
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
begin
  if v_user is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  if p_role is null or p_role not in ('host', 'vendor') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_name is not null and length(v_name) not between 2 and 120 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_event_date is not null and p_event_date < current_date then
    raise exception 'event_date_in_past' using errcode = '22023';
  end if;

  select * into v_row from public.onboarding_profiles where user_id = v_user for update;
  if found and v_row.completed_at is not null and v_row.role <> p_role then
    raise exception 'role_locked' using errcode = '22023';
  end if;

  insert into public.onboarding_profiles as o
    (user_id, role, phone_e164, city, host_intent, event_type, event_date, business_category)
  values (v_user, p_role, nullif(btrim(p_phone), ''), nullif(btrim(p_city), ''), p_host_intent,
          nullif(btrim(p_event_type), ''), p_event_date, nullif(btrim(p_business_category), ''))
  on conflict (user_id) do update set
    role              = excluded.role,
    -- A changed number is a new, unverified number.
    phone_verified    = case when excluded.phone_e164 is not null
                              and excluded.phone_e164 is distinct from o.phone_e164
                             then false else o.phone_verified end,
    phone_e164        = coalesce(excluded.phone_e164, o.phone_e164),
    city              = coalesce(excluded.city, o.city),
    host_intent       = coalesce(excluded.host_intent, o.host_intent),
    event_type        = coalesce(excluded.event_type, o.event_type),
    event_date        = coalesce(excluded.event_date, o.event_date),
    business_category = coalesce(excluded.business_category, o.business_category);

  if v_name is not null then
    update public.users set display_name = v_name where id = v_user and display_name is distinct from v_name;
  end if;
end;
$$;
revoke all on function public.save_onboarding(text, text, text, text, text, text, date, text) from public, anon;
grant execute on function public.save_onboarding(text, text, text, text, text, text, date, text) to authenticated;

-- Marks onboarding done once the required details are there. Idempotent; returns when it finished.
create function public.complete_onboarding()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := app_private.current_user_id();
  v_name text;
  v_row  public.onboarding_profiles;
begin
  if v_user is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  select * into v_row from public.onboarding_profiles where user_id = v_user for update;
  if not found then raise exception 'onboarding_not_started' using errcode = '22023'; end if;
  if v_row.completed_at is not null then return v_row.completed_at; end if;

  select display_name into v_name from public.users where id = v_user;
  if coalesce(length(btrim(v_name)), 0) < 2 or v_row.phone_e164 is null or v_row.city is null then
    raise exception 'onboarding_incomplete:contact' using errcode = '22023';
  end if;
  if v_row.role = 'host' and v_row.host_intent is null then
    raise exception 'onboarding_incomplete:intent' using errcode = '22023';
  end if;
  if v_row.role = 'vendor' and (v_row.business_category is null or not exists (
       select 1 from public.houses h
       where h.owner_user_id = v_user and h.kind = 'vendor' and h.archived_at is null)) then
    raise exception 'onboarding_incomplete:business' using errcode = '22023';
  end if;

  update public.onboarding_profiles set completed_at = now()
  where id = v_row.id
  returning completed_at into v_row.completed_at;
  -- Identifiers only: the phone number and city stay out of the audit log.
  perform app_private.audit(v_user, 'onboarding.completed', 'onboarding_profiles', v_row.id, null,
                            jsonb_build_object('role', v_row.role));
  return v_row.completed_at;
end;
$$;
revoke all on function public.complete_onboarding() from public, anon;
grant execute on function public.complete_onboarding() to authenticated;
