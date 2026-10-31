-- =============================================================================
-- 0020 Phase 3: academic records, eligibility thresholds, name-mismatch checks,
--      One and Same workflow.
--
-- * Academic records per student: Class 10, Plus Two, bachelor, MBBS,
--   internship, medical registration, other. Each keeps its own grading system;
--   percentages are never invented from CGPA/letter grades.
-- * Subject marks; eligibility thresholds (by destination, university, course,
--   intake, grading system, subject) only FLAG results (warning at the
--   configured stage, or block if an administrator chooses so).
-- * Courses have an academic profile: "school" (Plus Two based) or
--   "pg_medical" (MBBS/internship/registration) so irrelevant fields are not forced.
-- * Name checks compare the passport holder name with names printed on
--   certificates. Findings are WARNINGS for human review — never automatic
--   rejection. One and Same rules decide Not required / Recommended / Mandatory;
--   mandatory cases add a checklist item and tasks; staff choose an approved
--   template, preview the wording, request it (message or manual) and track it
--   through the normal document review/approval.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('academic.rules.manage', 'Administration', 'Configure eligibility thresholds, One and Same rules and draft One and Same templates', false),
  ('one_and_same.templates.approve', 'Administration', 'Approve One and Same templates for use', true)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, v.p from roles r join (values
  ('system_admin', 'academic.rules.manage'), ('manager', 'one_and_same.templates.approve')) v(k, p) on r.key = v.k
on conflict do nothing;

insert into document_types (key, name, category, has_expiry, sort_order) values
  ('one_and_same', 'One and Same Certificate / Affidavit', 'identity', false, 15),
  ('mbbs_degree', 'MBBS Degree Certificate', 'academic', false, 32),
  ('internship_certificate', 'Internship Completion Certificate', 'academic', false, 33),
  ('medical_registration', 'Medical Council Registration', 'academic', true, 34)
on conflict (key) do nothing;

alter table courses add column academic_profile text not null default 'school' check (academic_profile in ('school', 'pg_medical'));
update courses set academic_profile = 'pg_medical' where code = 'PG_MEDICAL';
grant insert (academic_profile) on courses to erp_app;
grant update (academic_profile) on courses to erp_app;

alter table students add column intake_id uuid references university_intakes(id);
grant select (intake_id) on students to erp_app;
grant insert (intake_id) on students to erp_app;
grant update (intake_id) on students to erp_app;

-- -----------------------------------------------------------------------------
-- Academic records and subjects
-- -----------------------------------------------------------------------------
create table academic_records (
  id                        uuid primary key default gen_random_uuid(),
  student_id                uuid not null references students(id),
  kind                      text not null check (kind in ('class_10', 'plus_two', 'bachelor', 'mbbs', 'internship', 'medical_registration', 'other')),
  title                     text check (title is null or length(title) <= 120),
  name_on_certificate       text check (name_on_certificate is null or length(btrim(name_on_certificate)) between 2 and 200),
  certificate_number        text check (certificate_number is null or length(certificate_number) <= 60),
  register_number           text check (register_number is null or length(register_number) <= 60),
  board                     text check (board is null or length(board) <= 160),
  institution_name          text check (institution_name is null or length(institution_name) <= 200),
  institution_country_id    uuid references countries(id),
  issuing_country_id        uuid references countries(id),
  year_of_passing           int check (year_of_passing is null or year_of_passing between 1950 and 2100),
  stream                    text check (stream is null or length(stream) <= 80),
  grading_system            text check (grading_system is null or grading_system in ('percentage', 'marks', 'cgpa_10', 'cgpa_4', 'letter_grade', 'other')),
  total_marks               numeric(8,2) check (total_marks is null or total_marks > 0),
  marks_obtained            numeric(8,2) check (marks_obtained is null or marks_obtained >= 0),
  percentage                numeric(5,2) check (percentage is null or percentage between 0 and 100),
  cgpa                      numeric(4,2) check (cgpa is null or cgpa between 0 and 10),
  grade                     text check (grade is null or length(grade) <= 20),
  issue_date                date,
  start_date                date,
  end_date                  date,
  registration_authority    text check (registration_authority is null or length(registration_authority) <= 160),
  registration_number       text check (registration_number is null or length(registration_number) <= 60),
  registration_valid_until  date,
  notes                     text check (notes is null or length(notes) <= 2000),
  created_by                uuid references user_profiles(id) default app.current_user_id(),
  created_at                timestamptz not null default now(),
  updated_by                uuid references user_profiles(id),
  updated_at                timestamptz not null default now(),
  check (marks_obtained is null or total_marks is null or marks_obtained <= total_marks),
  check (start_date is null or end_date is null or start_date <= end_date)
);
create index academic_records_student_idx on academic_records (student_id, kind);

