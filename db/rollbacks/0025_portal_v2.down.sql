-- Undo 0025 (portal v2). WARNING: deletes student portal accounts and links, portal notices, publications and their
-- download log, and queued account e-mails. Uploaded files and documents are not touched. Back up first (npm run db:backup).

drop trigger student_documents_portal_notice on student_documents;
drop trigger original_shipments_portal_notice on original_shipments;
drop trigger student_stage_history_portal_notice on student_stage_history;
drop function app.portal_notice_on_document();
drop function app.portal_notice_on_shipment();
drop function app.portal_notice_on_stage();

drop function app.portal_payments(text);
drop function app.portal_download(text, uuid, text);
drop function app.portal_publications(text);
drop function app.unpublish_document(uuid, text);
drop function app.publish_document(uuid, text);
drop function app.portal_mark_notices_read(text);
drop function app.portal_notices(text);
drop function app.portal_notify(uuid, text, text, text);
drop function app.portal_request_reset(text, text, text);
drop function app.portal_password_result(text, uuid[], uuid[], text, text, text);
drop function app.portal_password_candidates(text);
drop function app.portal_set_password(text, text);
drop function app.portal_link_check(text);
drop function app.set_portal_account_status(uuid, boolean, text);
drop function app.issue_portal_account_link(uuid, text, text);
drop function app.portal_account_info(uuid);

drop table portal_downloads;
drop table portal_publications;
drop table portal_notices;
drop table auth_private.student_account_tokens;
drop table auth_private.student_accounts;

delete from notification_messages where event_key in ('portal_account_setup', 'portal_password_reset');

-- restore finish_notification and the outbox policy (0019)
create or replace function app.finish_notification(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text,
                                                   p_subject text, p_body text, p_retry_in_seconds int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event text; v_student uuid; v_secret boolean;
begin
  if p_status not in ('sent', 'failed', 'skipped', 'test', 'queued') then raise exception 'invalid status'; end if;
  select event_key, student_id into v_event, v_student from notification_messages where id = p_id;
  v_secret := v_event in ('portal_login_code', 'email_verification') and p_status in ('sent', 'failed', 'skipped');
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
         or (event_key not in ('portal_login_code', 'email_verification') and student_id is not null and app.can_on_student(student_id, 'students.contact.view')));

delete from role_permissions where permission_key in ('portal.accounts.manage', 'documents.publish');
delete from permissions where key in ('portal.accounts.manage', 'documents.publish');
