-- Phase 2: employee profile completion. Additive: new optional columns, a designations list, an "archived" account status and self-service
-- profile editing. Roles and permissions are untouched. Designation (a job title) and system role (a set of permissions) stay separate.

alter table user_profiles
  add column first_name       text check (first_name is null or length(btrim(first_name)) between 1 and 60),
  add column middle_name      text check (middle_name is null or length(btrim(middle_name)) between 1 and 60),
  add column last_name        text check (last_name is null or length(btrim(last_name)) between 1 and 60),
  add column display_name     text check (display_name is null or length(btrim(display_name)) between 2 and 120),
  add column secondary_phone  text check (secondary_phone is null or length(btrim(secondary_phone)) between 5 and 30),
  add column additional_phone text check (additional_phone is null or length(btrim(additional_phone)) between 5 and 30),
  add column address_line     text check (address_line is null or length(btrim(address_line)) between 3 and 300),
  add column city             text check (city is null or length(btrim(city)) between 1 and 100),
  add column state_region     text check (state_region is null or length(btrim(state_region)) between 1 and 100),
  add column postal_code      text check (postal_code is null or length(btrim(postal_code)) between 2 and 20),
  add column address_country  text check (address_country is null or length(btrim(address_country)) between 2 and 100);
grant update (first_name, middle_name, last_name, display_name, secondary_phone, additional_phone, address_line, city, state_region, postal_code, address_country)
  on user_profiles to erp_app;

alter table user_profiles drop constraint user_profiles_account_status_check;
alter table user_profiles add constraint user_profiles_account_status_check check (account_status in ('invited', 'active', 'suspended', 'terminated', 'archived'));

-- A display name is the name shown across the ERP. It changes no role or permission.
create or replace function app.user_profiles_display_name() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.display_name is not null and new.display_name is distinct from old.display_name then new.full_name := btrim(new.display_name); end if;
  return new;
end $$;
create trigger user_profiles_display_name before update of display_name on user_profiles
  for each row execute function app.user_profiles_display_name();

-- ---------------------------------------------------------------------------
-- Designations, one list per company
-- ---------------------------------------------------------------------------
create table designations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id),
  name       text not null check (length(btrim(name)) between 2 and 120),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index designations_org_name on designations (org_id, lower(name));
alter table designations enable row level security;
create policy designations_select on designations for select to erp_app using (app.is_member(org_id));
create policy designations_insert on designations for insert to erp_app with check (app.has_perm(org_id, 'departments.manage'));
create policy designations_update on designations for update to erp_app using (app.has_perm(org_id, 'departments.manage')) with check (app.has_perm(org_id, 'departments.manage'));
grant select, insert, update on designations to erp_app;
create trigger designations_audit after insert or update on designations for each row execute function app.audit_row('org_id', '');

insert into designations (org_id, name)
  select o.id, d.name from organizations o
  cross join (values ('Managing Director'), ('Chief Executive Officer'), ('Company Manager'), ('Executive Assistant'), ('Counsellor'), ('Documentation Officer'),
                     ('Finance Officer'), ('Visa Officer'), ('System Administrator')) as d(name);

alter table organization_memberships add column designation_id uuid references designations(id);

