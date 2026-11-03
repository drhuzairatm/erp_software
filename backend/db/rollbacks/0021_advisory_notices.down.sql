-- Undo 0021 (advisory notices). Removes notices, their history and acknowledgements, the follow-up tasks they created,
-- re-enables the thresholds that 0021 switched off and restores the 0020 stage checks. Back up first (npm run db:backup).

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

update stages set academic_check = academic_check;  -- no-op (values none/warn remain valid)
alter table stages drop constraint stages_academic_check_check;
alter table stages add constraint stages_academic_check_check check (academic_check in ('none', 'warn', 'block'));
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

delete from task_comments where task_id in (select id from tasks where source_key like 'adv:%');
delete from task_events where task_id in (select id from tasks where source_key like 'adv:%');
alter table advisory_acknowledgements disable trigger advisory_acks_immutable;
alter table tasks disable trigger tasks_audit;
drop table if exists advisory_acknowledgements;
delete from tasks where source_key like 'adv:%';
alter table tasks enable trigger tasks_audit;
drop table if exists advisory_notice_events;
drop table if exists advisory_notice_items;
drop table if exists advisory_notices;

drop function if exists app.acknowledge_advisory(uuid, uuid);
drop function if exists app.student_advisories(uuid);
drop function if exists app.set_advisory_status(uuid, boolean, text);
drop function if exists app.save_advisory_notice(uuid, jsonb, jsonb, text);
drop function if exists app.advisory_snapshot(uuid);
drop function if exists app.guard_advisory();

update academic_thresholds set is_active = true, source_note = nullif(btrim(replace(source_note, '[replaced by advisory notices in 0021]', '')), '')
 where source_note like '%[replaced by advisory notices in 0021]%';

delete from countries c where c.code = 'RO'
  and not exists (select 1 from students s where s.destination_country_id = c.id or s.previous_education_country_id = c.id or s.residence_country_id = c.id
                    or s.passport_country_id = c.id or s.school_country_id = c.id or s.visa_application_country_id = c.id)
  and not exists (select 1 from universities u where u.country_id = c.id);

delete from role_permissions where permission_key = 'requirements.manage';
delete from permissions where key = 'requirements.manage';
