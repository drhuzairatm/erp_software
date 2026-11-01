-- Undo 0035 (N-1 authentication rate limits). WARNING: rolling back re-opens finding N-1 (password-reset requests
-- count as failed sign-ins again, no per-email reset cap, sign-in check/record race, sticky portal re-lock).
-- Trusted-browser cookies become meaningless (ignored). Authentication working data in the new tables/columns is lost;
-- audit entries are kept. Back up first.
-- The three replaced functions are restored EXACTLY as they were before 0035 (definitions exported from the database
-- with pg_get_functiondef; execute permissions are unchanged by CREATE OR REPLACE).

drop trigger if exists credentials_revoke_trusted on auth_private.credentials;
drop trigger if exists mfa_revoke_trusted on auth_private.mfa;
drop trigger if exists user_profiles_revoke_trusted on user_profiles;
drop trigger if exists student_accounts_revoke_trusted on auth_private.student_accounts;
drop trigger if exists password_resets_supersede on auth_private.password_resets;

drop function if exists app.revoke_trusted_on_credentials();
drop function if exists app.revoke_trusted_on_mfa();
drop function if exists app.revoke_trusted_on_status();
drop function if exists app.revoke_trusted_on_portal_account();
drop function if exists app.password_reset_supersede();
drop function if exists app.auth_begin_attempt(text, text, text);
drop function if exists app.auth_finish_attempt(bigint, boolean, text, int, text, text);
drop function if exists app.auth_trust_device_after_mfa(text, text, text);
drop function if exists app.auth_request_reset_limited(text, text, text, text);
drop function if exists app.auth_complete_reset_trusted(text, text, text);
drop function if exists app.staff_email_claim(int);
drop function if exists app.staff_email_finish(uuid, text, text);
drop function if exists app.auth_housekeeping();
drop function if exists app.portal_password_begin(text, text);
drop function if exists app.portal_password_finish(text, uuid[], uuid[], text, text, text, text, text);
drop function if exists app.portal_set_password_trusted(text, text, text);
drop function if exists app.trusted_device_add(text, uuid, uuid, text);
drop function if exists app.staff_device_valid(text, uuid);
drop function if exists app.portal_device_valid(text, uuid);

drop table if exists auth_private.staff_email_outbox;
drop table if exists auth_private.password_reset_requests;
drop table if exists auth_private.trusted_devices;

drop index if exists auth_private.login_attempts_time_idx;
drop index if exists auth_private.login_attempts_device_idx;
alter table auth_private.login_attempts drop column if exists device_id, drop column if exists refused, drop column if exists source;

