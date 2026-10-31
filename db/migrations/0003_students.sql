-- =============================================================================
-- 0003 Students, assignments, notes, follow-ups, stage history, timeline,
--      duplicate detection and controlled merge.
--
-- Company access to a student is derived from `student_org_access`:
--   relation = 'originating'      the brand that brought the student in
--   relation = 'processing'       the team doing central processing
--   relation = 'secondary_brand'  another brand that also dealt with this
--                                 person (added by a controlled merge)
-- Sales/brand permissions (students.read.all) apply to originating and
-- secondary_brand relations; operational permissions (students.read.processing)
-- apply to the processing relation; students.read.assigned applies only to
-- students the user is actively assigned to.
-- =============================================================================

create sequence student_code_seq start 1001;

create table students (
  id                          uuid primary key default gen_random_uuid(),
  student_code                text not null unique,
  originating_org_id          uuid not null references organizations(id),
  processing_org_id           uuid references organizations(id),
  lead_source_id              uuid,
  full_name                   text not null check (length(btrim(full_name)) between 2 and 200),
  phone                       text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  phone_normalized            text generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored,
  email                       text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_normalized            text generated always as (nullif(lower(btrim(coalesce(email, ''))), '')) stored,
  preferred_language          text,
  date_of_birth               date check (date_of_birth is null or date_of_birth between '1940-01-01' and current_date),
  destination_country_id      uuid references countries(id),
  course_id                   uuid references courses(id),
  preferred_university_id     uuid references universities(id),
  highest_qualification       text,
  qualification_board         text,
  qualification_year          int check (qualification_year is null or qualification_year between 1970 and 2100),
  qualification_score         text,
  entrance_exam               text,
  entrance_score              text,
  academic_notes              text,
  registration_date           date,
  workflow_id                 uuid not null references workflow_definitions(id),
  current_stage_key           text not null default 'lead' references stages(key),
  stage_before_hold           text references stages(key),
  stage_changed_at            timestamptz not null default now(),
  status                      text not null default 'active'
                                check (status in ('active', 'on_hold', 'completed', 'cancelled', 'merged')),
  next_action                 text,
  next_action_due             date,
  contracting_entity_id       uuid references legal_entities(id),
  payment_recipient_entity_id uuid references legal_entities(id),
  university_application_ref  text,
  admission_letter_date       date,
  visa_appointment_date       date,
  visa_outcome                text not null default 'not_applied'
                                check (visa_outcome in ('not_applied', 'pending', 'approved', 'rejected')),
  visa_reference              text,
  merged_into_id              uuid references students(id),
  archived_at                 timestamptz,
  archived_by                 uuid references user_profiles(id),
  archive_reason              text,
  is_demo                     boolean not null default false,
  created_by                  uuid not null references user_profiles(id),
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references user_profiles(id),
  updated_at                  timestamptz not null default now(),
  foreign key (lead_source_id, originating_org_id) references lead_sources(id, org_id),
  check (phone is not null or email is not null),
  check ((status = 'merged') = (merged_into_id is not null))
);
create index students_origin_idx on students (originating_org_id, status);
create index students_processing_idx on students (processing_org_id) where processing_org_id is not null;
create index students_phone_idx on students (phone_normalized);
create index students_email_idx on students (email_normalized);
create index students_name_idx on students (lower(full_name) text_pattern_ops);
create index students_stage_idx on students (current_stage_key);
create index students_country_course_idx on students (destination_country_id, course_id);

create or replace function app.students_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prefix text;
begin
  -- Student ID is ALWAYS generated here, never accepted from the client.
  select student_code_prefix into v_prefix from organizations where id = new.originating_org_id;
  if v_prefix is null then raise exception 'unknown organization'; end if;
  new.student_code := v_prefix || '-' || to_char(now(), 'YY') || '-' || lpad(nextval('student_code_seq')::text, 6, '0');
  new.created_by := coalesce(app.current_user_id(), new.created_by);
  new.updated_by := new.created_by;
  new.current_stage_key := coalesce(new.current_stage_key, 'lead');
  new.status := 'active';
  new.merged_into_id := null;
  if new.workflow_id is null then
    new.workflow_id := app.pick_workflow(new.destination_country_id, new.course_id);
  end if;
  return new;
