# Local project readiness report

**Date:** 4 November 2026
**Scope:** this Mac only. **The VPS was not contacted**, and SSH setup and the production script are paused by MD decision.
**Architecture:** Next.js, PostgreSQL, existing SQL and database functions, existing security model. No migration.
**Status:** for MD review. Nothing was implemented, and no database, migration, commit, push or deployment was made.

> **Update, 4 Nov 2026:** the approved clean-up is reported in `LOCAL_CLEANUP_REPORT.md`, and it supersedes the defect status below. The MD set GitHub `main` / `3df4171` as the development baseline. The "any database role" wording for the 173 functions is corrected in `PRIVILEGED_FUNCTIONS_SECURITY_REVIEW.md`.

## 1. Result

**Ready for development, with a short clean-up first.** The code at `3df4171` passes every local check. Three email defects and the passport rule should be fixed before new modules start, and that needs your approval.

| Check on `3df4171` | Result | Note |
|---|---|---|
| Typecheck | **Pass** | Exit 0 |
| Lint | **Pass** | Exit 0 |
| Backend tests | **405 of 405** | 46 files |
| Migration tests | **2 of 2** | |
| Frontend integration tests | **129 of 129** | 9 files |
| Production build | **Pass** | With a closed-port database and blank mail settings |
| Browser tests (Playwright) | **130 of 130** | Throwaway database, 3.8 minutes |
| Development database | **Unchanged** | Row counts and last audit time identical before and after |

### What passing does not cover

- **Defects that have no failing test.** Section 5's defects exist while every test passes.
- **Real services:** no real mail server, virus scanner or S3 storage.
- **Database version:** tests ran on PostgreSQL 17. The VPS was reported as 18.
- **Devices:** desktop Chrome and emulated phone sizes, no real iPhone or Android.
- **Security settings:** browser tests ran with `MFA_ENFORCE=off`. Backend tests use `roles`. MFA has its own suites.
- **Load and penetration testing:** none.
- **Test matching:** the matrix links suites to features by name. I didn't read every assertion.

## 2. Repository

| Item | Finding |
|---|---|
| Branch | `refactor/express-api`, at `3df4171`, same as GitHub |
| History | 39 commits, one author, no tags, no stash; version `0.1.0` |
| Application code | No uncommitted changes |
| Uncommitted | Documents only: two superseded notices, five new audit documents, the paused script, and this report |
| Local `main` | Stale at `eb8dd7d`, not updated, to avoid changing the repository |
| Migrations | 37; 37 applied in the development database; rollback files from `0017` onward (21) |
| CI | None |
| Local environment | `.env` lacks `INTERNAL_API_SECRET`, so plain `npm run dev` gives health 503 until it's supplied |
| Development data | 397 fictional students and test residue, unsuitable as a business-rule reference. One real Gmail in a pending invite (P17-2) |

## 3. Does local code match the intended production release?

| Comparison | Result | Confidence |
|---|---|---|
| Local vs GitHub `main` (`d123404`) | **Identical files** (same tree, read from a throwaway clone) | Verified |
| Local vs `f36328f`, the commit you reported on the VPS | **Differs:** 50 files, no schema change; backend only `email.ts`; the rest responsive UI, tests, documents | Verified as Git history |
| What the VPS is running now | **Unknown** | Not assessed, by instruction |

**So if the intended release is `main`, the local code matches exactly.** If it's what you reported on the VPS, the local code is 8 commits ahead.

**Remaining uncertainty:**
- There are no release tags or deployment records in the repository, so Git alone can't name a release.
- `RESEND_TO_NODEMAILER_DEPLOYMENT_READINESS.md` rated this email code **not ready**, and it has since merged to `main`.
- `.env.example` changed with it. Any server moving to this code needs new `SYSTEM_MAIL_*` settings.

## 4. Requirement status

Each status comes from source and schema, supported by today's tests where a suite exists. "Completed" means implemented and test-backed, not accepted by the business.

