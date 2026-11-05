# Production Breaking-Change Audit

**Date:** 5 November 2026. **Status:** read-only audit, nothing fixed and nothing deployed.

**Handling: keep private, out of Git.** This report records open risks at summary level. It contains no credentials, attack steps or server addresses. It is untracked, and `.gitignore` does not cover `docs/`, so it needs a decision before any commit.

## A. Executive verdict

**INSUFFICIENT EVIDENCE – PRODUCTION COMPATIBILITY NOT VERIFIED.**

**The actual Production baseline could not be established.** Nobody has confirmed the commit, migration count, database contents, environment settings, scheduler or backups on the VPS. Everything said below about Production is reasoned from the repository and from throwaway test databases. Passing local tests does not prove Production compatibility.

What the evidence does show:

| Question | Answer | Evidence |
|---|---|---|
| Does the new code work against the current Production schema? | **No.** Every staff page tested returned HTTP 500 | Executed, R3 |
| Does `/api/health` warn you when that happens? | **No.** It stayed at 200 | Executed, R3 |
| Does the old code keep working on the new schema? | **Yes, on fictional data.** The only failures are explained below | Executed, R2 |
| Do the migrations destroy or alter existing business records? | **Not by design.** The only change to existing rows is passport rules from `block` to `warn` (0038) | Source review; not rehearsed on real data |
| Is there a defect in the new work that affects business figures? | **Yes.** A student merge produces false "unpaid" amounts on due dates | Executed, BC-03 |
| Is every rollback lossless? | **No.** Rolling back deletes all data held in the new modules | Source review and rollback tests |

Not safe to deploy to Production. It is also not yet ready for staging: BC-03 should be fixed first and the items in section I settled.

### How this audit was run

- No project file changed except these two reports. All 209 uncommitted entries are still there (`git status` count re-checked: 209, `git diff HEAD` still 82 files, +1515/−180), plus these two new files.
- No connection to the VPS or production. No commit, push, install or configuration change. The development database and the servers on ports 3000 and 4000 were not touched.
- **Please note one disclosure.** You told me not to execute migrations against any database, and also allowed tests on disposable databases. The test tools build their throwaway database by running the migration files, so migrations did run, and only there: fresh, temporary instances with fictional data, in scratch copies outside the project. No existing database received one. I deliberately did not rehearse an upgrade on a copy of real or development data, so that remains NOT VERIFIED.

## Baseline

| Item | Value | Label |
|---|---|---|
| Branch | `cleanup/local-readiness` | Verified |
| HEAD | `3df4171` (same as `refactor/express-api`) | Verified |
| Original baseline | Local `origin/main` ref `eb8dd7d`, which is **stale**. An earlier report recorded remote `main` as `d123404`, with files identical to `3df4171` | Stale ref verified; remote not re-checked in this audit |
| Reported Production | `main` at `f36328f`, 37 migrations, PostgreSQL 18 | **Reported, not verified** |
| Working tree | 209 entries: 82 modified, 127 untracked, 0 staged, 0 deleted | Verified |
| Tracked change | 82 files, +1515/−180. Application subset 53 files, +966/−131 | Verified |
| New migrations | 13 (0038 to 0050), each with a rollback, all untracked. 0001 to 0037 unmodified | Verified |
| SQL functions | 168 new; 3 existing replaced: `set_staff_status`, `save_advisory_notice`, `student_advisories` | Verified, by scanning migration files |
| API routes | New: `GET /api/chat/sync`, `GET /api/secure-files/:id`. None removed or renamed | Verified |
| Frontend routes | 28 new pages and route handlers. None removed | Verified |
| Dependencies | **None changed.** `package-lock.json` unchanged since `f36328f`; only 2 scripts added | Verified |
| Configuration | `.env.example` comments and mail settings; `next.config.ts` allows geolocation for the site itself; new `.github/workflows/ci.yml` (no secrets, no server access) | Verified |
| Tests | 16 new backend and 10 new frontend test files or helpers; 13 existing backend test files changed | Verified |
| Work predating this implementation | Cannot be separated by Git, since nothing is staged. By file date, 57 entries date from 4 Nov and 189 from 5 Nov. The 4 Nov group is the passport and email work | File dates only |

### Three different comparisons

