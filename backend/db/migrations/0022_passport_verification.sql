-- =============================================================================
-- 0022 A new passport becomes active only after verification (MD decision, Nov 2026)
--
-- * A new passport (first passport or renewal) recorded on the Passport tab is
--   saved as "awaiting verification". It does NOT change the student's current
--   passport, the 12-month rule or the expiry alerts until a user with
--   students.passport.verify verifies it. Rejection keeps the old passport active.
-- * Corrections of the current passport (same passport number, reason required)
--   stay immediate, as before.
-- * Editing the student record cannot replace a recorded passport number: a new
--   number must be recorded as a renewal and verified.
-- * Existing passport versions are treated as verified (they were already active).
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('students.passport.verify', 'Students', 'Verify a newly recorded passport so it becomes the active passport', true)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, 'students.passport.verify' from roles r where r.key in ('manager', 'documentation') on conflict do nothing;

alter table student_passports
  add column verification_status text not null default 'verified' check (verification_status in ('pending', 'verified', 'rejected')),
  add column verified_by        uuid references user_profiles(id),
  add column verified_at        timestamptz,
  add column verification_note  text check (verification_note is null or length(verification_note) <= 2000);
alter table student_passports add constraint student_passports_current_verified check (not is_current or verification_status = 'verified');
create unique index student_passports_one_pending on student_passports (student_id) where verification_status = 'pending';

-- Versions are never overwritten. Allowed changes (only inside the passport functions):
--   supersede: current → not current;  decide: pending → verified (may become current) or rejected.
create or replace function app.guard_passport_versions() returns trigger
language plpgsql as $$
declare v_rest text[] := array['is_current', 'superseded_at', 'verification_status', 'verified_by', 'verified_at', 'verification_note'];
begin
  if tg_op = 'DELETE' then
    raise exception 'passport records cannot be deleted' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.passport_sync', true), 'off') = 'on'
     and (to_jsonb(new) - v_rest) = (to_jsonb(old) - v_rest)
     and (
       -- supersede the current passport
       (old.is_current and not new.is_current and new.verification_status = old.verification_status
        and new.verified_by is not distinct from old.verified_by and new.verified_at is not distinct from old.verified_at
        and new.verification_note is not distinct from old.verification_note)
       -- verification decision on a pending passport
       or (old.verification_status = 'pending' and new.verification_status in ('verified', 'rejected') and not old.is_current
           and new.superseded_at is null and (new.verification_status = 'verified' or not new.is_current))
     ) then
    return new;
  end if;
  raise exception 'passport records are never overwritten; record a new version' using errcode = '42501';
end $$;

-- Who should verify: documentation staff on the student, else the counsellor, else a manager
create or replace function app.passport_verifier(p_student uuid, p_org uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select a.user_id from student_assignments a
      where a.student_id = p_student and a.is_active and a.assignment_type in ('documentation', 'counsellor')
        and app.user_is_active_member(a.user_id, p_org)
      order by (a.assignment_type = 'documentation') desc limit 1),
    (select m.user_id from organization_memberships m join roles ro on ro.id = m.role_id join user_profiles u on u.id = m.user_id
      where m.org_id = p_org and m.is_active and u.is_active and ro.key in ('manager', 'md')
      order by (ro.key = 'manager') desc, u.full_name limit 1))
$$;