| Module | Completed | Partial | Broken | Differs from requirement | Missing | Unverified |
|---|---|---|---|---|---|---|
| A1. MD profile | 2 | 2 | 0 | 2 | 3 | 0 |
| A2. Employee management | 5 | 1 | 0 | 2 | 1 | 0 |
| A3. Roles and permissions | 3 | 0 | 0 | 2 | 1 | 0 |
| B. Task management | 1 | 2 | 0 | 4 | 6 | 0 |
| C. Daily core meeting | 0 | 0 | 0 | 0 | 5 | 0 |
| D. Internal chat | 0 | 0 | 0 | 0 | 6 | 0 |
| E. Secure attendance | 0 | 0 | 0 | 0 | 8 | 0 |
| F. Student portal | 3 | 3 | 0 | 0 | 1 | 0 |
| G. Pre-admission document verification | 0 | 0 | 0 | 0 | 8 | 0 |
| H. Student registration and master data | 3 | 1 | 0 | 2 | 0 | 0 |
| I. Configurable requirements | 2 | 2 | 0 | 1 | 0 | 0 |
| J. Documents | 4 | 1 | 0 | 2 | 0 | 0 |
| K. Country workflows | 0 | 3 | 0 | 0 | 1 | 0 |
| L. Finance | 4 | 1 | 0 | 0 | 1 | 1 |
| M. Dashboards | 0 | 3 | 0 | 0 | 1 | 0 |
| Phase 4 security | 4 | 3 | 0 | 0 | 2 | 3 |
| N. Email delivery (defects found in current source) | 1 | 0 | 3 | 0 | 0 | 0 |
| **Total (120)** | **32** | **22** | **3** | **15** | **44** | **4** |

**Reading the columns below:** "API" means Server Actions unless a route is named. `SA` is a file in `frontend/src/app/actions/`; `svc` is in `backend/src/services/`. A = completed, B = partial, C = broken, D = differs from requirement, E = missing, F = unverified. REG = earlier audit finding, not re-verified. DEV-DB = local development database.

## A1. MD profile

| ID | Requirement | Status | Existing implementation | Permissions | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|---|
| A1.1 | First, Middle, Last, Display Name | **E** | Only `user_profiles.full_name` (SRC) | n/a | none | No separate names → add fields, keep `full_name` compatible | Yes |
| A1.2 | Designation | **D** | `job_title` free text, labelled Designation in `admin-forms.tsx:157` | `users.manage` | `staff-profiles-roles` | Free text, not managed → designation master | Yes |
| A1.3 | System role, department, company membership | **A** | `organization_memberships`; `/admin/users/[id]` | `users.manage` | `staff-accounts`, `staff-profiles-roles` | None | No |
| A1.4 | Photo upload and camera | **A** | `staff_photos`, `photo-capture.tsx`, `/api/staff/[id]/photo` | `users.manage` | `photo-capture.spec` | None for admin. No self-service path (see A1.7) | No |
| A1.5 | Secure email change | **E** | No path found (SRC; also P17-3) | n/a | none | Build verified change with re-authentication | Likely |
| A1.6 | Secure phone change | **B** | `user_profiles.phone` set by admin | `users.manage` | not confirmed | No secure self-service flow or verification | Maybe |
| A1.7 | MD edits own profile | **D** | `/account` has only `password` and `security` | n/a | none | Add `/account/profile` | No |
| A1.8 | Password and MFA | **B** | Argon2, TOTP, recovery codes, `/account/*` | self | `mfa`, `auth-*` | P17-1: no MD 2FA recovery tool | Maybe |
| A1.9 | Profile change history | **E** as a view | `audit_logs` may capture changes; no profile-history view (SRC) | `audit.read` | none | Add history view; confirm triggers cover all fields | Likely no |

Protected-MD safeguards (`is_protected`, second-MD guard in `0032`) are in place, so "edits must not change privileged access" has a sound base. It must be re-tested when A1.7 is built.

## A2. Employee management

| ID | Requirement | Status | Existing implementation | Permissions | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|---|
| A2.1 | Registration | **A** | `createStaffAction`, `/admin/users` | `users.manage`, `users.create_admin` | `staff-accounts`, spec | None | No |
| A2.2 | Invitation and activation | **A** | `inviteAction`, `/invite/[token]`, outbox `0035` | `users.manage` | `staff-accounts`, `staff-email-outbox` | BUG-1 and BUG-2 affect the mail path | No |
| A2.3 | Suspension, reactivation | **A** | `setStaffStatus`, reason required, sessions ended | `users.manage` | `staff-accounts` | None | No |
| A2.4 | Deactivation, archival | **D** | Statuses are `invited`, `active`, `suspended`, `terminated`; no staff hard delete found in the service | `users.manage` | `staff-accounts` | No distinct Archived state → D5 decides whether Terminated is enough | Maybe |
| A2.5 | Department | **A** | `departments`, `/admin/settings` | `departments.manage` | `staff-profiles-roles` | None | No |
| A2.6 | Designation management | **D** | Free text | `users.manage` | none | See A1.2 | Yes |
| A2.7 | Login history | **A** | `loginActivity` on `/admin/users/[id]` | `users.manage` | not confirmed by name | Reads audit-based activity; confirm in testing | No |
| A2.8 | Audit history | **B** | `/audit` with filters | `audit.read` | `audit-remediation` | Not shown per employee | No |
| A2.9 | Employee self-service profile | **E** | None | n/a | none | See A1.7 | No |

