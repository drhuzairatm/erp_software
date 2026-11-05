-- Phase 1: employee notifications and secure file storage. Additive only: no existing table, function, policy or row changes.
--
-- Employee notifications: raised by database triggers, so every route that changes data is covered. Text is generic and holds
-- no personal data; pages look up details under the reader's own row-level security. Each person reads only their own.
--
-- Secure files: for files with no student document. Bytes live in the existing private storage; the storage key is never
-- readable by the application role. Access follows the record the file is attached to (first use: tasks).

-- ---------------------------------------------------------------------------
-- Employee notifications
-- ---------------------------------------------------------------------------
create table staff_notifications (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references user_profiles(id),
  org_id                uuid not null references organizations(id),
  event_key             text not null check (event_key in ('task_assigned', 'task_comment', 'task_completed', 'task_file_added', 'task_due_soon',
                                                           'task_overdue', 'document_pending_approval', 'document_changes_required',
                                                           'document_rejected', 'file_quarantined')),
  title                 text not null check (length(btrim(title)) between 1 and 200),
  href                  text not null check (href ~ '^/[A-Za-z0-9/_-]*$' and href !~ '^//'), -- an internal page only
  subject_type          text check (subject_type in ('task', 'document')),
  subject_id            uuid,
  severity              text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  dedupe_key            text,
  created_at            timestamptz not null default now(),
  read_at               timestamptz,
  email_status          text not null default 'none' check (email_status in ('none', 'pending', 'sending', 'sent', 'failed', 'skipped')),
  email_attempts        int not null default 0,
  email_next_attempt_at timestamptz,
  email_claimed_at      timestamptz,
  emailed_at            timestamptz
);
create unique index staff_notifications_dedupe on staff_notifications (user_id, dedupe_key) where dedupe_key is not null;
create index staff_notifications_user_idx on staff_notifications (user_id, created_at desc);
create index staff_notifications_unread_idx on staff_notifications (user_id, created_at desc) where read_at is null;
create index staff_notifications_email_idx on staff_notifications (email_next_attempt_at) where email_status in ('pending', 'sending');

alter table staff_notifications enable row level security;
create policy staff_notifications_select on staff_notifications for select to erp_app
  using (user_id = app.current_user_id() and app.is_member(org_id));
-- No insert, update or delete for the application role: only the functions below change rows. Email columns are not readable.
grant select (id, user_id, org_id, event_key, title, href, subject_type, subject_id, severity, created_at, read_at) on staff_notifications to erp_app;

