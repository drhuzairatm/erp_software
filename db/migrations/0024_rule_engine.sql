-- =============================================================================
-- 0024 Rule engine upgrade (Phase 4, approved by the MD on 1 Nov 2026)
--
-- One shared condition language for rules, stored as JSON:
--   group: {"all": [ ... ]} (AND) or {"any": [ ... ]} (OR), groups can be nested
--   leaf : {"field": "nationality", "op": "in", "values": ["<country uuid>", ...]}
--          ops: in, not_in (reference fields), is_set, is_not_set, gte, lte (numbers)
-- Fields (facts about the student, and the document where relevant):
--   nationality, citizenship, passport_issuing_country, residence_country,
--   previous_education_country, school_country, destination_country,
--   visa_application_country, document_issuing_country (countries);
--   university, course, intake, company, stage, document_type, lead_source;
--   age, passport_months_valid (numbers).
-- Conditions are an extra AND on top of the existing scope columns of:
--   verification rules (incl. Bonafide), attestation routes, passport validity
--   rules, One and Same rules and university document requirements (checklists).
-- An empty condition (NULL) means "no extra condition" – existing rules behave
-- exactly as before. Approved rules stay frozen; new versions copy conditions.
-- =============================================================================

-- Facts used by conditions
create or replace function app.rule_facts(p_student uuid, p_document uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'nationality', coalesce(p.nationality_country_id, p.issuing_country_id, s.passport_country_id),
    'citizenship', coalesce(p.citizenship_country_id, p.nationality_country_id),
    'passport_issuing_country', coalesce(p.issuing_country_id, s.passport_country_id),
    'residence_country', s.residence_country_id,
    'previous_education_country', s.previous_education_country_id,
    'school_country', coalesce(s.school_country_id, s.previous_education_country_id),
    'destination_country', s.destination_country_id,
    'visa_application_country', s.visa_application_country_id,
    'university', s.preferred_university_id,
    'course', s.course_id,
    'intake', s.intake_id,
    'company', s.originating_org_id,
    'stage', s.current_stage_key,
    'lead_source', s.lead_source_id,
    'age', case when s.date_of_birth is not null then extract(year from age(current_date, s.date_of_birth))::int end,
    'passport_months_valid', case when s.passport_expiry is not null
      then (extract(year from age(s.passport_expiry, current_date)) * 12 + extract(month from age(s.passport_expiry, current_date)))::int end,
    'document_type', d.document_type_id,
    'document_issuing_country', d.issuing_country_id))
    from students s
    left join student_passports p on p.student_id = s.id and p.is_current
    left join student_documents d on d.id = p_document and d.student_id = s.id
   where s.id = p_student
$$;

