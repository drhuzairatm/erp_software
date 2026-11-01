-- =============================================================================
-- 0025 Student portal v2 (Phase 6, approved by the MD on 1 Nov 2026)
--
-- * Password login: one account per student record, created by staff
--   (portal.accounts.manage). Login with the Student ID, or with the email
--   address once it is VERIFIED. Setup and reset links are single-use and
--   expire; links are never kept readable in the outbox. 5 failed attempts lock
--   the account for 15 minutes. The one-time code login stays available.
-- * Document publication: staff (documents.publish) publish APPROVED documents
--   to the portal; every download is logged (append-only) and audited.
-- * Portal notifications: in-portal notices for document results, courier
--   instructions, publications and stage changes (read/unread).
-- * Payment view: per company setting portal_show_payments (default OFF); the
--   student sees only their own entries and balance.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('portal.accounts.manage', 'Students', 'Create, disable and re-send student portal password accounts', false),
  ('documents.publish', 'Documents', 'Publish approved documents to the student portal', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, v.p from roles r join (values ('manager', 'portal.accounts.manage'), ('counsellor', 'portal.accounts.manage'),
  ('manager', 'documents.publish'), ('documentation', 'documents.publish')) v(k, p) on r.key = v.k
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Accounts
-- -----------------------------------------------------------------------------
create table auth_private.student_accounts (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null unique references students(id),
  password_hash    text,
  status           text not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  failed_attempts  int not null default 0,
  locked_until     timestamptz,
  password_set_at  timestamptz,
  last_login_at    timestamptz,
  disabled_reason  text,
  created_by       uuid references user_profiles(id),
  created_at       timestamptz not null default now(),
  check (status <> 'active' or password_hash is not null)
);

create table auth_private.student_account_tokens (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth_private.student_accounts(id),
  token_hash  text not null unique,
  purpose     text not null check (purpose in ('setup', 'reset')),
  created_by  uuid references user_profiles(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index student_account_tokens_idx on auth_private.student_account_tokens (account_id, created_at desc);

-- Staff view of an account (no secrets)
create or replace function app.portal_account_info(p_student uuid)
returns table (status text, created_at timestamptz, password_set_at timestamptz, last_login_at timestamptz, locked boolean, disabled_reason text,
               open_link_expires timestamptz, can_manage boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.status, a.created_at, a.password_set_at, a.last_login_at, coalesce(a.locked_until > now(), false), a.disabled_reason,
         (select max(t.expires_at) from auth_private.student_account_tokens t where t.account_id = a.id and t.used_at is null and t.expires_at > now()),
         app.can_on_student(p_student, 'portal.accounts.manage')
    from auth_private.student_accounts a
   where a.student_id = p_student and app.can_read_student(p_student)
$$;

-- Create the account (or re-issue a setup / reset link). Sends it by email only to a VERIFIED address;
-- otherwise returns 'link' so staff can hand the link over personally.
create or replace function app.issue_portal_account_link(p_student uuid, p_token_hash text, p_link text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s students%rowtype; v_a auth_private.student_accounts%rowtype; v_tpl uuid; v_purpose text;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'portal.accounts.manage') then raise exception 'permission denied: portal.accounts.manage' using errcode = '42501'; end if;
  select * into v_s from students where id = p_student for update;
  if v_s.status = 'merged' or v_s.archived_at is not null then raise exception 'this record is archived or merged' using errcode = '23514'; end if;
  select * into v_a from auth_private.student_accounts where student_id = p_student;
  if not found then
    insert into auth_private.student_accounts (student_id, created_by) values (p_student, app.current_user_id()) returning * into v_a;
  elsif v_a.status = 'disabled' then
    raise exception 'the portal account is disabled; enable it first' using errcode = '23514';
  end if;
  if (select count(*) from auth_private.student_account_tokens where account_id = v_a.id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many links issued; try again later' using errcode = '23514';
  end if;
  v_purpose := case when v_a.password_hash is null then 'setup' else 'reset' end;
  -- older open links stop working
  update auth_private.student_account_tokens set used_at = now() where account_id = v_a.id and used_at is null;
  insert into auth_private.student_account_tokens (account_id, token_hash, purpose, created_by, expires_at)
  values (v_a.id, p_token_hash, v_purpose, app.current_user_id(), now() + interval '72 hours');
  perform app.add_event_internal(p_student, v_s.originating_org_id, 'student', 'portal_account',
    case v_purpose when 'setup' then 'Student portal account: set-up link issued' else 'Student portal account: password reset link issued' end, 'students', p_student::text);
  perform app.audit('portal_account_link', 'student_accounts', v_a.id::text, v_s.originating_org_id, p_student, null, jsonb_build_object('purpose', v_purpose));
  if v_s.email is not null and v_s.email_status = 'verified' then
    select id into v_tpl from notification_templates
     where org_id = v_s.originating_org_id and name = 'Portal account set-up' and channel = 'email' and is_active limit 1;
    if v_tpl is not null then
      insert into notification_messages (org_id, student_id, event_key, template_id, channel, recipient_type, to_address, params, status)
      values (v_s.originating_org_id, p_student, 'portal_account_setup', v_tpl, 'email', 'student', v_s.email, jsonb_build_object('link', p_link), 'queued');
      return 'emailed';
    end if;
  end if;
  return 'link';
end $$;

create or replace function app.set_portal_account_status(p_student uuid, p_enabled boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'portal.accounts.manage') then raise exception 'permission denied: portal.accounts.manage' using errcode = '42501'; end if;
  if not p_enabled and coalesce(btrim(p_reason), '') = '' then raise exception 'give the reason for disabling' using errcode = '23514'; end if;
  update auth_private.student_accounts
     set status = case when p_enabled then case when password_hash is null then 'invited' else 'active' end else 'disabled' end,
         disabled_reason = case when p_enabled then null else btrim(p_reason) end, failed_attempts = 0, locked_until = null
   where student_id = p_student;
  if not found then raise exception 'no portal account' using errcode = 'P0002'; end if;
  if not p_enabled then
    update auth_private.portal_sessions set revoked_at = now() where p_student = any(student_ids) and revoked_at is null;
    update auth_private.student_account_tokens t set used_at = now() from auth_private.student_accounts a
     where a.id = t.account_id and a.student_id = p_student and t.used_at is null;
  end if;
  select originating_org_id into v_org from students where id = p_student;
  perform app.add_event_internal(p_student, v_org, 'student', 'portal_account',
    case when p_enabled then 'Student portal account enabled' else 'Student portal account disabled: ' || btrim(p_reason) end, 'students', p_student::text);
end $$;

-- Public: open a setup/reset link → returns the student code (to show) or null
create or replace function app.portal_link_check(p_token_hash text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select s.student_code from auth_private.student_account_tokens t join auth_private.student_accounts a on a.id = t.account_id
    join students s on s.id = a.student_id
   where t.token_hash = p_token_hash and t.used_at is null and t.expires_at > now() and a.status <> 'disabled'
$$;

-- Public: set the password with a valid link (hash computed by the application with argon2id)
create or replace function app.portal_set_password(p_token_hash text, p_password_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t auth_private.student_account_tokens%rowtype; v_a auth_private.student_accounts%rowtype; v_code text; v_org uuid;
begin
  select * into v_t from auth_private.student_account_tokens where token_hash = p_token_hash for update;
  if not found or v_t.used_at is not null or v_t.expires_at < now() then return null; end if;
  select * into v_a from auth_private.student_accounts where id = v_t.account_id for update;
  if v_a.status = 'disabled' then return null; end if;
  if p_password_hash !~ '^\$argon2id\$' then raise exception 'invalid password hash' using errcode = '23514'; end if;
  update auth_private.student_account_tokens set used_at = now() where id = v_t.id;
  update auth_private.student_accounts set password_hash = p_password_hash, status = 'active', password_set_at = now(),
         failed_attempts = 0, locked_until = null where id = v_a.id;
  update auth_private.portal_sessions set revoked_at = now() where v_a.student_id = any(student_ids) and revoked_at is null;
  select student_code, originating_org_id into v_code, v_org from students where id = v_a.student_id;
  perform app.add_event_internal(v_a.student_id, v_org, 'student', 'portal_account', 'Student set a portal password', 'students', v_a.student_id::text);
  perform app.audit('portal_password_set', 'student_accounts', v_a.id::text, v_org, v_a.student_id, null, jsonb_build_object('purpose', v_t.purpose));
  return v_code;
end $$;

-- Public: candidates for a password login (Student ID, or VERIFIED email). Hashes only for active, unlocked accounts.
create or replace function app.portal_password_candidates(p_identifier text)
returns table (account_id uuid, password_hash text, locked boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, case when coalesce(a.locked_until, '-infinity') <= now() then a.password_hash end, coalesce(a.locked_until > now(), false)
    from auth_private.student_accounts a join students s on s.id = a.student_id
   where a.status = 'active' and s.status <> 'merged' and s.archived_at is null
     and (upper(s.student_code) = upper(btrim(p_identifier))
          or (position('@' in p_identifier) > 0 and s.email_status = 'verified' and s.email_normalized = lower(btrim(p_identifier))))
   limit 5
$$;

-- Public: record the outcome; on success opens a portal session for the matched records
create or replace function app.portal_password_result(p_identifier text, p_ok uuid[], p_failed uuid[], p_token_hash text, p_ip text, p_user_agent text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_students uuid[];
begin
  update auth_private.student_accounts set failed_attempts = failed_attempts + 1,
         locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
   where id = any(coalesce(p_failed, '{}')) and status = 'active';
  if coalesce(cardinality(p_ok), 0) = 0 then
    perform app.audit('portal_login_failed', 'portal', null, null, null, null, null, 'denied',
                      jsonb_build_object('ip', p_ip, 'method', 'password', 'identifier', left(lower(btrim(p_identifier)), 3) || '…'));
    return false;
  end if;
  update auth_private.student_accounts set failed_attempts = 0, locked_until = null, last_login_at = now()
   where id = any(p_ok) and status = 'active' and coalesce(locked_until, '-infinity') <= now();
  select array_agg(student_id) into v_students from auth_private.student_accounts where id = any(p_ok) and status = 'active';
  if coalesce(cardinality(v_students), 0) = 0 then return false; end if;
  insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id, ip, user_agent)
  values (p_token_hash, v_students, case when cardinality(v_students) = 1 then v_students[1] end, p_ip, left(p_user_agent, 300));
  perform app.audit('portal_login', 'portal', null, null, v_students[1], null, null, 'success', jsonb_build_object('ip', p_ip, 'method', 'password'));
  return true;
end $$;

-- Public: "forgot password" – emails a reset link to the VERIFIED address of active accounts. Reveals nothing.
create or replace function app.portal_request_reset(p_identifier text, p_token_hash text, p_link text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_tpl uuid;
begin
  for r in select a.id, s.id as student_id, s.originating_org_id as org, s.email from auth_private.student_accounts a join students s on s.id = a.student_id
            where a.status = 'active' and s.email_status = 'verified' and s.email is not null and s.archived_at is null and s.status <> 'merged'
              and (upper(s.student_code) = upper(btrim(p_identifier)) or s.email_normalized = lower(btrim(p_identifier)))
            limit 1 loop
    continue when (select count(*) from auth_private.student_account_tokens where account_id = r.id and created_at > now() - interval '1 hour') >= 3;
    select id into v_tpl from notification_templates where org_id = r.org and name = 'Portal password reset' and channel = 'email' and is_active limit 1;
    continue when v_tpl is null;
    update auth_private.student_account_tokens set used_at = now() where account_id = r.id and used_at is null;
    insert into auth_private.student_account_tokens (account_id, token_hash, purpose, expires_at) values (r.id, p_token_hash, 'reset', now() + interval '1 hour');
    insert into notification_messages (org_id, student_id, event_key, template_id, channel, recipient_type, to_address, params, status)
    values (r.org, r.student_id, 'portal_password_reset', v_tpl, 'email', 'student', r.email, jsonb_build_object('link', p_link), 'queued');
    perform app.audit('portal_password_reset_requested', 'student_accounts', r.id::text, r.org, r.student_id, null, null);
  end loop;
end $$;

-- Links never stay readable in the outbox; only staff with outbox access see these messages
create or replace function app.finish_notification(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text,
                                                   p_subject text, p_body text, p_retry_in_seconds int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event text; v_student uuid; v_secret boolean;
begin
  if p_status not in ('sent', 'failed', 'skipped', 'test', 'queued') then raise exception 'invalid status'; end if;
  select event_key, student_id into v_event, v_student from notification_messages where id = p_id;
  v_secret := v_event in ('portal_login_code', 'email_verification', 'portal_account_setup', 'portal_password_reset') and p_status in ('sent', 'failed', 'skipped');
  update notification_messages set
    status = p_status, provider = p_provider, provider_message_id = p_provider_id, last_error = left(p_error, 1000),
    subject = coalesce(p_subject, subject),
    body = case when v_secret then regexp_replace(regexp_replace(coalesce(p_body, body), '\d{6}', '••••••', 'g'), 'token=[A-Za-z0-9_-]+', 'token=••••', 'g')
                else coalesce(p_body, body) end,
    params = case when v_secret then params - 'code' - 'link' else params end,
    skip_reason = case when p_status = 'skipped' then left(p_error, 200) else skip_reason end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    next_attempt_at = case when p_status = 'queued' then now() + make_interval(secs => greatest(p_retry_in_seconds, 30)) else next_attempt_at end
  where id = p_id and status = 'sending';
  if v_event = 'email_verification' and p_status in ('failed', 'skipped') and v_student is not null then
    perform set_config('app.email_verify', 'on', true);
    update students set email_status = 'failed' where id = v_student and email_status = 'pending';
    perform set_config('app.email_verify', 'off', true);
  end if;
end $$;
drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (app.has_perm(org_id, 'notifications.view')
         or (event_key not in ('portal_login_code', 'email_verification', 'portal_account_setup', 'portal_password_reset')
             and student_id is not null and app.can_on_student(student_id, 'students.contact.view')));

-- -----------------------------------------------------------------------------
-- Portal notices (in-portal notifications)
-- -----------------------------------------------------------------------------
create table portal_notices (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id),
  kind        text not null check (kind in ('document', 'courier', 'publication', 'stage', 'account')),
  title       text not null check (length(title) <= 200),
  body        text check (body is null or length(body) <= 1000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index portal_notices_idx on portal_notices (student_id, created_at desc);

create or replace function app.portal_notify(p_student uuid, p_kind text, p_title text, p_body text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into portal_notices (student_id, kind, title, body) values (p_student, p_kind, left(p_title, 200), left(p_body, 1000))
$$;

create or replace function app.portal_notice_on_document() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'changes_required', 'rejected') then return null; end if;
  select t.name || case when new.label <> '' then ' – ' || new.label else '' end into v_name from document_types t where t.id = new.document_type_id;
  perform app.portal_notify(new.student_id, 'document',
    case new.status when 'approved' then v_name || ' approved' when 'changes_required' then v_name || ': changes needed' else v_name || ' not accepted' end,
    case when new.status <> 'approved' then 'Reason: ' || coalesce(new.rejection_reason, '—') || '. Please upload a new scan.' end);
  return null;
end $$;
create trigger student_documents_portal_notice after update of status on student_documents
  for each row execute function app.portal_notice_on_document();

create or replace function app.portal_notice_on_shipment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.portal_notify(new.student_id, 'courier', 'Please send your original documents',
    'Your scans are approved. The delivery address and instructions are under "Sending your original documents".');
  return null;
end $$;
create trigger original_shipments_portal_notice after insert on original_shipments
  for each row execute function app.portal_notice_on_shipment();

create or replace function app.portal_notice_on_stage() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.portal_notify(new.student_id, 'stage', 'Your application moved to: ' || (select name from stages where key = new.to_stage), null);
  return null;
end $$;
create trigger student_stage_history_portal_notice after insert on student_stage_history
  for each row execute function app.portal_notice_on_stage();

create or replace function app.portal_notices(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'created_at', n.created_at, 'read', n.read_at is not null)
                            order by n.created_at desc), '[]')
    from (select * from portal_notices where student_id = app.portal_student(p_token_hash) order by created_at desc limit 30) n
$$;

create or replace function app.portal_mark_notices_read(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update portal_notices set read_at = now() where student_id = app.portal_student(p_token_hash) and read_at is null
$$;

-- -----------------------------------------------------------------------------
-- Document publication and controlled downloads
-- -----------------------------------------------------------------------------
create table portal_publications (
  id                   uuid primary key default gen_random_uuid(),
  student_id           uuid not null references students(id),
  student_document_id  uuid not null references student_documents(id),
  file_id              uuid not null references document_files(id),
  title                text not null check (length(btrim(title)) between 2 and 200),
  published_by         uuid not null references user_profiles(id),
  published_at         timestamptz not null default now(),
  unpublished_by       uuid references user_profiles(id),
  unpublished_at       timestamptz,
  unpublish_reason     text
);
create unique index portal_publications_open on portal_publications (student_document_id) where unpublished_at is null;
create trigger portal_publications_audit after insert or update on portal_publications
  for each row execute function app.audit_row('', 'student_id');

create table portal_downloads (
  id              bigint generated always as identity primary key,
  publication_id  uuid not null references portal_publications(id),
  downloaded_at   timestamptz not null default now(),
  ip              text
);
create trigger portal_downloads_immutable before update or delete on portal_downloads for each row execute function app.audit_immutable();

create or replace function app.publish_document(p_document uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d student_documents%rowtype; v_id uuid; v_org uuid; v_title text;
begin
  select * into v_d from student_documents where id = p_document for update;
  if not found or not app.can_read_student(v_d.student_id) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_d.student_id, 'documents.publish') then raise exception 'permission denied: documents.publish' using errcode = '42501'; end if;
  if v_d.status <> 'approved' or coalesce(v_d.approved_file_id, v_d.current_file_id) is null then
    raise exception 'only approved documents can be published' using errcode = '23514';
  end if;
  if exists (select 1 from portal_publications where student_document_id = p_document and unpublished_at is null) then
    raise exception 'this document is already published' using errcode = '23514';
  end if;
  v_title := coalesce(nullif(btrim(p_title), ''), (select name from document_types where id = v_d.document_type_id) || case when v_d.label <> '' then ' – ' || v_d.label else '' end);
  insert into portal_publications (student_id, student_document_id, file_id, title, published_by)
  values (v_d.student_id, p_document, coalesce(v_d.approved_file_id, v_d.current_file_id), v_title, app.current_user_id()) returning id into v_id;
  select originating_org_id into v_org from students where id = v_d.student_id;
  perform app.add_event_internal(v_d.student_id, v_org, 'document', 'published', v_title || ' published to the student portal', 'portal_publications', v_id::text);
  perform app.portal_notify(v_d.student_id, 'publication', 'New document available: ' || v_title, 'You can download it under "Documents from us".');
  return v_id;
end $$;

create or replace function app.unpublish_document(p_publication uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p portal_publications%rowtype; v_org uuid;
begin
  select * into v_p from portal_publications where id = p_publication for update;
  if not found or not app.can_read_student(v_p.student_id) then raise exception 'publication not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_p.student_id, 'documents.publish') then raise exception 'permission denied: documents.publish' using errcode = '42501'; end if;
  if v_p.unpublished_at is not null then raise exception 'already withdrawn' using errcode = '23514'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give the reason for withdrawing' using errcode = '23514'; end if;
  update portal_publications set unpublished_at = now(), unpublished_by = app.current_user_id(), unpublish_reason = btrim(p_reason) where id = p_publication;
  select originating_org_id into v_org from students where id = v_p.student_id;
  perform app.add_event_internal(v_p.student_id, v_org, 'document', 'unpublished', v_p.title || ' withdrawn from the student portal: ' || btrim(p_reason), 'portal_publications', p_publication::text);
end $$;

create or replace function app.portal_publications(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'published_at', p.published_at, 'mime', f.mime_type) order by p.published_at desc), '[]')
    from portal_publications p join document_files f on f.id = p.file_id
   where p.student_id = app.portal_student(p_token_hash) and p.unpublished_at is null
$$;

-- Download: only the signed-in student's own, currently published files; logged and audited
create or replace function app.portal_download(p_token_hash text, p_publication uuid, p_ip text)
returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p portal_publications%rowtype; v_student uuid := app.portal_student(p_token_hash);
begin
  select * into v_p from portal_publications where id = p_publication;
  if v_student is null or not found or v_p.student_id <> v_student or v_p.unpublished_at is not null then
    perform app.audit('portal_download', 'portal_publications', p_publication::text, null, v_student, null, null, 'denied', jsonb_build_object('ip', p_ip));
    return;
  end if;
  insert into portal_downloads (publication_id, ip) values (p_publication, p_ip);
  perform app.audit('portal_download', 'portal_publications', p_publication::text, null, v_student, null, null, 'success', jsonb_build_object('ip', p_ip));
  return query select f.storage_key, f.mime_type, f.original_filename from document_files f where f.id = v_p.file_id;
end $$;

-- -----------------------------------------------------------------------------
-- Payment view (company setting portal_show_payments, default off)
-- -----------------------------------------------------------------------------
create or replace function app.portal_payments(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with st as (select s.id, s.originating_org_id from students s where s.id = app.portal_student(p_token_hash)),
       ok as (select st.* from st join organizations o on o.id = st.originating_org_id where coalesce((o.settings ->> 'portal_show_payments')::boolean, false))
  select case when not exists (select 1 from ok) then null else jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', e.entry_date, 'type', e.entry_type, 'category', fc.name, 'amount', e.amount,
                                   'currency', e.currency, 'status', e.verification_status, 'reference', e.receipt_ref) order by e.entry_date desc, e.recorded_at desc)
                           from payment_entries e join fee_categories fc on fc.id = e.fee_category_id, ok
                          where e.student_id = ok.id and e.ledger = 'service' and e.entry_type in ('charge', 'receipt', 'refund', 'waiver')
                            and e.verification_status in ('verified', 'not_required', 'pending')), '[]'),
    'balances', coalesce((select jsonb_agg(jsonb_build_object('currency', b.currency, 'due', b.amount_due, 'received', b.amount_received, 'outstanding', b.outstanding,
                                   'pending', b.pending_receipts))
                            from (select currency, sum(due_effect) as amount_due, sum(received_effect) as amount_received,
                                         sum(due_effect) - sum(received_effect) as outstanding, sum(pending_receipts) as pending_receipts
                                    from payment_entry_effects, ok where student_id = ok.id and ledger = 'service' group by currency) b), '[]'))
  end
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table portal_notices enable row level security;
alter table portal_publications enable row level security;
alter table portal_downloads enable row level security;
create policy portal_notices_select on portal_notices for select to erp_app using (app.can_read_student(student_id));
create policy portal_publications_select on portal_publications for select to erp_app using (app.can_read_student(student_id));
create policy portal_downloads_select on portal_downloads for select to erp_app
  using (exists (select 1 from portal_publications p where p.id = publication_id and app.can_read_student(p.student_id)));
grant select on portal_notices, portal_publications, portal_downloads to erp_app;
revoke all on function app.portal_notify(uuid, text, text, text) from public;
grant execute on function
  app.portal_account_info(uuid), app.issue_portal_account_link(uuid, text, text), app.set_portal_account_status(uuid, boolean, text),
  app.portal_link_check(text), app.portal_set_password(text, text), app.portal_password_candidates(text),
  app.portal_password_result(text, uuid[], uuid[], text, text, text), app.portal_request_reset(text, text, text),
  app.portal_notices(text), app.portal_mark_notices_read(text), app.publish_document(uuid, text), app.unpublish_document(uuid, text),
  app.portal_publications(text), app.portal_download(text, uuid, text), app.portal_payments(text)
to erp_app;