| | Meaning | Result |
|---|---|---|
| **A. Against Git** | Working tree against `3df4171` | 82 changed, 127 new |
| **B. Against reported Production** | Working tree against `f36328f` | The above, plus `f36328f..3df4171`: 50 files, +1464/−146, no migration or package change. Backend source there: only `email.ts`. The rest is responsive UI, tests and documents |
| **C. Unknown** | Real Production impact | Anything depending on actual rows, custom roles, environment values, scheduler, file storage or Node and PostgreSQL versions |

## B. Breaking-change register

Severity reflects harm to the existing Production ERP.

| ID | File or object | Existing behaviour | New behaviour | Impact | Severity | Evidence | Recommended action |
|---|---|---|---|---|---|---|---|
| BC-01 | `(app)/layout.tsx` and services, against schema 0037 | Staff pages work | Layout always queries `staff_notifications`; tasks, payments and student pages use other new objects | **A code-only deployment takes down all staff pages.** Sign-in itself succeeds and the student portal landing page loads, and `/api/health` still returns 200, so a health check would not catch it | **Critical if deployed in the wrong order** | R3: MD, manager, finance, counsellor × 7 pages, all 500 | Migrations must go first. Add a signed-in smoke test to deployment. No code fix proposed here |
| BC-02 | Production baseline | Reported `f36328f` | Unknown | Every other conclusion depends on it. PostgreSQL 18 (reported) has never run this work; tests use 17.11 | **High** | `docs/audit/PRODUCTION_STATE_REPORT.md` | Establish it read-only on the VPS, with your separate authorisation |
| BC-03 | `app.merge_students` (0003) with `payment_due_dates`, `payment_due_status`, `payment_due_reminders` (0050) | Merge moves all payments to the surviving student | Merge moves the charge, not its due date | **A fully paid charge shows ₹50,000 unpaid on the merged record, is not shown on the surviving record, and can raise a false overdue reminder and email to everyone with `payments.record`.** The ledger and balances themselves stay correct | **High** (new feature; no effect until due dates and a merge both exist) | Executed on throwaway DB. Unpaid before merge: 0.00; after: 50000.00; rows shown on survivor: 0. Reminder source has no merged check | Fix before staging |
| BC-04 | Same merge with `student_preferences`, `student_tickets`, `dvr_requests.linked_student_id` | Not applicable | Merge function does not re-point them | After a merge, a student's preferences, tickets and DVR link stay on the merged record | **Medium** | Source only. My probe could not create these rows, so this was **not executed** | Fix with BC-03, and test |
| BC-05 | 0038 on `passport_validity_rules` | Global and registration-stage rules can block | They become warnings, on every matching row | Intended MD decision. Any rule Production holds that is not in the repository also changes. Also takes effect for the old app | **Medium** (business rule) | Source; R2 shows old app now warns, and 2 old tests fail for this reason | Read-only list of Production rules before migrating |
| BC-06 | `set_staff_status`, `staff_notifications` triggers, cron | No employee notification emails | Task, document and reminder events create real emails once mail and scheduler run | New email to staff starts immediately. Bounded: stale queue entries are skipped after 24 hours, and emails hold no personal data | **Medium** | Source | Tell staff first; watch the first day |
| BC-07 | `lib/email.ts` | At `f36328f`, test mode did not stop system email | Unless the mode is exactly `live`, invitations, staff resets and security alerts stop silently (reset link wiped) | **Only matters if Production runs with `APP_ENV=staging`.** A true production build already refuses to serve unless the mode is `live`, at `f36328f` too | **Medium, unverified** | Unit tests; `notifications-config.ts` at `f36328f` | Confirm `NODE_ENV`, `APP_ENV`, `NOTIFICATIONS_MODE` on the VPS |
| BC-08 | Committed `main` / `3df4171` email | Resend at `f36328f` | `3df4171` is SMTP only, rated NOT READY. **The working tree restores Resend as a fallback, but it is uncommitted** | If someone pulls `main` on the VPS today, a Resend-only server stops sending system email | **High, existing and independent of this work** | Previous readiness audit; source | Do not pull `main` onto the VPS |
| BC-09 | 0039, 0043 triggers on `tasks`, `task_comments`, `student_documents`, `document_files` | Plain writes | Extra work inside each write; `tasks` gains a BEFORE trigger | Old and new writes passed in R2. Notification errors are swallowed in `staff_notify`, which protects the write but can hide missing notifications. Direct `submitted` status is refused | **Medium** | R2 and source; helper lookups outside `staff_notify` are simple but not error-guarded | Monitor warnings on staging |
| BC-10 | Role grants in 0040, 0042, 0044, 0045, 0046, 0048, 0049 | No such access | Existing roles gain permissions. **Finance, Visa, Documentation and Counsellor can read and answer questions from students they can see** | Additive only, but it is new data access. Custom Production role edits are unknown | **Medium** | Source | Your decision; confirm the grant list |
| BC-11 | `update_my_profile` (0041) | Employees could not edit their own details | An employee can set their display name, which overwrites `full_name` shown across the ERP, and their phone | Someone can rename themselves on records others rely on. Row audit does keep before and after | **Medium** | Source | Your decision: approval step or not |
| BC-12 | `provision.ts`, `defaults.ts` | | Running provisioning adds designations and Bulgaria document rules **marked verified**. Migrations alone do not add those rules | Whether they appear depends on whether provisioning runs in the deployment | **Medium** | Source | Decide, and put it in the deployment plan |
| BC-13 | Task overdue logic | `due_date < current_date` | Task pages use date and time through `app.task_deadline`; dashboard still uses the date rule | Task page and dashboard can briefly differ. First tick also marks open tasks overdue from the last 3 days and adds events | **Low** | Source | Note for UAT |
| BC-14 | Labels and defaults | "Not started", "Urgent", "Normal", "Terminate employment" | "Pending", "Critical", "Medium", "Deactivate". Archived staff hidden from the default list. "Full name" labelled "Display name" | Stored values unchanged. Staff need telling | **Low** | Source | Tell staff |
| BC-15 | `(app)/page.tsx` | Leadership view by role key `md`, `ceo` | By permission `dashboard.consolidated` | Same for default roles. Differs if a custom role holds that permission | **Low** | Source | Check Production roles |
| BC-16 | `balances` report and CSV, cron JSON | Fixed columns | Extra fields added | Harmful only to a consumer reading by position. None known | **Low** | Source | Ask if anything imports these |

