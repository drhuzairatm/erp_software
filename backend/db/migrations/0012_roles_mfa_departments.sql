-- =============================================================================
-- 0012 Phase A: MD / CEO hierarchy, no-escalation rules, departments,
--      count-only payment status, two-factor authentication (TOTP).
--
-- Rules enforced here (database level, not only in the UI):
--   * A user can only grant a permission they hold themselves (in that company).
--   * A user can only assign a role whose permissions they all hold, and
--     privileged roles (MD, CEO, administrators) also need users.create_admin.
--   * A user can only reset passwords / 2FA or deactivate accounts of people
--     whose access is entirely within their own ("can_administer_user").
--   * Protected roles (MD) cannot be changed from the application at all;
--     MD accounts are managed with the command-line provisioning tool.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('users.create_admin', 'Administration', 'Assign privileged roles (MD, CEO, administrators)', true),
  ('payments.status',    'Finance', 'See payment status COUNTS (pending, overdue) without any amounts', false),
  ('departments.manage', 'Administration', 'Create and edit departments', false)
on conflict (key) do nothing;

alter table roles
  add column is_privileged boolean not null default false,
  add column is_protected  boolean not null default false,
  add column requires_mfa  boolean not null default false;

-- Existing installations: flag roles and give the MD role every permission.
update roles set is_privileged = true, is_protected = true, requires_mfa = true where key = 'md';
update roles set is_privileged = true, requires_mfa = true where key in ('ceo', 'system_admin');
update roles set requires_mfa = true where key = 'finance';
insert into role_permissions (role_id, permission_key)
select r.id, p.key from roles r cross join permissions p where r.is_protected
on conflict do nothing;

-- New permissions added later are granted to protected (MD) roles automatically.
create or replace function app.grant_new_permission_to_protected() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into role_permissions (role_id, permission_key)
  select id, new.key from roles where is_protected on conflict do nothing;
  return null;
end $$;
create trigger permissions_grant_protected after insert on permissions
  for each row execute function app.grant_new_permission_to_protected();

-- Protected roles keep all permissions, even when a role is created later.
create or replace function app.protected_role_all_permissions() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.is_protected then
    insert into role_permissions (role_id, permission_key) select new.id, key from permissions on conflict do nothing;
  end if;
  return null;
end $$;
create trigger roles_protected_all after insert or update of is_protected on roles
  for each row execute function app.protected_role_all_permissions();

-- CEO role for existing installations (fresh installs get it from provisioning).
insert into roles (org_id, key, name, description, is_system, is_privileged, requires_mfa)
select o.id, 'ceo', 'CEO', 'Executive operations oversight. Payment counts only; no financial amounts. Extra powers only when granted by the MD.', true, true, true
  from organizations o
on conflict (org_id, key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, p from roles r cross join unnest(array[
  'dashboard.view', 'dashboard.consolidated', 'staff.workload.view',
  'students.read.all', 'students.read.processing', 'students.contact.view', 'students.assign',
  'notes.read', 'documents.read', 'tasks.read.all', 'tasks.create', 'tasks.assign',
  'payments.status', 'reports.view', 'reports.export'
]) as p where r.key = 'ceo'
  and not exists (select 1 from role_permissions x where x.role_id = r.id)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- No-escalation helpers
-- -----------------------------------------------------------------------------
create or replace function app.holds_all_perms_of_role(p_role uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from roles where id = p_role)
     and not exists (
       select 1 from roles r join role_permissions rp on rp.role_id = r.id
        where r.id = p_role and not app.has_perm(r.org_id, rp.permission_key))
$$;

-- May the current user assign this role (in its company) to someone else?
create or replace function app.can_assign_role(p_role uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select app.has_perm(r.org_id, 'users.manage')
       and not r.is_protected
       and app.holds_all_perms_of_role(r.id)
       and (not r.is_privileged or app.has_perm(r.org_id, 'users.create_admin'))
      from roles r where r.id = p_role), false)
$$;

-- May the current user administer (reset password/2FA, deactivate) this person?
-- Only if every company access they have is assignable by the current user.
create or replace function app.can_administer_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user <> app.current_user_id()
     and exists (select 1 from organization_memberships where user_id = p_user)
     and not exists (
       select 1 from organization_memberships m
        where m.user_id = p_user and m.is_active and not app.can_assign_role(m.role_id))
$$;

-- Keep the old name working for existing policies/functions, with the new rule.
create or replace function app.can_manage_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.can_administer_user(p_user)
$$;

