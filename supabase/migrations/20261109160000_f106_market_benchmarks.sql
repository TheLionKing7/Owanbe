-- F-106 Market benchmark data
--
-- A benchmark is a price a vendor actually asked for. The only price statement the platform can
-- prove is a quote a vendor sent to a host, so that is the source: the quote revision carries the
-- amount, the quote carries the moment it was sent, and the vendor profile carries the category
-- and the places the vendor serves.
--
-- Invariants this file owns:
--   * an observation exists only because a quote was sent; no function writes a price, so there is
--     no path that can invent one
--   * only a verified observation feeds a market range; an unverified one stays in the table for
--     audit and is never published
--   * a range names no vendor: it is published only when two or more vendors hold a current
--     price, so one vendor's private quote cannot be read back out of an average
--   * provenance and freshness are logged: an observation is audited when it is recorded, and the
--     observation it replaces is audited as superseded
--   * reads are restricted to the planner's Host houses and to platform staff holding the new
--     'analytics' capability; nobody selects the table directly
--
-- The blueprint lists 'benchmarks' with vendor_house_id, verification_status, category, location,
-- price, source and observed_at (blueprint/architecture.md:245). This table keeps those fields and
-- adds the money rules the rest of the database uses: an integer minor amount and an explicit
-- ISO currency.

-- ---------------------------------------------------------------------------
-- The analytics capability
-- ---------------------------------------------------------------------------
-- 'analytics' is new in F-106: it is what lets platform staff read benchmark provenance. The six
-- capabilities that already existed keep their meaning, and their scope rules are untouched.
alter table public.staff_grants
  drop constraint staff_grants_capability_check;
alter table public.staff_grants
  add constraint staff_grants_capability_check check (capability in
    ('support', 'finance', 'operations', 'arbitrator', 'event_manager',
     'verification_reviewer', 'analytics'));

-- ---------------------------------------------------------------------------
-- One observed market price
-- ---------------------------------------------------------------------------
create table public.market_benchmarks (
  id                  uuid primary key default gen_random_uuid(),
  vendor_house_id     uuid not null,
  vendor_house_kind   text not null default 'vendor' check (vendor_house_kind = 'vendor'),
  category            text not null check (length(category) between 2 and 40),
  location            text not null check (length(location) between 1 and 120),
  location_key        text not null check (length(location_key) between 1 and 120),
  price_minor         bigint not null check (price_minor > 0),
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  source              text not null check (source in ('vendor_quote')),
  source_ref          uuid not null references public.quotes (id) on delete cascade,
  source_revision     integer not null check (source_revision >= 1),
  observed_at         timestamptz not null,
  verification_status text not null check (verification_status in ('verified', 'unverified')),
  recorded_by         uuid references public.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1,
  foreign key (vendor_house_id, vendor_house_kind) references public.houses (id, kind) on delete cascade,
  -- the same revision of the same quote states one price for one category in one place
  unique (source_ref, source_revision, category, location_key)
);
comment on table public.market_benchmarks is
  'F-106: one observed market price, taken from a quote a vendor sent. Never a price we made up.';
create index market_benchmarks_lookup_idx
  on public.market_benchmarks (category, location_key, currency, observed_at desc);
create index market_benchmarks_vendor_idx
  on public.market_benchmarks (vendor_house_id, category, location_key, observed_at desc);
create trigger market_benchmarks_touch before update on public.market_benchmarks
  for each row execute function app_private.touch();
create trigger market_benchmarks_append_only
  before update or delete or truncate on public.market_benchmarks
  for each statement execute function app_private.forbid_change();

-- ---------------------------------------------------------------------------
-- Row-level security: nobody selects the table
-- ---------------------------------------------------------------------------
-- Every read goes through a function that checks the caller first. The observations themselves are
-- never exposed as rows, so a host can never read a vendor's quote back out of the table.
alter table public.market_benchmarks enable row level security;
alter table public.market_benchmarks force row level security;

revoke all on public.market_benchmarks from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The places a vendor serves
-- ---------------------------------------------------------------------------
-- The profile holds them on one line ("Lagos, Ibadan"). Each one is a place a benchmark belongs
-- to, and the key is what a host's city is matched against.
create function app_private.benchmark_locations(p_locations text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(btrim(part) order by ord)
       from unnest(string_to_array(coalesce(p_locations, ''), ',')) with ordinality as t(part, ord)
      where btrim(part) <> ''
        and length(btrim(part)) <= 120),
    '{}'::text[])
$$;
revoke all on function app_private.benchmark_locations(text) from public;

-- ---------------------------------------------------------------------------
-- Catching the price when a quote is sent
-- ---------------------------------------------------------------------------
-- A trigger, so no path can put a price on the market without a quote behind it. The actor is the
-- vendor member who wrote the revision: the trigger cannot see the session, and the revision
-- already says who said the price.
create function app_private.capture_market_benchmark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.quote_revisions;
  v_profile  public.vendor_profiles;
  v_location text;
  v_key      text;
  v_status   text;
  v_id       uuid;
  v_previous uuid;
