-- Phase 9: secondary and tertiary preferences, academic years, intake on advisory notices, and configurable country document rules.
-- The primary preference stays on the student record (destination, university, course, intake); it is not duplicated.
-- Everything here advises. Nothing blocks registration. A country document rule can be active only after an approved person marks it verified.

insert into permissions (key, category, description, is_sensitive) values
  ('requirements.verify', 'Administration', 'Confirm a country document rule as verified, so it can be activated', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'requirements.verify' from roles r where r.key = 'md' on conflict do nothing;

create table academic_years (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[0-9]{4}(-[0-9]{2,4})?$'),
  sort_order int not null default 100,
  is_active  boolean not null default true,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now()
);
create trigger academic_years_audit after insert or update or delete on academic_years for each row execute function app.audit_row('', '');

create table student_preferences (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id),
  rank             int not null check (rank in (2, 3)),
  country_id       uuid not null references countries(id),
  university_id    uuid references universities(id),
  course_id        uuid references courses(id),
  intake_id        uuid references university_intakes(id),
  academic_year_id uuid references academic_years(id),
  updated_by       uuid not null references user_profiles(id),
  updated_at       timestamptz not null default now(),
  unique (student_id, rank)
);

-- Names as they were at the time, so history survives later master-data changes.
create table student_preference_history (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  rank       int not null,
  action     text not null check (action in ('saved', 'cleared')),
  country    text,
  university text,
  programme  text,
  intake     text,
  academic_year text,
  changed_by uuid not null references user_profiles(id),
  changed_at timestamptz not null default now()
);
create index student_preference_history_student on student_preference_history (student_id, changed_at desc);

create table country_document_rules (
  id                  uuid primary key default gen_random_uuid(),
  country_id          uuid not null references countries(id),
  university_id       uuid references universities(id),
  course_id           uuid references courses(id),
  document_type_id    uuid not null references document_types(id),
  stage_key           text references stages(key),
  is_required         boolean not null default true,
  match_rule          text check (match_rule in ('issuing_country_matches_visa_application_country')),
  guidance            text check (guidance is null or length(guidance) <= 2000),
  source_note         text check (source_note is null or length(source_note) <= 500),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified')),
  verified_by         uuid references user_profiles(id),
  verified_at         timestamptz,
  verification_note   text check (verification_note is null or length(verification_note) <= 500),
  is_active           boolean not null default false,
  created_by          uuid references user_profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (not is_active or verification_status = 'verified')
);
create unique index country_document_rules_key on country_document_rules (country_id, coalesce(university_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid), document_type_id);
create trigger country_document_rules_touch before update on country_document_rules for each row execute function app.touch_updated_at();
create trigger country_document_rules_audit after insert or update or delete on country_document_rules for each row execute function app.audit_row('', '');

-- From the MD's brief of 5 Nov 2026. Timing guidance stays empty until the business gives it. Fresh databases get these from provisioning, after the countries exist.
insert into country_document_rules (country_id, document_type_id, stage_key, is_required, match_rule, source_note, verification_status, verified_at, verification_note, is_active)
select c.id, d.id, case when d.key = 'police_clearance' then (select key from stages where permission_key = 'stage.visa' order by sort_order limit 1) end, true,
       case when d.key = 'police_clearance' then 'issuing_country_matches_visa_application_country' end, 'MD brief, 5 Nov 2026', 'verified', now(), 'Stated in the MD brief of 5 Nov 2026', true
  from countries c cross join document_types d where c.code = 'BG' and d.key in ('bonafide_certificate', 'police_clearance');

alter table academic_years enable row level security;
alter table student_preferences enable row level security;
alter table student_preference_history enable row level security;
alter table country_document_rules enable row level security;
create policy academic_years_select on academic_years for select to erp_app using (app.current_user_id() is not null);
create policy student_preferences_select on student_preferences for select to erp_app using (app.can_read_student(student_id));
create policy student_preference_history_select on student_preference_history for select to erp_app using (app.can_read_student(student_id));
create policy country_document_rules_select on country_document_rules for select to erp_app using (app.current_user_id() is not null);
grant select on academic_years, student_preferences, student_preference_history, country_document_rules to erp_app;

