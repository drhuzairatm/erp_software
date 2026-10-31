-- =============================================================================
-- 0019 Phase 2: passport records & expiry monitoring, international phones,
--      contact change history, email verification.
--
-- * students.passport_* remain the summary of the CURRENT passport. Every
--   change creates a new row in student_passports; rows are never overwritten
--   (only marked superseded). Full details (holder name as printed, gender,
--   nationality, citizenship, issue date, place of issue) live on the version.
-- * Expiry tiers: valid (>12 months), warning (<=12), urgent (<=6),
--   critical (<=3), expired. Follow-up tasks are created automatically, once
--   per passport version and tier; managers get an escalation task from
--   "urgent". Admissions are NOT blocked globally: minimum-validity rules are
--   configured per destination/university/course and stage (warn or block).
-- * Three phone numbers, each with its own country (E.164 storage). Secondary
--   phone and email are required from a configurable stage (default:
--   University Application); drafts may stay incomplete.
-- * Email verification: entered → pending → verified / expired / failed.
--   "Verified" can only be set by the student opening the emailed link.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('passport.rules.manage', 'Administration', 'Configure passport validity rules and the stage from which full contact details are required', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, 'passport.rules.manage' from roles r where r.key = 'system_admin'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Student columns
-- -----------------------------------------------------------------------------
alter table students
  add column phone_country        text check (phone_country is null or phone_country ~ '^[A-Z]{2}$'),
  add column phone2               text check (phone2 is null or phone2 ~ '^\+?[0-9 ()-]{7,20}$'),
  add column phone2_country       text check (phone2_country is null or phone2_country ~ '^[A-Z]{2}$'),
  add column phone3               text check (phone3 is null or phone3 ~ '^\+?[0-9 ()-]{7,20}$'),
  add column phone3_country       text check (phone3_country is null or phone3_country ~ '^[A-Z]{2}$'),
  add column phone3_label         text check (phone3_label is null or length(phone3_label) <= 60),
  add column residence_country_id uuid references countries(id),
  add column email_status         text not null default 'entered' check (email_status in ('entered', 'pending', 'verified', 'expired', 'failed')),
  add column email_verified_at    timestamptz;

grant select (phone_country, phone2_country, phone3_country, phone3_label, residence_country_id, email_status, email_verified_at) on students to erp_app;
grant insert (phone_country, phone2, phone2_country, phone3, phone3_country, phone3_label, residence_country_id) on students to erp_app;
grant update (phone_country, phone2, phone2_country, phone3, phone3_country, phone3_label, residence_country_id) on students to erp_app;

-- Email status: reset when the address changes; only the verification functions may set it.
create or replace function app.students_email_status() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.email_verify', true), 'off') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.email_status := 'entered'; new.email_verified_at := null;
  -- (generated columns such as email_normalized are not yet computed in BEFORE triggers)
  elsif lower(btrim(coalesce(new.email, ''))) is distinct from lower(btrim(coalesce(old.email, ''))) then
    new.email_status := 'entered'; new.email_verified_at := null;
  elsif new.email_status is distinct from old.email_status or new.email_verified_at is distinct from old.email_verified_at then
    raise exception 'email verification status can only change through verification' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger students_email_status before insert or update on students
  for each row execute function app.students_email_status();

drop trigger students_audit on students;
create trigger students_audit after insert or update or delete on students
  for each row execute function app.audit_row('originating_org_id', 'id', 'phone_normalized', 'email_normalized', 'passport_normalized',
                                              '~phone', '~email', '~date_of_birth', '~passport_number', '~parent_phone', '~parent_email',
                                              '~phone2', '~phone3');

-- -----------------------------------------------------------------------------
-- Contact change history (old value, new value, country, author, time, verification)
-- -----------------------------------------------------------------------------
create table student_contact_changes (
  id                   bigint generated always as identity primary key,
  student_id           uuid not null references students(id),
  field                text not null check (field in ('phone', 'phone2', 'phone3', 'email', 'parent_phone', 'parent_email')),
  old_value            text,
  new_value            text,
  country_code         text,
  verification_status  text not null,
  changed_by           uuid references user_profiles(id),
  changed_at           timestamptz not null default now()
);
create index student_contact_changes_idx on student_contact_changes (student_id, changed_at desc);
create trigger student_contact_changes_immutable before update or delete on student_contact_changes
  for each row execute function app.audit_immutable();

create or replace function app.students_contact_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := app.current_user_id();
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    if new.phone is not null or tg_op = 'UPDATE' then
      insert into student_contact_changes (student_id, field, old_value, new_value, country_code, verification_status, changed_by)
      values (new.id, 'phone', case when tg_op = 'UPDATE' then old.phone end, new.phone, new.phone_country, 'not_verified', v_me);
    end if;
  end if;
  if tg_op = 'INSERT' or new.phone2 is distinct from old.phone2 then
    if new.phone2 is not null or tg_op = 'UPDATE' then
      insert into student_contact_changes (student_id, field, old_value, new_value, country_code, verification_status, changed_by)
      values (new.id, 'phone2', case when tg_op = 'UPDATE' then old.phone2 end, new.phone2, new.phone2_country, 'not_verified', v_me);
    end if;
  end if;
  if tg_op = 'INSERT' or new.phone3 is distinct from old.phone3 then
    if new.phone3 is not null or tg_op = 'UPDATE' then
      insert into student_contact_changes (student_id, field, old_value, new_value, country_code, verification_status, changed_by)
      values (new.id, 'phone3', case when tg_op = 'UPDATE' then old.phone3 end, new.phone3, new.phone3_country, 'not_verified', v_me);
    end if;
  end if;
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    if new.email is not null or tg_op = 'UPDATE' then
      insert into student_contact_changes (student_id, field, old_value, new_value, verification_status, changed_by)
      values (new.id, 'email', case when tg_op = 'UPDATE' then old.email end, new.email, new.email_status, v_me);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.parent_phone is distinct from old.parent_phone then
    insert into student_contact_changes (student_id, field, old_value, new_value, verification_status, changed_by)
    values (new.id, 'parent_phone', old.parent_phone, new.parent_phone, 'not_verified', v_me);
  end if;
  if tg_op = 'UPDATE' and new.parent_email is distinct from old.parent_email then
    insert into student_contact_changes (student_id, field, old_value, new_value, verification_status, changed_by)
    values (new.id, 'parent_email', old.parent_email, new.parent_email, 'not_verified', v_me);
  end if;
  return null;
end $$;
create trigger students_contact_history after insert or update of phone, phone2, phone3, email, parent_phone, parent_email on students
  for each row execute function app.students_contact_history();

-- -----------------------------------------------------------------------------
-- Passports
-- -----------------------------------------------------------------------------
create table student_passports (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid not null references students(id),
  version                 int not null,
  kind                    text not null check (kind in ('initial', 'renewal', 'correction', 'edit')),
  passport_number         text check (passport_number is null or passport_number ~ '^[A-Z0-9]{5,15}$'),
  holder_name             text check (holder_name is null or length(btrim(holder_name)) between 2 and 200),
  date_of_birth           date,
  gender                  text check (gender is null or gender in ('female', 'male', 'other', 'unspecified')),
  nationality_country_id  uuid references countries(id),
  citizenship_country_id  uuid references countries(id),
  issuing_country_id      uuid references countries(id),
  issue_date              date,
  expiry_date             date,
  place_of_issue          text check (place_of_issue is null or length(place_of_issue) <= 120),
  document_file_id        uuid references document_files(id),
  notes                   text check (notes is null or length(notes) <= 2000),
  is_current              boolean not null default true,
  created_by              uuid references user_profiles(id),
  created_at              timestamptz not null default now(),
  superseded_at           timestamptz,
  unique (student_id, version),
  check (issue_date is null or expiry_date is null or issue_date < expiry_date)
);
create unique index student_passports_current on student_passports (student_id) where is_current;

create or replace function app.guard_passport_versions() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'passport records cannot be deleted' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.passport_sync', true), 'off') <> 'on'
     or not (old.is_current and not new.is_current)
     or (to_jsonb(new) - 'is_current' - 'superseded_at') <> (to_jsonb(old) - 'is_current' - 'superseded_at') then
    raise exception 'passport records are never overwritten; record a new version' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger student_passports_guard before update or delete on student_passports
  for each row execute function app.guard_passport_versions();
create trigger student_passports_audit after insert or update on student_passports
  for each row execute function app.audit_row('', 'student_id', '~passport_number', '~holder_name', '~date_of_birth', '~place_of_issue');

-- Follow-up history: remarks, contact attempts, renewal commitments (expected dates), renewed passport received
create table passport_followups (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id),
  passport_id    uuid references student_passports(id),
  kind           text not null check (kind in ('remark', 'contact', 'commitment', 'received')),
  note           text not null check (length(btrim(note)) between 1 and 2000),
  expected_date  date,
  created_by     uuid references user_profiles(id) default app.current_user_id(),
  created_at     timestamptz not null default now(),
  check (kind <> 'commitment' or expected_date is not null)
);
create index passport_followups_idx on passport_followups (student_id, created_at desc);
create trigger passport_followups_immutable before update or delete on passport_followups
  for each row execute function app.audit_immutable();

