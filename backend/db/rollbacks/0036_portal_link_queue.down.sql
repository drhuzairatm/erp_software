-- Undo 0036 (N-7 secure portal link queue). WARNING: rolling back re-opens finding N-7 (portal set-up and reset links
-- are queued in notification_messages again, readable by notifications.view holders while queued and in test mode).
-- Queued portal link emails in the secure queue are lost (issue new links). Links scrubbed from legacy messages and
-- links invalidated by 0036 are NOT restored (intentionally: they may have been exposed). Back up first.
-- The three replaced functions and the replaced policy are restored EXACTLY as they were before 0036 (definitions
-- exported from the database with pg_get_functiondef; execute permissions are unchanged by CREATE OR REPLACE).

drop trigger if exists student_account_tokens_revoke_email on auth_private.student_account_tokens;
drop trigger if exists notification_messages_no_portal_links on notification_messages;

drop function if exists app.portal_email_claim(int);
drop function if exists app.portal_email_finish(uuid, text, text, text, text);
drop function if exists app.portal_email_housekeeping();
drop function if exists app.portal_email_status(uuid);
drop function if exists app.portal_token_revoke_email();
drop function if exists app.notification_messages_no_portal_links();

drop table if exists auth_private.portal_email_outbox;

drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (app.has_perm(org_id, 'notifications.view')
         or (event_key not in ('portal_login_code', 'email_verification', 'portal_account_setup', 'portal_password_reset')
             and student_id is not null and app.can_on_student(student_id, 'students.contact.view')));

CREATE OR REPLACE FUNCTION app.issue_portal_account_link(p_student uuid, p_token_hash text, p_link text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$

;

CREATE OR REPLACE FUNCTION app.portal_request_reset(p_identifier text, p_token_hash text, p_link text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$

;

CREATE OR REPLACE FUNCTION app.finish_notification(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text, p_subject text, p_body text, p_retry_in_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$

;

drop function if exists app.portal_link_cipher_ok(text);
