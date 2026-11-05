# Phase 1: Employee Notifications and Secure File Storage

**Status:** built and tested locally; see "Implementation result". Gap analysis of 5 Nov 2026, with findings from reading the current code and read-only counts on the local development database.

## What exists today

| Area | Item | Status |
|---|---|---|
| Employee notifications | Header bell: live counts of overdue tasks, documents to review or approve, next actions | **Working.** Counts only: no history, no read state, no event record |
| | `/notifications` outbox and `notification_messages` | **Working, but for students and parents.** Needs `notifications.view`; recipients are only `student` or `parent` |
| | System email (`sendEmail`, test-mode gate) | **Working** |
| | Security alerts: Admin page, sidebar count, email to alert holders | **Working.** Limited to holders of `security.alerts` |
| | Employee notification record, read or unread, notification page | **Missing** |
| | Telling an employee that something happened (assigned, comment, rejected, approval waiting) | **Missing.** They must notice a changed count |
| | Reminders when a task is due or overdue | **Partly working.** Live counts only, with no message |
| | Scheduled jobs | **Partly working.** Cron routes work; the repository has only `vercel.json`, and the VPS is unverified (R-05) |
| Secure files | `lib/storage`: random keys, private storage, type sniffing, 10 MB limit, 60-second signed links | **Working, reusable** |
| | Student document files: permissions, audit, scan status, quarantine, bulk-access alerts | **Working** |
| | Staff and student photos | **Working** |
| | Attestation evidence | **Partly working.** Infected files are refused, but no scan status is stored or re-scanned (N-2) |
| | `scanner.ts`, daily re-scan job, `ScanBadge` | **Working, tested with a simulated scanner** |
| | Secure store for files with no student document | **Missing.** `document_files` must belong to a student document |
| | Installed virus scanner | **Missing.** Development has 353 files not scanned, 25 manually cleared, 0 scanned |

**Broken:** nothing that blocks Phase 1.

**Existing limitations, not fixed here:**
- `files_to_rescan` always takes the oldest files first, so files that keep failing can hold back newer ones once there are more than the batch size.
- Three test files pin the total number of policies and RLS tables, so they must change when any table is added.

## Essential Phase 1 work

**Employee notifications**
1. `staff_notifications` table: each person sees only their own, in companies where they are still active. There is no insert or edit access for the application role, and no new permission.
2. Notifications raised by the database, so every route that changes data is covered:

| Event | Goes to | Email |
|---|---|---|
| Task assigned or reassigned | New assignee | Yes |
| Comment on a task | Assignee and creator | No |
| Task completed by someone else | Creator | No |
| File added to a task | Assignee and creator | No |
| Task due within 2 days | Assignee | No |
| Task overdue | Assignee | Yes |
| Document waiting for approval | People who can approve it, except its verifier and submitter | Yes |
| Document rejected or changes required | Staff assigned to the student | Yes |
| File quarantined by a later scan | Uploader | Yes |

3. Bell shows unread notifications, with a "My notifications" page, opening an item, and mark as read.
4. Email through the existing `sendEmail`, with retries. It respects test mode and contains no personal data, only a generic line and a link.
5. Daily reminder job with one reminder per task and due date.

**Secure file storage**
6. `secure_files` table and service for files that have no student document, reusing storage, scanner, signed links, audit and alerts.
7. Task attachments as the first real use: upload, list, open and remove on the task page. Access follows the task, plus the student when the task has one.
8. Scan states: not scanned, clean, scan failed, infected. Infected uploads are refused and never stored; a file found infected later is never served.
9. Daily re-scan covers these files.

**Both:** tests, regression, migration with rollback, documentation.

## Optional, not in this phase
- Per-person notification preferences and email digests
- Browser push (decision 9: later)
- A retention period for old notifications and removed files (needs an MD decision)
- Manual clearance for `secure_files`, which has no approval step to unlock
- Stored scan status for attestation evidence (N-2), and the `files_to_rescan` ordering
- Attachments on other records: added when Phases 2 and 4 to 8 need them

## Dependencies

| Dependency | Effect | Status |
|---|---|---|
| Scheduler on the server | Without it, email and daily reminders don't run. In-app event notifications still work | Unverified (R-05), needs server approval |
| Virus scanner | Without it, files stay "Not virus-scanned", clearly labelled | Not installed; ClamAV recommended on the VPS. Needs server approval |
| System email settings | Without them, email is not sent; notifications stay in the app | Server setting |
| Migration 0039 | Must be applied before the new code runs | Local development only |

**Numbering:** this phase uses migration `0039`. The unapproved permission proposal in `docs/audit/proposed/` also uses that number and must be renumbered when Security Hardening starts.

**Known limit:** these features use the existing controls. They don't change the known database-identity limit described in `ARCHITECTURE.md`.

## Implementation result, 5 Nov 2026

**Status:** built and tested locally. Nothing is committed, pushed or deployed. Migration 0039 is applied to the local development database only.

**Database:** tables `staff_notifications` and `secure_files`, each with RLS and one read policy, plus 19 functions and 4 triggers. No existing table, function or policy changed. Migration: `0039_staff_notifications_secure_files.sql`, rollback tested.

**Decisions made while building:**
- An infected upload is refused and never stored. This matches photos and attestation evidence, and leaves no moment when an infected file could be opened.
- Files not yet scanned or whose scan failed can still be opened, with a visible label, as with student documents. Only infected files are always refused.
- A task linked to a student also needs read access to that student before its attachments can be seen.
- Removing a file takes it out of use but keeps the bytes, until a retention rule is decided.
- Overdue reminders stop 3 days after the due date, so switching this on doesn't send a message for every old task.
- The bell total now adds unread notifications to the existing attention counts.
