-- =============================================================================
-- 0007 Security: views with field masking, row-level security policies, and
--      least-privilege grants for the application role `erp_app`.
--
-- Principle: deny by default. erp_app gets only the table/column privileges it
-- needs, and every row it can see or change is filtered by a policy below.
-- =============================================================================

-- add_event / ensure_document_checklist are callable by the app, so they must
-- check access themselves (internal callers already have access).
create or replace function app.add_event(p_student uuid, p_org uuid, p_category text, p_type text,
                                         p_summary text, p_ref_type text default null, p_ref_id text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null and not app.can_read_student(p_student) then
    raise exception 'student not found' using errcode = 'P0002';
  end if;
  if p_org is not null and not app.student_has_org(p_student, p_org) then
    raise exception 'company does not have access to this student' using errcode = '23514';
  end if;
  perform app.add_event_internal(p_student, p_org, p_category, p_type, p_summary, p_ref_type, p_ref_id);
end $$;

create or replace function app.ensure_document_checklist(p_student uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if app.current_user_id() is not null and not app.can_read_student(p_student) then
    raise exception 'student not found' using errcode = 'P0002';
  end if;
  insert into student_documents (student_id, document_type_id, is_required, created_by)
  select s.id, r.document_type_id, r.is_required, coalesce(app.current_user_id(), s.created_by)
    from students s join document_requirements r on r.workflow_id = s.workflow_id
   where s.id = p_student
  on conflict (student_id, document_type_id, label) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Users that share at least one active company with the current user.
create or replace function app.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user = app.current_user_id() or exists (
    select 1 from organization_memberships mine
      join organization_memberships theirs on theirs.org_id = mine.org_id
     where mine.user_id = app.current_user_id() and mine.is_active
       and theirs.user_id = p_user)
$$;

create or replace function app.can_manage_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from organization_memberships m
                  where m.user_id = p_user and app.has_perm(m.org_id, 'users.manage'))
$$;

create or replace function app.holds_role(p_role uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from organization_memberships
                  where role_id = p_role and user_id = app.current_user_id())
$$;

create or replace function app.can_read_audit_row(p_org uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_org is not null then app.has_perm(p_org, 'audit.read')
    else exists (select 1 from organization_memberships m
                  where m.user_id = p_actor and app.has_perm(m.org_id, 'audit.read'))
  end
$$;

-- Visa and admission details are updated through dedicated functions so that
-- only staff with the matching stage permission can change them.
create or replace function app.update_visa_details(p_student uuid, p_appointment date, p_outcome text, p_reference text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s students%rowtype;
begin
  select * into v_s from students where id = p_student for update;
  if not found or not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'stage.visa') then
    raise exception 'permission denied: stage.visa' using errcode = '42501';
  end if;
  update students set visa_appointment_date = p_appointment, visa_outcome = p_outcome,
                      visa_reference = nullif(btrim(p_reference), '')
   where id = p_student;
  if p_outcome is distinct from v_s.visa_outcome then
    perform app.add_event_internal(p_student, v_s.originating_org_id, 'stage', 'visa_outcome',
                          'Visa outcome: ' || replace(v_s.visa_outcome, '_', ' ') || ' → ' || replace(p_outcome, '_', ' '));
  end if;
  if p_appointment is distinct from v_s.visa_appointment_date and p_appointment is not null then
    perform app.add_event_internal(p_student, v_s.originating_org_id, 'stage', 'visa_appointment',
                          'Visa appointment set for ' || to_char(p_appointment, 'DD Mon YYYY'));
  end if;
end $$;

create or replace function app.update_admission_details(p_student uuid, p_application_ref text, p_letter_date date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s students%rowtype;
begin
  select * into v_s from students where id = p_student for update;
  if not found or not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'stage.admission') then
    raise exception 'permission denied: stage.admission' using errcode = '42501';
  end if;
  update students set university_application_ref = nullif(btrim(p_application_ref), ''), admission_letter_date = p_letter_date
   where id = p_student;
  if p_letter_date is distinct from v_s.admission_letter_date and p_letter_date is not null then
    perform app.add_event_internal(p_student, v_s.originating_org_id, 'stage', 'admission_letter',
                          'Admission letter received on ' || to_char(p_letter_date, 'DD Mon YYYY'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Student view with contact-detail masking. This is a security-barrier view
-- owned by the migration role; it filters rows with can_read_student() and
-- only reveals phone/email/date of birth to users with students.contact.view.
-- -----------------------------------------------------------------------------
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
       s.archive_reason, s.is_demo, s.created_by, s.created_at, s.updated_by, s.updated_at
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
 where app.can_read_student(s.id);

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table organizations enable row level security;
alter table user_profiles enable row level security;
alter table permissions enable row level security;
alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table organization_memberships enable row level security;
alter table audit_logs enable row level security;
alter table countries enable row level security;
alter table courses enable row level security;
alter table universities enable row level security;
alter table lead_sources enable row level security;
alter table legal_entities enable row level security;
alter table stages enable row level security;
alter table workflow_definitions enable row level security;
alter table workflow_stages enable row level security;
alter table document_types enable row level security;
alter table document_requirements enable row level security;
alter table fee_categories enable row level security;
alter table students enable row level security;
alter table student_org_access enable row level security;
alter table student_assignments enable row level security;
alter table student_notes enable row level security;
alter table followups enable row level security;
alter table student_stage_history enable row level security;
alter table student_events enable row level security;
alter table student_merges enable row level security;
alter table student_documents enable row level security;
alter table document_files enable row level security;
alter table document_reviews enable row level security;
alter table document_custody_events enable row level security;
alter table tasks enable row level security;
alter table task_comments enable row level security;
alter table task_events enable row level security;
alter table payment_entries enable row level security;
alter table payment_verifications enable row level security;

-- -----------------------------------------------------------------------------
-- Policies
-- -----------------------------------------------------------------------------
-- Organizations: members only; settings by settings.manage
-- Company names are not sensitive; staff processing another brand's students need them.
create policy org_select on organizations for select to erp_app using (app.current_user_id() is not null);
create policy org_update on organizations for update to erp_app
  using (app.has_perm(id, 'settings.manage')) with check (app.has_perm(id, 'settings.manage'));

-- Users: visible if sharing a company; managed by users.manage
create policy users_select on user_profiles for select to erp_app using (app.shares_org_with(id));
create policy users_insert on user_profiles for insert to erp_app
  with check (exists (select 1 from app.orgs_with_perm('users.manage')));
create policy users_update on user_profiles for update to erp_app
  using (app.can_manage_user(id) and id <> app.current_user_id())
  with check (app.can_manage_user(id) and id <> app.current_user_id());

create policy permissions_select on permissions for select to erp_app using (app.current_user_id() is not null);

-- Roles: visible to members; managed by roles.manage. A user cannot edit the
-- permissions of a role they hold themselves (prevents self-escalation).
create policy roles_select on roles for select to erp_app using (app.is_member(org_id));
create policy roles_insert on roles for insert to erp_app with check (app.has_perm(org_id, 'roles.manage') and not is_system);
create policy roles_update on roles for update to erp_app
  using (app.has_perm(org_id, 'roles.manage')) with check (app.has_perm(org_id, 'roles.manage'));
create policy role_perms_select on role_permissions for select to erp_app
  using (exists (select 1 from roles r where r.id = role_id));
create policy role_perms_insert on role_permissions for insert to erp_app
  with check (exists (select 1 from roles r where r.id = role_id and app.has_perm(r.org_id, 'roles.manage'))
              and not app.holds_role(role_id));
create policy role_perms_delete on role_permissions for delete to erp_app
  using (exists (select 1 from roles r where r.id = role_id and app.has_perm(r.org_id, 'roles.manage'))
         and not app.holds_role(role_id));

-- Memberships: visible to members of that company; users.manage can add/change
-- others (never their own membership).
create policy memberships_select on organization_memberships for select to erp_app
  using (app.is_member(org_id) or user_id = app.current_user_id());
create policy memberships_insert on organization_memberships for insert to erp_app
  with check (app.has_perm(org_id, 'users.manage') and user_id <> app.current_user_id());
create policy memberships_update on organization_memberships for update to erp_app
  using (app.has_perm(org_id, 'users.manage') and user_id <> app.current_user_id())
  with check (app.has_perm(org_id, 'users.manage') and user_id <> app.current_user_id());

-- Audit log: read-only for audit.read holders, no writes (only via functions)
create policy audit_select on audit_logs for select to erp_app using (app.can_read_audit_row(org_id, actor_user_id));

-- Global reference data: readable by any authenticated user
create policy countries_select on countries for select to erp_app using (app.current_user_id() is not null);
create policy countries_write on countries for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('reference.manage')))
  with check (exists (select 1 from app.orgs_with_perm('reference.manage')));
create policy courses_select on courses for select to erp_app using (app.current_user_id() is not null);
create policy courses_write on courses for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('reference.manage')))
  with check (exists (select 1 from app.orgs_with_perm('reference.manage')));
