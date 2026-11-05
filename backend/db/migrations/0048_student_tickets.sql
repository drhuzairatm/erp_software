-- Phase 8: questions from students in the portal. Students reach this only through app.portal_* functions keyed by their session, and only for their own record.
-- Staff read a ticket if they answer tickets and can read that student, or if it is assigned to them. History is kept: messages, events and attachments are not removed.

insert into permissions (key, category, description, is_sensitive) values
  ('tickets.respond', 'Student tickets', 'Read and answer portal questions from students this person can see', false),
  ('tickets.manage', 'Student tickets', 'Assign portal questions to staff', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'tickets.respond' from roles r where r.key in ('md', 'ceo', 'manager', 'counsellor', 'documentation', 'visa', 'finance') on conflict do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'tickets.manage' from roles r where r.key in ('md', 'ceo', 'manager') on conflict do nothing;

create table student_ticket_counters (
  org_id uuid not null references organizations(id),
  year   int not null,
  last   int not null,
  primary key (org_id, year)
);

create table student_tickets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id),
  ticket_number   text not null check (ticket_number ~ '^TKT-[0-9]{4}-[0-9]{6,}$'),
  student_id      uuid not null references students(id),
  category        text not null check (category in ('admission', 'documents', 'visa', 'payments', 'courier', 'portal_account', 'other')),
  subject         text not null check (length(btrim(subject)) between 3 and 200),
  status          text not null default 'open' check (status in ('open', 'in_progress', 'waiting_for_student', 'resolved', 'closed')),
  assigned_to     uuid references user_profiles(id),
  assigned_at     timestamptz,
  last_message_at timestamptz not null default now(),
  last_from       text not null default 'student' check (last_from in ('student', 'staff')),
  resolved_at     timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (org_id, ticket_number)
);
create index student_tickets_queue on student_tickets (org_id, status, last_message_at desc);
create index student_tickets_student on student_tickets (student_id, last_message_at desc);
create index student_tickets_assignee on student_tickets (assigned_to, last_message_at desc) where assigned_to is not null;
create trigger student_tickets_touch before update on student_tickets for each row execute function app.touch_updated_at();

create table student_ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references student_tickets(id),
  org_id      uuid not null references organizations(id),
  author_type text not null check (author_type in ('student', 'staff')),
  author_id   uuid references user_profiles(id),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now(),
  check ((author_type = 'student' and author_id is null) or (author_type = 'staff' and author_id is not null))
);
create index student_ticket_messages_ticket on student_ticket_messages (ticket_id, created_at);

