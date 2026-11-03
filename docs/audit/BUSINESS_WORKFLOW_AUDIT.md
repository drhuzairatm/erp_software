# Business workflow audit

**Date:** 2 November 2026 · read-only · fictional data only.

**Status values:** Verified · Partially Verified · Failed · Not Tested · Blocked. Finding IDs refer to CONSOLIDATED_FINDINGS_REGISTER.md.

**How it was verified.** Integration tests ran **today** on the throwaway test database (`.data/pg-test`, port 54339, fictional seed). They never touch the development database. Run results:
- `npm run check` run: 359 of 363 passed.
- Verbose re-run: 362 of 363 passed.
- The failures are listed in A-01. None of them are in the workflow tests below.

Browser tests were **not re-run today**, because they write records to the development database (L-5). The last browser run was on **1 Nov 2026**, against the current source (only documents changed since): **57 of 57 passed** [PRIOR]. A "Verified" status here means an automated test of that behaviour passed. It does **not** mean the workflow was tested with real staff, real providers or a real host.

## A. Authentication and account management

| Item | Status | Evidence | Note |
|---|---|---|---|
| Sign-in: MD, Admin, CEO, Manager, staff | Verified | `phase-a.test.ts`, `security-matrix.test.ts`, `auth-rate-limits.test.ts`; e2e `phase-a`, `staff-accounts` [PRIOR] | Same sign-in for every role; the role decides access. |
| 2-step login (TOTP) | Verified (integration) / Partially (browser) | `mfa.test.ts`, `phase-b.test.ts` | Development runs `MFA_ENFORCE=off`; production always enforces it [SRC]. |
| Password reset | Verified | `staff-email-outbox.test.ts`, `auth-rate-limits.test.ts`; e2e `n1-lockout` [PRIOR] | Real email delivery Not Tested (A-15). |
| Student email verification | Verified with N-8 working tree | `phase-2-passport-contacts.test.ts`, `auth-message-queue.test.ts` [RUN]; e2e [PRIOR] | N-8 not committed (A-01). |
| Session expiry (12 h absolute, 8 h idle) and revocation ("sign out everywhere") | Verified | [SRC] `session.ts:13`, `0001`/`0012` idle check; `phase-a.test.ts` | |
| Trusted browsers | Verified | `auth-rate-limits.test.ts` | |
| Invitations, suspension, termination, reactivation | Verified | `staff-accounts.test.ts`, e2e `staff-accounts` [PRIOR] | Invitation emails are not queued or retried (F-08). |
| Protected MD (only one MD; cannot be granted in the app) | Verified | [SRC] `0032:220-238` trigger; `staff-accounts.test.ts` | |

## B. Employee management

| Item | Status | Evidence |
|---|---|---|
| Registration, employee ID, department, designation, reporting manager, company and role assignment | Verified | `staff-profiles-roles.test.ts`; e2e `staff-profiles` [PRIOR] |
| Staff photo upload and avatar | Verified | e2e `staff-profiles`, `photo-capture` [PRIOR] |
| Camera capture, desktop and phone | **Partially Verified** | e2e `photo-capture.spec.ts` uses a **simulated** camera in Chrome. Real iPhone and Android: Not Tested (A-10). |
| Suspension, termination and task hand-over after departure | Verified | `staff-accounts.test.ts` (Phase A task hand-over) |

## C. Roles and permissions (actual database grants, read today)

| Role (key) | Permissions | Key facts [DB] |
|---|---|---|
| MD (`md`) | 84 (all) | Protected; 2-step required; organisation-wide. |
| CEO (`ceo`) | 16 | `payments.status` only: **no amounts** (owner rule). Consolidated dashboard; reports and export. |
| System Admin (`system_admin`) | 7 | Users, roles, settings, departments, notifications settings, reference data, audit. **No student data permissions.** |
| Manager (`manager`) | 49 | Company-wide students, documents, approvals, `notifications.view`, payments read, reports incl. PII export. |
| Counsellor (`counsellor`, "admission staff") | 20 | Create and update students, sales stages, leads, consent, portal accounts. |
| Documentation (`documentation`) | 20 | Review, custody, publish, attestation, passport verify; **assigned students only**. |
| Finance (`finance`, "accounts staff") | 16 | Record, verify, reverse, disburse payments; finance export. |
| Visa (`visa`) | 16 | Visa stage; assigned students only. |
| Custom roles | Supported | `createRole` (`admin.ts:267`). Grants are restricted in the database: you can only grant a permission you hold yourself, and never to a role you hold (`0012:121-128`). |