create policy universities_select on universities for select to erp_app using (app.current_user_id() is not null);
create policy universities_write on universities for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('reference.manage')))
  with check (exists (select 1 from app.orgs_with_perm('reference.manage')));
create policy legal_entities_select on legal_entities for select to erp_app using (app.current_user_id() is not null);
create policy legal_entities_write on legal_entities for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('reference.manage')))
  with check (exists (select 1 from app.orgs_with_perm('reference.manage')));
create policy stages_select on stages for select to erp_app using (app.current_user_id() is not null);
create policy document_types_select on document_types for select to erp_app using (app.current_user_id() is not null);
create policy document_types_write on document_types for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('workflow.manage')))
  with check (exists (select 1 from app.orgs_with_perm('workflow.manage')));
create policy workflows_select on workflow_definitions for select to erp_app using (app.current_user_id() is not null);
create policy workflows_write on workflow_definitions for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('workflow.manage')))
  with check (exists (select 1 from app.orgs_with_perm('workflow.manage')));
create policy workflow_stages_select on workflow_stages for select to erp_app using (app.current_user_id() is not null);
create policy workflow_stages_write on workflow_stages for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('workflow.manage')))
  with check (exists (select 1 from app.orgs_with_perm('workflow.manage')));
create policy doc_req_select on document_requirements for select to erp_app using (app.current_user_id() is not null);
create policy doc_req_write on document_requirements for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('workflow.manage')))
  with check (exists (select 1 from app.orgs_with_perm('workflow.manage')));

