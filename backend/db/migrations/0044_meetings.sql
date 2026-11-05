-- Phase 5: daily core meetings and minutes. Private by default: only the Core Team, invited attendees, the note taker and holders of meetings.manage can read a
-- meeting. Holding an administrator role alone gives no access. Audit entries record that something changed, never the text of agendas, notes, decisions or actions.
-- Decisions become ordinary tasks in the existing tasks table, with a link back to the meeting.

insert into permissions (key, category, description, is_sensitive) values
  ('meetings.manage', 'Meetings', 'Create meetings, manage the Core Team, and read and edit all meetings of the company', true)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'meetings.manage' from roles r where r.key in ('md', 'ceo') on conflict do nothing;

create table core_team_members (
  org_id     uuid not null references organizations(id),
  user_id    uuid not null references user_profiles(id),
  added_by   uuid references user_profiles(id),
  added_at   timestamptz not null default now(),
  removed_by uuid references user_profiles(id),
  removed_at timestamptz,
  primary key (org_id, user_id)
);

create table meetings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id),
  title         text not null check (length(btrim(title)) between 2 and 200),
  meeting_type  text not null default 'daily_core' check (meeting_type in ('daily_core', 'other')),
  scheduled_at  timestamptz not null,
  location      text check (location is null or length(location) <= 200),
  agenda        text check (agenda is null or length(agenda) <= 8000),
  status        text not null default 'scheduled' check (status in ('scheduled', 'held', 'cancelled')),
  note_taker_id uuid references user_profiles(id),
  created_by    uuid not null references user_profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index meetings_org_date on meetings (org_id, scheduled_at desc);
create trigger meetings_touch before update on meetings for each row execute function app.touch_updated_at();

create table meeting_attendees (
  meeting_id uuid not null references meetings(id),
  user_id    uuid not null references user_profiles(id),
  org_id     uuid not null references organizations(id),
  attended   boolean,
  primary key (meeting_id, user_id)
);
create index meeting_attendees_user on meeting_attendees (user_id);

create table meeting_minutes (
  meeting_id       uuid primary key references meetings(id),
  org_id           uuid not null references organizations(id),
  discussion_notes text not null check (length(discussion_notes) <= 50000),
  version          int not null default 1,
  updated_by       uuid references user_profiles(id),
  updated_at       timestamptz not null default now()
);
-- Every saved version is kept.
create table meeting_minutes_versions (
  id               uuid primary key default gen_random_uuid(),
  meeting_id       uuid not null references meetings(id),
  org_id           uuid not null references organizations(id),
  version          int not null,
  discussion_notes text not null,
  edit_reason      text,
  edited_by        uuid references user_profiles(id),
  edited_at        timestamptz not null default now(),
  unique (meeting_id, version)
);

create table meeting_decisions (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  org_id     uuid not null references organizations(id),
  body       text not null check (length(btrim(body)) between 2 and 4000),
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now()
);
create index meeting_decisions_meeting on meeting_decisions (meeting_id, created_at);

create table meeting_action_points (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references meetings(id),
  org_id         uuid not null references organizations(id),
  decision_id    uuid references meeting_decisions(id),
  description    text not null check (length(btrim(description)) between 2 and 2000),
  responsible_id uuid references user_profiles(id),
  deadline       timestamptz,
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  task_id        uuid unique references tasks(id),
  created_by     uuid references user_profiles(id),
  created_at     timestamptz not null default now()
);
create index meeting_action_points_meeting on meeting_action_points (meeting_id, created_at);

create or replace function app.is_core_team(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from core_team_members c where c.org_id = p_org and c.user_id = app.current_user_id() and c.removed_at is null) and app.is_member(p_org)
$$;
create or replace function app.meeting_can_read(p_meeting uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from meetings m where m.id = p_meeting and app.is_member(m.org_id)
     and (app.has_perm(m.org_id, 'meetings.manage') or app.is_core_team(m.org_id) or m.note_taker_id = app.current_user_id() or m.created_by = app.current_user_id()
          or exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.user_id = app.current_user_id())))
$$;
create or replace function app.meeting_can_edit(p_meeting uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from meetings m where m.id = p_meeting and app.is_member(m.org_id)
     and (app.has_perm(m.org_id, 'meetings.manage') or m.note_taker_id = app.current_user_id()))
