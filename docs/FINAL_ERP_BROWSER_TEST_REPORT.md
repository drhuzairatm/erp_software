# Final ERP Browser Test Report

**Run:** 5 November 2026, final regression, 11:51 to 12:00, on a clean copy of the working tree.
**Result:** 173 browser tests passed, 0 failed, 0 skipped.
**Privacy:** contains no passwords or production details. Evidence is fictional data and stays out of Git in `.data/e2e-evidence/final-2026-11-05/`.

## Set-up

| Item | Value |
|---|---|
| Browser | Google Chrome 156.0.8078.80, headless, driven by Playwright 1.64.1 |
| Application | Running Next.js dev server and internal API against a disposable database with fictional data |
| Desktop | Playwright default desktop viewport |
| Phone and tablet widths | 320, 390 and 768 px by resizing Chrome |
| Accounts | MD, CEO, System Admin, Manager, Counsellor (two), Documentation, Finance in both companies, portal students. No passwords are recorded here |
| Companies | Dr.Expert Edulinks and GRADUATER, tested against each other |
| Email | Test mode: no real email sent |
| Payments | Ledger entries only: no real payment made |

**MFA:** the disposable stack sets `MFA_ENFORCE=off` for routine sign-in. MFA is tested separately with it enforced, in `security-phase-b.spec.ts` and `phase-a.spec.ts`: enrolment, wrong code refused, correct code, single-use recovery code, MD reset. Those tests passed in this run.

## Required workflows

Console errors count those not already expected by the test. Tests that assert a refusal list the browser's matching "status of 404" line as expected. Server errors (HTTP 5xx) were 0 in the whole run, out of 3,697 logged requests. Failed requests other than aborted navigations were recorded for the workflows in this table, and were 0.

| # | Workflow | Roles | Expected | Actual | Result | Console errors | 5xx |
|---|---|---|---|---|---|---|---|
| 1 | Employee login and profile editing | counsellor, MD | Staff sign in and edit their profile | Details saved and reloaded; counsellor still refused /admin/users; MD keeps /admin/users after a display name change | PASS | 0 | 0 |
| 2 | Notification receipt, read and unread | Manager, counsellor and other company | Assignee is told; opening clears unread | Disguised file refused, PDF stored and served by signed link, bell and page showed the notifications, opening cleared unread, other company and signed-out requests got 404 | PASS | 0 | 0 |
| 3 | Secure file upload and download | Manager, counsellor and other company | Disguised file refused; real PDF stored; signed link | Disguised file refused, PDF stored and served by signed link, bell and page showed the notifications, opening cleared unread, other company and signed-out requests got 404 | PASS | 0 | 0 |
| 4 | File access restriction | Manager, counsellor and other company | Other company and signed-out requests get 404 | Disguised file refused, PDF stored and served by signed link, bell and page showed the notifications, opening cleared unread, other company and signed-out requests got 404 | PASS | 0 | 0 |
| 5 | Attendance check-in and check-out | counsellor | Server records times, photo and events | Fake camera and fixed location used. Server recorded check-in, break, check-out and a photo | PASS | 0 | 0 |
| 6 | Attendance manual review | other-company counsellor, manager, other company, manager | Missing signal goes to a manager; nobody marked absent | Check-in without location accepted and sent to review; same-company manager accepted it; other company saw nothing; employee refused the page; never absent | PASS | 0 | 0 |
| 7 | Manager task creation and assignment | manager, counsellor, manager, other company | Manager creates and assigns | Evidence rule enforced; correction round; approval completed it; original deadline preserved after extension; other company 404 | PASS | 0 | 0 |
| 8 | Employee task update and completion submission | manager, counsellor, manager, other company | Assignee updates and submits | Evidence rule enforced; correction round; approval completed it; original deadline preserved after extension; other company 404 | PASS | 0 | 0 |
| 9 | Manager task approval | manager, counsellor, manager, other company | Manager approves; other company refused | Evidence rule enforced; correction round; approval completed it; original deadline preserved after extension; other company 404 | PASS | 0 | 0 |
| 10 | Meeting creation and minutes | MD, attendee and assignee, colleague not invited, manager not invited, System Admin, other company | Private to attendees and note taker | Minutes versioned with a reason; decision and action point recorded; converted to a task in the existing system; uninvited staff, System Admin and other company 404 | PASS | 0 | 0 |
| 11 | Meeting decision to task | MD, attendee and assignee, colleague not invited, manager not invited, System Admin, other company | Decision becomes a linked task | Minutes versioned with a reason; decision and action point recorded; converted to a task in the existing system; uninvited staff, System Admin and other company 404 | PASS | 0 | 0 |
| 12 | One-to-one chat | counsellor A, counsellor B | Both people see the messages | Delivered live both ways; typing, unread, notification and Delivered/Read receipts all seen by the other account | PASS | 0 | 0 |
| 13 | Group chat | manager, counsellor A, counsellor B, counsellor B bell | Group managed; members only | Counsellor offered no group creation; manager-created group delivered live to members; mention notified; removed and departed members refused | PASS | 0 | 0 |
| 14 | File sharing in chat | counsellor A, counsellor B, MD, not in this conversation, manager, other company | Members open; everyone else refused | Disguised file refused with no message left; real PDF downloaded by the member; 404 for MD, manager, other company and signed out | PASS | 0 | 0 |
| 15 | Pre-admission request submission | Counsellor, Other counsellor, Documentation | Counsellor submits; other counsellor closed out | Submitted, reviewed per document, sent back, corrected with versions kept, resubmitted, assessed and returned. No student was created. | PASS | 0 | 0 |
| 16 | Documentation review | Counsellor, Other counsellor, Documentation | Documentation reviews each document | Submitted, reviewed per document, sent back, corrected with versions kept, resubmitted, assessed and returned. No student was created. | PASS | 0 | 0 |
| 17 | Return to counselor and resubmission | Counsellor, Other counsellor, Documentation | Returned, corrected, resubmitted | Submitted, reviewed per document, sent back, corrected with versions kept, resubmitted, assessed and returned. No student was created. | PASS | 0 | 0 |
| 18 | Portal ticket creation and reply | Manager, Student on a phone | Student asks, staff replies, phone viewport | Reference issued; a bad file left nothing behind; attachments went both ways; notifications generic; internal note and staff names hidden; closed question read-only. | PASS | 0 | 0 |
| 19 | Student preference selection | Manager | Secondary preference saved; registration open | Secondary preference saved; Bulgaria subject-wise marks, Bonafide, PCC check and a university document all displayed; removal kept the history; registration stayed open. | PASS | 0 | 0 |
| 20 | University-specific requirement display | Manager | Subject, Bulgaria and university requirements shown | Secondary preference saved; Bulgaria subject-wise marks, Bonafide, PCC check and a university document all displayed; removal kept the history; registration stayed open. | PASS | 0 | 0 |
| 21 | Finance entry and payment history | Finance, MD, Counsellor | Rate kept, due date, verification, receipt, reports | USD charge kept its rate, due date overdue then settled after a verified receipt, receipt link shown, reports filtered, counsellor and other company refused | PASS | 0 | 0 |
| 22 | Dashboard filtering and reporting | MD, Counsellor | Totals equal direct counts; filtered CSV audited | Dashboard sections shown to the MD, department filter narrowed the report to one person, CSV matched and the export was audited, counsellor refused | PASS | 0 | 0 |
| 23 | Unauthorized access attempts | Counsellor, other-company staff, System Admin, students, signed out | Plain 404 or refusal, nothing revealed | Recorded in the chat, pre-admission and portal ticket runs, and asserted in workflows 2-4, 9, 10, 21 and 22 and `isolation.spec.ts` | PASS | 0 | 0 |

