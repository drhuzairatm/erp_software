# Final ERP Implementation Report

**Date:** 5 November 2026. **Handling:** contains no credentials or server details. Sections A, B, E, F, H, I and K are here. C is in `FINAL_ERP_FEATURE_VERIFICATION_MATRIX.md`, D in `FINAL_ERP_BROWSER_TEST_REPORT.md`, G in `FINAL_ERP_SECURITY_AND_RISK_REPORT.md` and J in `FINAL_ERP_PRODUCTION_READINESS_REPORT.md`.

## A. Executive summary

All 11 phases are built and pass the final local regression. Nothing is committed, pushed or deployed, and production was not touched.

**Verdict: READY FOR STAGING, NOT PRODUCTION.**

| Measure | Result |
|---|---|
| Phases complete on what could be built locally | 5: Phases 2, 4, 5, 8, 11 |
| Phases partial, with a stated gap | 6: Phases 1, 3, 6, 7, 9, 10 |
| Phases not started | 0 |
| Backend tests | 651 and 12 migration tests passed |
| Frontend tests | 131 passed |
| Browser tests | 173 passed, all 23 required workflows included |
| Migrations | 0038 to 0050 on local development only |

**Blockers:** your decisions on attendance values, chat retention and finance "split"; server access for scanner, scheduler and email.

**Main risks:** the unresolved trust boundary; all work uncommitted on one machine; no virus scanner; production state unknown.

### Things you should know

1. **Migration order I did not keep to.** 0047 went on dev after its tests passed, although the recovery report said it would wait. 0046 and 0048 went on dev before the clean regression I had said would come first. That regression ran straight afterwards and passed. 0048 had no separate backup; backup `pre-0046b` covers it. You had required a verified backup only for 0046. 0049 and 0050 followed the proper order.
2. **The final regression was the second attempt.** The first attempt had 2 failures: a dashboard test timeout and a browser test reading too early. Neither was a product fault; causes are in sections E and H.
3. **Two serious bugs were caught by tests before the migrations were applied:** a permission check skipped by null logic, and a rollback that failed with real rows. Details are in the security report.

## B. Phase by phase

| Phase | Requirement | Existing | New | Database | Tests (backend, browser) | Status and gaps |
|---|---|---|---|---|---|---|
| 1 | Notifications, secure files | Student alerts, storage, simulated scanner | Staff notifications, bell, preferences, secure files | 0039, 0040 | 34, 1 | **Partial.** No scanner; scheduler unverified |
| 2 | Employee profiles | Staff accounts, photos | Profile fields and limited editing | 0041 | 13, covered | **Complete.** Per-person overrides deferred |
| 3 | Attendance | None | Check-in, breaks, signals, review, kiosk, reports | 0042 | 18, covered | **Partial.** Placeholder values; no overnight shifts; kiosk has no browser test |
| 4 | Tasks | Tasks | Lifecycle, submission, approval | 0043 | 14, covered | **Complete.** Status mapping needs confirmation |
| 5 | Meetings | None | Meetings, minutes, decisions to tasks | 0044 | 9, covered | **Complete.** Core Team needs confirmation |
| 6 | Chat | None | One-to-one, group, files, governance | 0045, 0047 | 24, 8 | **Partial.** Polling only; one attachment; forwarding text only; no load test |
| 7 | Pre-admission | None | DVR requests, review, return, re-verification | 0046 | 13, 4 | **Partial.** No prefilled conversion |
| 8 | Portal tickets | Portal | Tickets, replies, files, staff queue | 0048 | 10, 2 | **Complete.** No ticket emails |
| 9 | Preferences and rules | Requirements, advisories | Preferences, history, academic years, country rules | 0049 | 9, 2 | **Partial.** Country rules not added to checklist |
| 10 | Finance | Ledger, rates, receipts, verification | Due dates, reminders, reports | 0050 | 7, 1 | **Partial.** "Split" undefined |
| 11 | Dashboards and reports | Analytics, report engine | University, intake, employee, operations, new reports | None | 6, 1 | **Complete.** Limits in `PHASE_11_DASHBOARDS_AND_REPORTS.md` |

