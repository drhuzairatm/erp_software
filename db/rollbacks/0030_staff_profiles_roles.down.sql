-- Undo 0030 (staff photos, employee IDs, reporting managers, role status/structure). WARNING: removes employee IDs,
-- reporting managers, role structure and staff photo records (image files in storage are not deleted). Back up first.
drop function app.staff_photo_file(uuid, text);
drop function app.remove_staff_photo(uuid);
drop function app.set_staff_photo(uuid, text, text, text, text);
drop function app.can_change_staff_photo(uuid);
drop table staff_photos;
drop function app.set_reporting_manager(uuid, uuid);
drop function app.set_role_structure(uuid, boolean, uuid);
drop trigger memberships_inactive_role on organization_memberships;
drop function app.guard_inactive_role();
alter table roles drop constraint roles_not_own_parent;
alter table roles drop column parent_role_id, drop column is_active;
alter table user_profiles drop constraint user_profiles_not_own_manager;
alter table user_profiles drop column reports_to, drop column employee_id;
drop sequence employee_id_seq;
