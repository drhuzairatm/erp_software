-- =============================================================================
-- 0032 Staff account security (Phase A of the audit remediation)
--   * account states: invited / active / suspended / terminated (is_active kept in step)
--   * employee fields: phone, joining date, email verified at, status reason/changed by
--   * invitations: one-time, time-limited, hashed tokens (auth_private), accepted = email verified
--   * sign out everywhere; suspend / terminate revoke sessions, invitations and reset links
--   * protected MD: a second MD only by the database administrator with an explicit override
-- Nothing is deleted. Existing accounts keep their access.
-- =============================================================================

alter table user_profiles
  add column account_status    text not null default 'active' check (account_status in ('invited', 'active', 'suspended', 'terminated')),
  add column phone             text check (phone is null or length(phone) between 5 and 40),
  add column joining_date      date,
  add column email_verified_at timestamptz,
  add column status_reason     text check (status_reason is null or length(status_reason) <= 500),
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references user_profiles(id);

-- Backfill without audit noise: deactivated → suspended; active accounts that never set a password → invited
alter table user_profiles disable trigger user_profiles_audit;
update user_profiles u set account_status = case
  when not u.is_active then 'suspended'
  when not exists (select 1 from auth_private.credentials c where c.user_id = u.id) then 'invited'
  else 'active' end;
alter table user_profiles enable trigger user_profiles_audit;
create index user_profiles_status_idx on user_profiles (account_status);

-- Keeps is_active (used by login, sessions, assignment checks) in step with the account state.
create or replace function app.user_status_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if tg_op = 'INSERT' then
    if v_me is not null then new.account_status := 'invited'; end if; -- staff created in the app must accept an invitation
  elsif new.account_status is not distinct from old.account_status and new.is_active is distinct from old.is_active then
    -- older code paths that only switch is_active
    new.account_status := case when not new.is_active then 'suspended'
      when exists (select 1 from auth_private.credentials c where c.user_id = new.id) then 'active' else 'invited' end;
  end if;
  if tg_op = 'UPDATE' and new.account_status is distinct from old.account_status then
    if old.account_status = 'terminated' and v_me is not null and not exists (select 1 from app.orgs_with_perm('users.create_admin')) then
      raise exception 'Only an administrator allowed to create administrators can reinstate a terminated employee.' using errcode = '42501';
    end if;
    new.status_changed_at := now();
    new.status_changed_by := v_me;
  end if;
  new.is_active := new.account_status in ('invited', 'active');
  return new;
end $$;
create trigger user_profiles_status_sync before insert or update on user_profiles
  for each row execute function app.user_status_sync();

grant insert (phone, joining_date) on user_profiles to erp_app;
grant update (phone, joining_date) on user_profiles to erp_app;

