-- =============================================================================
-- 0013 Phase B: student education background & passport, university
--      management (campuses, courses, intakes/deadlines, document
--      requirements), certificate issuing country, automatic checklists.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('students.passport.view', 'Students', 'See and edit passport number, expiry and issuing country', true),
  ('universities.manage',    'Administration', 'Add and configure universities, campuses, courses, intakes and document requirements', false)
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, 'students.passport.view' from roles r where r.key in ('manager', 'counsellor', 'documentation', 'visa')
on conflict do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, 'universities.manage' from roles r where r.key = 'system_admin'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Audit redaction: trigger arguments starting with "~" are REDACTED (the log
-- records that the value changed, not the value). Plain arguments are dropped.
-- -----------------------------------------------------------------------------
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_org uuid;
  v_student uuid;
  v_arg text;
  v_col text;
  v_key text;
  i int;
begin
  if tg_argv[0] <> '' then v_org := (v_row ->> tg_argv[0])::uuid; end if;
  if tg_argv[1] <> '' then v_student := (v_row ->> tg_argv[1])::uuid; end if;
  for i in 2 .. coalesce(array_length(tg_argv, 1), 0) - 1 loop
    v_arg := tg_argv[i];
    if left(v_arg, 1) = '~' then
      v_col := substr(v_arg, 2);
      if v_old ? v_col and v_old ->> v_col is not null then v_old := jsonb_set(v_old, array[v_col], '"(redacted)"'::jsonb); end if;
      if v_new ? v_col and v_new ->> v_col is not null then
        v_new := jsonb_set(v_new, array[v_col],
          case when tg_op = 'UPDATE' and (to_jsonb(old) -> v_col) is distinct from (to_jsonb(new) -> v_col)
               then '"(changed)"'::jsonb else '"(redacted)"'::jsonb end);
      end if;
    else
      v_old := v_old - v_arg;
      v_new := v_new - v_arg;
    end if;
  end loop;
  v_old := v_old - 'updated_at';
  v_new := v_new - 'updated_at';
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_old -> v_key is not distinct from v_new -> v_key then
        v_old := v_old - v_key;
        v_new := v_new - v_key;
      end if;
    end loop;
    if v_new = '{}'::jsonb then return null; end if;
  end if;
  insert into audit_logs (actor_user_id, org_id, student_id, action, entity_type, entity_id,
                          before_data, after_data, request_ip)
  values (app.current_user_id(), v_org, v_student, lower(tg_op), tg_table_name, v_row ->> 'id',
          v_old, v_new, nullif(current_setting('app.request_ip', true), ''));
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- Countries: which lists a country appears in
-- -----------------------------------------------------------------------------
alter table countries
  add column is_destination boolean not null default true,
  add column is_education_origin boolean not null default false;

-- -----------------------------------------------------------------------------
-- Universities
-- -----------------------------------------------------------------------------
alter table universities add column website text check (website is null or website ~* '^https?://'),
                         add column notes text;

create table university_campuses (
  id             uuid primary key default gen_random_uuid(),
  university_id  uuid not null references universities(id),
  name           text not null check (length(btrim(name)) between 2 and 120),
  city           text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (university_id, name),
  unique (id, university_id)
);

create table university_courses (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references universities(id),
  course_id       uuid not null references courses(id),
  duration_years  numeric(3, 1) check (duration_years is null or duration_years between 0.5 and 10),
  medium          text,
  eligibility     text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (university_id, course_id)
);

create table university_intakes (
  id                    uuid primary key default gen_random_uuid(),
  university_id         uuid not null references universities(id),
  course_id             uuid references courses(id),
  name                  text not null check (length(btrim(name)) between 2 and 80),
  application_deadline  date,
  starts_on             date,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);
create index university_intakes_deadline_idx on university_intakes (application_deadline) where is_active;

create table university_document_requirements (
  id                uuid primary key default gen_random_uuid(),
  university_id     uuid not null references universities(id),
  course_id         uuid references courses(id),
  document_type_id  uuid not null references document_types(id),
  is_required       boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now()
);
create unique index university_doc_req_key on university_document_requirements
  (university_id, coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid), document_type_id);

create trigger universities_audit after insert or update or delete on universities
  for each row execute function app.audit_row('', '');
create trigger university_campuses_audit after insert or update or delete on university_campuses
  for each row execute function app.audit_row('', '');