drop policy memberships_insert on organization_memberships;
drop policy memberships_update on organization_memberships;
create policy memberships_insert on organization_memberships for insert to erp_app
  with check (user_id <> app.current_user_id() and app.can_assign_role(role_id));
create policy memberships_update on organization_memberships for update to erp_app
  using (user_id <> app.current_user_id() and app.can_assign_role(role_id))
  with check (user_id <> app.current_user_id() and app.can_assign_role(role_id));

drop policy role_perms_insert on role_permissions;
drop policy role_perms_delete on role_permissions;
create policy role_perms_insert on role_permissions for insert to erp_app
  with check (exists (select 1 from roles r where r.id = role_id and not r.is_protected
                        and app.has_perm(r.org_id, 'roles.manage') and app.has_perm(r.org_id, permission_key))
              and not app.holds_role(role_id));
create policy role_perms_delete on role_permissions for delete to erp_app
  using (exists (select 1 from roles r where r.id = role_id and not r.is_protected
                   and app.has_perm(r.org_id, 'roles.manage') and app.has_perm(r.org_id, permission_key))
         and not app.holds_role(role_id));

drop policy roles_update on roles;
create policy roles_update on roles for update to erp_app
  using (app.has_perm(org_id, 'roles.manage') and not is_protected)
  with check (app.has_perm(org_id, 'roles.manage') and not is_protected);
drop policy roles_insert on roles;
create policy roles_insert on roles for insert to erp_app
  with check (app.has_perm(org_id, 'roles.manage') and not is_system and not is_protected and not is_privileged);

-- Admin-issued password links: new rule
create or replace function app.auth_admin_issue_reset(p_user uuid, p_token_hash text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_administer_user(p_user) then
    raise exception 'permission denied: you can only reset accounts whose access is within your own' using errcode = '42501';
  end if;
  update auth_private.password_resets set used_at = now() where user_id = p_user and used_at is null;
  insert into auth_private.password_resets (user_id, token_hash, requested_via, created_by, expires_at)
  values (p_user, p_token_hash, 'administrator', app.current_user_id(), now() + interval '24 hours');
  perform app.audit('password_reset_issued', 'user_profiles', p_user::text);
end $$;

create or replace function app.auth_admin_set_initial_password(p_user uuid, p_password_hash text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_administer_user(p_user) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into auth_private.credentials (user_id, password_hash, must_change_password)
  values (p_user, p_password_hash, true)
  on conflict (user_id) do update set password_hash = excluded.password_hash,
         password_changed_at = now(), must_change_password = true;
  update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  perform app.audit('password_set_by_admin', 'user_profiles', p_user::text);
end $$;

-- -----------------------------------------------------------------------------
-- Departments
-- -----------------------------------------------------------------------------
create table departments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  name        text not null check (length(btrim(name)) between 2 and 80),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, name),
  unique (id, org_id)
);
alter table organization_memberships add column department_id uuid;
alter table organization_memberships add constraint memberships_department_fk
  foreign key (department_id, org_id) references departments(id, org_id);

insert into departments (org_id, name)
select o.id, d from organizations o
 cross join unnest(array['Admissions', 'Documentation', 'Attestation', 'Visa', 'Accounts', 'Management']) d
on conflict do nothing;

create trigger departments_audit after insert or update or delete on departments
  for each row execute function app.audit_row('org_id', '');

alter table departments enable row level security;
create policy departments_select on departments for select to erp_app using (app.is_member(org_id));
create policy departments_write on departments for all to erp_app
  using (app.has_perm(org_id, 'departments.manage')) with check (app.has_perm(org_id, 'departments.manage'));
grant select, insert, update on departments to erp_app;
grant update (department_id) on organization_memberships to erp_app;
grant insert (department_id) on organization_memberships to erp_app;

-- -----------------------------------------------------------------------------
-- Payment status COUNTS (no amounts) – for the CEO and other operational roles.
-- Returns only counts for companies where the caller has payments.status or
-- payments.read. No amount ever leaves this function.
-- -----------------------------------------------------------------------------
create or replace function app.payment_status_counts(p_orgs uuid[])
returns table (org_id uuid, students_with_balance int, entries_awaiting_verification int, students_awaiting_payment int)
language sql stable security definer set search_path = public, pg_temp as $$
  with allowed as (
    select o from unnest(p_orgs) o where app.has_perm(o, 'payments.status') or app.has_perm(o, 'payments.read')
  ), bal as (
    select e.org_id, e.student_id, sum(e.due_effect) - sum(e.received_effect) as outstanding
      from payment_entry_effects e where e.ledger = 'service' and e.org_id in (select o from allowed)
     group by e.org_id, e.student_id
  )
  select a.o,
         (select count(*)::int from bal b join students s on s.id = b.student_id
           where b.org_id = a.o and b.outstanding > 0 and s.status in ('active', 'on_hold') and app.can_read_student(s.id)),
         (select count(*)::int from payment_entries pe where pe.org_id = a.o and pe.verification_status = 'pending'),
         (select count(distinct b.student_id)::int from bal b join students s on s.id = b.student_id
           where b.org_id = a.o and b.outstanding > 0 and s.current_stage_key = 'fee_clearance' and app.can_read_student(s.id))
    from allowed a