**Direct URL and API access** (not only menus): **Verified.** `security-matrix.test.ts` and `db-isolation.test.ts` call services and SQL as each role; e2e `isolation.spec.ts` opens direct URLs [PRIOR]. The database policies (RLS, 89 of 90 public tables) enforce access even if a page is bypassed.

## D. Multi-company isolation

| Item | Status | Evidence |
|---|---|---|
| Edulinks / GRADUATER isolation, including IDOR by ID | Verified | `db-isolation.test.ts`, `security-matrix.test.ts`, `phase-c.test.ts` (isolation matrix), e2e `isolation.spec.ts` [PRIOR] |
| Shared students, company switching, staff in one or both companies | Verified | `services.test.ts`, `phase-c.test.ts` |
| Company-specific finance | Verified | `multi-currency.test.ts`, `phase-c.test.ts` |
| MD organisation-wide | Verified | security matrix |
| Security alerts per company | **Failed by design gap**: N-3 (cross-company if granted) | [DB] policy |
| Redacted sign-in rows per company (N-8) | Verified (working tree) | `auth-message-queue.test.ts` [RUN] |

## E. Student CRM

| Item | Status | Evidence |
|---|---|---|
| Registration, editing, phones (international), email, passport, citizenship, visa-application country, photo | Verified | `services.test.ts`, `phase-2-passport-contacts.test.ts`, `student-photos.test.ts`; e2e `workflow`, `phase-2-passport-contacts`, `student-photos` [PRIOR] |
| Destination country, course, preferred university and campus (single values) | Verified | `master-data.test.ts`, `document-merge.test.ts` |
| **Primary, secondary and tertiary** preferences | **Missing** (F-09) | [DB] no preference fields or table |
| Search, filtering, duplicate warning, change history (timeline and audit) | Verified | `services.test.ts:88-95`, e2e `workflow` ("duplicate phone warning") [PRIOR] |
| Merge of duplicate students | **Not Tested**: feature exists, no automated test (A-18) | [SRC] `app.merge_students` (`0003:415`), `students.ts:586` |

## F. Countries, universities and courses (master data)

| Item | Status | Evidence |
|---|---|---|
| Add, edit, activate and deactivate countries, universities and courses; requirements per country, university and programme | Verified | `master-data.test.ts`, `phase-3b-advisory.test.ts`; e2e `master-data` [PRIOR] |
| Changes do not corrupt history | Verified | `master-data.test.ts` (history and requests) |
| Academic requirements are **advisory and acknowledged, not blocking** | Verified | scenarios **H** (Bulgaria below requirement: warning, acknowledgement and task, never a block) and **I** (no invented Egypt requirement) |
| Real reference lists | **Blocked**: placeholders until supplied (PENDING OWNER CONFIRMATION) | [DOC] LIMITATIONS_AND_ROADMAP.md |

## G. Admissions workflows

The scenarios below ran **today** in `scenarios-a-l.test.ts`, all passed [RUN]:

| Scenario | Covers |
|---|---|
| A | Plus Two → **MBBS (Bulgaria)**: registration, checklist, academic record, approved document, fee |
| B | Plus Two → **Nursing (Germany)** workflow and documents |
| C | MBBS graduate → **Postgraduate medical** (graduate profile, internship, registration) |
| D | Missing certificates: not blocking; listed |
| E | Name mismatch → review (One and Same path) |
| F | No passport: University Application blocked until a passport exists |
| G | Expired passport: flagged, follow-up tasks, University Application blocked |
| H | Bulgaria below the academic requirement: advisory only |
| I | Egypt: nothing invented |
| J | One and Same: rule → checklist → template → request → verified |
| K | Document correction: returned with comment → new version → old checks reset |
| L | Attestation/apostille route for an India-issued document for Bulgaria |

**Destinations.** The development database lists Bulgaria, Egypt, Georgia, Uzbekistan, Kazakhstan, Philippines, Romania and others as active countries [DB]. Their **requirements are placeholders**: **PENDING OWNER CONFIRMATION**.

**Status:**
- Bulgaria, Germany (Nursing) and the generic stage flow: **Verified (fictional rules)**.
- Georgia, Uzbekistan, Kazakhstan, Philippines, Romania: **Not Tested** with country-specific rules, because no approved rules exist yet. Ministry and visa stages exist as generic stages.

## H. Document management