-- Company-specific reference data
create policy lead_sources_select on lead_sources for select to erp_app using (app.is_member(org_id));
create policy lead_sources_write on lead_sources for all to erp_app
  using (app.has_perm(org_id, 'reference.manage')) with check (app.has_perm(org_id, 'reference.manage'));
create policy fee_categories_select on fee_categories for select to erp_app using (app.is_member(org_id));
create policy fee_categories_write on fee_categories for all to erp_app
  using (app.has_perm(org_id, 'settings.manage')) with check (app.has_perm(org_id, 'settings.manage'));

-- Students
create policy students_select on students for select to erp_app using (app.can_read_student(id));
create policy students_insert on students for insert to erp_app
  with check (app.has_perm(originating_org_id, 'students.create'));
create policy students_update on students for update to erp_app
  using (app.can_on_student(id, 'students.update') and archived_at is null and status <> 'merged')
  with check (app.can_on_student(id, 'students.update'));

create policy student_org_access_select on student_org_access for select to erp_app using (app.can_read_student(student_id));

create policy assignments_select on student_assignments for select to erp_app using (app.can_read_student(student_id));
create policy assignments_insert on student_assignments for insert to erp_app
  with check (assigned_by = app.current_user_id() and (
                app.can_on_student(student_id, 'students.assign')
                -- a counsellor registering a student may assign themselves
                or (user_id = app.current_user_id() and assignment_type = 'counsellor'
                    and app.has_perm(org_id, 'students.create'))));
