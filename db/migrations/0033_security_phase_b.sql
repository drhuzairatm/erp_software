-- =============================================================================
-- 0033 Security Phase B
--   * virus-scan status on every student document file; quarantine of infected files
--   * MANUAL security clearance (clearly separate from automated scanning), audited, reason required
--   * approval and the physical-courier workflow need a clean scan or manual clearance
--   * security alerts (failed logins, permission/role changes, large or frequent exports, bulk downloads,
--     malware, MD grants, 2FA resets) generated from the append-only audit log
--   * login history and active sessions
--   * 2FA reset only with users.mfa_reset (MD by default) and a reason
-- Additive only; existing files become "not scanned" (nothing pretends they were scanned).
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('documents.security_clear', 'Documents', 'Manually clear a file that has not been virus-scanned (manual security clearance, audited)', true),
  ('security.alerts',          'Security',  'View and acknowledge security alerts; view staff login history', true),
  ('users.mfa_reset',          'Staff',     'Reset another person''s two-factor login (identity must be verified first)', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Scan status
-- ---------------------------------------------------------------------------
alter table document_files
  add column scan_status     text not null default 'not_scanned'
                             check (scan_status in ('not_scanned', 'clean', 'infected', 'scan_failed', 'manually_cleared')),
  add column scan_engine     text check (scan_engine is null or length(scan_engine) <= 60),
  add column scan_detail     text check (scan_detail is null or length(scan_detail) <= 300),
  add column scanned_at      timestamptz,
  add column cleared_by      uuid references user_profiles(id),
  add column cleared_at      timestamptz,
  add column clearance_reason text check (clearance_reason is null or length(clearance_reason) <= 500);
create index document_files_scan_idx on document_files (scan_status) where scan_status <> 'clean';
grant select (scan_status, scan_engine, scan_detail, scanned_at, cleared_by, cleared_at, clearance_reason) on document_files to erp_app;

-- Recorded by the server right after an upload, or by the re-scan job. Identified by the storage key, which
-- only the server knows (the application role cannot read storage keys). "infected" is final.
create or replace function app.record_file_scan(p_storage_key text, p_status text, p_engine text, p_detail text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f document_files%rowtype; v_d student_documents%rowtype; v_org uuid;
begin
  if p_status not in ('clean', 'infected', 'scan_failed') then raise exception 'invalid scan status' using errcode = '22023'; end if;
  select * into v_f from document_files where storage_key = p_storage_key for update;
  if not found or v_f.scan_status = 'infected' then return v_f.id; end if;
  -- a failed re-scan never downgrades a clean or manually cleared file
  if p_status = 'scan_failed' and v_f.scan_status in ('clean', 'manually_cleared') then return v_f.id; end if;
  update document_files set scan_status = p_status, scan_engine = left(p_engine, 60), scan_detail = left(p_detail, 300), scanned_at = now()
   where id = v_f.id;
  select * into v_d from student_documents where id = v_f.student_document_id;
  select originating_org_id into v_org from students where id = v_d.student_id;
  perform app.audit(case when p_status = 'infected' then 'malware_detected' else 'file_scanned' end, 'document_files', v_f.id::text, v_org, v_d.student_id,
    jsonb_build_object('scan_status', v_f.scan_status), jsonb_build_object('scan_status', p_status, 'engine', p_engine, 'detail', left(p_detail, 300)),
    case when p_status = 'infected' then 'denied' else 'success' end, '{}'::jsonb, v_f.uploaded_by);
  return v_f.id;
end $$;

-- Re-scan queue for the daily job (system context only; returns storage keys, so never callable with a signed-in user)
create or replace function app.files_to_rescan(p_limit int) returns table (storage_key text, mime_type text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  return query select f.storage_key, f.mime_type from document_files f
    where f.scan_status in ('not_scanned', 'scan_failed', 'manually_cleared')
    order by f.uploaded_at limit least(greatest(coalesce(p_limit, 50), 1), 500);
end $$;

-- MANUAL security clearance: not a virus scan. Reason required; the clearer cannot be the uploader.
create or replace function app.clear_file_manually(p_file uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f document_files%rowtype; v_d student_documents%rowtype; v_org uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into v_f from document_files where id = p_file for update;
  if not found then raise exception 'file not found' using errcode = 'P0002'; end if;
  select * into v_d from student_documents where id = v_f.student_document_id;
  if not app.can_read_student(v_d.student_id) or not app.can_on_student(v_d.student_id, 'documents.security_clear') then
    raise exception 'permission denied: documents.security_clear' using errcode = '42501';
  end if;
  if v_f.scan_status = 'infected' then raise exception 'An infected (quarantined) file can never be cleared.' using errcode = '23514'; end if;
  if v_f.scan_status not in ('not_scanned', 'scan_failed') then raise exception 'This file does not need manual clearance.' using errcode = '23514'; end if;
  if length(v_reason) < 10 then raise exception 'Give the reason for the manual clearance (at least 10 characters).' using errcode = '23514'; end if;
  if v_f.uploaded_by = app.current_user_id() then raise exception 'You cannot clear a file you uploaded yourself.' using errcode = '42501'; end if;
  update document_files set scan_status = 'manually_cleared', cleared_by = app.current_user_id(), cleared_at = now(), clearance_reason = left(v_reason, 500)
   where id = p_file;
  select originating_org_id into v_org from students where id = v_d.student_id;
  perform app.audit('file_manual_security_clearance', 'document_files', p_file::text, v_org, v_d.student_id,
    jsonb_build_object('scan_status', v_f.scan_status),
    jsonb_build_object('scan_status', 'manually_cleared', 'reason', left(v_reason, 500), 'note', 'MANUAL clearance – not an automated virus scan'));
end $$;

-- Gate 1: approval needs a clean scan or manual clearance of the file being approved
create or replace function app.document_scan_gate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select scan_status into v_s from document_files where id = coalesce(new.approved_file_id, new.current_file_id);
    if v_s is distinct from 'clean' and v_s is distinct from 'manually_cleared' then
      raise exception 'This file has not passed a virus scan or manual security clearance, so it cannot be approved (scan status: %).', coalesce(v_s, 'none')
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger student_documents_scan_gate before update of status on student_documents
  for each row execute function app.document_scan_gate();

-- Gate 2: original-document courier instructions only when the uploaded file is scanned clean or manually cleared
create or replace function app.courier_scan_gate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s text;
begin
  -- a document with an uploaded file needs a clean scan or manual clearance of that file; a document with no uploaded
  -- file (original sent under the existing, audited courier exception) has nothing digital to scan
  select f.scan_status into v_s from student_documents d join document_files f on f.id = coalesce(d.approved_file_id, d.current_file_id)
   where d.id = new.student_document_id;
  if found and v_s not in ('clean', 'manually_cleared') then
    raise exception 'Courier instructions are not available: a document file has not passed a virus scan or manual security clearance.' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger original_shipment_items_scan_gate before insert on original_shipment_items
  for each row execute function app.courier_scan_gate();

-- Quarantine: infected files can never be downloaded (staff, merge or portal)
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
  if v_file.scan_status = 'infected' then
    perform app.audit('file_download', 'document_files', p_file::text, v_org, v_doc.student_id, null, null, 'denied', jsonb_build_object('reason', 'quarantined'));
    return;
  end if;
  perform app.audit('file_download', 'document_files', p_file::text, v_org, v_doc.student_id, null,
                    jsonb_build_object('version', v_file.version, 'document_id', v_doc.id, 'scan_status', v_file.scan_status));
  return query select v_file.storage_key, v_file.mime_type, v_file.original_filename;
end $$;

create or replace function app.portal_download(p_token_hash text, p_publication uuid, p_ip text)
returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p portal_publications%rowtype; v_student uuid := app.portal_student(p_token_hash);
begin
  select * into v_p from portal_publications where id = p_publication;
  if v_student is null or not found or v_p.student_id <> v_student or v_p.unpublished_at is not null
     or (select scan_status from document_files where id = v_p.file_id) = 'infected' then
    perform app.audit('portal_download', 'portal_publications', p_publication::text, null, v_student, null, null, 'denied', jsonb_build_object('ip', p_ip));
    return;
  end if;
  insert into portal_downloads (publication_id, ip) values (p_publication, p_ip);
  perform app.audit('portal_download', 'portal_publications', p_publication::text, null, v_student, null, null, 'success', jsonb_build_object('ip', p_ip));
  return query select f.storage_key, f.mime_type, f.original_filename from document_files f where f.id = v_p.file_id;
end $$;

-- ---------------------------------------------------------------------------
-- Security alerts (generated in the database from the append-only audit log)
-- ---------------------------------------------------------------------------
create table security_alerts (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  severity        text not null check (severity in ('info', 'warning', 'high', 'critical')),
  title           text not null,
  details         jsonb not null default '{}'::jsonb,
  subject_key     text,                   -- what the alert is about (email, user, ip) – used to group repeats
  actor_user_id   uuid references user_profiles(id),
  org_id          uuid references organizations(id),
  occurrences     int not null default 1,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  acknowledged_by uuid references user_profiles(id),
  acknowledged_at timestamptz,
  ack_note        text check (ack_note is null or length(ack_note) <= 500),
  emailed_at      timestamptz
);
create index security_alerts_open_idx on security_alerts (acknowledged_at, last_seen_at desc);
create index security_alerts_group_idx on security_alerts (kind, subject_key, last_seen_at desc);

alter table security_alerts enable row level security;
create policy security_alerts_select on security_alerts for select to erp_app
  using (exists (select 1 from app.orgs_with_perm('security.alerts')));
grant select on security_alerts to erp_app;

-- raise (or group into an open alert of the same kind/subject from the last hour)
create or replace function app.raise_security_alert(p_kind text, p_severity text, p_title text, p_subject text, p_details jsonb, p_actor uuid, p_org uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from security_alerts
   where kind = p_kind and subject_key is not distinct from p_subject and acknowledged_at is null and last_seen_at > now() - interval '1 hour'
   order by last_seen_at desc limit 1;
  if v_id is not null then
    update security_alerts set occurrences = occurrences + 1, last_seen_at = now(), details = p_details,
           severity = case when p_severity = 'critical' or severity = 'critical' then 'critical'
                           when p_severity = 'high' or severity = 'high' then 'high' else severity end
     where id = v_id;
  else
    insert into security_alerts (kind, severity, title, subject_key, details, actor_user_id, org_id)
    values (p_kind, p_severity, p_title, p_subject, coalesce(p_details, '{}'), p_actor, p_org);
  end if;
end $$;

create or replace function app.audit_security_alerts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; v_email text; v_sens boolean; v_name text;
begin
  if new.action = 'login_failed' then
    v_email := new.metadata ->> 'email';
    select count(*) into n from auth_private.login_attempts where lower(email) = v_email and not success and attempted_at > now() - interval '15 minutes';
    if n >= 5 then
      perform app.raise_security_alert('repeated_failed_logins', case when n >= 10 then 'high' else 'warning' end,
        'Repeated failed sign-ins for ' || v_email, 'email:' || v_email, jsonb_build_object('email', v_email, 'failures_15_min', n, 'ip', new.request_ip), null, null);
    end if;
    if new.request_ip is not null then
      select count(*) into n from auth_private.login_attempts where ip = new.request_ip and not success and attempted_at > now() - interval '15 minutes';
      if n >= 20 then
        perform app.raise_security_alert('failed_logins_from_ip', 'high', 'Many failed sign-ins from one address', 'ip:' || new.request_ip,
          jsonb_build_object('ip', new.request_ip, 'failures_15_min', n), null, null);
      end if;
    end if;
  elsif new.action = 'mfa_failed' then
    perform app.raise_security_alert('mfa_failures', 'warning', 'Wrong two-factor codes entered', 'user:' || coalesce(new.actor_user_id::text, '?'),
      jsonb_build_object('ip', new.request_ip), new.actor_user_id, null);
  elsif new.action = 'export' then
    if new.outcome = 'denied' then
      perform app.raise_security_alert('export_denied', 'warning', 'Export refused (no permission)', 'user:' || coalesce(new.actor_user_id::text, '?'),
        jsonb_build_object('report', new.entity_id), new.actor_user_id, new.org_id);
    else
      if coalesce((new.metadata ->> 'rows')::int, 0) >= 500 then
        perform app.raise_security_alert('large_export', 'high', 'Large data export (' || (new.metadata ->> 'rows') || ' rows)', 'user:' || coalesce(new.actor_user_id::text, '?'),
          jsonb_build_object('report', new.entity_id, 'rows', (new.metadata ->> 'rows')::int, 'pii', new.metadata -> 'pii', 'finance', new.metadata -> 'finance'), new.actor_user_id, new.org_id);
      end if;
      select count(*) into n from audit_logs where action = 'export' and outcome = 'success' and actor_user_id = new.actor_user_id and occurred_at > now() - interval '1 hour';
      if n >= 10 then
        perform app.raise_security_alert('frequent_exports', 'warning', 'Unusually many exports by one person', 'user:' || coalesce(new.actor_user_id::text, '?'),
          jsonb_build_object('exports_last_hour', n), new.actor_user_id, new.org_id);
      end if;
    end if;
  elsif new.action = 'file_download' and new.outcome = 'success' and new.actor_user_id is not null then
    select count(*) into n from audit_logs where action = 'file_download' and outcome = 'success' and actor_user_id = new.actor_user_id and occurred_at > now() - interval '1 hour';
    if n >= 100 then
      perform app.raise_security_alert('bulk_downloads', 'high', 'Unusually many document downloads by one person', 'user:' || new.actor_user_id,
        jsonb_build_object('downloads_last_hour', n), new.actor_user_id, new.org_id);
    end if;
  elsif new.action = 'malware_detected' then
    perform app.raise_security_alert('malware_detected', 'critical', 'Malware detected in an uploaded file (quarantined)', 'file:' || coalesce(new.entity_id, '?'),
      jsonb_build_object('entity', new.entity_type, 'id', new.entity_id, 'detail', new.after_data -> 'detail', 'student_id', new.student_id), new.actor_user_id, new.org_id);
  elsif new.action = 'file_manual_security_clearance' then
    perform app.raise_security_alert('manual_clearance', 'info', 'Files released by MANUAL security clearance (not virus-scanned)', 'clearer:' || coalesce(new.actor_user_id::text, '?'),
      jsonb_build_object('last_file', new.entity_id, 'reason', new.after_data -> 'reason', 'student_id', new.student_id), new.actor_user_id, new.org_id);
  elsif new.entity_type = 'role_permissions' and new.action in ('grant', 'revoke') then
    v_name := new.after_data ->> 'permission';
    select is_sensitive into v_sens from permissions where key = v_name;
    perform app.raise_security_alert('permission_change', case when v_sens then 'high' else 'warning' end,
      'Role permission ' || case when new.action = 'grant' then 'granted' else 'removed' end || ': ' || coalesce(v_name, '?'),
      'role:' || coalesce(new.entity_id, '?'),
      jsonb_build_object('permission', v_name, 'change', new.action, 'role_id', new.entity_id), new.actor_user_id, new.org_id);
  elsif new.entity_type = 'organization_memberships' and (new.action = 'insert'
        or (new.action = 'update' and (new.before_data ->> 'role_id' is distinct from new.after_data ->> 'role_id'
                                       or new.before_data ->> 'is_active' is distinct from new.after_data ->> 'is_active'))) then
    perform app.raise_security_alert('role_assignment', 'warning', 'Staff role or company access changed', 'user:' || coalesce(new.after_data ->> 'user_id', '?'),
      jsonb_build_object('user_id', new.after_data ->> 'user_id', 'from_role', new.before_data ->> 'role_id', 'to_role', new.after_data ->> 'role_id',
                         'active', new.after_data ->> 'is_active'), new.actor_user_id, new.org_id);
  elsif new.action = 'md_role_granted' then
    perform app.raise_security_alert('md_role_granted', 'critical', 'MD (super-admin) role granted', 'user:' || new.entity_id,
      new.metadata, new.actor_user_id, new.org_id);
  elsif new.action = 'mfa_reset_by_admin' then
    perform app.raise_security_alert('mfa_reset', 'high', 'Two-factor login reset by an administrator', 'user:' || new.entity_id,
      jsonb_build_object('reason', new.metadata ->> 'reason'), new.actor_user_id, null);
  elsif new.action = 'staff_status_changed' then
    perform app.raise_security_alert('staff_status_changed', 'info', 'Staff account ' || coalesce(new.after_data ->> 'account_status', 'changed'), 'user:' || new.entity_id,
      new.after_data, new.actor_user_id, null);
  end if;
  return null;
end $$;
create trigger audit_logs_security_alerts after insert on audit_logs
  for each row execute function app.audit_security_alerts();

create or replace function app.acknowledge_security_alert(p_alert uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('security.alerts')) then raise exception 'permission denied: security.alerts' using errcode = '42501'; end if;
  update security_alerts set acknowledged_by = app.current_user_id(), acknowledged_at = now(), ack_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_alert and acknowledged_at is null;
  if not found then raise exception 'alert not found or already acknowledged' using errcode = 'P0002'; end if;
  perform app.audit('security_alert_acknowledged', 'security_alerts', p_alert::text);
end $$;

-- alerts to email (system job): high/critical, not yet emailed; recipients = active holders of security.alerts
create or replace function app.security_alerts_to_email() returns table (alert_id uuid, severity text, title text, created_at timestamptz, recipients text[])
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  return query select a.id, a.severity, a.title, a.created_at,
    array(select distinct u.email from user_profiles u join organization_memberships m on m.user_id = u.id and m.is_active
            where u.account_status = 'active' and app.role_has_perm(m.role_id, 'security.alerts'))
    from security_alerts a where a.emailed_at is null and a.acknowledged_at is null and a.severity in ('high', 'critical') order by a.created_at limit 20;
end $$;
create or replace function app.mark_alerts_emailed(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  update security_alerts set emailed_at = now() where id = any(p_ids);
end $$;
create or replace function app.role_has_perm(p_role uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from role_permissions where role_id = p_role and permission_key = p_perm)
$$;

-- ---------------------------------------------------------------------------
-- Login history and active sessions (own, people within your authority, or security.alerts holders)
-- ---------------------------------------------------------------------------
create or replace function app.can_see_login_history(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user = app.current_user_id() or app.can_administer_user(p_user)
      or (exists (select 1 from app.orgs_with_perm('security.alerts')) and app.shares_org_with(p_user))
$$;

create or replace function app.login_history(p_user uuid, p_limit int) returns table (occurred_at timestamptz, event text, outcome text, ip text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_email text;
begin
  if not app.can_see_login_history(p_user) then raise exception 'permission denied' using errcode = '42501'; end if;
  select lower(email) into v_email from user_profiles where id = p_user;
  return query
    select l.occurred_at, l.action, l.outcome, l.request_ip from audit_logs l
     where ((l.actor_user_id = p_user and l.action in ('login', 'logout', 'mfa_verified', 'mfa_failed', 'mfa_recovery_code_used', 'mfa_enabled',
                                                        'password_changed', 'password_reset_completed', 'sessions_revoked', 'staff_invitation_accepted'))
            or (l.action = 'login_failed' and l.metadata ->> 'email' = v_email)
            or (l.entity_type = 'user_profiles' and l.entity_id = p_user::text and l.action in ('mfa_reset_by_admin', 'sessions_revoked', 'staff_status_changed')))
     order by l.occurred_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

create or replace function app.active_sessions(p_user uuid) returns table (created_at timestamptz, last_seen_at timestamptz, ip text, user_agent text, two_factor_pending boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not app.can_see_login_history(p_user) then raise exception 'permission denied' using errcode = '42501'; end if;
  return query select s.created_at, s.last_seen_at, s.ip, s.user_agent, s.mfa_pending from auth_private.sessions s
    where s.user_id = p_user and s.revoked_at is null and s.expires_at > now() and s.last_seen_at > now() - interval '8 hours'
    order by s.last_seen_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- 2FA reset: needs users.mfa_reset (MD by default) in a company of the person, plus a reason. No ordinary bypass.
-- ---------------------------------------------------------------------------
drop function app.mfa_admin_reset(uuid);
create or replace function app.mfa_admin_reset(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.can_administer_user(p_user)
     or not exists (select 1 from organization_memberships m where m.user_id = p_user and app.has_perm(m.org_id, 'users.mfa_reset')) then
    raise exception 'permission denied: users.mfa_reset' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Record how the person''s identity was verified (at least 10 characters).' using errcode = '23514';
  end if;
  delete from auth_private.mfa where user_id = p_user;
  delete from auth_private.mfa_recovery_codes where user_id = p_user;
  update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  perform app.audit('mfa_reset_by_admin', 'user_profiles', p_user::text, null, null, null, null, 'success', jsonb_build_object('reason', left(btrim(p_reason), 500)));
end $$;

grant execute on function app.record_file_scan(text, text, text, text), app.files_to_rescan(int), app.clear_file_manually(uuid, text),
  app.acknowledge_security_alert(uuid, text), app.security_alerts_to_email(), app.mark_alerts_emailed(uuid[]),
  app.can_see_login_history(uuid), app.login_history(uuid, int), app.active_sessions(uuid), app.mfa_admin_reset(uuid, text) to erp_app;
