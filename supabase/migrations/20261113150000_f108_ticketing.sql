-- F-108 Ticketing system
--
-- The F-108 spec: "Needed before the features that name 'Ticketing system' can be built." Its
-- acceptance criteria: "Claim binds invitation/phone without requiring full account", "Atomic
-- claims allow one person or two for couple links", "QR/NFC admission supports offline scanner
-- cache", "Only host can invalidate or reissue invitation tokens".
--
-- What this file owns:
--   * public.invitations — one invitation link for a guest list. The link's token is stored only as
--     a SHA-256 hash; the raw token exists once, in the host's hands, when it is issued or reissued.
--   * public.invite_claims — who claimed it. The unique (invitation_id, slot) is the atomicity: a
--     standard link has one slot, a couple's link two, and two claims can never take the same slot.
--   * public.admissions — the entry card. The card is a credential derived from the guest's
--     session, and only its hash is stored.
--   * public.scanner_grants — a host-issued, revocable, time-boxed grant for one device (and the
--     person holding it) to admit guests for one guest list.
--   * public.checkins — the admissions themselves, including the ones queued on a device while it
--     was offline. A second admission of the same guest is recorded as a duplicate, never
--     silently overwritten.
--
-- Invariants this file owns:
--   * A claim needs no account. The guest gives a name and a phone; the phone is stored only as a
--     hash, so the platform holds no readable number for a guest who never signed up.
--   * The claim is atomic. The invitation row is locked for the duration of the claim, the
--     capacity is counted under that lock, and the slot is unique, so two people racing for the
--     last slot cannot both win.
--   * Reissuing replaces the token (the old link stops working), bumps the generation, and revokes
--     every claim and every card made under it.
--   * Only the host of the guest list may issue, reissue or revoke an invitation, and only the
--     host may hand a device a scanner grant.
--   * A scanner sees the admission minimum: a card's name, its state and its expiry. No phone
--     number, no address, no other guest's details.
--   * An offline check-in is queued on the device and written when the device reconnects. The
--     server cannot stop a second device admitting the same guest, so that admission is recorded
--     as a duplicate for the host to see.
--
-- Depends on 20261108120000_f40_guest_list_privacy.sql (the guest list and its host guard) and
-- 20261101020000_f77_data_model.sql (users, houses, audit_events).
--
-- Re-applying this file is safe: the tables and the indexes are created only when they are
-- missing, the functions are replaced rather than re-created, and each trigger is dropped before
-- it is created again. A run that stopped halfway can therefore be re-run without a reset.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- sha256() and gen_random_uuid() are core PostgreSQL, so this file needs no extension. The token
-- is 244 bits of entropy; only its hash is ever stored.
create or replace function app_private.f108_hash(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_value, 'UTF8')), 'hex');
$$;
revoke all on function app_private.f108_hash(text) from public;

create or replace function app_private.f108_random_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;
revoke all on function app_private.f108_random_token() from public;

-- The card a guest carries is derived from the guest's own session, so the platform can answer
-- "show me my card" without ever storing the card itself.
create or replace function app_private.f108_admission_credential(p_session text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to('owanbe-admission:' || p_session, 'UTF8')), 'hex');
$$;
revoke all on function app_private.f108_admission_credential(text) from public;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id                    uuid primary key default gen_random_uuid(),
  guest_list_id         uuid not null references public.guest_lists (id) on delete cascade,
  house_id              uuid not null,
  house_kind            text not null default 'host' check (house_kind = 'host'),
  token_hash            text not null unique check (length(token_hash) = 64),
  claim_limit           smallint not null default 1 check (claim_limit in (1, 2)),
  generation            integer not null default 1 check (generation > 0),
  status                text not null default 'issued' check (status in ('issued', 'claimed', 'revoked')),
  claim_deadline        timestamptz not null,
  admission_expires_at  timestamptz not null,
  created_by            uuid not null references public.users (id),
  revoked_at            timestamptz,
  revoked_by            uuid references public.users (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  version               integer not null default 1,
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade,
  constraint invitations_revocation_pair check ((revoked_at is null) = (revoked_by is null)),
  constraint invitations_deadlines check (admission_expires_at >= claim_deadline)
);
comment on table public.invitations is
  'F-108: one invitation link for a guest list. The token is stored only as a hash; a claim_limit of '
  '1 is a standard link and 2 is a couple''s link.';
