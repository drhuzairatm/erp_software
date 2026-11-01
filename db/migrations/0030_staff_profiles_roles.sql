-- =============================================================================
-- 0030 Staff profile photos, employee IDs, reporting managers, role status and
--      role hierarchy (Nov 2026)
--
-- * Staff photo: one current photo per person (original without metadata, square
--   display version, 256 thumbnail) in private storage. Set/removed by an
--   administrator who may administer the person (existing rule), or by the person.
--   Visible to signed-in colleagues who share a company.
-- * employee_id: generated EMP-00001…, existing staff numbered in creation order.
-- * reports_to: individual reporting manager (no cycles; set by an administrator).
-- * roles.is_active / parent_role_id: role status and organisation chart. A parent
--   role grants NOTHING – permissions still come only from the assigned role.
--   Inactive roles cannot be newly assigned; a role cannot be deactivated while
--   people still hold it. The protected MD role cannot be changed.
-- =============================================================================

create sequence employee_id_seq;
alter table user_profiles add column employee_id text unique, add column reports_to uuid references user_profiles(id);
alter table user_profiles disable trigger user_profiles_audit;
update user_profiles u set employee_id = 'EMP-' || lpad(n::text, 5, '0')
  from (select id, row_number() over (order by created_at, email) as n from user_profiles) x where x.id = u.id;
alter table user_profiles enable trigger user_profiles_audit;
select setval('employee_id_seq', greatest((select count(*) from user_profiles), 1));
alter table user_profiles alter column employee_id set default 'EMP-' || lpad(nextval('employee_id_seq')::text, 5, '0');
alter table user_profiles alter column employee_id set not null;
alter table user_profiles add constraint user_profiles_not_own_manager check (reports_to is null or reports_to <> id);
grant usage on sequence employee_id_seq to erp_app;

alter table roles add column is_active boolean not null default true, add column parent_role_id uuid references roles(id);
alter table roles add constraint roles_not_own_parent check (parent_role_id is null or parent_role_id <> id);

-- Inactive roles cannot be newly assigned
create or replace function app.guard_inactive_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' or new.role_id is distinct from old.role_id)
     and not (select is_active from roles where id = new.role_id) then
    raise exception 'this role is inactive and cannot be assigned' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger memberships_inactive_role before insert or update of role_id on organization_memberships
  for each row execute function app.guard_inactive_role();