create trigger university_courses_audit after insert or update or delete on university_courses
  for each row execute function app.audit_row('', '');
create trigger university_intakes_audit after insert or update or delete on university_intakes
  for each row execute function app.audit_row('', '');
create trigger university_doc_req_audit after insert or update or delete on university_document_requirements
  for each row execute function app.audit_row('', '');

-- -----------------------------------------------------------------------------
-- Student fields
-- -----------------------------------------------------------------------------
alter table students
  add column previous_education_country_id uuid references countries(id),
  add column school_country_id uuid references countries(id),
  add column institution_name text check (institution_name is null or length(institution_name) <= 200),
  add column passport_number text check (passport_number is null or passport_number ~ '^[A-Z0-9]{5,15}$'),
  add column passport_normalized text generated always as (nullif(upper(coalesce(passport_number, '')), '')) stored,
  add column passport_expiry date,
  add column passport_country_id uuid references countries(id),
  add column preferred_campus_id uuid,
  add constraint students_campus_fk foreign key (preferred_campus_id, preferred_university_id)
      references university_campuses(id, university_id);
create index students_passport_idx on students (passport_normalized) where passport_normalized is not null;
create index students_prev_country_idx on students (previous_education_country_id);

-- Re-create the student audit trigger with redaction of personal fields
drop trigger students_audit on students;
create trigger students_audit after insert or update or delete on students
  for each row execute function app.audit_row('originating_org_id', 'id', 'phone_normalized', 'email_normalized',
                                              'passport_normalized', '~phone', '~email', '~date_of_birth', '~passport_number');

alter table student_assignments drop constraint student_assignments_assignment_type_check;
alter table student_assignments add constraint student_assignments_assignment_type_check
  check (assignment_type in ('manager', 'counsellor', 'documentation', 'visa', 'finance', 'other'));

-- Certificate issuing country and where a checklist item came from
alter table student_documents
  add column issuing_country_id uuid references countries(id),
  add column requirement_source text not null default 'manual'
    check (requirement_source in ('workflow', 'university', 'manual'));
update student_documents set requirement_source = 'workflow' where requirement_source = 'manual' and is_required;
grant update (issuing_country_id) on student_documents to erp_app;
grant insert (issuing_country_id) on student_documents to erp_app;