end $$;
create trigger students_before_insert before insert on students
  for each row execute function app.students_before_insert();
create trigger students_touch before update on students
  for each row execute function app.touch_updated_by();

-- -----------------------------------------------------------------------------
-- Company access relation
-- -----------------------------------------------------------------------------
create table student_org_access (
  student_id  uuid not null references students(id),
  org_id      uuid not null references organizations(id),
  relation    text not null check (relation in ('originating', 'processing', 'secondary_brand')),
  created_at  timestamptz not null default now(),
  primary key (student_id, org_id, relation)
);
create index student_org_access_org_idx on student_org_access (org_id, relation);

create or replace function app.sync_student_org_access() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.originating_org_id is distinct from old.originating_org_id then
      delete from student_org_access where student_id = new.id and relation = 'originating';
    end if;
    if new.processing_org_id is distinct from old.processing_org_id then
      delete from student_org_access where student_id = new.id and relation = 'processing';
    end if;
  end if;
  insert into student_org_access (student_id, org_id, relation)
  values (new.id, new.originating_org_id, 'originating') on conflict do nothing;
  if new.processing_org_id is not null then
    insert into student_org_access (student_id, org_id, relation)
    values (new.id, new.processing_org_id, 'processing') on conflict do nothing;
  end if;
  return null;
end $$;
create trigger students_sync_access after insert or update of originating_org_id, processing_org_id on students
  for each row execute function app.sync_student_org_access();

-- -----------------------------------------------------------------------------
-- Assignments
-- -----------------------------------------------------------------------------
create table student_assignments (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id),
  user_id          uuid not null references user_profiles(id),
  org_id           uuid not null references organizations(id),
  assignment_type  text not null check (assignment_type in ('counsellor', 'documentation', 'visa', 'finance', 'other')),
  is_active        boolean not null default true,
  assigned_by      uuid not null references user_profiles(id),
  assigned_at      timestamptz not null default now(),
  ended_at         timestamptz,
  ended_by         uuid references user_profiles(id)
);
create unique index student_assignments_one_active on student_assignments (student_id, assignment_type)
  where is_active and assignment_type <> 'other';
create index student_assignments_user_idx on student_assignments (user_id) where is_active;

-- -----------------------------------------------------------------------------
-- Core access checks
-- -----------------------------------------------------------------------------
create or replace function app.is_assigned(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from student_assignments
                  where student_id = p_student and user_id = app.current_user_id() and is_active)
$$;

create or replace function app.can_read_student(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from student_org_access a
     where a.student_id = p_student
       and (   (a.relation in ('originating', 'secondary_brand') and app.has_perm(a.org_id, 'students.read.all'))
            or (a.relation = 'processing' and app.has_perm(a.org_id, 'students.read.processing'))
            or (app.has_perm(a.org_id, 'students.read.assigned') and app.is_assigned(p_student)))
  )
$$;

-- Can the current user perform `p_perm` on this student through any company
-- that has access to the student? (Requires read access too.)
create or replace function app.can_on_student(p_student uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.can_read_student(p_student) and exists (
    select 1 from student_org_access a
     where a.student_id = p_student and app.has_perm(a.org_id, p_perm))
$$;

-- Is p_org one of the companies with access to the student?
create or replace function app.student_has_org(p_student uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from student_org_access where student_id = p_student and org_id = p_org)
$$;

create or replace function app.validate_assignment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not app.student_has_org(new.student_id, new.org_id) then
    raise exception 'assignment company does not have access to this student' using errcode = '23514';
  end if;
  if new.is_active and not app.user_is_active_member(new.user_id, new.org_id) then
    raise exception 'assignee is not an active member of the selected company' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger student_assignments_validate before insert or update on student_assignments
  for each row execute function app.validate_assignment();

-- -----------------------------------------------------------------------------
-- Notes, follow-ups, stage history, timeline events, merges
-- -----------------------------------------------------------------------------
create table student_notes (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id),
  org_id      uuid not null references organizations(id),
  visibility  text not null default 'internal' check (visibility in ('internal', 'restricted')),
  body        text not null check (length(btrim(body)) between 1 and 5000),
  created_by  uuid not null default app.current_user_id() references user_profiles(id),
  created_at  timestamptz not null default now()
);
create index student_notes_student_idx on student_notes (student_id, created_at desc);