## A3. Roles and permissions

| ID | Requirement | Status | Existing implementation | Permissions | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|---|
| A3.1 | Dynamic roles | **A** | `createRoleAction`, `/admin/roles`; a custom role exists in dev (DEV-DB) | `roles.manage` | `security-matrix` | None | No |
| A3.2 | Backend enforcement | **A** | `app.has_perm`, RLS, service checks | n/a | `security-matrix`, `db-isolation`, `isolation` | None | No |
| A3.3 | Safe role deactivation | **A** | `0030:53` refuses while active members hold the role; `0030:37` blocks assignment | `roles.manage` | `staff-profiles-roles` | None | No |
| A3.4 | Permission vocabulary (View, Create, Edit, Archive, Approve, Export, Assign, Manage Settings) | **D** | About 80 domain-specific keys such as `students.update`, `payments.verify` | n/a | `security-matrix` | Finer than requested, but not this vocabulary → **recommend keeping and grouping on screen** (D6) | Maybe |
| A3.5 | Individual user overrides | **E** | None found (SRC) | n/a | none | New table, `has_perm` change. Security-sensitive | Yes |
| A3.6 | Roles not hard-coded | **D** | Hard-coded: `(app)/page.tsx:32` (`md`, `ceo`), `students/[id]/page.tsx:284` (`manager`, `md` …) | n/a | none | Replace with permission checks | No |

## B. Task management

| ID | Requirement | Status | Existing implementation | Permissions | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|---|
| B1 | Create, assign, comment, history | **A** | `/tasks`, `task-forms.tsx`, `SA/tasks.ts`, `svc/tasks.ts`, `tasks`, `task_comments`, `task_events` | `tasks.*` | `services`, `phase-*` | None | No |
| B2 | Priority Critical, High, Medium, Low | **D** | `low`, `normal`, `high`, `urgent` (`0005:16`) | same | as above | Rename or map (D7) | Yes |
| B3 | Statuses Pending, In Progress, Submitted, Completed, Overdue | **D** | `not_started`, `in_progress`, `waiting_external`, `completed`, `cancelled`. Overdue is computed. | same | as above | No Submitted (D7) | Yes |
| B4 | Start date | **E** | None | n/a | none | Add column | Yes |
| B5 | Deadline date **and time** | **D** | `due_date` is `date` (`0005:19`); overdue compares `current_date` | same | as above | Needs timestamp. Reminders at 1–6 hours depend on this | Yes |
| B6 | Completion requirements | **E** | None | n/a | none | Add field | Yes |
| B7 | Supporting documents | **E** | No task attachment (form fields checked) | n/a | none | Needs a file link; see dependency X6 | Yes |
| B8 | Related meeting or decision | **E** | Only `student_id` link | n/a | none | Add after module C | Yes |
| B9 | Manager verification workflow | **E** | Assignee completes directly | n/a | none | Submit → verify or return | Yes |
| B10 | Automatic breach, Completed Late retained | **B** | Computed `is_overdue`; analytics counts late completions by date | same | not confirmed | Not stored, ignores time of day | Yes |
| B11 | Deadline extension history | **D** | `task_events` records `due_date` changes (`0005:121`) | same | as above | No reason or approval | Maybe |
| B12 | Reminders and escalation via backend jobs | **E** | `notification_rules.event_key` is student-facing; no task job (REG F-05, SRC) | n/a | none | Needs jobs and staff notifications (X2, X3) | Yes |
| B13 | Task dashboards and reports | **B** | `taskCounts`, `overdue-tasks` report, staff workload in analytics | `staff.workload.view` | not confirmed | No Completed Today view, or department, weekly or monthly reports | No |