-- Expiry tier (most severe applicable)
create or replace function app.passport_tier(p_expiry date) returns text
language sql stable as $$
  select case
    when p_expiry is null then null
    when p_expiry < current_date then 'expired'
    when p_expiry <= current_date + interval '3 months' then 'critical'
    when p_expiry <= current_date + interval '6 months' then 'urgent'
    when p_expiry <= current_date + interval '12 months' then 'warning'
    else 'valid' end
$$;

-- Automatic follow-up tasks
alter table tasks alter column created_by drop not null;
alter table tasks add column source_key text;
create unique index tasks_source_key on tasks (source_key) where source_key is not null;
alter table tasks drop constraint tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check check (task_type in ('general', 'followup', 'documentation', 'attestation', 'apostille',
  'translation', 'university_application', 'visa', 'finance', 'travel', 'passport'));
grant select (source_key) on tasks to erp_app;

create or replace function app.passport_close_tasks(p_passport uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update tasks set status = p_status
   where source_key like 'passport:' || p_passport::text || ':%' and status not in ('completed', 'cancelled');
end $$;

create or replace function app.passport_monitor(p_student uuid default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; v_staff uuid; v_mgr uuid; v_key text; v_n int := 0;
  v_label text; v_prio text; v_due int;
begin
  for r in
    select s.id, s.originating_org_id as org, s.student_code, p.id as pid, p.expiry_date, app.passport_tier(p.expiry_date) as tier
      from students s join student_passports p on p.student_id = s.id and p.is_current
     where s.status in ('active', 'on_hold') and s.archived_at is null and s.merged_into_id is null
       and (p_student is null or s.id = p_student)
       and app.passport_tier(p.expiry_date) in ('warning', 'urgent', 'critical', 'expired')
  loop
    v_key := 'passport:' || r.pid::text || ':' || r.tier;
    continue when exists (select 1 from tasks where source_key = v_key);
    -- a more severe tier replaces open tasks of the milder tier
    update tasks set status = 'cancelled' where source_key like 'passport:' || r.pid::text || ':%' and status not in ('completed', 'cancelled');
    select a.user_id into v_staff from student_assignments a
     where a.student_id = r.id and a.is_active and a.assignment_type in ('counsellor', 'documentation')
       and app.user_is_active_member(a.user_id, r.org)
     order by (a.assignment_type = 'counsellor') desc limit 1;
    v_label := case r.tier when 'warning' then 'Passport expiry warning (12 months or less)' when 'urgent' then 'Urgent passport renewal required (6 months or less)'
                           when 'critical' then 'CRITICAL: passport expires within 3 months' else 'Passport EXPIRED' end;
    v_prio := case r.tier when 'warning' then 'normal' when 'urgent' then 'high' else 'urgent' end;
    v_due := case r.tier when 'warning' then 30 when 'urgent' then 14 else 3 end;
    insert into tasks (org_id, student_id, title, description, task_type, assigned_to, priority, due_date, source_key)
    values (r.org, r.id, v_label || ' – ' || r.student_code,
            'Passport expiry: ' || to_char(r.expiry_date, 'DD Mon YYYY') || '. Contact the student about renewal and record the outcome on the Passport tab.',
            'passport', v_staff, v_prio, current_date + v_due, v_key);
    v_n := v_n + 1;
    if r.tier in ('urgent', 'critical', 'expired') then
      select m.user_id into v_mgr from organization_memberships m join roles ro on ro.id = m.role_id join user_profiles u on u.id = m.user_id
       where m.org_id = r.org and m.is_active and u.is_active and ro.key in ('manager', 'md')
       order by (ro.key = 'manager') desc, u.full_name limit 1;
      insert into tasks (org_id, student_id, title, description, task_type, assigned_to, priority, due_date, source_key)
      values (r.org, r.id, 'Escalation: ' || v_label || ' – ' || r.student_code,
              'Escalated to manager. Passport expiry: ' || to_char(r.expiry_date, 'DD Mon YYYY') || '.', 'passport', v_mgr, v_prio, current_date + v_due,
              v_key || ':manager');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- Every change of the passport summary on students becomes a new passport version.
create or replace function app.students_passport_version() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev student_passports%rowtype; v_same boolean;
begin
  if coalesce(current_setting('app.passport_sync', true), 'off') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    if new.passport_number is null and new.passport_expiry is null and new.passport_country_id is null then return null; end if;
  elsif new.passport_number is not distinct from old.passport_number and new.passport_expiry is not distinct from old.passport_expiry
        and new.passport_country_id is not distinct from old.passport_country_id then
    return null;
  end if;
  select * into v_prev from student_passports where student_id = new.id and is_current;
  v_same := v_prev.id is not null and v_prev.passport_number is not distinct from new.passport_number;
  perform set_config('app.passport_sync', 'on', true);
  if v_prev.id is not null then
    update student_passports set is_current = false, superseded_at = now() where id = v_prev.id;
    perform app.passport_close_tasks(v_prev.id, 'cancelled');
  end if;
  insert into student_passports (student_id, version, kind, passport_number, holder_name, date_of_birth, gender, nationality_country_id,
                                 citizenship_country_id, issuing_country_id, issue_date, expiry_date, place_of_issue, created_by)
  values (new.id, coalesce(v_prev.version, 0) + 1, case when v_prev.id is null then 'initial' else 'edit' end, new.passport_number,
          v_prev.holder_name, v_prev.date_of_birth, v_prev.gender, v_prev.nationality_country_id, v_prev.citizenship_country_id,
          new.passport_country_id, case when v_same then v_prev.issue_date end, new.passport_expiry,
          case when v_same then v_prev.place_of_issue end, app.current_user_id());
  perform set_config('app.passport_sync', 'off', true);
  perform app.passport_monitor(new.id);
  return null;
end $$;
create trigger students_zz_passport_version after insert or update of passport_number, passport_expiry, passport_country_id on students
  for each row execute function app.students_passport_version();

-- Record full passport details (initial, renewal or correction) — never overwrites.
create or replace function app.record_passport(p_student uuid, p_kind text, p_number text, p_holder text, p_dob date, p_gender text,
  p_nationality uuid, p_citizenship uuid, p_issuing uuid, p_issue date, p_expiry date, p_place text, p_notes text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev student_passports%rowtype; v_id uuid := gen_random_uuid(); v_file uuid; v_org uuid; v_num text := upper(regexp_replace(coalesce(p_number, ''), '\s', '', 'g'));
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'students.passport.view') then raise exception 'permission denied: students.passport.view' using errcode = '42501'; end if;
  if p_kind not in ('initial', 'renewal', 'correction') then raise exception 'invalid kind' using errcode = '23514'; end if;
  if v_num = '' then raise exception 'enter the passport number' using errcode = '23514'; end if;
  if p_expiry is null then raise exception 'enter the passport expiry date' using errcode = '23514'; end if;
  select * into v_prev from student_passports where student_id = p_student and is_current for update;
  if p_kind = 'renewal' and v_prev.id is not null and v_prev.passport_number = v_num then
    raise exception 'a renewed passport has a new passport number' using errcode = '23514';
  end if;
  if p_kind = 'correction' and coalesce(btrim(p_notes), '') = '' then raise exception 'explain what is being corrected' using errcode = '23514'; end if;
  select d.current_file_id into v_file from student_documents d join document_types t on t.id = d.document_type_id
   where d.student_id = p_student and t.key = 'passport' and d.current_file_id is not null order by d.created_at limit 1;
  perform set_config('app.passport_sync', 'on', true);
  if v_prev.id is not null then
    update student_passports set is_current = false, superseded_at = now() where id = v_prev.id;
    perform app.passport_close_tasks(v_prev.id, case when p_kind = 'renewal' then 'completed' else 'cancelled' end);
  end if;
  insert into student_passports (id, student_id, version, kind, passport_number, holder_name, date_of_birth, gender, nationality_country_id,
                                 citizenship_country_id, issuing_country_id, issue_date, expiry_date, place_of_issue, document_file_id, notes, created_by)
  values (v_id, p_student, coalesce(v_prev.version, 0) + 1, p_kind, v_num, nullif(btrim(p_holder), ''), p_dob, p_gender, p_nationality,
          p_citizenship, p_issuing, p_issue, p_expiry, nullif(btrim(p_place), ''), v_file, nullif(btrim(p_notes), ''), app.current_user_id());
  update students set passport_number = v_num, passport_expiry = p_expiry, passport_country_id = p_issuing where id = p_student;
  perform set_config('app.passport_sync', 'off', true);
  if p_kind = 'renewal' then
    insert into passport_followups (student_id, passport_id, kind, note) values (p_student, v_id, 'received', 'Renewed passport details recorded (version ' || coalesce(v_prev.version, 0) + 1 || ')');
  end if;
  select originating_org_id into v_org from students where id = p_student;
  perform app.add_event_internal(p_student, v_org, 'student', 'passport_' || p_kind,
    'Passport ' || case p_kind when 'renewal' then 'renewed' when 'correction' then 'details corrected' else 'details recorded' end
      || ' (version ' || coalesce(v_prev.version, 0) + 1 || ', expires ' || to_char(p_expiry, 'DD Mon YYYY') || ')', 'student_passports', v_id::text);
  perform app.passport_monitor(p_student);
  return v_id;
end $$;

-- Backfill: existing passport data becomes version 1 (nothing invented: holder details stay empty)
insert into student_passports (student_id, version, kind, passport_number, issuing_country_id, expiry_date, created_by, created_at)
select id, 1, 'initial', passport_number, passport_country_id, passport_expiry, created_by, created_at from students
 where passport_number is not null or passport_expiry is not null or passport_country_id is not null;

-- -----------------------------------------------------------------------------
-- Stage requirements: minimum passport validity, complete contact details
-- -----------------------------------------------------------------------------
alter table stages add column requires_complete_contact boolean not null default false;
update stages set requires_complete_contact = true where key = 'university_application';

create table passport_validity_rules (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) between 3 and 160),
  destination_country_id  uuid references countries(id),
  university_id           uuid references universities(id),
  course_id               uuid references courses(id),
  stage_key               text not null references stages(key),
  min_months              int not null check (min_months between 0 and 120),
  enforcement             text not null default 'warn' check (enforcement in ('warn', 'block')),
  is_active               boolean not null default true,
  notes                   text,
  created_by              uuid references user_profiles(id) default app.current_user_id(),
  created_at              timestamptz not null default now()
);
create trigger passport_validity_rules_audit after insert or update or delete on passport_validity_rules
  for each row execute function app.audit_row('', '');

