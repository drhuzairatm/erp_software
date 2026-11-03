-- =============================================================================
-- 0016 Phase I: student portal
--
-- Students sign in with a one-time code sent to their registered email or
-- WhatsApp number. They can only ever see their OWN record, through the
-- functions below, which take the session token and never a student id from
-- the browser. No internal notes, staff comments or financial data are exposed.
-- =============================================================================

create table auth_private.portal_challenges (
  id               uuid primary key default gen_random_uuid(),
  identifier_hash  text not null,
  code_hash        text not null,
  student_ids      uuid[] not null default '{}',
  attempts         int not null default 0,
  ip               text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '10 minutes',
  used_at          timestamptz
);
create index portal_challenges_ident_idx on auth_private.portal_challenges (identifier_hash, created_at desc);
create index portal_challenges_ip_idx on auth_private.portal_challenges (ip, created_at desc);

create table auth_private.portal_sessions (
  id                 uuid primary key default gen_random_uuid(),
  token_hash         text not null unique,
  student_ids        uuid[] not null,
  active_student_id  uuid,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '4 hours',
  revoked_at         timestamptz,
  ip                 text,
  user_agent         text
);

-- Portal uploads have no staff uploader / reviewer
alter table document_files alter column uploaded_by drop not null;
alter table document_files add column uploaded_via text not null default 'staff' check (uploaded_via in ('staff', 'portal'));
alter table document_reviews alter column reviewed_by drop not null;
grant select (uploaded_via) on document_files to erp_app;

-- Sign-in code messages: only for staff with outbox permission (not everyone with contact access)
drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (app.has_perm(org_id, 'notifications.view')
         or (event_key <> 'portal_login_code' and student_id is not null and app.can_on_student(student_id, 'students.contact.view')));

