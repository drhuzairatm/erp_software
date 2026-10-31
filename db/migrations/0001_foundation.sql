-- =============================================================================
-- 0001 Foundation: organizations, users, authentication, roles/permissions,
--                  memberships, audit log, and core authorization helpers.
--
-- Security model summary
--   * The web application connects as the low-privilege role `erp_app`.
--     It is NOT the table owner and has NO BYPASSRLS, so every query it makes
--     is filtered by row-level security (RLS) policies (see 0007_security.sql).
--   * Each request runs inside a transaction that sets `app.user_id` to the
--     authenticated user's id (transaction-local). Policies read that setting.
--   * Credentials and sessions live in schema `auth_private`, which erp_app
--     cannot read directly; it can only call narrow SECURITY DEFINER functions.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    create role erp_app nologin noinherit nobypassrls;
  end if;
end $$;

create schema if not exists app;
create schema if not exists auth_private;
revoke all on schema auth_private from public;
revoke create on schema public from public;

-- -----------------------------------------------------------------------------
-- Request context helpers
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.touch_updated_by() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.current_user_id(), new.updated_by);
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Organizations (companies / brands)
-- -----------------------------------------------------------------------------
create table organizations (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  name                 text not null check (length(btrim(name)) between 2 and 120),
  student_code_prefix  text not null unique check (student_code_prefix ~ '^[A-Z]{2,5}$'),
  -- Free-form, non-sensitive configuration. Known keys:
  --   currency (text, e.g. 'INR'), allow_self_payment_verification (bool)
  settings             jsonb not null default '{}'::jsonb,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger organizations_touch before update on organizations
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Users (staff only; students never log in in this version)
-- -----------------------------------------------------------------------------
create table user_profiles (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name   text not null check (length(btrim(full_name)) between 2 and 120),
  job_title   text,
  is_active   boolean not null default true,
  created_by  uuid references user_profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index user_profiles_email_key on user_profiles (lower(email));
create trigger user_profiles_touch before update on user_profiles
  for each row execute function app.touch_updated_at();

create table auth_private.credentials (
  user_id              uuid primary key references user_profiles(id) on delete cascade,
  password_hash        text not null,
  password_changed_at  timestamptz not null default now(),
  must_change_password boolean not null default false
);

create table auth_private.sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_profiles(id) on delete cascade,
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  ip            text,
  user_agent    text
);
create index sessions_user_idx on auth_private.sessions (user_id) where revoked_at is null;

create table auth_private.login_attempts (
  id            bigint generated always as identity primary key,
  email         text not null,
  ip            text,
  success       boolean not null,
  attempted_at  timestamptz not null default now()
);
create index login_attempts_email_idx on auth_private.login_attempts (lower(email), attempted_at desc);
create index login_attempts_ip_idx on auth_private.login_attempts (ip, attempted_at desc);

create table auth_private.password_resets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references user_profiles(id) on delete cascade,
  token_hash   text not null unique,
  requested_via text not null check (requested_via in ('self_service', 'administrator')),
  created_by   uuid references user_profiles(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);

-- -----------------------------------------------------------------------------
-- Permissions, roles (per organization, configurable), memberships
-- -----------------------------------------------------------------------------
create table permissions (
  key          text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  category     text not null,
  description  text not null,
  is_sensitive boolean not null default false
);

create table roles (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id),
  key          text not null check (key ~ '^[a-z_]{2,40}$'),
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, key),
  unique (id, org_id)
);
create trigger roles_touch before update on roles
  for each row execute function app.touch_updated_at();

create table role_permissions (
  role_id         uuid not null references roles(id) on delete cascade,
  permission_key  text not null references permissions(key),
  primary key (role_id, permission_key)
);