$$;

alter table core_team_members enable row level security;
alter table meetings enable row level security;
alter table meeting_attendees enable row level security;
alter table meeting_minutes enable row level security;
alter table meeting_minutes_versions enable row level security;
alter table meeting_decisions enable row level security;
alter table meeting_action_points enable row level security;
create policy core_team_members_select on core_team_members for select to erp_app using (app.is_member(org_id) and (app.is_core_team(org_id) or app.has_perm(org_id, 'meetings.manage')));
create policy meetings_select on meetings for select to erp_app using (app.meeting_can_read(id));
create policy meeting_attendees_select on meeting_attendees for select to erp_app using (app.meeting_can_read(meeting_id));
create policy meeting_minutes_select on meeting_minutes for select to erp_app using (app.meeting_can_read(meeting_id));
create policy meeting_minutes_versions_select on meeting_minutes_versions for select to erp_app using (app.meeting_can_read(meeting_id));
create policy meeting_decisions_select on meeting_decisions for select to erp_app using (app.meeting_can_read(meeting_id));
create policy meeting_action_points_select on meeting_action_points for select to erp_app using (app.meeting_can_read(meeting_id));
grant select on core_team_members, meetings, meeting_attendees, meeting_minutes, meeting_minutes_versions, meeting_decisions, meeting_action_points to erp_app;

-- Audit: the fact of a change, never the private text.
create trigger meetings_audit after insert or update on meetings for each row execute function app.audit_row('org_id', '', 'agenda', 'title');
create trigger core_team_members_audit after insert or update on core_team_members for each row execute function app.audit_row('org_id', '');
create trigger meeting_decisions_audit after insert or update on meeting_decisions for each row execute function app.audit_row('org_id', '', 'body');
create trigger meeting_action_points_audit after insert or update on meeting_action_points for each row execute function app.audit_row('org_id', '', 'description');

