-- Undo 0042. WARNING: all attendance records, events, corrections, leave requests and office settings are lost, and attendance photos lose their file records
-- (bytes stay in storage). Back up first. The application must first return to a version that doesn't use these tables.
delete from secure_files where context_type = 'attendance';
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee'));
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) end;
end $$;

create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) end, false);
end $$;

create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) end, false);
end $$;

drop function if exists app.sf_attendance_org(uuid);
drop function if exists app.sf_attendance_read(uuid);
drop function if exists app.sf_attendance_write(uuid);
drop function if exists app.attendance_daily();
drop function if exists app.attendance_decide_leave(uuid, text, text);
drop function if exists app.attendance_request_leave(uuid, text, text, date, date, text);
drop function if exists app.attendance_decide_correction(uuid, text, text);
drop function if exists app.attendance_request_correction(uuid, date, timestamptz, timestamptz, text);
drop function if exists app.attendance_set_status(uuid, uuid, date, text, text);
drop function if exists app.attendance_decide_review(uuid, text, text);
drop function if exists app.attendance_office_settings(uuid);
drop function if exists app.attendance_issue_qr(uuid, text, int);
drop function if exists app.attendance_flag_event(uuid, text);
drop function if exists app.attendance_attach_photo(uuid, uuid);
drop function if exists app.attendance_mark(uuid, text, text, double precision, double precision, double precision, text, text, text, boolean);
drop function if exists app.attendance_notify_reviewers(uuid, text, text, text, uuid, text);
drop function if exists app.distance_m(double precision, double precision, double precision, double precision);
drop table if exists attendance_leaves;
drop table if exists attendance_corrections;
drop table if exists attendance_qr_uses;
drop table if exists attendance_qr_tokens;
drop table if exists attendance_events;
drop table if exists attendance_records;
drop table if exists attendance_policies;
drop table if exists attendance_offices;
delete from role_permissions where permission_key in ('attendance.view', 'attendance.review', 'attendance.manage');
delete from permissions where key in ('attendance.view', 'attendance.review', 'attendance.manage');

-- Restored functions keep their closed access.
revoke execute on function app.secure_file_can_read(text, uuid) from public;
revoke execute on function app.secure_file_can_write(text, uuid) from public;
revoke execute on function app.sf_org(text, uuid) from public;