-- ---------------------------------------------------------------------------
-- Restore app.revoke_user_sessions (as defined by 0032)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.revoke_user_sessions(p_user uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

-- ---------------------------------------------------------------------------
-- Restore app.portal_password_result (as defined by 0025)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.portal_password_result(p_identifier text, p_ok uuid[], p_failed uuid[], p_token_hash text, p_ip text, p_user_agent text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_students uuid[];
begin
  update auth_private.student_accounts set failed_attempts = failed_attempts + 1,
         locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
   where id = any(coalesce(p_failed, '{}')) and status = 'active';
  if coalesce(cardinality(p_ok), 0) = 0 then
    perform app.audit('portal_login_failed', 'portal', null, null, null, null, null, 'denied',
                      jsonb_build_object('ip', p_ip, 'method', 'password', 'identifier', left(lower(btrim(p_identifier)), 3) || '…'));
    return false;
  end if;
  update auth_private.student_accounts set failed_attempts = 0, locked_until = null, last_login_at = now()
   where id = any(p_ok) and status = 'active' and coalesce(locked_until, '-infinity') <= now();
  select array_agg(student_id) into v_students from auth_private.student_accounts where id = any(p_ok) and status = 'active';
  if coalesce(cardinality(v_students), 0) = 0 then return false; end if;
  insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id, ip, user_agent)
  values (p_token_hash, v_students, case when cardinality(v_students) = 1 then v_students[1] end, p_ip, left(p_user_agent, 300));
  perform app.audit('portal_login', 'portal', null, null, v_students[1], null, null, 'success', jsonb_build_object('ip', p_ip, 'method', 'password'));
  return true;
end $function$
;

-- ---------------------------------------------------------------------------
-- Restore app.audit_security_alerts (as defined by 0034)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.audit_security_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int; v_email text; v_sens boolean; v_name text; v_views int; v_downloads int;
begin
  if new.action = 'login_failed' then
    v_email := new.metadata ->> 'email';
    select count(*) into n from auth_private.login_attempts where lower(email) = v_email and not success and attempted_at > now() - interval '15 minutes';
    if n >= 5 then
      perform app.raise_security_alert('repeated_failed_logins', case when n >= 10 then 'high' else 'warning' end,
        'Repeated failed sign-ins for ' || v_email, 'email:' || v_email, jsonb_build_object('email', v_email, 'failures_15_min', n, 'ip', new.request_ip), null, null);
    end if;
    if new.request_ip is not null then
      select count(*) into n from auth_private.login_attempts where ip = new.request_ip and not success and attempted_at > now() - interval '15 minutes';
      if n >= 20 then
        perform app.raise_security_alert('failed_logins_from_ip', 'high', 'Many failed sign-ins from one address', 'ip:' || new.request_ip,
          jsonb_build_object('ip', new.request_ip, 'failures_15_min', n), null, null);
      end if;
    end if;
  elsif new.action = 'mfa_failed' then
    perform app.raise_security_alert('mfa_failures', 'warning', 'Wrong two-factor codes entered', 'user:' || coalesce(new.actor_user_id::text, '?'),
      jsonb_build_object('ip', new.request_ip), new.actor_user_id, null);
  elsif new.action = 'export' then
    if new.outcome = 'denied' then
      perform app.raise_security_alert('export_denied', 'warning', 'Export refused (no permission)', 'user:' || coalesce(new.actor_user_id::text, '?'),
        jsonb_build_object('report', new.entity_id), new.actor_user_id, new.org_id);
    else
      if coalesce((new.metadata ->> 'rows')::int, 0) >= 500 then
        perform app.raise_security_alert('large_export', 'high', 'Large data export (' || (new.metadata ->> 'rows') || ' rows)', 'user:' || coalesce(new.actor_user_id::text, '?'),
          jsonb_build_object('report', new.entity_id, 'rows', (new.metadata ->> 'rows')::int, 'pii', new.metadata -> 'pii', 'finance', new.metadata -> 'finance'), new.actor_user_id, new.org_id);
      end if;
      select count(*) into n from audit_logs where action = 'export' and outcome = 'success' and actor_user_id = new.actor_user_id and occurred_at > now() - interval '1 hour';
      if n >= 10 then
        perform app.raise_security_alert('frequent_exports', 'warning', 'Unusually many exports by one person', 'user:' || coalesce(new.actor_user_id::text, '?'),
          jsonb_build_object('exports_last_hour', n), new.actor_user_id, new.org_id);
      end if;
    end if;
  elsif new.action in ('file_download', 'file_access') and new.outcome = 'success' and new.actor_user_id is not null then
    -- staff: in-app VIEWS and DOWNLOADS of document files both count (one audit row per access, so nothing is counted twice)
    select count(*) filter (where action = 'file_access'), count(*) filter (where action = 'file_download') into v_views, v_downloads
      from audit_logs where action in ('file_download', 'file_access') and outcome = 'success' and actor_user_id = new.actor_user_id
       and occurred_at > now() - interval '1 hour';
    if v_views + v_downloads >= 100 then
      perform app.raise_security_alert('bulk_downloads', 'high', 'Unusually many document views or downloads by one person', 'user:' || new.actor_user_id,
        jsonb_build_object('views_last_hour', v_views, 'downloads_last_hour', v_downloads, 'total_last_hour', v_views + v_downloads), new.actor_user_id, new.org_id);
    end if;
  elsif new.action = 'portal_download' and new.outcome = 'success' and new.student_id is not null then
    -- student/parent portal: downloads through one student's portal access (no staff actor)
    select count(*) into n from audit_logs where action = 'portal_download' and outcome = 'success' and student_id = new.student_id
       and occurred_at > now() - interval '1 hour';
    if n >= 100 then
      perform app.raise_security_alert('bulk_portal_downloads', 'high', 'Unusually many document downloads through one student portal account', 'portal-student:' || new.student_id,
        jsonb_build_object('portal_downloads_last_hour', n, 'student_id', new.student_id), null, new.org_id);
    end if;
  elsif new.action = 'malware_detected' then
    perform app.raise_security_alert('malware_detected', 'critical', 'Malware detected in an uploaded file (quarantined)', 'file:' || coalesce(new.entity_id, '?'),
      jsonb_build_object('entity', new.entity_type, 'id', new.entity_id, 'detail', new.after_data -> 'detail', 'student_id', new.student_id), new.actor_user_id, new.org_id);
  elsif new.action = 'file_manual_security_clearance' then
    perform app.raise_security_alert('manual_clearance', 'info', 'Files released by MANUAL security clearance (not virus-scanned)', 'clearer:' || coalesce(new.actor_user_id::text, '?'),
      jsonb_build_object('last_file', new.entity_id, 'reason', new.after_data -> 'reason', 'student_id', new.student_id), new.actor_user_id, new.org_id);
  elsif new.entity_type = 'role_permissions' and new.action in ('grant', 'revoke') then
    v_name := new.after_data ->> 'permission';
    select is_sensitive into v_sens from permissions where key = v_name;
    perform app.raise_security_alert('permission_change', case when v_sens then 'high' else 'warning' end,
      'Role permission ' || case when new.action = 'grant' then 'granted' else 'removed' end || ': ' || coalesce(v_name, '?'),
      'role:' || coalesce(new.entity_id, '?'),
      jsonb_build_object('permission', v_name, 'change', new.action, 'role_id', new.entity_id), new.actor_user_id, new.org_id);
  elsif new.entity_type = 'organization_memberships' and (new.action = 'insert'
        or (new.action = 'update' and (new.before_data ->> 'role_id' is distinct from new.after_data ->> 'role_id'
                                       or new.before_data ->> 'is_active' is distinct from new.after_data ->> 'is_active'))) then
    perform app.raise_security_alert('role_assignment', 'warning', 'Staff role or company access changed', 'user:' || coalesce(new.after_data ->> 'user_id', '?'),
      jsonb_build_object('user_id', new.after_data ->> 'user_id', 'from_role', new.before_data ->> 'role_id', 'to_role', new.after_data ->> 'role_id',
                         'active', new.after_data ->> 'is_active'), new.actor_user_id, new.org_id);
  elsif new.action = 'md_role_granted' then
    perform app.raise_security_alert('md_role_granted', 'critical', 'MD (super-admin) role granted', 'user:' || new.entity_id,
      new.metadata, new.actor_user_id, new.org_id);
  elsif new.action = 'mfa_reset_by_admin' then
    perform app.raise_security_alert('mfa_reset', 'high', 'Two-factor login reset by an administrator', 'user:' || new.entity_id,
      jsonb_build_object('reason', new.metadata ->> 'reason'), new.actor_user_id, null);
  elsif new.action = 'staff_status_changed' then
    perform app.raise_security_alert('staff_status_changed', 'info', 'Staff account ' || coalesce(new.after_data ->> 'account_status', 'changed'), 'user:' || new.entity_id,
      new.after_data, new.actor_user_id, null);
  end if;
  return null;
end $function$
;
