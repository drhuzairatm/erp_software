-- Phase 1 completion: announcements, notification preferences, manual clearance of secure files, and secure file contexts that later
-- modules plug into. Additive except where stated: staff_notify gains a preference check, and the checks on event, subject and scan status widen.
--
-- Each secure file context has three small functions: app.sf_<context>_org, _read and _write. Dispatch is in plpgsql, so a context's
-- functions are resolved when used, and the context check on secure_files decides which contexts can exist at all.

alter table staff_notifications drop constraint staff_notifications_event_key_check;
alter table staff_notifications add constraint staff_notifications_event_key_check check (event_key ~ '^[a-z][a-z_]{1,60}$');
alter table staff_notifications drop constraint staff_notifications_subject_type_check;
alter table staff_notifications add constraint staff_notifications_subject_type_check check (subject_type ~ '^[a-z][a-z_]{1,40}$');

alter table secure_files drop constraint secure_files_scan_status_check;
alter table secure_files add constraint secure_files_scan_status_check check (scan_status in ('not_scanned', 'clean', 'scan_failed', 'infected', 'manually_cleared'));
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee'));
alter table secure_files
  add column cleared_by uuid references user_profiles(id),
  add column cleared_at timestamptz,
  add column clear_reason text check (clear_reason is null or length(btrim(clear_reason)) between 5 and 500);
grant select (cleared_at) on secure_files to erp_app;

