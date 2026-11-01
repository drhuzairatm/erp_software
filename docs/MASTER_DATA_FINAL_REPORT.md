# MD-controlled master data: final report (approved 1 Nov 2026)

MD decisions:
1. Master-data rights are removed from the System Administrator by default: **yes**
2. Courses can be offered per country: **yes**
3. A university outside the destination country is **refused**
4. Country currency is indicative only: **yes**

## What was built
- **Admin → Master data** (sidebar "Master data"), with the 10 sections:
  1. **Countries:** add, edit (ISO code, name, nationality, indicative currency, notes, destination / education country), activate/deactivate, universities and students per country, courses offered.
  2. **Universities:** the existing university pages (country link required, website, notes, courses with duration and eligibility, intakes and deadlines, required documents with conditions, campuses).
  3. **Courses:** add, edit (category, specialisation of, duration, eligibility, notes), the countries where a course is offered, which universities offer it, activate/deactivate.
  4. **Country requirements:** the existing advisory notices (never blocking, with acknowledgement).
  5. **University requirements:** the university pages.
  6. **Course requirements:** notices targeted to a course, plus course eligibility.
  7. **Admission workflows:** Company settings → Workflows (`workflow.manage`).
  8. **Document & attestation configuration:** verification/Bonafide rules, attestation routes, passport and academic rules.
  9. **Master Data User Permissions:** who holds which master-data permission, by role and person.
  10. **Master Data Audit History:** every change, with before → after.
- **Requests:** any staff member can ask for a missing country, university or course. An authorised user approves it (the record is created and active) or rejects it (with a reason). Staff never create master data directly.
- **Student form:**
  - destination country → universities of that country → courses offered by that university (or by the country, if no university is chosen); all from the database
  - "Can't find it? Request it" link
  - the edit form keeps the student's current selection even if it was deactivated (marked "inactive")
- **Student profile:** shows "(selected as …)" when a record was renamed later, and "no longer offered" when deactivated.

## Permissions (database-enforced)
| Permission | Allows |
|---|---|
| masterdata.view | View the master-data area |
| countries.manage / universities.manage / courses.manage | Add and edit those records (courses: also offerings) |
| masterdata.status | Activate / deactivate |
| requirements.manage, workflow.manage, attestation.routes.manage, verification.rules.manage, academic.rules.manage, passport.rules.manage | The admission configuration areas |

- **Default:** **only the MD** holds these. The System Administrator role lost them; managers and the CEO never had them.
- **Delegation:** the MD delegates or revokes them under Roles (category "Master data"). Nobody can grant what they don't hold or change their own role (existing rules).

## Data integrity
- **No deletion** of countries, universities or courses (database trigger); deactivate instead.
- **New student selections** must be active. **The university must be in the destination country (refused otherwise).** If the university lists its courses, the course must be one of them; otherwise the country's course list applies, if it has one.
- **Existing students** keep their selections. Names at selection are stored, so renames don't rewrite history.
- **Audit triggers** on countries, courses, course offerings, universities and university parts, requests and role permissions.

## Changes
- **Migration `0031_master_data.sql`** (rollback restores the previous state, including System Administrator rights).
- **Service:** `src/server/services/master-data.ts`; **actions:** `src/app/actions/master-data.ts`.
- **Pages:** `src/app/(app)/admin/master-data/*`.
- **Updated:**
  - student form, edit page and profile
  - lookups
  - Company settings: countries, courses and universities moved to Master data
  - navigation and provisioning (course categories)
  - demo seed: demo students' courses are offered at their fictional universities
- **Tests:** existing tests that used the System Administrator for rule screens now either use the MD or explicitly delegate (`delegateToSystemAdmin`), as the MD would.

## Tests (actual results)
- **`tests/integration/master-data.test.ts`, 5 tests, all 16 acceptance checks, passed:**
  - MD adds and edits a country, several universities and courses (with a specialisation and a country offering)
  - other-country university refused; course filtered by university
  - deactivated university not offered for new students; the existing student keeps it and can still be edited; history name kept after a rename; delete refused
  - manager, System Administrator and CEO refused in the service **and** directly in the database
  - delegated `countries.manage` works while undelegated actions are refused; revoking works
  - request → MD approves → active university; audit history shows the changes; the permission view lists the MD
- **`tests/e2e/master-data.spec.ts`, passed:**
  - the MD adds a country
  - a counsellor has no access but requests a university
  - the MD approves
  - the student form offers the university only under that country
- **Full suite:** see the commit.

## Notes
- **Delegation needed:** if a System Administrator should keep managing rules, the MD must now delegate those permissions explicitly.
- **Edulinks/GRADUATER lists:** the real country, university and course lists are still to be entered by the MD; the demo records remain.