create or replace function app.set_role_structure(p_role uuid, p_active boolean, p_parent uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r roles%rowtype; v_cur uuid; v_depth int := 0;
begin
  select * into v_r from roles where id = p_role for update;
  if not found or not app.has_perm(v_r.org_id, 'roles.manage') then raise exception 'permission denied: roles.manage' using errcode = '42501'; end if;
  if v_r.is_protected then raise exception 'the Managing Director role cannot be changed' using errcode = '42501'; end if;
  if app.holds_role(p_role) then raise exception 'you cannot change a role you hold' using errcode = '42501'; end if;
  if not p_active and exists (select 1 from organization_memberships where role_id = p_role and is_active) then
    raise exception 'people still hold this role; move them to another role first' using errcode = '23514';
  end if;
  if p_parent is not null then
    if not exists (select 1 from roles where id = p_parent and org_id = v_r.org_id) then raise exception 'the reporting role must belong to the same company' using errcode = '23514'; end if;
    v_cur := p_parent;
    while v_cur is not null and v_depth < 50 loop
      if v_cur = p_role then raise exception 'this would create a loop in the role structure' using errcode = '23514'; end if;
      select parent_role_id into v_cur from roles where id = v_cur; v_depth := v_depth + 1;
    end loop;
  end if;
  update roles set is_active = p_active, parent_role_id = p_parent where id = p_role;
end $$;

create or replace function app.set_reporting_manager(p_user uuid, p_manager uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur uuid; v_depth int := 0;
begin
  if not app.can_administer_user(p_user) then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_manager is not null then
    if not exists (select 1 from organization_memberships a join organization_memberships b on b.org_id = a.org_id
                    where a.user_id = p_user and b.user_id = p_manager and b.is_active) then
      raise exception 'the reporting manager must work in one of the same companies' using errcode = '23514';
    end if;
    v_cur := p_manager;
    while v_cur is not null and v_depth < 50 loop
      if v_cur = p_user then raise exception 'this would create a reporting loop' using errcode = '23514'; end if;
      select reports_to into v_cur from user_profiles where id = v_cur; v_depth := v_depth + 1;
    end loop;
  end if;
  update user_profiles set reports_to = p_manager where id = p_user;
end $$;

-- Photos
create table staff_photos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_profiles(id),
  version       int not null,
  original_key  text not null,
  original_mime text not null check (original_mime in ('image/jpeg', 'image/png')),
  display_key   text not null,
  thumb_key     text not null,
  is_current    boolean not null default true,
  uploaded_by   uuid not null references user_profiles(id),
  uploaded_at   timestamptz not null default now(),
  ended_at      timestamptz,
  ended_by      uuid references user_profiles(id),
  end_reason    text check (end_reason in ('replaced', 'removed')),
  unique (user_id, version)
);
create unique index staff_photos_current on staff_photos (user_id) where is_current;
create trigger staff_photos_audit after insert or update on staff_photos
  for each row execute function app.audit_row('', '', 'original_key', 'display_key', 'thumb_key');
create trigger staff_photos_guard before update or delete on staff_photos for each row execute function app.guard_student_photos();

create or replace function app.can_change_staff_photo(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user = app.current_user_id() or app.can_administer_user(p_user)
$$;

create or replace function app.set_staff_photo(p_user uuid, p_original text, p_mime text, p_display text, p_thumb text) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old staff_photos%rowtype; v_version int;
begin
  if not app.can_change_staff_photo(p_user) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into v_old from staff_photos where user_id = p_user and is_current for update;
  select coalesce(max(version), 0) + 1 into v_version from staff_photos where user_id = p_user;
  perform set_config('app.photo_change', 'on', true);
  if v_old.id is not null then
    update staff_photos set is_current = false, ended_at = now(), ended_by = app.current_user_id(), end_reason = 'replaced' where id = v_old.id;
  end if;
  insert into staff_photos (user_id, version, original_key, original_mime, display_key, thumb_key, uploaded_by)
  values (p_user, v_version, p_original, p_mime, p_display, p_thumb, app.current_user_id());
  perform set_config('app.photo_change', 'off', true);
  return case when v_old.id is null then '{}'::text[] else array[v_old.original_key, v_old.display_key, v_old.thumb_key] end;
end $$;

create or replace function app.remove_staff_photo(p_user uuid) returns text[]
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old staff_photos%rowtype;
begin
  if not app.can_change_staff_photo(p_user) then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into v_old from staff_photos where user_id = p_user and is_current for update;
  if not found then raise exception 'there is no photo to remove' using errcode = '23514'; end if;
  perform set_config('app.photo_change', 'on', true);
  update staff_photos set is_current = false, ended_at = now(), ended_by = app.current_user_id(), end_reason = 'removed' where id = v_old.id;
  perform set_config('app.photo_change', 'off', true);
  return array[v_old.original_key, v_old.display_key, v_old.thumb_key];
end $$;

create or replace function app.staff_photo_file(p_user uuid, p_variant text) returns table (storage_key text, version int)
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_variant when 'thumb' then p.thumb_key else p.display_key end, p.version
    from staff_photos p where p.user_id = p_user and p.is_current and app.current_user_id() is not null and app.shares_org_with(p_user)
     and p_variant in ('thumb', 'display')
$$;

alter table staff_photos enable row level security;
create policy staff_photos_select on staff_photos for select to erp_app using (app.shares_org_with(user_id));
grant select (id, user_id, version, is_current, uploaded_by, uploaded_at, ended_at, ended_by, end_reason) on staff_photos to erp_app;
grant execute on function app.set_role_structure(uuid, boolean, uuid), app.set_reporting_manager(uuid, uuid), app.can_change_staff_photo(uuid),
  app.set_staff_photo(uuid, text, text, text, text), app.remove_staff_photo(uuid), app.staff_photo_file(uuid, text) to erp_app;