create table academic_subjects (
  id              uuid primary key default gen_random_uuid(),
  record_id       uuid not null references academic_records(id) on delete cascade,
  subject_key     text not null default 'other' check (subject_key in ('physics', 'chemistry', 'biology', 'mathematics', 'english', 'other')),
  subject_name    text not null check (length(btrim(subject_name)) between 2 and 80),
  max_marks       numeric(7,2) check (max_marks is null or max_marks > 0),
  marks_obtained  numeric(7,2) check (marks_obtained is null or marks_obtained >= 0),
  percentage      numeric(5,2) check (percentage is null or percentage between 0 and 100),
  grade           text check (grade is null or length(grade) <= 20),
  sort_order      int not null default 100,
  check (marks_obtained is null or max_marks is null or marks_obtained <= max_marks)
);
create index academic_subjects_record_idx on academic_subjects (record_id, sort_order);

create or replace function app.academic_records_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.current_user_id(), new.updated_by);
  if tg_op = 'UPDATE' and new.student_id is distinct from old.student_id then
    raise exception 'the student of an academic record cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger academic_records_touch before insert or update on academic_records
  for each row execute function app.academic_records_touch();
create trigger academic_records_audit after insert or update or delete on academic_records
  for each row execute function app.audit_row('', 'student_id', 'updated_at', 'updated_by');
create trigger academic_subjects_audit after insert or update or delete on academic_subjects
  for each row execute function app.audit_row('', '');

-- Percentage of a record or subject: entered percentage, else marks ratio; never converted from CGPA/grades.
create or replace function app.pct(p_pct numeric, p_obtained numeric, p_total numeric) returns numeric
language sql immutable as $$
  select round(coalesce(p_pct, case when p_total > 0 and p_obtained is not null then p_obtained * 100 / p_total end), 2)
$$;

-- -----------------------------------------------------------------------------
-- Eligibility thresholds (flags only)
-- -----------------------------------------------------------------------------
create table academic_thresholds (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) between 3 and 160),
  destination_country_id  uuid references countries(id),
  university_id           uuid references universities(id),
  course_id               uuid references courses(id),
  intake_id               uuid references university_intakes(id),
  grading_system          text check (grading_system is null or grading_system in ('percentage', 'marks', 'cgpa_10', 'cgpa_4', 'letter_grade', 'other')),
  record_kind             text not null default 'plus_two' check (record_kind in ('class_10', 'plus_two', 'bachelor', 'mbbs')),
  subject_key             text not null check (subject_key in ('overall', 'physics', 'chemistry', 'biology', 'mathematics', 'english')),
  min_percentage          numeric(5,2) not null check (min_percentage between 0 and 100),
  is_active               boolean not null default true,
  source_note             text,
  created_by              uuid references user_profiles(id) default app.current_user_id(),
  created_at              timestamptz not null default now()
);
create trigger academic_thresholds_audit after insert or update or delete on academic_thresholds
  for each row execute function app.audit_row('', '');

create or replace function app.academic_eligibility(p_student uuid)
returns table (threshold_id uuid, name text, record_kind text, subject_key text, min_percentage numeric, actual numeric, result text)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from students where id = p_student)
  select t.id, t.name, t.record_kind, t.subject_key, t.min_percentage, v.actual,
         case when r.id is null then 'missing'
              when t.subject_key <> 'overall' and v.subject_found is not true then 'missing'
              when v.actual is null then 'not_comparable'
              when v.actual >= t.min_percentage then 'ok' else 'below' end
    from academic_thresholds t cross join s
    left join lateral (select * from academic_records ar where ar.student_id = s.id and ar.kind = t.record_kind
                         and (t.grading_system is null or ar.grading_system = t.grading_system)
                       order by ar.year_of_passing desc nulls last, ar.created_at desc limit 1) r on true
    left join lateral (
      select case when t.subject_key = 'overall' then app.pct(r.percentage, r.marks_obtained, r.total_marks)
                  else (select app.pct(x.percentage, x.marks_obtained, x.max_marks) from academic_subjects x
                         where x.record_id = r.id and x.subject_key = t.subject_key order by x.sort_order limit 1) end as actual,
             exists (select 1 from academic_subjects x where x.record_id = r.id and x.subject_key = t.subject_key) as subject_found) v on true
   where t.is_active
     and (t.destination_country_id is null or t.destination_country_id = s.destination_country_id)
     and (t.university_id is null or t.university_id = s.preferred_university_id)
     and (t.course_id is null or t.course_id = s.course_id)
     and (t.intake_id is null or t.intake_id = s.intake_id)
   order by t.name, t.subject_key
