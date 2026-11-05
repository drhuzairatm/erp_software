-- Undo 0048. WARNING: every student question, reply, history entry and attachment record is lost, including reference numbers. Bytes stay in storage. Back up first.
delete from secure_files where context_type = 'ticket';
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance', 'meeting', 'chat', 'dvr'));
alter table secure_files drop constraint secure_files_uploader_check;
alter table secure_files alter column uploaded_by set not null;
delete from portal_notices where kind = 'ticket';
alter table portal_notices drop constraint portal_notices_kind_check;
alter table portal_notices add constraint portal_notices_kind_check check (kind in ('document', 'courier', 'publication', 'stage', 'account'));
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) when 'attendance' then app.sf_attendance_org(p_context)
    when 'meeting' then app.sf_meeting_org(p_context) when 'chat' then app.sf_chat_org(p_context) when 'dvr' then app.sf_dvr_org(p_context) end;
end $$;

create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) when 'attendance' then app.sf_attendance_read(p_context)
    when 'meeting' then app.meeting_can_read(p_context) when 'chat' then app.sf_chat_read(p_context) when 'dvr' then app.sf_dvr_read(p_context) end, false);
end $$;

create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) when 'attendance' then app.sf_attendance_write(p_context)
    when 'meeting' then app.meeting_can_edit(p_context) when 'chat' then app.sf_chat_write(p_context) when 'dvr' then app.sf_dvr_write(p_context) end, false);
end $$;

create or replace function app.remove_secure_file(p_file uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v_f from secure_files f where f.id = p_file and f.removed_at is null for update;
  if not found or not app.secure_file_can_read(v_f.context_type, v_f.context_id) then raise exception 'file not found' using errcode = 'P0002'; end if;
  if v_f.context_type = 'dvr' then raise exception 'Every version of a verification document is kept.' using errcode = '23514'; end if;
  if not ((v_f.uploaded_by = v_me and app.secure_file_can_write(v_f.context_type, v_f.context_id))
          or (v_f.context_type = 'task' and app.has_perm(v_f.org_id, 'tasks.update.all'))
          or (v_f.context_type = 'employee' and app.has_perm(v_f.org_id, 'users.manage'))) then
    raise exception 'permission denied: secure file removal' using errcode = '42501';
  end if;
  update secure_files set removed_at = now(), removed_by = v_me where id = p_file;
  perform app.audit('secure_file_removed', 'secure_files', p_file::text, v_f.org_id, app.sf_student(v_f.context_type, v_f.context_id), null,
    jsonb_build_object('context_type', v_f.context_type, 'context_id', v_f.context_id));
end $$;

revoke execute on function app.sf_org(text, uuid), app.secure_file_can_read(text, uuid), app.secure_file_can_write(text, uuid), app.remove_secure_file(uuid) from public;
drop function if exists app.sf_ticket_org(uuid);
drop function if exists app.sf_ticket_read(uuid);
drop function if exists app.sf_ticket_write(uuid);
drop function if exists app.ticket_assign(uuid, uuid, text);
drop function if exists app.ticket_set_status(uuid, text, text);
drop function if exists app.ticket_reply(uuid, text, text);
drop function if exists app.portal_ticket_file(text, uuid, text);
drop function if exists app.portal_ticket_register_file(text, uuid, text, text, text, bigint, text);
drop function if exists app.portal_ticket_upload_target(text, uuid);
drop function if exists app.portal_ticket(text, uuid);
drop function if exists app.portal_tickets(text, text, text, int);
drop function if exists app.portal_ticket_reply(text, uuid, text);
drop function if exists app.portal_ticket_create(text, text, text, text);
drop function if exists app.ticket_log(uuid, uuid, uuid, text, text, text, text, boolean);
drop function if exists app.ticket_notify_staff(uuid, text, text);
drop function if exists app.ticket_staff(uuid);
drop function if exists app.ticket_student(uuid);
drop table if exists student_ticket_events;
drop table if exists student_ticket_messages;
drop table if exists student_tickets;
drop table if exists student_ticket_counters;
drop function if exists app.ticket_can_manage(uuid);
drop function if exists app.ticket_can_read(uuid);
delete from staff_notifications where subject_type = 'ticket';
delete from role_permissions where permission_key in ('tickets.respond', 'tickets.manage');
delete from permissions where key in ('tickets.respond', 'tickets.manage');