| Item | Status | Evidence |
|---|---|---|
| Upload, type and size validation, version history, review, reject, correction, re-upload, approval | Verified | `services.test.ts`, scenario K, e2e `workflow` [PRIOR] |
| Malware scan status, quarantine, manual clearance | Verified (logic) / **Blocked** (no scanner, A-07) | `phase-b.test.ts`, `audit-remediation.test.ts` (H-1) |
| Front/back scans | **Missing** (F-06) | [SRC] |
| PDF merge and preview; filename | Verified; **format PENDING OWNER CONFIRMATION** (see register §3 note) | `document-merge.test.ts`; e2e `document-merge` [PRIOR] |
| Download permissions and access history | Verified | `security-phase-b.test.ts`, `audit-remediation.test.ts` (bulk-access alerts) |
| One and Same; attestation and apostille | Verified | scenarios J and L; `phase-1-attestation.test.ts`; e2e `phase-1-attestation` [PRIOR] |
| Attestation evidence scan status | **Failed**: N-2 | [DB] |
| Physical originals: courier only after scan approval; receipt and reconciliation | Verified | `courier.test.ts`; e2e `courier.spec.ts` [PRIOR] |

## I. Student and parent portal

| Item | Status | Evidence |
|---|---|---|
| Password login, sign-in code, set-up and reset links (N-7) | Verified | `phase-6-portal-v2.test.ts`, `portal-link-queue.test.ts`, `portal-rate-limits.test.ts` [RUN] |
| Sign-in codes not visible to staff (N-8) | Verified in the working tree; **not committed** | `auth-message-queue.test.ts` [RUN]; e2e `n8-auth-messages` [PRIOR] |
| Dashboard, checklist, student upload, published documents (admission letters) with logged downloads, optional payment view, courier details | Verified | `phase-i.test.ts`, `phase-6-portal-v2.test.ts`; e2e `phase-i`, `phase-6-portal`, `courier` [PRIOR] |
| Courier instructions only after the required approval | Verified | `courier.test.ts` (an exception needs `courier.exception` and a reason) |
| Visa status in the portal | **Missing** (F-03) | |
| Parent upload, Ask a Question, ticket history | **Missing** (F-01, F-02) | |

## J. Finance

| Item | Status | Evidence |
|---|---|---|
| INR, USD, EUR; exchange rate per transaction; INR equivalent; audited rate corrections | Verified | `multi-currency.test.ts`; e2e `multi-currency` [PRIOR] |
| Entries, receipts, refunds, disbursements, reversal, second-person verification, pending balances | Verified | `services.test.ts`, e2e `workflow` ("finance verification requires a second person") [PRIOR] |
| CEO sees status but no amounts | Verified | `multi-currency.test.ts:95-101`, `phase-a.test.ts:70` [RUN] |
| Company-level isolation and audit | Verified | `multi-currency.test.ts`, `security-matrix.test.ts` |
| Instalment plans and payment reminders | **Missing** (F-07, F-05) | |
| Real payments | Not applicable: the ERP records payments; it does not take them (no gateway). | [SRC] |

## K. Tasks

| Item | Status | Evidence |
|---|---|---|
| Create, assign, reassign, priority, due date, complete, overdue view, manager and MD overview, workload | Verified | `services.test.ts`, `phase-a.test.ts`; e2e `workflow` [PRIOR] |
| Overdue **notifications** and reminders | **Missing** (F-05) | |
| Task audit history | Partially Verified: audit triggers exist [SRC]; no task-specific audit assertion found | |

## L. Notifications

| Item | Status | Evidence |
|---|---|---|
| Student and parent events (11), consent, templates, rules, test mode, retries, delivery failures | Verified on the clean test path; **intermittent failures** in `phase-h.test.ts` (A-01) | [RUN] |
| Password reset, portal links and sign-in codes kept secret from staff | Verified (N-1, N-7); N-8 working tree | [RUN] |
| Staff in-app notifications, payment reminders, task reminders | **Missing** (F-04, F-05) | |
| Real email and WhatsApp | Not Tested (A-15) | |

## M. Dashboards and reports

| Item | Status | Evidence |
|---|---|---|
| One dashboard page, adapted by permission: staff view versus management analytics (`dashboard.consolidated`, `reports.view`); fixed set of reports with exports (capped at 5,000 rows) | Verified | `phase-c.test.ts`, `services.test.ts`; e2e `phase-c` [PRIOR] |
| Separate dashboards per role (CEO, Admin, Admission, Documentation, Finance) | **Partially**: one permission-driven page, not separate role pages | [SRC] `src/app/(app)/page.tsx:26-31` |
| Counters reconciled against the development database | **Not Tested** today (A-17) | Reading record contents is outside this audit. |