**Checked, no break found:** no route, page, table, column or function removed. Applied migrations unmodified. The three replaced functions are additive: `set_staff_status` adds `archived`; `save_advisory_notice` adds an optional field; `student_advisories` now calls a shared function with the same results asserted across rollback. `updateStaffDetails` could blank fields absent from a form, but its only caller sends them all. `.env.example` requires no new mandatory variable. The hard-coded `manager` check in the student page predates this work.

**Existing tests changed to fit behaviour:** I read every edit. Passport expectations were reversed, in line with the MD's 4 Nov decision. Pinned policy counts moved to one shared constant. System email expectations changed, in line with the deliberate test-mode fix. Everything else adds tests. I found no assertion weakened to hide a defect.

## C. Database migration safety

Run per file, each in its own transaction, in order. A failure stops at that file and leaves earlier ones applied. **No migration sets `lock_timeout`**, and none uses `CONCURRENTLY` or `NOT VALID`. The runner refuses if an already applied file's checksum differs, which is a useful stop if Production has drifted.

| # | Changes | Existing data impact | Locking risk | Rollback | Production compatibility | Verdict |
|---|---|---|---|---|---|---|
| 0038 | Passport rules `block`→`warn` | **Changes rows**, audited | Low | Yes, exact, tested | Old app works, with warnings | Caution: BC-05 |
| 0039 | 2 new tables; 4 triggers on existing tables | None | Brief, strong locks on 4 busy tables | Yes, tested | Works with old app (R2) | Conditional |
| 0040 | 2 tables, permissions | Adds grants | Low | Yes | Works | Conditional |
| 0041 | `user_profiles` +11 nullable columns; status check replaced; trigger; `memberships.designation_id` | None. Check re-validated by scan | **Exclusive lock on the table read on every request.** Small table, short | Yes. Archived → terminated | Works | Conditional |
| 0042 | 8 tables | None | Low | Yes; drops attendance data | Works | Conditional |
| 0043 | `tasks`: status check, 15 columns, ordinary index, BEFORE trigger | None. Constant defaults mean no rewrite | **Exclusive lock; index build blocks task writes.** Depends on row count, unknown | Yes. Submitted → in progress; columns dropped | Works | Conditional |
| 0044 | 7 tables | None | Low | Yes; drops meetings | Works | Conditional |
| 0045 | 6 tables | None | Low | Yes; drops chat | Works | Conditional |
| 0046 | 6 tables | None | Low | Yes; drops DVR | Works | Conditional |
| 0047 | 6 tables; history check and guard | None | Low | Yes; archive kept | Works | Conditional |
| 0048 | 4 tables; `portal_notices` check | None | Brief, exclusive | Yes; drops tickets | Works | Conditional |
| 0049 | 4 tables; `advisory_notices.intake_id`; 2 functions | None | Brief | Yes; drops preferences | Works | Conditional |
| 0050 | 1 table, 1 view, 2 functions | None. No ledger change | Low | Yes; drops due dates | Works | Conditional; **BC-03** |

