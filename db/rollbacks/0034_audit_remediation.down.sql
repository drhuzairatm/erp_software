-- Undo 0034 (audit remediation H-1/M-2): restores the 0004 viewer function (WITHOUT the quarantine check) and the
-- 0033 alert function. WARNING: rolling back re-opens finding H-1. Back up first.
drop index if exists audit_logs_portal_download_idx;

create or replace function app.authorize_file_access(p_file uuid) returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_file document_files%rowtype;
  v_doc student_documents%rowtype;
  v_org uuid;
begin
  select * into v_file from document_files where id = p_file;
  if found then select * into v_doc from student_documents where id = v_file.student_document_id; end if;
  if v_file.id is null or not app.can_read_student(v_doc.student_id)
     or not app.can_on_student(v_doc.student_id, 'documents.file.view') then
    perform app.audit('file_access', 'document_files', p_file::text, null, v_doc.student_id, null, null, 'denied');
    return;
  end if;
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.audit('file_access', 'document_files', p_file::text, v_org, v_doc.student_id, null,
                    jsonb_build_object('version', v_file.version, 'document_id', v_doc.id));
  return query select v_file.storage_key, v_file.mime_type, v_file.original_filename;
end $$;

create or replace function app.audit_security_alerts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; v_email text; v_sens boolean; v_name text;
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
  elsif new.action = 'file_download' and new.outcome = 'success' and new.actor_user_id is not null then
    select count(*) into n from audit_logs where action = 'file_download' and outcome = 'success' and actor_user_id = new.actor_user_id and occurred_at > now() - interval '1 hour';
    if n >= 100 then
      perform app.raise_security_alert('bulk_downloads', 'high', 'Unusually many document downloads by one person', 'user:' || new.actor_user_id,
        jsonb_build_object('downloads_last_hour', n), new.actor_user_id, new.org_id);
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
end $$;