-- -----------------------------------------------------------------------------
-- Checklist: workflow requirements + the chosen university's requirements
-- (course-specific ones only if the course matches). Adds, never removes.
-- -----------------------------------------------------------------------------
create or replace function app.ensure_document_checklist_internal(p_student uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int; v_more int;
begin
  insert into student_documents (student_id, document_type_id, is_required, requirement_source, created_by)
  select s.id, r.document_type_id, r.is_required, 'workflow', coalesce(app.current_user_id(), s.created_by)
    from students s join document_requirements r on r.workflow_id = s.workflow_id
   where s.id = p_student
  on conflict (student_id, document_type_id, label) do nothing;
  get diagnostics v_count = row_count;
  insert into student_documents (student_id, document_type_id, is_required, requirement_source, created_by)
  select distinct on (u.document_type_id) s.id, u.document_type_id, u.is_required, 'university', coalesce(app.current_user_id(), s.created_by)
    from students s join university_document_requirements u on u.university_id = s.preferred_university_id
   where s.id = p_student and (u.course_id is null or u.course_id = s.course_id)
   order by u.document_type_id, u.is_required desc
  on conflict (student_id, document_type_id, label) do update
     set is_required = true
   where excluded.is_required and not student_documents.is_required;
  get diagnostics v_more = row_count;
  return v_count + v_more;
end $$;

create or replace function app.ensure_document_checklist(p_student uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null and not app.can_read_student(p_student) then
    raise exception 'student not found' using errcode = 'P0002';
  end if;
  return app.ensure_document_checklist_internal(p_student);
end $$;

create or replace function app.students_after_insert_checklist() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.ensure_document_checklist_internal(new.id);
  return null;
end $$;

create or replace function app.students_after_update_checklist() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_added int; v_uni text;
begin
  v_added := app.ensure_document_checklist_internal(new.id);
  if v_added > 0 and new.preferred_university_id is distinct from old.preferred_university_id and new.preferred_university_id is not null then
    select name into v_uni from universities where id = new.preferred_university_id;
    perform app.add_event_internal(new.id, new.originating_org_id, 'document', 'checklist',
      v_added || ' document requirement(s) added for ' || v_uni);
  end if;
  return null;
end $$;
create trigger students_zz_checklist_update after update of workflow_id, preferred_university_id, course_id on students
  for each row execute function app.students_after_update_checklist();

-- When a university adds a requirement, students already assigned to it get it too.
create or replace function app.university_requirement_propagate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select s.id from students s
            where s.preferred_university_id = new.university_id and s.status in ('active', 'on_hold')
              and (new.course_id is null or s.course_id = new.course_id) loop
    perform app.ensure_document_checklist_internal(r.id);
  end loop;
  return null;
end $$;
create trigger university_doc_req_propagate after insert or update of is_required on university_document_requirements
  for each row execute function app.university_requirement_propagate();

-- -----------------------------------------------------------------------------
-- Duplicate detection now also matches passport numbers
-- -----------------------------------------------------------------------------
drop function app.find_duplicate_candidates(text, text, uuid);
create function app.find_duplicate_candidates(p_phone text, p_email text, p_exclude uuid default null, p_passport text default null)
returns table (student_id uuid, student_code text, full_name text, org_name text, matched_on text, visible boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_phone text := nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_pass text := nullif(upper(regexp_replace(coalesce(p_passport, ''), '\s', '', 'g')), '');
begin
  if app.current_user_id() is null then return; end if;
  if v_phone is not null and length(v_phone) < 7 then v_phone := null; end if;
  return query
    select case when app.can_read_student(s.id) then s.id end,
           case when app.can_read_student(s.id) then s.student_code end,
           case when app.can_read_student(s.id) then s.full_name end,
           o.name,
           concat_ws(' & ',
             case when v_phone is not null and s.phone_normalized = v_phone then 'phone' end,
             case when v_email is not null and s.email_normalized = v_email then 'email' end,
             case when v_pass is not null and s.passport_normalized = v_pass then 'passport' end),
           app.can_read_student(s.id)
      from students s join organizations o on o.id = s.originating_org_id
     where s.status <> 'merged'
       and (p_exclude is null or s.id <> p_exclude)
       and ((v_phone is not null and s.phone_normalized = v_phone)
         or (v_email is not null and s.email_normalized = v_email)
         or (v_pass is not null and s.passport_normalized = v_pass))
     limit 10;
end $$;
grant execute on function app.find_duplicate_candidates(text, text, uuid, text) to erp_app;

-- -----------------------------------------------------------------------------
-- Student view: new columns appended; passport fields masked without permission
-- -----------------------------------------------------------------------------
create or replace view v_students with (security_barrier = true) as
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
       pp.passport as passport_visible
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);

grant select (previous_education_country_id, school_country_id, institution_name, preferred_campus_id) on students to erp_app;
grant insert (previous_education_country_id, school_country_id, institution_name, passport_number, passport_expiry,
              passport_country_id, preferred_campus_id) on students to erp_app;
grant update (previous_education_country_id, school_country_id, institution_name, passport_number, passport_expiry,
              passport_country_id, preferred_campus_id) on students to erp_app;

-- -----------------------------------------------------------------------------
-- RLS for university configuration (readable by all staff; managed by holders
-- of universities.manage in any company, since universities are shared)
-- -----------------------------------------------------------------------------
alter table university_campuses enable row level security;
alter table university_courses enable row level security;
alter table university_intakes enable row level security;
alter table university_document_requirements enable row level security;

drop policy universities_write on universities;
create policy universities_write on universities for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('universities.manage')) or exists (select 1 from app.orgs_with_perm('reference.manage')))
  with check (exists (select 1 from app.orgs_with_perm('universities.manage')) or exists (select 1 from app.orgs_with_perm('reference.manage')));

do $$
declare t text;
begin
  foreach t in array array['university_campuses', 'university_courses', 'university_intakes', 'university_document_requirements'] loop
    execute format('create policy %I on %I for select to erp_app using (app.current_user_id() is not null)', t || '_select', t);
    execute format('create policy %I on %I for all to erp_app using (exists (select 1 from app.orgs_with_perm(''universities.manage''))) with check (exists (select 1 from app.orgs_with_perm(''universities.manage'')))', t || '_write', t);
    execute format('grant select, insert, update on %I to erp_app', t);
  end loop;
end $$;
grant delete on university_document_requirements to erp_app;
grant update (website, notes, name, city, is_active) on universities to erp_app;
grant update (is_destination, is_education_origin, name, is_active) on countries to erp_app;
