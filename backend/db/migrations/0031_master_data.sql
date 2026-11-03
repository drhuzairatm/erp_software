-- =============================================================================
-- 0031 MD-controlled master data: countries, universities, courses (approved by
-- the MD on 1 Nov 2026 with decisions: 1 yes, 2 yes, 3 refused, 4 yes)
--
-- * Granular permissions, held only by the MD by default (System Administrator
--   loses admission master-data rights; the MD delegates through Roles):
--   masterdata.view, countries.manage, courses.manage, universities.manage,
--   masterdata.status, requirements.manage, workflow.manage,
--   attestation.routes.manage, verification.rules.manage, academic.rules.manage,
--   passport.rules.manage.
-- * Countries: nationality, indicative currency, notes; editable name and code.
-- * Courses: category, specialisation of (parent), default duration,
--   eligibility, notes; optional course ↔ country offering (decision 2).
-- * Students: a university outside the destination country is REFUSED
--   (decision 3); new selections must be active; when a university lists its
--   courses (or the country lists courses), the course must be one of them.
--   Existing records are untouched. Names at selection are kept for history.
-- * No deletion of master data (deactivate instead); everything audited.
-- * Requests: staff ask for a missing country/university/course; an authorised
--   user approves (record created) or rejects.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('masterdata.view',   'Master data', 'View the master-data administration (countries, universities, courses, requests, history)', false),
  ('countries.manage',  'Master data', 'Add and edit countries', false),
  ('courses.manage',    'Master data', 'Add and edit courses, specialisations and course-country offerings', false),
  ('masterdata.status', 'Master data', 'Activate / deactivate countries, universities and courses', false)
on conflict (key) do nothing;
update permissions set category = 'Master data'
 where key in ('universities.manage', 'requirements.manage', 'workflow.manage', 'attestation.routes.manage', 'verification.rules.manage',
               'academic.rules.manage', 'passport.rules.manage');

-- Decision 1: only the MD holds master-data permissions by default
delete from role_permissions rp using roles r
 where r.id = rp.role_id and r.key = 'system_admin'
   and rp.permission_key in ('universities.manage', 'requirements.manage', 'workflow.manage', 'attestation.routes.manage',
                             'verification.rules.manage', 'academic.rules.manage', 'passport.rules.manage');

-- Countries
alter table countries add column nationality text check (nationality is null or length(nationality) <= 80),
  add column currency_code text references currencies(code),
  add column notes text check (notes is null or length(notes) <= 2000),
  add column updated_at timestamptz not null default now();
create trigger countries_touch before update on countries for each row execute function app.touch_updated_at();
create trigger countries_audit after insert or update or delete on countries for each row execute function app.audit_row('', '');

-- Courses
alter table courses add column category text not null default 'Other' check (length(btrim(category)) between 2 and 60),
  add column parent_course_id uuid references courses(id),
  add column default_duration_years numeric(3, 1) check (default_duration_years is null or default_duration_years between 0.5 and 10),
  add column eligibility text check (eligibility is null or length(eligibility) <= 4000),
  add column notes text check (notes is null or length(notes) <= 2000),
  add column updated_at timestamptz not null default now();
alter table courses add constraint courses_not_own_parent check (parent_course_id is null or parent_course_id <> id);
update courses set category = case code when 'MBBS' then 'MBBS' when 'NURSING' then 'Nursing' when 'PG_MEDICAL' then 'Postgraduate Medical' else 'Other' end;
create trigger courses_touch before update on courses for each row execute function app.touch_updated_at();
create trigger courses_audit after insert or update or delete on courses for each row execute function app.audit_row('', '');

create table course_countries (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id),
  country_id  uuid not null references countries(id),
  notes       text check (notes is null or length(notes) <= 1000),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (course_id, country_id)
);
create trigger course_countries_audit after insert or update or delete on course_countries for each row execute function app.audit_row('', '');

-- No deletion of master data; status changes need masterdata.status
create or replace function app.guard_master_data() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'master data is never deleted; deactivate it instead' using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active and app.current_user_id() is not null
     and not exists (select 1 from app.orgs_with_perm('masterdata.status')) then
    raise exception 'permission denied: masterdata.status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger countries_guard before update or delete on countries for each row execute function app.guard_master_data();
create trigger courses_guard before update or delete on courses for each row execute function app.guard_master_data();
create trigger universities_guard before update or delete on universities for each row execute function app.guard_master_data();

-- Write policies: granular permissions (reads stay open to all signed-in staff for selection lists)
drop policy countries_write on countries;
create policy countries_insert on countries for insert to erp_app with check (exists (select 1 from app.orgs_with_perm('countries.manage')));
create policy countries_update on countries for update to erp_app
  using (exists (select 1 from app.orgs_with_perm('countries.manage')) or exists (select 1 from app.orgs_with_perm('masterdata.status')))
  with check (exists (select 1 from app.orgs_with_perm('countries.manage')) or exists (select 1 from app.orgs_with_perm('masterdata.status')));