create index if not exists invitations_list_idx on public.invitations (guest_list_id, created_at desc);
drop trigger if exists invitations_touch on public.invitations;
create trigger invitations_touch before update on public.invitations
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Claims: who claimed an invitation
-- ---------------------------------------------------------------------------
create table if not exists public.invite_claims (
  id              uuid primary key default gen_random_uuid(),
  invitation_id   uuid not null references public.invitations (id) on delete cascade,
  guest_list_id   uuid not null references public.guest_lists (id) on delete cascade,
  slot            smallint not null check (slot >= 1),
  display_name    text not null check (length(display_name) between 1 and 120),
  phone_reference text not null check (length(phone_reference) = 64),
  session_hash    text not null check (length(session_hash) = 64),
  device_id       text check (device_id is null or length(device_id) <= 120),
  status          text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at      timestamptz,
  claimed_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  constraint invite_claims_revocation_pair check ((revoked_at is null) = (status = 'active'))
);
comment on table public.invite_claims is
  'F-108: one claimed slot. The phone is stored only as a hash, and the guest session only as a '
  'hash, so a claim holds no readable contact and no usable secret.';
create index if not exists invite_claims_invitation_idx on public.invite_claims (invitation_id, slot);
create index if not exists invite_claims_list_idx on public.invite_claims (guest_list_id, claimed_at desc);
-- One slot per claim, and one claim per phone per live invitation: this is what makes the claim
-- atomic. A revoked claim (after a reissue) frees both.
create unique index if not exists invite_claims_one_slot on public.invite_claims (invitation_id, slot);
create unique index if not exists invite_claims_one_phone on public.invite_claims (invitation_id, phone_reference)
  where status = 'active';
drop trigger if exists invite_claims_touch on public.invite_claims;
create trigger invite_claims_touch before update on public.invite_claims
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Admissions: the entry card a guest carries
-- ---------------------------------------------------------------------------
create table if not exists public.admissions (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid not null unique references public.invite_claims (id) on delete cascade,
  guest_list_id   uuid not null references public.guest_lists (id) on delete cascade,
  credential_hash text not null unique check (length(credential_hash) = 64),
  status          text not null default 'issued' check (status in ('issued', 'admitted', 'revoked')),
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  admitted_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1
);
comment on table public.admissions is
  'F-108: the entry card. The credential is stored only as a hash; the scanner matches a scanned '
  'card against the hash it cached.';
create index if not exists admissions_list_idx on public.admissions (guest_list_id, expires_at);
drop trigger if exists admissions_touch on public.admissions;
create trigger admissions_touch before update on public.admissions
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Scanner grants: who may admit, on which device, until when
-- ---------------------------------------------------------------------------
create table if not exists public.scanner_grants (
  id              uuid primary key default gen_random_uuid(),
  guest_list_id   uuid not null references public.guest_lists (id) on delete cascade,
  house_id        uuid not null,
  house_kind      text not null default 'host' check (house_kind = 'host'),
  grantee_user_id uuid not null references public.users (id),
  device_id       text not null check (length(device_id) between 1 and 120),
  granted_by      uuid not null references public.users (id),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_by      uuid references public.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  foreign key (house_id, house_kind) references public.houses (id, kind) on delete cascade,
  constraint scanner_grants_revocation_pair check ((revoked_at is null) = (revoked_by is null))
);
comment on table public.scanner_grants is
  'F-108: a host-issued grant for one device and one person to admit guests for one guest list. '
  'Revoking it ends the device''s access at once.';
create index if not exists scanner_grants_list_idx on public.scanner_grants (guest_list_id, created_at desc);
create unique index if not exists scanner_grants_one_live_device on public.scanner_grants (guest_list_id, device_id)
  where revoked_at is null;