begin
  if new.status <> 'sent' or new.sent_at is distinct from old.sent_at then
    return null;
  end if;

  -- The price is the vendor's own offer: the newest revision the vendor wrote. A host counter is
  -- the host's words, so it is never taken as a vendor price.
  select r.* into v_revision
    from public.quote_revisions r
   where r.quote_id = new.id and r.authored_by_role = 'vendor'
   order by r.number desc
   limit 1;
  if not found or v_revision.total_minor is null or v_revision.total_minor <= 0 then
    return null;
  end if;

  select p.* into v_profile from public.vendor_profiles p where p.house_id = new.vendor_house_id;
  if not found then
    return null;
  end if;
  if v_profile.category is null or length(btrim(v_profile.category)) < 2 then
    return null;
  end if;

  -- A vendor the platform does not publish cannot be a source the market is told about. The
  -- observation is still recorded, unverified, so the audit trail can still show it.
  v_status := case when v_profile.published then 'verified' else 'unverified' end;

  foreach v_location in array app_private.benchmark_locations(v_profile.locations) loop
    v_key := lower(btrim(v_location));
    if v_key = '' then
      continue;
    end if;

    v_id := null;
    insert into public.market_benchmarks (
      vendor_house_id, category, location, location_key, price_minor, currency,
      source, source_ref, source_revision, observed_at, verification_status, recorded_by
    ) values (
      new.vendor_house_id, btrim(v_profile.category), v_location, v_key,
      v_revision.total_minor, v_revision.currency, 'vendor_quote', new.id, v_revision.number,
      new.sent_at, v_status, v_revision.author_user_id
    )
    on conflict (source_ref, source_revision, category, location_key) do nothing
    returning id into v_id;

    if v_id is null then
      -- The same price statement, sent again: nothing new to observe.
      continue;
    end if;

    perform app_private.audit(v_revision.author_user_id, 'benchmark.observed', 'market_benchmarks',
                              v_id, new.vendor_house_id,
                              jsonb_build_object('category', btrim(v_profile.category),
                                                 'location', v_location,
                                                 'price_minor', v_revision.total_minor,
                                                 'currency', v_revision.currency,
                                                 'source', 'vendor_quote',
                                                 'source_ref', new.id,
                                                 'source_revision', v_revision.number,
                                                 'observed_at', new.sent_at,
                                                 'verification_status', v_status));

    -- Freshness: the vendor has now stated a price for this category in this place, so the price
    -- it stated before is no longer the current one. The audit trail says which one it replaced.
    select b.id into v_previous
      from public.market_benchmarks b
     where b.vendor_house_id = new.vendor_house_id
       and b.category = btrim(v_profile.category)
       and b.location_key = v_key
       and b.currency = v_revision.currency
       and b.observed_at < new.sent_at
     order by b.observed_at desc
     limit 1;

    if v_previous is not null then
      perform app_private.audit(v_revision.author_user_id, 'benchmark.superseded',
                                'market_benchmarks', v_previous, new.vendor_house_id,
                                jsonb_build_object('superseded_by', v_id,
                                                   'observed_at', new.sent_at,
                                                   'category', btrim(v_profile.category),
                                                   'location', v_location));
    end if;
  end loop;

  return null;
end;
$$;
revoke all on function app_private.capture_market_benchmark() from public;

create trigger quotes_benchmark_observation
  after update on public.quotes
  for each row
  when (new.status = 'sent' and new.sent_at is distinct from old.sent_at)
  execute function app_private.capture_market_benchmark();

-- ---------------------------------------------------------------------------
-- The current price of a vendor
-- ---------------------------------------------------------------------------
-- A vendor's current price for a category in a place is the newest observation it holds, and only
-- while the quote behind it has not been withdrawn. A quote the vendor withdrew is not a market
-- price.
create function app_private.current_market_benchmarks(p_categories text[], p_location_key text)
returns setof public.market_benchmarks
language sql
stable
security definer
set search_path = ''
as $$
  select b.*
    from public.market_benchmarks b
    join public.quotes q on q.id = b.source_ref
   where b.verification_status = 'verified'
     and b.location_key = p_location_key
     and (p_categories is null or b.category = any(p_categories))
     and q.status <> 'cancelled'
     and not exists (
       select 1
         from public.market_benchmarks newer
        where newer.vendor_house_id = b.vendor_house_id
          and newer.category = b.category
          and newer.location_key = b.location_key
          and newer.currency = b.currency
          and newer.observed_at > b.observed_at
     )
$$;
revoke all on function app_private.current_market_benchmarks(text[], text) from public;

