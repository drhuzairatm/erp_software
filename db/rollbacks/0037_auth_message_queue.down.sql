-- Undo 0037 (N-8 secure authentication message queue). WARNING: rolling back re-opens finding N-8 (portal sign-in codes
-- and email-verification links are queued in notification_messages again, readable by notifications.view holders in
-- test mode, while waiting for a retry and, for emailed codes, in the subject in every status).
-- Queued messages in the secure queue are lost (students request a new code / staff resend the verification).
-- Secrets scrubbed from legacy messages and codes / links invalidated by 0037 are NOT restored (intentionally).
-- The application must be rolled back to a version that sends plain codes / links (the restored functions accept any text).
-- The two replaced functions and the replaced policy are restored EXACTLY as they were before 0037 (definitions exported
-- from the database with pg_get_functiondef; execute permissions are unchanged by CREATE OR REPLACE). Back up first.

drop trigger if exists portal_challenges_revoke_message on auth_private.portal_challenges;
drop trigger if exists email_verifications_revoke_message on auth_private.email_verifications;
drop trigger if exists students_revoke_auth_messages on students;
drop trigger if exists notification_messages_no_auth_secrets on notification_messages;

drop function if exists app.auth_message_claim(int);
drop function if exists app.auth_message_finish(uuid, text, text, text, text);
drop function if exists app.auth_message_housekeeping();
drop function if exists app.auth_message_log(uuid[], uuid, text, text, text, int);
drop function if exists app.auth_challenge_revoke_message();
drop function if exists app.auth_verification_revoke_message();
drop function if exists app.auth_contact_revoke_message();
drop function if exists app.notification_messages_no_auth_secrets();

drop table if exists auth_private.auth_message_outbox;

drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (event_key not in ('portal_account_setup', 'portal_password_reset')
         and (app.has_perm(org_id, 'notifications.view')
              or (event_key not in ('portal_login_code', 'email_verification')
                  and student_id is not null and app.can_on_student(student_id, 'students.contact.view'))));

CREATE OR REPLACE FUNCTION app.portal_request_code(p_identifier text, p_code text, p_code_hash text, p_ip text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$

;

CREATE OR REPLACE FUNCTION app.request_email_verification(p_student uuid, p_token_hash text, p_link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_s students%rowtype; v_tpl uuid;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'students.contact.view') or not app.can_on_student(p_student, 'students.update') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_s from students where id = p_student for update;
  if v_s.email is null then raise exception 'the student has no email address' using errcode = '23514'; end if;
  if v_s.email_status = 'verified' then raise exception 'this email address is already verified' using errcode = '23514'; end if;
  if (select count(*) from auth_private.email_verifications where student_id = p_student and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'too many verification emails; try again later' using errcode = '23514';
  end if;
  select id into v_tpl from notification_templates
   where org_id = v_s.originating_org_id and name = 'Email verification' and channel = 'email' and is_active limit 1;
  if v_tpl is null then raise exception 'the "Email verification" email template is missing or inactive' using errcode = '23514'; end if;
  insert into auth_private.email_verifications (student_id, email_normalized, token_hash, requested_by)
  values (p_student, v_s.email_normalized, p_token_hash, app.current_user_id());
  insert into notification_messages (org_id, student_id, event_key, template_id, channel, recipient_type, to_address, params, status)
  values (v_s.originating_org_id, p_student, 'email_verification', v_tpl, 'email', 'student', v_s.email, jsonb_build_object('link', p_link), 'queued');
  perform set_config('app.email_verify', 'on', true);
  update students set email_status = 'pending', email_verified_at = null where id = p_student;
  perform set_config('app.email_verify', 'off', true);
  perform app.add_event_internal(p_student, v_s.originating_org_id, 'student', 'email_verification_sent', 'Email verification link sent', 'students', p_student::text);
end $function$

;

drop function if exists app.auth_secret_cipher_ok(text);
drop function if exists app.auth_mask_error(text);