create policy assignments_update on student_assignments for update to erp_app
  using (app.can_on_student(student_id, 'students.assign'))
  with check (app.can_on_student(student_id, 'students.assign'));

create policy notes_select on student_notes for select to erp_app
  using (app.can_on_student(student_id, 'notes.read')
         and (visibility = 'internal' or app.can_on_student(student_id, 'notes.restricted')));
create policy notes_insert on student_notes for insert to erp_app
  with check (created_by = app.current_user_id() and app.has_perm(org_id, 'notes.write')
              and app.student_has_org(student_id, org_id) and app.can_read_student(student_id)
              and (visibility = 'internal' or app.can_on_student(student_id, 'notes.restricted')));

create policy followups_select on followups for select to erp_app using (app.can_on_student(student_id, 'notes.read'));
create policy followups_insert on followups for insert to erp_app
  with check (created_by = app.current_user_id() and app.has_perm(org_id, 'notes.write')
              and app.student_has_org(student_id, org_id) and app.can_read_student(student_id));

create policy stage_history_select on student_stage_history for select to erp_app using (app.can_read_student(student_id));
create policy merges_select on student_merges for select to erp_app
  using (app.can_read_student(surviving_student_id) or app.can_read_student(merged_student_id));

create policy events_select on student_events for select to erp_app
  using (app.can_read_student(student_id) and case category
           when 'payment' then org_id is not null and app.has_perm(org_id, 'payments.read')
           when 'note' then app.can_on_student(student_id, 'notes.read')
           when 'followup' then app.can_on_student(student_id, 'notes.read')
           when 'document' then app.can_on_student(student_id, 'documents.read')
           else true end);

-- Documents
create policy documents_select on student_documents for select to erp_app
  using (app.can_on_student(student_id, 'documents.read'));
create policy documents_insert on student_documents for insert to erp_app
  with check (app.can_on_student(student_id, 'documents.upload') and status = 'missing' and current_file_id is null);
create policy documents_update on student_documents for update to erp_app
  using (app.can_on_student(student_id, 'documents.review'))
  with check (app.can_on_student(student_id, 'documents.review'));
create policy document_files_select on document_files for select to erp_app
  using (exists (select 1 from student_documents d where d.id = student_document_id));
create policy document_reviews_select on document_reviews for select to erp_app
  using (exists (select 1 from student_documents d where d.id = student_document_id));
create policy custody_select on document_custody_events for select to erp_app
  using (exists (select 1 from student_documents d where d.id = student_document_id));

-- Tasks
create policy tasks_select on tasks for select to erp_app
  using (app.has_perm(org_id, 'tasks.read.all')
         or ((assigned_to = app.current_user_id() or created_by = app.current_user_id())
             and app.has_perm(org_id, 'tasks.read.own')));
create policy tasks_insert on tasks for insert to erp_app
  with check (app.has_perm(org_id, 'tasks.create')
              and (student_id is null or app.can_read_student(student_id))
              and (assigned_to is null or assigned_to = app.current_user_id() or app.has_perm(org_id, 'tasks.assign')));
create policy tasks_update on tasks for update to erp_app
  using (app.has_perm(org_id, 'tasks.update.all') or app.has_perm(org_id, 'tasks.assign')
         or ((assigned_to = app.current_user_id() or created_by = app.current_user_id())
             and app.has_perm(org_id, 'tasks.update.own')))
  with check (app.has_perm(org_id, 'tasks.update.all') or app.has_perm(org_id, 'tasks.assign')
         or ((assigned_to = app.current_user_id() or created_by = app.current_user_id())
             and app.has_perm(org_id, 'tasks.update.own')));