"Covered" means tested in `phases-2-5-workflows.spec.ts`. Phase details and files are in `docs/PHASE_*.md`. Phases 2 to 5 have no separate document; their open questions are in `docs/audit/IMPLEMENTATION_ROADMAP.md` (private).

**API:** no parallel APIs were added. New work uses the existing services and server actions, plus chat and file routes.

## E. Automated test summary

Commands ran on a clean copy of the working tree against a disposable database, using `backend` and `frontend` workspaces.

| Step | Command | Result |
|---|---|---|
| Install | `npm ci` | Pass |
| Typecheck | `npm run typecheck` | Pass |
| Lint | `npm run lint` | Pass |
| SQL guard | `npm run guard:sql` | 364 files, 22 findings, all approved, 0 not approved |
| Backend and integration | `npm run test -w backend` | 63 files, 651 tests passed |
| Migrations | Same command, separate stage | 12 tests passed |
| Frontend | `npm run test -w frontend` | 10 files, 131 tests passed |
| Build | `npm run build` | Pass |
| Browser | `npm run test:e2e:disposable` | 173 passed |

**Skipped:** none reported in the final run. Some tests can skip conditionally when data is missing; none did.

**Flaky or failed along the way:**
- `phase-11-dashboards.test.ts` timed out in the first full run. Cause confirmed: see section H. Test now runs `ANALYZE` first.
- `phase-3b-alerts.spec.ts` failed once by reading the page during a tab change. Test now waits.
- `phase-1-attestation.test.ts` failed once in four cold runs, when creating a student returned not-ok. The cause is not confirmed; a duplicate random test phone number is likely. The test now reports the reason.

Logs are in `.data/e2e-evidence/final-2026-11-05/`.

## F. Database and data integrity

| Environment | State |
|---|---|
| **Production** | **Not touched.** Its state is unknown |
| **Local development** | 50 migrations, latest `0050_finance_due_dates.sql` |
| **Disposable test database** | All migrations, fictional data |

**After applying 0049 and 0050 to dev:** 397 students, 70 users and 201 payment entries, which these migrations do not modify; 202 policies; 0 new functions executable by PUBLIC.

**Backup taken first:** `.data/backups/pre-0049-2026-11-05T08-41-27`, 128 MB, restored to a copy with 152 of 152 tables identical. All 10 backups were kept.

| Migration | New tables | Functions | Policies |
|---|---|---|---|
| 0039 notifications, secure files | 2 | 19 | 2 |
| 0040 notification completion | 2 | 22 | 2 |
| 0041 employee profiles | 1 | 5 | 3 |
| 0042 attendance | 8 | 20 | 10 |
| 0043 task lifecycle | 3 | 7 | 5 |
| 0044 meetings | 7 | 16 | 7 |
| 0045 chat | 6 | 21 | 5 |
| 0046 pre-admission | 6 | 31 | 5 |
| 0047 chat governance | 6 | 20 | 6 |
| 0048 tickets | 4 | 23 | 3 |
| 0049 preferences | 4 | 10 | 4 |
| 0050 finance due dates | 1 | 2 | 1 |

Function counts include re-created functions.

**Rollback:** every migration has a rollback file. Tests run real rollback and re-apply for 0038, 0039, 0045, 0046, 0047, 0048, 0049 and 0050. The other files are covered only by the newest-first rollback test. Rolling back an older migration also rolls back everything newer. Several rollbacks delete that feature's data, so they need a backup and a decision first.

**Records preserved:** no student, employee or document records were deleted or reset. No business records were changed to make tests pass on dev.

## H. Performance

Measured on this Mac. These are indicative figures, not benchmarks.