## C. Daily core meeting

**Verified absent (SRC):** zero matches for `meeting` and `core team` in source and migrations; no route, table or permission.

| ID | Requirement | Status | Gap → required action | DB change |
|---|---|---|---|---|
| C1 | Meeting records: date, times, attendees, agenda, discussion, decisions, action points | **E** | New module | Yes |
| C2 | Executive Assistant or note taker role | **E** | New permission | Yes |
| C3 | Modification history | **E** | Reuse audit pattern | Yes |
| C4 | Strict Core Team privacy, managed membership | **E** | New RLS; note D8 on system administrators | Yes |
| C5 | Tasks from decisions, with traceability | **E** | Depends on stage for tasks (B8) | Yes |

## D. Internal chat

**Verified absent (SRC):** zero matches for `chat`, `websocket`, `socket.io`, `read receipt`, `typing`. The `reaction` matches are false positives from identifiers ending in `...reAction`, such as `signOutEverywhereAction`.

| ID | Requirement | Status | Gap → required action | DB change |
|---|---|---|---|---|
| D1 | 1:1, Core Team, All Employees, Sales, Marketing, Management, custom groups | **E** | New module | Yes |
| D2 | Text and attachments, secure downloads | **E** | Reuse scanning (X6) | Yes |
| D3 | Reply, forward, edit, delete, reactions, pin, search, mentions | **E** | New module | Yes |
| D4 | Real-time, delivery, read receipts, typing, presence, reconnection, unread | **E** | New real-time service (X1) | Yes |
| D5 | Task links and mobile use | **E** | Build after tasks | Yes |
| D6 | Governance: no unrestricted private-message access | **E** | Must be designed in RLS from the start (D9) | Yes |

## E. Secure attendance

**Verified absent (SRC):** zero matches for `attendance`, `kiosk`, `geofence`, `selfie`, `break_start`. `liveness` matches are only health-check routes. `face` matches are words such as "interface" and photo-cropping comments; no face matching exists.

| ID | Requirement | Status | Gap → required action | DB change |
|---|---|---|---|---|
| E1 | Mobile and office kiosk clock in/out | **E** | New module | Yes |
| E2 | Live selfie, no gallery uploads | **E** | `photo-capture.tsx` is reusable; see limit in X4 | Yes |
| E3 | IP allowlist, GPS geofence, signed short-lived QR, no SSID reliance | **E** | `client-ip.ts` and `qrcode` are reusable. `TRUST_PROXY` must be right or IP checks are worthless | Yes |
| E4 | Face matching and randomized liveness | **E** | External dependency and legal decision (D3) | Yes |
| E5 | Failed checks go to Manual Review, never auto-reject | **E** | New queue | Yes |
| E6 | Breaks, late, early, half-day, leave, field duty, official visit, corrections, approval | **E** | New module | Yes |
| E7 | Dashboard and admin configuration (offices, IPs, hours, grace, rules) | **E** | New module | Yes |
| E8 | Privacy: minimization, consent, encryption, retention, appeal, legal review | **E** | Legal review before biometrics. Register A-12 says no retention process exists | Yes |

## F. Student portal

| ID | Requirement | Status | Existing implementation | Permissions | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|---|
| F1 | Separate login, recovery, email verification, sessions | **A** | `/portal`, `svc/portal.ts`, `auth_private.student_accounts`, `portal_sessions`, `0036`, `0037` | portal session | `phase-6-portal`, `portal-link-queue`, `auth-message-queue` | None | No |
| F2 | Isolation | **A** | Portal functions keyed to the session | n/a | `isolation`, `portal-link-db-security` | None | No |
| F3 | Document upload, status, resubmit, download letters | **A** | `portalUpload`, `portal_publications`, logged downloads | `documents.publish` | `phase-6-portal` | None | No |
| F4 | Dashboard: status, progress, country, university, programme, checklist | **B** | `/portal/home` shows stage, progress, course, destination | n/a | spec | Dashboard is one student's single choice; see H3 | No |
| F5 | Payments and dues | **B** | Balances and entries shown | n/a | `multi-currency` | No due dates (L4) | Yes |
| F6 | Visa status | **B** | Stage visible; **no `visa_outcome` in portal code** (SRC; REG F-03) | n/a | none | Add once publishing rule is decided | Maybe |
| F7 | Ask a Question tickets: staff, replies, statuses, attachments, history, audit | **E** | Zero matches for `ticket`; only support phone and email links (SRC; REG F-01) | n/a | none | New module | Yes |