create table organization_memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references user_profiles(id),
  org_id      uuid not null references organizations(id),
  role_id     uuid not null,
  is_active   boolean not null default true,
  created_by  uuid references user_profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, org_id),
  -- The role must belong to the same organization as the membership, so a role
  -- in one company can never grant permissions in the other.
  foreign key (role_id, org_id) references roles(id, org_id)
);
create index memberships_org_idx on organization_memberships (org_id) where is_active;
create trigger memberships_touch before update on organization_memberships
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER: they read membership tables that
-- RLS would otherwise hide, but they only ever answer about the CURRENT user).
-- -----------------------------------------------------------------------------
create or replace function app.has_perm(p_org uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
      from organization_memberships m
      join role_permissions rp on rp.role_id = m.role_id
      join user_profiles u on u.id = m.user_id
      join organizations o on o.id = m.org_id
     where m.user_id = app.current_user_id()
       and m.org_id = p_org
       and m.is_active and u.is_active and o.is_active
       and rp.permission_key = p_perm
  )
$$;

create or replace function app.orgs_with_perm(p_perm text) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id
    from organization_memberships m
    join role_permissions rp on rp.role_id = m.role_id
    join user_profiles u on u.id = m.user_id
    join organizations o on o.id = m.org_id
   where m.user_id = app.current_user_id()
     and m.is_active and u.is_active and o.is_active
     and rp.permission_key = p_perm
$$;

create or replace function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organization_memberships m
      join user_profiles u on u.id = m.user_id
     where m.user_id = app.current_user_id() and m.org_id = p_org
       and m.is_active and u.is_active
  )
$$;

-- Is the given user an active member of the given org? (used for assignment validation)
create or replace function app.user_is_active_member(p_user uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organization_memberships m
      join user_profiles u on u.id = m.user_id
     where m.user_id = p_user and m.org_id = p_org and m.is_active and u.is_active
  )