-- After a sign-in code has been handed to a provider (or failed/skipped), remove it from the outbox.
create or replace function app.finish_notification(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text,
                                                   p_subject text, p_body text, p_retry_in_seconds int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event text;
begin
  if p_status not in ('sent', 'failed', 'skipped', 'test', 'queued') then raise exception 'invalid status'; end if;
  select event_key into v_event from notification_messages where id = p_id;
  update notification_messages set
    status = p_status, provider = p_provider, provider_message_id = p_provider_id, last_error = left(p_error, 1000),
    subject = coalesce(p_subject, subject),
    body = case when v_event = 'portal_login_code' and p_status in ('sent', 'failed', 'skipped')
                then regexp_replace(coalesce(p_body, body), '\d{6}', '••••••', 'g') else coalesce(p_body, body) end,
    params = case when v_event = 'portal_login_code' and p_status in ('sent', 'failed', 'skipped') then params - 'code' else params end,
    skip_reason = case when p_status = 'skipped' then left(p_error, 200) else skip_reason end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    next_attempt_at = case when p_status = 'queued' then now() + make_interval(secs => greatest(p_retry_in_seconds, 30)) else next_attempt_at end
  where id = p_id and status = 'sending';
end $$;

-- -----------------------------------------------------------------------------
-- Sign-in
-- -----------------------------------------------------------------------------
-- Always returns a challenge id (even when nothing matched) so the response does
-- not reveal whether an email/number is registered. Rate limited per identifier and IP.
create or replace function app.portal_request_code(p_identifier text, p_code text, p_code_hash text, p_ip text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := lower(btrim(p_identifier));
  v_is_email boolean := position('@' in v_id) > 0;
  v_digits text := nullif(right(regexp_replace(v_id, '\D', '', 'g'), 10), '');
  v_hash text := encode(sha256(convert_to(case when v_is_email then v_id else coalesce(v_digits, v_id) end, 'UTF8')), 'hex');
  v_students uuid[];
  v_challenge uuid;
  v_s students%rowtype;
  v_tpl uuid;
begin
  -- rate limits: 5 per identifier per hour, 20 per IP per hour
  if (select count(*) from auth_private.portal_challenges where identifier_hash = v_hash and created_at > now() - interval '1 hour') >= 5
     or (p_ip is not null and (select count(*) from auth_private.portal_challenges where ip = p_ip and created_at > now() - interval '1 hour') >= 20) then
    insert into auth_private.portal_challenges (identifier_hash, code_hash, ip, expires_at) values (v_hash, 'rate-limited', p_ip, now())
    returning id into v_challenge;
    perform app.audit('portal_code_rate_limited', 'portal', null, null, null, null, null, 'denied', jsonb_build_object('ip', p_ip));
    return v_challenge;
  end if;
  select array_agg(id order by created_at) into v_students from students
   where status <> 'merged' and archived_at is null
     and ((v_is_email and email_normalized = v_id) or (not v_is_email and v_digits is not null and length(v_digits) >= 7 and phone_normalized = v_digits));
  insert into auth_private.portal_challenges (identifier_hash, code_hash, student_ids, ip)
  values (v_hash, p_code_hash, coalesce(v_students, '{}'), p_ip) returning id into v_challenge;
  if v_students is not null and cardinality(v_students) > 0 then
    select * into v_s from students where id = v_students[1];
    select id into v_tpl from notification_templates
     where org_id = v_s.originating_org_id and name = 'Portal sign-in code' and channel = case when v_is_email then 'email' else 'whatsapp' end and is_active limit 1;
    insert into notification_messages (org_id, student_id, event_key, template_id, channel, recipient_type, to_address, params, status, skip_reason)
    values (v_s.originating_org_id, v_s.id, 'portal_login_code', v_tpl, case when v_is_email then 'email' else 'whatsapp' end, 'student',
            case when v_is_email then v_s.email else v_s.phone end, jsonb_build_object('code', p_code),
            case when v_tpl is null then 'skipped' else 'queued' end, case when v_tpl is null then 'no sign-in code template' end);
    perform app.audit('portal_code_requested', 'portal', v_challenge::text, v_s.originating_org_id, v_s.id, null, null, 'success', jsonb_build_object('ip', p_ip));
  end if;
  return v_challenge;
end $$;

create or replace function app.portal_verify_code(p_challenge uuid, p_code_hash text, p_token_hash text, p_ip text, p_user_agent text)
returns table (ok boolean, locked boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c auth_private.portal_challenges%rowtype;
begin
  select * into v_c from auth_private.portal_challenges where id = p_challenge for update;
  if not found or v_c.used_at is not null or v_c.expires_at < now() or v_c.attempts >= 5 then
    return query select false, true; return;
  end if;
  if v_c.code_hash <> p_code_hash or cardinality(v_c.student_ids) = 0 then
    update auth_private.portal_challenges set attempts = attempts + 1 where id = p_challenge;
    perform app.audit('portal_login_failed', 'portal', p_challenge::text, null, v_c.student_ids[1], null, null, 'denied', jsonb_build_object('ip', p_ip));
    return query select false, v_c.attempts + 1 >= 5; return;
  end if;
  update auth_private.portal_challenges set used_at = now() where id = p_challenge;
  insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id, ip, user_agent)
  values (p_token_hash, v_c.student_ids, case when cardinality(v_c.student_ids) = 1 then v_c.student_ids[1] end, p_ip, left(p_user_agent, 300));
  perform app.audit('portal_login', 'portal', null, null, v_c.student_ids[1], null, null, 'success', jsonb_build_object('ip', p_ip));
  return query select true, false;
end $$;

-- Valid session (30 minutes idle, 4 hours absolute)
create or replace function app.portal_session(p_token_hash text)
returns table (student_ids uuid[], active_student_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s auth_private.portal_sessions%rowtype;
begin
  select * into v_s from auth_private.portal_sessions
   where token_hash = p_token_hash and revoked_at is null and expires_at > now() and last_seen_at > now() - interval '30 minutes';
  if not found then return; end if;
  update auth_private.portal_sessions set last_seen_at = now() where id = v_s.id and last_seen_at < now() - interval '1 minute';
  return query select v_s.student_ids, v_s.active_student_id;
end $$;

create or replace function app.portal_choose(p_token_hash text, p_student uuid) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  update auth_private.portal_sessions set active_student_id = p_student
   where token_hash = p_token_hash and revoked_at is null and expires_at > now() and p_student = any(student_ids)
  returning true
$$;

create or replace function app.portal_logout(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update auth_private.portal_sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null
$$;

-- The signed-in student's id, or null
create or replace function app.portal_student(p_token_hash text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select s.active_student_id from auth_private.portal_sessions s join students st on st.id = s.active_student_id
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
     and s.last_seen_at > now() - interval '30 minutes' and st.status <> 'merged' and st.archived_at is null
$$;

-- Records available to choose from (same person registered with more than one brand)
create or replace function app.portal_choices(p_token_hash text)
returns table (student_id uuid, student_code text, company text)
language sql stable security definer set search_path = public, pg_temp as $$
  select st.id, st.student_code, o.name
    from auth_private.portal_sessions s cross join unnest(s.student_ids) sid
    join students st on st.id = sid join organizations o on o.id = st.originating_org_id
   where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
     and st.status <> 'merged' and st.archived_at is null
   order by o.name
$$;

-- -----------------------------------------------------------------------------
-- What the student sees (student-friendly; no internal data)
-- -----------------------------------------------------------------------------
create or replace function app.portal_overview(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid := app.portal_student(p_token_hash); v_s students%rowtype; v_cur int;
begin
  if v_id is null then return null; end if;
  select * into v_s from students where id = v_id;
  select ws.sort_order into v_cur from workflow_stages ws where ws.workflow_id = v_s.workflow_id
     and ws.stage_key = coalesce(case when v_s.status = 'on_hold' then v_s.stage_before_hold end, v_s.current_stage_key);
  return jsonb_build_object(
    'student', jsonb_build_object(
      'code', v_s.student_code, 'name', v_s.full_name, 'status', v_s.status,
      'stage', (select name from stages where key = v_s.current_stage_key),
      'next_action', v_s.next_action, 'next_action_due', v_s.next_action_due,
      'destination', (select name from countries where id = v_s.destination_country_id),
      'course', (select name from courses where id = v_s.course_id),
      'university', (select name from universities where id = v_s.preferred_university_id),
      'counsellor', (select u.full_name from student_assignments a join user_profiles u on u.id = a.user_id
                      where a.student_id = v_id and a.is_active and a.assignment_type = 'counsellor' limit 1)),
    'company', (select jsonb_build_object('code', o.code, 'name', o.name,
                       'support_phone', o.settings ->> 'support_phone', 'support_email', o.settings ->> 'support_email')
                  from organizations o where o.id = v_s.originating_org_id),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('name', st.name,
                 'state', case when v_cur is null then 'upcoming' when ws.sort_order < v_cur then 'done'
                               when ws.sort_order = v_cur then case when v_s.status = 'completed' then 'done' else 'current' end else 'upcoming' end)
                 order by ws.sort_order)
                from workflow_stages ws join stages st on st.key = ws.stage_key where ws.workflow_id = v_s.workflow_id), '[]'),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', d.id, 'name', t.name || case when d.label <> '' then ' – ' || d.label else '' end, 'required', d.is_required,
                   'state', case
                     when d.status = 'approved' and d.expiry_date is not null and d.expiry_date < current_date then 'expired'
                     when d.status in ('uploaded', 'under_review', 'verified', 'pending_approval') then 'checking'
                     else d.status end,
                   'reason', case when d.status in ('changes_required', 'rejected', 'expired') then d.rejection_reason end,
                   'can_upload', d.status in ('missing', 'changes_required', 'rejected', 'expired')
                                 or (d.status = 'approved' and d.expiry_date is not null and d.expiry_date < current_date))
                 order by d.is_required desc, t.sort_order)
                from student_documents d join document_types t on t.id = d.document_type_id where d.student_id = v_id), '[]'));