create or replace function app.save_academic_year(p_id uuid, p_code text, p_sort int, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not exists (select 1 from app.orgs_with_perm('masterdata.status')) then raise exception 'permission denied: academic years' using errcode = '42501'; end if;
  if coalesce(btrim(p_code), '') !~ '^[0-9]{4}(-[0-9]{2,4})?$' then raise exception 'Write the year like 2027-28.' using errcode = '23514'; end if;
  if exists (select 1 from academic_years y where y.code = btrim(p_code) and y.id is distinct from p_id) then raise exception 'That academic year already exists.' using errcode = '23514'; end if;
  if p_id is null then
    insert into academic_years (code, sort_order, is_active, created_by) values (btrim(p_code), coalesce(p_sort, 100), coalesce(p_active, true), app.current_user_id()) returning id into v_id;
  else
    update academic_years set code = btrim(p_code), sort_order = coalesce(p_sort, sort_order), is_active = coalesce(p_active, is_active) where id = p_id returning id into v_id;
    if v_id is null then raise exception 'academic year not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function app.student_preference_save(p_student uuid, p_rank int, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id(); v_country uuid := nullif(p->>'country_id', '')::uuid; v_uni uuid := nullif(p->>'university_id', '')::uuid; v_course uuid := nullif(p->>'course_id', '')::uuid; v_intake uuid := nullif(p->>'intake_id', '')::uuid; v_year uuid := nullif(p->>'academic_year_id', '')::uuid; s students%rowtype;
begin
  if not app.can_on_student(p_student, 'students.update') then raise exception 'permission denied: student preferences' using errcode = '42501'; end if;
  if p_rank not in (2, 3) then raise exception 'Choose secondary or tertiary.' using errcode = '23514'; end if;
  select * into s from students where id = p_student;
  if s.archived_at is not null or s.status = 'merged' then raise exception 'This student record cannot be changed.' using errcode = '23514'; end if;
  if v_country is null or not exists (select 1 from countries c where c.id = v_country and c.is_active) then raise exception 'Choose an active country.' using errcode = '23514'; end if;
  if v_uni is not null and not exists (select 1 from universities u where u.id = v_uni and u.country_id = v_country and u.is_active) then raise exception 'That university is not in the chosen country.' using errcode = '23514'; end if;
  if v_course is not null and not exists (select 1 from courses c where c.id = v_course and c.is_active) then raise exception 'Choose an active programme.' using errcode = '23514'; end if;
  if v_intake is not null and not exists (select 1 from university_intakes i where i.id = v_intake and i.university_id = v_uni and (i.course_id is null or i.course_id is not distinct from v_course)) then raise exception 'That intake does not belong to the chosen university and programme.' using errcode = '23514'; end if;
  if v_year is not null and not exists (select 1 from academic_years y where y.id = v_year and y.is_active) then raise exception 'Choose an active academic year.' using errcode = '23514'; end if;
  if s.destination_country_id = v_country and s.preferred_university_id is not distinct from v_uni and s.course_id is not distinct from v_course then raise exception 'This is the same as the primary preference.' using errcode = '23514'; end if;
  if exists (select 1 from student_preferences x where x.student_id = p_student and x.rank <> p_rank and x.country_id = v_country and x.university_id is not distinct from v_uni and x.course_id is not distinct from v_course) then raise exception 'That preference is already listed.' using errcode = '23514'; end if;
  insert into student_preferences (student_id, rank, country_id, university_id, course_id, intake_id, academic_year_id, updated_by) values (p_student, p_rank, v_country, v_uni, v_course, v_intake, v_year, v_me)
  on conflict (student_id, rank) do update set country_id = excluded.country_id, university_id = excluded.university_id, course_id = excluded.course_id, intake_id = excluded.intake_id, academic_year_id = excluded.academic_year_id, updated_by = v_me, updated_at = now();
  insert into student_preference_history (student_id, rank, action, country, university, programme, intake, academic_year, changed_by)
  values (p_student, p_rank, 'saved', (select name from countries where id = v_country), (select name from universities where id = v_uni), (select name from courses where id = v_course), (select name from university_intakes where id = v_intake), (select code from academic_years where id = v_year), v_me);
  perform app.audit('student_preference_saved', 'students', p_student::text, s.originating_org_id, p_student, null, jsonb_build_object('rank', p_rank));
end $$;

create or replace function app.student_preference_clear(p_student uuid, p_rank int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if not app.can_on_student(p_student, 'students.update') then raise exception 'permission denied: student preferences' using errcode = '42501'; end if;
  delete from student_preferences where student_id = p_student and rank = p_rank;
  if not found then return; end if;
  select originating_org_id into v_org from students where id = p_student;
  insert into student_preference_history (student_id, rank, action, changed_by) values (p_student, p_rank, 'cleared', app.current_user_id());
  perform app.audit('student_preference_cleared', 'students', p_student::text, v_org, p_student, null, jsonb_build_object('rank', p_rank));
end $$;

-- Editing a rule's meaning returns it to unverified and inactive. Guidance text is an edit too, unless the verifier makes it.
create or replace function app.save_country_document_rule(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_country uuid := nullif(p->>'country_id', '')::uuid; v_uni uuid := nullif(p->>'university_id', '')::uuid; v_course uuid := nullif(p->>'course_id', '')::uuid; v_doc uuid := nullif(p->>'document_type_id', '')::uuid; v_stage text := nullif(p->>'stage_key', ''); v_match text := nullif(p->>'match_rule', ''); v_keep boolean := exists (select 1 from app.orgs_with_perm('requirements.verify'));
begin
  if not exists (select 1 from app.orgs_with_perm('requirements.manage')) and not v_keep then raise exception 'permission denied: requirements.manage' using errcode = '42501'; end if;
  if v_country is null or not exists (select 1 from countries where id = v_country) then raise exception 'Choose the country.' using errcode = '23514'; end if;
  if v_doc is null or not exists (select 1 from document_types where id = v_doc) then raise exception 'Choose the document.' using errcode = '23514'; end if;
  if v_uni is not null and not exists (select 1 from universities u where u.id = v_uni and u.country_id = v_country) then raise exception 'That university is not in the chosen country.' using errcode = '23514'; end if;
  if v_stage is not null and not exists (select 1 from stages where key = v_stage) then raise exception 'Choose a stage from the list.' using errcode = '23514'; end if;
  if exists (select 1 from country_document_rules r where r.country_id = v_country and r.university_id is not distinct from v_uni and r.course_id is not distinct from v_course and r.document_type_id = v_doc and r.id is distinct from p_id) then raise exception 'A rule for this document already exists here.' using errcode = '23514'; end if;
  if p_id is null then
    insert into country_document_rules (country_id, university_id, course_id, document_type_id, stage_key, is_required, match_rule, guidance, source_note, created_by)
    values (v_country, v_uni, v_course, v_doc, v_stage, coalesce((p->>'is_required')::boolean, true), v_match, nullif(btrim(p->>'guidance'), ''), nullif(btrim(p->>'source_note'), ''), app.current_user_id()) returning id into v_id;
  else
    update country_document_rules set country_id = v_country, university_id = v_uni, course_id = v_course, document_type_id = v_doc, stage_key = v_stage, is_required = coalesce((p->>'is_required')::boolean, true), match_rule = v_match, guidance = nullif(btrim(p->>'guidance'), ''), source_note = nullif(btrim(p->>'source_note'), ''),
      verification_status = case when v_keep then verification_status else 'unverified' end, verified_by = case when v_keep then verified_by end, verified_at = case when v_keep then verified_at end, is_active = case when v_keep then is_active else false end
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'rule not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

create or replace function app.verify_country_document_rule(p_id uuid, p_verified boolean, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not exists (select 1 from app.orgs_with_perm('requirements.verify')) then raise exception 'permission denied: verifying a rule' using errcode = '42501'; end if;
  if v_note is null or length(v_note) < 3 then raise exception 'Say what this decision is based on.' using errcode = '23514'; end if;
  update country_document_rules set verification_status = case when p_verified then 'verified' else 'unverified' end, verified_by = case when p_verified then app.current_user_id() end, verified_at = case when p_verified then now() end, verification_note = v_note, is_active = case when p_verified then is_active else false end where id = p_id;
  if not found then raise exception 'rule not found' using errcode = 'P0002'; end if;
end $$;

create or replace function app.set_country_document_rule_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('requirements.manage')) and not exists (select 1 from app.orgs_with_perm('requirements.verify')) then raise exception 'permission denied: requirements.manage' using errcode = '42501'; end if;
  if p_active and not exists (select 1 from country_document_rules r where r.id = p_id and r.verification_status = 'verified') then raise exception 'Only a verified rule can be activated.' using errcode = '23514'; end if;
  update country_document_rules set is_active = p_active where id = p_id;
  if not found then raise exception 'rule not found' using errcode = 'P0002'; end if;
end $$;

-- What applies to one preference of a student (rank 1 is the record itself). Display only.
create or replace function app.student_preference_requirements(p_student uuid, p_rank int) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s students%rowtype; v_country uuid; v_uni uuid; v_course uuid; v_intake uuid;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  select * into s from students where id = p_student;
  if p_rank = 1 then v_country := s.destination_country_id; v_uni := s.preferred_university_id; v_course := s.course_id; v_intake := s.intake_id;
  else select country_id, university_id, course_id, intake_id into v_country, v_uni, v_course, v_intake from student_preferences where student_id = p_student and rank = p_rank; end if;
  if v_country is null then return null; end if;
  return jsonb_build_object(
    'advisories', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'message', a.message, 'priority', a.priority, 'academic_status', a.academic_status, 'items', a.items)), '[]') from app.student_advisories_for(p_student, v_country, v_uni, v_course, v_intake) a),
    'university_documents', (select coalesce(jsonb_agg(jsonb_build_object('document', d.name, 'required', r.is_required, 'notes', r.notes, 'conditional', r.conditions is not null, 'status', sd.status) order by d.sort_order), '[]')
        from university_document_requirements r join document_types d on d.id = r.document_type_id left join student_documents sd on sd.student_id = p_student and sd.document_type_id = d.id
       where r.university_id = v_uni and (r.course_id is null or r.course_id is not distinct from v_course)),
    'country_documents', (select coalesce(jsonb_agg(jsonb_build_object('document', d.name, 'required', r.is_required, 'stage', st.name, 'guidance', r.guidance, 'status', sd.status,
          'match', case when r.match_rule is null then null when sd.issuing_country_id is null or s.visa_application_country_id is null then 'unknown' when sd.issuing_country_id = s.visa_application_country_id then 'match' else 'mismatch' end) order by d.sort_order), '[]')
        from country_document_rules r join document_types d on d.id = r.document_type_id left join stages st on st.key = r.stage_key left join student_documents sd on sd.student_id = p_student and sd.document_type_id = d.id
       where r.is_active and r.verification_status = 'verified' and r.country_id = v_country and (r.university_id is null or r.university_id is not distinct from v_uni) and (r.course_id is null or r.course_id is not distinct from v_course)),
    'passport', (select coalesce(jsonb_agg(jsonb_build_object('rule', r.name, 'months', r.min_months, 'status', case when s.passport_expiry is null then 'missing' when s.passport_expiry >= current_date + make_interval(months => r.min_months) then 'meets' else 'below' end)), '[]')
        from passport_validity_rules r where r.is_active and (r.destination_country_id is null or r.destination_country_id = v_country) and (r.university_id is null or r.university_id is not distinct from v_uni) and (r.course_id is null or r.course_id is not distinct from v_course)));