create or replace function app.set_core_team_member(p_org uuid, p_user uuid, p_member boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if not app.has_perm(p_org, 'meetings.manage') then raise exception 'permission denied: core team' using errcode = '42501'; end if;
  if p_member then
    if not app.user_is_active_member(p_user, p_org) then raise exception 'This person is not an active member of the company.' using errcode = '23514'; end if;
    insert into core_team_members (org_id, user_id, added_by) values (p_org, p_user, v_me)
    on conflict (org_id, user_id) do update set added_by = v_me, added_at = now(), removed_by = null, removed_at = null;
  else
    update core_team_members set removed_by = v_me, removed_at = now() where org_id = p_org and user_id = p_user and removed_at is null;
  end if;
end $$;

create or replace function app.meeting_set_attendees(p_meeting uuid, p_org uuid, p_attendees uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid; v_new int;
begin
  if not app.meeting_can_edit(p_meeting) then raise exception 'permission denied: meeting' using errcode = '42501'; end if;
  delete from meeting_attendees a where a.meeting_id = p_meeting and not (a.user_id = any(coalesce(p_attendees, '{}')));
  foreach u in array coalesce(p_attendees, '{}') loop
    if not app.user_is_active_member(u, p_org) then raise exception 'Every attendee must be an active member of the company.' using errcode = '23514'; end if;
    insert into meeting_attendees (meeting_id, user_id, org_id) values (p_meeting, u, p_org) on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new > 0 then perform app.staff_notify(u, p_org, 'meeting_invited', 'You were added to a meeting', '/meetings/' || p_meeting, 'meeting', p_meeting, 'info', null, false); end if;
  end loop;
end $$;

create or replace function app.save_meeting(p_id uuid, p_org uuid, p_title text, p_type text, p_at timestamptz, p_location text, p_agenda text, p_note_taker uuid, p_attendees uuid[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_me uuid := app.current_user_id(); v_org uuid := p_org;
begin
  if p_note_taker is not null and p_org is not null and not app.user_is_active_member(p_note_taker, p_org) then raise exception 'The note taker must be an active member of the company.' using errcode = '23514'; end if;
  if v_id is null then
    if not app.has_perm(p_org, 'meetings.manage') then raise exception 'permission denied: meetings' using errcode = '42501'; end if;
    insert into meetings (org_id, title, meeting_type, scheduled_at, location, agenda, note_taker_id, created_by)
    values (p_org, btrim(p_title), p_type, p_at, nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_agenda, '')), ''), p_note_taker, v_me) returning id into v_id;
    perform app.staff_notify(p_note_taker, p_org, 'meeting_note_taker', 'You are the note taker for a meeting', '/meetings/' || v_id, 'meeting', v_id, 'info', null, false);
  else
    select org_id into v_org from meetings where id = v_id;
    if v_org is null or not app.meeting_can_edit(v_id) then raise exception 'permission denied: meetings' using errcode = '42501'; end if;
    if p_note_taker is not null and not app.user_is_active_member(p_note_taker, v_org) then raise exception 'The note taker must be an active member of the company.' using errcode = '23514'; end if;
    update meetings set title = btrim(p_title), meeting_type = p_type, scheduled_at = p_at, location = nullif(btrim(coalesce(p_location, '')), ''), agenda = nullif(btrim(coalesce(p_agenda, '')), ''), note_taker_id = p_note_taker where id = v_id;
  end if;
  perform app.meeting_set_attendees(v_id, v_org, p_attendees);
  return v_id;
end $$;

create or replace function app.cancel_meeting(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.meeting_can_edit(p_id) then raise exception 'permission denied: meetings' using errcode = '42501'; end if;
  update meetings set status = 'cancelled' where id = p_id;
end $$;

-- Each save keeps a version. The first save tells attendees that minutes are available; the notification does not contain them.
create or replace function app.save_meeting_minutes(p_meeting uuid, p_notes text, p_reason text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m meetings%rowtype; v_me uuid := app.current_user_id(); v_version int; r record;
begin
  select * into v_m from meetings m where m.id = p_meeting for update;
  if v_m.id is null or not app.meeting_can_edit(p_meeting) then raise exception 'permission denied: meeting minutes' using errcode = '42501'; end if;
  if v_m.status = 'cancelled' then raise exception 'This meeting was cancelled.' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_notes, ''))) < 2 then raise exception 'Enter the discussion notes.' using errcode = '23514'; end if;
  select version + 1 into v_version from meeting_minutes where meeting_id = p_meeting;
  if v_version is not null and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give the reason for changing the minutes.' using errcode = '23514'; end if;
  insert into meeting_minutes (meeting_id, org_id, discussion_notes, updated_by) values (p_meeting, v_m.org_id, p_notes, v_me)
  on conflict (meeting_id) do update set discussion_notes = excluded.discussion_notes, version = meeting_minutes.version + 1, updated_by = v_me, updated_at = now()
  returning version into v_version;
  insert into meeting_minutes_versions (meeting_id, org_id, version, discussion_notes, edit_reason, edited_by) values (p_meeting, v_m.org_id, v_version, p_notes, nullif(btrim(coalesce(p_reason, '')), ''), v_me);
  update meetings set status = 'held' where id = p_meeting and status = 'scheduled';
  perform app.audit('meeting_minutes_saved', 'meetings', p_meeting::text, v_m.org_id, null, null, jsonb_build_object('version', v_version));
  if v_version = 1 then
    for r in select a.user_id from meeting_attendees a where a.meeting_id = p_meeting loop
      perform app.staff_notify(r.user_id, v_m.org_id, 'meeting_minutes_ready', 'Minutes are available for a meeting', '/meetings/' || p_meeting, 'meeting', p_meeting, 'info', 'meeting_minutes:' || p_meeting, false);
    end loop;
  end if;
  return v_version;
end $$;

