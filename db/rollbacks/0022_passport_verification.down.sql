-- Undo 0022 (passport verification). WARNING: deletes passports that were awaiting verification or were rejected,
-- their follow-up entries and "Verify new passport" tasks. Verified passports stay. Back up first (npm run db:backup).

delete from task_comments where task_id in (select id from tasks where source_key like 'passport-verify:%');
delete from task_events where task_id in (select id from tasks where source_key like 'passport-verify:%');
delete from tasks where source_key like 'passport-verify:%';
alter table passport_followups disable trigger passport_followups_immutable;
delete from passport_followups where passport_id in (select id from student_passports where verification_status <> 'verified');
alter table passport_followups enable trigger passport_followups_immutable;
alter table student_passports disable trigger student_passports_guard;
delete from student_passports where verification_status <> 'verified';
alter table student_passports enable trigger student_passports_guard;

drop function app.verify_passport(uuid, text, text);
drop function app.passport_verifier(uuid, uuid);

-- restore the 0019 functions
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

drop index student_passports_one_pending;
alter table student_passports drop constraint student_passports_current_verified;
alter table student_passports drop column verification_status, drop column verified_by, drop column verified_at, drop column verification_note;

delete from role_permissions where permission_key = 'students.passport.verify';
delete from permissions where key = 'students.passport.verify';