end $$;

alter table advisory_notices add column intake_id uuid references university_intakes(id);
create or replace function app.save_advisory_notice(p_group uuid, p jsonb, p_items jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur advisory_notices%rowtype; v_id uuid := gen_random_uuid(); v_group uuid := coalesce(p_group, gen_random_uuid()); v_prev jsonb; i jsonb; k int := 0;
begin
  if not exists (select 1 from app.orgs_with_perm('requirements.manage')) then
    raise exception 'permission denied: requirements.manage' using errcode = '42501';
  end if;
  if p_group is not null then
    select * into v_cur from advisory_notices where notice_group_id = p_group and status <> 'superseded' for update;
    if not found then raise exception 'requirement not found' using errcode = 'P0002'; end if;
    if coalesce(btrim(p_reason), '') = '' then raise exception 'give the reason for the change' using errcode = '23514'; end if;
    v_prev := app.advisory_snapshot(v_cur.id);
    perform set_config('app.advisory_change', 'on', true);
    update advisory_notices set status = 'superseded', superseded_at = now() where id = v_cur.id;
    perform set_config('app.advisory_change', 'off', true);
  end if;
  insert into advisory_notices (id, notice_group_id, version, category, display_type, priority, destination_country_id, university_id, course_id, intake_id,
                                title, message, description, notes, requires_acknowledgement, effective_from, effective_to, status, change_reason, created_by)
  values (v_id, v_group, coalesce(v_cur.version, 0) + 1, coalesce(p ->> 'category', 'academic_marks'), coalesce(p ->> 'display_type', 'important_warning'),
          coalesce(p ->> 'priority', 'high'), (p ->> 'destination_country_id')::uuid, nullif(p ->> 'university_id', '')::uuid, nullif(p ->> 'course_id', '')::uuid, nullif(p ->> 'intake_id', '')::uuid,
          btrim(p ->> 'title'), btrim(p ->> 'message'), nullif(btrim(p ->> 'description'), ''), nullif(btrim(p ->> 'notes'), ''),
          coalesce((p ->> 'requires_acknowledgement')::boolean, true), coalesce(nullif(p ->> 'effective_from', '')::date, current_date),
          nullif(p ->> 'effective_to', '')::date, coalesce(v_cur.status, 'active'), nullif(btrim(p_reason), ''), app.current_user_id());
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    k := k + 1;
    insert into advisory_notice_items (notice_id, record_kind, subject_key, subject_name, min_percentage, min_marks, grading_system, description, sort_order)
    values (v_id, coalesce(i ->> 'record_kind', 'plus_two'), i ->> 'subject_key', btrim(i ->> 'subject_name'), nullif(i ->> 'min_percentage', '')::numeric,
            nullif(i ->> 'min_marks', '')::numeric, nullif(i ->> 'grading_system', ''), nullif(btrim(i ->> 'description'), ''), k * 10);
  end loop;
  insert into advisory_notice_events (notice_group_id, notice_id, version, action, reason, previous, current, actor_id)
  values (v_group, v_id, coalesce(v_cur.version, 0) + 1, case when p_group is null then 'created' else 'edited' end, nullif(btrim(p_reason), ''),
          v_prev, app.advisory_snapshot(v_id), app.current_user_id());
  return v_id;
end $$;
-- The same comparison for any target, so a secondary or tertiary preference is checked the same way as the primary.
create or replace function app.student_advisories_for(p_student uuid, p_country uuid, p_university uuid, p_course uuid, p_intake uuid)
returns table (notice_id uuid, notice_group_id uuid, version int, category text, display_type text, priority text, title text, message text,
               description text, notes text, requires_acknowledgement boolean, country text, university text, course text,
               items jsonb, academic_status text, acknowledged_at timestamptz, acknowledged_by text, earlier_acknowledgement boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from students where id = p_student),
  n as (
    select a.* from advisory_notices a, s
     where a.status = 'active' and a.effective_from <= current_date and (a.effective_to is null or a.effective_to >= current_date)
       and a.destination_country_id = p_country
       and (a.university_id is null or a.university_id = p_university)
       and (a.course_id is null or a.course_id = p_course)
       and (a.intake_id is null or a.intake_id = p_intake)),
  ev as (
    select i.notice_id, i.sort_order, i.subject_key, i.subject_name, i.min_percentage, i.min_marks, i.record_kind, r.id as record_id, x.found, x.pct, x.marks,
           case when r.id is null then 'missing'
                when i.subject_key <> 'overall' and not x.found then 'missing'
                when i.min_percentage is not null and x.pct is not null then case when x.pct >= i.min_percentage then 'ok' else 'below' end
                when i.min_marks is not null and x.marks is not null then case when x.marks >= i.min_marks then 'ok' else 'below' end
                when x.pct is null and x.marks is null then 'missing'
                else 'not_comparable' end as result
      from advisory_notice_items i join n on n.id = i.notice_id cross join s
      left join lateral (select * from academic_records ar where ar.student_id = s.id and ar.kind = i.record_kind
                           and (i.grading_system is null or ar.grading_system = i.grading_system)
                         order by ar.year_of_passing desc nulls last, ar.created_at desc limit 1) r on true
      left join lateral (
        select case when i.subject_key = 'overall' then true else exists (select 1 from academic_subjects y where y.record_id = r.id and y.subject_key = i.subject_key) end as found,
               case when i.subject_key = 'overall' then app.pct(r.percentage, r.marks_obtained, r.total_marks)
                    else (select app.pct(y.percentage, y.marks_obtained, y.max_marks) from academic_subjects y where y.record_id = r.id and y.subject_key = i.subject_key order by y.sort_order limit 1) end as pct,
               case when i.subject_key = 'overall' then r.marks_obtained
                    else (select y.marks_obtained from academic_subjects y where y.record_id = r.id and y.subject_key = i.subject_key order by y.sort_order limit 1) end as marks) x on true)
  select n.id, n.notice_group_id, n.version, n.category, n.display_type, n.priority, n.title, n.message, n.description, n.notes, n.requires_acknowledgement,
         c.name, u.name, co.name,
         coalesce((select jsonb_agg(jsonb_build_object('subject', e.subject_name, 'subject_key', e.subject_key, 'record_kind', e.record_kind,
                     'min_percentage', e.min_percentage, 'min_marks', e.min_marks, 'actual', coalesce(e.pct, e.marks), 'result', e.result) order by e.sort_order)
                     from ev e where e.notice_id = n.id), '[]'::jsonb),
         (select case when count(*) = 0 then null
                      when bool_or(e.result = 'missing') then 'missing'
                      when bool_or(e.result = 'below') then 'below'
                      when bool_or(e.result = 'not_comparable') then 'manual_review'
                      else 'meets' end from ev e where e.notice_id = n.id),
         ak.acknowledged_at, ak.by_name,
         (ak.acknowledged_at is null and exists (select 1 from advisory_acknowledgements o join advisory_notices on2 on on2.id = o.notice_id
                                                  where o.student_id = p_student and on2.notice_group_id = n.notice_group_id))
    from n join countries c on c.id = n.destination_country_id
    left join universities u on u.id = n.university_id left join courses co on co.id = n.course_id
    left join lateral (select a.acknowledged_at, up.full_name as by_name from advisory_acknowledgements a join user_profiles up on up.id = a.acknowledged_by
                        where a.student_id = p_student and a.notice_id = n.id order by a.acknowledged_at desc limit 1) ak on true
   order by array_position(array['critical', 'high', 'normal', 'informational'], n.priority), n.title
$$;
create or replace function app.student_advisories(p_student uuid)
returns table (notice_id uuid, notice_group_id uuid, version int, category text, display_type text, priority text, title text, message text,
               description text, notes text, requires_acknowledgement boolean, country text, university text, course text,
               items jsonb, academic_status text, acknowledged_at timestamptz, acknowledged_by text, earlier_acknowledgement boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.* from students s cross join lateral app.student_advisories_for(s.id, s.destination_country_id, s.preferred_university_id, s.course_id, s.intake_id) a where s.id = p_student
$$;

revoke execute on function app.save_academic_year(uuid, text, int, boolean), app.student_preference_save(uuid, int, jsonb), app.student_preference_clear(uuid, int), app.save_country_document_rule(uuid, jsonb), app.verify_country_document_rule(uuid, boolean, text), app.set_country_document_rule_active(uuid, boolean),
  app.student_preference_requirements(uuid, int), app.student_advisories_for(uuid, uuid, uuid, uuid, uuid), app.student_advisories(uuid), app.save_advisory_notice(uuid, jsonb, jsonb, text) from public;
grant execute on function app.save_academic_year(uuid, text, int, boolean), app.student_preference_save(uuid, int, jsonb), app.student_preference_clear(uuid, int), app.save_country_document_rule(uuid, jsonb), app.verify_country_document_rule(uuid, boolean, text), app.set_country_document_rule_active(uuid, boolean),
  app.student_preference_requirements(uuid, int), app.student_advisories_for(uuid, uuid, uuid, uuid, uuid), app.student_advisories(uuid), app.save_advisory_notice(uuid, jsonb, jsonb, text) to erp_app;
