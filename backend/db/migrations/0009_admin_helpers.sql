-- =============================================================================
-- 0009 Administration helpers
-- =============================================================================

-- Lets an administrator add an EXISTING staff account (e.g. someone already in
-- the other company) to their own company. Only users.manage holders get an
-- answer, and only the id/name is returned.
create or replace function app.find_user_by_email(p_email text) returns table (id uuid, full_name text, is_active boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('users.manage')) then
    raise exception 'permission denied: users.manage' using errcode = '42501';
  end if;
  return query select u.id, u.full_name, u.is_active from user_profiles u where lower(u.email) = lower(btrim(p_email));
end $$;

grant execute on function app.find_user_by_email(text) to erp_app;

-- Last sign-in per user, for the staff list (users.manage holders only).
create or replace function app.last_logins() returns table (user_id uuid, last_login timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.user_id, max(s.created_at) from auth_private.sessions s
   where app.can_manage_user(s.user_id) group by s.user_id
$$;
grant execute on function app.last_logins() to erp_app;