## Evidence records

- 2-4 notification read and unread, secure file upload and download, file access restriction: 199 requests, 1 screenshot(s)
- 21 finance entry and payment history: 411 requests, 3 screenshot(s)
- 22 dashboard filtering and reporting: 303 requests, 2 screenshot(s)
- One-to-one chat: 202 requests, 2 screenshot(s)
- Replies, editing, deletion and reactions: 264 requests, 2 screenshot(s)
- Chat task reference: 114 requests, 2 screenshot(s)
- File sharing in chat: 204 requests, 5 screenshot(s)
- Group chat: 277 requests, 3 screenshot(s)
- Chat unauthorized access: 350 requests, 4 screenshot(s)
- Chat governance and investigation access: 610 requests, 8 screenshot(s)
- Chat mobile: 92 requests, 1 screenshot(s)
- 15-17 pre-admission request, review, return and resubmission: 366 requests, 2 screenshot(s)
- Pre-admission re-verification and explicit student link: 306 requests, 2 screenshot(s)
- Pre-admission on a phone viewport: 179 requests, 2 screenshot(s)
- Pre-admission unauthorized access: 203 requests, 3 screenshot(s)
- 18 portal ticket creation and reply: 298 requests, 2 screenshot(s)
- Portal tickets unauthorized access: 495 requests, 5 screenshot(s)
- 19-20 preference selection and university requirement display: 84 requests, 1 screenshot(s)
- Phase 9 master data and rule verification: 177 requests, 2 screenshot(s)
- Employee login and profile editing: 204 requests, 2 screenshot(s)
- Attendance check-in and check-out: 55 requests, 1 screenshot(s)
- Attendance manual review: 176 requests, 3 screenshot(s)
- Task assignment, employee submission, manager approval: 257 requests, 3 screenshot(s)
- Meeting creation, minutes, decision to task: 342 requests, 6 screenshot(s)

Screenshots and `evidence.jsonl` are in `.data/e2e-evidence/final-2026-11-05/evidence/`. The logs for each step are one folder up.

## Other coverage in the same run

- Responsive checks for every listed route, at phone width, with some at 320 and 768 px
- Company isolation, signed link expiry, content security policy, security alerts
- Existing modules: workflow, courier, attestation, academic rules, passport warnings, leads, imports, master data, multi-currency, merge, photos

## Problems and limits

- **Real devices: NOT TESTED.** Android and iPhone were approximated by screen width in desktop Chrome. Safari and Firefox were not run, so iPhone behaviour is not proven.
- **Camera and location** were simulated with Chrome's fake camera and a fixed position.
- **Attendance kiosk QR:** backend tests only. **NOT TESTED** in a browser.
- **Virus scanning:** a simulated scanner is used in backend tests. The browser only sees "Not virus-scanned".
- **Server log message:** `The destination stream errored while writing data.` appeared 3 times, each shortly after a navigation. No test failed and no 5xx was logged. The likely cause is a navigation aborting a stream. That is not confirmed.
- **Earlier run:** the run before this one had 1 failure out of 173, in `phase-3b-alerts.spec.ts`. The test read the page before a tab change finished, which Phase 9's added panel exposed. The test now waits for the new tab.
- These are functional runs with one user per role, not load tests.
