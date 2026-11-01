-- Undo 0024 (rule engine). Conditions entered on rules are removed; rules return to their scope columns only.
-- Back up first (npm run db:backup).

drop trigger students_zz_checklist_facts on students;

-- restore the previous definitions
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

create or replace function app.applicable_rules(p_document uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id
    from student_documents d
    join students s on s.id = d.student_id
    join verification_rules r on r.document_type_id = d.document_type_id and r.status = 'approved'
   where d.id = p_document
     and r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)
     and (r.previous_education_country_id is null or r.previous_education_country_id = s.previous_education_country_id)
     and (r.destination_country_id is null or r.destination_country_id = s.destination_country_id)
     and (r.university_id is null or r.university_id = s.preferred_university_id)
     and (r.course_id is null or r.course_id = s.course_id)
$$;

create or replace function app.new_rule_version(p_rule uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r verification_rules%rowtype; v_new uuid;
begin
  if not exists (select 1 from app.orgs_with_perm('verification.rules.manage')) then
    raise exception 'permission denied: verification.rules.manage' using errcode = '42501';
  end if;
  select * into v_r from verification_rules where id = p_rule;
  if not found then raise exception 'rule not found' using errcode = 'P0002'; end if;
  if exists (select 1 from verification_rules where rule_group_id = v_r.rule_group_id and status = 'draft') then
    raise exception 'a draft version already exists' using errcode = '23514';
  end if;
  insert into verification_rules (rule_group_id, version, name, description, document_type_id, previous_education_country_id,
                                  destination_country_id, university_id, course_id, created_by)
  select v_r.rule_group_id, (select max(version) + 1 from verification_rules where rule_group_id = v_r.rule_group_id),
         v_r.name, v_r.description, v_r.document_type_id, v_r.previous_education_country_id, v_r.destination_country_id,
         v_r.university_id, v_r.course_id, app.current_user_id()
  returning id into v_new;
  insert into verification_requirements (rule_id, sort_order, kind, text, keywords, is_mandatory, guidance)
  select v_new, sort_order, kind, text, keywords, is_mandatory, guidance from verification_requirements where rule_id = p_rule;
  return v_new;
end $$;

create or replace function app.matching_attestation_routes(p_document uuid)
returns table (route_id uuid, specificity int)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id,
         (r.issuing_country_id is not null)::int * 4 + (r.document_type_id is not null)::int * 2 + (r.university_id is not null)::int * 2
         + (r.visa_application_country_id is not null)::int + (r.previous_education_country_id is not null)::int
    from student_documents d join students s on s.id = d.student_id
    join attestation_routes r on r.status = 'approved' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)
   where d.id = p_document
     and r.destination_country_id = s.destination_country_id
     and (r.issuing_country_id is null or r.issuing_country_id = d.issuing_country_id)
     and (r.document_type_id is null or r.document_type_id = d.document_type_id)
     and (r.university_id is null or r.university_id = s.preferred_university_id)
     and (r.visa_application_country_id is null or r.visa_application_country_id = s.visa_application_country_id)
     and (r.previous_education_country_id is null or r.previous_education_country_id = s.previous_education_country_id)
   order by 2 desc
$$;

create or replace function app.new_attestation_route_version(p_route uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r attestation_routes%rowtype; v_new uuid;
begin
  if not exists (select 1 from app.orgs_with_perm('attestation.routes.manage')) then
    raise exception 'permission denied: attestation.routes.manage' using errcode = '42501';
  end if;
  select * into v_r from attestation_routes where id = p_route;
  if not found then raise exception 'route not found' using errcode = 'P0002'; end if;
  if exists (select 1 from attestation_routes where route_group_id = v_r.route_group_id and status = 'draft') then
    raise exception 'a draft version already exists' using errcode = '23514';
  end if;
  insert into attestation_routes (route_group_id, version, name, description, route_type, destination_country_id, issuing_country_id,
                                  document_type_id, university_id, visa_application_country_id, previous_education_country_id, source_note, created_by)
  select v_r.route_group_id, (select max(version) + 1 from attestation_routes where route_group_id = v_r.route_group_id), v_r.name, v_r.description,
         v_r.route_type, v_r.destination_country_id, v_r.issuing_country_id, v_r.document_type_id, v_r.university_id,
         v_r.visa_application_country_id, v_r.previous_education_country_id, v_r.source_note, app.current_user_id()
  returning id into v_new;
  insert into attestation_route_stages (route_id, sort_order, name, authority_id, is_mandatory, responsible_department, requires_reference,
                                        requires_supporting_file, expected_days, guidance)
  select v_new, sort_order, name, authority_id, is_mandatory, responsible_department, requires_reference, requires_supporting_file, expected_days, guidance
    from attestation_route_stages where route_id = p_route;
  return v_new;
end $$;

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

alter table verification_rules disable trigger verification_rules_frozen;
alter table attestation_routes disable trigger attestation_routes_frozen;
alter table verification_rules drop column conditions;
alter table attestation_routes drop column conditions;
alter table verification_rules enable trigger verification_rules_frozen;
alter table attestation_routes enable trigger attestation_routes_frozen;
alter table passport_validity_rules drop column conditions;
alter table one_and_same_rules drop column conditions;
alter table university_document_requirements drop column conditions;
drop function app.conditions_match(jsonb, uuid, uuid);
drop function app.condition_eval(jsonb, jsonb);
drop function app.conditions_valid(jsonb, int);
drop function app.rule_facts(uuid, uuid);