create table student_ticket_events (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references student_tickets(id),
  action      text not null,
  from_status text,
  to_status   text,
  note        text check (note is null or length(note) <= 1000),
  actor_id    uuid references user_profiles(id),
  by_student  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index student_ticket_events_ticket on student_ticket_events (ticket_id, created_at);

-- Files from students have no staff uploader. Only tickets may leave it empty.
alter table secure_files alter column uploaded_by drop not null;
alter table secure_files add constraint secure_files_uploader_check check (uploaded_by is not null or context_type = 'ticket');
alter table portal_notices drop constraint portal_notices_kind_check;
alter table portal_notices add constraint portal_notices_kind_check check (kind in ('document', 'courier', 'publication', 'stage', 'account', 'ticket'));

create or replace function app.ticket_can_read(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from student_tickets t where t.id = p_ticket and (
    (t.assigned_to = app.current_user_id() and app.has_perm(t.org_id, 'tickets.respond'))
    or (app.can_read_student(t.student_id) and exists (select 1 from student_org_access a where a.student_id = t.student_id and app.has_perm(a.org_id, 'tickets.respond')))))
$$;
create or replace function app.ticket_can_manage(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from student_tickets t where t.id = p_ticket and app.can_read_student(t.student_id) and exists (select 1 from student_org_access a where a.student_id = t.student_id and app.has_perm(a.org_id, 'tickets.manage')))
$$;

alter table student_ticket_counters enable row level security;
alter table student_tickets enable row level security;
alter table student_ticket_messages enable row level security;
alter table student_ticket_events enable row level security;
create policy student_tickets_select on student_tickets for select to erp_app using (app.ticket_can_read(id));
create policy student_ticket_messages_select on student_ticket_messages for select to erp_app using (app.ticket_can_read(ticket_id));
create policy student_ticket_events_select on student_ticket_events for select to erp_app using (app.ticket_can_read(ticket_id));
grant select on student_tickets, student_ticket_messages, student_ticket_events to erp_app;

-- A person assigned a ticket may not otherwise read the student: they get the name and ID, and nothing more of the record.
create or replace function app.ticket_student(p_ticket uuid) returns table (full_name text, student_code text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.full_name, s.student_code from student_tickets t join students s on s.id = t.student_id where t.id = p_ticket and app.ticket_can_read(p_ticket)
$$;

-- People who can be given a ticket: active staff who answer tickets in a company that has this student.
create or replace function app.ticket_staff(p_ticket uuid) returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.ticket_can_read(p_ticket) then return; end if;
  return query select distinct u.id, u.full_name from student_tickets t join student_org_access a on a.student_id = t.student_id
    join organization_memberships m on m.org_id = a.org_id and m.is_active join user_profiles u on u.id = m.user_id and u.is_active
   where t.id = p_ticket and app.role_has_perm(m.role_id, 'tickets.respond') order by u.full_name;
end $$;

-- To the assignee; if there is none, to the student's assigned staff and to those who assign tickets. Text is generic.
create or replace function app.ticket_notify_staff(p_ticket uuid, p_event text, p_title text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t student_tickets%rowtype; r record;
begin
  select * into t from student_tickets where id = p_ticket;
  if t.assigned_to is not null then
    perform app.staff_notify(t.assigned_to, t.org_id, p_event, p_title, '/tickets/' || t.id, 'ticket', t.id, 'info', null, false);
    return;
  end if;
  for r in select distinct m.user_id from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active
            where m.org_id = t.org_id and m.is_active and (app.role_has_perm(m.role_id, 'tickets.manage')
               or (app.role_has_perm(m.role_id, 'tickets.respond') and exists (select 1 from student_assignments sa where sa.student_id = t.student_id and sa.user_id = m.user_id and sa.is_active))) loop
    perform app.staff_notify(r.user_id, t.org_id, p_event, p_title, '/tickets/' || t.id, 'ticket', t.id, 'info', null, false);
  end loop;
end $$;

create or replace function app.ticket_log(p_ticket uuid, p_org uuid, p_student uuid, p_action text, p_from text, p_to text, p_note text, p_by_student boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into student_ticket_events (ticket_id, action, from_status, to_status, note, actor_id, by_student) values (p_ticket, p_action, p_from, p_to, p_note, app.current_user_id(), p_by_student);
  perform app.audit('ticket_' || p_action, 'student_tickets', p_ticket::text, p_org, p_student, null, jsonb_build_object('from', p_from, 'to', p_to, 'by_student', p_by_student));
end $$;

-- ---- Student side ---------------------------------------------------------
create or replace function app.portal_ticket_create(p_token_hash text, p_category text, p_subject text, p_body text) returns table (ticket_id uuid, message_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := app.portal_student(p_token_hash); v_org uuid; v_year int := extract(year from (now() at time zone 'Asia/Kolkata'))::int; v_n int; v_id uuid; v_msg uuid;
begin
  if v_student is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_category not in ('admission', 'documents', 'visa', 'payments', 'courier', 'portal_account', 'other') then raise exception 'Choose a category.' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_subject, ''))) not between 3 and 200 then raise exception 'Enter a short subject.' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'Enter your question, up to 4000 characters.' using errcode = '23514'; end if;
  if (select count(*) from student_tickets t where t.student_id = v_student and t.created_at > now() - interval '1 day') >= 10 then raise exception 'You have asked many questions today. Please wait for a reply, or add to an existing question.' using errcode = '23514'; end if;
  select originating_org_id into v_org from students where id = v_student;
  insert into student_ticket_counters as c (org_id, year, last) values (v_org, v_year, 1) on conflict (org_id, year) do update set last = c.last + 1 returning last into v_n;
  insert into student_tickets (org_id, ticket_number, student_id, category, subject) values (v_org, 'TKT-' || v_year || '-' || lpad(v_n::text, 6, '0'), v_student, p_category, btrim(p_subject)) returning id into v_id;
  insert into student_ticket_messages (ticket_id, org_id, author_type, body) values (v_id, v_org, 'student', btrim(p_body)) returning id into v_msg;
  perform app.ticket_log(v_id, v_org, v_student, 'created', null, 'open', null, true);
  perform app.ticket_notify_staff(v_id, 'ticket_new', 'A student asked a new question');
  return query select v_id, v_msg;
end $$;

create or replace function app.portal_ticket_reply(p_token_hash text, p_ticket uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := app.portal_student(p_token_hash); t student_tickets%rowtype; v_msg uuid; v_new text;
begin
  if v_student is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into t from student_tickets x where x.id = p_ticket and x.student_id = v_student for update;
  if t.id is null then raise exception 'question not found' using errcode = 'P0002'; end if;
  if t.status = 'closed' then raise exception 'This question is closed. Please ask a new one.' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'Enter your reply, up to 4000 characters.' using errcode = '23514'; end if;
  insert into student_ticket_messages (ticket_id, org_id, author_type, body) values (t.id, t.org_id, 'student', btrim(p_body)) returning id into v_msg;
  v_new := case t.status when 'waiting_for_student' then 'in_progress' when 'resolved' then 'open' else t.status end;
  update student_tickets set status = v_new, last_message_at = now(), last_from = 'student', resolved_at = case when v_new = 'open' then null else resolved_at end where id = t.id;
  perform app.ticket_log(t.id, t.org_id, v_student, 'student_replied', t.status, v_new, null, true);
  perform app.ticket_notify_staff(t.id, 'ticket_reply', 'A student replied to a question');
  return v_msg;
end $$;

create or replace function app.portal_tickets(p_token_hash text, p_q text, p_status text, p_page int) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select t.id, t.ticket_number, t.category, t.subject, t.status, t.last_message_at, t.last_from, t.created_at, count(*) over () as total
      from student_tickets t
     where t.student_id = app.portal_student(p_token_hash)
       and (coalesce(p_status, '') = '' or t.status = p_status)
       and (coalesce(btrim(p_q), '') = '' or t.subject ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%' or t.ticket_number ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%')
     order by t.last_message_at desc, t.id limit 20 offset greatest(coalesce(p_page, 1) - 1, 0) * 20)
  select jsonb_build_object('total', coalesce(max(total), 0), 'rows', coalesce(jsonb_agg(to_jsonb(mine) - 'total' order by last_message_at desc, id), '[]')) from mine
$$;

-- What a student sees. No staff names, assignments or notes.
create or replace function app.portal_ticket(p_token_hash text, p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', t.id, 'ticket_number', t.ticket_number, 'category', t.category, 'subject', t.subject, 'status', t.status, 'created_at', t.created_at,
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'from', m.author_type, 'body', m.body, 'at', m.created_at,
        'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.original_filename, 'scan_status', f.scan_status) order by f.uploaded_at), '[]') from secure_files f where f.context_type = 'ticket' and f.context_id = m.id and f.removed_at is null))
        order by m.created_at, m.id), '[]') from student_ticket_messages m where m.ticket_id = t.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'to', e.to_status, 'at', e.created_at) order by e.created_at, e.id), '[]') from student_ticket_events e where e.ticket_id = t.id and e.to_status is distinct from e.from_status))
    from student_tickets t where t.id = p_ticket and t.student_id = app.portal_student(p_token_hash)
