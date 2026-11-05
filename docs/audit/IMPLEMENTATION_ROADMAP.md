# Implementation roadmap

**Date:** 4 November 2026
**Status:** for MD review. **Nothing here has started, and approving this document does not start it.**
**Architecture:** existing Next.js, PostgreSQL and SQL. See `ARCHITECTURE_ASSESSMENT.md`.
**Process for every phase:** Inspect → Verify → Identify Gaps → Prepare Plan → MD Approval → Implement → Test → Regression Test → Report.

## MD decisions recorded

| Topic | Decision |
|---|---|
| Architecture | Existing Next.js, PostgreSQL and SQL; no framework or TypeORM migration |
| Passport at registration | Always allowed, regardless of expiry |
| Passport at University Application | **Warning only by default, including when expiry is missing.** Enforce only an official rule for the relevant university or programme, with source and approval recorded |
| Order | Employee Profile in Phase 2; Attendance in Phase 3 |
| Attendance first release | Excludes face matching and liveness, which remain a future approved requirement |
| Phase 0 | **Only read-only verification (0A) is approved, after MD review of the script.** Fixes and production changes (0B) are not |
| Priority (4 Nov 2026) | **Features first, then security.** Clean-up (email, passport, security review documents, CI), then Phases 1 to 11 one at a time, each with MD approval, then Security Hardening |
| Trust boundary (4 Nov 2026) | **Remediation and the `erp_system` login are postponed until after Phase 11. The vulnerability stays open as R-08A.** Argon2id, MFA, sessions, password verification and the existing architecture stay as they are |

## Principles

- Preserve every working feature and every record.
- Build only what's missing, complete what's incomplete, and fix verified bugs.
- Reuse existing modules; no duplicate logic.
- No new dependency unless it is shown to be necessary and is approved.
- Every new table has RLS, audit and permissions from its first migration.
- No production deployment without separate approval.

## Summary

Estimates are in person-weeks for one experienced developer. They are **low-confidence judgements**, to be refined after each phase's inspection step.

| Phase | Work | Estimate | Depends on |
|---|---|---|---|
| **0A** | Read-only production verification. **Paused** | n/a | MD decision |
| **0B** | Local items (passport warning-only, mail fixes, CI) are done on the clean-up branch, uncommitted; server items later. **Server items not approved** | About 1 | Separate approval |
| **1** | Foundations: **Employee Notifications**, shared secure files, scanner. **Built locally, uncommitted (5 Nov 2026).** The scanner install and scheduler still need server approval | 2–3 | 0 |
| **2** | Employee profile completion | 1–2 | 1 |
| **3** | **Attendance**, first release | 4–6 | 1 |
| **4** | **Employee Task Management** | 3–4 | 1 |
| **5** | **Daily Core Meetings and Minutes** | 2–3 | 1, 4 |
| **6** | **Internal Employee Chat** | 5–8 | 1, 4 |
| **7** | **Pre-Admission Document Verification** | 4–5 | 1 |
| **8** | **Student Portal Question/Ticket System** | 2 | 1 |
| **9** | **Student Preferences** and admissions rules | 2–3 | Verified rules |
| **10** | **Finance improvements** | 1–2 | Decision 7 |
| **11** | **Dashboards and Reports** | 2–3 | 3–10 |
| | **Total, Phases 0 to 11** | **About 29–43** | |
| **After 11** | **Security Hardening**, including the trust boundary fix | About 4–5.5, low confidence | 11, and MD approval of the plan |

Phase 2 and Phase 3 are fixed by MD decision. Phases 4, 7 and 8 could change order if business priority changes. Employee Notifications moves to Phase 1 because tasks, meetings, chat, verification and tickets all need it.

## Phase 0A: Read-only production verification (**PAUSED by MD decision, 4 Nov**)

**Do not run.** No VPS connection, SSH setup or production script for now. Work continues locally: see `LOCAL_PROJECT_READINESS_REPORT.md`. The details below are kept for reference only.

**Conditions set by the MD:** complete script shown first; non-root SSH wherever possible; no PostgreSQL superuser; no files on the VPS; output stored only on the Mac; no change to code, database, configuration or services; no restore, email fix or deployment; stop and report anything needing write or elevated access.

**Status (4 Nov):** root password changed by the MD. Paused; nothing was run on the VPS.

