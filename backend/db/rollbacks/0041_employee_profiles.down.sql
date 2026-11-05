-- Undo 0041. WARNING: the new profile fields and designations are lost, and archived accounts become terminated. Back up first.
drop function if exists app.staff_profile_history(uuid, int);
drop function if exists app.update_my_profile(jsonb);
drop function if exists app.set_staff_designation(uuid, uuid, uuid);
drop trigger if exists user_profiles_display_name on user_profiles;
drop function if exists app.user_profiles_display_name();
alter table organization_memberships drop column designation_id;
drop table if exists designations;
update user_profiles set account_status = 'terminated' where account_status = 'archived';
alter table user_profiles drop constraint user_profiles_account_status_check;
alter table user_profiles add constraint user_profiles_account_status_check check (account_status in ('invited', 'active', 'suspended', 'terminated'));
alter table user_profiles drop column first_name, drop column middle_name, drop column last_name, drop column display_name, drop column secondary_phone,
  drop column additional_phone, drop column address_line, drop column city, drop column state_region, drop column postal_code, drop column address_country;
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