-- Requirements that apply when a student moves (forward) to p_to_stage
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

-- Database enforcement of blocking requirements on forward moves
create or replace function app.students_stage_requirements() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_from int; v_to int; v_msg text;
begin
  if new.current_stage_key is not distinct from old.current_stage_key then return new; end if;
  select sort_order into v_from from stages where key = old.current_stage_key and kind = 'normal';
  select sort_order into v_to from stages where key = new.current_stage_key and kind = 'normal';
  if v_to is null or (v_from is not null and v_to <= v_from) then return new; end if;
  select string_agg(i.message, '; ') into v_msg from app.stage_requirement_issues(new.id, new.current_stage_key) i where i.enforcement = 'block';
  if v_msg is not null then raise exception '%', v_msg using errcode = '23514'; end if;
  return new;
end $$;
create trigger students_stage_requirements before update of current_stage_key on students
  for each row execute function app.students_stage_requirements();

create or replace function app.set_contact_required_stage(p_stage text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from app.orgs_with_perm('passport.rules.manage')) then
    raise exception 'permission denied: passport.rules.manage' using errcode = '42501';
  end if;
  if p_stage is not null and not exists (select 1 from stages where key = p_stage and kind = 'normal') then
    raise exception 'unknown stage' using errcode = '23514';
  end if;
  update stages set requires_complete_contact = (key = p_stage) where requires_complete_contact is distinct from (key = p_stage);
  perform app.audit('contact_required_stage', 'stages', p_stage, null, null, null, jsonb_build_object('stage', p_stage));