create policy task_comments_select on task_comments for select to erp_app
  using (exists (select 1 from tasks t where t.id = task_id));
create policy task_comments_insert on task_comments for insert to erp_app
  with check (author_id = app.current_user_id() and exists (select 1 from tasks t where t.id = task_id));
create policy task_events_select on task_events for select to erp_app
  using (exists (select 1 from tasks t where t.id = task_id));

-- Payments
create policy payments_select on payment_entries for select to erp_app
  using (app.has_perm(org_id, 'payments.read') and app.can_read_student(student_id));
create policy payments_insert on payment_entries for insert to erp_app
  with check (app.can_read_student(student_id) and app.student_has_org(student_id, org_id) and
              case entry_type
                when 'charge' then app.has_perm(org_id, 'payments.record')
                when 'receipt' then app.has_perm(org_id, 'payments.record')
                when 'waiver' then app.has_perm(org_id, 'payments.record')
                when 'refund' then app.has_perm(org_id, 'payments.reverse')
                when 'reversal' then app.has_perm(org_id, 'payments.reverse')
                when 'disbursement' then app.has_perm(org_id, 'payments.disbursement')
                else false end);
create policy payment_verifications_select on payment_verifications for select to erp_app
  using (exists (select 1 from payment_entries e where e.id = payment_entry_id));

-- -----------------------------------------------------------------------------
-- Grants (least privilege)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from public;
revoke all on all functions in schema app from public;
grant usage on schema public, app to erp_app;

grant select on organizations, permissions, roles, role_permissions, organization_memberships, audit_logs,
  countries, courses, universities, lead_sources, legal_entities, stages, workflow_definitions, workflow_stages,
  document_types, document_requirements, fee_categories, student_org_access, student_assignments, student_notes,
  followups, student_stage_history, student_events, student_merges, student_documents, document_reviews,
  document_custody_events, tasks, task_comments, task_events, payment_entries, payment_verifications,
  user_profiles to erp_app;
grant select on v_students, payment_entry_effects, student_balances to erp_app;

-- students: no direct read of contact fields (use v_students)
grant select (id, student_code, originating_org_id, processing_org_id, lead_source_id, full_name, preferred_language,
  destination_country_id, course_id, preferred_university_id, highest_qualification, qualification_board,
  qualification_year, qualification_score, entrance_exam, entrance_score, academic_notes, registration_date,
  workflow_id, current_stage_key, stage_before_hold, stage_changed_at, status, next_action, next_action_due,
  contracting_entity_id, payment_recipient_entity_id, university_application_ref, admission_letter_date,
  visa_appointment_date, visa_outcome, visa_reference, merged_into_id, archived_at, archived_by, archive_reason,
  is_demo, created_by, created_at, updated_by, updated_at) on students to erp_app;
grant insert (id, originating_org_id, processing_org_id, lead_source_id, full_name, phone, email, preferred_language,
  date_of_birth, destination_country_id, course_id, preferred_university_id, highest_qualification, qualification_board,
  qualification_year, qualification_score, entrance_exam, entrance_score, academic_notes, registration_date,
  next_action, next_action_due, contracting_entity_id, payment_recipient_entity_id, created_by) on students to erp_app;
grant update (processing_org_id, lead_source_id, full_name, phone, email, preferred_language, date_of_birth,
  destination_country_id, course_id, preferred_university_id, highest_qualification, qualification_board,
  qualification_year, qualification_score, entrance_exam, entrance_score, academic_notes, registration_date,
  workflow_id, next_action, next_action_due, contracting_entity_id, payment_recipient_entity_id) on students to erp_app;

-- document_files: storage keys are never readable directly
grant select (id, student_document_id, version, original_filename, mime_type, size_bytes, uploaded_by, uploaded_at)
  on document_files to erp_app;