-- Record a passport. initial/renewal → awaiting verification; correction → immediate (same number).
create or replace function app.record_passport(p_student uuid, p_kind text, p_number text, p_holder text, p_dob date, p_gender text,
  p_nationality uuid, p_citizenship uuid, p_issuing uuid, p_issue date, p_expiry date, p_place text, p_notes text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev student_passports%rowtype; v_id uuid := gen_random_uuid(); v_file uuid; v_org uuid; v_code text; v_version int;
  v_num text := upper(regexp_replace(coalesce(p_number, ''), '\s', '', 'g'));
begin
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'students.passport.view') then raise exception 'permission denied: students.passport.view' using errcode = '42501'; end if;
  if p_kind not in ('initial', 'renewal', 'correction') then raise exception 'invalid kind' using errcode = '23514'; end if;
  if v_num = '' then raise exception 'enter the passport number' using errcode = '23514'; end if;
  if p_expiry is null then raise exception 'enter the passport expiry date' using errcode = '23514'; end if;
  perform 1 from students where id = p_student for update;
  select * into v_prev from student_passports where student_id = p_student and is_current;
  select coalesce(max(version), 0) + 1 into v_version from student_passports where student_id = p_student;
  select originating_org_id, student_code into v_org, v_code from students where id = p_student;
  select d.current_file_id into v_file from student_documents d join document_types t on t.id = d.document_type_id
   where d.student_id = p_student and t.key = 'passport' and d.current_file_id is not null order by d.created_at limit 1;

  if p_kind = 'correction' then
    if v_prev.id is null then raise exception 'there is no active passport to correct; record the passport first' using errcode = '23514'; end if;
    if coalesce(btrim(p_notes), '') = '' then raise exception 'explain what is being corrected' using errcode = '23514'; end if;
    if v_prev.passport_number is not null and v_prev.passport_number <> v_num then
      raise exception 'a different passport number is a new passport: record it as a renewal (it is verified before it becomes active)' using errcode = '23514';
    end if;
    perform set_config('app.passport_sync', 'on', true);
    update student_passports set is_current = false, superseded_at = now() where id = v_prev.id;
    perform app.passport_close_tasks(v_prev.id, 'cancelled');
    insert into student_passports (id, student_id, version, kind, passport_number, holder_name, date_of_birth, gender, nationality_country_id,
                                   citizenship_country_id, issuing_country_id, issue_date, expiry_date, place_of_issue, document_file_id, notes, created_by,
                                   verified_by, verified_at)
    values (v_id, p_student, v_version, 'correction', v_num, nullif(btrim(p_holder), ''), p_dob, p_gender, p_nationality,
            p_citizenship, p_issuing, p_issue, p_expiry, nullif(btrim(p_place), ''), v_file, nullif(btrim(p_notes), ''), app.current_user_id(),
            v_prev.verified_by, v_prev.verified_at);
    update students set passport_number = v_num, passport_expiry = p_expiry, passport_country_id = p_issuing where id = p_student;
    perform set_config('app.passport_sync', 'off', true);
    perform app.add_event_internal(p_student, v_org, 'student', 'passport_correction',
      'Passport details corrected (version ' || v_version || ', expires ' || to_char(p_expiry, 'DD Mon YYYY') || ')', 'student_passports', v_id::text);
    perform app.passport_monitor(p_student);
    return v_id;
  end if;

  -- new passport: awaits verification
  if exists (select 1 from student_passports where student_id = p_student and verification_status = 'pending') then
    raise exception 'a new passport is already awaiting verification: verify or reject it first' using errcode = '23514';
  end if;
  if p_kind = 'renewal' and v_prev.id is not null and v_prev.passport_number = v_num then
    raise exception 'a renewed passport has a new passport number' using errcode = '23514';
  end if;
  if p_kind = 'initial' and v_prev.id is not null then
    raise exception 'this student already has an active passport: record a renewal or a correction' using errcode = '23514';
  end if;
  insert into student_passports (id, student_id, version, kind, passport_number, holder_name, date_of_birth, gender, nationality_country_id,
                                 citizenship_country_id, issuing_country_id, issue_date, expiry_date, place_of_issue, document_file_id, notes, created_by,
                                 is_current, verification_status)
  values (v_id, p_student, v_version, p_kind, v_num, nullif(btrim(p_holder), ''), p_dob, p_gender, p_nationality,
          p_citizenship, p_issuing, p_issue, p_expiry, nullif(btrim(p_place), ''), v_file, nullif(btrim(p_notes), ''), app.current_user_id(),
          false, 'pending');
  if p_kind = 'renewal' then
    insert into passport_followups (student_id, passport_id, kind, note)
    values (p_student, v_id, 'received', 'Renewed passport details recorded (version ' || v_version || ') – awaiting verification');
  end if;
  insert into tasks (org_id, student_id, title, description, task_type, assigned_to, priority, due_date, source_key)
  values (v_org, p_student, 'Verify new passport – ' || v_code,
          'A new passport (version ' || v_version || ', expires ' || to_char(p_expiry, 'DD Mon YYYY') || ') was recorded. Check it against the passport scan '
          || 'and verify or reject it on the Passport tab. It becomes the active passport only after verification.',
          'passport', app.passport_verifier(p_student, v_org), 'high', current_date + 2, 'passport-verify:' || v_id::text);
  perform app.add_event_internal(p_student, v_org, 'student', 'passport_' || p_kind,
    'New passport recorded – awaiting verification (version ' || v_version || ', expires ' || to_char(p_expiry, 'DD Mon YYYY') || ')',
    'student_passports', v_id::text);
  return v_id;
end $$;