end $$;

-- Upload from the portal: only the signed-in student's own checklist items that need a file.
create or replace function app.portal_upload_target(p_token_hash text, p_document uuid)
returns table (student_id uuid, org_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.student_id, s.originating_org_id from student_documents d join students s on s.id = d.student_id
   where d.id = p_document and d.student_id = app.portal_student(p_token_hash)
     and (d.status in ('missing', 'changes_required', 'rejected', 'expired')
          or (d.status = 'approved' and d.expiry_date is not null and d.expiry_date < current_date))
$$;

create or replace function app.portal_register_document_file(p_token_hash text, p_document uuid, p_storage_key text, p_filename text,
                                                             p_mime text, p_size int, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc student_documents%rowtype; v_type document_types%rowtype; v_version int; v_file uuid; v_org uuid;
begin
  if not exists (select 1 from app.portal_upload_target(p_token_hash, p_document)) then
    raise exception 'this document cannot be uploaded now' using errcode = '42501';
  end if;
  select * into v_doc from student_documents where id = p_document for update;
  select * into v_type from document_types where id = v_doc.document_type_id;
  select coalesce(max(version), 0) + 1 into v_version from document_files where student_document_id = p_document;
  insert into document_files (student_document_id, version, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by, uploaded_via)
  values (p_document, v_version, p_storage_key, p_filename, p_mime, p_size, p_sha256, null, 'portal')
  returning id into v_file;
  perform set_config('app.doc_change', 'on', true);
  update student_documents set current_file_id = v_file, status = 'uploaded', rejection_reason = null,
         reviewed_by = null, reviewed_at = null, verified_by = null, verified_at = null,
         submitted_by = null, submitted_at = null, approved_by = null, approved_at = null, approved_file_id = null
   where id = p_document;
  perform set_config('app.doc_change', 'off', true);
  insert into document_reviews (student_document_id, file_id, from_status, to_status, reviewed_by, reason)
  values (p_document, v_file, v_doc.status, 'uploaded', null, 'Uploaded by the student in the portal');
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'uploaded',
    v_type.name || case when v_doc.label <> '' then ' – ' || v_doc.label else '' end || ' uploaded by the student in the portal (version ' || v_version || ')',
    'student_documents', p_document::text);
  perform app.audit('portal_upload', 'document_files', v_file::text, v_org, v_doc.student_id, null,
                    jsonb_build_object('document_id', p_document, 'version', v_version));
  return v_file;
end $$;

-- Portal sign-in code templates for existing companies (fresh installs get them from provisioning)
insert into notification_templates (org_id, name, channel, subject, body, provider_params)
select o.id, 'Portal sign-in code', c.channel,
       case when c.channel = 'email' then 'Your sign-in code: {{code}}' end,
       case when c.channel = 'email' then 'Your {{company}} student portal sign-in code is {{code}}. It expires in 10 minutes. If you did not ask for it, ignore this message.'
            else 'Your {{company}} student portal code is {{code}}. It expires in 10 minutes.' end,
       case when c.channel = 'whatsapp' then array['code'] else '{}'::text[] end
  from organizations o cross join (values ('email'), ('whatsapp')) c(channel)
on conflict (org_id, name, channel, language) do nothing;

grant execute on function
  app.portal_request_code(text, text, text, text), app.portal_verify_code(uuid, text, text, text, text), app.portal_session(text),
  app.portal_choose(text, uuid), app.portal_logout(text), app.portal_student(text), app.portal_choices(text),
  app.portal_overview(text), app.portal_upload_target(text, uuid), app.portal_register_document_file(text, uuid, text, text, text, int, text)
to erp_app;
