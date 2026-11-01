# Staff profile photo, avatar and dynamic role management: final report

## 1. Audit summary
See `STAFF_PROFILE_ROLE_PHASE_1_AUDIT.md`. **Dynamic roles were already implemented** (create per company, edit, assign permissions, least privilege, MD protection, no self-escalation, full audit).
Missing:
- staff photos
- staff profile page
- employee IDs
- reporting managers
- role active/inactive and role hierarchy
- photo avatars

## 2. Reused
- Staff and Roles screens; the role/permission model and its database protections: `can_assign_role`, `can_administer_user`, the protected MD role, "can't change a role you hold", "can't grant what you don't hold"
- the audit triggers on staff, memberships, roles and role permissions
- the student-photo cropper and `sharp` processing, private storage, and the `Avatar` component

## 3. New
- **Add staff** (Admin → Staff): **Staff Profile Photo** (optional; camera or gallery, square crop with zoom and reposition, preview) and **Reporting manager**. The role choice now lists only active roles.
- **Staff list:**
  - photo avatar, **employee ID**, "Reports to", and a link to the profile
  - filters: search (name, email, ID), role, company, status
- **Staff profile** (`/admin/users/[id]`):
  - photo (view larger, upload, replace with confirmation, remove), employee ID, email, job title
  - reporting manager (editable by authorised administrators)
  - company access, role and department; direct reports; recent audited changes
- **Roles:** each role shows **Status** (Active / Inactive), **Reports to (role)** and **the people in the role**.
  - A role can be made inactive only when nobody holds it, and inactive roles can't be assigned.
  - The role structure is for the organisation chart only and **grants no permissions**.
- **Avatars with staff photos:**
  - top-bar user menu, Staff list and profile
  - Tasks list and board (assignee), task detail (assignee and comments)
  - Audit log (actor), student → Assigned staff, Leads (assigned)
  - Initials remain when there is no photo.

## 4. Database (migration `0030_staff_profiles_roles.sql`, rollback in `db/rollbacks/`)
- `user_profiles.employee_id`: **EMP-00001…**, existing staff numbered in creation order, new staff automatically.
- `user_profiles.reports_to`: no self-reference or loops; the manager must share a company.
- `roles.is_active` and `roles.parent_role_id`: same company, no loops.
- Trigger: inactive roles can't be assigned.
- `staff_photos`: original without metadata, square display version, 256 × 256 thumbnail; history; protected from edits and deletes.
- **Functions:** `set_role_structure`, `set_reporting_manager`, `set_staff_photo`, `remove_staff_photo`, `staff_photo_file`, `can_change_staff_photo`.

## 5. Security
- **Photos:**
  - changed only by the person themself, or by an administrator who may administer that person (the existing rule)
  - visible only to signed-in colleagues who share a company, through `/api/staff/[id]/photo`; there are no public URLs
  - the real image type is checked, EXIF/GPS removed, limited to 5 MB
- **Reporting manager and role structure:** the same authority as today. The **MD role can't be changed** (still protected), nobody can change a role they hold, and a parent role grants nothing.
- **No new escalation path:** tested that a System Administrator still can't assign a role with permissions they lack.

## 6. Audit
Staff registration, role changes, permission changes, membership changes, reporting manager changes (`user_profiles` audit), role status and structure (`roles` audit), and photo upload, replace and remove (`staff_photos` audit, without storage keys).

## 7. Tests run (actual results)
- **`tests/integration/staff-profiles-roles.test.ts`, 4 tests, passed:**
  - employee IDs for all, plus the next number for new staff
  - photo processing (square display, 256 thumbnail, metadata removed)
  - colleague can view, other company can't; colleague without authority can't change; the person can; delete refused
  - reporting manager: loop refused, other-company manager refused, non-administrator refused, direct reports listed
  - roles:
    - a new role starts with no permissions
    - parent set; loop and other-company parent refused
    - deactivate, then assigning is refused; reactivate and assign; deactivating while held is refused
    - MD role protected; counsellor refused
    - the existing escalation rule still holds
- **`tests/e2e/staff-profiles.spec.ts`, passed:** the MD adds staff with a photo and reporting manager; the list shows the photo avatar, EMP number and "Reports to"; the profile shows the photo; the role lists the new person.
- **Not automated:** camera capture on real phones (the standard capture input is used).

## 8. Limitations
- Reporting managers are set per person; the role structure is informational. Neither is used to grant access.
- Notification emails and reports show staff names, not photos.
- There is no separate "Director / General Manager" role set: roles are created by administrators as needed. No list was forced.

## 9. Deployment
Run `npx tsx scripts/migrate.ts` (applies 0030; existing staff get employee IDs automatically).