end $$;

-- -----------------------------------------------------------------------------
-- Email verification
-- -----------------------------------------------------------------------------
create table auth_private.email_verifications (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id),
  email_normalized  text not null,
  token_hash        text not null unique,
  requested_by      uuid references user_profiles(id),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '48 hours',
  used_at           timestamptz
);

create or replace function app.request_email_verification(p_student uuid, p_token_hash text, p_link text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s students%rowtype; v_tpl uuid;
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'students.contact.view') or not app.can_on_student(p_student, 'students.update') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_s from students where id = p_student for update;
  if v_s.email is null then raise exception 'the student has no email address' using errcode = '23514'; end if;
  if v_s.email_status = 'verified' then raise exception 'this email address is already verified' using errcode = '23514'; end if;
  if (select count(*) from auth_private.email_verifications where student_id = p_student and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'too many verification emails; try again later' using errcode = '23514';
  end if;
  select id into v_tpl from notification_templates
   where org_id = v_s.originating_org_id and name = 'Email verification' and channel = 'email' and is_active limit 1;
  if v_tpl is null then raise exception 'the "Email verification" email template is missing or inactive' using errcode = '23514'; end if;
  insert into auth_private.email_verifications (student_id, email_normalized, token_hash, requested_by)
  values (p_student, v_s.email_normalized, p_token_hash, app.current_user_id());
  insert into notification_messages (org_id, student_id, event_key, template_id, channel, recipient_type, to_address, params, status)
  values (v_s.originating_org_id, p_student, 'email_verification', v_tpl, 'email', 'student', v_s.email, jsonb_build_object('link', p_link), 'queued');
  perform set_config('app.email_verify', 'on', true);
  update students set email_status = 'pending', email_verified_at = null where id = p_student;
  perform set_config('app.email_verify', 'off', true);
  perform app.add_event_internal(p_student, v_s.originating_org_id, 'student', 'email_verification_sent', 'Email verification link sent', 'students', p_student::text);
end $$;

-- Called from the public verification page (no staff session).
create or replace function app.confirm_email_verification(p_token_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_v auth_private.email_verifications%rowtype; v_s students%rowtype;
begin
  select * into v_v from auth_private.email_verifications where token_hash = p_token_hash for update;
  if not found or v_v.used_at is not null then return 'invalid'; end if;
  select * into v_s from students where id = v_v.student_id for update;
  if v_s.email_normalized is distinct from v_v.email_normalized then return 'invalid'; end if;
  perform set_config('app.email_verify', 'on', true);
  if v_v.expires_at < now() then
    if v_s.email_status = 'pending' then update students set email_status = 'expired' where id = v_s.id; end if;
    perform set_config('app.email_verify', 'off', true);
    return 'expired';
  end if;
  update auth_private.email_verifications set used_at = now() where id = v_v.id;
  update students set email_status = 'verified', email_verified_at = now() where id = v_s.id;
  perform set_config('app.email_verify', 'off', true);
  insert into student_contact_changes (student_id, field, old_value, new_value, verification_status)
  values (v_s.id, 'email', v_s.email, v_s.email, 'verified');
  perform app.add_event_internal(v_s.id, v_s.originating_org_id, 'student', 'email_verified', 'Email address verified by the student', 'students', v_s.id::text);
  perform app.audit('email_verified', 'students', v_s.id::text, v_s.originating_org_id, v_s.id);
  return 'verified';
end $$;

-- Daily housekeeping: pending verifications past their expiry become "expired".
create or replace function app.expire_email_verifications() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  perform set_config('app.email_verify', 'on', true);
  update students s set email_status = 'expired'
   where s.email_status = 'pending'
     and not exists (select 1 from auth_private.email_verifications v where v.student_id = s.id and v.used_at is null and v.expires_at > now()
                       and v.email_normalized = s.email_normalized);
  get diagnostics v_n = row_count;
  perform set_config('app.email_verify', 'off', true);
  return v_n;
end $$;

-- Hide verification links (like sign-in codes) once handed to a provider; a failed send marks the email "failed".
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

-- Verification messages are visible only to staff with outbox permission (they contain a link)
drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (app.has_perm(org_id, 'notifications.view')
         or (event_key not in ('portal_login_code', 'email_verification') and student_id is not null and app.can_on_student(student_id, 'students.contact.view')));

-- -----------------------------------------------------------------------------
-- Student view: new contact fields (masked without contact permission) and passport status
-- (the status is shown to all staff who can see the student; the passport itself stays protected)
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
       app.passport_tier(s.passport_expiry) as passport_status
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table student_contact_changes enable row level security;
alter table student_passports enable row level security;
alter table passport_followups enable row level security;
alter table passport_validity_rules enable row level security;

create policy contact_changes_select on student_contact_changes for select to erp_app
  using (app.can_on_student(student_id, 'students.contact.view'));
create policy passports_select on student_passports for select to erp_app
  using (app.can_on_student(student_id, 'students.passport.view'));
create policy passport_followups_select on passport_followups for select to erp_app
  using (app.can_on_student(student_id, 'students.passport.view'));
create policy passport_followups_insert on passport_followups for insert to erp_app
  with check (app.can_on_student(student_id, 'students.passport.view') and created_by = app.current_user_id()
              and (passport_id is null or exists (select 1 from student_passports p where p.id = passport_id and p.student_id = passport_followups.student_id)));
create policy pv_rules_select on passport_validity_rules for select to erp_app using (app.current_user_id() is not null);
create policy pv_rules_write on passport_validity_rules for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('passport.rules.manage')))
  with check (exists (select 1 from app.orgs_with_perm('passport.rules.manage')));

grant select on student_contact_changes, student_passports to erp_app;
grant select, insert on passport_followups to erp_app;
grant select, insert, update, delete on passport_validity_rules to erp_app;
grant select (requires_complete_contact) on stages to erp_app;
grant execute on function
  app.passport_tier(date), app.passport_monitor(uuid), app.record_passport(uuid, text, text, text, date, text, uuid, uuid, uuid, date, date, text, text),
  app.stage_requirement_issues(uuid, text), app.set_contact_required_stage(text),
  app.request_email_verification(uuid, text, text), app.confirm_email_verification(text), app.expire_email_verifications()
to erp_app;