| Measure | Conditions | Result |
|---|---|---|
| All logged requests | Final browser run, Next.js dev server, disposable data | 3,697 requests, median 20 ms, 95th percentile 571 ms, 0 server errors |
| Dashboard `GET /` | Same, 180 requests | Median 554 ms, max 1,887 ms |
| Chat polling `GET /api/chat/sync` | Same, 2,223 requests | Median 12 ms |
| Analytics queries on local dev, read-only as MD | 397 students, 70 users | Country 56 ms, 12-month series 336 ms, staff table 264 ms, pending documents 595 ms |
| Analytics service | Fresh test data, analysed | About 0.9 to 1.8 s |
| Analytics service | Test database never analysed, 177 students | **12.6 s, against 0.93 s straight after `ANALYZE`** |

**Findings:**
- **Missing statistics are the one real bottleneck found.** Run `ANALYZE` after any restore, migration to a new server or bulk import.
- Analytics repeats work: the monthly series scans students 24 times. It is acceptable at this size and should be reviewed as data grows.
- Chat polling makes up 60% of browser-run requests. That is expected with 3 to 5 second polling, and matters more with many users.

**Not measured:** large upload timing, memory leaks, notification throughput, job reliability over time, concurrent users. The 10 MB upload limit and pagination are in place, but were not timed.

## I. Remaining issues

| Severity | Issue | Next step |
|---|---|---|
| Critical | Trust boundary unresolved | Security Hardening, with your approval |
| Critical | 209 changed entries exist only on this Mac, uncommitted. Local backups are on the same disk | Approve a commit and off-machine copy soon |
| High | No virus scanner | Install on staging |
| High | Server scheduler unverified: reminders and queued mail may not run | Verify on staging |
| High | Real email unproven | Verify on staging with a test address |
| High | Production state and backup unproven | Read-only check, with approval |
| High | 173 older definer functions open to PUBLIC | Security Hardening |
| High | Sensitive documents may enter Git | Apply the private list below before any push |
| Medium | Attendance values, retention, governance and finance decisions open | See readiness report |
| Medium | No real device, Safari or Firefox testing | UAT |
| Medium | No holiday calendar | Decide and add |
| Medium | Oldest-first due-date rule not confirmed; undated charges can mislead it | Finance decision |
| Medium | Country document rules not added to the checklist; no prefilled DVR conversion; no ticket emails | Prioritise after UAT |
| Medium | Hard-coded `manager` check on the student page | Replace with a permission |
| Low | Kiosk QR has no browser test | Add |
| Low | `The destination stream errored` in logs, cause unconfirmed | Check on production build |
| Low | Reminder link opens the Overview tab; revenue chart shows the first currency; Bulgaria notice appears twice on Overview | Polish |
| Low | `phase-1-attestation` occasional failure | Check the reason if it recurs |

## K. Git and release status

| Item | State |
|---|---|
| Branch | `cleanup/local-readiness` |
| HEAD | `3df4171` |
| Changes | 209 entries: 82 modified, 127 untracked |
| New migrations | 0038 to 0050, untracked |
| Committed | **No** |
| Pushed | **No** |
| Deployed | **No** |
| Production or VPS touched | **No** |
| Real email or payment | **No** |

## Private documents

**Must stay out of Git:**
- `docs/FINAL_ERP_SECURITY_AND_RISK_REPORT.md`
- `docs/FINAL_ERP_PRODUCTION_READINESS_REPORT.md`
- `docs/audit/`: `ERP_APP_TRUST_BOUNDARY_REVIEW.md`, `PRIVILEGED_FUNCTIONS_SECURITY_REVIEW.md`, `RISK_REGISTER.md`, `IMPLEMENTATION_ROADMAP.md`, `PRODUCTION_STATE_REPORT.md`, `stage0_production_readonly_check.sh`, `LOCAL_PROJECT_READINESS_REPORT.md`, `STAGE_A_B_FUNCTION_MAP.md`, `STAGE_A_B_PERMISSION_PROPOSAL.md`, `proposed/`

**Suitable for a private repository:** this report, the matrix and the browser report. They name no credentials. They do name open risks at summary level, so don't publish them.

None of these files have been added to `.gitignore`, so a careless `git add` would include them. That needs handling at commit time.