-- Setting a designation keeps the existing job title in step for pages that already display it. The role is not touched.
create or replace function app.set_staff_designation(p_user uuid, p_org uuid, p_designation uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if not (app.has_perm(p_org, 'users.manage') and app.can_administer_user(p_user)) then raise exception 'permission denied: this account is outside your authority' using errcode = '42501'; end if;
  if p_designation is not null then
    select name into v_name from designations d where d.id = p_designation and d.org_id = p_org and d.is_active;
    if v_name is null then raise exception 'Choose a designation of this company.' using errcode = '23514'; end if;
  end if;
  update organization_memberships set designation_id = p_designation where user_id = p_user and org_id = p_org;
  if not found then raise exception 'This person is not a member of that company.' using errcode = '23514'; end if;
  if v_name is not null then update user_profiles set job_title = v_name where id = p_user; end if;
  perform app.audit('staff_designation_changed', 'user_profiles', p_user::text, p_org, null, null, jsonb_build_object('designation', v_name));
end $$;

-- ---------------------------------------------------------------------------
-- Self-service: personal details only. Email, employee ID, designation, role and status stay with administrators.
-- ---------------------------------------------------------------------------
create or replace function app.update_my_profile(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if v_me is null then raise exception 'permission denied' using errcode = '42501'; end if;
  update user_profiles set first_name = p ->> 'first_name', middle_name = p ->> 'middle_name', last_name = p ->> 'last_name', display_name = p ->> 'display_name',
         phone = p ->> 'phone', secondary_phone = p ->> 'secondary_phone', additional_phone = p ->> 'additional_phone',
         address_line = p ->> 'address_line', city = p ->> 'city', state_region = p ->> 'state_region', postal_code = p ->> 'postal_code', address_country = p ->> 'address_country'
   where id = v_me;
  perform app.audit('profile_self_updated', 'user_profiles', v_me::text, null, null, null, null);
end $$;

-- Who changed what on a profile: the person, or someone who may administer them. Field values are not returned, only the field names.
create or replace function app.staff_profile_history(p_user uuid, p_limit int) returns table (occurred_at timestamptz, action text, actor text, fields text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (p_user = app.current_user_id() or app.can_administer_user(p_user)) then raise exception 'permission denied: profile history' using errcode = '42501'; end if;
  return query
    select l.occurred_at, l.action, u.full_name,
           (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(coalesce(l.after_data, '{}'::jsonb)) k
             where k not in ('updated_at', 'id', 'created_at') and l.entity_type = 'user_profiles' and (l.after_data -> k) is distinct from (l.before_data -> k))
      from audit_logs l left join user_profiles u on u.id = l.actor_user_id
     where l.entity_type = 'user_profiles' and l.entity_id = p_user::text
     order by l.occurred_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100);
end $$;

-- ---------------------------------------------------------------------------
-- Account status: archive a person who has left. Same effect as terminated, hidden from the default staff list. No record is deleted.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_status(p_user uuid, p_status text, p_reason text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text; v_new text := p_status; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_status not in ('active', 'suspended', 'terminated', 'archived') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_user = app.current_user_id() then raise exception 'You cannot change your own account status.' using errcode = '42501'; end if;
  if not app.can_administer_user(p_user)
     or not exists (select 1 from organization_memberships m where m.user_id = p_user and app.has_perm(m.org_id, 'users.manage')) then
    raise exception 'permission denied: this account is outside your authority' using errcode = '42501';
  end if;
  select account_status into v_old from user_profiles where id = p_user for update;
  if v_old = p_status then return v_old; end if;
  if p_status in ('suspended', 'terminated', 'archived') and v_reason is null then
    raise exception 'Give a reason for this status change.' using errcode = '22023';
  end if;
  if p_status = 'archived' and v_old not in ('suspended', 'terminated') then
    raise exception 'Only a suspended or deactivated account can be archived.' using errcode = '23514';
  end if;
  if v_old = 'archived' and not exists (select 1 from app.orgs_with_perm('users.create_admin')) then
    raise exception 'permission denied: restoring an archived account needs a senior administrator' using errcode = '42501';
  end if;
  -- someone who never accepted the invitation returns to "invited", not "active"
  if p_status = 'active' and not exists (select 1 from auth_private.credentials c where c.user_id = p_user) then v_new := 'invited'; end if;
  update user_profiles set account_status = v_new, status_reason = case when v_new = 'active' or v_new = 'invited' then null else v_reason end where id = p_user;
  if v_new in ('suspended', 'terminated', 'archived') then
    update auth_private.staff_invitations set revoked_at = now() where user_id = p_user and accepted_at is null and revoked_at is null;
    update auth_private.password_resets set used_at = now() where user_id = p_user and used_at is null;
    update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  end if;
  perform app.audit('staff_status_changed', 'user_profiles', p_user::text, null, null,
    jsonb_build_object('account_status', v_old), jsonb_build_object('account_status', v_new, 'reason', v_reason));
  return v_new;
end $$;

revoke execute on function app.user_profiles_display_name(), app.set_staff_designation(uuid, uuid, uuid), app.update_my_profile(jsonb), app.staff_profile_history(uuid, int) from public;
grant execute on function app.set_staff_designation(uuid, uuid, uuid), app.update_my_profile(jsonb), app.staff_profile_history(uuid, int) to erp_app;