$$;

-- Stage check for academic data: none | warn | block (per stage; default warn at University Application)
alter table stages add column academic_check text not null default 'none' check (academic_check in ('none', 'warn', 'block'));
update stages set academic_check = 'warn' where key = 'university_application';
grant select (academic_check) on stages to erp_app;

create or replace function app.set_academic_check(p_stage text, p_check text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('academic.rules.manage')) then
    raise exception 'permission denied: academic.rules.manage' using errcode = '42501';
  end if;
  if p_check not in ('none', 'warn', 'block') then raise exception 'invalid value' using errcode = '23514'; end if;
  update stages set academic_check = p_check where key = p_stage and kind = 'normal';
  if not found then raise exception 'unknown stage' using errcode = '23514'; end if;
  perform app.audit('academic_check_changed', 'stages', p_stage, null, null, null, jsonb_build_object('stage', p_stage, 'check', p_check));
end $$;

-- -----------------------------------------------------------------------------
-- Name comparison (warnings for human review)
-- -----------------------------------------------------------------------------
create or replace function app.levenshtein(a text, b text) returns int
language plpgsql immutable as $$
declare
  la int := length(a); lb int := length(b); prev int[]; cur int[]; i int; j int; cost int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1 .. la loop
    cur := array[i];
    for j in 1 .. lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(cur[j] + 1, prev[j + 1] + 1, prev[j] + cost);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

create or replace function app.name_tokens(p text) returns text[]
language sql immutable as $$
  select coalesce(array_remove(regexp_split_to_array(btrim(regexp_replace(upper(coalesce(p, '')), '[^A-Z]+', ' ', 'g')), ' '), ''), '{}')
$$;

-- Returns the kinds of difference between a passport name and a certificate name ('{}' = same name).
create or replace function app.compare_names(p_passport text, p_certificate text) returns text[]
language plpgsql immutable as $$
declare
  a text[] := app.name_tokens(p_passport); b text[] := app.name_tokens(p_certificate);
  used boolean[]; types text[] := '{}'; pos int[] := '{}';
  i int; j int; found int; t text; u text; n int; maxd int;
begin
  if array_length(a, 1) is null or array_length(b, 1) is null then return '{}'; end if;
  if a = b then return '{}'; end if;
  if array_to_string(a, '') = array_to_string(b, '') then return array['spacing']; end if;
  used := array_fill(false, array[array_length(b, 1)]);
  for i in 1 .. array_length(a, 1) loop
    t := a[i]; found := null;
    for j in 1 .. array_length(b, 1) loop            -- exact
      if not used[j] and b[j] = t then found := j; exit; end if;
    end loop;
    if found is null then
      for j in 1 .. array_length(b, 1) loop          -- initials
        u := b[j];
        if not used[j] and ((length(u) = 1 and left(t, 1) = u) or (length(t) = 1 and left(u, 1) = t)) then
          found := j; types := array_append(types, 'initials'); exit;
        end if;
      end loop;
    end if;
    if found is null then
      for j in 1 .. array_length(b, 1) loop          -- spelling
        u := b[j];
        maxd := 1 + (greatest(length(t), length(u)) >= 7)::int;
        if not used[j] and length(t) > 2 and length(u) > 2 and app.levenshtein(t, u) <= maxd then
          found := j; types := array_append(types, 'spelling'); exit;
        end if;
      end loop;
    end if;
    if found is null then
      n := array_length(a, 1);
      types := array_append(types, case when i = n and n > 1 then 'missing_surname' when i > 1 then 'missing_middle_name' else 'other' end);
    else
      used[found] := true; pos := array_append(pos, found);
    end if;
  end loop;
  -- nothing in common: a completely different name (possibly the wrong document)
  if coalesce(array_length(pos, 1), 0) = 0 then return array['other']; end if;
  -- tokens on the certificate that are not in the passport name
  if exists (select 1 from unnest(used) x where not x) then
    types := array_append(types, 'extra_name');
  end if;
  -- order
  for i in 2 .. coalesce(array_length(pos, 1), 0) loop
    if pos[i] < pos[i - 1] then types := array_append(types, 'name_order'); exit; end if;
  end loop;
  if types = '{}' and a <> b then types := array['other']; end if;
  return array(select distinct x from unnest(types) x order by 1);
