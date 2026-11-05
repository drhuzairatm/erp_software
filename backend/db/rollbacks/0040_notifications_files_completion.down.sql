-- Undo 0040. WARNING: announcements, preferences, employee-document file records and manual clearances of secure files are lost; files return to "not scanned".
-- Bytes stay in storage. Back up first. The application must first return to a version that doesn't use these objects.
drop trigger if exists staff_announcements_audit on staff_announcements;
drop function if exists app.secure_file_upload_download_history(text, uuid);
drop function if exists app.clear_secure_file_manually(uuid, text);
drop function if exists app.publish_announcement(uuid, text, text, text);
drop function if exists app.withdraw_announcement(uuid);
drop function if exists app.set_my_notification_preference(text, boolean, boolean);
drop table if exists staff_announcements;
drop table if exists staff_notification_preferences;

delete from secure_files where context_type <> 'task';
update secure_files set scan_status = 'not_scanned' where scan_status = 'manually_cleared';
revoke select (cleared_at) on secure_files from erp_app;
alter table secure_files drop column clear_reason, drop column cleared_at, drop column cleared_by;
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task'));
alter table secure_files drop constraint secure_files_scan_status_check;
alter table secure_files add constraint secure_files_scan_status_check check (scan_status in ('not_scanned', 'clean', 'scan_failed', 'infected'));

delete from staff_notifications where event_key not in ('task_assigned', 'task_comment', 'task_completed', 'task_file_added', 'task_due_soon', 'task_overdue',
  'document_pending_approval', 'document_changes_required', 'document_rejected', 'file_quarantined') or subject_type not in ('task', 'document');
alter table staff_notifications drop constraint staff_notifications_event_key_check;
alter table staff_notifications add constraint staff_notifications_event_key_check check (event_key in ('task_assigned', 'task_comment', 'task_completed', 'task_file_added', 'task_due_soon',
  'task_overdue', 'document_pending_approval', 'document_changes_required', 'document_rejected', 'file_quarantined'));
alter table staff_notifications drop constraint staff_notifications_subject_type_check;
alter table staff_notifications add constraint staff_notifications_subject_type_check check (subject_type in ('task', 'document'));

delete from role_permissions where permission_key = 'announcements.publish';
delete from permissions where key = 'announcements.publish';