$$;

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table audit_logs (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_user_id  uuid references user_profiles(id),
  org_id         uuid references organizations(id),
  student_id     uuid,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  before_data    jsonb,
  after_data     jsonb,
  outcome        text not null default 'success' check (outcome in ('success', 'denied', 'failure')),
  metadata       jsonb not null default '{}'::jsonb,
  request_ip     text
);
create index audit_logs_org_idx on audit_logs (org_id, occurred_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on audit_logs (actor_user_id, occurred_at desc);

create or replace function app.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end $$;
create trigger audit_logs_no_update before update or delete on audit_logs
  for each row execute function app.audit_immutable();
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function app.audit_immutable();

-- Explicit audit entry (reads, exports, logins, denied attempts, etc.)
create or replace function app.audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_org uuid default null, p_student uuid default null,
  p_before jsonb default null, p_after jsonb default null,
  p_outcome text default 'success', p_metadata jsonb default '{}'::jsonb,
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_logs (actor_user_id, org_id, student_id, action, entity_type, entity_id,
                          before_data, after_data, outcome, metadata, request_ip)
  values (coalesce(app.current_user_id(), p_actor), p_org, p_student, p_action, p_entity_type, p_entity_id,
          p_before, p_after, p_outcome, coalesce(p_metadata, '{}'::jsonb),
          nullif(current_setting('app.request_ip', true), ''));
end $$;

-- Generic row-change audit trigger.
--   TG_ARGV[0] = name of the column holding the organization id (or '' if none)
--   TG_ARGV[1] = name of the column holding the student id (or '' if none)
--   TG_ARGV[2..] = columns to exclude from before/after snapshots
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_student uuid;
  v_excl text;
  v_key text;
  i int;
begin
  if tg_argv[0] <> '' then v_org := (v_row ->> tg_argv[0])::uuid; end if;
  if tg_argv[1] <> '' then v_student := (v_row ->> tg_argv[1])::uuid; end if;
  for i in 2 .. coalesce(array_length(tg_argv, 1), 0) - 1 loop
    v_excl := tg_argv[i];
    v_old := v_old - v_excl;
    v_new := v_new - v_excl;
  end loop;
  v_old := v_old - 'updated_at';
  v_new := v_new - 'updated_at';
  if tg_op = 'UPDATE' then
    -- keep only changed keys
    for v_key in select jsonb_object_keys(v_new) loop
      if v_old -> v_key is not distinct from v_new -> v_key then
        v_old := v_old - v_key;
        v_new := v_new - v_key;
      end if;
    end loop;
    if v_new = '{}'::jsonb then return null; end if;
  end if;
  insert into audit_logs (actor_user_id, org_id, student_id, action, entity_type, entity_id,
                          before_data, after_data, request_ip)
  values (app.current_user_id(), v_org, v_student, lower(tg_op), tg_table_name, v_row ->> 'id',
          v_old, v_new, nullif(current_setting('app.request_ip', true), ''));
  return null;
end $$;

create trigger organizations_audit after insert or update or delete on organizations
  for each row execute function app.audit_row('id', '');
create trigger user_profiles_audit after insert or update or delete on user_profiles
  for each row execute function app.audit_row('', '');
create trigger memberships_audit after insert or update or delete on organization_memberships
  for each row execute function app.audit_row('org_id', '');
create trigger roles_audit after insert or update or delete on roles
  for each row execute function app.audit_row('org_id', '');

create or replace function app.audit_role_permissions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from roles where id = coalesce(new.role_id, old.role_id);
  perform app.audit(case when tg_op = 'INSERT' then 'grant' else 'revoke' end, 'role_permissions',
                    coalesce(new.role_id, old.role_id)::text, v_org, null, null,
                    jsonb_build_object('permission', coalesce(new.permission_key, old.permission_key)));
  return null;
end $$;
create trigger role_permissions_audit after insert or delete on role_permissions
  for each row execute function app.audit_role_permissions();

-- Deactivating a user ends all of their sessions immediately.
create or replace function app.revoke_sessions_on_deactivate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_active and not new.is_active then
    update auth_private.sessions set revoked_at = now()
     where user_id = new.id and revoked_at is null;
  end if;
  return null;
end $$;
create trigger user_profiles_revoke_sessions after update of is_active on user_profiles
  for each row execute function app.revoke_sessions_on_deactivate();

-- -----------------------------------------------------------------------------
-- Narrow authentication API for the application role.
-- -----------------------------------------------------------------------------

-- Returns the password hash only for an ACTIVE user, so login can be verified
-- in the application (argon2id). Never returns hashes for inactive users.
create or replace function app.auth_login_lookup(p_email text)
returns table (user_id uuid, password_hash text, must_change_password boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, c.password_hash, c.must_change_password
    from user_profiles u join auth_private.credentials c on c.user_id = u.id
   where lower(u.email) = lower(btrim(p_email)) and u.is_active
$$;

-- Rate limiting: failed attempts in the last 15 minutes, per email and per IP.
create or replace function app.auth_recent_failures(p_email text, p_ip text)
returns table (email_failures int, ip_failures int)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    (select count(*)::int from auth_private.login_attempts
      where lower(email) = lower(btrim(p_email)) and not success
        and attempted_at > now() - interval '15 minutes'
        and attempted_at > coalesce((select max(attempted_at) from auth_private.login_attempts s
                                      where lower(s.email) = lower(btrim(p_email)) and s.success), '-infinity')),
    (select count(*)::int from auth_private.login_attempts
      where ip = p_ip and not success and attempted_at > now() - interval '15 minutes')
$$;

create or replace function app.auth_record_attempt(p_email text, p_ip text, p_success boolean, p_user uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into auth_private.login_attempts (email, ip, success) values (lower(btrim(p_email)), p_ip, p_success);
  perform app.audit(case when p_success then 'login' else 'login_failed' end, 'session', null,
                    null, null, null, null,
                    case when p_success then 'success' else 'denied' end,
                    jsonb_build_object('email', lower(btrim(p_email))), p_user);
end $$;

create or replace function app.auth_create_session(p_user uuid, p_token_hash text, p_ttl_hours int, p_ip text, p_user_agent text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from user_profiles where id = p_user and is_active) then
    raise exception 'inactive user';
  end if;
  insert into auth_private.sessions (user_id, token_hash, expires_at, ip, user_agent)
  values (p_user, p_token_hash, now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 24)), p_ip, left(p_user_agent, 300))
  returning id into v_id;
  return v_id;
end $$;

-- Resolves a session token hash to a user id. Applies absolute expiry and an
-- 8-hour idle timeout, and refreshes last_seen_at at most once per minute.
create or replace function app.auth_resolve_session(p_token_hash text)
returns table (session_id uuid, user_id uuid, must_change_password boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s auth_private.sessions%rowtype;
begin
  select s.* into v_s from auth_private.sessions s
    join user_profiles u on u.id = s.user_id
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
     and s.last_seen_at > now() - interval '8 hours' and u.is_active;
  if not found then return; end if;
  if v_s.last_seen_at < now() - interval '1 minute' then
    update auth_private.sessions set last_seen_at = now() where id = v_s.id;
  end if;
  return query select v_s.id, v_s.user_id, c.must_change_password
                 from auth_private.credentials c where c.user_id = v_s.user_id;
end $$;

create or replace function app.auth_revoke_session(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update auth_private.sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null
$$;

-- Password reset tokens -------------------------------------------------------
-- Self-service request: returns a reset id only if the account exists & is
-- active (the caller must not reveal which case happened to the requester).
create or replace function app.auth_request_reset(p_email text, p_token_hash text)
returns table (user_id uuid, email text, full_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user user_profiles%rowtype;
begin
  select * into v_user from user_profiles where lower(user_profiles.email) = lower(btrim(p_email)) and is_active;
  if not found then return; end if;
  insert into auth_private.password_resets (user_id, token_hash, requested_via, expires_at)
  values (v_user.id, p_token_hash, 'self_service', now() + interval '1 hour');
  perform app.audit('password_reset_requested', 'user_profiles', v_user.id::text, null, null, null, null, 'success', '{}', v_user.id);
  return query select v_user.id, v_user.email, v_user.full_name;
end $$;

-- Administrator-issued reset link: requires users.manage in an org where the
-- target user is a member.
create or replace function app.auth_admin_issue_reset(p_user uuid, p_token_hash text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from organization_memberships m
     where m.user_id = p_user and app.has_perm(m.org_id, 'users.manage')
  ) then
    raise exception 'permission denied: users.manage' using errcode = '42501';
  end if;
  update auth_private.password_resets set used_at = now() where user_id = p_user and used_at is null;
  insert into auth_private.password_resets (user_id, token_hash, requested_via, created_by, expires_at)
  values (p_user, p_token_hash, 'administrator', app.current_user_id(), now() + interval '24 hours');
  perform app.audit('password_reset_issued', 'user_profiles', p_user::text);
end $$;

create or replace function app.auth_reset_is_valid(p_token_hash text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from auth_private.password_resets r join user_profiles u on u.id = r.user_id
                  where r.token_hash = p_token_hash and r.used_at is null and r.expires_at > now() and u.is_active)
$$;

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
  perform app.audit('password_reset_completed', 'user_profiles', v_user::text, null, null, null, null, 'success', '{}', v_user);
  return v_user;
end $$;

-- Change own password (requires a valid session context)
create or replace function app.auth_change_own_password(p_password_hash text, p_keep_session uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is null then raise exception 'not authenticated'; end if;
  update auth_private.credentials set password_hash = p_password_hash, password_changed_at = now(),
         must_change_password = false
   where user_id = app.current_user_id();
  update auth_private.sessions set revoked_at = now()
   where user_id = app.current_user_id() and revoked_at is null and id <> p_keep_session;
  perform app.audit('password_changed', 'user_profiles', app.current_user_id()::text);
end $$;

create or replace function app.auth_own_password_hash() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select password_hash from auth_private.credentials where user_id = app.current_user_id()
$$;

-- Administrator sets an initial password (new staff account).
create or replace function app.auth_admin_set_initial_password(p_user uuid, p_password_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from organization_memberships m
     where m.user_id = p_user and app.has_perm(m.org_id, 'users.manage')
  ) then
    raise exception 'permission denied: users.manage' using errcode = '42501';
  end if;
  insert into auth_private.credentials (user_id, password_hash, must_change_password)
  values (p_user, p_password_hash, true)
  on conflict (user_id) do update set password_hash = excluded.password_hash,
         password_changed_at = now(), must_change_password = true;
  update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  perform app.audit('password_set_by_admin', 'user_profiles', p_user::text);
end $$;

-- Which users have pending self-service reset requests (shown to admins)
create or replace function app.auth_pending_reset_requests() returns table (user_id uuid, requested_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.user_id, max(r.created_at)
    from auth_private.password_resets r
   where r.requested_via = 'self_service' and r.used_at is null and r.expires_at > now()
     and exists (select 1 from organization_memberships m
                  where m.user_id = r.user_id and app.has_perm(m.org_id, 'users.manage'))
   group by r.user_id
$$;