end $$;

create table name_checks (
  id                   uuid primary key default gen_random_uuid(),
  student_id           uuid not null references students(id),
  academic_record_id   uuid not null references academic_records(id) on delete cascade,
  passport_id          uuid not null references student_passports(id),
  passport_name        text not null,
  certificate_name     text not null,
  record_kind          text not null,
  mismatch_types       text[] not null,
  is_current           boolean not null default true,
  review_status        text not null default 'open' check (review_status in ('open', 'no_action', 'one_and_same')),
  reviewed_by          uuid references user_profiles(id),
  reviewed_at          timestamptz,
  review_note          text,
  created_at           timestamptz not null default now()
);
create unique index name_checks_current on name_checks (academic_record_id) where is_current;
create index name_checks_student_idx on name_checks (student_id) where is_current;

-- -----------------------------------------------------------------------------
-- One and Same: rules, templates, cases
-- -----------------------------------------------------------------------------
create table one_and_same_rules (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) between 3 and 160),
  destination_country_id  uuid references countries(id),
  university_id           uuid references universities(id),
  course_id               uuid references courses(id),
  record_kind             text check (record_kind is null or record_kind in ('class_10', 'plus_two', 'bachelor', 'mbbs', 'internship', 'medical_registration', 'other')),
  mismatch_type           text check (mismatch_type is null or mismatch_type in ('spelling', 'initials', 'missing_surname', 'missing_middle_name', 'name_order', 'extra_name', 'spacing', 'other')),
  requirement             text not null check (requirement in ('recommended', 'mandatory')),
  is_active               boolean not null default true,
  notes                   text,
  created_by              uuid references user_profiles(id) default app.current_user_id(),
  created_at              timestamptz not null default now()
);
create trigger one_and_same_rules_audit after insert or update or delete on one_and_same_rules
  for each row execute function app.audit_row('', '');

create table one_and_same_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 3 and 160),
  body         text not null check (length(btrim(body)) between 20 and 6000),
  status       text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  created_by   uuid references user_profiles(id) default app.current_user_id(),
  created_at   timestamptz not null default now(),
  approved_by  uuid references user_profiles(id),
  approved_at  timestamptz,
  check (status = 'draft' or approved_at is not null)
);
create or replace function app.guard_oas_template() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' and coalesce(current_setting('app.rule_change', true), 'off') <> 'on' then
    raise exception 'approved templates cannot be edited; create a new template' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger one_and_same_templates_frozen before update or delete on one_and_same_templates
  for each row execute function app.guard_oas_template();
create trigger one_and_same_templates_audit after insert or update or delete on one_and_same_templates
  for each row execute function app.audit_row('', '');

create table one_and_same_cases (
  id                   uuid primary key default gen_random_uuid(),
  student_id           uuid not null references students(id),
  name_check_id        uuid not null unique references name_checks(id),
  requirement          text not null check (requirement in ('recommended', 'mandatory')),
  rule_id              uuid references one_and_same_rules(id),
  student_document_id  uuid references student_documents(id),
  template_id          uuid references one_and_same_templates(id),
  preview_text         text,
  requested_at         timestamptz,
  requested_by         uuid references user_profiles(id),
  request_channel      text check (request_channel is null or request_channel in ('message', 'manual')),
  request_note         text,
  cancelled_at         timestamptz,
  cancelled_by         uuid references user_profiles(id),
  cancel_reason        text,
  created_by           uuid references user_profiles(id),
  created_at           timestamptz not null default now()
);
create trigger one_and_same_cases_audit after insert or update on one_and_same_cases
  for each row execute function app.audit_row('', 'student_id', 'preview_text');