$$;
grant execute on function app.payment_status_counts(uuid[]) to erp_app;

-- -----------------------------------------------------------------------------
-- Two-factor authentication (TOTP)
-- The secret is encrypted by the application (AES-256-GCM, key outside the DB)
-- before it is stored. Recovery codes are stored as SHA-256 hashes.
-- -----------------------------------------------------------------------------
create table auth_private.mfa (
  user_id          uuid primary key references user_profiles(id) on delete cascade,
  secret_encrypted text not null,
  enabled_at       timestamptz,
  last_used_step   bigint not null default 0,
  created_at       timestamptz not null default now()
);
create table auth_private.mfa_recovery_codes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references user_profiles(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz
);
create index mfa_recovery_user_idx on auth_private.mfa_recovery_codes (user_id) where used_at is null;

alter table auth_private.sessions add column mfa_pending boolean not null default false;
alter table auth_private.sessions add column mfa_failures int not null default 0;

drop function app.auth_create_session(uuid, text, int, text, text);
create function app.auth_create_session(p_user uuid, p_token_hash text, p_ttl_hours int, p_ip text, p_user_agent text, p_mfa_pending boolean)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from user_profiles where id = p_user and is_active) then
    raise exception 'inactive user';
  end if;
  insert into auth_private.sessions (user_id, token_hash, expires_at, ip, user_agent, mfa_pending)
  values (p_user, p_token_hash,
          case when p_mfa_pending then now() + interval '10 minutes'
               else now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 24)) end,
          p_ip, left(p_user_agent, 300), p_mfa_pending)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function app.auth_create_session(uuid, text, int, text, text, boolean) to erp_app;

drop function app.auth_resolve_session(text);
create function app.auth_resolve_session(p_token_hash text)
returns table (session_id uuid, user_id uuid, must_change_password boolean, mfa_pending boolean, mfa_enabled boolean)
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
  return query select v_s.id, v_s.user_id, c.must_change_password, v_s.mfa_pending,
                      exists (select 1 from auth_private.mfa m where m.user_id = v_s.user_id and m.enabled_at is not null)
                 from auth_private.credentials c where c.user_id = v_s.user_id;
end $$;
grant execute on function app.auth_resolve_session(text) to erp_app;

create or replace function app.auth_mfa_enabled(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from auth_private.mfa where user_id = p_user and enabled_at is not null)
$$;

-- During sign-in: the encrypted secret for a session that is waiting for its code.
create or replace function app.auth_mfa_challenge(p_token_hash text)
returns table (user_id uuid, secret_encrypted text, last_used_step bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.user_id, m.secret_encrypted, m.last_used_step
    from auth_private.sessions s join auth_private.mfa m on m.user_id = s.user_id and m.enabled_at is not null
   where s.token_hash = p_token_hash and s.mfa_pending and s.revoked_at is null and s.expires_at > now()
$$;

create or replace function app.auth_mfa_complete(p_token_hash text, p_step bigint, p_ttl_hours int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  update auth_private.mfa m set last_used_step = p_step
    from auth_private.sessions s
   where s.token_hash = p_token_hash and s.mfa_pending and s.revoked_at is null and s.expires_at > now()
     and m.user_id = s.user_id and m.last_used_step < p_step
  returning m.user_id into v_user;
  if v_user is null then return false; end if;
  update auth_private.sessions set mfa_pending = false, mfa_failures = 0,
         expires_at = now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 24))
   where token_hash = p_token_hash;
  perform app.audit('mfa_verified', 'session', null, null, null, null, null, 'success', '{}', v_user);
  return true;
end $$;