drop policy courses_write on courses;
create policy courses_insert on courses for insert to erp_app with check (exists (select 1 from app.orgs_with_perm('courses.manage')));
create policy courses_update on courses for update to erp_app
  using (exists (select 1 from app.orgs_with_perm('courses.manage')) or exists (select 1 from app.orgs_with_perm('masterdata.status')))
  with check (exists (select 1 from app.orgs_with_perm('courses.manage')) or exists (select 1 from app.orgs_with_perm('masterdata.status')));
drop policy universities_write on universities;
create policy universities_insert on universities for insert to erp_app with check (exists (select 1 from app.orgs_with_perm('universities.manage')));
create policy universities_update on universities for update to erp_app
  using (exists (select 1 from app.orgs_with_perm('universities.manage')) or exists (select 1 from app.orgs_with_perm('masterdata.status')))
  with check (exists (select 1 from app.orgs_with_perm('universities.manage')) or exists (select 1 from app.orgs_with_perm('masterdata.status')));
alter table course_countries enable row level security;
create policy course_countries_select on course_countries for select to erp_app using (app.current_user_id() is not null);
create policy course_countries_write on course_countries for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('courses.manage'))) with check (exists (select 1 from app.orgs_with_perm('courses.manage')));
grant update (code, nationality, currency_code, notes) on countries to erp_app;
grant insert (nationality, currency_code, notes) on countries to erp_app;
grant insert (category, parent_course_id, default_duration_years, eligibility, notes, sort_order) on courses to erp_app;
grant update (name, category, parent_course_id, default_duration_years, eligibility, notes, sort_order) on courses to erp_app;
grant select, insert, update on course_countries to erp_app;

-- Students: historical names + consistency of country → university → course
alter table students add column destination_name_at_selection text, add column university_name_at_selection text, add column course_name_at_selection text;
alter table students disable trigger students_audit;
update students s set destination_name_at_selection = (select name from countries where id = s.destination_country_id),
                      university_name_at_selection = (select name from universities where id = s.preferred_university_id),
                      course_name_at_selection = (select name from courses where id = s.course_id);
alter table students enable trigger students_audit;
grant select (destination_name_at_selection, university_name_at_selection, course_name_at_selection) on students to erp_app;

create or replace function app.students_master_data() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uni universities%rowtype; v_has_list boolean;
begin
  if tg_op = 'INSERT' or new.destination_country_id is distinct from old.destination_country_id then
    if new.destination_country_id is not null and not exists (select 1 from countries where id = new.destination_country_id and is_active and is_destination) then
      raise exception 'the destination country is not active' using errcode = '23514';
    end if;
    new.destination_name_at_selection := (select name from countries where id = new.destination_country_id);
  end if;
  if tg_op = 'INSERT' or new.preferred_university_id is distinct from old.preferred_university_id or new.destination_country_id is distinct from old.destination_country_id then
    if new.preferred_university_id is not null then
      select * into v_uni from universities where id = new.preferred_university_id;
      if (tg_op = 'INSERT' or new.preferred_university_id is distinct from old.preferred_university_id) and not v_uni.is_active then
        raise exception 'the university is not active' using errcode = '23514';
      end if;
      if new.destination_country_id is null or v_uni.country_id <> new.destination_country_id then
        raise exception 'the university % is not in the selected destination country', v_uni.name using errcode = '23514';
      end if;
    end if;
    new.university_name_at_selection := (select name from universities where id = new.preferred_university_id);
  end if;
  if tg_op = 'INSERT' or new.course_id is distinct from old.course_id or new.preferred_university_id is distinct from old.preferred_university_id then
    if new.course_id is not null then
      if (tg_op = 'INSERT' or new.course_id is distinct from old.course_id) and not exists (select 1 from courses where id = new.course_id and is_active) then
        raise exception 'the course is not active' using errcode = '23514';
      end if;
      if new.preferred_university_id is not null then
        select exists (select 1 from university_courses where university_id = new.preferred_university_id and is_active) into v_has_list;
        if v_has_list and not exists (select 1 from university_courses where university_id = new.preferred_university_id and course_id = new.course_id and is_active) then
          raise exception 'the course is not offered by the selected university' using errcode = '23514';
        end if;
      elsif new.destination_country_id is not null
            and exists (select 1 from course_countries where country_id = new.destination_country_id and is_active)
            and not exists (select 1 from course_countries where country_id = new.destination_country_id and course_id = new.course_id and is_active) then
        raise exception 'the course is not offered in the selected country' using errcode = '23514';
      end if;
    end if;
    new.course_name_at_selection := (select name from courses where id = new.course_id);
  end if;
  return new;
end $$;
create trigger students_master_data before insert or update of destination_country_id, preferred_university_id, course_id on students
  for each row execute function app.students_master_data();

-- Requests for missing master data
create table masterdata_requests (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('country', 'university', 'course')),
  name            text not null check (length(btrim(name)) between 2 and 200),
  country_id      uuid references countries(id),
  details         text check (details is null or length(details) <= 2000),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by    uuid not null references user_profiles(id) default app.current_user_id(),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references user_profiles(id),
  decided_at      timestamptz,
  decision_note   text,
  created_record  uuid,
  check (kind <> 'university' or country_id is not null)
);
create trigger masterdata_requests_audit after insert or update on masterdata_requests for each row execute function app.audit_row('', '');