No `DROP` statements, type changes, new `NOT NULL` on existing columns, or renames on existing tables. Scans for conflicts: the replaced checks only widen allowed values, so existing rows cannot violate them.

**Rollback was tested, on fictional data only**, including the chain 0050 back to 0039. **Rollback does not remove stored file contents:** `secure_files` rows go, but the files stay in storage, unreferenced and sensitive. This needs a clean-up step.

**"Conditional" means** on a verified backup, in a quiet window, after staging. No table rewrite, but actual lock times on Production are NOT VERIFIED. Run `ANALYZE` after migrating; without statistics, one dashboard load took 12.6 s instead of 0.9 s on a test database.

## D. Existing ERP regression matrix

R1 means newly executed by this audit on a copy identical to the working tree. Fictional data only.

| Module | Existing functionality | Changes affecting it | Regression tests | Result | Remaining risk |
|---|---|---|---|---|---|
| Staff login, MFA, sessions | Sign-in, two-step, lockout | Layout additions only | `phase-a`, `security-phase-b`, `n1-lockout`, `staff-accounts` | Pass, R1 | Production settings unverified |
| Student login | Code and password | None to auth | `n8-auth-messages`, `phase-6-portal`, `phase-i` | Pass, R1 | Real email unproven |
| Student registration | Register, photo, consent | Passport warning text | `workflow`, `phase-2`, `student-photos`, scenarios A to L | Pass, R1 | |
| Existing student profile | Tabs | Preferences, DVR links, due dates | `workflow`, `phase-b`, responsive | Pass, R1 | Any of these missing = BC-01 |
| Documents | Upload, download, approval | Triggers | `workflow`, `document-merge`, `isolation` | Pass, R1 | One old browser test fails with or without the migrations; see section J |
| Passport warning | Stages | 0038 | `phase-2`, `phase-3b`, `passport-warning-policy` | Pass, R1 | BC-05 |
| Admissions | Stages, rules | `student_advisories` shared | `phase-3`, `phase-4`, scenarios | Pass, R1 | |
| Finance | Ledger, verify, receipts | Added due dates; no ledger change | `multi-currency`, `workflow`, `phase-10` | Pass, R1 | **BC-03** |
| Employee management | Staff, status, roles | `set_staff_status`, profile | `staff-accounts`, `staff-profiles`, `phases-2-5` | Pass, R1 | BC-11 |
| Tasks | Assign, update, reassign | Lifecycle trigger, columns | `phase-4-task-lifecycle`, `phases-2-5` | Pass, R1 | BC-13 |
| Reports and dashboards | Exports, analytics | Added tiles and reports | `phase-11`, `workflow` | Pass, R1 | Real-data performance |
| Company isolation, roles | RLS, permissions | New grants | `isolation`, per-phase refusal tests | Pass, R1 | BC-10 |
| Attendance, Meetings, Chat, Pre-admission, Tickets, Preferences | New | New | `phases-2-5`, `phase-6`, `phase-7`, `phase-8`, `phase-9` | Pass, R1 | Section 4 |

## Phase-by-phase review