create or replace function app.auth_mfa_use_recovery(p_token_hash text, p_code_hash text, p_ttl_hours int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_code bigint;
begin
  select s.user_id into v_user from auth_private.sessions s
   where s.token_hash = p_token_hash and s.mfa_pending and s.revoked_at is null and s.expires_at > now();
  if v_user is null then return false; end if;
  select id into v_code from auth_private.mfa_recovery_codes
   where user_id = v_user and code_hash = p_code_hash and used_at is null for update;
  if v_code is null then return false; end if;
  update auth_private.mfa_recovery_codes set used_at = now() where id = v_code;
  update auth_private.sessions set mfa_pending = false, mfa_failures = 0,
         expires_at = now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 24))
   where token_hash = p_token_hash;
  perform app.audit('mfa_recovery_code_used', 'session', null, null, null, null, null, 'success', '{}', v_user);
  return true;
end $$;

-- Wrong code: count; after 5 failures the pending sign-in is cancelled.
create or replace function app.auth_mfa_failed(p_token_hash text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_fail int;
begin
  update auth_private.sessions set mfa_failures = mfa_failures + 1,
         revoked_at = case when mfa_failures + 1 >= 5 then now() else revoked_at end
   where token_hash = p_token_hash and mfa_pending and revoked_at is null
  returning user_id, mfa_failures into v_user, v_fail;
  if v_user is not null then
    perform app.audit('mfa_failed', 'session', null, null, null, null, null, 'denied',
                      jsonb_build_object('attempt', v_fail), v_user);
  end if;
  return coalesce(v_fail, 5);
end $$;

-- Enrolment by the signed-in user ------------------------------------------------
create or replace function app.mfa_start_enrolment(p_secret_encrypted text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if app.auth_mfa_enabled(app.current_user_id()) then
    raise exception 'two-factor login is already enabled' using errcode = '23514';
  end if;
  insert into auth_private.mfa (user_id, secret_encrypted) values (app.current_user_id(), p_secret_encrypted)
  on conflict (user_id) do update set secret_encrypted = excluded.secret_encrypted, enabled_at = null, last_used_step = 0, created_at = now();
end $$;

create or replace function app.mfa_pending_secret() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select secret_encrypted from auth_private.mfa where user_id = app.current_user_id() and enabled_at is null
$$;

create or replace function app.mfa_finish_enrolment(p_step bigint, p_recovery_hashes text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update auth_private.mfa set enabled_at = now(), last_used_step = p_step
   where user_id = app.current_user_id() and enabled_at is null;
  if not found then raise exception 'no enrolment in progress' using errcode = '23514'; end if;
  delete from auth_private.mfa_recovery_codes where user_id = app.current_user_id();
  insert into auth_private.mfa_recovery_codes (user_id, code_hash)
  select app.current_user_id(), h from unnest(p_recovery_hashes) h;
  perform app.audit('mfa_enabled', 'user_profiles', app.current_user_id()::text);
end $$;

create or replace function app.mfa_my_status() returns table (enabled boolean, enabled_at timestamptz, recovery_codes_left int)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(m.enabled_at is not null, false), m.enabled_at,
         (select count(*)::int from auth_private.mfa_recovery_codes r where r.user_id = app.current_user_id() and r.used_at is null)
    from (select app.current_user_id() as uid) x left join auth_private.mfa m on m.user_id = x.uid
$$;

-- Administrator resets someone's 2FA (lost phone). Same no-escalation rule.
create or replace function app.mfa_admin_reset(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_administer_user(p_user) then
    raise exception 'permission denied: you can only reset accounts whose access is within your own' using errcode = '42501';
  end if;
  delete from auth_private.mfa where user_id = p_user;
  delete from auth_private.mfa_recovery_codes where user_id = p_user;
  update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  perform app.audit('mfa_reset_by_admin', 'user_profiles', p_user::text);
end $$;

-- 2FA status of manageable staff (for the Staff page)
create or replace function app.mfa_status_of_staff() returns table (user_id uuid, enabled boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, exists (select 1 from auth_private.mfa m where m.user_id = u.id and m.enabled_at is not null)
    from user_profiles u where app.shares_org_with(u.id)
$$;

grant execute on function
  app.holds_all_perms_of_role(uuid), app.can_assign_role(uuid), app.can_administer_user(uuid),
  app.auth_mfa_enabled(uuid), app.auth_mfa_challenge(text), app.auth_mfa_complete(text, bigint, int),
  app.auth_mfa_use_recovery(text, text, int), app.auth_mfa_failed(text), app.mfa_start_enrolment(text),
  app.mfa_pending_secret(), app.mfa_finish_enrolment(bigint, text[]), app.mfa_my_status(), app.mfa_admin_reset(uuid),
  app.mfa_status_of_staff()
to erp_app;
