# Phase 6: Internal Employee Chat

**Status:** see the Phase 6 completion report. Local development only: nothing is committed, pushed or deployed.

## What it does

| Feature | How it works |
|---|---|
| One-to-one chat | One conversation per pair of people per company, opened from either side |
| Groups | Core Team, All Employees, Sales, Marketing, Management and custom groups |
| Creating groups | Needs `chat.groups.manage` (MD, CEO, Manager) |
| Membership | Managed by the group's admin. All Employees and Core Team fill from the company list, with a refresh button |
| Messages | Text, replies, forwarding within a company, edit, delete, reactions, pinning, mentions |
| Attachments | PDF, JPEG, PNG or WebP, up to 10 MB, through secure file storage (context `chat`) |
| Task references | A message can link to one of your open tasks, chosen above the message box. The database checks that the sender may read that task |
| Status | Read and delivery receipts, typing indicator, online or offline, unread counts |
| Search and history | Search covers only conversations you belong to. "Load earlier messages" pages back 50 at a time |
| Notifications | Direct messages and mentions only. An ordinary group message doesn't notify. Text is generic and never contains the message |

## Who can read what

- **Members only.** Row-level security applies to every chat table. The MD, System Admin and managers can't read a conversation they aren't in.
- **Leaving ends access.** A person who leaves or is removed loses access to the whole conversation at once, including its files.
- **Company isolation.** Direct messages and group members must belong to the conversation's company. Messages can't be forwarded to another company.
- **Audit.** Group creation, membership changes, edits and deletions are logged. Audit entries never contain message text.

## Governance: retention, legal holds and investigation access

**Nobody has general access to private conversations.** No permission grants it, so a role can't be given it. The database recognises the MD by the protected role, and everyone else only through a named grant from the MD.

| Requirement | How it works |
|---|---|
| Retention policy | Set per company by the MD only: how long messages stay visible, and how long the archive is kept |
| No automatic removal by default | Nothing is archived or erased until the MD sets a period, gives the approved policy's reference and turns it on. **No period is built in, and this document doesn't recommend one.** The company must decide it, with legal advice where needed |
| Edited versions | Each earlier version is kept in `chat_message_history` |
| Deleted messages | The text moves to the same archive. Other people see only "Message deleted" |
| Archive access | The application role has no access to the table. The only way in is `app.chatgov_read` |
| Named authorities | The MD names requesters, approvers and readers, with a reason. Removal is recorded |
| Authorisation | A request needs a reason, a case reference, a scope and a named reader. The MD or a named approver then decides it, with a reason and a 1 to 30 day access period |
| Separation of duties | The approver can't be the requester or the reader, and nobody can decide a case about their own messages. The reader can't be a person under review. The MD can request and approve, but reads only with an explicit reader grant |
| Access ends | When the period expires, the request closes, or the reader's grant is removed |
| Scope | Messages one person sent, one direct conversation between two people, or one group, optionally between two dates |
| Record of each read | The reason, requester and approver are on the request. The access log records the reader, time and exact message IDs |
| Tamper resistance | The access log and retention runs refuse updates and deletes. Requests, holds and grants refuse deletes. The archive refuses updates, and refuses deletes except by the retention job. Each trigger applies even to a full-rights connection |
| Legal hold | The MD or a named approver can hold a person, a group or the whole company. Held messages and archive entries are skipped by retention. A hold never hides anything from the people in a conversation |

Screens: `/chat/governance` and `/chat/governance/<request>`. They appear only to the MD and named authorities. Messages open only when the reader presses "Open the messages", never when the page loads. The daily job applies retention, and does nothing for a company without an approved policy turned on.

**Decisions the MD needs to make**
- The retention periods, and whether to turn automatic removal on.
- Who to name as requesters, approvers and readers. The ERP has no separate Legal or HR role, so the MD names individuals.
- Whether employees should be told about this policy. Take legal advice on privacy and employment notice duties.

**Governance limits**
- **A database superuser can still bypass this.** Someone with direct server access could disable a trigger. These controls stop the application and its users, not a server administrator. This is part of the postponed trust boundary work.
- **Attachments under review show only metadata.** The reader sees the file name and SHA-256 hash, but can't open the file from this screen.
- **No export.** The reader views messages on screen only.
- **Requests can't be edited.** A wrong request must be rejected or closed, and a new one raised.
- **Scheduler unverified.** Retention runs from the daily job, and the server's scheduler hasn't been confirmed (R-05).

## Limitations

These are limits, not completed capabilities.

- **Polling every 3 to 5 seconds. WebSocket is not implemented.** The open conversation checks every 3 seconds and the conversation list every 5, so updates can be a few seconds late. "Online" means active on a chat page in the last 45 seconds. "Delivered" means the other person's chat page checked in after the message was sent. There is no browser push.
- **No load testing has been done.** Polling load grows with the number of open pages.
- **Real virus scanning is unavailable.** No scanner is installed, so attachments are labelled "not virus-scanned".
- **One attachment per message.**
- **Forwarding copies text only.** Attachments aren't forwarded.
- **Plain-text search.** Search is a simple text match and doesn't use the full-text index, so it will slow down as messages grow.
- **Attendance kiosk QR** (Phase 3) has backend tests but no browser test.
- **Trust boundary.** These controls rely on the same database identity as the rest of the ERP, so they share the known limit described in `ARCHITECTURE.md`.

## Files

- Database: `backend/db/migrations/0045_internal_chat.sql`, `0047_chat_governance.sql` and their rollbacks in `backend/db/rollbacks/`
- Backend: `backend/src/services/chat.ts`, `chat-governance.ts`, `backend/src/routes/chat.routes.ts`
- Frontend: `frontend/src/app/(app)/chat/`, `frontend/src/app/actions/chat.ts`, `chat-governance.ts`, `frontend/src/app/api/chat/sync/route.ts`
- Tests: `backend/tests/integration/phase-6-chat.test.ts`, `phase-6-chat-governance.test.ts`, `backend/tests/integration/migrations.test.ts`, `frontend/tests/e2e/phase-6-chat.spec.ts`

## Running it locally

Chat needs the internal API: `npm run dev:api`, with `INTERNAL_API_SECRET` set in `.env` as the README describes. Without it, the conversation page shows "Connection lost".