## G. Pre-admission document verification

**Verified absent (SRC):** zero matches for `pre-admission`, `DVR`, `prospective`. The one `verification request` match is an email-verification comment. `leads` cannot stand in for it: it is a follow-up pipeline, while G requires PDF review independent of any student or application.

| ID | Requirement | Status | Gap → required action | DB change |
|---|---|---|---|---|
| G1 | Counselor request with context, categories, multiple PDFs, review before submit | **E** | New module | Yes |
| G2 | ID `DVR-YYYY-000001` | **E** | Numbering scope needs a decision (D10) | Yes |
| G3 | Queue: search, filter, secure PDF, assign, reassign | **E** | `pdf-viewer` is reusable | Yes |
| G4 | 13 lifecycle statuses | **E** | New | Yes |
| G5 | Document-level and overall results (POSSIBLE etc.) | **E** | New | Yes |
| G6 | Verification against configured requirements, no invented rules | **E** | Depends on real rules (X7) | Maybe |
| G7 | Return, resubmission, versions, context-change re-verification | **E** | New | Yes |
| G8 | Optional conversion to student, notifications, reports, scan, quarantine, retention, 20-step acceptance | **E** | Depends on X2, X6 | Yes |

## H. Student registration and master data

| ID | Requirement | Status | Existing implementation | Permissions | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|---|
| H1 | Personal, passport, citizenship, photo | **A** | `student-form.tsx`, `students`, `student_passports`, `student_photos` | `students.create` | `phase-2-passport-contacts`, `student-photos` | None. `0019` header lists nationality and citizenship as passport fields; confirm on screen during Stage 9 | No |
| H2 | 3 phones, country-code detection and manual selection | **A** | `phone`, `phone2`, `phone3`, `phone-field.tsx`, `libphonenumber-js` | same | spec | None | No |
| H3 | Primary, Secondary, Tertiary preferences | **D** | One destination, course, university (SRC; REG F-09) | same | none | New preference table; reports, rules and portal all read the single value (X8) | Yes |
| H4 | Passport expired or under 12 months warns, never blocks registration; University Application warning only by default (MD decision) | **D** | Registration allowed. **University Application still blocks**, also when expiry is missing (`defaults.ts:268`, `students.ts:491`, trigger in `0019`, `phase-3-academic.test.ts:61`) | `passport.rules.manage` | yes, asserts the old block | Change rule to warn; update test; add source and approval fields; form warning | Yes, small |
| H5 | Passport reminders | **B** | `passport_followups`, `app.passport_monitor` in daily cron | same | `phase-2-*` | Depends on a scheduler in production (X3) | No |
| H6 | Country, university, programme CRUD and activation, intakes | **A** | `/admin/master-data`, `/universities`, `university_intakes` | `countries.manage`, etc. | `master-data` | None | No |

## I. Configurable requirements

| ID | Requirement | Status | Existing implementation | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|
| I1 | By country, university, programme, intake, stage | **A** | `advisory_notices`, `0021`, `0024` rule engine, `/admin/requirements`, `/admin/rule-tester` | `phase-3b-advisory`, `phase-4-rule-engine` | None | No |
| I2 | Advisory, not blocking | **A** | Advisory notices with acknowledgement (`requirements.ts:44`) | `phase-3b-advisory` | None | No |
| I3 | Bulgaria 60% in Chemistry, Biology, Physics, English, configurable by university and programme (MD decision) | **D** | Advisory notice active in dev DB, at country level for all courses. Old thresholds deliberately replaced. University and course fields exist on the form; one course per notice | `phase-3b-advisory`, `phase-3-academic` | Reconfigure with one notice per course or university. Try the form end to end | Data |
| I4 | Versioning and change history | **B** | Notice `version`, `advisory_notice_events`, acknowledgement history | same | Confirm the UI exposes it | No |
| I5 | Real rules, none invented | **B** | Engine exists. `[PLACEHOLDER]` and `[TO CONFIRM]` rules come from demo seed only; workflows and country list have no recorded source | n/a | Official sources plus MD approval | Data |

## J. Documents

