-- Undo 0031 (MD master data). WARNING: removes master-data requests, course–country offerings, the extra country/course
-- fields, names-at-selection and the new permissions. Master records themselves (countries, universities, courses) stay.
-- System Administrator master-data permissions are restored. Back up first (npm run db:backup).
drop function app.master_data_history(text[]);
drop function app.decide_master_data_request(uuid, boolean, text, text);
drop function app.request_master_data(text, text, uuid, text);
drop table masterdata_requests;
drop trigger students_master_data on students;
drop function app.students_master_data();
alter table students drop column destination_name_at_selection, drop column university_name_at_selection, drop column course_name_at_selection;

drop policy universities_insert on universities;
drop policy universities_update on universities;
create policy universities_write on universities for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('universities.manage')) or exists (select 1 from app.orgs_with_perm('reference.manage')))
  with check (exists (select 1 from app.orgs_with_perm('universities.manage')) or exists (select 1 from app.orgs_with_perm('reference.manage')));
drop policy courses_insert on courses;
drop policy courses_update on courses;
create policy courses_write on courses for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('reference.manage'))) with check (exists (select 1 from app.orgs_with_perm('reference.manage')));
drop policy countries_insert on countries;
drop policy countries_update on countries;
create policy countries_write on countries for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('reference.manage'))) with check (exists (select 1 from app.orgs_with_perm('reference.manage')));

drop trigger countries_guard on countries;
drop trigger courses_guard on courses;
drop trigger universities_guard on universities;
drop function app.guard_master_data();
drop table course_countries;
drop trigger courses_audit on courses;
drop trigger courses_touch on courses;
alter table courses drop constraint courses_not_own_parent;
alter table courses drop column category, drop column parent_course_id, drop column default_duration_years, drop column eligibility, drop column notes, drop column updated_at;
drop trigger countries_audit on countries;
drop trigger countries_touch on countries;
alter table countries drop column nationality, drop column currency_code, drop column notes, drop column updated_at;

insert into role_permissions (role_id, permission_key)
select r.id, p from roles r cross join unnest(array['universities.manage', 'requirements.manage', 'workflow.manage', 'attestation.routes.manage',
  'verification.rules.manage', 'academic.rules.manage', 'passport.rules.manage']) p where r.key = 'system_admin'
on conflict do nothing;
update permissions set category = 'Administration'
 where key in ('universities.manage', 'requirements.manage', 'workflow.manage', 'attestation.routes.manage', 'verification.rules.manage',
               'academic.rules.manage', 'passport.rules.manage');
delete from role_permissions where permission_key in ('masterdata.view', 'countries.manage', 'courses.manage', 'masterdata.status');
delete from permissions where key in ('masterdata.view', 'countries.manage', 'courses.manage', 'masterdata.status');
