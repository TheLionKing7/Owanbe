-- F-78 Permission scoping
-- Pending: apply through the migration tool once the project's Supabase is connected.
-- Role matrix (enforced here, mirrored for UI hints in src/lib/permissions.ts):
--   host owner      : everything in their Host house
--   vendor owner    : everything in their Vendor house, including payouts, members, billing
--   vendor staff    : only the capabilities granted on their membership, never payouts/members/billing
--   platform support: no house write access; may read house data only with a stated purpose,
--                     and every such read is written to the append-only audit log
--   event manager   : same as support, but only for events they are assigned to
-- All checks fail closed: unknown capability, revoked/expired grant, inactive user => false.

create function app_private.owner_only_capabilities()
returns text[] language sql immutable
as $$ select array['payouts','members','billing'] $$;

create function app_private.all_house_capabilities()
returns text[] language sql immutable
as $$ select array['chat','quotes','calendar','profile','bookings','payouts','members','billing'] $$;

-- True when the current user may use p_capability in p_house.
create function app_private.house_can(p_house uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when not (p_capability = any (app_private.all_house_capabilities())) then false
      when m.role = 'owner' then true
      when p_capability = any (app_private.owner_only_capabilities()) then false
      else p_capability = any (m.capabilities)
    end
    from public.memberships m
    join public.houses h on h.id = m.house_id and h.archived_at is null
    where m.house_id = p_house
      and m.user_id = app_private.current_user_id()
      and m.revoked_at is null
  ), false)
$$;
revoke all on function app_private.house_can(uuid, text) from public;
grant execute on function app_private.house_can(uuid, text) to authenticated;

create function public.house_can(p_house uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app_private.house_can(p_house, p_capability) $$;
revoke all on function public.house_can(uuid, text) from public, anon;
grant execute on function public.house_can(uuid, text) to authenticated;

create function app_private.require_house_capability(p_house uuid, p_capability text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := app_private.current_user_id();
begin
  if v_user is null or not app_private.house_can(p_house, p_capability) then
    raise exception 'forbidden: % in house', p_capability using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function app_private.require_house_capability(uuid, text) from public;

-- Member administration (owner only, via the 'members' capability)
create function public.set_member_capabilities(p_membership uuid, p_capabilities text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m    public.memberships;
  v_user uuid;
begin
  select * into v_m from public.memberships where id = p_membership and revoked_at is null;
  if not found then
    raise exception 'forbidden: membership' using errcode = '42501';
  end if;
  v_user := app_private.require_house_capability(v_m.house_id, 'members');
  if v_m.role = 'owner' then
    raise exception 'forbidden: owner capabilities are fixed' using errcode = '42501';
  end if;
  if p_capabilities && app_private.owner_only_capabilities() then
    raise exception 'forbidden: staff cannot hold payouts, members or billing' using errcode = '42501';
  end if;
  update public.memberships set capabilities = coalesce(p_capabilities, '{}') where id = p_membership;
  perform app_private.audit(v_user, 'membership.capabilities_changed', 'memberships', p_membership,
                            v_m.house_id, jsonb_build_object('capabilities', p_capabilities));
end;
$$;
revoke all on function public.set_member_capabilities(uuid, text[]) from public, anon;
grant execute on function public.set_member_capabilities(uuid, text[]) to authenticated;

create function public.revoke_member(p_membership uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m    public.memberships;
  v_user uuid;
begin
  select * into v_m from public.memberships where id = p_membership and revoked_at is null;
  if not found then
    raise exception 'forbidden: membership' using errcode = '42501';
  end if;
  v_user := app_private.require_house_capability(v_m.house_id, 'members');
  if v_m.role = 'owner' then
    raise exception 'forbidden: the owner cannot be removed' using errcode = '42501';
  end if;
  update public.memberships set revoked_at = now(), revoked_by = v_user where id = p_membership;
  perform app_private.audit(v_user, 'membership.revoked', 'memberships', p_membership, v_m.house_id);
end;
$$;
revoke all on function public.revoke_member(uuid) from public, anon;
grant execute on function public.revoke_member(uuid) to authenticated;

-- Platform staff: active grant covering the target (global, or via an active assignment)
create function app_private.staff_grant_for(p_capability text, p_target_kind text default null, p_target uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id
  from public.staff_grants g
  join public.users u on u.id = g.user_id and u.status = 'active'
  where g.user_id = app_private.current_user_id()
    and g.capability = p_capability
    and g.revoked_at is null
    and (g.expires_at is null or g.expires_at > now())
    and (
      g.scope_kind = 'global'
      or exists (
        select 1 from public.assignments a
        where a.staff_grant_id = g.id
          and a.target_kind = p_target_kind
          and a.target_id = p_target
          and a.revoked_at is null
          and (a.expires_at is null or a.expires_at > now())
      )
    )
  order by g.scope_kind = 'global' desc
  limit 1
$$;
revoke all on function app_private.staff_grant_for(text, text, uuid) from public;

-- Sensitive reads go to the existing append-only audit_events log, with a mandatory purpose.
create function app_private.log_sensitive_read(p_actor uuid, p_grant uuid, p_table text, p_target uuid,
                                                p_house uuid, p_purpose text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_purpose is null or length(trim(p_purpose)) < 10 then
    raise exception 'purpose_required' using errcode = '22023';
  end if;
  insert into public.audit_events (actor_user_id, action, target_table, target_id, house_id, purpose, details)
  values (p_actor, 'sensitive.read', p_table, p_target, p_house, left(trim(p_purpose), 500),
          jsonb_build_object('staff_grant_id', p_grant));
end;
$$;
revoke all on function app_private.log_sensitive_read(uuid, uuid, text, uuid, uuid, text) from public;

-- Support view of a house's team: read-only projection, audited with a purpose.
create function public.support_house_members(p_house uuid, p_purpose text)
returns table (membership_id uuid, user_id uuid, display_name text, role text, capabilities text[], revoked_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user  uuid := app_private.current_user_id();
  v_grant uuid := app_private.staff_grant_for('support');
begin
  if v_user is null or v_grant is null then
    raise exception 'forbidden: support grant required' using errcode = '42501';
  end if;
  perform app_private.log_sensitive_read(v_user, v_grant, 'houses', p_house, p_house, p_purpose);
  return query
    select m.id, m.user_id, u.display_name, m.role, m.capabilities, m.revoked_at
    from public.memberships m
    join public.users u on u.id = m.user_id
    where m.house_id = p_house
    order by m.role, m.created_at;
end;
$$;
revoke all on function public.support_house_members(uuid, text) from public, anon;
grant execute on function public.support_house_members(uuid, text) to authenticated;

-- Generic gate for later sensitive reads by support or managers (events, cases).
create function public.authorize_sensitive_read(p_capability text, p_target_kind text, p_target uuid, p_purpose text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user  uuid := app_private.current_user_id();
  v_grant uuid;
begin
  if p_capability not in ('support', 'event_manager', 'arbitrator', 'verification_reviewer', 'finance') then
    raise exception 'forbidden: capability' using errcode = '42501';
  end if;
  v_grant := app_private.staff_grant_for(p_capability, p_target_kind, p_target);
  if v_user is null or v_grant is null then
    raise exception 'forbidden: % grant required', p_capability using errcode = '42501';
  end if;
  perform app_private.log_sensitive_read(v_user, v_grant, p_target_kind, p_target, null, p_purpose);
  return v_grant;
end;
$$;
revoke all on function public.authorize_sensitive_read(text, text, uuid, text) from public, anon;
grant execute on function public.authorize_sensitive_read(text, text, uuid, text) to authenticated;
