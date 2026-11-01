# MD-controlled country, university and course management: inspection and plan (awaiting MD approval)

Inspected on 1 Nov 2026 against the code, database (migrations 0001–0026), permissions and admin screens.
**Nothing has been changed for this requirement yet.** As the requirement says, migrations and implementation wait for the MD's approval.

## 1. What exists today

| # | Function | Status | Where |
|---|---|---|---|
| 1 | Add countries | **Implemented** | Admin → Company settings → Destination countries (`reference.manage`); table `countries` (code, name, is_destination, is_education_origin, is_active) |
| 2 | Edit countries | **Partial** | Activate/deactivate only. Name and code can't be edited in the app; there are no nationality, currency or notes fields. |
| 3 | Activate / deactivate countries | **Implemented** | Same screen. Inactive countries disappear from selection lists (`lookups.ts` filters `is_active`). |
| 4 | Add universities | **Implemented** | Universities page and Company settings (`universities.manage` / `reference.manage`) |
| 5 | Edit universities | **Implemented** | University detail → Details (name, city, website, notes, active) |
| 6 | University ↔ country | **Implemented** | `universities.country_id` (required) |
| 7 | Add courses | **Partial** | Name and "academic details" profile only. No edit, no duration, no specialisations, no category. |
| 8 | Courses ↔ countries / universities | **Partial** | `university_courses` (duration, medium, eligibility per university). There is no direct country ↔ course link; it is derived through universities. |
| 9 | Country-specific admission requirements | **Implemented** | Admin → Country-wise requirements (advisory, versioned, acknowledgement, never blocking) |
| 10 | University-specific requirements | **Implemented** | University → required documents (with Phase 4 conditions); advisory notices can target a university |
| 11 | Course-specific requirements | **Partial** | Advisory notices and verification rules can target a course; there is no "course requirements" screen |
| 12 | Country document and attestation workflows | **Implemented** | Workflows per country/course (Company settings), attestation routes (draft → MD approval), verification and Bonafide rules, Phase 4 conditions |
| 13 | Permissions for these functions | **Partial** | `reference.manage`, `universities.manage`, `workflow.manage`, `requirements.manage`, `attestation.routes.manage`, `verification.rules.manage` exist and are enforced by RLS. They are **coarse**: one permission covers countries, courses and universities together. |
| 14 | MD access to all of the above | **Implemented** | The MD role is protected and always holds every permission |
| – | Delegation by the MD; no self-granting | **Implemented** | Roles screen: nobody can change a role they hold or grant permissions they lack; the MD role is locked |
| – | Audit | **Partial** | Universities and university courses are audited; **countries and courses have no audit trigger** |
| – | Student form: country → university → course | **Partial** | Universities are filtered by country in the browser. **Courses are not filtered by university. The server does not check that the university belongs to the chosen country.** |
| – | Request mechanism for missing master data | **Not implemented** | — |
| – | History kept when master data is renamed or deactivated | **Partial** | Students reference records by id, so a rename changes how old records display. Deactivation is safe. Deleting referenced rows is impossible (foreign keys). |
| – | Admin area with the 10 sections requested | **Partial** | Spread over Company settings, Universities, Country-wise requirements, Verification rules, Attestation routes and Audit log |

**Default access today:** the MD and the **System Administrator** role hold the master-data permissions. Managers and the CEO hold none. Counsellors and other staff can read only.

## 2. Proposed changes (additive, reversible)

**Next migration (proposed; 0027 is now used by student photos):**
- **Countries:** add `nationality`, `currency_code`, `notes`, `updated_at`; allow editing name and ISO code.
- **Courses:**
  - add `category` (MBBS / Nursing / Postgraduate Medical / … configurable), `parent_course_id` (specialisations), `default_duration_years`, `eligibility`, `notes`
  - add an optional `course_countries` link (where a course is offered when no university is set yet)
- **Audit triggers** on `countries`, `courses` and `course_countries`.
- **Database check** that a student's preferred university belongs to the student's destination country, and that the course is offered by that university. Only **active** records can be newly selected; existing students keep their values.
- **Historical names:** store the country, university and course names on the student at the time they are chosen (`*_name_at_selection`), so renamed or deactivated records still show what was selected.
- **Granular permissions** (all held by the MD; none granted to other roles by default):
  - `masterdata.view`
  - `countries.manage`
  - `universities.manage` (exists)
  - `courses.manage`
  - `masterdata.status` (activate / deactivate)
  - `requirements.manage` (exists)
  - `workflow.manage` (exists)
  - `attestation.routes.manage` (exists)
- **Master-data requests:** `masterdata_requests` table. Staff ask for a missing country, university or course with details; MD-authorised users approve (which creates the record), reject (with a reason), or merge into an existing record.

**Screens (Admin → Master data):** Countries, Universities, Courses, Country requirements, University requirements, Course requirements, Admission workflows, Document & attestation configuration, Master-data permissions (a delegation view over Roles), Master-data audit history and Requests.
Existing screens are reused: Country-wise requirements, University detail, Verification rules, Attestation routes, Workflows and the Audit log.

**Student form:** country → universities of that country → courses offered by that university (all from the database), plus "Can't find it? Request it" instead of creating master data.

**Tests:** the 16 acceptance checks listed in the requirement, at both service and database level.

## 3. Decisions needed from the MD
1. **System Administrator role:** remove its default master-data permissions, so only the MD holds them until delegated? Recommended: **yes**, as the requirement says.
2. **Course ↔ country link:** allow courses to be offered in a country without naming a university? Recommended: **yes**, optional.
3. **Strict check:** should a university outside the student's destination country be **refused**, or only warned? Recommended: **refused**. Existing records aren't changed.
4. **Currency per country:** indicative only (for display). Payments keep their own currency; see the multi-currency work.

Reply "approve master data" (with any changes to 1–4) to start the migration and implementation.
