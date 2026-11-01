# Staff profile photo, avatar and dynamic role management: Phase 1 audit

Audited on 1 Nov 2026 against the code, database (0001, 0007, 0012), the Staff and Roles screens, and the tests.

## 1. Staff management today
- **Staff accounts:** `user_profiles` (name, email, job title, active), with company access through `organization_memberships` (one per company: role, department, active).
- **Admin → Staff** (`users.manage`):
  - create an account (name, email, job title, company and role)
  - change each company's role and department, or activate/deactivate it
  - issue password links, reset 2FA, deactivate the person
  - shows last sign-in and 2FA status
- **There is no staff profile page, no employee ID, no reporting manager and no photo.**
- **Departments:** exist per company (`departments`, Company settings).
- **Staff assignments to students:** manager, counsellor, documentation, visa and finance contact, each kept in its own record.

## 2. Roles and permissions today
- **Roles are already dynamic:**
  - Admin → Roles (`roles.manage`) creates roles per company with any name and description, and assigns permissions from the 70+ permission list
  - new roles start with **no permissions** (least privilege)
- **Protections, enforced by database policies:**
  - the **MD role is protected** (locked, always holds every permission)
  - nobody can change a role they hold
  - nobody can grant permissions they don't hold
  - **privileged roles** (MD, CEO, System Administrator) can only be assigned by users with `users.create_admin`
  - people can only be administered if all their access is assignable by the administrator
  - nobody can change their own access
- Roles can't be deleted (there is no delete path in the app). **Roles have no active/inactive state and no parent/reporting relationship.**
- **Company isolation:** roles belong to one company; a membership's role must belong to the same company (foreign key).
- **Audit:** `user_profiles`, `organization_memberships`, `roles` and `role_permissions` all have audit triggers (before and after values, actor, time, company).

## 3. Where staff appear (initials avatars after the redesign)
| Location | Today |
|---|---|
| Top bar user menu | initials |
| Staff list | initials avatar |
| Tasks list and board (assignee), task detail (assignee, comments) | initials avatar |
| Audit log | initials avatar |
| Student → Assigned staff card | names only |
| Leads (assigned) | name only |
| Document review (verified/approved by) | names only |
| Notifications / outbox | names only |

## 4. Status
| Requirement | Status | Action |
|---|---|---|
| Photo at staff registration (camera, gallery, crop, preview) | Missing | Reuse the student photo cropper in square mode, and the same private storage and `sharp` processing |
| Staff photo management (upload, replace, remove, larger view) | Missing | New staff profile page |
| Staff avatar throughout the ERP | Partial (initials only) | Reuse `Avatar` (photo or initials) on the screens listed in §3 |
| Dynamic role creation | **Implemented** | Reuse |
| Edit role name and description | Implemented | Reuse |
| Role active/inactive | Missing | Add `roles.is_active`; deactivation refused while people still hold the role; inactive roles can't be assigned |
| Parent role / reporting structure | Missing | Add `roles.parent_role_id` (organisation chart, no permission inheritance) |
| Individual reporting manager | Missing | Add `user_profiles.reports_to` (cycles refused) |
| Role selection at registration | Implemented | Reuse; inactive roles hidden |
| View staff in each role | Partial (count) | Show the names |
| Employee ID | Missing | Add `employee_id`, generated `EMP-00001` and backfilled in creation order |
| Staff list: avatar, ID, role, reporting manager, department, company, status; filters | Partial | Add the columns and filters for role, company, status and search |
| Least privilege / no escalation / MD protection / company isolation | **Implemented** | Reuse; new functions follow the same rules |
| Audit (registration, roles, permissions, assignments) | Implemented | Add photo and reporting-manager events |

## 5. Plan
1. **Migration 0030:**
   - `user_profiles.employee_id` and `reports_to`
   - `roles.is_active` and `parent_role_id`
   - `staff_photos` (original, square display and 256 thumbnail; one current per person; history)
   - functions:
     - photo set/remove: by an administrator who may administer the person, or by the person themself
     - photo access: by colleagues who share a company
     - set reporting manager and set role status (same authority as today, cycle checks)
   - a guard so inactive roles can't be newly assigned
2. **Server and UI:**
   - photo service (shared with student photos), staff profile page `/admin/users/[id]`
   - photo field in Add staff; list columns and filters
   - role active toggle, parent role and members on the Roles page
   - avatars in the top bar, tasks, comments, audit log, the student's assigned-staff card and leads
3. **Tests:** integration plus a browser test.
4. **Final report.**

## 6. Security considerations
- Staff photos are private: visible only to signed-in colleagues who share a company, through an authorised route, never a public URL. All metadata is stripped.
- Reporting relationships and role structure are organisational information only. **Permissions still come only from assigned roles**; a parent role grants nothing.
- None of the new functions can bypass `can_assign_role` or `can_administer_user`, or touch the protected MD role's permissions.
