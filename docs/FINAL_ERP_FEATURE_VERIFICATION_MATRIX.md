# Final ERP Feature Verification Matrix

**Date:** 5 November 2026. **Privacy:** no credentials or infrastructure details.

**PASS** means automated tests ran and passed on the local disposable stack with fictional data. It does not mean accepted by users or proven in production.

| Status | Meaning |
|---|---|
| PASS | Tested and working as specified |
| PARTIAL | Works, with a stated gap |
| NOT IMPLEMENTED | Not built |
| NOT TESTED | Built or external, not exercised, with the reason |
| BLOCKED | Needs a decision, credential or server access |
| FAIL | Tested and not working. There are none in the final run |

## Features

| Phase | Feature | Status | Note |
|---|---|---|---|
| 1 | Employee notifications, read and unread, preferences | PASS | |
| 1 | Notification email | NOT TESTED | Test mode only, so no real delivery |
| 1 | Secure upload, signed links, access checks | PASS | |
| 1 | Virus scanning | BLOCKED | No scanner installed. Files are labelled "Not virus-scanned". Logic tested with a simulator |
| 1 | Scheduled reminders | PARTIAL | Job tested. The server scheduler is unverified (R-05) |
| 2 | Employee profiles, photo, permission-limited fields | PASS | |
| 2 | Per-person permission overrides | NOT IMPLEMENTED | Deferred, recommended and still awaiting your confirmation |
| 3 | Check-in, check-out, breaks, GPS, IP, photo signals | PASS | Camera and location simulated |
| 3 | Manual review; nobody auto-marked absent | PASS | |
| 3 | Kiosk QR | PARTIAL | Backend tests only, no browser test |
| 3 | Real working hours, grace, offices | BLOCKED | Placeholder values until you confirm them |
| 3 | Overnight shifts | NOT IMPLEMENTED | |
| 3 | Face matching and liveness | NOT IMPLEMENTED | Excluded by your decision |
| 4 | Task lifecycle: create, assign, submit, approve, reject | PASS | |
| 5 | Meetings, minutes, decisions to tasks, privacy | PASS | Core Team membership needs your confirmation |
| 6 | One-to-one and group chat, replies, edits, reactions, search | PASS | Plain-text search limits apply |
| 6 | File sharing in chat | PARTIAL | One attachment per message; no real virus scan |
| 6 | Forwarding | PARTIAL | Copies text only |
| 6 | Live delivery | PARTIAL | Polling every 3 to 5 seconds. WebSocket is not implemented |
| 6 | Chat governance and named investigation access | PASS | Retention off until you set a policy. No retention duration was invented |
| 6 | Chat load | NOT TESTED | No load test |
| 7 | Pre-admission requests, review, return, resubmission, re-verification | PASS | Numbering format needs your confirmation |
| 7 | Prefilled conversion to a student | NOT IMPLEMENTED | Explicit link to a student exists instead |
| 8 | Portal tickets, replies, attachments, staff assignment | PASS | |
| 8 | Ticket emails | NOT IMPLEMENTED | In-app and portal notices only |
| 9 | Preferences with history | PASS | |
| 9 | University, country, Bulgaria subject requirements shown | PASS | Bulgaria notice scope needs your confirmation |
| 9 | Country document rules added to the checklist | NOT IMPLEMENTED | Shown, not added |
| 9 | Academic years, country document master data | PASS | |
| 10 | INR, USD, EUR, stored rate and date, original currency | PASS | Existing feature |
| 10 | Received, pending, receipts, student history | PASS | Existing feature |
| 10 | Due dates, overdue view | PASS | New. Oldest-first settlement rule needs confirmation |
| 10 | Staff reminders | PARTIAL | Tested. Depends on the scheduler; students are not reminded |
| 10 | Monthly, yearly, revenue, outstanding reports | PASS | Revenue definition needs Finance confirmation |
| 10 | "Split" financial information | BLOCKED | Not defined. Nothing built until you define it |
| 10 | Real payment processing | NOT TESTED | Prohibited, and no gateway exists |
| 11 | Admissions dashboard, university and intake | PASS | |
| 11 | Finance dashboard | PASS | Trend chart shows the first currency; the table shows all |
| 11 | Employee dashboard: present, absent, late, tasks, workload | PARTIAL | "No record" is separate from recorded absence, no holiday calendar |
| 11 | Operations dashboard | PASS | Visa and admission progress are stage counts |
| 11 | Report filters: date, country, programme, department | PARTIAL | Department applies to employee reports only |
| 11 | Authorized, audited CSV export | PASS | |

## Cross-cutting

| Area | Status | Note |
|---|---|---|
| Company isolation | PASS | Database and browser |
| RLS on all new tables | PASS | Schema counts and SQL guard |
| Migrations with rollback | PASS | Rollbacks exercised with real rows for the newest migrations |
| Passport warning-only policy | PASS | |
| Responsive at 320, 390, 768 px | PASS | Width in desktop Chrome only |
| Real Android and iPhone | NOT TESTED | No devices in this environment |
| Safari and Firefox | NOT TESTED | Chrome only |
| Performance under load | NOT TESTED | No large-scale benchmarks, as instructed |
| Backup restore on production | NOT TESTED | Local only |
| Production deployment | NOT TESTED | Prohibited without approval |
| Trust boundary | NOT IMPLEMENTED | Postponed by your instruction |
