# Final ERP Production Readiness Report

**Date:** 5 November 2026. **Handling: keep private.** It describes readiness gaps, though it contains no credentials or server details.

## Verdict

**READY FOR STAGING, NOT PRODUCTION.**

The local test results are good, but they do not prove production readiness. Controlled UAT should begin on a staging copy once the items marked "before staging" are done.

## Readiness by area

| Area | State | Evidence | Before |
|---|---|---|---|
| Application features | All 11 phases built and tested locally | Final regression | |
| Code safety | All work is uncommitted on one Mac, on branch `cleanup/local-readiness` | Section K of the implementation report | Staging |
| Email | Tested in test mode only. Real delivery is unproven | NOT TESTED | Staging |
| Scheduled jobs | Jobs are tested. The server scheduler is unverified (R-05), so reminders and queued mail may not run | Unverified | Staging |
| Virus scanning | No scanner installed. Files are labelled as not scanned | BLOCKED | Production |
| Backups | Local backups restore and verify. Production backup is unproven (R-03) | Local only | Production |
| Deployment configuration | Not reviewed in this work | NOT TESTED | Staging |
| Production database | Its current state is unknown (R-02). Migrations 0038 to 0050 have never run there | Unverified | Staging |
| Security | Controls preserved. Trust boundary unresolved, and older functions still open to PUBLIC | Security report | Production |
| Monitoring and operations | Not assessed. No alerting or runbook was proven | NOT TESTED | Production |
| Real devices | Width checks in Chrome only | NOT TESTED | UAT |
| Load | No load test | NOT TESTED | Production |
| Business settings | Attendance values and several policies await your decisions | BLOCKED | UAT |

## Before staging

1. Your approval to commit and push, after you have dealt with repository visibility.
2. Keep the private documents listed in the implementation report out of Git.
3. Prepare a staging server with a copy of the database and fictional or approved data.
4. Run migrations 0038 to 0050 on staging from a verified backup, then run `ANALYZE`. Without statistics, one dashboard load took 12.6 s instead of 0.9 s on a test database.
5. Confirm scheduler and real email on staging.

## Before production

1. Security Hardening, including the trust boundary work and older function access.
2. ClamAV or another scanner installed and proven.
3. Verified production backup and restore, with a rollback plan.
4. UAT sign-off, including real Android and iPhone devices and Safari.
5. Monitoring and alerting, with someone responsible for them.
6. Your decisions below.

## Decisions needed from you

| # | Decision | Affects |
|---|---|---|
| 1 | Attendance offices, hours, grace, half-day, leave types, weekly off, holidays, selfie retention | Attendance figures |
| 2 | Who must mark attendance (directors and others) | "No record" counts |
| 3 | Chat retention period and legal access. This needs legal advice | Chat governance |
| 4 | Core Team, Executive Assistant and System Admin access to meetings | Meetings |
| 5 | Employee notice about monitoring, attendance photos and location | Attendance, chat |
| 6 | DVR and ticket numbering formats | Pre-admission, tickets |
| 7 | What "split financial information" means, and whether instalments are wanted | Finance |
| 8 | Whether receipts should settle the oldest due date first | Finance reminders |
| 9 | Definition of revenue | Finance reports |
| 10 | Bulgaria notice scope; first visa stage for PCC; PCC timing | Requirements |
| 11 | Per-person permission overrides: defer or build | Employee admin |
| 12 | Whether students should get payment reminders and ticket emails | Finance, tickets |