insert into permissions (key, category, description, is_sensitive) values
  ('announcements.publish', 'Notifications', 'Publish and withdraw management announcements to all staff of a company', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
  select r.id, 'announcements.publish' from roles r where r.key in ('md', 'ceo', 'manager') on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Preferences. Critical notifications and announcements always arrive.
-- ---------------------------------------------------------------------------
create table staff_notification_preferences (
  user_id    uuid not null references user_profiles(id),
  category   text not null check (category in ('tasks', 'documents', 'attendance', 'meetings', 'chat', 'verification', 'tickets')),
  in_app     boolean not null default true,
  email      boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);
alter table staff_notification_preferences enable row level security;
create policy staff_notification_preferences_select on staff_notification_preferences for select to erp_app using (user_id = app.current_user_id());
grant select on staff_notification_preferences to erp_app;

create or replace function app.staff_notification_category(p_event text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_event like 'task\_%' then 'tasks'
    when p_event like 'document\_%' then 'documents'
    when p_event like 'attendance\_%' then 'attendance'
    when p_event like 'meeting\_%' then 'meetings'
    when p_event like 'chat\_%' then 'chat'
    when p_event like 'dvr\_%' then 'verification'
    when p_event like 'ticket\_%' then 'tickets'
  end
$$;

create or replace function app.staff_notify(p_user uuid, p_org uuid, p_event text, p_title text, p_href text, p_subject_type text, p_subject uuid,
                                            p_severity text, p_dedupe text, p_email boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_in_app boolean := true; v_email boolean := p_email; v_cat text := app.staff_notification_category(p_event);
begin
  if p_user is null or p_org is null or p_user is not distinct from app.current_user_id() then return; end if;
  if not app.user_is_active_member(p_user, p_org) then return; end if;
  if v_cat is not null and p_severity <> 'critical' then
    select pr.in_app, pr.email and p_email into v_in_app, v_email from staff_notification_preferences pr where pr.user_id = p_user and pr.category = v_cat;
    if not found then v_in_app := true; v_email := p_email; end if;
  end if;
  if not v_in_app then return; end if;
  insert into staff_notifications (user_id, org_id, event_key, title, href, subject_type, subject_id, severity, dedupe_key, email_status, email_next_attempt_at)
  values (p_user, p_org, p_event, p_title, p_href, p_subject_type, p_subject, p_severity, p_dedupe,
          case when v_email then 'pending' else 'none' end, case when v_email then now() end)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
exception when others then
  raise warning 'staff notification not created: %', sqlstate;
end $$;

create or replace function app.set_my_notification_preference(p_category text, p_in_app boolean, p_email boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if v_me is null then raise exception 'permission denied' using errcode = '42501'; end if;
  insert into staff_notification_preferences (user_id, category, in_app, email) values (v_me, p_category, p_in_app, p_email)
  on conflict (user_id, category) do update set in_app = excluded.in_app, email = excluded.email, updated_at = now();
  perform app.audit('notification_preference_changed', 'user_profiles', v_me::text, null, null, null,
    jsonb_build_object('category', p_category, 'in_app', p_in_app, 'email', p_email));
end $$;

-- ---------------------------------------------------------------------------
-- Management announcements. Each active member of the company gets a notification.
-- ---------------------------------------------------------------------------
create table staff_announcements (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id),
  title        text not null check (length(btrim(title)) between 3 and 150),
  body         text not null check (length(btrim(body)) between 3 and 4000),
  severity     text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  published_by uuid not null references user_profiles(id),
  published_at timestamptz not null default now(),
  withdrawn_by uuid references user_profiles(id),
  withdrawn_at timestamptz
);
create index staff_announcements_org_idx on staff_announcements (org_id, published_at desc);
alter table staff_announcements enable row level security;
create policy staff_announcements_select on staff_announcements for select to erp_app
  using (app.is_member(org_id) and (withdrawn_at is null or app.has_perm(org_id, 'announcements.publish')));
grant select on staff_announcements to erp_app;

create or replace function app.publish_announcement(p_org uuid, p_title text, p_body text, p_severity text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_me uuid := app.current_user_id(); r record;
begin
  if v_me is null or not app.has_perm(p_org, 'announcements.publish') then raise exception 'permission denied: announcements' using errcode = '42501'; end if;
  insert into staff_announcements (org_id, title, body, severity, published_by) values (p_org, btrim(p_title), btrim(p_body), p_severity, v_me) returning id into v_id;
  for r in select m.user_id from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active where m.org_id = p_org and m.is_active loop
    perform app.staff_notify(r.user_id, p_org, 'announcement_published', 'New announcement from management', '/announcements', 'announcement', v_id, p_severity,
      'announcement:' || v_id, p_severity <> 'info');
  end loop;
  perform app.audit('announcement_published', 'staff_announcements', v_id::text, p_org, null, null, jsonb_build_object('title', btrim(p_title), 'severity', p_severity));
  return v_id;
end $$;

create or replace function app.withdraw_announcement(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select org_id into v_org from staff_announcements where id = p_id and withdrawn_at is null for update;
  if v_org is null then raise exception 'announcement not found' using errcode = 'P0002'; end if;
  if not app.has_perm(v_org, 'announcements.publish') then raise exception 'permission denied: announcements' using errcode = '42501'; end if;
  update staff_announcements set withdrawn_at = now(), withdrawn_by = app.current_user_id() where id = p_id;
  perform app.audit('announcement_withdrawn', 'staff_announcements', p_id::text, v_org, null, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Secure file contexts
-- ---------------------------------------------------------------------------
create or replace function app.sf_task_org(p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select org_id from tasks where id = p_context $$;
create or replace function app.sf_task_read(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from tasks t where t.id = p_context
     and (app.has_perm(t.org_id, 'tasks.read.all')
          or ((t.assigned_to = app.current_user_id() or t.created_by = app.current_user_id()) and app.has_perm(t.org_id, 'tasks.read.own')))
     and (t.student_id is null or app.can_read_student(t.student_id)))
$$;
create or replace function app.sf_task_write(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.sf_task_read(p_context) and exists (select 1 from tasks t where t.id = p_context
     and (app.has_perm(t.org_id, 'tasks.update.all') or app.has_perm(t.org_id, 'tasks.assign')
          or ((t.assigned_to = app.current_user_id() or t.created_by = app.current_user_id()) and app.has_perm(t.org_id, 'tasks.update.own'))))
$$;

-- An employee's own documents: the person, or someone who manages staff in a company they belong to.
create or replace function app.sf_employee_org(p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id from organization_memberships m where m.user_id = p_context and m.is_active
   order by (m.user_id = app.current_user_id() or app.has_perm(m.org_id, 'users.manage')) desc, m.org_id limit 1
$$;
create or replace function app.sf_employee_read(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_context = app.current_user_id()
      or exists (select 1 from organization_memberships m where m.user_id = p_context and app.has_perm(m.org_id, 'users.manage'))
$$;
create or replace function app.sf_employee_write(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select app.sf_employee_read(p_context) $$;

-- Plain dispatch by context. Later modules add a branch when they add their context.
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

create or replace function app.secure_file_upload_org(p_context_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if not app.secure_file_can_write(p_context_type, p_context) then raise exception 'permission denied: secure file upload' using errcode = '42501'; end if;
  v_org := app.sf_org(p_context_type, p_context);
  if v_org is null then raise exception 'permission denied: secure file upload' using errcode = '42501'; end if;
  return v_org;
end $$;

-- The student a file relates to, for the audit entry (only tasks have one).
create or replace function app.sf_student(p_type text, p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select t.student_id from tasks t where p_type = 'task' and t.id = p_context
$$;

create or replace function app.register_secure_file(p_context_type text, p_context uuid, p_key text, p_filename text, p_mime text, p_size bigint, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t tasks%rowtype; v_id uuid; v_me uuid := app.current_user_id(); v_org uuid;
begin
  if v_me is null or not app.secure_file_can_write(p_context_type, p_context) then raise exception 'permission denied: secure file upload' using errcode = '42501'; end if;
  v_org := app.sf_org(p_context_type, p_context);
  if p_key not like 'org/' || v_org || '/secure/' || p_context_type || '/' || p_context || '/%' then raise exception 'invalid storage key' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('secure_files:' || p_context, 0));
  if (select count(*) from secure_files f where f.context_type = p_context_type and f.context_id = p_context and f.removed_at is null) >= 20 then
    raise exception 'This record already has 20 files. Remove one before adding another.' using errcode = '23514';
  end if;
  insert into secure_files (org_id, context_type, context_id, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
  values (v_org, p_context_type, p_context, p_key, p_filename, p_mime, p_size, p_sha256, v_me)
  returning id into v_id;
  perform app.audit('secure_file_uploaded', 'secure_files', v_id::text, v_org, app.sf_student(p_context_type, p_context), null,
    jsonb_build_object('context_type', p_context_type, 'context_id', p_context, 'size_bytes', p_size, 'mime_type', p_mime));
  if p_context_type = 'task' then
    select * into v_t from tasks where id = p_context;
    perform app.staff_notify(v_t.assigned_to, v_t.org_id, 'task_file_added', 'A file was added to a task', '/tasks/' || v_t.id, 'task', v_t.id, 'info', null, false);
    if v_t.created_by is distinct from v_t.assigned_to then
      perform app.staff_notify(v_t.created_by, v_t.org_id, 'task_file_added', 'A file was added to a task', '/tasks/' || v_t.id, 'task', v_t.id, 'info', null, false);
    end if;
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
  v_student := app.sf_student(v_f.context_type, v_f.context_id);
  if v_f.scan_status = 'infected' then
    perform app.audit('file_download', 'secure_files', p_file::text, v_f.org_id, v_student, null, null, 'denied', jsonb_build_object('reason', 'quarantined'));
    return;
  end if;
  perform app.audit('file_download', 'secure_files', p_file::text, v_f.org_id, v_student, null, jsonb_build_object('scan_status', v_f.scan_status));
  return query select v_f.storage_key, v_f.mime_type, v_f.original_filename;
end $$;

create or replace function app.remove_secure_file(p_file uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v_f from secure_files f where f.id = p_file and f.removed_at is null for update;
  if not found or not app.secure_file_can_read(v_f.context_type, v_f.context_id) then raise exception 'file not found' using errcode = 'P0002'; end if;
  if not ((v_f.uploaded_by = v_me and app.secure_file_can_write(v_f.context_type, v_f.context_id))
          or (v_f.context_type = 'task' and app.has_perm(v_f.org_id, 'tasks.update.all'))
          or (v_f.context_type = 'employee' and app.has_perm(v_f.org_id, 'users.manage'))) then
    raise exception 'permission denied: secure file removal' using errcode = '42501';
  end if;
  update secure_files set removed_at = now(), removed_by = v_me where id = p_file;
  perform app.audit('secure_file_removed', 'secure_files', p_file::text, v_f.org_id, app.sf_student(v_f.context_type, v_f.context_id), null,
    jsonb_build_object('context_type', v_f.context_type, 'context_id', v_f.context_id));
end $$;

-- A later scan overrides a manual clearance; infected is final.
create or replace function app.record_secure_file_scan(p_storage_key text, p_status text, p_engine text, p_detail text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_href text;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  if p_status not in ('clean', 'infected', 'scan_failed') then raise exception 'invalid scan status' using errcode = '22023'; end if;
  select * into v_f from secure_files f where f.storage_key = p_storage_key for update;
  if not found or v_f.scan_status = 'infected' then return v_f.id; end if;
  if p_status = 'scan_failed' and v_f.scan_status in ('clean', 'manually_cleared') then return v_f.id; end if;
  update secure_files set scan_status = p_status, scan_engine = left(p_engine, 60), scan_detail = left(p_detail, 300), scanned_at = now() where id = v_f.id;
  perform app.audit(case when p_status = 'infected' then 'malware_detected' else 'file_scanned' end, 'secure_files', v_f.id::text, v_f.org_id, app.sf_student(v_f.context_type, v_f.context_id),
    jsonb_build_object('scan_status', v_f.scan_status), jsonb_build_object('scan_status', p_status, 'engine', p_engine, 'detail', left(p_detail, 300)),
    case when p_status = 'infected' then 'denied' else 'success' end, '{}'::jsonb, v_f.uploaded_by);
  if p_status = 'infected' then
    v_href := case v_f.context_type when 'task' then '/tasks/' || v_f.context_id else '/my-notifications' end;
    perform app.staff_notify(v_f.uploaded_by, v_f.org_id, 'file_quarantined', 'A file you uploaded was quarantined by the virus scanner',
      v_href, v_f.context_type, v_f.context_id, 'critical', 'file_quarantined:' || v_f.id, true);
  end if;
  return v_f.id;
end $$;

-- Manual clearance: only for a file the scanner has not passed, never an infected one; needs the existing sensitive permission and a reason.
create or replace function app.clear_secure_file_manually(p_file uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_me uuid := app.current_user_id(); v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_f from secure_files f where f.id = p_file and f.removed_at is null for update;
  if not found or not app.secure_file_can_read(v_f.context_type, v_f.context_id) then raise exception 'file not found' using errcode = 'P0002'; end if;
  if not app.has_perm(v_f.org_id, 'documents.security_clear') then raise exception 'permission denied: security clearance' using errcode = '42501'; end if;
  if v_f.scan_status not in ('not_scanned', 'scan_failed') then raise exception 'Only a file that has not been scanned or whose scan failed can be cleared.' using errcode = '23514'; end if;
  if v_f.uploaded_by = v_me then raise exception 'Someone other than the uploader must clear this file.' using errcode = '42501'; end if;
  if length(v_reason) < 5 then raise exception 'Give the reason for the clearance.' using errcode = '23514'; end if;
  update secure_files set scan_status = 'manually_cleared', cleared_by = v_me, cleared_at = now(), clear_reason = left(v_reason, 500) where id = p_file;
  perform app.audit('secure_file_manually_cleared', 'secure_files', p_file::text, v_f.org_id, app.sf_student(v_f.context_type, v_f.context_id),
    jsonb_build_object('scan_status', v_f.scan_status), jsonb_build_object('scan_status', 'manually_cleared', 'reason', left(v_reason, 500)));
end $$;

create or replace function app.secure_file_upload_download_history(p_context_type text, p_context uuid)
returns table (occurred_at timestamptz, action text, outcome text, file_id text, actor text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.secure_file_can_write(p_context_type, p_context) then raise exception 'permission denied: file history' using errcode = '42501'; end if;
  return query select l.occurred_at, l.action, l.outcome::text, l.entity_id, u.full_name
    from secure_files f join audit_logs l on l.entity_type = 'secure_files' and l.entity_id = f.id::text
    left join user_profiles u on u.id = l.actor_user_id
   where f.context_type = p_context_type and f.context_id = p_context
   order by l.occurred_at desc limit 100;
end $$;

revoke execute on function app.staff_notification_category(text), app.set_my_notification_preference(text, boolean, boolean),
  app.publish_announcement(uuid, text, text, text), app.withdraw_announcement(uuid),
  app.sf_task_org(uuid), app.sf_task_read(uuid), app.sf_task_write(uuid), app.sf_employee_org(uuid), app.sf_employee_read(uuid), app.sf_employee_write(uuid),
  app.sf_org(text, uuid), app.sf_student(text, uuid), app.clear_secure_file_manually(uuid, text), app.secure_file_upload_download_history(text, uuid) from public;
grant execute on function app.set_my_notification_preference(text, boolean, boolean), app.publish_announcement(uuid, text, text, text), app.withdraw_announcement(uuid),
  app.clear_secure_file_manually(uuid, text), app.secure_file_upload_download_history(text, uuid) to erp_app;

create trigger staff_announcements_audit after insert or update on staff_announcements for each row execute function app.audit_row('org_id', '');