-- ---------------------------------------------------------------------------
-- Suspend / terminate / reactivate (with reason). Sessions are revoked by the existing is_active trigger.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_status(p_user uuid, p_status text, p_reason text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text; v_new text := p_status; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('active', 'suspended', 'terminated') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_user = app.current_user_id() then raise exception 'You cannot change your own account status.' using errcode = '42501'; end if;
  if not app.can_administer_user(p_user)
     or not exists (select 1 from organization_memberships m where m.user_id = p_user and app.has_perm(m.org_id, 'users.manage')) then
    raise exception 'permission denied: this account is outside your authority' using errcode = '42501';
  end if;
  select account_status into v_old from user_profiles where id = p_user for update;
  if v_old = p_status then return v_old; end if;
  if p_status in ('suspended', 'terminated') and v_reason is null then
    raise exception 'Give a reason for the suspension or termination.' using errcode = '22023';
  end if;
  -- someone who never accepted the invitation returns to "invited", not "active"
  if p_status = 'active' and not exists (select 1 from auth_private.credentials c where c.user_id = p_user) then v_new := 'invited'; end if;
  update user_profiles set account_status = v_new, status_reason = case when v_new = 'active' or v_new = 'invited' then null else v_reason end where id = p_user;
  if v_new in ('suspended', 'terminated') then
    update auth_private.staff_invitations set revoked_at = now() where user_id = p_user and accepted_at is null and revoked_at is null;
    update auth_private.password_resets set used_at = now() where user_id = p_user and used_at is null;
    update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  end if;
  perform app.audit('staff_status_changed', 'user_profiles', p_user::text, null, null,
    jsonb_build_object('account_status', v_old), jsonb_build_object('account_status', v_new, 'reason', v_reason));
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Sign out everywhere (yourself, or someone within your authority)
-- ---------------------------------------------------------------------------
create or replace function app.revoke_user_sessions(p_user uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if app.current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_user <> app.current_user_id() and not app.can_administer_user(p_user) then
    raise exception 'permission denied: this account is outside your authority' using errcode = '42501';
  end if;
  update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  get diagnostics n = row_count;
  perform app.audit('sessions_revoked', 'user_profiles', p_user::text, null, null, null, null, 'success',
    jsonb_build_object('sessions', n, 'own_account', p_user = app.current_user_id()));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table auth_private.staff_invitations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references user_profiles(id),
  token_hash  text not null unique,
  created_by  uuid references user_profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz
);
create unique index staff_invitations_one_open on auth_private.staff_invitations (user_id) where accepted_at is null and revoked_at is null;

create or replace function app.issue_staff_invitation(p_user uuid, p_token_hash text, p_days int) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text; v_exp timestamptz := now() + make_interval(days => least(greatest(coalesce(p_days, 7), 1), 14));
begin
  if not app.can_administer_user(p_user)
     or not exists (select 1 from organization_memberships m where m.user_id = p_user and m.is_active and app.has_perm(m.org_id, 'users.manage')) then
    raise exception 'permission denied: this account is outside your authority' using errcode = '42501';
  end if;
  select account_status into v_status from user_profiles where id = p_user;
  if v_status <> 'invited' then
    raise exception 'This person has already accepted an invitation (or the account is suspended or terminated).' using errcode = '22023';
  end if;
  if (select count(*) from auth_private.staff_invitations where user_id = p_user and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'Too many invitations for this person today. Try again tomorrow.' using errcode = '22023';
  end if;
  update auth_private.staff_invitations set revoked_at = now() where user_id = p_user and accepted_at is null and revoked_at is null;
  insert into auth_private.staff_invitations (user_id, token_hash, created_by, expires_at) values (p_user, p_token_hash, app.current_user_id(), v_exp);
  perform app.audit('staff_invitation_issued', 'user_profiles', p_user::text, null, null, null, null, 'success', jsonb_build_object('expires_at', v_exp));
  return v_exp;
end $$;

create or replace function app.cancel_staff_invitation(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_administer_user(p_user) then raise exception 'permission denied' using errcode = '42501'; end if;
  update auth_private.staff_invitations set revoked_at = now() where user_id = p_user and accepted_at is null and revoked_at is null;
  perform app.audit('staff_invitation_cancelled', 'user_profiles', p_user::text);
end $$;

-- Public (no session): details of a valid invitation only
create or replace function app.auth_invitation_info(p_token_hash text) returns table (full_name text, email text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.full_name, u.email, i.expires_at from auth_private.staff_invitations i join user_profiles u on u.id = i.user_id
   where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() and u.account_status = 'invited'
$$;

create or replace function app.auth_accept_invitation(p_token_hash text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  update auth_private.staff_invitations i set accepted_at = now()
    from user_profiles u
   where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
     and u.id = i.user_id and u.account_status = 'invited'
  returning i.user_id into v_user;
  if v_user is null then return null; end if;
  insert into auth_private.credentials (user_id, password_hash, password_changed_at, must_change_password)
  values (v_user, p_password_hash, now(), false)
  on conflict (user_id) do update set password_hash = excluded.password_hash, password_changed_at = now(), must_change_password = false;
  update auth_private.password_resets set used_at = now() where user_id = v_user and used_at is null;
  update user_profiles set account_status = 'active', email_verified_at = now() where id = v_user;
  perform app.audit('staff_invitation_accepted', 'user_profiles', v_user::text, null, null, null, null, 'success', '{}', v_user);
  return v_user;
end $$;

-- Latest invitation per staff member the caller manages (no tokens)
create or replace function app.staff_invitations_overview() returns table (user_id uuid, created_at timestamptz, expires_at timestamptz, state text)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (i.user_id) i.user_id, i.created_at, i.expires_at,
         case when i.accepted_at is not null then 'accepted' when i.revoked_at is not null then 'cancelled'
              when i.expires_at <= now() then 'expired' else 'pending' end
    from auth_private.staff_invitations i
   where exists (select 1 from organization_memberships m where m.user_id = i.user_id and m.org_id in (select app.orgs_with_perm('users.manage')))
   order by i.user_id, i.created_at desc
$$;

-- Sign-in only for active accounts (invited, suspended and terminated cannot sign in)
create or replace function app.auth_login_lookup(p_email text)
returns table (user_id uuid, password_hash text, must_change_password boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, c.password_hash, c.must_change_password
    from user_profiles u join auth_private.credentials c on c.user_id = u.id
   where lower(u.email) = lower(btrim(p_email)) and u.is_active and u.account_status = 'active'
$$;

-- A password link sent to someone still "invited" also proves their email: activate them.
create or replace function app.auth_complete_reset(p_token_hash text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  update auth_private.password_resets r set used_at = now()
    from user_profiles u
   where r.token_hash = p_token_hash and r.used_at is null and r.expires_at > now()
     and u.id = r.user_id and u.is_active
  returning r.user_id into v_user;
  if v_user is null then return null; end if;
  insert into auth_private.credentials (user_id, password_hash, password_changed_at, must_change_password)
  values (v_user, p_password_hash, now(), false)
  on conflict (user_id) do update set password_hash = excluded.password_hash,
                                      password_changed_at = now(), must_change_password = false;
  update auth_private.sessions set revoked_at = now() where user_id = v_user and revoked_at is null;
  update auth_private.staff_invitations set revoked_at = now() where user_id = v_user and accepted_at is null and revoked_at is null;
  update user_profiles set account_status = 'active', email_verified_at = coalesce(email_verified_at, now()) where id = v_user and account_status = 'invited';
  perform app.audit('password_reset_completed', 'user_profiles', v_user::text, null, null, null, null, 'success', '{}', v_user);
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- Protected MD: the MD role cannot be granted in the app (existing rule). In the database, a second
-- active MD needs the explicit override set by `npm run admin:create -- --allow-additional-md`.
-- ---------------------------------------------------------------------------
create or replace function app.guard_protected_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_other boolean; v_override boolean := coalesce(current_setting('app.allow_additional_md', true), 'off') = 'on';
begin
  if not (select is_protected from roles where id = new.role_id) or not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.role_id = new.role_id and old.is_active then return new; end if;
  select exists (select 1 from organization_memberships m join roles r on r.id = m.role_id join user_profiles u on u.id = m.user_id
                  where r.is_protected and m.is_active and u.is_active and m.user_id <> new.user_id) into v_other;
  if v_other and not v_override then
    raise exception 'An MD account already exists. Another MD can only be added deliberately by the database administrator.' using errcode = '42501';
  end if;
  perform app.audit('md_role_granted', 'organization_memberships', new.user_id::text, new.org_id, null, null, null, 'success',
    jsonb_build_object('initial_setup', not v_other, 'additional_md_override', v_other and v_override));
  return new;
end $$;
create trigger memberships_guard_protected before insert or update of role_id, is_active on organization_memberships
  for each row execute function app.guard_protected_role();

grant execute on function app.set_staff_status(uuid, text, text), app.revoke_user_sessions(uuid), app.issue_staff_invitation(uuid, text, int),
  app.cancel_staff_invitation(uuid), app.auth_invitation_info(text), app.auth_accept_invitation(text, text), app.staff_invitations_overview()
  to erp_app;
