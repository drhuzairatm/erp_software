-- =============================================================================
-- 0011 Bulk CSV import permission
-- Bulk import can create many personal-data records at once, so it is a
-- separate, sensitive permission (also requires students.create). Granted to
-- the default Company Manager role; configurable per company afterwards.
-- =============================================================================
insert into permissions (key, category, description, is_sensitive)
values ('students.import', 'Students', 'Bulk-import students from a CSV file', true)
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, 'students.import' from roles r where r.key = 'manager'
on conflict do nothing;