-- Evaluate a condition tree against facts (NULL / empty condition = true)
create or replace function app.condition_eval(p_cond jsonb, p_facts jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare v_fact jsonb; x jsonb; v_op text; v_num numeric;
begin
  if p_cond is null or p_cond = 'null'::jsonb or p_cond = '{}'::jsonb then return true; end if;
  if p_cond ? 'all' then
    for x in select * from jsonb_array_elements(p_cond -> 'all') loop
      if not app.condition_eval(x, p_facts) then return false; end if;
    end loop;
    return true;
  end if;
  if p_cond ? 'any' then
    if jsonb_array_length(p_cond -> 'any') = 0 then return true; end if;
    for x in select * from jsonb_array_elements(p_cond -> 'any') loop
      if app.condition_eval(x, p_facts) then return true; end if;
    end loop;
    return false;
  end if;
  v_fact := p_facts -> (p_cond ->> 'field');
  v_op := p_cond ->> 'op';
  if v_op = 'is_set' then return v_fact is not null; end if;
  if v_op = 'is_not_set' then return v_fact is null; end if;
  if v_op = 'in' then return v_fact is not null and (p_cond -> 'values') @> jsonb_build_array(v_fact); end if;
  -- not_in: an unknown fact does not match (the rule cannot be shown to apply)
  if v_op = 'not_in' then return v_fact is not null and not ((p_cond -> 'values') @> jsonb_build_array(v_fact)); end if;
  if v_op in ('gte', 'lte') then
    if v_fact is null or jsonb_typeof(v_fact) <> 'number' then return false; end if;
    v_num := (p_cond ->> 'value')::numeric;
    return case v_op when 'gte' then v_fact::text::numeric >= v_num else v_fact::text::numeric <= v_num end;
  end if;
  return false;
end $$;

create or replace function app.conditions_match(p_cond jsonb, p_student uuid, p_document uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_cond is null or app.condition_eval(p_cond, app.rule_facts(p_student, p_document))
$$;

-- Structural validation (used by CHECK constraints)
create or replace function app.conditions_valid(p_cond jsonb, p_depth int default 0) returns boolean
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare x jsonb; v_key text;
begin
  if p_cond is null then return true; end if;
  if p_depth > 5 or jsonb_typeof(p_cond) <> 'object' then return false; end if;
  if p_cond ? 'all' or p_cond ? 'any' then
    v_key := case when p_cond ? 'all' then 'all' else 'any' end;
    if jsonb_typeof(p_cond -> v_key) <> 'array' or jsonb_array_length(p_cond -> v_key) > 50 then return false; end if;
    for x in select * from jsonb_array_elements(p_cond -> v_key) loop
      if not app.conditions_valid(x, p_depth + 1) then return false; end if;
    end loop;
    return true;
  end if;
  if (p_cond ->> 'field') not in ('nationality', 'citizenship', 'passport_issuing_country', 'residence_country', 'previous_education_country',
       'school_country', 'destination_country', 'visa_application_country', 'document_issuing_country', 'university', 'course', 'intake',
       'company', 'stage', 'document_type', 'lead_source', 'age', 'passport_months_valid') then return false; end if;
  if (p_cond ->> 'op') in ('in', 'not_in') then
    return jsonb_typeof(p_cond -> 'values') = 'array' and jsonb_array_length(p_cond -> 'values') between 1 and 200
       and (p_cond ->> 'field') not in ('age', 'passport_months_valid');
  end if;
  if (p_cond ->> 'op') in ('gte', 'lte') then
    return jsonb_typeof(p_cond -> 'value') = 'number' and (p_cond ->> 'field') in ('age', 'passport_months_valid');
  end if;
  return (p_cond ->> 'op') in ('is_set', 'is_not_set');
end $$;

alter table verification_rules add column conditions jsonb check (app.conditions_valid(conditions));
alter table attestation_routes add column conditions jsonb check (app.conditions_valid(conditions));
alter table passport_validity_rules add column conditions jsonb check (app.conditions_valid(conditions));
alter table one_and_same_rules add column conditions jsonb check (app.conditions_valid(conditions));
alter table university_document_requirements add column conditions jsonb check (app.conditions_valid(conditions));
grant insert (conditions) on university_document_requirements to erp_app;

-- Consumers: identical to before plus the condition check
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
     and app.conditions_match(u.conditions, s.id, null)
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
     and app.conditions_match(r.conditions, s.id, d.id)
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
                                  destination_country_id, university_id, course_id, conditions, created_by)
  select v_r.rule_group_id, (select max(version) + 1 from verification_rules where rule_group_id = v_r.rule_group_id),
         v_r.name, v_r.description, v_r.document_type_id, v_r.previous_education_country_id, v_r.destination_country_id,
         v_r.university_id, v_r.course_id, v_r.conditions, app.current_user_id()
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
         + (r.visa_application_country_id is not null)::int + (r.previous_education_country_id is not null)::int + (r.conditions is not null)::int
    from student_documents d join students s on s.id = d.student_id
    join attestation_routes r on r.status = 'approved' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)
   where d.id = p_document
     and r.destination_country_id = s.destination_country_id
     and (r.issuing_country_id is null or r.issuing_country_id = d.issuing_country_id)
     and (r.document_type_id is null or r.document_type_id = d.document_type_id)
     and (r.university_id is null or r.university_id = s.preferred_university_id)
     and (r.visa_application_country_id is null or r.visa_application_country_id = s.visa_application_country_id)
     and (r.previous_education_country_id is null or r.previous_education_country_id = s.previous_education_country_id)
     and app.conditions_match(r.conditions, s.id, d.id)
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
                                  document_type_id, university_id, visa_application_country_id, previous_education_country_id, source_note, conditions, created_by)
  select v_r.route_group_id, (select max(version) + 1 from attestation_routes where route_group_id = v_r.route_group_id), v_r.name, v_r.description,
         v_r.route_type, v_r.destination_country_id, v_r.issuing_country_id, v_r.document_type_id, v_r.university_id,
         v_r.visa_application_country_id, v_r.previous_education_country_id, v_r.source_note, v_r.conditions, app.current_user_id()
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
     and app.conditions_match(r.conditions, s.id, null)
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
     and app.conditions_match(r.conditions, s.id, null)
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

-- Facts used by conditions can change after registration (verified passport, residence, school, age…):
-- re-check the checklist when they do. Adds only; never removes items.
create trigger students_zz_checklist_facts after update of passport_number, passport_country_id, residence_country_id, date_of_birth,
  previous_education_country_id, school_country_id, destination_country_id, visa_application_country_id, intake_id, lead_source_id on students
  for each row execute function app.students_after_update_checklist();

grant execute on function app.rule_facts(uuid, uuid), app.condition_eval(jsonb, jsonb), app.conditions_match(jsonb, uuid, uuid),
  app.conditions_valid(jsonb, int) to erp_app;