| Check | Method | Expected limit |
|---|---|---|
| Commit, services, ports, Nginx, env names | Script as `erp` | PM2 CLI not called, so no restart counts |
| PostgreSQL version, RLS, policies, triggers, grants, functions | Catalogues as `erp_app` | None expected |
| Migrations, queue status, scan counts, rule contents | Hidden from `erp_app` | **Blocked**, or inferred from markers and statistics |
| Root crontab, protected logs | Not readable by `erp` | **Blocked** |
| Backups | File listing | Dates and sizes only; validity unproven; provider snapshots not visible |
| TLS and headers | Run from the Mac | None expected |

**Result:** Stage 0 can't be fully completed under these conditions. The remaining items would be reported as blocked for MD decision. A dedicated read-only monitoring role would close most of them, but creating one is a production change needing separate approval.

## Phase 0B: Baseline fixes (local items done, server items not approved)

The local items are done on `cleanup/local-readiness` and aren't committed. Latest results are in `LOCAL_CLEANUP_REPORT.md`. Server items wait for a later decision.

| Item | Detail | Status today |
|---|---|---|
| **Passport warning-only** | Change the global rule's enforcement from `block` to `warn` through a tested migration, and update `defaults.ts` and the test that asserts blocking. Source shows `warn` already handles a missing expiry and only warns | **Done locally:** migration 0038 applied to the development database only. Production not inspected |
| Rotate root password | Exposed in chat. MD or server admin | Changed by the MD, 4 Nov: reported, not verified |
| Proven backup | Matching `pg_dump`, off-site copy; isolated restore test | Unknown; separate approval |
| Fix mail defects | Test mode sends real mail; apostrophe addresses refused; Resend-only setup silently stops | **Fixed and tested,** uncommitted |
| Other mail defects | Alert re-send loop, cron `.catch`, portal errors | **Fixed and tested,** uncommitted |
| Scheduler | Cron calling existing routes | Unknown on production |
| CI and staging | Typecheck, lint, guard, tests, browser tests; separate database and credentials | CI written, uncommitted, so not yet active; staging Blocked |
| Regression baseline | Re-run all tests on `3df4171` | **Passed, 4 Nov.** Clean-up results are in `LOCAL_CLEANUP_REPORT.md` |

**DB change:** one small migration for the passport rule. **Done when:** backup proven, mail tests pass, CI green, passport behaviour tested.

## Phase 1: Foundations, including Employee Notifications

| | |
|---|---|
| **Exists** | Student-facing rules and queues, senders, passport tasks, scanner integration |
| **Missing** | Staff notification centre with read state, staff event types, shared file store for non-student files, scan states, installed scanner |
| **Reuse** | `notification_messages` senders, `lib/storage`, `lib/security/*`, `scan-badge` |
| **DB** | `staff_notifications`, `secure_files` |
| **Permissions** | Own notifications only; no permission needed to read them |
| **Tests** | Isolation, job runs once only, each scan state, file refusal |
| **Decision** | 8, 9 |

## Phase 2: Employee profile completion

Fixed by MD decision as Phase 2, before Attendance.

| | |
|---|---|
| **Exists** | Staff accounts, statuses, photos, MFA, roles, departments, login activity |
| **Missing** | First, Middle, Last and Display Name; managed designations; `/account/profile`; secure email and phone change; profile history; per-person permission overrides |
| **Note** | `full_name` stays and is derived. Overrides change `app.has_perm`, which every policy calls, so they are the highest-risk item; question 3 below |
| **DB** | New columns, `designations`, possibly `user_permission_overrides` |
| **Tests** | Self-escalation attempts, protected MD unaffected |

## Phase 3: Attendance Management, first release

| | |
|---|---|
| **Exists** | Nothing specific. Reusable: `photo-capture`, `client-ip`, `qrcode`, storage |
| **Build** | Mobile and kiosk clock in and out, live selfie, office IP, GPS geofence, short-lived signed QR, breaks, late, early, half-day, leave, field duty, official visit, correction requests, approvals, Manual Review, dashboard, admin settings |
| **Failure rule** | Failed checks go to HR or Manager Manual Review, never automatic absence or rejection |
| **Deferred** | **Face matching and liveness**, kept as an approved future phase requiring its own legal review |
| **DB** | `offices`, `attendance_policies`, `attendance_records`, `attendance_evidence`, `attendance_reviews`, `attendance_corrections`, `leave_requests` |
| **Permissions** | `attendance.self`, `.review`, `.manage`, `.reports` |
| **Tests** | QR replay and expiry, IP header spoofing, out-of-range GPS, no gallery path, real iPhone and Android |
| **Internal change** | Allow geolocation in Permissions-Policy |
| **Decision** | 4 |