-- A company of this student that this person is an active member of (null if none).
create or replace function app.staff_org_for_student(p_user uuid, p_student uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.org_id from student_org_access a
    join organization_memberships m on m.org_id = a.org_id and m.user_id = p_user and m.is_active
   where a.student_id = p_student
   order by (a.relation = 'originating') desc, a.org_id limit 1
$$;

-- Internal. Never stops the action that raised it: a failure is reported as a database warning and the action continues.
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

create or replace function app.staff_notify_task() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_href text := '/tasks/' || new.id;
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform app.staff_notify(new.assigned_to, new.org_id, 'task_assigned', 'A task was assigned to you', v_href, 'task', new.id, 'info', null, true);
  end if;
  if tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' and new.created_by is distinct from new.assigned_to then
    perform app.staff_notify(new.created_by, new.org_id, 'task_completed', 'A task you created was completed', v_href, 'task', new.id, 'info', null, false);
  end if;
  return null;
end $$;
create trigger tasks_staff_notify after insert or update of assigned_to, status on tasks
  for each row execute function app.staff_notify_task();

create or replace function app.staff_notify_task_comment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks%rowtype;
begin
  select * into v_t from tasks where id = new.task_id;
  perform app.staff_notify(v_t.assigned_to, v_t.org_id, 'task_comment', 'New comment on a task', '/tasks/' || v_t.id, 'task', v_t.id, 'info', null, false);
  if v_t.created_by is distinct from v_t.assigned_to then
    perform app.staff_notify(v_t.created_by, v_t.org_id, 'task_comment', 'New comment on a task', '/tasks/' || v_t.id, 'task', v_t.id, 'info', null, false);
  end if;
  return null;
end $$;
create trigger task_comments_staff_notify after insert on task_comments
  for each row execute function app.staff_notify_task_comment();

-- Everyone who can approve documents of this student under the existing rules (same conditions as can_read_student + has_perm).
create or replace function app.student_document_approvers(p_student uuid) returns table (user_id uuid, org_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (m.user_id) m.user_id, a.org_id
    from student_org_access a
    join organization_memberships m on m.org_id = a.org_id and m.is_active
    join user_profiles u on u.id = m.user_id and u.is_active
    join organizations o on o.id = a.org_id and o.is_active
   where a.student_id = p_student
     and app.role_has_perm(m.role_id, 'documents.approve')
     and (   (a.relation in ('originating', 'secondary_brand') and app.role_has_perm(m.role_id, 'students.read.all'))
          or (a.relation = 'processing' and app.role_has_perm(m.role_id, 'students.read.processing'))
          or (app.role_has_perm(m.role_id, 'students.read.assigned')
              and exists (select 1 from student_assignments sa where sa.student_id = p_student and sa.user_id = m.user_id and sa.is_active)))
   order by m.user_id, (a.relation = 'originating') desc
$$;

create or replace function app.staff_notify_document() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_href text := '/students/' || new.student_id || '/documents/' || new.id;
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'pending_approval' then
    for r in select * from app.student_document_approvers(new.student_id) loop
      if r.user_id is distinct from new.verified_by and r.user_id is distinct from new.submitted_by then
        perform app.staff_notify(r.user_id, r.org_id, 'document_pending_approval', 'A document is waiting for your approval', v_href, 'document', new.id, 'info', null, true);
      end if;
    end loop;
  elsif new.status in ('rejected', 'changes_required') then
    for r in select sa.user_id from student_assignments sa where sa.student_id = new.student_id and sa.is_active loop
      perform app.staff_notify(r.user_id, app.staff_org_for_student(r.user_id, new.student_id),
        case when new.status = 'rejected' then 'document_rejected' else 'document_changes_required' end,
        case when new.status = 'rejected' then 'A document on your student was rejected' else 'A document on your student needs changes' end,
        v_href, 'document', new.id, 'warning', null, true);
    end loop;
  end if;
  return null;
end $$;
create trigger student_documents_staff_notify after update of status on student_documents
  for each row execute function app.staff_notify_document();

create or replace function app.staff_notify_document_file_quarantined() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid;
begin
  if new.scan_status = 'infected' and old.scan_status is distinct from 'infected' then
    select student_id into v_student from student_documents where id = new.student_document_id;
    perform app.staff_notify(new.uploaded_by, app.staff_org_for_student(new.uploaded_by, v_student), 'file_quarantined',
      'A file you uploaded was quarantined by the virus scanner', '/students/' || v_student || '/documents/' || new.student_document_id,
      'document', new.student_document_id, 'critical', 'file_quarantined:' || new.id, true);
  end if;
  return null;
end $$;
create trigger document_files_staff_notify after update of scan_status on document_files
  for each row execute function app.staff_notify_document_file_quarantined();

-- Reader: mark own notifications as read (all of them when p_ids is null). Returns the number changed.
create or replace function app.mark_staff_notifications_read(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); n int;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  update staff_notifications set read_at = now()
   where user_id = v_me and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- System job, daily: one reminder per task and due date. Overdue reminders stop 3 days after the due date, so switching this on
-- doesn't send a message for every old task; the bell's live count still shows all of them.
create or replace function app.staff_notifications_daily() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_before bigint; v_after bigint;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  select count(*) into v_before from staff_notifications where event_key in ('task_due_soon', 'task_overdue');
  for r in select id, org_id, assigned_to, due_date, due_date < current_date as overdue from tasks
            where assigned_to is not null and status not in ('completed', 'cancelled')
              and due_date between current_date - 3 and current_date + 2 loop
    if r.overdue then
      perform app.staff_notify(r.assigned_to, r.org_id, 'task_overdue', 'A task assigned to you is overdue', '/tasks/' || r.id, 'task', r.id, 'warning',
        'task_overdue:' || r.id || ':' || r.due_date, true);
    else
      perform app.staff_notify(r.assigned_to, r.org_id, 'task_due_soon', 'A task assigned to you is due soon', '/tasks/' || r.id, 'task', r.id, 'info',
        'task_due_soon:' || r.id || ':' || r.due_date, false);
    end if;
  end loop;
  select count(*) into v_after from staff_notifications where event_key in ('task_due_soon', 'task_overdue');
  return jsonb_build_object('reminders', v_after - v_before);
end $$;

-- System job, every run: claim emails. Each is delivered once; a claim abandoned for 15 minutes returns to the queue, and mail
-- older than 24 hours is skipped rather than sent late. Only addresses of active accounts are returned.
create or replace function app.staff_notification_email_claim(p_limit int) returns table (id uuid, to_email text, title text, href text, attempts int)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  update staff_notifications n set email_status = 'pending', email_claimed_at = null
   where n.email_status = 'sending' and n.email_claimed_at < now() - interval '15 minutes';
  update staff_notifications n set email_status = 'skipped', email_next_attempt_at = null
   where n.email_status = 'pending' and n.created_at < now() - interval '24 hours';
  update staff_notifications n set email_status = 'skipped', email_next_attempt_at = null
    from user_profiles u where u.id = n.user_id and n.email_status = 'pending' and u.account_status <> 'active';
  return query
    with due as (
      select n.id from staff_notifications n
       where n.email_status = 'pending' and n.email_next_attempt_at <= now()
       order by n.email_next_attempt_at
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
       for update skip locked)
    update staff_notifications n set email_status = 'sending', email_claimed_at = now(), email_attempts = n.email_attempts + 1
      from due, user_profiles u
     where n.id = due.id and u.id = n.user_id
    returning n.id, u.email::text, n.title, n.href, n.email_attempts;
end $$;

-- p_outcome: sent, skipped (test mode or not deliverable), retry (temporary failure; failed after 5 attempts).
create or replace function app.staff_notification_email_finish(p_id uuid, p_outcome text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  if p_outcome not in ('sent', 'skipped', 'retry') then raise exception 'invalid outcome' using errcode = '22023'; end if;
  update staff_notifications n set
    email_status = case when p_outcome = 'retry' then (case when n.email_attempts >= 5 then 'failed' else 'pending' end) else p_outcome end,
    email_next_attempt_at = case when p_outcome = 'retry' and n.email_attempts < 5 then now() + (n.email_attempts * n.email_attempts) * interval '5 minutes' end,
    email_claimed_at = null,
    emailed_at = case when p_outcome = 'sent' then now() end
   where n.id = p_id and n.email_status = 'sending';
end $$;

-- ---------------------------------------------------------------------------
-- Secure file storage
-- ---------------------------------------------------------------------------
create table secure_files (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id),
  context_type      text not null check (context_type in ('task')),
  context_id        uuid not null,
  storage_key       text not null unique,
  original_filename text not null check (length(btrim(original_filename)) between 1 and 120),
  mime_type         text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes        bigint not null check (size_bytes between 1 and 10485760),
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status       text not null default 'not_scanned' check (scan_status in ('not_scanned', 'clean', 'scan_failed', 'infected')),
  scan_engine       text,
  scan_detail       text,
  scanned_at        timestamptz,
  uploaded_by       uuid not null references user_profiles(id),
  uploaded_at       timestamptz not null default now(),
  removed_by        uuid references user_profiles(id),
  removed_at        timestamptz
);
create index secure_files_context_idx on secure_files (context_type, context_id, uploaded_at) where removed_at is null;
create index secure_files_rescan_idx on secure_files (scanned_at nulls first) where scan_status in ('not_scanned', 'scan_failed');

-- Same conditions as the tasks_select and tasks_update policies. These functions run as the owner, where those policies don't
-- apply, so the conditions are stated here. A task linked to a student also needs read access to that student, because an
-- attachment can hold that student's data even when the task itself is visible.
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

alter table secure_files enable row level security;
create policy secure_files_select on secure_files for select to erp_app
  using (removed_at is null and app.is_member(org_id) and app.secure_file_can_read(context_type, context_id));
-- The storage key and scan detail are not readable. No insert, update or delete: only the functions below change rows.
grant select (id, org_id, context_type, context_id, original_filename, mime_type, size_bytes, scan_status, scanned_at, uploaded_by, uploaded_at, removed_at)
  on secure_files to erp_app;

-- Before storing bytes: returns the company for the storage key, or refuses.
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

-- Every access is audited. Infected files are never served. The audit action is the existing one, so the bulk-access alert counts these too.
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

-- Removes a file from use. The bytes stay in storage until a retention rule is decided. Uploader, or staff who can manage all tasks.
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

-- System context (scanner result). Infected is final; a failed re-scan never downgrades a clean file.
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

-- System job, daily. Least recently tried first, so a file that keeps failing can't hold back the others.
create or replace function app.secure_files_to_rescan(p_limit int) returns table (storage_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  return query select f.storage_key from secure_files f
    where f.scan_status in ('not_scanned', 'scan_failed') and f.removed_at is null
    order by f.scanned_at nulls first, f.uploaded_at limit least(greatest(coalesce(p_limit, 50), 1), 500);
end $$;

-- ---------------------------------------------------------------------------
-- Function access: nothing for PUBLIC; only what the application calls is granted
-- ---------------------------------------------------------------------------
revoke execute on function app.staff_org_for_student(uuid, uuid), app.staff_notify(uuid, uuid, text, text, text, text, uuid, text, text, boolean),
  app.staff_notify_task(), app.staff_notify_task_comment(), app.student_document_approvers(uuid), app.staff_notify_document(),
  app.staff_notify_document_file_quarantined(), app.mark_staff_notifications_read(uuid[]), app.staff_notifications_daily(),
  app.staff_notification_email_claim(int), app.staff_notification_email_finish(uuid, text), app.secure_file_can_read(text, uuid),
  app.secure_file_can_write(text, uuid), app.secure_file_upload_org(text, uuid), app.register_secure_file(text, uuid, text, text, text, bigint, text),
  app.authorize_secure_file_download(uuid), app.remove_secure_file(uuid), app.record_secure_file_scan(text, text, text, text), app.secure_files_to_rescan(int)
  from public;
grant execute on function app.mark_staff_notifications_read(uuid[]), app.staff_notifications_daily(), app.staff_notification_email_claim(int),
  app.staff_notification_email_finish(uuid, text), app.secure_file_can_read(text, uuid), app.secure_file_can_write(text, uuid),
  app.secure_file_upload_org(text, uuid), app.register_secure_file(text, uuid, text, text, text, bigint, text), app.authorize_secure_file_download(uuid),
  app.remove_secure_file(uuid), app.record_secure_file_scan(text, text, text, text), app.secure_files_to_rescan(int)
  to erp_app;