-- Verify (activate) or reject a pending passport.
create or replace function app.verify_passport(p_passport uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p student_passports%rowtype; v_prev student_passports%rowtype; v_org uuid;
begin
  select * into v_p from student_passports where id = p_passport;
  if not found or not app.can_read_student(v_p.student_id) then raise exception 'passport not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_p.student_id, 'students.passport.verify') then
    raise exception 'permission denied: students.passport.verify' using errcode = '42501';
  end if;
  perform 1 from students where id = v_p.student_id for update;
  select * into v_p from student_passports where id = p_passport;
  if v_p.verification_status <> 'pending' then raise exception 'this passport is not awaiting verification' using errcode = '23514'; end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'invalid decision' using errcode = '23514'; end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'give the reason for rejecting' using errcode = '23514'; end if;
  select originating_org_id into v_org from students where id = v_p.student_id;
  select * into v_prev from student_passports where student_id = v_p.student_id and is_current;

  perform set_config('app.passport_sync', 'on', true);
  if p_decision = 'verified' then
    if v_prev.id is not null then
      update student_passports set is_current = false, superseded_at = now() where id = v_prev.id;
      perform app.passport_close_tasks(v_prev.id, case when v_p.kind = 'renewal' then 'completed' else 'cancelled' end);
    end if;
    update student_passports set verification_status = 'verified', is_current = true, verified_by = app.current_user_id(), verified_at = now(),
           verification_note = nullif(btrim(p_note), '') where id = p_passport;
    update students set passport_number = v_p.passport_number, passport_expiry = v_p.expiry_date, passport_country_id = v_p.issuing_country_id
     where id = v_p.student_id;
  else
    update student_passports set verification_status = 'rejected', verified_by = app.current_user_id(), verified_at = now(),
           verification_note = btrim(p_note) where id = p_passport;
  end if;
  perform set_config('app.passport_sync', 'off', true);
  update tasks set status = case when p_decision = 'verified' then 'completed' else 'cancelled' end
   where source_key = 'passport-verify:' || p_passport::text and status not in ('completed', 'cancelled');
  perform app.add_event_internal(v_p.student_id, v_org, 'student', 'passport_' || p_decision,
    case when p_decision = 'verified' then 'New passport verified and now active (version ' || v_p.version || ', expires ' || to_char(v_p.expiry_date, 'DD Mon YYYY') || ')'
         else 'New passport rejected (version ' || v_p.version || '): ' || btrim(p_note) || '. The previous passport stays active.' end,
    'student_passports', p_passport::text);
  if p_decision = 'verified' then perform app.passport_monitor(v_p.student_id); end if;
end $$;

-- Student record edits: a recorded passport number can only be replaced by a verified renewal.
create or replace function app.students_passport_version() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev student_passports%rowtype; v_same boolean; v_version int;
begin
  if coalesce(current_setting('app.passport_sync', true), 'off') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    if new.passport_number is null and new.passport_expiry is null and new.passport_country_id is null then return null; end if;
  elsif new.passport_number is not distinct from old.passport_number and new.passport_expiry is not distinct from old.passport_expiry
        and new.passport_country_id is not distinct from old.passport_country_id then
    return null;
  end if;
  select * into v_prev from student_passports where student_id = new.id and is_current;
  if v_prev.id is not null and v_prev.passport_number is not null and new.passport_number is distinct from v_prev.passport_number then
    raise exception 'passport number: a new passport must be recorded as a renewal on the Passport tab; it becomes active after verification'
      using errcode = '23514';
  end if;
  v_same := v_prev.id is not null and v_prev.passport_number is not distinct from new.passport_number;
  select coalesce(max(version), 0) + 1 into v_version from student_passports where student_id = new.id;
  perform set_config('app.passport_sync', 'on', true);
  if v_prev.id is not null then
    update student_passports set is_current = false, superseded_at = now() where id = v_prev.id;
    perform app.passport_close_tasks(v_prev.id, 'cancelled');
  end if;
  insert into student_passports (student_id, version, kind, passport_number, holder_name, date_of_birth, gender, nationality_country_id,
                                 citizenship_country_id, issuing_country_id, issue_date, expiry_date, place_of_issue, created_by)
  values (new.id, v_version, case when v_prev.id is null then 'initial' else 'edit' end, new.passport_number,
          v_prev.holder_name, v_prev.date_of_birth, v_prev.gender, v_prev.nationality_country_id, v_prev.citizenship_country_id,
          new.passport_country_id, case when v_same then v_prev.issue_date end, new.passport_expiry,
          case when v_same then v_prev.place_of_issue end, app.current_user_id());
  perform set_config('app.passport_sync', 'off', true);
  perform app.passport_monitor(new.id);
  return null;
end $$;

grant execute on function app.verify_passport(uuid, text, text) to erp_app;