grant update (name, settings) on organizations to erp_app;
grant insert (id, email, full_name, job_title, created_by) on user_profiles to erp_app;
grant update (full_name, job_title, is_active) on user_profiles to erp_app;
grant insert (id, org_id, key, name, description) on roles to erp_app;
grant update (name, description) on roles to erp_app;
grant insert, delete on role_permissions to erp_app;
grant insert (id, user_id, org_id, role_id, is_active, created_by) on organization_memberships to erp_app;
grant update (role_id, is_active) on organization_memberships to erp_app;
grant insert, update on countries, courses, universities, legal_entities, lead_sources, fee_categories,
  workflow_definitions, document_types, document_requirements to erp_app;
grant insert, update, delete on workflow_stages to erp_app;
grant insert (id, student_id, user_id, org_id, assignment_type, is_active, assigned_by) on student_assignments to erp_app;
grant update (is_active, ended_at, ended_by) on student_assignments to erp_app;
grant insert (id, student_id, org_id, visibility, body, created_by) on student_notes to erp_app;
grant insert (id, student_id, org_id, channel, summary, occurred_at, next_followup_date, created_by) on followups to erp_app;
grant insert (id, student_id, document_type_id, label, is_required, expiry_date, notes) on student_documents to erp_app;
grant update (expiry_date, notes, is_required, label) on student_documents to erp_app;
grant insert (id, org_id, student_id, title, description, task_type, assigned_to, priority, status, due_date,
  delay_reason, delay_note) on tasks to erp_app;
grant update (title, description, task_type, assigned_to, priority, status, due_date, delay_reason, delay_note) on tasks to erp_app;
grant insert (id, task_id, author_id, body) on task_comments to erp_app;
grant insert (id, org_id, student_id, entry_type, fee_category_id, amount, currency, entry_date, method, reference_no,
  receipt_ref, recipient_entity_id, payee, reverses_entry_id, notes) on payment_entries to erp_app;

grant execute on function
  app.current_user_id(), app.has_perm(uuid, text), app.orgs_with_perm(text), app.is_member(uuid),
  app.user_is_active_member(uuid, uuid), app.audit(text, text, text, uuid, uuid, jsonb, jsonb, text, jsonb, uuid),
  app.auth_login_lookup(text), app.auth_recent_failures(text, text), app.auth_record_attempt(text, text, boolean, uuid),
  app.auth_create_session(uuid, text, int, text, text), app.auth_resolve_session(text), app.auth_revoke_session(text),
  app.auth_request_reset(text, text), app.auth_admin_issue_reset(uuid, text), app.auth_reset_is_valid(text),
  app.auth_complete_reset(text, text), app.auth_change_own_password(text, uuid), app.auth_own_password_hash(),
  app.auth_admin_set_initial_password(uuid, text), app.auth_pending_reset_requests(),
  app.pick_workflow(uuid, uuid), app.is_assigned(uuid), app.can_read_student(uuid), app.can_on_student(uuid, text),
  app.student_has_org(uuid, uuid), app.change_student_stage(uuid, text, text, text, date, jsonb),
  app.find_duplicate_candidates(text, text, uuid), app.merge_students(uuid, uuid, text),
  app.set_student_archived(uuid, boolean, text), app.add_event(uuid, uuid, text, text, text, text, text),
  app.ensure_document_checklist(uuid), app.register_document_file(uuid, text, text, text, int, text),
  app.set_document_status(uuid, text, text), app.record_document_custody(uuid, text, text, text),
  app.authorize_file_access(uuid), app.verify_payment(uuid, text, text),
  app.student_has_outstanding_service_balance(uuid), app.shares_org_with(uuid), app.can_manage_user(uuid),
  app.holds_role(uuid), app.can_read_audit_row(uuid, uuid), app.update_visa_details(uuid, date, text, text),
  app.update_admission_details(uuid, text, date)
to erp_app;