create or replace function app.request_master_data(p_kind text, p_name text, p_country uuid, p_details text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if app.current_user_id() is null or not exists (select 1 from organization_memberships where user_id = app.current_user_id() and is_active) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_kind not in ('country', 'university', 'course') then raise exception 'invalid kind' using errcode = '23514'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'enter the name' using errcode = '23514'; end if;
  if p_kind = 'university' and p_country is null then raise exception 'choose the country of the university' using errcode = '23514'; end if;
  if exists (select 1 from masterdata_requests where kind = p_kind and lower(btrim(name)) = lower(btrim(p_name)) and status = 'pending') then
    raise exception 'this has already been requested' using errcode = '23514';
  end if;
  insert into masterdata_requests (kind, name, country_id, details) values (p_kind, btrim(p_name), p_country, nullif(btrim(p_details), '')) returning id into v_id;
  return v_id;
end $$;

-- Approve (creates the record, active) or reject; needs the matching manage permission
create or replace function app.decide_master_data_request(p_request uuid, p_approve boolean, p_note text, p_code text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r masterdata_requests%rowtype; v_id uuid; v_perm text;
begin
  select * into v_r from masterdata_requests where id = p_request for update;
  if not found or v_r.status <> 'pending' then raise exception 'request not found or already decided' using errcode = 'P0002'; end if;
  v_perm := case v_r.kind when 'country' then 'countries.manage' when 'course' then 'courses.manage' else 'universities.manage' end;
  if not exists (select 1 from app.orgs_with_perm(v_perm)) then raise exception 'permission denied: %', v_perm using errcode = '42501'; end if;
  if not p_approve then
    if coalesce(btrim(p_note), '') = '' then raise exception 'give the reason for rejecting' using errcode = '23514'; end if;
    update masterdata_requests set status = 'rejected', decided_by = app.current_user_id(), decided_at = now(), decision_note = btrim(p_note) where id = p_request;
    return null;
  end if;
  if v_r.kind = 'country' then
    if coalesce(p_code, '') !~ '^[A-Z]{2}$' then raise exception 'enter the 2-letter ISO country code' using errcode = '23514'; end if;
    insert into countries (code, name, is_destination) values (p_code, v_r.name, true) returning id into v_id;
  elsif v_r.kind = 'course' then
    insert into courses (code, name, category) values (left(coalesce(nullif(upper(p_code), ''), trim(both '_' from upper(regexp_replace(v_r.name, '[^A-Za-z0-9]+', '_', 'g')))), 30), v_r.name, 'Other')
    returning id into v_id;
  else
    insert into universities (country_id, name) values (v_r.country_id, v_r.name) returning id into v_id;
  end if;
  update masterdata_requests set status = 'approved', decided_by = app.current_user_id(), decided_at = now(), decision_note = nullif(btrim(p_note), ''),
         created_record = v_id where id = p_request;
  return v_id;
end $$;

alter table masterdata_requests enable row level security;
create policy masterdata_requests_select on masterdata_requests for select to erp_app
  using (requested_by = app.current_user_id() or exists (select 1 from app.orgs_with_perm('masterdata.view'))
         or exists (select 1 from app.orgs_with_perm('countries.manage')) or exists (select 1 from app.orgs_with_perm('courses.manage'))
         or exists (select 1 from app.orgs_with_perm('universities.manage')));
grant select on masterdata_requests to erp_app;
-- Master-data history for users with any master-data permission (not only audit.read holders)
create or replace function app.master_data_history(p_perms text[]) returns table (id text, occurred_at timestamptz, actor text, action text, entity_type text, before_data jsonb, after_data jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id::text, a.occurred_at, u.full_name, a.action, a.entity_type, a.before_data, a.after_data
    from audit_logs a left join user_profiles u on u.id = a.actor_user_id
   where exists (select 1 from unnest(array['masterdata.view', 'countries.manage', 'courses.manage', 'universities.manage', 'masterdata.status',
                   'requirements.manage', 'workflow.manage', 'attestation.routes.manage', 'verification.rules.manage', 'academic.rules.manage',
                   'passport.rules.manage']) p where exists (select 1 from app.orgs_with_perm(p)))
     and a.entity_type in ('countries', 'courses', 'universities', 'course_countries', 'university_courses', 'university_intakes', 'university_document_requirements',
                           'masterdata_requests', 'advisory_notices', 'verification_rules', 'attestation_routes', 'workflow_definitions', 'document_requirements',
                           'passport_validity_rules', 'one_and_same_rules', 'role_permissions')
     and (a.entity_type <> 'role_permissions' or coalesce(a.after_data ->> 'permission_key', a.before_data ->> 'permission_key') = any(p_perms))
   order by a.occurred_at desc limit 200
$$;

grant execute on function app.request_master_data(text, text, uuid, text), app.decide_master_data_request(uuid, boolean, text, text),
  app.master_data_history(text[]) to erp_app;
