# Phase 8: Student Portal Questions (Tickets)

**Status:** built and tested locally. Nothing is committed, pushed or deployed.

## Gap analysis

| Need | Before | Decision |
|---|---|---|
| Students asking questions | Missing | New tickets, called "My questions" in the portal |
| Portal sign-in and session rules | Working | Reused: every student action goes through `app.portal_*` functions keyed by the session |
| File storage and scanning | Working `secure_files` | Reused with a `ticket` context. `uploaded_by` may now be empty, for ticket files only, because a student is not a staff user |
| Notifications | Working | Reused: `portal_notices` for students, `staff_notify` for staff |

## What it does

- **Student:** asks with a category, subject, message and up to 3 attachments; gets a reference (`TKT-YYYY-000001`); reads replies, replies and downloads attachments; searches and filters their own questions.
- **Staff (`/tickets`):** queue with search and filters (assigned to me, unassigned, waiting for us, status, category), conversation, reply with attachments, status, assignment, and history.
- **Statuses:** Open, In Progress, Waiting for Student, Resolved, Closed. A student reply moves "Waiting for Student" to "In Progress" and reopens "Resolved". Closed is final.
- **History:** messages, events and attachments cannot be removed.

## Who sees what

| Person | Access |
|---|---|
| Student | Only their own questions. Replies appear as "Our team": no staff names, assignments or internal notes |
| Staff with `tickets.respond` (MD, CEO, Manager, Counsellor, Documentation, Visa, Finance) | Tickets for students they can read, in a company with access to that student |
| Assignee | That ticket, plus the student's name and ID, even if they cannot otherwise read the student |
| `tickets.manage` (MD, CEO, Manager) | Can assign to anyone eligible. Others can only take a ticket themselves or hand on their own |
| System Admin, other companies | Nothing |

In the default roles, counsellors hold `students.read.all`, so any counsellor in the company can read tickets from that company's students. This follows existing student access and can be narrowed through roles.

A student session has no route to employee management, chat, minutes, internal tasks, finance administration or other students: a test checks that no portal function reads those tables, and a browser test checks that the pages do not open.

## Database

Migration `0048_student_tickets.sql`, rollback tested with real rows. Four tables with RLS: `student_ticket_counters` (no access for the application role), `student_tickets`, `student_ticket_messages`, `student_ticket_events`. Audit entries hold statuses only, never question text.

## Limits

- **Email:** students and staff get in-app notices only. No email is sent for tickets.
- **Categories** are a fixed list in the database; changing them needs a migration.
- **Limit of 10 new questions per student per day**, to prevent misuse. This value is a default and has no business decision behind it.
- **Numbering:** one sequence per company per year, awaiting confirmation.
- **Internal notes** exist only as a note on a status change. There is no staff-only message in the conversation.
- **Virus scanning:** no scanner is installed. Files are labelled for staff; students are not shown a scan label.
- **Retention:** none is defined.