$$;

-- The company whose storage holds the file, if this is the student's own message on an open question.
create or replace function app.portal_ticket_upload_target(p_token_hash text, p_message uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id from student_ticket_messages m join student_tickets t on t.id = m.ticket_id
   where m.id = p_message and m.author_type = 'student' and t.status <> 'closed' and t.student_id = app.portal_student(p_token_hash)
$$;

create or replace function app.portal_ticket_register_file(p_token_hash text, p_message uuid, p_key text, p_filename text, p_mime text, p_size bigint, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := app.portal_ticket_upload_target(p_token_hash, p_message); v_id uuid;
begin
  if v_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if (select count(*) from secure_files f where f.context_type = 'ticket' and f.context_id = p_message) >= 3 then raise exception 'Attach up to 3 files to a message.' using errcode = '23514'; end if;
  insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
  values (v_org, 'ticket', p_message, p_key, p_filename, p_mime, p_size, p_sha256, null) returning id into v_id;
  perform app.audit('ticket_file_added', 'secure_files', v_id::text, v_org, app.portal_student(p_token_hash), null, null);
  return v_id;
end $$;

create or replace function app.portal_ticket_file(p_token_hash text, p_file uuid, p_ip text) returns table (storage_key text, mime_type text, original_filename text, scan_status text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := app.portal_student(p_token_hash); v_ok boolean;
begin
  select exists (select 1 from secure_files f join student_ticket_messages m on m.id = f.context_id join student_tickets t on t.id = m.ticket_id
                  where f.id = p_file and f.context_type = 'ticket' and f.removed_at is null and f.scan_status <> 'infected' and t.student_id = v_student) into v_ok;
  perform app.audit('ticket_file_download', 'secure_files', p_file::text, null, v_student, null, null, case when v_ok and v_student is not null then 'success' else 'denied' end, jsonb_build_object('ip', p_ip));
  if not v_ok or v_student is null then return; end if;
  return query select f.storage_key, f.mime_type, f.original_filename, f.scan_status from secure_files f where f.id = p_file;
end $$;

-- ---- Staff side -----------------------------------------------------------
create or replace function app.ticket_reply(p_ticket uuid, p_body text, p_next text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t student_tickets%rowtype; v_me uuid := app.current_user_id(); v_msg uuid;
begin
  select * into t from student_tickets x where x.id = p_ticket for update;
  if t.id is null or not app.ticket_can_read(p_ticket) then raise exception 'question not found' using errcode = 'P0002'; end if;
  if t.status = 'closed' then raise exception 'This question is closed.' using errcode = '23514'; end if;
  if p_next not in ('in_progress', 'waiting_for_student', 'resolved') then raise exception 'Choose the next status.' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'Enter your reply, up to 4000 characters.' using errcode = '23514'; end if;
  insert into student_ticket_messages (ticket_id, org_id, author_type, author_id, body) values (t.id, t.org_id, 'staff', v_me, btrim(p_body)) returning id into v_msg;
  update student_tickets set status = p_next, last_message_at = now(), last_from = 'staff', assigned_to = coalesce(assigned_to, v_me), assigned_at = coalesce(assigned_at, now()), resolved_at = case when p_next = 'resolved' then now() else null end where id = t.id;
  perform app.ticket_log(t.id, t.org_id, t.student_id, 'staff_replied', t.status, p_next, null, false);
  perform app.portal_notify(t.student_id, 'ticket', 'We replied to your question', 'Reference ' || t.ticket_number || '. Open My questions to read the reply.');
  return v_msg;
end $$;

create or replace function app.ticket_set_status(p_ticket uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t student_tickets%rowtype;
begin
  select * into t from student_tickets x where x.id = p_ticket for update;
  if t.id is null or not app.ticket_can_read(p_ticket) then raise exception 'question not found' using errcode = 'P0002'; end if;
  if p_status not in ('open', 'in_progress', 'waiting_for_student', 'resolved', 'closed') then raise exception 'Choose a status.' using errcode = '23514'; end if;
  if t.status = 'closed' then raise exception 'This question is closed.' using errcode = '23514'; end if;
  if t.status = p_status then return; end if;
  update student_tickets set status = p_status, resolved_at = case when p_status = 'resolved' then now() when p_status = 'closed' then resolved_at else null end, closed_at = case when p_status = 'closed' then now() end where id = t.id;
  perform app.ticket_log(t.id, t.org_id, t.student_id, 'status_changed', t.status, p_status, nullif(btrim(coalesce(p_note, '')), ''), false);
  if p_status in ('resolved', 'closed') then perform app.portal_notify(t.student_id, 'ticket', case when p_status = 'resolved' then 'Your question was marked resolved' else 'Your question was closed' end, 'Reference ' || t.ticket_number || '.'); end if;
end $$;

create or replace function app.ticket_assign(p_ticket uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t student_tickets%rowtype; v_me uuid := app.current_user_id(); v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into t from student_tickets x where x.id = p_ticket for update;
  if t.id is null or not app.ticket_can_read(p_ticket) then raise exception 'question not found' using errcode = 'P0002'; end if;
  if not (app.ticket_can_manage(p_ticket) or p_user = v_me or t.assigned_to is not distinct from v_me) then raise exception 'permission denied: assigning a question' using errcode = '42501'; end if;
  if t.status = 'closed' then raise exception 'This question is closed.' using errcode = '23514'; end if;
  if not exists (select 1 from student_org_access a join organization_memberships m on m.org_id = a.org_id and m.user_id = p_user and m.is_active where a.student_id = t.student_id and app.role_has_perm(m.role_id, 'tickets.respond')) then raise exception 'That person cannot answer this student''s questions.' using errcode = '23514'; end if;
  if t.assigned_to is not null and t.assigned_to <> v_me and t.assigned_to <> p_user and (v_reason is null or length(v_reason) < 3) then raise exception 'Give the reason for reassigning.' using errcode = '23514'; end if;
  update student_tickets set assigned_to = p_user, assigned_at = now() where id = t.id;
  perform app.ticket_log(t.id, t.org_id, t.student_id, case when t.assigned_to is null then 'assigned' else 'reassigned' end, t.status, t.status, v_reason, false);
  perform app.staff_notify(p_user, t.org_id, 'ticket_assigned', 'A student question was assigned to you', '/tickets/' || t.id, 'ticket', t.id, 'info', null, false);
end $$;

create or replace function app.sf_ticket_org(p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select org_id from student_ticket_messages where id = p_context $$;
create or replace function app.sf_ticket_read(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from student_ticket_messages m where m.id = p_context and app.ticket_can_read(m.ticket_id))
$$;
create or replace function app.sf_ticket_write(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from student_ticket_messages m join student_tickets t on t.id = m.ticket_id where m.id = p_context and m.author_id = app.current_user_id() and t.status <> 'closed' and app.ticket_can_read(m.ticket_id))
$$;
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance', 'meeting', 'chat', 'dvr', 'ticket'));
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) when 'attendance' then app.sf_attendance_org(p_context)
    when 'meeting' then app.sf_meeting_org(p_context) when 'chat' then app.sf_chat_org(p_context) when 'dvr' then app.sf_dvr_org(p_context) when 'ticket' then app.sf_ticket_org(p_context) end;
end $$;

create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) when 'attendance' then app.sf_attendance_read(p_context)
    when 'meeting' then app.meeting_can_read(p_context) when 'chat' then app.sf_chat_read(p_context) when 'dvr' then app.sf_dvr_read(p_context) when 'ticket' then app.sf_ticket_read(p_context) end, false);
end $$;

create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) when 'attendance' then app.sf_attendance_write(p_context)
    when 'meeting' then app.meeting_can_edit(p_context) when 'chat' then app.sf_chat_write(p_context) when 'dvr' then app.sf_dvr_write(p_context) when 'ticket' then app.sf_ticket_write(p_context) end, false);
end $$;

create or replace function app.remove_secure_file(p_file uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v_f from secure_files f where f.id = p_file and f.removed_at is null for update;
  if not found or not app.secure_file_can_read(v_f.context_type, v_f.context_id) then raise exception 'file not found' using errcode = 'P0002'; end if;
  if v_f.context_type = 'dvr' then raise exception 'Every version of a verification document is kept.' using errcode = '23514'; end if;
  if v_f.context_type = 'ticket' then raise exception 'Files on a student question are kept with its history.' using errcode = '23514'; end if;
  if not ((v_f.uploaded_by = v_me and app.secure_file_can_write(v_f.context_type, v_f.context_id))
          or (v_f.context_type = 'task' and app.has_perm(v_f.org_id, 'tasks.update.all'))
          or (v_f.context_type = 'employee' and app.has_perm(v_f.org_id, 'users.manage'))) then
    raise exception 'permission denied: secure file removal' using errcode = '42501';
  end if;
  update secure_files set removed_at = now(), removed_by = v_me where id = p_file;
  perform app.audit('secure_file_removed', 'secure_files', p_file::text, v_f.org_id, app.sf_student(v_f.context_type, v_f.context_id), null,
    jsonb_build_object('context_type', v_f.context_type, 'context_id', v_f.context_id));
end $$;

revoke execute on function app.ticket_can_read(uuid), app.ticket_can_manage(uuid), app.ticket_student(uuid), app.ticket_staff(uuid), app.ticket_notify_staff(uuid, text, text), app.ticket_log(uuid, uuid, uuid, text, text, text, text, boolean),
  app.portal_ticket_create(text, text, text, text), app.portal_ticket_reply(text, uuid, text), app.portal_tickets(text, text, text, int), app.portal_ticket(text, uuid), app.portal_ticket_upload_target(text, uuid),
  app.portal_ticket_register_file(text, uuid, text, text, text, bigint, text), app.portal_ticket_file(text, uuid, text), app.ticket_reply(uuid, text, text), app.ticket_set_status(uuid, text, text), app.ticket_assign(uuid, uuid, text),
  app.sf_ticket_org(uuid), app.sf_ticket_read(uuid), app.sf_ticket_write(uuid), app.sf_org(text, uuid), app.secure_file_can_read(text, uuid), app.secure_file_can_write(text, uuid), app.remove_secure_file(uuid) from public;
grant execute on function app.ticket_can_read(uuid), app.ticket_can_manage(uuid), app.ticket_student(uuid), app.ticket_staff(uuid), app.portal_ticket_create(text, text, text, text), app.portal_ticket_reply(text, uuid, text), app.portal_tickets(text, text, text, int), app.portal_ticket(text, uuid),
  app.portal_ticket_upload_target(text, uuid), app.portal_ticket_register_file(text, uuid, text, text, text, bigint, text), app.portal_ticket_file(text, uuid, text), app.ticket_reply(uuid, text, text), app.ticket_set_status(uuid, text, text), app.ticket_assign(uuid, uuid, text) to erp_app;
