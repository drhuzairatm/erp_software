-- Undo 0049. WARNING: secondary and tertiary preferences with their history, academic years and country document rules are lost. A notice limited to one intake becomes wider, so review notices first. Back up first.
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
revoke execute on function app.student_advisories(uuid), app.save_advisory_notice(uuid, jsonb, jsonb, text) from public;
grant execute on function app.student_advisories(uuid), app.save_advisory_notice(uuid, jsonb, jsonb, text) to erp_app;
drop function if exists app.student_preference_requirements(uuid, int);
drop function if exists app.student_advisories_for(uuid, uuid, uuid, uuid, uuid);
alter table advisory_notices drop column intake_id;
drop function if exists app.set_country_document_rule_active(uuid, boolean);
drop function if exists app.verify_country_document_rule(uuid, boolean, text);
drop function if exists app.save_country_document_rule(uuid, jsonb);
drop function if exists app.student_preference_clear(uuid, int);
drop function if exists app.student_preference_save(uuid, int, jsonb);
drop function if exists app.save_academic_year(uuid, text, int, boolean);
drop table if exists country_document_rules;
drop table if exists student_preference_history;
drop table if exists student_preferences;
drop table if exists academic_years;
delete from role_permissions where permission_key = 'requirements.verify';
delete from permissions where key = 'requirements.verify';