| Phase | Modules reused; existing files changed | APIs | SQL functions | Rules affected | Could break an existing workflow? | Records and permissions preserved | Regression | Unverified assumptions |
|---|---|---|---|---|---|---|---|---|
| 1 Notifications, secure files | Audit, storage; `layout`, `files.controller`, `files.routes`, `storage`, `dispatcher`, cron | `GET /api/secure-files/:id` added | New, with triggers on 4 tables | None | Yes, BC-01 and BC-09 | Yes; no new policies on old tables | R1 | Mail and scheduler |
| 2 Employee profile | `admin.ts`, admin forms, `validation` | None | `set_staff_status` replaced | Self-edit | BC-11 | Yes; history kept by row audit | R1 | Designations by provisioning |
| 3 Attendance | Secure files | None | New | Figures await your settings | Not existing work | Yes | R1 | Location on HTTPS and real phones |
| 4 Tasks | `tasks.ts`, task pages | None | New, trigger | Overdue, review | BC-09, BC-13 | Yes | R1 | Row counts for lock time |
| 5 Meetings | Tasks | None | New | Attendee privacy | Nav query in layout only | Yes | R1 | Access decision |
| 6 Chat | Secure files | `GET /api/chat/sync` added | New | Oversight | Not directly; polling load | Yes | R1 | Scaling, legal review |
| 7 Pre-admission | Secure files; student page | None | New | Preliminary only | Student page query, BC-01 | Yes | R1 | Merge, BC-04 |
| 8 Tickets | Portal notices; `portal/home` | Portal file route added | New; notice check widened | New staff access | No, once migrated | Yes | R1 | BC-10, unscanned student uploads |
| 9 Preferences, rules | `requirements.ts`, advisories | None | 2 replaced | Rule verification | Advisories: rollback test passes | Yes | R1 | BC-04, BC-12 |
| 10 Finance | `payments.ts`, `tab-forms` | None | New | Display rule, oldest first | **BC-03** | Ledger untouched, tested by hash | R1 | Your decision on settlement order |
| 11 Dashboards | `analytics`, `reports` | None | None new of note | Reports added | Dashboard needs new objects, BC-01 | Yes; exports checked | R1 | Performance with real data |

## E. Deployment compatibility

See `docs/PRODUCTION_DEPLOYMENT_COMPATIBILITY_MATRIX.md`. In short: **application code alone breaks staff pages; migrations first is compatible on fictional data; nothing has been tried on real data.**

## F. Data integrity report

Based on source review and tests on fictional data. Production data has not been seen.

| Records | Deleted? | Values changed? | Reassigned or duplicated? | Relationships | Totals or access |
|---|---|---|---|---|---|
| Students | No | No | No | New optional links only | |
| Employees | No | No | No | New nullable columns | Display name editable later, BC-11 |
| Student documents | No | No | No | Trigger adds notifications only | Unchanged |
| Passport information | No | No. Only rule settings change | No | | Warn instead of block |
| Admission applications | No | No | No | | |
| University preferences | No | Stay on the merged record after a merge, by source (BC-04) | No | | |
| Payments and receipts | No | No. Rollback test hashes all entries | No | | **Ledger correct; due-date "unpaid" wrong after a merge, BC-03** |
| Attendance, chat, new tasks data | New; **lost on rollback** | | | | |
| Existing tasks | No | First tick may set `overdue_at`, adds events | No | | Task counts differ slightly, BC-13 |
| Audit logs | No; added to | No | No | | |

Ownership is not changed. Documents remain accessible, as old and new document tests pass. **All of this is NOT VERIFIED against Production rows.**

## G. Security risk report

**The ERP is not described as fully secure.** No authentication redesign is proposed, and the trust boundary has not been fixed.

### Existing risks, not introduced here

| Severity | Risk | Note |
|---|---|---|
| Critical | **Trust boundary unresolved** | Recorded, not fixed. Postponed by your decision |
| High | Older definer functions open to PUBLIC (173, from the earlier report) | Unchanged |
| High | Production backup and recovery unproven | NOT VERIFIED |
| Medium | Security documents already committed | Earlier report lists them |

### Risks made larger or introduced by this work

| Severity | Risk | Note |
|---|---|---|
| High | **Virus scanner absent, with more ways in:** student ticket attachments, chat, DVR, tasks | Labelled unscanned, not blocked. Cron's rescan also covers new files once a scanner exists |
| High | **Sensitive documents could enter Git:** 127 untracked entries include private reports, and `docs/` is not ignored | Automated scan of to-be-committed files for common key patterns found none; this does not prove absence |
| Medium | The trust boundary now covers more data: 50 new tables under the same database identity | Same weakness, more behind it |
| Medium | New access for existing roles, BC-10; self-service name change, BC-11 | Your decisions |
| Medium | Attendance photos and location; chat oversight | Legal review and employee notice not confirmed |
| Medium | Notification errors are swallowed in `staff_notify` | A wrong link was silently dropped once already |
| Medium | Chat polling, about 60% of requests in earlier measurements; added queries per page; no load test | Scaling NOT VERIFIED |
| Medium | Scheduler dependency: reminders, queued mail, retention | Server schedule unverified |
| Low | Unreferenced files stay after a rollback | Section C |

