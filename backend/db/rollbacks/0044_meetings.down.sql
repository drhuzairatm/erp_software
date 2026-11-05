-- Undo 0044. WARNING: all meetings, minutes and their versions, decisions and the Core Team list are lost. Tasks made from action points stay, without the link. Back up first.
delete from secure_files where context_type = 'meeting';
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance'));
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) when 'attendance' then app.sf_attendance_org(p_context) end;
end $$;

create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) when 'attendance' then app.sf_attendance_read(p_context) end, false);
end $$;

create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) when 'attendance' then app.sf_attendance_write(p_context) end, false);
end $$;

drop function if exists app.sf_meeting_org(uuid);
drop function if exists app.meetings_daily();
drop function if exists app.meeting_action_to_task(uuid);
drop function if exists app.add_meeting_action(uuid, uuid, text, uuid, timestamptz, text);
drop function if exists app.add_meeting_decision(uuid, text);
drop function if exists app.save_meeting_minutes(uuid, text, text);
drop function if exists app.cancel_meeting(uuid);
drop function if exists app.save_meeting(uuid, uuid, text, text, timestamptz, text, text, uuid, uuid[]);
drop function if exists app.meeting_set_attendees(uuid, uuid, uuid[]);
drop function if exists app.set_core_team_member(uuid, uuid, boolean);
drop table if exists meeting_action_points;
drop table if exists meeting_decisions;
drop table if exists meeting_minutes_versions;
drop table if exists meeting_minutes;
drop table if exists meeting_attendees;
drop table if exists meetings;
drop table if exists core_team_members;
drop function if exists app.meeting_can_edit(uuid);
drop function if exists app.meeting_can_read(uuid);
drop function if exists app.is_core_team(uuid);
delete from role_permissions where permission_key = 'meetings.manage';
delete from permissions where key = 'meetings.manage';

-- Restored functions keep their closed access.
revoke execute on function app.secure_file_can_read(text, uuid) from public;
revoke execute on function app.secure_file_can_write(text, uuid) from public;
revoke execute on function app.sf_org(text, uuid) from public;