create table followups (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references students(id),
  org_id              uuid not null references organizations(id),
  channel             text not null check (channel in ('call', 'whatsapp', 'email', 'in_person', 'video', 'other')),
  summary             text not null check (length(btrim(summary)) between 1 and 2000),
  occurred_at         timestamptz not null default now(),
  next_followup_date  date,
  created_by          uuid not null default app.current_user_id() references user_profiles(id),
  created_at          timestamptz not null default now()
);
create index followups_student_idx on followups (student_id, occurred_at desc);

create table student_stage_history (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id),
  from_stage       text references stages(key),
  to_stage         text not null references stages(key),
  changed_by       uuid not null references user_profiles(id),
  changed_at       timestamptz not null default now(),
  reason           text,
  next_action      text,
  next_action_due  date,
  warnings         jsonb not null default '[]'::jsonb
);
create index stage_history_student_idx on student_stage_history (student_id, changed_at desc);

-- Human-readable timeline. Written by the application/functions alongside the
-- audit log; contains summaries only, never document contents or secrets.
create table student_events (
  id               bigint generated always as identity primary key,
  student_id       uuid not null references students(id),
  org_id           uuid references organizations(id),
  category         text not null check (category in ('student', 'stage', 'document', 'task', 'note', 'followup', 'payment', 'assignment')),
  event_type       text not null,
  summary          text not null,
  actor_user_id    uuid references user_profiles(id) default app.current_user_id(),
  occurred_at      timestamptz not null default now(),
  ref_entity_type  text,
  ref_id           text
);
create index student_events_student_idx on student_events (student_id, occurred_at desc);

create table student_merges (
  id                    uuid primary key default gen_random_uuid(),
  surviving_student_id  uuid not null references students(id),
  merged_student_id     uuid not null unique references students(id),
  merged_by             uuid not null references user_profiles(id),
  merged_at             timestamptz not null default now(),
  reason                text not null
);

-- Internal (not granted to erp_app): used by triggers and checked functions.
create or replace function app.add_event_internal(p_student uuid, p_org uuid, p_category text, p_type text,
                                         p_summary text, p_ref_type text default null, p_ref_id text default null)
returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into student_events (student_id, org_id, category, event_type, summary, actor_user_id, ref_entity_type, ref_id)
  values (p_student, p_org, p_category, p_type, left(p_summary, 500), app.current_user_id(), p_ref_type, p_ref_id)
$$;

create trigger students_audit after insert or update or delete on students
  for each row execute function app.audit_row('originating_org_id', 'id', 'phone_normalized', 'email_normalized');
create trigger student_assignments_audit after insert or update or delete on student_assignments
  for each row execute function app.audit_row('org_id', 'student_id');
create trigger student_notes_audit after insert or update or delete on student_notes
  for each row execute function app.audit_row('org_id', 'student_id', 'body');

