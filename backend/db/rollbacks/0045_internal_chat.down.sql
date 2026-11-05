-- Undo 0045. WARNING: all chat conversations, messages, reactions and attachment records are lost. Bytes stay in storage. Back up first.
delete from secure_files where context_type = 'chat';
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance', 'meeting'));
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) when 'attendance' then app.sf_attendance_org(p_context)
    when 'meeting' then app.sf_meeting_org(p_context) end;
end $$;

create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) when 'attendance' then app.sf_attendance_read(p_context)
    when 'meeting' then app.meeting_can_read(p_context) end, false);
end $$;

create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) when 'attendance' then app.sf_attendance_write(p_context)
    when 'meeting' then app.meeting_can_edit(p_context) end, false);
end $$;

drop function if exists app.sf_chat_org(uuid);
drop function if exists app.sf_chat_read(uuid);
drop function if exists app.sf_chat_write(uuid);
drop function if exists app.chat_heartbeat(uuid, boolean, boolean);
drop function if exists app.chat_pin(uuid, boolean);
drop function if exists app.chat_react(uuid, text, boolean);
drop function if exists app.chat_delete(uuid);
drop function if exists app.chat_edit(uuid, text);
drop function if exists app.chat_send(uuid, text, uuid, uuid, uuid, uuid[]);
drop function if exists app.chat_set_member(uuid, uuid, boolean);
drop function if exists app.chat_create_group(uuid, text, text, uuid[]);
drop function if exists app.chat_sync_group(uuid);
drop function if exists app.chat_add_member(uuid, uuid, uuid, text);
drop function if exists app.chat_open_direct(uuid, uuid);
drop function if exists app.chat_notify(uuid, uuid, uuid, text, text, timestamptz);
drop table if exists chat_presence;
drop table if exists chat_message_history;
drop table if exists chat_reactions;
drop table if exists chat_messages;
drop table if exists chat_members;
drop table if exists chat_conversations;
drop function if exists app.chat_shares_company(uuid);
drop function if exists app.chat_is_admin(uuid);
drop function if exists app.chat_is_member(uuid);
delete from staff_notifications where subject_type = 'chat';
delete from role_permissions where permission_key = 'chat.groups.manage';
delete from permissions where key = 'chat.groups.manage';

-- Restored functions keep their closed access.
revoke execute on function app.secure_file_can_read(text, uuid) from public;
revoke execute on function app.secure_file_can_write(text, uuid) from public;
revoke execute on function app.sf_org(text, uuid) from public;