-- restore the 0039 definitions
create or replace function app.staff_notify(p_user uuid, p_org uuid, p_event text, p_title text, p_href text, p_subject_type text, p_subject uuid,
                                            p_severity text, p_dedupe text, p_email boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is null or p_org is null or p_user is not distinct from app.current_user_id() then return; end if;
  if not app.user_is_active_member(p_user, p_org) then return; end if;
  insert into staff_notifications (user_id, org_id, event_key, title, href, subject_type, subject_id, severity, dedupe_key, email_status, email_next_attempt_at)
  values (p_user, p_org, p_event, p_title, p_href, p_subject_type, p_subject, p_severity, p_dedupe,
          case when p_email then 'pending' else 'none' end, case when p_email then now() end)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
exception when others then
  raise warning 'staff notification not created: %', sqlstate;
end $$;

create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_context_type = 'task' and exists (
    select 1 from tasks t
     where t.id = p_context
       and (app.has_perm(t.org_id, 'tasks.read.all')
            or ((t.assigned_to = app.current_user_id() or t.created_by = app.current_user_id()) and app.has_perm(t.org_id, 'tasks.read.own')))
       and (t.student_id is null or app.can_read_student(t.student_id)))
$$;

create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_context_type = 'task' and app.secure_file_can_read(p_context_type, p_context) and exists (
    select 1 from tasks t
     where t.id = p_context
       and (app.has_perm(t.org_id, 'tasks.update.all') or app.has_perm(t.org_id, 'tasks.assign')
            or ((t.assigned_to = app.current_user_id() or t.created_by = app.current_user_id()) and app.has_perm(t.org_id, 'tasks.update.own'))))
$$;

create or replace function app.secure_file_upload_org(p_context_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if not app.secure_file_can_write(p_context_type, p_context) then raise exception 'permission denied: secure file upload' using errcode = '42501'; end if;
  select org_id into v_org from tasks where id = p_context;
  return v_org;
end $$;

create or replace function app.register_secure_file(p_context_type text, p_context uuid, p_key text, p_filename text, p_mime text, p_size bigint, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks%rowtype; v_id uuid; v_me uuid := app.current_user_id();
begin
  if v_me is null or not app.secure_file_can_write(p_context_type, p_context) then raise exception 'permission denied: secure file upload' using errcode = '42501'; end if;
  select * into v_t from tasks where id = p_context for update;
  if p_key not like 'org/' || v_t.org_id || '/secure/' || p_context_type || '/' || p_context || '/%' then raise exception 'invalid storage key' using errcode = '22023'; end if;
  if (select count(*) from secure_files f where f.context_type = p_context_type and f.context_id = p_context and f.removed_at is null) >= 20 then
    raise exception 'This task already has 20 files. Remove one before adding another.' using errcode = '23514';
  end if;
  insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
  values (v_t.org_id, p_context_type, p_context, p_key, p_filename, p_mime, p_size, p_sha256, v_me)
  returning id into v_id;
  perform app.audit('secure_file_uploaded', 'secure_files', v_id::text, v_t.org_id, v_t.student_id, null,
    jsonb_build_object('context_type', p_context_type, 'context_id', p_context, 'size_bytes', p_size, 'mime_type', p_mime));
  perform app.staff_notify(v_t.assigned_to, v_t.org_id, 'task_file_added', 'A file was added to a task', '/tasks/' || v_t.id, 'task', v_t.id, 'info', null, false);
  if v_t.created_by is distinct from v_t.assigned_to then
    perform app.staff_notify(v_t.created_by, v_t.org_id, 'task_file_added', 'A file was added to a task', '/tasks/' || v_t.id, 'task', v_t.id, 'info', null, false);
  end if;
  return v_id;
end $$;

create or replace function app.authorize_secure_file_download(p_file uuid) returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_student uuid;
begin
  select * into v_f from secure_files f where f.id = p_file and f.removed_at is null;
  if v_f.id is null or not app.is_member(v_f.org_id) or not app.secure_file_can_read(v_f.context_type, v_f.context_id) then
    perform app.audit('file_download', 'secure_files', p_file::text, null, null, null, null, 'denied');
    return;
  end if;
  select t.student_id into v_student from tasks t where t.id = v_f.context_id;
  if v_f.scan_status = 'infected' then
    perform app.audit('file_download', 'secure_files', p_file::text, v_f.org_id, v_student, null, null, 'denied', jsonb_build_object('reason', 'quarantined'));
    return;
  end if;
  perform app.audit('file_download', 'secure_files', p_file::text, v_f.org_id, v_student, null, jsonb_build_object('scan_status', v_f.scan_status));
  return query select v_f.storage_key, v_f.mime_type, v_f.original_filename;
end $$;

create or replace function app.remove_secure_file(p_file uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_me uuid := app.current_user_id(); v_student uuid;
begin
  select * into v_f from secure_files f where f.id = p_file and f.removed_at is null for update;
  if not found or not app.secure_file_can_read(v_f.context_type, v_f.context_id) then raise exception 'file not found' using errcode = 'P0002'; end if;
  if not ((v_f.uploaded_by = v_me and app.secure_file_can_write(v_f.context_type, v_f.context_id)) or app.has_perm(v_f.org_id, 'tasks.update.all')) then
    raise exception 'permission denied: secure file removal' using errcode = '42501';
  end if;
  update secure_files set removed_at = now(), removed_by = v_me where id = p_file;
  select t.student_id into v_student from tasks t where t.id = v_f.context_id;
  perform app.audit('secure_file_removed', 'secure_files', p_file::text, v_f.org_id, v_student, null, jsonb_build_object('context_id', v_f.context_id));
end $$;

create or replace function app.record_secure_file_scan(p_storage_key text, p_status text, p_engine text, p_detail text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_student uuid;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  if p_status not in ('clean', 'infected', 'scan_failed') then raise exception 'invalid scan status' using errcode = '22023'; end if;
  select * into v_f from secure_files f where f.storage_key = p_storage_key for update;
  if not found or v_f.scan_status = 'infected' then return v_f.id; end if;
  if p_status = 'scan_failed' and v_f.scan_status = 'clean' then return v_f.id; end if;
  update secure_files set scan_status = p_status, scan_engine = left(p_engine, 60), scan_detail = left(p_detail, 300), scanned_at = now() where id = v_f.id;
  select t.student_id into v_student from tasks t where t.id = v_f.context_id;
  perform app.audit(case when p_status = 'infected' then 'malware_detected' else 'file_scanned' end, 'secure_files', v_f.id::text, v_f.org_id, v_student,
    jsonb_build_object('scan_status', v_f.scan_status), jsonb_build_object('scan_status', p_status, 'engine', p_engine, 'detail', left(p_detail, 300)),
    case when p_status = 'infected' then 'denied' else 'success' end, '{}'::jsonb, v_f.uploaded_by);
  if p_status = 'infected' then
    perform app.staff_notify(v_f.uploaded_by, v_f.org_id, 'file_quarantined', 'A file you uploaded was quarantined by the virus scanner',
      '/tasks/' || v_f.context_id, 'task', v_f.context_id, 'critical', 'file_quarantined:' || v_f.id, true);
  end if;
  return v_f.id;
end $$;

drop function if exists app.sf_student(text, uuid);
drop function if exists app.sf_org(text, uuid);
drop function if exists app.sf_task_org(uuid);
drop function if exists app.sf_task_write(uuid);
drop function if exists app.sf_task_read(uuid);
drop function if exists app.sf_employee_org(uuid);
drop function if exists app.sf_employee_write(uuid);
drop function if exists app.sf_employee_read(uuid);
drop function if exists app.staff_notification_category(text);

-- Restored functions keep their closed access.
revoke execute on function app.authorize_secure_file_download(uuid) from public;
revoke execute on function app.record_secure_file_scan(text, text, text, text) from public;
revoke execute on function app.register_secure_file(text, uuid, text, text, text, bigint, text) from public;
revoke execute on function app.remove_secure_file(uuid) from public;
revoke execute on function app.secure_file_can_read(text, uuid) from public;
revoke execute on function app.secure_file_can_write(text, uuid) from public;
revoke execute on function app.secure_file_upload_org(text, uuid) from public;
revoke execute on function app.staff_notify(uuid, uuid, text, text, text, text, uuid, text, text, boolean) from public;
