-- =============================================================================
-- 0021 Country-wise requirements as ADVISORY NOTICES (business change, Nov 2026)
--
-- * Replaces the Phase 3 "eligibility thresholds": academic mark requirements are
--   advisory. They are shown prominently, can require staff acknowledgement, and
--   are compared with the student's marks — but they NEVER block or reject.
-- * Notices are versioned per country (optionally university / course) and have a
--   category (academic marks, age, prerequisites, language, entrance exam,
--   documents, nationality, general), a display type (critical alert, mandatory
--   notice, important warning, additional point, general information) and a
--   priority. Editing creates a new version; acknowledgements keep the exact
--   version and a snapshot of the comparison.
-- * academic_thresholds is kept (no deletion) but no longer used; its rows are
--   converted into notices and switched off.
-- * Stage academic checks can no longer "block".
-- =============================================================================

insert into countries (code, name, is_destination, is_education_origin) values ('RO', 'Romania', true, false) on conflict (code) do nothing;

insert into permissions (key, category, description, is_sensitive) values
  ('requirements.manage', 'Administration', 'Manage country-wise requirement notices (academic and other advisory notices)', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, 'requirements.manage' from roles r where r.key = 'system_admin' on conflict do nothing;

create table advisory_notices (
  id                        uuid primary key default gen_random_uuid(),
  notice_group_id           uuid not null default gen_random_uuid(),
  version                   int not null default 1,
  category                  text not null default 'academic_marks' check (category in ('academic_marks', 'age', 'subject_prerequisite', 'language',
                                                    'entrance_exam', 'document', 'nationality', 'general')),
  display_type              text not null default 'important_warning' check (display_type in ('critical_alert', 'mandatory_notice', 'important_warning',
                                                    'additional_point', 'general_information')),
  priority                  text not null default 'high' check (priority in ('critical', 'high', 'normal', 'informational')),
  destination_country_id    uuid not null references countries(id),
  university_id             uuid references universities(id),
  course_id                 uuid references courses(id),
  title                     text not null check (length(btrim(title)) between 3 and 200),
  message                   text not null check (length(btrim(message)) between 3 and 4000),
  description               text check (description is null or length(description) <= 4000),
  notes                     text check (notes is null or length(notes) <= 4000),
  requires_acknowledgement  boolean not null default true,
  effective_from            date not null default current_date,
  effective_to              date,
  status                    text not null default 'active' check (status in ('active', 'inactive', 'superseded')),
  change_reason             text,
  created_by                uuid references user_profiles(id),
  created_at                timestamptz not null default now(),
  superseded_at             timestamptz,
  unique (notice_group_id, version),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index advisory_notices_current on advisory_notices (notice_group_id) where status <> 'superseded';
create index advisory_notices_country_idx on advisory_notices (destination_country_id) where status = 'active';

create table advisory_notice_items (
  id              uuid primary key default gen_random_uuid(),
  notice_id       uuid not null references advisory_notices(id),
  record_kind     text not null default 'plus_two' check (record_kind in ('class_10', 'plus_two', 'bachelor', 'mbbs')),
  subject_key     text not null check (subject_key in ('overall', 'physics', 'chemistry', 'biology', 'mathematics', 'english')),
  subject_name    text not null check (length(btrim(subject_name)) between 2 and 80),
  min_percentage  numeric(5,2) check (min_percentage is null or min_percentage between 0 and 100),
  min_marks       numeric(7,2) check (min_marks is null or min_marks >= 0),
  grading_system  text check (grading_system is null or grading_system in ('percentage', 'marks', 'cgpa_10', 'cgpa_4', 'letter_grade', 'other')),
  description     text,
  sort_order      int not null default 100,
  check (min_percentage is not null or min_marks is not null)
);
create index advisory_notice_items_idx on advisory_notice_items (notice_id, sort_order);

create table advisory_notice_events (
  id               bigint generated always as identity primary key,
  notice_group_id  uuid not null,
  notice_id        uuid not null references advisory_notices(id),
  version          int not null,
  action           text not null check (action in ('created', 'edited', 'activated', 'deactivated')),
  reason           text,
  previous         jsonb,
  current          jsonb,
  actor_id         uuid references user_profiles(id),
  occurred_at      timestamptz not null default now()
);
create index advisory_notice_events_idx on advisory_notice_events (notice_group_id, occurred_at desc);

create table advisory_acknowledgements (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id),
  notice_id        uuid not null references advisory_notices(id),
  acknowledged_by  uuid not null references user_profiles(id),
  acknowledged_at  timestamptz not null default now(),
  academic_status  text check (academic_status is null or academic_status in ('meets', 'below', 'missing', 'manual_review')),
  evaluation       jsonb not null default '[]',
  task_id          uuid references tasks(id)
);
create index advisory_ack_idx on advisory_acknowledgements (student_id, notice_id, acknowledged_at desc);

-- versions, items, history and acknowledgements are never changed in place
create or replace function app.guard_advisory() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'advisory_notices' and tg_op = 'UPDATE' and coalesce(current_setting('app.advisory_change', true), 'off') = 'on'
     and (to_jsonb(new) - 'status' - 'superseded_at' - 'change_reason') = (to_jsonb(old) - 'status' - 'superseded_at' - 'change_reason') then
    return new;
  end if;
  raise exception 'requirement notices are versioned: edit by creating a new version' using errcode = '42501';
end $$;
create trigger advisory_notices_guard before update or delete on advisory_notices for each row execute function app.guard_advisory();
create trigger advisory_items_guard before update or delete on advisory_notice_items for each row execute function app.guard_advisory();
create trigger advisory_events_immutable before update or delete on advisory_notice_events for each row execute function app.audit_immutable();
create trigger advisory_acks_immutable before update or delete on advisory_acknowledgements for each row execute function app.audit_immutable();
create trigger advisory_notices_audit after insert or update on advisory_notices for each row execute function app.audit_row('', '');

create or replace function app.advisory_snapshot(p_notice uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(n) - 'created_at' || jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(i) - 'id' - 'notice_id' order by i.sort_order)
                                                                             from advisory_notice_items i where i.notice_id = n.id), '[]'::jsonb))
    from advisory_notices n where n.id = p_notice
