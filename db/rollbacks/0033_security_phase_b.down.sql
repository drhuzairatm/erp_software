-- Undo 0033 (security Phase B). WARNING: removes scan status / manual clearance data, security alerts and the
-- new permissions; restores the original download, portal download and 2FA reset functions. Back up first.
drop function app.mfa_admin_reset(uuid, text);
drop function app.active_sessions(uuid);
drop function app.login_history(uuid, int);
drop function app.can_see_login_history(uuid);
drop function app.mark_alerts_emailed(uuid[]);
drop function app.security_alerts_to_email();
drop function app.role_has_perm(uuid, text);
drop function app.acknowledge_security_alert(uuid, text);
drop trigger audit_logs_security_alerts on audit_logs;
drop function app.audit_security_alerts();
drop function app.raise_security_alert(text, text, text, text, jsonb, uuid, uuid);
drop table security_alerts;
drop trigger original_shipment_items_scan_gate on original_shipment_items;
drop function app.courier_scan_gate();
drop trigger student_documents_scan_gate on student_documents;
drop function app.document_scan_gate();
drop function app.clear_file_manually(uuid, text);
drop function app.files_to_rescan(int);
drop function app.record_file_scan(text, text, text, text);
alter table document_files drop column scan_status, drop column scan_engine, drop column scan_detail, drop column scanned_at,
  drop column cleared_by, drop column cleared_at, drop column clearance_reason;
delete from role_permissions where permission_key in ('documents.security_clear', 'security.alerts', 'users.mfa_reset');
delete from permissions where key in ('documents.security_clear', 'security.alerts', 'users.mfa_reset');

-- original functions
create or replace function app.authorize_file_download(p_file uuid) returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_file document_files%rowtype; v_doc student_documents%rowtype; v_org uuid;
begin
  select * into v_file from document_files where id = p_file;
  if found then select * into v_doc from student_documents where id = v_file.student_document_id; end if;
  if v_file.id is null or not app.can_read_student(v_doc.student_id) or not app.can_on_student(v_doc.student_id, 'documents.download') then
    perform app.audit('file_download', 'document_files', p_file::text, null, v_doc.student_id, null, null, 'denied');
    return;
  end if;
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.audit('file_download', 'document_files', p_file::text, v_org, v_doc.student_id, null,
                    jsonb_build_object('version', v_file.version, 'document_id', v_doc.id));
  return query select v_file.storage_key, v_file.mime_type, v_file.original_filename;
end $$;

create or replace function app.portal_download(p_token_hash text, p_publication uuid, p_ip text)
returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p portal_publications%rowtype; v_student uuid := app.portal_student(p_token_hash);
begin
  select * into v_p from portal_publications where id = p_publication;
  if v_student is null or not found or v_p.student_id <> v_student or v_p.unpublished_at is not null then
    perform app.audit('portal_download', 'portal_publications', p_publication::text, null, v_student, null, null, 'denied', jsonb_build_object('ip', p_ip));
    return;
  end if;
  insert into portal_downloads (publication_id, ip) values (p_publication, p_ip);
  perform app.audit('portal_download', 'portal_publications', p_publication::text, null, v_student, null, null, 'success', jsonb_build_object('ip', p_ip));
  return query select f.storage_key, f.mime_type, f.original_filename from document_files f where f.id = v_p.file_id;
end $$;

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
grant execute on function app.mfa_admin_reset(uuid) to erp_app;