-- ---------------------------------------------------------------------------
-- The market range a host reads
-- ---------------------------------------------------------------------------
-- The planner's Host houses read this, and so does platform staff holding the 'analytics'
-- capability. Nobody else, and nobody reads the table itself.
--
-- The range is published only when two or more vendors hold a current price. With one vendor the
-- range would be that vendor's own quote handed to the market, so the prices stay null and only
-- the count is given.
create function public.read_market_benchmarks(p_categories text[], p_location text)
returns table (
  category           text,
  location           text,
  currency           text,
  observation_count  integer,
  vendor_count       integer,
  min_price_minor    bigint,
  median_price_minor bigint,
  max_price_minor    bigint,
  oldest_observed_at timestamptz,
  newest_observed_at timestamptz,
  source             text,
  published          boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app_private.current_user_id();
  v_key    text := lower(btrim(coalesce(p_location, '')));
  v_anchor uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  if app_private.planner_host_house(v_actor) is null
     and app_private.staff_grant_for('analytics') is null then
    raise exception 'forbidden: market benchmarks' using errcode = '42501';
  end if;

  if v_key = '' or p_categories is null or cardinality(p_categories) = 0 then
    return;
  end if;

  select b.id into v_anchor
    from app_private.current_market_benchmarks(p_categories, v_key) b
   order by b.observed_at desc, b.id desc
   limit 1;

  return query
    select b.category,
           min(b.location),
           b.currency,
           count(*)::integer,
           count(distinct b.vendor_house_id)::integer,
           case when count(distinct b.vendor_house_id) >= 2 then min(b.price_minor) end,
           case when count(distinct b.vendor_house_id) >= 2
                then (percentile_cont(0.5) within group (order by b.price_minor))::bigint end,
           case when count(distinct b.vendor_house_id) >= 2 then max(b.price_minor) end,
           min(b.observed_at),
           max(b.observed_at),
           'vendor_quote',
           count(distinct b.vendor_house_id) >= 2
      from app_private.current_market_benchmarks(p_categories, v_key) b
     group by b.category, b.currency
     order by b.category, b.currency;

  -- What was published, and how fresh it was, is on the audit trail.
  if v_anchor is not null then
    perform app_private.audit(v_actor, 'benchmark.range_read', 'market_benchmarks', v_anchor, null,
                              jsonb_build_object('location', v_key,
                                                 'categories', to_jsonb(p_categories),
                                                 'source', 'vendor_quote'));
  end if;
end;
$$;
revoke all on function public.read_market_benchmarks(text[], text) from public, anon;
grant execute on function public.read_market_benchmarks(text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- The provenance platform staff read
-- ---------------------------------------------------------------------------
-- The vendor behind each observation, the quote it came from and the moment it was seen. This is
-- the analytics consumer's view; the host never sees a vendor named here.
create function public.read_market_benchmark_sources(p_category text, p_location text)
returns table (
  benchmark_id        uuid,
  vendor_house_id     uuid,
  business_name       text,
  category            text,
  location            text,
  price_minor         bigint,
  currency            text,
  source              text,
  source_ref          uuid,
  source_revision     integer,
  observed_at         timestamptz,
  verification_status text,
  current             boolean,
  recorded_at         timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := app_private.current_user_id();
  v_grant  uuid;
  v_key    text := lower(btrim(coalesce(p_location, '')));
  v_anchor uuid;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  v_grant := app_private.staff_grant_for('analytics');
  if v_grant is null then
    raise exception 'forbidden: analytics grant required' using errcode = '42501';
  end if;

  if v_key = '' or p_category is null or length(btrim(p_category)) = 0 then
    return;
  end if;

  select b.id into v_anchor
    from public.market_benchmarks b
   where b.category = btrim(p_category) and b.location_key = v_key
   order by b.observed_at desc
   limit 1;

  return query
    select b.id,
           b.vendor_house_id,
           p.business_name,
           b.category,
           b.location,
           b.price_minor,
           b.currency,
           b.source,
           b.source_ref,
           b.source_revision,
           b.observed_at,
           b.verification_status,
           not exists (
             select 1
               from public.market_benchmarks newer
              where newer.vendor_house_id = b.vendor_house_id
                and newer.category = b.category
                and newer.location_key = b.location_key
                and newer.currency = b.currency
                and newer.observed_at > b.observed_at
           ),
           b.created_at
      from public.market_benchmarks b
      left join public.vendor_profiles p on p.house_id = b.vendor_house_id
     where b.category = btrim(p_category)
       and b.location_key = v_key
     order by b.observed_at desc, b.id desc
     limit 200;

  if v_anchor is not null then
    perform app_private.audit(v_actor, 'benchmark.sources_read', 'market_benchmarks', v_anchor, null,
                              jsonb_build_object('location', v_key,
                                                 'category', btrim(p_category),
                                                 'staff_grant_id', v_grant));
  end if;
end;
$$;
revoke all on function public.read_market_benchmark_sources(text, text) from public, anon;
grant execute on function public.read_market_benchmark_sources(text, text) to authenticated;

notify pgrst, 'reload schema';