## Phase 4: Employee Task Management

| | |
|---|---|
| **Exists** | Create, assign, comment, event history, overdue filter, workload counts, overdue report |
| **Change** | Priority and status labels; deadline with time |
| **Add** | Start date, completion requirements, attachments, Submitted and manager verification, stored breach and Completed Late, extension history with reason, reminders at 1 day, 6h, 3h, 2h, 1h, at deadline, after and escalation |
| **Reuse** | `tasks`, `task_events`, Phase 1 notifications and files, existing reports |
| **DB** | Additive columns and tables; replacing check constraints with a mapping; `passport_monitor` updated |
| **Permissions** | `tasks.verify`, `tasks.extend` |
| **Tests** | `Asia/Kolkata` timing, each reminder once, scenarios still pass |
| **Decision** | 5 |

## Phase 5: Daily Core Meetings and Minutes

| | |
|---|---|
| **Exists** | Nothing specific |
| **Build** | Meeting records, attendees, agenda, discussion, decisions, action points, Executive Assistant role, modification history, Core Team membership, tasks from decisions with traceability |
| **DB** | `meetings`, `meeting_attendees`, `meeting_agenda_items`, `meeting_decisions`, `core_team_members`; link on tasks |
| **Permissions** | `meetings.read`, `.write`, `core_team.manage` |
| **Tests** | Non-members see nothing, even in direct queries as `erp_app` |
| **Decision** | 6 |

## Phase 6: Internal Employee Chat

Delivered in steps, each usable alone.

| Step | Scope | New dependency |
|---|---|---|
| A | 1:1, Core Team, All Employees, Sales, Marketing, Management and custom groups; text; attachments; reply; edit; delete; search; mentions; unread; pagination; task links; updates by polling | None |
| B | Live delivery, read receipts, typing, presence, reconnection, through Server-Sent Events and `LISTEN/NOTIFY` | None |
| C | Forward, reactions, pin | None |

| | |
|---|---|
| **DB** | `chat_channels`, `chat_members`, `chat_messages`, `chat_message_files`, `chat_reactions`, `chat_reads` |
| **Governance** | Membership-only RLS; no unrestricted reading of private messages |
| **Tests** | Membership isolation, two browsers, reconnection, phones, load on staging |
| **Decision** | 6 |

## Phase 7: Pre-Admission Document Verification

| | |
|---|---|
| **Exists** | Nothing specific. `leads` is a follow-up pipeline and doesn't replace this |
| **Build** | Counselor request, multiple PDFs, review before submit, `DVR-YYYY-000001`, queue, assignment, document-level and overall results, return, resubmission and versions, context-change re-verification, explicit conversion to student, notifications, workload and turnaround reports |
| **Rules** | Checks only against configured, verified requirements, with manual reference otherwise. **No invented rules** |
| **Reuse** | Document viewer, Phase 1 files, rule engine, lead-to-student conversion |
| **DB** | `verification_requests` and related version, file, result and event tables, with a safe sequence |
| **Permissions** | `dvr.create`, `.process`, `.assign`, `.reports` |
| **Tests** | All 20 acceptance steps; counselor can't read others' requests |
| **Decision** | 6 |

## Phase 8: Student Portal Question/Ticket System

| | |
|---|---|
| **Exists** | Portal, sessions, notices, isolation. Today only phone and email links |
| **Build** | Tickets, assigned staff, replies, Open, Pending and Resolved, attachments, history, audit. Internal notes hidden from students |
| **Also** | Visa status in the portal, if approved |
| **DB** | `support_tickets`, `support_ticket_messages` |
| **Permissions** | `tickets.read`, `.reply`, `.assign` |
| **Tests** | One student can't read another's ticket |

## Phase 9: Student Preferences and admissions rules