| ID | Requirement | Status | Existing implementation | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|
| J1 | Upload, categories, checklist | **A** | `svc/documents.ts`, `student_documents`, `document_files` | `services`, `files` | None | No |
| J2 | Verification, rejection, resubmission | **A** | `document_reviews`, `document_verifications`, `DOCUMENT_VERIFICATION.md` | `scenarios-a-l` | None | No |
| J3 | PDF preview, download, merge | **A** | `pdf-viewer`, `svc/merge.ts`, `/api/students/[id]/merge` | `document-merge` | None | No |
| J4 | Merged filename `StudentName-PassportNumber-UniversityName.pdf` | **D** | Produces `Student Name - Passport - University.pdf` (`merge-filename.ts`), previously approved in commit `dcb4689` | `document-merge` | Conflict → D4 | No |
| J5 | Private storage, temporary links | **A** | Signed links with 60-second life (`storage/index.ts:30`) | `files`, `boundary` | Real S3 not tested (REG A-15) | No |
| J6 | Virus scan, quarantine, manual clearance | **B** | ClamAV integration in `scanner.ts`, quarantine, clearance | `security-phase-b` | **No scanner configured** in the development setup (REG A-07); server not assessed | No |
| J7 | 7 named scan states | **D** | `not_scanned`, `clean`, `infected`, `scan_failed`, `manually_cleared` (`0033:24`) | same | No Scanning, Quarantined or Manual Review states; quarantine may be a behaviour rather than a state | Yes |

## K. Country workflows

| ID | Requirement | Status | Existing implementation | Gap → required action | DB change |
|---|---|---|---|---|---|
| K1 | Configurable workflows for each named country | **B** | `workflow_definitions` supports country and course. Dev DB has Default, Russia, Georgia, Germany; none for Bulgaria, Egypt and others | Mechanism exists; real definitions missing (D11) | Data |
| K2 | Bonafide mandatory where configured | **B** | `bonafide_certificate`, rule approved for Qatar → Varna; others are placeholders | Real rules needed | Data |
| K3 | PCC at visa stage | **B** | Document type `police_clearance`, category `visa`; `visa_application_country_id` exists | No rule in code tying order to letters or ministry documents | Maybe |
| K4 | PCC timing (India about 2 months, elsewhere at least 1 month) and issuing country validated | **E** | No PCC logic found (SRC) | New rule | Maybe |

## L. Finance

| ID | Requirement | Status | Existing implementation | Tests | Gap → required action | DB change |
|---|---|---|---|---|---|---|
| L1 | INR, USD, EUR, rate and date, preserved history | **A** | `exchange_rate`, `inr_amount`, `payment_rate_changes` | `multi-currency` | None | No |
| L2 | Receipts | **A** | `payment_receipts`, `/receipts/[id]` | `multi-currency` | None | No |
| L3 | Paid, balance, history, permissions, audit | **A** | `student_balances`, `payments.*`, second-person verification | `multi-currency`, `security-matrix` | None | No |
| L4 | Due dates | **E** | `payment_entries` has `entry_date` only (SRC). Instalment plans also absent (REG F-07) | none | Add due date to charges | Yes |
| L5 | MD and Finance visibility | **A** | `payments.read`; CEO no-amounts behaviour (REG) | `multi-currency` | None | No |
| L6 | "Split" | **F** | `ledger` separates service and third party, plus `recipient_entity_id` | not confirmed | Meaning of split is unclear (D12) | Unknown |
| L7 | Finance reports | **B** | `balances` report and exports | `reports.export.finance` | Limited set | No |

## M. Dashboards

| ID | Requirement | Status | Existing | Gap → required action | DB change |
|---|---|---|---|---|---|
| M1 | Business | **B** | `(app)/page.tsx`, `managementAnalytics`, `charts.tsx` | Confirm each KPI when building | No |
| M2 | Finance | **B** | Payment summaries | No dedicated dashboard | No |
| M3 | Employee (present, absent, late, tasks) | **E** | Attendance missing; `staffOverview` covers workload only | After module E | No |
| M4 | Operational | **B** | `getDashboard`, documents and deadlines | No verification-request figures until G | No |

## Phase 4 security