-- Applicable requirement for a mismatch (mandatory beats recommended)
create or replace function app.one_and_same_requirement(p_check uuid) returns table (requirement text, rule_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.requirement, r.id
    from name_checks c join students s on s.id = c.student_id
    join one_and_same_rules r on r.is_active
   where c.id = p_check
     and (r.destination_country_id is null or r.destination_country_id = s.destination_country_id)
     and (r.university_id is null or r.university_id = s.preferred_university_id)
     and (r.course_id is null or r.course_id = s.course_id)
     and (r.record_kind is null or r.record_kind = c.record_kind)
     and (r.mismatch_type is null or r.mismatch_type = any(c.mismatch_types))
   order by (r.requirement = 'mandatory') desc limit 1
$$;

-- Status shown to staff (spec: Not Required / Recommended / Mandatory / Pending / Received / Verified / Approved)
create or replace function app.one_and_same_status(p_case uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when c.cancelled_at is not null then 'cancelled'
    when d.status = 'approved' then 'approved'
    when d.status in ('verified', 'pending_approval') then 'verified'
    when d.status in ('uploaded', 'under_review') then 'received'
    when c.requested_at is not null then 'pending'
    else c.requirement end
    from one_and_same_cases c left join student_documents d on d.id = c.student_document_id
   where c.id = p_case
$$;

create or replace function app.open_one_and_same_case(p_check uuid, p_requirement text, p_rule uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c name_checks%rowtype; v_id uuid := gen_random_uuid(); v_doc uuid; v_type uuid; v_org uuid; v_code text;
  v_staff uuid; v_mgr uuid; v_label text;
begin
  select * into c from name_checks where id = p_check;
  if exists (select 1 from one_and_same_cases where name_check_id = p_check) then
    select id into v_id from one_and_same_cases where name_check_id = p_check; return v_id;
  end if;
  select originating_org_id, student_code into v_org, v_code from students where id = c.student_id;
  select id into v_type from document_types where key = 'one_and_same';
  v_label := left('Name on ' || replace(c.record_kind, '_', ' ') || ': ' || c.certificate_name, 120);
  insert into student_documents (student_id, document_type_id, label, is_required)
  values (c.student_id, v_type, v_label, p_requirement = 'mandatory')
  on conflict (student_id, document_type_id, label) do update set is_required = student_documents.is_required or excluded.is_required
  returning id into v_doc;
  insert into one_and_same_cases (id, student_id, name_check_id, requirement, rule_id, student_document_id, created_by)
  values (v_id, c.student_id, p_check, p_requirement, p_rule, v_doc, app.current_user_id());
  if p_requirement = 'mandatory' then
    select a.user_id into v_staff from student_assignments a
     where a.student_id = c.student_id and a.is_active and a.assignment_type in ('documentation', 'counsellor')
       and app.user_is_active_member(a.user_id, v_org)
     order by (a.assignment_type = 'documentation') desc limit 1;
    select m.user_id into v_mgr from organization_memberships m join roles ro on ro.id = m.role_id join user_profiles u on u.id = m.user_id
     where m.org_id = v_org and m.is_active and u.is_active and ro.key in ('manager', 'md') order by (ro.key = 'manager') desc, u.full_name limit 1;
    insert into tasks (org_id, student_id, title, description, task_type, assigned_to, priority, due_date, source_key)
    values (v_org, c.student_id, 'One and Same required – ' || v_code,
            'Passport name "' || c.passport_name || '" differs from the ' || replace(c.record_kind, '_', ' ') || ' name "' || c.certificate_name
              || '". Choose an approved template, preview it and request the One and Same document.',
            'documentation', v_staff, 'high', current_date + 7, 'oas:' || v_id::text || ':staff')
    on conflict do nothing;
    insert into tasks (org_id, student_id, title, description, task_type, assigned_to, priority, due_date, source_key)
    values (v_org, c.student_id, 'For information: One and Same required – ' || v_code,
            'A mandatory One and Same document was added to the checklist (name mismatch on ' || replace(c.record_kind, '_', ' ') || ').',
            'documentation', v_mgr, 'normal', current_date + 7, 'oas:' || v_id::text || ':manager')
    on conflict do nothing;
  end if;
  perform app.add_event_internal(c.student_id, v_org, 'document', 'one_and_same_' || p_requirement,
    'One and Same ' || p_requirement || ': passport "' || c.passport_name || '" vs ' || replace(c.record_kind, '_', ' ') || ' "' || c.certificate_name || '"',
    'one_and_same_cases', v_id::text);
  return v_id;
end $$;

-- Recompute name checks for a student (called by triggers). Mandatory rules open a case automatically.
create or replace function app.refresh_name_checks(p_student uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pass student_passports%rowtype; r record; v_types text[]; v_existing name_checks%rowtype; v_id uuid; v_req record; v_n int := 0;
begin
  select * into v_pass from student_passports where student_id = p_student and is_current;
  for r in select * from academic_records where student_id = p_student and kind <> 'medical_registration' loop
    select * into v_existing from name_checks where academic_record_id = r.id and is_current;
    v_types := case when v_pass.holder_name is null or r.name_on_certificate is null then '{}'
                    else app.compare_names(v_pass.holder_name, r.name_on_certificate) end;
    if v_existing.id is not null and v_existing.passport_id = v_pass.id and v_existing.certificate_name = r.name_on_certificate
       and v_existing.mismatch_types = v_types then
      continue;
    end if;
    if v_existing.id is not null then update name_checks set is_current = false where id = v_existing.id; end if;
    if v_types <> '{}' then
      v_id := gen_random_uuid();
      insert into name_checks (id, student_id, academic_record_id, passport_id, passport_name, certificate_name, record_kind, mismatch_types)
      values (v_id, p_student, r.id, v_pass.id, v_pass.holder_name, r.name_on_certificate, r.kind, v_types);
      v_n := v_n + 1;
      select * into v_req from app.one_and_same_requirement(v_id);
      if v_req.requirement = 'mandatory' then
        perform app.open_one_and_same_case(v_id, 'mandatory', v_req.rule_id);
      end if;
    end if;
  end loop;
  return v_n;
end $$;

create or replace function app.name_checks_on_record() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.refresh_name_checks(new.student_id);
  return null;
end $$;
create trigger academic_records_name_check after insert or update of name_on_certificate, kind on academic_records
  for each row execute function app.name_checks_on_record();
create trigger student_passports_name_check after insert on student_passports
  for each row execute function app.name_checks_on_record();

-- Staff review of a finding
create or replace function app.review_name_check(p_check uuid, p_decision text, p_note text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c name_checks%rowtype; v_req record; v_case uuid;
begin
  select * into c from name_checks where id = p_check and is_current for update;
  if not found or not app.can_read_student(c.student_id) then raise exception 'name check not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(c.student_id, 'documents.review') then raise exception 'permission denied: documents.review' using errcode = '42501'; end if;
  if p_decision not in ('no_action', 'one_and_same') then raise exception 'invalid decision' using errcode = '23514'; end if;
  select * into v_req from app.one_and_same_requirement(p_check);
  if p_decision = 'no_action' then
    if v_req.requirement = 'mandatory' then
      raise exception 'a One and Same document is mandatory for this case; a manager can cancel the requirement with a reason' using errcode = '23514';
    end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'explain why no document is needed' using errcode = '23514'; end if;
  end if;
  update name_checks set review_status = p_decision, reviewed_by = app.current_user_id(), reviewed_at = now(), review_note = nullif(btrim(p_note), '')
   where id = p_check;
  if p_decision = 'one_and_same' then
    v_case := app.open_one_and_same_case(p_check, coalesce(v_req.requirement, 'recommended'), v_req.rule_id);
  end if;
  perform app.audit('name_check_reviewed', 'name_checks', p_check::text, null, c.student_id, null, jsonb_build_object('decision', p_decision, 'note', p_note));
  return v_case;
end $$;

create or replace function app.approve_one_and_same_template(p_template uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('one_and_same.templates.approve')) then
    raise exception 'permission denied: one_and_same.templates.approve' using errcode = '42501';
  end if;
  perform set_config('app.rule_change', 'on', true);
  update one_and_same_templates set status = 'approved', approved_by = app.current_user_id(), approved_at = now() where id = p_template and status = 'draft';
  if not found then raise exception 'only draft templates can be approved' using errcode = '23514'; end if;
  perform set_config('app.rule_change', 'off', true);
end $$;

create or replace function app.retire_one_and_same_template(p_template uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('one_and_same.templates.approve')) then
    raise exception 'permission denied: one_and_same.templates.approve' using errcode = '42501';
  end if;
  perform set_config('app.rule_change', 'on', true);
  update one_and_same_templates set status = 'retired' where id = p_template and status = 'approved';
  perform set_config('app.rule_change', 'off', true);
end $$;

-- Choose an approved template and generate the preview wording
create or replace function app.prepare_one_and_same(p_case uuid, p_template uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c one_and_same_cases%rowtype; k name_checks%rowtype; t one_and_same_templates%rowtype; s students%rowtype; v_text text;
begin
  select * into c from one_and_same_cases where id = p_case for update;
  if not found or not app.can_read_student(c.student_id) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(c.student_id, 'documents.review') then raise exception 'permission denied' using errcode = '42501'; end if;
  if c.cancelled_at is not null then raise exception 'this case is cancelled' using errcode = '23514'; end if;
  select * into t from one_and_same_templates where id = p_template and status = 'approved';
  if not found then raise exception 'choose an approved template' using errcode = '23514'; end if;
  select * into k from name_checks where id = c.name_check_id;
  select * into s from students where id = c.student_id;
  v_text := t.body;
  v_text := replace(v_text, '{{passport_name}}', k.passport_name);
  v_text := replace(v_text, '{{certificate_name}}', k.certificate_name);
  v_text := replace(v_text, '{{document}}', initcap(replace(k.record_kind, '_', ' ')));
  v_text := replace(v_text, '{{student_name}}', s.full_name);
  v_text := replace(v_text, '{{date}}', to_char(current_date, 'DD Mon YYYY'));
  update one_and_same_cases set template_id = p_template, preview_text = v_text where id = p_case;
  return v_text;
end $$;

-- Request the document from the student: by message (uses notification rules/consent) or recorded as manual
create or replace function app.request_one_and_same(p_case uuid, p_channel text, p_note text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare c one_and_same_cases%rowtype; k name_checks%rowtype; v_n int := 0; v_org uuid;
begin
  select * into c from one_and_same_cases where id = p_case for update;
  if not found or not app.can_read_student(c.student_id) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(c.student_id, 'documents.review') then raise exception 'permission denied' using errcode = '42501'; end if;
  if c.cancelled_at is not null then raise exception 'this case is cancelled' using errcode = '23514'; end if;
  if c.preview_text is null then raise exception 'choose a template and check the preview first' using errcode = '23514'; end if;
  if p_channel not in ('message', 'manual') then raise exception 'invalid channel' using errcode = '23514'; end if;
  if p_channel = 'manual' and coalesce(btrim(p_note), '') = '' then raise exception 'note how the student was contacted' using errcode = '23514'; end if;
  select * into k from name_checks where id = c.name_check_id;
  if p_channel = 'message' then
    v_n := app.enqueue_notification(c.student_id, 'one_and_same_requested',
      jsonb_build_object('document', initcap(replace(k.record_kind, '_', ' ')), 'preview', c.preview_text));
    if v_n = 0 then
      raise exception 'no message rule is switched on for One and Same requests; contact the student manually and record it' using errcode = '23514';
    end if;
  end if;
  update one_and_same_cases set requested_at = now(), requested_by = app.current_user_id(), request_channel = p_channel,
         request_note = nullif(btrim(p_note), '') where id = p_case;
  select originating_org_id into v_org from students where id = c.student_id;
  perform app.add_event_internal(c.student_id, v_org, 'document', 'one_and_same_requested',
    'One and Same document requested from the student (' || case p_channel when 'message' then 'message queued' else 'manual: ' || btrim(p_note) end || ')',
    'one_and_same_cases', p_case::text);
  return v_n;
end $$;

create or replace function app.cancel_one_and_same(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c one_and_same_cases%rowtype; v_org uuid;
begin
  select * into c from one_and_same_cases where id = p_case for update;
  if not found or not app.can_read_student(c.student_id) then raise exception 'case not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(c.student_id, 'documents.approve') then raise exception 'permission denied: only a manager can cancel a One and Same requirement' using errcode = '42501'; end if;
  if c.cancelled_at is not null then raise exception 'already cancelled' using errcode = '23514'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  update one_and_same_cases set cancelled_at = now(), cancelled_by = app.current_user_id(), cancel_reason = btrim(p_reason) where id = p_case;
  update student_documents set is_required = false where id = c.student_document_id and status = 'missing';
  update tasks set status = 'cancelled' where source_key like 'oas:' || p_case::text || ':%' and status not in ('completed', 'cancelled');
  select originating_org_id into v_org from students where id = c.student_id;
  perform app.add_event_internal(c.student_id, v_org, 'document', 'one_and_same_cancelled', 'One and Same requirement cancelled: ' || btrim(p_reason),
    'one_and_same_cases', p_case::text);
end $$;

-- -----------------------------------------------------------------------------
-- Stage requirements: add academic checks (redefines 0019 version)
-- -----------------------------------------------------------------------------
create or replace function app.stage_requirement_issues(p_student uuid, p_to_stage text)
returns table (kind text, enforcement text, message text)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from students where id = p_student),
  ts as (select * from stages where key = p_to_stage and kind = 'normal'),
  ac as (select x.academic_check from stages x, ts where x.academic_check <> 'none' and x.kind = 'normal' and x.sort_order <= ts.sort_order
          order by x.sort_order desc limit 1),
  prof as (select coalesce((select c.academic_profile from courses c, s where c.id = s.course_id), 'school') as p)
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
  union all
  select 'academic', ac.academic_check,
         case (select p from prof) when 'pg_medical' then 'MBBS degree details are not recorded' else 'Plus Two (higher secondary) details are not recorded' end
    from s, ac
   where not exists (select 1 from academic_records r where r.student_id = s.id
                       and r.kind = case (select p from prof) when 'pg_medical' then 'mbbs' else 'plus_two' end)
  union all
  select 'academic', ac.academic_check,
         e.name || ': ' || initcap(replace(e.subject_key, '_', ' ')) || ' '
           || case e.result when 'below' then e.actual || '% is below ' || e.min_percentage || '%'
                            when 'missing' then 'marks not recorded (minimum ' || e.min_percentage || '%)'
                            else 'cannot be compared (grading system without a percentage; check manually against ' || e.min_percentage || '%)' end
    from s, ac, app.academic_eligibility(s.id) e
   where e.result in ('below', 'missing', 'not_comparable')
     and exists (select 1 from academic_records r where r.student_id = s.id and r.kind = e.record_kind)
$$;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
alter table notification_rules drop constraint notification_rules_event_key_check;
alter table notification_rules add constraint notification_rules_event_key_check
  check (event_key in ('student_registered', 'stage_changed', 'document_changes_required', 'document_rejected', 'document_approved',
                       'visa_outcome', 'portal_login_code', 'attestation_stage_completed', 'attestation_completed', 'one_and_same_requested'));

-- -----------------------------------------------------------------------------
-- Student view: + intake
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
       app.passport_tier(s.passport_expiry) as passport_status,
       s.intake_id
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table academic_records enable row level security;
alter table academic_subjects enable row level security;
alter table academic_thresholds enable row level security;
alter table name_checks enable row level security;
alter table one_and_same_rules enable row level security;
alter table one_and_same_templates enable row level security;
alter table one_and_same_cases enable row level security;

create policy academic_records_select on academic_records for select to erp_app using (app.can_read_student(student_id));
create policy academic_records_write on academic_records for all to erp_app
  using (app.can_on_student(student_id, 'students.update')) with check (app.can_on_student(student_id, 'students.update'));
create policy academic_subjects_select on academic_subjects for select to erp_app
  using (exists (select 1 from academic_records r where r.id = record_id));
create policy academic_subjects_write on academic_subjects for all to erp_app
  using (exists (select 1 from academic_records r where r.id = record_id and app.can_on_student(r.student_id, 'students.update')))
  with check (exists (select 1 from academic_records r where r.id = record_id and app.can_on_student(r.student_id, 'students.update')));
create policy thresholds_select on academic_thresholds for select to erp_app using (app.current_user_id() is not null);
create policy thresholds_write on academic_thresholds for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('academic.rules.manage'))) with check (exists (select 1 from app.orgs_with_perm('academic.rules.manage')));
create policy name_checks_select on name_checks for select to erp_app using (app.can_read_student(student_id));
create policy oas_rules_select on one_and_same_rules for select to erp_app using (app.current_user_id() is not null);
create policy oas_rules_write on one_and_same_rules for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('academic.rules.manage'))) with check (exists (select 1 from app.orgs_with_perm('academic.rules.manage')));
create policy oas_templates_select on one_and_same_templates for select to erp_app using (app.current_user_id() is not null);
create policy oas_templates_write on one_and_same_templates for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('academic.rules.manage')))
  with check (exists (select 1 from app.orgs_with_perm('academic.rules.manage')) and status = 'draft');
create policy oas_cases_select on one_and_same_cases for select to erp_app using (app.can_read_student(student_id));

grant select, insert, update, delete on academic_records, academic_subjects to erp_app;
grant select, insert, update, delete on academic_thresholds, one_and_same_rules, one_and_same_templates to erp_app;
grant select on name_checks, one_and_same_cases to erp_app;
grant execute on function
  app.pct(numeric, numeric, numeric), app.academic_eligibility(uuid), app.levenshtein(text, text), app.name_tokens(text), app.compare_names(text, text),
  app.one_and_same_requirement(uuid), app.one_and_same_status(uuid), app.review_name_check(uuid, text, text),
  app.approve_one_and_same_template(uuid), app.retire_one_and_same_template(uuid), app.prepare_one_and_same(uuid, uuid),
  app.request_one_and_same(uuid, text, text), app.cancel_one_and_same(uuid, text), app.refresh_name_checks(uuid),
  app.set_academic_check(text, text)
to erp_app;