### Checked, no new weakness found

Argon2id, MFA, sessions and cookies were not changed. New tables have row-level security, new definer functions have a fixed `search_path` and PUBLIC removed, and the SQL guard reports 0 unapproved findings. Provider errors are now masked before storage, and test mode now stops system email; both are improvements. **Tested locally only. No external penetration test.**

## H. Recommended deployment sequence (not executed)

1. Make safe copies of the uncommitted work. It exists on one Mac. Decide which private documents stay out of Git first.
2. With your separate authorisation, establish the baseline read-only: commit, migrations, versions, roles, passport rules, environment names, scheduler.
3. Fix BC-03 and BC-04. Decide BC-10, BC-11 and BC-12.
4. Build a staging copy with fictional or approved data. Verify a backup by restoring it.
5. On staging: migrations 0038 to 0050 → `ANALYZE` → **confirm the old app still works** → new app and API → signed-in smoke test, not only `/api/health`.
6. Prove real email, scheduler, scanner and rollback on staging, and time the locks.
7. UAT with real phones and Safari.
8. Production, only with your approval: tell staff; quiet window; verified backup; stop if any applied checksum differs; migrate; `ANALYZE`; check old app; deploy application; smoke test; watch the first day of email.

## I. Final recommendation

| | |
|---|---|
| **Safe, on current evidence** | Additive schema design; no dependency change; old app on the new schema (fictional data); Git state preserved |
| **Not safe** | Code-only deployment. Pulling `main` onto the VPS (BC-08). Any Production step before the baseline and backup are verified |
| **Must be fixed** | BC-03, and BC-04 with it. Before Production, a clean-up plan for files left after rollback |
| **Business decisions** | Passport rule list (BC-05); staff emails (BC-06); ticket access (BC-10); self-service names (BC-11); Bulgaria rules (BC-12); plus the 12 decisions in the readiness report |
| **Staging must verify** | PostgreSQL 18; real-size lock times; real email; scheduler; file storage; `ANALYZE` effect; old app after migration; rollback |
| **Before Production** | Everything above, plus the Security Hardening stage, a working scanner, proven backup and restore, monitoring and UAT sign-off |

## J. Test evidence

**Previously passed (final regression, not relied on):** backend 651 + 12, frontend 131, browser 173.

**Newly executed in this audit:**

| Run | Setup | Result |
|---|---|---|
| R1 | Working tree copy | Typecheck, lint, build pass. SQL guard 364 files, 22 findings, 0 unapproved. Backend 651 + 12. Frontend 131. Browser **173 of 173**. Evidence in the scratch copy |
| Merge probe | Working tree copy | Confirmed BC-03. Preference and ticket rows could not be created by the probe |
| R3, code only | New code, schema 0037 | 4 staff roles × 7 pages: **all HTTP 500**. Sign-in, portal landing page and `/api/health` respond. Errors name `staff_notifications`, `due_at`, `payment_due_status`, `dvr_requests` |
| R2, migrate first | Code `f36328f`, schema 0050 | Backend 369 of 374; Frontend 119 of 119; Browser 56 of 57 |
| Control | Code `f36328f`, schema 0037 | Browser 56 of 57, **the same one test** |

**R2's 6 failures, explained:**
- 3 backend tests pin the number of policies to 149, and the new schema has 202. Expected.
- 2 backend tests assert that passports block, and 0038 makes them warn. This is the MD's decision.
- 1 browser test (unscanned file) fails the same way in the control. Its lookup for a suitable unscanned file finds nothing in that test order. The control shows the new schema does not cause it; I did not investigate it further.

**Workflows you listed, all executed in R1, on fictional data:** staff login, student login, student registration, existing student profile, document upload and download, passport warning, admissions workflow, finance workflow, employee profile, tasks, attendance, meetings, chat, pre-admission, tickets, preferences, dashboard, company isolation, role permissions.

**Not executed:**

- Upgrade on a copy of real or development data
- Anything on PostgreSQL 18
- Real email or real payment activity
- Virus scanner
- Server scheduler
- Production build served end to end with production settings; only `next build` ran, and browser tests use development mode
- Real phones or Safari; load
- New frontend with old API and old frontend with new API, as separate processes; reasoned only
- Signed-in student portal in R3
- Old backend test control on schema 0037; its failures are explained by inspection

**Blocked by unavailable access:** all VPS checks.
