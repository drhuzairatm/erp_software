-- Undo 0032 (staff account security). WARNING: removes invitations, account states, phone/joining date and
-- status history columns. Suspended/terminated people stay deactivated (is_active is kept). Back up first (npm run db:backup).
drop trigger memberships_guard_protected on organization_memberships;
drop function app.guard_protected_role();
drop function app.staff_invitations_overview();
drop function app.auth_accept_invitation(text, text);
drop function app.auth_invitation_info(text);
drop function app.cancel_staff_invitation(uuid);
drop function app.issue_staff_invitation(uuid, text, int);
drop table auth_private.staff_invitations;
drop function app.revoke_user_sessions(uuid);
drop function app.set_staff_status(uuid, text, text);
drop trigger user_profiles_status_sync on user_profiles;
drop function app.user_status_sync();
revoke insert (phone, joining_date) on user_profiles from erp_app;
revoke update (phone, joining_date) on user_profiles from erp_app;
alter table user_profiles disable trigger user_profiles_audit;
alter table user_profiles drop column account_status, drop column phone, drop column joining_date, drop column email_verified_at,
  drop column status_reason, drop column status_changed_at, drop column status_changed_by;
alter table user_profiles enable trigger user_profiles_audit;

-- original functions from 0001
create or replace function app.auth_login_lookup(p_email text)
returns table (user_id uuid, password_hash text, must_change_password boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, c.password_hash, c.must_change_password
    from user_profiles u join auth_private.credentials c on c.user_id = u.id
   where lower(u.email) = lower(btrim(p_email)) and u.is_active
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
