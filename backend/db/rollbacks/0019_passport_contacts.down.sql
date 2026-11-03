-- Undo 0019 (passport records, phones, contact history, email verification). Removes only what 0019 added.
-- WARNING: deletes passport version history, follow-ups, contact history, secondary/third phones,
-- email verification status, passport validity rules and automatic passport tasks. Back up first (npm run db:backup).
-- students.passport_* (the current passport summary) is kept.

-- restore outbox policy and finish_notification (0016)
drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (app.has_perm(org_id, 'notifications.view')
         or (event_key <> 'portal_login_code' and student_id is not null and app.can_on_student(student_id, 'students.contact.view')));
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

-- restore the student view (0018)
drop view v_students;
create view v_students with (security_barrier = true) as
select s.id, s.student_code, s.originating_org_id, s.processing_org_id, s.lead_source_id, s.full_name,
       case when p.pii then s.phone end as phone,
       case when p.pii then s.email end as email,
       case when p.pii then s.phone_normalized end as phone_normalized,
       case when p.pii then s.email_normalized end as email_normalized,
       case when s.phone_normalized is not null then '••••••' || right(s.phone_normalized, 2) end as phone_masked,
       case when s.email_normalized is not null then left(s.email_normalized, 1) || '•••@' || split_part(s.email_normalized, '@', 2) end as email_masked,
       case when p.pii then s.date_of_birth end as date_of_birth,
       p.pii as contact_visible,
       s.preferred_language, s.destination_country_id, s.course_id, s.preferred_university_id,
       s.highest_qualification, s.qualification_board, s.qualification_year, s.qualification_score,
       s.entrance_exam, s.entrance_score, s.academic_notes, s.registration_date, s.workflow_id,
       s.current_stage_key, s.stage_before_hold, s.stage_changed_at, s.status, s.next_action, s.next_action_due,
       s.contracting_entity_id, s.payment_recipient_entity_id, s.university_application_ref, s.admission_letter_date,
       s.visa_appointment_date, s.visa_outcome, s.visa_reference, s.merged_into_id, s.archived_at, s.archived_by,
       s.archive_reason, s.is_demo, s.created_by, s.created_at, s.updated_by, s.updated_at,
       s.previous_education_country_id, s.school_country_id, s.institution_name, s.preferred_campus_id,
       case when pp.passport then s.passport_number end as passport_number,
       case when pp.passport then s.passport_expiry end as passport_expiry,
       case when pp.passport then s.passport_country_id end as passport_country_id,
       case when s.passport_normalized is not null then '•••••' || right(s.passport_normalized, 3) end as passport_masked,
       pp.passport as passport_visible,
       s.parent_name,
       case when p.pii then s.parent_phone end as parent_phone,
       case when p.pii then s.parent_email end as parent_email,
       s.visa_application_country_id
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);
grant select on v_students to erp_app;

drop trigger if exists students_stage_requirements on students;
drop trigger if exists students_zz_passport_version on students;
drop trigger if exists students_contact_history on students;
drop trigger if exists students_email_status on students;
drop trigger students_audit on students;
create trigger students_audit after insert or update or delete on students
  for each row execute function app.audit_row('originating_org_id', 'id', 'phone_normalized', 'email_normalized', 'passport_normalized',
                                              '~phone', '~email', '~date_of_birth', '~passport_number', '~parent_phone', '~parent_email');

drop table if exists auth_private.email_verifications;
drop table if exists passport_validity_rules;
drop table if exists passport_followups;
drop table if exists student_passports;
drop table if exists student_contact_changes;

drop function if exists app.expire_email_verifications();
drop function if exists app.confirm_email_verification(text);
drop function if exists app.request_email_verification(uuid, text, text);
drop function if exists app.set_contact_required_stage(text);
drop function if exists app.students_stage_requirements();
drop function if exists app.stage_requirement_issues(uuid, text);
drop function if exists app.record_passport(uuid, text, text, text, date, text, uuid, uuid, uuid, date, date, text, text);
drop function if exists app.students_passport_version();
drop function if exists app.passport_monitor(uuid);
drop function if exists app.passport_close_tasks(uuid, text);
drop function if exists app.passport_tier(date);
drop function if exists app.guard_passport_versions();
drop function if exists app.students_contact_history();
drop function if exists app.students_email_status();

alter table stages drop column if exists requires_complete_contact;

-- automatic passport tasks (and their history) were created by 0019
delete from task_comments where task_id in (select id from tasks where task_type = 'passport' or source_key is not null);
delete from task_events where task_id in (select id from tasks where task_type = 'passport' or source_key is not null);
alter table tasks disable trigger tasks_audit;
delete from tasks where task_type = 'passport' or source_key is not null;
alter table tasks enable trigger tasks_audit;
alter table tasks drop constraint tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check check (task_type in ('general', 'followup', 'documentation', 'attestation', 'apostille',
  'translation', 'university_application', 'visa', 'finance', 'travel'));
drop index if exists tasks_source_key;
alter table tasks drop column if exists source_key;
alter table tasks alter column created_by set not null;

delete from notification_messages where event_key = 'email_verification';
delete from notification_templates t where t.name = 'Email verification' and not exists (select 1 from notification_rules r where r.template_id = t.id);

alter table students
  drop column if exists phone_country, drop column if exists phone2, drop column if exists phone2_country,
  drop column if exists phone3, drop column if exists phone3_country, drop column if exists phone3_label,
  drop column if exists residence_country_id, drop column if exists email_status, drop column if exists email_verified_at;

delete from role_permissions where permission_key = 'passport.rules.manage';
delete from permissions where key = 'passport.rules.manage';
