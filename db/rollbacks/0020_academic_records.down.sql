-- Undo 0020 (academic records, thresholds, name checks, One and Same). Removes only what 0020 added.
-- WARNING: deletes academic records/subjects, thresholds, name checks, One and Same rules/templates/cases and the
-- tasks they created, and the students' intake. One and Same checklist items with uploaded files are kept.
-- Take a backup first (npm run db:backup).

-- restore stage requirements (0019) and the student view (0019)
create or replace function app.stage_requirement_issues(p_student uuid, p_to_stage text)
returns table (kind text, enforcement text, message text)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from students where id = p_student),
  ts as (select * from stages where key = p_to_stage and kind = 'normal'),
  cs as (select st.* from stages st, s where st.key = s.current_stage_key)
  select 'passport', r.enforcement,
         r.name || ': passport must be valid for at least ' || r.min_months || ' months'
           || case when s.passport_expiry is null then ' (no passport expiry recorded)' else ' (expires ' || to_char(s.passport_expiry, 'DD Mon YYYY') || ')' end
    from passport_validity_rules r, s, ts
    join stages rs on true
   where r.is_active and rs.key = r.stage_key and rs.sort_order <= ts.sort_order
     and (r.destination_country_id is null or r.destination_country_id = s.destination_country_id)
     and (r.university_id is null or r.university_id = s.preferred_university_id)
     and (r.course_id is null or r.course_id = s.course_id)
     and (s.passport_expiry is null or s.passport_expiry < current_date + make_interval(months => r.min_months))
  union all
  select 'contact', 'block', 'From ' || (select name from stages x where x.requires_complete_contact order by x.sort_order limit 1) || ' onwards, '
         || array_to_string(array_remove(array[
              case when s.phone is null then 'primary phone' end, case when s.phone2 is null then 'secondary phone' end,
              case when s.email is null then 'email address' end], null), ', ') || ' must be entered'
    from s, ts
   where exists (select 1 from stages x where x.requires_complete_contact and x.kind = 'normal' and x.sort_order <= ts.sort_order)
     and (s.phone is null or s.phone2 is null or s.email is null)
$$;

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
       s.visa_application_country_id,
       case when p.pii then s.phone_country end as phone_country,
       case when p.pii then s.phone2 end as phone2,
       case when p.pii then s.phone2_country end as phone2_country,
       case when p.pii then s.phone3 end as phone3,
       case when p.pii then s.phone3_country end as phone3_country,
       case when p.pii then s.phone3_label end as phone3_label,
       case when s.phone2 is not null then '••••••' || right(regexp_replace(s.phone2, '\D', '', 'g'), 2) end as phone2_masked,
       s.residence_country_id, s.email_status, s.email_verified_at,
       app.passport_tier(s.passport_expiry) as passport_status
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);
grant select on v_students to erp_app;

delete from notification_messages where event_key = 'one_and_same_requested';
delete from notification_rules where event_key = 'one_and_same_requested';
delete from notification_templates t where t.name = 'One and Same request' and not exists (select 1 from notification_rules r where r.template_id = t.id);
alter table notification_rules drop constraint notification_rules_event_key_check;
alter table notification_rules add constraint notification_rules_event_key_check
  check (event_key in ('student_registered', 'stage_changed', 'document_changes_required', 'document_rejected', 'document_approved',
                       'visa_outcome', 'portal_login_code', 'attestation_stage_completed', 'attestation_completed'));

drop trigger if exists student_passports_name_check on student_passports;

-- tasks created by One and Same cases
delete from task_comments where task_id in (select id from tasks where source_key like 'oas:%');
delete from task_events where task_id in (select id from tasks where source_key like 'oas:%');
alter table tasks disable trigger tasks_audit;
delete from tasks where source_key like 'oas:%';
alter table tasks enable trigger tasks_audit;

-- One and Same checklist items that never received a file
create temp table _oas_docs as select student_document_id as id from one_and_same_cases where student_document_id is not null;

drop table if exists one_and_same_cases;
drop table if exists one_and_same_templates;
drop table if exists one_and_same_rules;
drop table if exists name_checks;
drop table if exists academic_thresholds;
drop table if exists academic_subjects;
drop table if exists academic_records;

delete from student_documents d using _oas_docs o where d.id = o.id and d.current_file_id is null
  and not exists (select 1 from document_files f where f.student_document_id = d.id);
drop table _oas_docs;

drop function if exists app.set_academic_check(text, text);
drop function if exists app.cancel_one_and_same(uuid, text);
drop function if exists app.request_one_and_same(uuid, text, text);
drop function if exists app.prepare_one_and_same(uuid, uuid);
drop function if exists app.retire_one_and_same_template(uuid);
drop function if exists app.approve_one_and_same_template(uuid);
drop function if exists app.review_name_check(uuid, text, text);
drop function if exists app.name_checks_on_record();
drop function if exists app.refresh_name_checks(uuid);
drop function if exists app.open_one_and_same_case(uuid, text, uuid);
drop function if exists app.one_and_same_status(uuid);
drop function if exists app.one_and_same_requirement(uuid);
drop function if exists app.guard_oas_template();
drop function if exists app.compare_names(text, text);
drop function if exists app.name_tokens(text);
drop function if exists app.levenshtein(text, text);
drop function if exists app.academic_eligibility(uuid);
drop function if exists app.pct(numeric, numeric, numeric);
drop function if exists app.academic_records_touch();

alter table stages drop column if exists academic_check;
alter table students drop column if exists intake_id;
alter table courses drop column if exists academic_profile;

delete from document_types t where t.key in ('one_and_same', 'mbbs_degree', 'internship_certificate', 'medical_registration')
  and not exists (select 1 from student_documents d where d.document_type_id = t.id)
  and not exists (select 1 from document_requirements r where r.document_type_id = t.id)
  and not exists (select 1 from university_document_requirements u where u.document_type_id = t.id)
  and not exists (select 1 from verification_rules v where v.document_type_id = t.id);

delete from role_permissions where permission_key in ('academic.rules.manage', 'one_and_same.templates.approve');
delete from permissions where key in ('academic.rules.manage', 'one_and_same.templates.approve');