| ID | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| S1 | Password storage | **A** | Argon2 (SRC) | None |
| S2 | MFA | **A** | TOTP, enforced unless relaxed by `MFA_ENFORCE` (`mfa.ts:139`) | |
| S3 | Login protection | **A** | Lockouts and rate limits, `0035` (TEST) | No edge rate limit (REG A-06) |
| S4 | RBAC and isolation | **A** | RLS, matrix (TEST). REG A-03 says 173 SECURITY DEFINER functions executable by PUBLIC | Re-check A-03 |
| S5 | Sessions | **B** | Sign out everywhere (SRC) | Self-service device list not confirmed |
| S6 | Scanning | **B** | See J6 | Scanner |
| S7 | Alerts | **B** | `security_alerts` (SRC) | Mail re-send defect E-3/F-7 (REG) |
| S8 | Backups | **F** | `db:backup` expects pg_dump 17 and PostgreSQL 17 clients | No automation in repo; not assessed on the server |
| S9 | Restore testing | **F** | Drill 31/31 on 1 Nov, local only (not re-run) | Not assessed on the server |
| S10 | Staging | **E** | None in repository | Needs decision |
| S11 | CI and monitoring | **E** | None in repository (REG A-08) | Needs setup |
| S12 | Deployment security | **F** | Nginx, firewall and env | Out of scope for this local report |

## N. Email delivery (defects found in current source)

| ID | Requirement | Status | Evidence | Gap → required action | DB change |
|---|---|---|---|---|---|
| N1 | Test mode must not send real system email | **C** | `sendEmail` has no mode check (`email.ts:81-93`) | Add a mode check; tests | No |
| N2 | Valid addresses, including apostrophes, can be emailed | **C** | Re-tested today: form validation accepts `o'brien@…`, the sender's check refuses it (`email.ts:21`) | Align the checks; review alert re-send | No |
| N3 | Server with only Resend settings keeps emailing | **C** | Nodemailer code has no Resend path | Decide fallback or a clear failure | No |
| N4 | Queued mail sends with SMTP settings | **A** | `system-mail`, `system-mail-flows`, queue suites with mocked transport. No real mail server used | None locally | No |


## 5. Defects

| ID | Severity | Defect | Evidence |
|---|---|---|---|
| N1 | **Critical** | Test mode doesn't stop system email | Source |
| N2 | High | Apostrophe addresses pass the form and then fail to send | Re-tested today |
| N3 | High | A Resend-only server stops sending system email | Source |
| H4 | High | University Application blocks, against the MD decision | Source and test |
| R-1 | Medium | Hard-coded role keys at `(app)/page.tsx:32`, `students/[id]/page.tsx:284` | Source |
| R-2 | Medium | Overdue ignores time of day (`svc/tasks.ts:32`) | Source; design limit |
| R-3 | Medium | Alert re-send loop; cron `processQueue` without `.catch`; portal errors unmasked | REG; re-verify |
| R-4 | Medium | 173 privileged functions executable by PUBLIC. **Separate and higher: `erp_app` raw-SQL risk, High with Critical impact, in `ERP_APP_TRUST_BOUNDARY_REVIEW.md`** | Local database |
| R-5 | Low | Stale documents, including `DEPLOYMENT.md` (Vercel-focused) and `LIMITATIONS_AND_ROADMAP.md`; `db:backup` assumes version 17 | Source |

## 6. Readiness by roadmap phase

| Phase | Ready? | Waiting on |
|---|---|---|
| Local clean-up | **Yes** | Your approval |
| 1 Notifications, secure files | **Yes**, after clean-up | Scanner choice affects only real scanning |
| 2 Employee Profile | **Yes**, after Phase 1 | Defer per-person overrides? |
| 3 Attendance | Not yet | Offices, hours, grace, leave types, approvers, selfie retention, legal review |
| 4 Tasks | Not yet | Priority and status mapping, verifier |
| 5–7 Meetings, Chat, Pre-Admission | Not yet | Privacy, retention and numbering decisions |
| 8 Portal tickets | **Mostly** | Visa status decision |
| 9 Preferences, rules | Partly | Official rule sources |
| 10 Finance | Not yet | Meaning of "split"; instalments |
| 11 Dashboards | Later | Earlier phases |

## 7. Proposed next step (not started)

**Local clean-up,** all on a new branch with tests, and no deployment:

1. Fix N1, N2, N3.
2. Re-verify R-3, and fix what is confirmed.
3. Passport warning-only through one small migration with a rollback, and update the old test.
4. Add tests: registration with expired or missing passport, including import.
5. Commit the audit documents.

**Optional:** a CI workflow file (R-4 can follow with Phase 1).

Then Phase 1. Deployment and any server work stay separate decisions.