create or replace function app.add_meeting_decision(p_meeting uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if not app.meeting_can_edit(p_meeting) then raise exception 'permission denied: meeting' using errcode = '42501'; end if;
  select org_id into v_org from meetings where id = p_meeting;
  insert into meeting_decisions (meeting_id, org_id, body, created_by) values (p_meeting, v_org, btrim(p_body), app.current_user_id()) returning id into v_id;
  return v_id;
end $$;

create or replace function app.add_meeting_action(p_meeting uuid, p_decision uuid, p_description text, p_responsible uuid, p_deadline timestamptz, p_priority text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if not app.meeting_can_edit(p_meeting) then raise exception 'permission denied: meeting' using errcode = '42501'; end if;
  select org_id into v_org from meetings where id = p_meeting;
  if p_responsible is not null and not app.user_is_active_member(p_responsible, v_org) then raise exception 'The responsible person must be an active member of the company.' using errcode = '23514'; end if;
  if p_decision is not null and not exists (select 1 from meeting_decisions d where d.id = p_decision and d.meeting_id = p_meeting) then raise exception 'That decision belongs to another meeting.' using errcode = '23514'; end if;
  insert into meeting_action_points (meeting_id, org_id, decision_id, description, responsible_id, deadline, priority, created_by)
  values (p_meeting, v_org, p_decision, btrim(p_description), p_responsible, p_deadline, p_priority, app.current_user_id()) returning id into v_id;
  perform app.staff_notify(p_responsible, v_org, 'meeting_action_assigned', 'A meeting action point was assigned to you', '/meetings/' || p_meeting, 'meeting', p_meeting, 'info', null, false);
  return v_id;
end $$;

-- One task per action point, in the existing tasks table. The task keeps the reference; the meeting text stays with the meeting.
create or replace function app.meeting_action_to_task(p_action uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a meeting_action_points%rowtype; v_task uuid;
begin
  select * into v_a from meeting_action_points a where a.id = p_action for update;
  if v_a.id is null or not app.meeting_can_edit(v_a.meeting_id) then raise exception 'permission denied: meeting' using errcode = '42501'; end if;
  if v_a.task_id is not null then raise exception 'This action point already has a task.' using errcode = '23514'; end if;
  if v_a.responsible_id is null then raise exception 'Choose the responsible person first.' using errcode = '23514'; end if;
  insert into tasks (org_id, title, description, task_type, assigned_to, priority, due_at, requires_review)
  values (v_a.org_id, left(v_a.description, 200), v_a.description, 'general', v_a.responsible_id, v_a.priority, v_a.deadline, true) returning id into v_task;
  update meeting_action_points set task_id = v_task where id = p_action;
  return v_task;
end $$;

-- Daily job: minutes not written by the end of the meeting day. Only the note taker and the creator are told.
create or replace function app.meetings_daily() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  for r in select m.id, m.org_id, m.note_taker_id, m.created_by from meetings m
            where m.status = 'scheduled' and m.scheduled_at between now() - interval '3 days' and now() - interval '6 hours'
              and not exists (select 1 from meeting_minutes x where x.meeting_id = m.id) loop
    perform app.staff_notify(coalesce(r.note_taker_id, r.created_by), r.org_id, 'meeting_minutes_due', 'Minutes have not been recorded for a meeting', '/meetings/' || r.id, 'meeting', r.id, 'warning', 'meeting_minutes_due:' || r.id, false);
    n := n + 1;
  end loop;
  return jsonb_build_object('minutesDue', n);
end $$;

-- Secure files: meeting attachments follow the meeting.
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance', 'meeting'));
create or replace function app.sf_meeting_org(p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select org_id from meetings where id = p_context $$;
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

revoke execute on function app.is_core_team(uuid), app.meeting_can_read(uuid), app.meeting_can_edit(uuid), app.set_core_team_member(uuid, uuid, boolean), app.meeting_set_attendees(uuid, uuid, uuid[]),
  app.save_meeting(uuid, uuid, text, text, timestamptz, text, text, uuid, uuid[]), app.cancel_meeting(uuid), app.save_meeting_minutes(uuid, text, text), app.add_meeting_decision(uuid, text),
  app.add_meeting_action(uuid, uuid, text, uuid, timestamptz, text), app.meeting_action_to_task(uuid), app.meetings_daily(), app.sf_meeting_org(uuid) from public;
grant execute on function app.is_core_team(uuid), app.meeting_can_read(uuid), app.meeting_can_edit(uuid), app.set_core_team_member(uuid, uuid, boolean),
  app.save_meeting(uuid, uuid, text, text, timestamptz, text, text, uuid, uuid[]), app.cancel_meeting(uuid), app.save_meeting_minutes(uuid, text, text), app.add_meeting_decision(uuid, text),
  app.add_meeting_action(uuid, uuid, text, uuid, timestamptz, text), app.meeting_action_to_task(uuid), app.meetings_daily() to erp_app;