$$;

-- Create (p_group null) or edit (new version). p jsonb: category, display_type, priority, destination_country_id,
-- university_id, course_id, title, message, description, notes, requires_acknowledgement, effective_from, effective_to.
-- p_items: [{record_kind, subject_key, subject_name, min_percentage, min_marks, grading_system, description}]
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
  insert into advisory_notices (id, notice_group_id, version, category, display_type, priority, destination_country_id, university_id, course_id,
                                title, message, description, notes, requires_acknowledgement, effective_from, effective_to, status, change_reason, created_by)
  values (v_id, v_group, coalesce(v_cur.version, 0) + 1, coalesce(p ->> 'category', 'academic_marks'), coalesce(p ->> 'display_type', 'important_warning'),
          coalesce(p ->> 'priority', 'high'), (p ->> 'destination_country_id')::uuid, nullif(p ->> 'university_id', '')::uuid, nullif(p ->> 'course_id', '')::uuid,
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

create or replace function app.set_advisory_status(p_group uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur advisory_notices%rowtype;
begin
  if not exists (select 1 from app.orgs_with_perm('requirements.manage')) then
    raise exception 'permission denied: requirements.manage' using errcode = '42501';
  end if;
  select * into v_cur from advisory_notices where notice_group_id = p_group and status <> 'superseded' for update;
  if not found then raise exception 'requirement not found' using errcode = 'P0002'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give the reason' using errcode = '23514'; end if;
  perform set_config('app.advisory_change', 'on', true);
  update advisory_notices set status = case when p_active then 'active' else 'inactive' end where id = v_cur.id;
  perform set_config('app.advisory_change', 'off', true);
  insert into advisory_notice_events (notice_group_id, notice_id, version, action, reason, current, actor_id)
  values (p_group, v_cur.id, v_cur.version, case when p_active then 'activated' else 'deactivated' end, btrim(p_reason), app.advisory_snapshot(v_cur.id), app.current_user_id());
end $$;

-- Notices that apply to a student now, with the comparison against the student's academic records and the
-- acknowledgement of THIS version. Informational only: nothing here blocks.
create or replace function app.student_advisories(p_student uuid)
returns table (notice_id uuid, notice_group_id uuid, version int, category text, display_type text, priority text, title text, message text,
               description text, notes text, requires_acknowledgement boolean, country text, university text, course text,
               items jsonb, academic_status text, acknowledged_at timestamptz, acknowledged_by text, earlier_acknowledgement boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from students where id = p_student),
  n as (
    select a.* from advisory_notices a, s
     where a.status = 'active' and a.effective_from <= current_date and (a.effective_to is null or a.effective_to >= current_date)
       and a.destination_country_id = s.destination_country_id
       and (a.university_id is null or a.university_id = s.preferred_university_id)
       and (a.course_id is null or a.course_id = s.course_id)),
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

-- Staff acknowledge that they have SEEN the notice (not an eligibility decision). Records the version and a snapshot
-- of the comparison; when marks are below/missing/unclear a follow-up task for academic verification is created.
create or replace function app.acknowledge_advisory(p_student uuid, p_notice uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row record; v_id uuid := gen_random_uuid(); v_task uuid; v_org uuid; v_code text; v_staff uuid;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not (app.can_on_student(p_student, 'students.update') or app.can_on_student(p_student, 'documents.review')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_row from app.student_advisories(p_student) a where a.notice_id = p_notice;
  if not found then raise exception 'this notice does not apply to the student (or is no longer active)' using errcode = '23514'; end if;
  select originating_org_id, student_code into v_org, v_code from students where id = p_student;
  if v_row.academic_status in ('below', 'missing', 'manual_review') then
    select a.user_id into v_staff from student_assignments a where a.student_id = p_student and a.is_active and a.assignment_type = 'counsellor'
       and app.user_is_active_member(a.user_id, v_org) limit 1;
    v_task := gen_random_uuid();
    insert into tasks (id, org_id, student_id, title, description, task_type, assigned_to, priority, due_date, source_key)
    values (v_task, v_org, p_student, 'Academic verification – ' || v_code,
            v_row.title || ': ' || case v_row.academic_status when 'below' then 'some marks are below the configured requirement'
              when 'missing' then 'some marks are not recorded' else 'marks need a manual comparison' end
              || '. Verify the academic records before university selection (advisory, not a rejection).',
            'followup', coalesce(v_staff, app.current_user_id()), 'normal', current_date + 7, 'adv:' || p_student::text || ':' || p_notice::text)
    on conflict do nothing;
    if not found then v_task := null; end if;
  end if;
  insert into advisory_acknowledgements (id, student_id, notice_id, acknowledged_by, academic_status, evaluation, task_id)
  values (v_id, p_student, p_notice, app.current_user_id(), v_row.academic_status, v_row.items, v_task);
  perform app.add_event_internal(p_student, v_org, 'student', 'notice_acknowledged',
    'Notice acknowledged: ' || v_row.title || ' (version ' || v_row.version || ')'
      || case when v_row.academic_status is not null then ' – academic status: ' || replace(v_row.academic_status, '_', ' ') else '' end,
    'advisory_acknowledgements', v_id::text);
  return v_id;
end $$;

-- Convert the Phase 3 thresholds into notices (one per country / university / course) and switch them off
do $$
declare g record; v_id uuid; v_group uuid; k int;
begin
  for g in select destination_country_id, university_id, course_id, min(t.created_by::text)::uuid as creator
             from academic_thresholds t where is_active and destination_country_id is not null group by 1, 2, 3 loop
    v_id := gen_random_uuid(); v_group := gen_random_uuid(); k := 0;
    insert into advisory_notices (id, notice_group_id, category, display_type, priority, destination_country_id, university_id, course_id, title, message, notes, created_by)
    values (v_id, v_group, 'academic_marks', 'important_warning', 'high', g.destination_country_id, g.university_id, g.course_id,
            upper((select name from countries where id = g.destination_country_id)) || ' – IMPORTANT ACADEMIC REQUIREMENTS',
            'Please note that this destination has specific academic mark requirements. Verify the student''s academic records before proceeding with university selection and application.',
            'Converted from the earlier eligibility thresholds.', g.creator);
    insert into advisory_notice_items (notice_id, record_kind, subject_key, subject_name, min_percentage, grading_system, sort_order)
    select v_id, t.record_kind, t.subject_key, initcap(t.subject_key), t.min_percentage, t.grading_system,
           (row_number() over (order by array_position(array['chemistry','biology','physics','english','mathematics','overall'], t.subject_key))) * 10
      from academic_thresholds t
     where t.is_active and t.destination_country_id = g.destination_country_id
       and t.university_id is not distinct from g.university_id and t.course_id is not distinct from g.course_id;
    insert into advisory_notice_events (notice_group_id, notice_id, version, action, reason, current)
    values (v_group, v_id, 1, 'created', 'Converted from eligibility thresholds (advisory requirements, Nov 2026)', app.advisory_snapshot(v_id));
  end loop;
  update academic_thresholds set is_active = false, source_note = coalesce(source_note || ' ', '') || '[replaced by advisory notices in 0021]' where is_active;
end $$;

-- Stage academic checks: warn or nothing — never block
update stages set academic_check = 'warn' where academic_check = 'block';
alter table stages drop constraint stages_academic_check_check;
alter table stages add constraint stages_academic_check_check check (academic_check in ('none', 'warn'));
create or replace function app.set_academic_check(p_stage text, p_check text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('academic.rules.manage')) then
    raise exception 'permission denied: academic.rules.manage' using errcode = '42501';
  end if;
  if p_check not in ('none', 'warn') then raise exception 'academic checks are advisory: choose none or warn' using errcode = '23514'; end if;
  update stages set academic_check = p_check where key = p_stage and kind = 'normal';
  if not found then raise exception 'unknown stage' using errcode = '23514'; end if;
  perform app.audit('academic_check_changed', 'stages', p_stage, null, null, null, jsonb_build_object('stage', p_stage, 'check', p_check));
end $$;

-- Stage requirement issues: academic items come from advisory notices and are always warnings
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
  select 'academic', 'warn',
         case (select p from prof) when 'pg_medical' then 'MBBS degree details are not recorded' else 'Plus Two (higher secondary) details are not recorded' end
    from s, ac
   where not exists (select 1 from academic_records r where r.student_id = s.id
                       and r.kind = case (select p from prof) when 'pg_medical' then 'mbbs' else 'plus_two' end)
  union all
  select 'academic', 'warn',
         a.title || case when a.requires_acknowledgement and a.acknowledged_at is null then ' – notice not yet acknowledged' else '' end
           || case a.academic_status when 'below' then ' – some marks are below the configured requirement'
                                     when 'missing' then ' – some marks are not recorded'
                                     when 'manual_review' then ' – marks need a manual comparison' else '' end
           || ' (advisory)'
    from s, ac, app.student_advisories(s.id) a
   where (a.requires_acknowledgement and a.acknowledged_at is null) or a.academic_status in ('below', 'missing', 'manual_review')
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants (all writes through the functions above)
-- -----------------------------------------------------------------------------
alter table advisory_notices enable row level security;
alter table advisory_notice_items enable row level security;
alter table advisory_notice_events enable row level security;
alter table advisory_acknowledgements enable row level security;
create policy advisory_notices_select on advisory_notices for select to erp_app using (app.current_user_id() is not null);
create policy advisory_items_select on advisory_notice_items for select to erp_app using (app.current_user_id() is not null);
create policy advisory_events_select on advisory_notice_events for select to erp_app using (exists (select 1 from app.orgs_with_perm('requirements.manage')));
create policy advisory_acks_select on advisory_acknowledgements for select to erp_app using (app.can_read_student(student_id));
grant select on advisory_notices, advisory_notice_items, advisory_notice_events, advisory_acknowledgements to erp_app;
grant execute on function app.advisory_snapshot(uuid), app.save_advisory_notice(uuid, jsonb, jsonb, text), app.set_advisory_status(uuid, boolean, text),
  app.student_advisories(uuid), app.acknowledge_advisory(uuid, uuid) to erp_app;