-- -----------------------------------------------------------------------------
-- Stage transitions (the only way to change a student's stage/status)
-- -----------------------------------------------------------------------------
create or replace function app.change_student_stage(
  p_student uuid, p_to_stage text, p_reason text, p_next_action text, p_next_action_due date,
  p_warnings jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s students%rowtype;
  v_stage stages%rowtype;
  v_from stages%rowtype;
  v_hist uuid;
  v_status text;
begin
  if app.current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_s from students where id = p_student for update;
  if not found or not app.can_read_student(p_student) then
    raise exception 'student not found' using errcode = 'P0002';
  end if;
  if v_s.status = 'merged' or v_s.archived_at is not null then
    raise exception 'this record is merged or archived and cannot change stage' using errcode = '23514';
  end if;
  select * into v_stage from stages where key = p_to_stage;
  if not found then raise exception 'unknown stage' using errcode = '23514'; end if;
  if p_to_stage = v_s.current_stage_key then
    raise exception 'student is already in this stage' using errcode = '23514';
  end if;
  if not app.can_on_student(p_student, 'students.stage.change') then
    raise exception 'permission denied: students.stage.change' using errcode = '42501';
  end if;
  if not app.can_on_student(p_student, v_stage.permission_key) then
    raise exception 'permission denied: %', v_stage.permission_key using errcode = '42501';
  end if;
  -- Leaving On Hold / Cancelled also requires the hold permission.
  select * into v_from from stages where key = v_s.current_stage_key;
  if v_from.kind in ('hold', 'cancelled') and not app.can_on_student(p_student, 'stage.hold') then
    raise exception 'permission denied: stage.hold' using errcode = '42501';
  end if;
  if v_stage.kind = 'normal' or v_stage.kind = 'completed' then
    if not exists (select 1 from workflow_stages where workflow_id = v_s.workflow_id and stage_key = p_to_stage) then
      raise exception 'stage "%" is not part of this student''s workflow', v_stage.name using errcode = '23514';
    end if;
  end if;
  if v_stage.kind in ('hold', 'cancelled') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for % ', v_stage.name using errcode = '23514';
  end if;

  v_status := case v_stage.kind when 'hold' then 'on_hold' when 'cancelled' then 'cancelled'
                                 when 'completed' then 'completed' else 'active' end;

  perform set_config('app.stage_change', 'on', true);
  update students set
    current_stage_key = p_to_stage,
    stage_before_hold = case when v_stage.kind = 'hold' then v_s.current_stage_key else null end,
    stage_changed_at = now(),
    status = v_status,
    next_action = coalesce(nullif(btrim(p_next_action), ''), next_action),
    next_action_due = coalesce(p_next_action_due, next_action_due)
  where id = p_student;
  perform set_config('app.stage_change', 'off', true);

  insert into student_stage_history (student_id, from_stage, to_stage, changed_by, reason, next_action, next_action_due, warnings)
  values (p_student, v_s.current_stage_key, p_to_stage, app.current_user_id(), nullif(btrim(p_reason), ''),
          nullif(btrim(p_next_action), ''), p_next_action_due, coalesce(p_warnings, '[]'::jsonb))
  returning id into v_hist;

  perform app.add_event_internal(p_student, v_s.originating_org_id, 'stage', 'stage_changed',
                        v_from.name || ' → ' || v_stage.name ||
                        case when coalesce(btrim(p_reason), '') <> '' then ' (' || btrim(p_reason) || ')' else '' end,
                        'student_stage_history', v_hist::text);
  return v_hist;
end $$;

-- Guard: stage/status columns can only change through change_student_stage()
-- or the merge/archive functions (which set the same flag).
create or replace function app.guard_student_stage() returns trigger
language plpgsql as $$
begin
  if (new.current_stage_key is distinct from old.current_stage_key
      or new.status is distinct from old.status
      or new.stage_before_hold is distinct from old.stage_before_hold
      or new.merged_into_id is distinct from old.merged_into_id
      or new.student_code is distinct from old.student_code)
     and coalesce(current_setting('app.stage_change', true), 'off') <> 'on' then
    raise exception 'stage, status and Student ID can only be changed through the workflow' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger students_guard_stage before update on students
  for each row execute function app.guard_student_stage();

-- -----------------------------------------------------------------------------
-- Duplicate detection (safe across companies)
-- Returns matches by phone/email. Details are returned ONLY for records the
-- caller is allowed to read; otherwise only the company name is disclosed, so
-- staff know to ask a manager without seeing the other brand's data.
-- -----------------------------------------------------------------------------
create or replace function app.find_duplicate_candidates(p_phone text, p_email text, p_exclude uuid default null)
returns table (student_id uuid, student_code text, full_name text, org_name text, matched_on text, visible boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_phone text := nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
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
             case when v_email is not null and s.email_normalized = v_email then 'email' end),
           app.can_read_student(s.id)
      from students s join organizations o on o.id = s.originating_org_id
     where s.status <> 'merged'
       and (p_exclude is null or s.id <> p_exclude)
       and ((v_phone is not null and s.phone_normalized = v_phone)
         or (v_email is not null and s.email_normalized = v_email))
     limit 10;
end $$;

-- -----------------------------------------------------------------------------
-- Controlled merge. Requires students.merge in the originating company of BOTH
-- records. History is preserved: the merged record is kept (status 'merged')
-- with a pointer to the surviving record, and its child records move over.
-- -----------------------------------------------------------------------------
create or replace function app.merge_students(p_surviving uuid, p_merged uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_keep students%rowtype;
  v_drop students%rowtype;
begin
  if p_surviving = p_merged then raise exception 'cannot merge a record into itself' using errcode = '23514'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  select * into v_keep from students where id = p_surviving for update;
  select * into v_drop from students where id = p_merged for update;
  if v_keep.id is null or v_drop.id is null
     or not app.can_read_student(p_surviving) or not app.can_read_student(p_merged) then
    raise exception 'student not found' using errcode = 'P0002';
  end if;
  if not app.has_perm(v_keep.originating_org_id, 'students.merge')
     or not app.has_perm(v_drop.originating_org_id, 'students.merge') then
    raise exception 'permission denied: students.merge is required in both companies' using errcode = '42501';
  end if;
  if v_keep.status = 'merged' or v_drop.status = 'merged' then
    raise exception 'one of the records is already merged' using errcode = '23514';
  end if;

  -- Re-point child records (payment entries are otherwise immutable; this flag
  -- allows ONLY their student_id to change, see payments guard trigger)
  perform set_config('app.merging', 'on', true);
  update student_notes set student_id = p_surviving where student_id = p_merged;
  update followups set student_id = p_surviving where student_id = p_merged;
  update tasks set student_id = p_surviving where student_id = p_merged;
  update payment_entries set student_id = p_surviving where student_id = p_merged;
  -- Documents: keep both if the same type exists, labelling the moved one.
  update student_documents d set student_id = p_surviving,
         label = case when exists (select 1 from student_documents k where k.student_id = p_surviving
                                     and k.document_type_id = d.document_type_id and k.label = d.label)
                      then left(trim(d.label || ' (from ' || v_drop.student_code || ')'), 120) else d.label end
   where d.student_id = p_merged;
  -- Assignments: end the merged record's assignments (surviving keeps its own)
  update student_assignments set is_active = false, ended_at = now(), ended_by = app.current_user_id()
   where student_id = p_merged and is_active;
  perform set_config('app.merging', 'off', true);

  -- Keep the other brand's access/attribution
  insert into student_org_access (student_id, org_id, relation)
  select p_surviving, a.org_id, case when a.relation = 'processing' then 'processing' else 'secondary_brand' end
    from student_org_access a
   where a.student_id = p_merged
     and not exists (select 1 from student_org_access b where b.student_id = p_surviving and b.org_id = a.org_id
                       and (b.relation = a.relation or (a.relation <> 'processing' and b.relation in ('originating','secondary_brand'))))
  on conflict do nothing;

  perform set_config('app.stage_change', 'on', true);
  update students set status = 'merged', merged_into_id = p_surviving where id = p_merged;
  perform set_config('app.stage_change', 'off', true);

  insert into student_merges (surviving_student_id, merged_student_id, merged_by, reason)
  values (p_surviving, p_merged, app.current_user_id(), btrim(p_reason));

  perform app.add_event_internal(p_surviving, v_keep.originating_org_id, 'student', 'merged',
                        'Duplicate record ' || v_drop.student_code || ' merged into this record: ' || btrim(p_reason));
  perform app.add_event_internal(p_merged, v_drop.originating_org_id, 'student', 'merged',
                        'Merged into ' || v_keep.student_code || ': ' || btrim(p_reason));
  perform app.audit('merge', 'students', p_merged::text, v_drop.originating_org_id, p_merged, null,
                    jsonb_build_object('merged_into', p_surviving, 'reason', btrim(p_reason)));
end $$;

-- Archive (soft delete) with reason; reversible by managers.
create or replace function app.set_student_archived(p_student uuid, p_archived boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s students%rowtype;
begin
  select * into v_s from students where id = p_student for update;
  if not found or not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.has_perm(v_s.originating_org_id, 'students.archive') then
    raise exception 'permission denied: students.archive' using errcode = '42501';
  end if;
  if p_archived and coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  update students set archived_at = case when p_archived then now() end,
                      archived_by = case when p_archived then app.current_user_id() end,
                      archive_reason = case when p_archived then btrim(p_reason) end
   where id = p_student;
  perform app.add_event_internal(p_student, v_s.originating_org_id, 'student', case when p_archived then 'archived' else 'restored' end,
                        case when p_archived then 'Record archived: ' || btrim(p_reason) else 'Record restored from archive' end);
end $$;
