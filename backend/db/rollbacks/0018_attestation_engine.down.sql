-- Undo 0018 (attestation engine). Removes only what 0018 added.
-- WARNING: deletes attestation configuration and attestation work records, and the students' visa application country.
-- Take a backup first (npm run db:backup).

drop trigger if exists student_documents_attestation_reset on student_documents;
drop function if exists app.attestation_on_document_change();

-- restore the portal overview from 0016
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

-- restore the student view from 0015 (without visa_application_country_id)
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
       case when p.pii then s.parent_email end as parent_email
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);
grant select on v_students to erp_app;

drop function if exists app.authorize_attestation_file(uuid);
drop function if exists app.attestation_file_target(uuid);
drop function if exists app.register_attestation_file(uuid, text, text, text, int, text);
drop function if exists app.cancel_attestation(uuid, text);
drop function if exists app.attestation_step_action(uuid, text, text, date, text, uuid);
drop function if exists app.start_attestation(uuid, uuid);
drop function if exists app.attestation_state(uuid);
drop function if exists app.matching_attestation_routes(uuid);
drop function if exists app.new_attestation_route_version(uuid);
drop function if exists app.approve_attestation_route(uuid);

drop table if exists attestation_step_files;
drop table if exists document_attestation_steps;
drop table if exists document_attestations;
drop table if exists attestation_route_stages;
drop table if exists attestation_routes;
drop table if exists attestation_authorities;
drop function if exists app.guard_attestation_writes();
drop function if exists app.guard_route_frozen();

delete from notification_messages where event_key in ('attestation_stage_completed', 'attestation_completed');
delete from notification_rules where event_key in ('attestation_stage_completed', 'attestation_completed');
delete from notification_templates t where t.name in ('Attestation progress', 'Attestation completed')
  and not exists (select 1 from notification_rules r where r.template_id = t.id);
alter table notification_rules drop constraint notification_rules_event_key_check;
alter table notification_rules add constraint notification_rules_event_key_check
  check (event_key in ('student_registered', 'stage_changed', 'document_changes_required', 'document_rejected',
                       'document_approved', 'visa_outcome', 'portal_login_code'));

alter table students drop column if exists visa_application_country_id;

delete from document_types t where t.key in ('birth_affidavit', 'sponsor_affidavit', 'police_clearance')
  and not exists (select 1 from student_documents d where d.document_type_id = t.id)
  and not exists (select 1 from document_requirements r where r.document_type_id = t.id)
  and not exists (select 1 from university_document_requirements u where u.document_type_id = t.id)
  and not exists (select 1 from verification_rules v where v.document_type_id = t.id);

delete from role_permissions where permission_key in ('attestation.routes.manage', 'attestation.routes.approve', 'attestation.process', 'attestation.exception');
delete from permissions where key in ('attestation.routes.manage', 'attestation.routes.approve', 'attestation.process', 'attestation.exception');