| | |
|---|---|
| **Exists** | One destination, course and university; three phones; advisory rules; passport rules; workflows |
| **Build** | Primary, Secondary and Tertiary preferences; passport warning on the form; renewal reminders; **source and approval fields on passport rules**; PCC rule; scan-state alignment; merged file name decision |
| **Note** | Existing columns stay as Primary, so workflows, rules and reports keep working |
| **Configuration, not code** | University and course fields **already exist** on the advisory and passport rule forms. Bulgaria 60% can be set by university and programme using them. A notice holds one course, so Nursing and MBBS need one notice each. Not yet exercised on production |
| **Rule data** | Only from official university or embassy sources with MD approval |
| **Passport** | University-specific enforcement already works through the rule's university and course fields. It only needs official sources and recorded approval. Today's `notes` field isn't enough |
| **Tests** | Registration with an expired or missing passport, including import (no such test exists yet); warning-only default; a university block applies only to that university; advisory never blocks |

## Phase 10: Finance improvements

| | |
|---|---|
| **Exists** | INR, USD and EUR; rates; receipts; balances; second-person verification; reports; audit |
| **Build** | Due dates on charges, dues in the portal, added reports; instalments only if wanted |
| **Rule** | Historical values untouched; money stays exact |
| **Decision** | 7 |

## Phase 11: Dashboards and Reports

| | |
|---|---|
| **Exists** | Analytics, charts, operational dashboard, 13 reports |
| **Build** | Business, Finance, Employee and Operational views driven by permissions; task and attendance reports |
| **Fix** | Hard-coded role keys at `(app)/page.tsx:32` and `students/[id]/page.tsx:284` |
| **DB** | None expected |
| **Why last** | It reads data produced by earlier phases |

## Security Hardening (after Phase 11, not started)

**Why it matters:** R-08A remains an unresolved **Critical-impact** risk until this phase is complete. Anyone able to run SQL as `erp_app` can act as any user in any company. Every module built before this phase, including attendance, chat and meeting minutes, carries the same exposure. **The system must not be described as fully secure.**

| | |
|---|---|
| **Scope** | Verified identity from the session token, one extra login for sign-in and system jobs, targeted function checks, restricted audit actor, Stages A and B as a prerequisite. Plan presented 4 Nov 2026 and **not approved**; review it again at that point, because the new modules add functions and policies |
| **Unchanged** | Argon2id, Node-verified MFA, sessions, cookies, Next.js, PostgreSQL, RLS |
| **Remaining after it** | The fix protects against a stolen `DATABASE_URL` and SQL injection. It doesn't protect against theft of the whole `.env` or code running on the server, which server controls can only reduce |
| **Evidence still to prove** | The prototype had a different shape, so its results must be proved again. It left 8 unexplained test failures. Performance needs a budget approved before enforcement |
| **Until then** | Each new function and table follows the existing rules: RLS, permission checks, no PUBLIC access, and the SQL guard. These reduce mistakes in new code; they don't close R-08A |

## Questions for the MD

| # | Question | Recommendation |
|---|---|---|
| 1 | Global passport rule before verified university rules exist | **Decided:** warning only |
| 2 | When Attendance starts | **Decided:** Phase 3 |
| 3 | Employee Profile placement | **Decided:** Phase 2. Still open: defer per-person permission overrides? Recommend yes |
| 4 | Attendance values: offices, hours, grace, half-day, leave types, approvers, selfie retention | Needs your values and legal review |
| 5 | Task mapping: `urgent` to Critical, `normal` to Medium. Keep `waiting_external` and `cancelled`? Who verifies? | Yes to all; verifier is the creator or manager |
| 6 | Governance: Core Team, Executive Assistant, System Admin access to meetings; chat retention and legal access; DVR numbering and retention | No System Admin reading; audited two-person legal access; one sequence per company |
| 7 | What does finance "split" mean, and are instalments wanted? | Due dates first |
| 8 | Scanner | ClamAV on the VPS |
| 9 | Browser push notifications | Later; in-app and email first |
| 10 | Merged PDF name: existing `Name - Passport - University.pdf`, or `Name-Passport-University.pdf`? | Your choice |
| 11 | Who gathers official sources for unverified country rules? | Name an owner |

## Status on 5 November 2026

Phases 1 to 11 are built and tested locally and uncommitted. Migrations 0038 to 0050 are on the local development database only. See `docs/FINAL_ERP_IMPLEMENTATION_REPORT.md` for phase status and `docs/FINAL_ERP_PRODUCTION_READINESS_REPORT.md` for what stands between this work and production.

## Not started

Security Hardening, including the trust boundary work. Commit, push, merge, deployment and every production step are waiting for separate approval.