drop trigger if exists scanner_grants_touch on public.scanner_grants;
create trigger scanner_grants_touch before update on public.scanner_grants
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Check-ins: who came in, and where the record came from
-- ---------------------------------------------------------------------------
create table if not exists public.checkins (
  id               uuid primary key default gen_random_uuid(),
  admission_id     uuid references public.admissions (id) on delete set null,
  scanner_grant_id uuid not null references public.scanner_grants (id) on delete cascade,
  guest_list_id    uuid not null references public.guest_lists (id) on delete cascade,
  device_id        text not null check (length(device_id) between 1 and 120),
  occurred_at      timestamptz not null,
  mode             text not null check (mode in ('online', 'queued_offline')),
  result           text not null check (result in ('admitted', 'duplicate', 'expired', 'unknown')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1
);
comment on table public.checkins is
  'F-108: one admission attempt. A second device admitting the same guest is kept as a duplicate, '
  'because an offline scanner cannot prevent it and the host has to see it.';
create index if not exists checkins_list_idx on public.checkins (guest_list_id, occurred_at desc);
drop trigger if exists checkins_touch on public.checkins;
create trigger checkins_touch before update on public.checkins
  for each row execute function app_private.touch();

-- ---------------------------------------------------------------------------
-- Row-level security: default deny. Every read and every write goes through a function.
-- ---------------------------------------------------------------------------
alter table public.invitations enable row level security;
alter table public.invitations force row level security;
alter table public.invite_claims enable row level security;
alter table public.invite_claims force row level security;
alter table public.admissions enable row level security;
alter table public.admissions force row level security;
alter table public.scanner_grants enable row level security;
alter table public.scanner_grants force row level security;
alter table public.checkins enable row level security;
alter table public.checkins force row level security;

revoke all on public.invitations, public.invite_claims, public.admissions,
                public.scanner_grants, public.checkins
  from public, anon, authenticated;
grant all on public.invitations, public.invite_claims, public.admissions,
                public.scanner_grants, public.checkins
  to service_role;

-- ---------------------------------------------------------------------------
-- Host: issue an invitation
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(
  p_list uuid, p_claim_limit integer, p_claim_deadline timestamptz, p_admission_expires_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_list_host(p_list);
  v_token text;
  v_id    uuid;
begin
  if p_claim_limit is null or p_claim_limit not in (1, 2) then
    raise exception 'invalid_claim_limit' using errcode = '22023';
  end if;
  if p_claim_deadline is null or p_claim_deadline <= now() then
    raise exception 'invalid_claim_deadline' using errcode = '22023';
  end if;
  if p_admission_expires_at is null or p_admission_expires_at <= now() then
    raise exception 'invalid_admission_expiry' using errcode = '22023';
  end if;
  if p_admission_expires_at < p_claim_deadline then
    raise exception 'invalid_admission_expiry' using errcode = '22023';
  end if;

  v_token := app_private.f108_random_token();

  insert into public.invitations (
    guest_list_id, house_id, token_hash, claim_limit, generation, status,
    claim_deadline, admission_expires_at, created_by)
  select l.id, l.house_id, app_private.f108_hash(v_token), p_claim_limit, 1, 'issued',
         p_claim_deadline, p_admission_expires_at, v_actor
  from public.guest_lists l
  where l.id = p_list
  returning id into v_id;

  perform app_private.audit(v_actor, 'invitation.created', 'invitations', v_id,
    (select house_id from public.guest_lists where id = p_list),
    jsonb_build_object('claim_limit', p_claim_limit, 'generation', 1));

  return jsonb_build_object(
    'invitation_id', v_id,
    'token', v_token,
    'claim_limit', p_claim_limit,
    'generation', 1,
    'claim_deadline', p_claim_deadline,
    'admission_expires_at', p_admission_expires_at,
    'version', 1
  );
end;
$$;
revoke all on function public.create_invitation(uuid, integer, timestamptz, timestamptz) from public, anon;
grant execute on function public.create_invitation(uuid, integer, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Host: reissue an invitation
--
-- The old link stops working (the token hash is replaced), the generation moves on, and every
-- claim and every card made under the old token is revoked. The deadlines stay as they were: a
-- host who needs new dates issues a new invitation.
-- ---------------------------------------------------------------------------
create or replace function public.reissue_invitation(p_invitation uuid, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv   public.invitations;
  v_actor uuid;
  v_token text;
  v_generation integer;
begin
  select * into v_inv from public.invitations where id = p_invitation;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  v_actor := app_private.require_list_host(v_inv.guest_list_id);
  if v_inv.version <> p_expected_version then
    raise exception 'stale_version: expected %, found %', p_expected_version, v_inv.version
      using errcode = '40001';
  end if;
  if v_inv.status = 'revoked' then
    raise exception 'invitation_revoked' using errcode = 'P0002';
  end if;

  v_token := app_private.f108_random_token();
  v_generation := v_inv.generation + 1;

  update public.invitations
     set token_hash = app_private.f108_hash(v_token),
         generation = v_generation,
         status = 'issued'
   where id = v_inv.id;

  update public.admissions a
     set status = 'revoked'
   where a.claim_id in (select c.id from public.invite_claims c
                          where c.invitation_id = v_inv.id and c.status = 'active');

  update public.invite_claims
     set status = 'revoked', revoked_at = now()
   where invitation_id = v_inv.id and status = 'active';

  perform app_private.audit(v_actor, 'invitation.reissued', 'invitations', v_inv.id, v_inv.house_id,
    jsonb_build_object('generation', v_generation));

  return jsonb_build_object(
    'invitation_id', v_inv.id,
    'token', v_token,
    'claim_limit', v_inv.claim_limit,
    'generation', v_generation,
    'claim_deadline', v_inv.claim_deadline,
    'admission_expires_at', v_inv.admission_expires_at,
    'version', v_inv.version + 1
  );
end;
$$;
revoke all on function public.reissue_invitation(uuid, integer) from public, anon;
grant execute on function public.reissue_invitation(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Host: revoke an invitation
-- ---------------------------------------------------------------------------
create or replace function public.revoke_invitation(p_invitation uuid, p_expected_version integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inv   public.invitations;
  v_actor uuid;
begin
  select * into v_inv from public.invitations where id = p_invitation;
  if not found then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  v_actor := app_private.require_list_host(v_inv.guest_list_id);
  if v_inv.version <> p_expected_version then
    raise exception 'stale_version: expected %, found %', p_expected_version, v_inv.version
      using errcode = '40001';
  end if;

  update public.invitations
     set status = 'revoked', revoked_at = now(), revoked_by = v_actor
   where id = v_inv.id;

  update public.admissions a
     set status = 'revoked'
   where a.claim_id in (select c.id from public.invite_claims c
                          where c.invitation_id = v_inv.id and c.status = 'active');

  update public.invite_claims
     set status = 'revoked', revoked_at = now()
   where invitation_id = v_inv.id and status = 'active';

  perform app_private.audit(v_actor, 'invitation.revoked', 'invitations', v_inv.id, v_inv.house_id,
    jsonb_build_object('generation', v_inv.generation));

  return v_inv.version + 1;
end;
$$;
revoke all on function public.revoke_invitation(uuid, integer) from public, anon;
grant execute on function public.revoke_invitation(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Host: read the invitations of a guest list
--
-- The raw token is not here and never can be: the host sees a fingerprint of the stored hash so
-- they can tell two links apart.
-- ---------------------------------------------------------------------------
create or replace function public.host_invitations(p_list uuid)
returns table (
  invitation_id uuid,
  claim_limit smallint,
  generation integer,
  status text,
  claim_deadline timestamptz,
  admission_expires_at timestamptz,
  claimed_count integer,
  token_fingerprint text,
  created_at timestamptz,
  updated_at timestamptz,
  version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_list_host(p_list);
  return query
    select i.id, i.claim_limit, i.generation, i.status, i.claim_deadline, i.admission_expires_at,
           (select count(*) from public.invite_claims c
             where c.invitation_id = i.id and c.status = 'active'),
           left(i.token_hash, 8), i.created_at, i.updated_at, i.version
      from public.invitations i
     where i.guest_list_id = p_list
     order by i.created_at desc;
end;
$$;
revoke all on function public.host_invitations(uuid) from public, anon;
grant execute on function public.host_invitations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The claim: a guest with an invitation and a phone, and no account
-- ---------------------------------------------------------------------------
create or replace function public.claim_invitation(
  p_token text, p_display_name text, p_phone text, p_device_id text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash       text;
  v_inv        public.invitations;
  v_used       integer;
  v_slot       smallint;
  v_session    text;
  v_credential text;
  v_claim_id   uuid;
  v_admission  uuid;
  v_title      text;
begin
  if p_token is null or length(trim(p_token)) < 32 then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if p_display_name is null or length(trim(p_display_name)) not between 1 and 120 then
    raise exception 'invalid_guest_name' using errcode = '22023';
  end if;
  if p_phone is null or length(trim(p_phone)) not between 7 and 32 then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;

  v_hash := app_private.f108_hash(trim(p_token));

  -- The row lock is what makes the claim atomic: a second claim for the same invitation waits
  -- here until the first one has committed, and then counts the slot the first one took.
  select * into v_inv from public.invitations where token_hash = v_hash for update;
  if not found or v_inv.status = 'revoked' then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.claim_deadline <= now() then
    raise exception 'invitation_expired' using errcode = 'P0002';
  end if;

  select count(*) into v_used from public.invite_claims c
    where c.invitation_id = v_inv.id and c.status = 'active';
  if v_used >= v_inv.claim_limit then
    raise exception 'invitation_claimed' using errcode = 'P0002';
  end if;

  select (coalesce(max(c.slot), 0) + 1)::smallint into v_slot
    from public.invite_claims c where c.invitation_id = v_inv.id;

  v_session := app_private.f108_random_token();
  v_credential := app_private.f108_admission_credential(v_session);

  insert into public.invite_claims (
    invitation_id, guest_list_id, slot, display_name, phone_reference, session_hash, device_id)
  values (v_inv.id, v_inv.guest_list_id, v_slot, trim(p_display_name),
          app_private.f108_hash(trim(p_phone)), app_private.f108_hash(v_session),
          nullif(trim(coalesce(p_device_id, '')), ''))
  returning id into v_claim_id;

  insert into public.admissions (claim_id, guest_list_id, credential_hash, expires_at)
  values (v_claim_id, v_inv.guest_list_id, app_private.f108_hash(v_credential),
          v_inv.admission_expires_at)
  returning id into v_admission;

  if v_used + 1 >= v_inv.claim_limit then
    update public.invitations set status = 'claimed' where id = v_inv.id;
  end if;

  select l.title into v_title from public.guest_lists l where l.id = v_inv.guest_list_id;

  -- The audit records the identifiers, never the name, the phone or either secret.
  perform app_private.audit(null, 'invitation.claimed', 'invite_claims', v_claim_id, v_inv.house_id,
    jsonb_build_object('invitation_id', v_inv.id, 'slot', v_slot, 'claim_limit', v_inv.claim_limit));

  return jsonb_build_object(
    'guest_session', v_session,
    'admission_credential', v_credential,
    'event_title', v_title,
    'slot', v_slot,
    'claim_limit', v_inv.claim_limit,
    'claim_deadline', v_inv.claim_deadline,
    'admission_expires_at', v_inv.admission_expires_at
  );
end;
$$;
revoke all on function public.claim_invitation(text, text, text, text) from public;
grant execute on function public.claim_invitation(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The guest's own card, read with the guest's own session
-- ---------------------------------------------------------------------------
create or replace function public.my_claimed_card(p_guest_session text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session text := trim(coalesce(p_guest_session, ''));
  v_row     record;
begin
  if length(v_session) < 32 then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;

  select c.display_name, c.slot, c.status as claim_status, a.status as admission_status,
         a.expires_at, l.title
    into v_row
    from public.invite_claims c
    join public.admissions a on a.claim_id = c.id
    join public.guest_lists l on l.id = c.guest_list_id
   where c.session_hash = app_private.f108_hash(v_session);

  if not found then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'event_title', v_row.title,
    'display_name', v_row.display_name,
    'slot', v_row.slot,
    'status', v_row.admission_status,
    'expires_at', v_row.expires_at,
    'admission_credential',
      case when v_row.claim_status = 'active' and v_row.admission_status <> 'revoked'
           then app_private.f108_admission_credential(v_session)
           else null end
  );
end;
$$;
revoke all on function public.my_claimed_card(text) from public;
grant execute on function public.my_claimed_card(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Host: find the person who will hold the door device
--
-- Scoped to a guest list the caller already hosts, so this is not a way to look people up: only an
-- active, verified account is returned, and the email address itself never comes back.
-- ---------------------------------------------------------------------------
create or replace function public.grantee_for_list(p_list uuid, p_email text)
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform app_private.require_list_host(p_list);
  if v_email = ''
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(v_email) > 320 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  return query
    select u.id, coalesce(nullif(u.display_name, ''), split_part(u.email, '@', 1))
      from public.users u
     where lower(u.email) = v_email
       and u.status = 'active'
       and u.email_verified
     limit 1;

  if not found then
    raise exception 'grantee_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.grantee_for_list(uuid, text) from public, anon;
grant execute on function public.grantee_for_list(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Host: hand a device a scanner grant
-- ---------------------------------------------------------------------------
create or replace function public.issue_scanner_grant(
  p_list uuid, p_device_id text, p_grantee uuid, p_expires_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_list_host(p_list);
  v_id    uuid;
begin
  if p_device_id is null or length(trim(p_device_id)) not between 1 and 120 then
    raise exception 'invalid_device' using errcode = '22023';
  end if;
  if p_grantee is null or not exists (select 1 from public.users u where u.id = p_grantee) then
    raise exception 'invalid_grantee' using errcode = '22023';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'invalid_grant_expiry' using errcode = '22023';
  end if;

  insert into public.scanner_grants (
    guest_list_id, house_id, grantee_user_id, device_id, granted_by, expires_at)
  select l.id, l.house_id, p_grantee, trim(p_device_id), v_actor, p_expires_at
    from public.guest_lists l
   where l.id = p_list
  returning id into v_id;

  perform app_private.audit(v_actor, 'scanner_grant.issued', 'scanner_grants', v_id,
    (select house_id from public.guest_lists where id = p_list),
    jsonb_build_object('device_id', trim(p_device_id), 'expires_at', p_expires_at));

  return jsonb_build_object(
    'grant_id', v_id,
    'device_id', trim(p_device_id),
    'grantee_user_id', p_grantee,
    'expires_at', p_expires_at,
    'version', 1
  );
end;
$$;
revoke all on function public.issue_scanner_grant(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.issue_scanner_grant(uuid, text, uuid, timestamptz) to authenticated;

create or replace function public.revoke_scanner_grant(p_grant uuid, p_expected_version integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_g     public.scanner_grants;
  v_actor uuid;
begin
  select * into v_g from public.scanner_grants where id = p_grant;
  if not found then
    raise exception 'scanner_grant_not_found' using errcode = 'P0002';
  end if;
  v_actor := app_private.require_list_host(v_g.guest_list_id);
  if v_g.version <> p_expected_version then
    raise exception 'stale_version: expected %, found %', p_expected_version, v_g.version
      using errcode = '40001';
  end if;

  update public.scanner_grants
     set revoked_at = now(), revoked_by = v_actor
   where id = v_g.id;

  perform app_private.audit(v_actor, 'scanner_grant.revoked', 'scanner_grants', v_g.id, v_g.house_id,
    jsonb_build_object('device_id', v_g.device_id));

  return v_g.version + 1;
end;
$$;
revoke all on function public.revoke_scanner_grant(uuid, integer) from public, anon;
grant execute on function public.revoke_scanner_grant(uuid, integer) to authenticated;

create or replace function public.host_scanner_grants(p_list uuid)
returns table (
  grant_id uuid,
  device_id text,
  grantee_user_id uuid,
  granted_by uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  version integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_list_host(p_list);
  return query
    select g.id, g.device_id, g.grantee_user_id, g.granted_by, g.expires_at, g.revoked_at,
           g.created_at, g.version
      from public.scanner_grants g
     where g.guest_list_id = p_list
     order by g.created_at desc;
end;
$$;
revoke all on function public.host_scanner_grants(uuid) from public, anon;
grant execute on function public.host_scanner_grants(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The scanner's guard: this grant, this device, this person, still live
-- ---------------------------------------------------------------------------
create or replace function app_private.require_scanner_grant(p_grant uuid, p_device_id text)
returns public.scanner_grants
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_g     public.scanner_grants;
  v_actor uuid := app_private.current_user_id();
begin
  select * into v_g from public.scanner_grants where id = p_grant;
  if not found then
    raise exception 'scanner_grant_not_found' using errcode = 'P0002';
  end if;
  if v_actor is null or v_g.grantee_user_id <> v_actor then
    raise exception 'forbidden: scanner grant' using errcode = '42501';
  end if;
  if v_g.revoked_at is not null then
    raise exception 'scanner_grant_revoked' using errcode = '42501';
  end if;
  if v_g.expires_at <= now() then
    raise exception 'scanner_grant_expired' using errcode = '42501';
  end if;
  if p_device_id is null or trim(p_device_id) <> v_g.device_id then
    raise exception 'forbidden: scanner device' using errcode = '42501';
  end if;
  return v_g;
end;
$$;
revoke all on function app_private.require_scanner_grant(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- The scanner's cache: the admission minimum for one guest list
--
-- A card's name, its state and its expiry. No phone number, no address, no other guest's details.
-- ---------------------------------------------------------------------------
create or replace function public.scanner_admissions(p_grant uuid, p_device_id text)
returns table (
  credential_hash text,
  display_name text,
  status text,
  expires_at timestamptz,
  cache_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_g public.scanner_grants := app_private.require_scanner_grant(p_grant, p_device_id);
begin
  perform app_private.audit(app_private.current_user_id(), 'admission.cache_read', 'scanner_grants',
    v_g.id, v_g.house_id, jsonb_build_object('device_id', v_g.device_id));

  return query
    select a.credential_hash, c.display_name, a.status, a.expires_at, v_g.expires_at
      from public.admissions a
      join public.invite_claims c on c.id = a.claim_id
     where a.guest_list_id = v_g.guest_list_id
       and c.status = 'active'
       and a.status <> 'revoked'
     order by c.display_name;
end;
$$;
revoke all on function public.scanner_admissions(uuid, text) from public, anon;
grant execute on function public.scanner_admissions(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The admission itself
--
-- 'online' is a check-in made while the device could reach the platform. 'queued_offline' is one
-- the device recorded while it could not, and is written when it reconnects; the device's own
-- clock is what it says it saw, and the moment the platform received it is kept as well.
-- ---------------------------------------------------------------------------
create or replace function public.record_checkin(
  p_grant uuid, p_credential text, p_device_id text, p_occurred_at timestamptz, p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_g        public.scanner_grants := app_private.require_scanner_grant(p_grant, p_device_id);
  v_row      record;
  v_result   text;
  v_checkin  uuid;
  v_name     text;
begin
  if p_mode is null or p_mode not in ('online', 'queued_offline') then
    raise exception 'invalid_checkin_mode' using errcode = '22023';
  end if;
  if p_credential is null or length(trim(p_credential)) < 32 then
    raise exception 'invalid_credential' using errcode = '22023';
  end if;

  select a.id, a.status, a.expires_at, c.display_name
    into v_row
    from public.admissions a
    join public.invite_claims c on c.id = a.claim_id
   where a.credential_hash = app_private.f108_hash(trim(p_credential))
     and a.guest_list_id = v_g.guest_list_id;

  if not found then
    v_result := 'unknown';
  elsif v_row.expires_at <= now() then
    v_result := 'expired';
  elsif v_row.status = 'admitted' then
    -- An offline scanner cannot know that another device already admitted this guest. The second
    -- admission is kept, as a duplicate, so the host can see it.
    v_result := 'duplicate';
  else
    v_result := 'admitted';
  end if;

  if v_result = 'admitted' then
    update public.admissions
       set status = 'admitted', admitted_at = coalesce(p_occurred_at, now())
     where id = v_row.id;
  end if;

  insert into public.checkins (
    admission_id, scanner_grant_id, guest_list_id, device_id, occurred_at, mode, result)
  values (case when v_result = 'unknown' then null else v_row.id end,
          v_g.id, v_g.guest_list_id, v_g.device_id,
          coalesce(p_occurred_at, now()), p_mode, v_result)
  returning id into v_checkin;

  v_name := case when v_result = 'unknown' then null else v_row.display_name end;

  perform app_private.audit(app_private.current_user_id(), 'admission.checked_in', 'checkins',
    v_checkin, v_g.house_id,
    jsonb_build_object('result', v_result, 'mode', p_mode, 'device_id', v_g.device_id));

  return jsonb_build_object(
    'checkin_id', v_checkin,
    'result', v_result,
    'display_name', v_name,
    'conflict', v_result = 'duplicate',
    'occurred_at', coalesce(p_occurred_at, now())
  );
end;
$$;
revoke all on function public.record_checkin(uuid, text, text, timestamptz, text) from public, anon;
grant execute on function public.record_checkin(uuid, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Host: the door's record
-- ---------------------------------------------------------------------------
create or replace function public.host_checkins(p_list uuid)
returns table (
  checkin_id uuid,
  display_name text,
  result text,
  mode text,
  device_id text,
  occurred_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_list_host(p_list);
  return query
    select k.id, c.display_name, k.result, k.mode, k.device_id, k.occurred_at, k.created_at
      from public.checkins k
      left join public.admissions a on a.id = k.admission_id
      left join public.invite_claims c on c.id = a.claim_id
     where k.guest_list_id = p_list
     order by k.occurred_at desc;
end;
$$;
revoke all on function public.host_checkins(uuid) from public, anon;
grant execute on function public.host_checkins(uuid) to authenticated;

notify pgrst, 'reload schema';
