# Chat Redesign: Audit and Implementation Plan

**Date:** 6 November 2026. **Handling: keep private until you decide otherwise.** It contains no credentials or server details.

**Branch:** `chat-enhancement`. Local work only. Nothing here was committed, pushed or deployed.

## 1. What exists today

| Area | Where |
|---|---|
| Screens | `frontend/src/app/(app)/chat/` (`page.tsx`, `chat-room.tsx`, `group-form.tsx`, `list-refresher.tsx`, `governance/`), `(app)/chat-notifier.tsx`, `my-notifications/preferences/chat-alerts.tsx` |
| Server actions | `frontend/src/app/actions/chat.ts`, `chat-governance.ts` |
| Services | `backend/src/services/chat.ts`, `chat-notifications.ts`, `chat-governance.ts`, `secure-files.ts` |
| Internal API routes | `backend/src/routes/chat.routes.ts`; proxied by `frontend/src/app/api/chat/` |
| Database | Migrations 0045 (chat), 0047 (governance), 0052 (alerts) |
| Tables | `chat_conversations`, `chat_members`, `chat_messages`, `chat_reactions`, `chat_message_history`, `chat_presence`, `chat_notification_settings`, `chat_conversation_mutes`, six `chatgov_*` tables |
| Tests | `phase-6-chat`, `phase-6-chat-governance`, `chat-notifications` (backend); `chat-notify-logic` (frontend); `phase-6-chat`, `phase-6b-chat-notifications`, `responsive` (browser) |

**Delivery:** polling, every 3 seconds in an open conversation and 5 to 15 seconds for the global alerts. No WebSockets or Redis, and none are needed for the planned work.

**Writes:** every change goes through a database function (`app.chat_*`). Row-level security lets members read their own conversations only. The MD has no automatic access; governance access requires a recorded request.

### Features that already work

Direct and group messages, member management, automatic company groups, leaving a group, replies with a preview, forwarding, editing (with history), soft deletion, six fixed reactions, message pinning, task linking, @mentions with notifications, delivery and read states, typing, online and offline, attachments (PDF, JPEG, PNG, WebP up to 10 MB, private storage), message search, global alerts, per-conversation mute, and governance (retention, holds, requests, delegates, access log).

### Defects found during this audit

| # | Defect | Status |
|---|---|---|
| 1 | "Load earlier messages" worked only once, so history beyond 100 messages could not be reached | Fixed in Phase 1 |
| 2 | Once older messages were loaded, 50 further new messages would leave a gap | Fixed in Phase 1 |
| 3 | Every new message pulled someone reading older messages back to the bottom | Fixed in Phase 1 |
| 4 | Search results opened the conversation but not the message | Fixed in Phase 1 |
| 5 | Chat attachments of 10 MB or more failed with an error page (known proxy limit) | Stopped in the browser with a clear message. The server limit is not changed |
| 6 | An edited message outside the latest 50 stays out of date on screen until the page reloads | **New limit of the Phase 1 fix.** To fix in Phase 2 |

### Where your brief differs from the code

Your brief lists **TypeORM** and **JWT** as existing. The code uses **SQL functions through postgres.js** and **hashed session tokens in the database**. I'm keeping the actual design, in line with your 4 November decision against a TypeORM migration.

## 2. Plan by phase

"Migration" means the item cannot be built without new database objects.

### Phase 1: UX foundation. **Built.** No migration

Two-pane layout, sidebar with profile, New chat and New group, combined search, filters (All, Unread, Personal, Groups, Muted), list with avatars, times, online dots, unread counts and mute marks, redesigned header, bubbles, date separators, unread divider, grouped messages, tick marks, loading skeleton, latest-messages button, message menu, information panel, emoji picker for typing, mention suggestions, attachment preview with removal, full-screen mobile conversation.

**Pinned and Archived filters are not shown yet,** because they need Phase 3 storage. Your brief forbids controls that don't work.

### Phase 2: message experience

| Item | Migration |
|---|---|
| Bold, italic, strikethrough, inline code, safe automatic links (rendered as React elements, never raw HTML) | No |
| Message information (who has received and read it) | No |
| Search filters: sender, date, conversation, attachments, file names | No |
| Any emoji as a reaction | **Yes**: the table allows six fixed values |
| Starred messages | **Yes** |
| Report a message to governance | **Yes** |

### Phase 3: groups and organisation

| Item | Migration |
|---|---|
| Shared media, documents and links in the information panel | No |
| Promote and demote admins, transfer on leaving | **Yes**: new database function |
| Pin, archive, mark unread (per person) | **Yes** |
| Mute for a set time | **Yes**: the mute table has no end time |
| Group description, photo, who may post or edit, membership history | **Yes** |

### Phase 4: media

| Item | Migration |
|---|---|
| Inline image previews, several attachments per message, upload progress | No, but several attachments needs an action change |
| Word, Excel, PowerPoint, audio, video, voice notes | **Yes**: the `secure_files` table limits file types. The storage layer's signature check must also grow |
| Files up to 150 MB | **Separate design phase.** See section 3 |

### Phase 5: realtime and notifications

Reconnection, retry for failed sends, sending and failed states with stable message ids to stop duplicates (**migration**: a client-supplied id), last seen with a privacy setting (**migration**), reply and group-invitation notifications (**migration**: new function), mention-specific alerts.

### Phase 6: advanced

| Item | Recommendation |
|---|---|
| Voice and video calls | **Defer.** Reliable calling needs a TURN server, which is new infrastructure. No call buttons will be shown |
| Disappearing messages | **Don't build.** It conflicts with retention and legal holds |
| Clear conversation | Per-person hide only. Records stay, for the same reason |
| Link previews fetched by the server | **Defer.** Fetching arbitrary addresses creates a server-side request forgery risk. Links stay plain and safe |
| Chat wallpaper | Low value, leave out unless you want it |

## 3. 150 MB uploads

**Not safe in the current design.** All uploads pass through a Next.js server action and are held in memory. Raising that limit would hold 150 MB per upload in memory and still hit the proxy buffer.

The safe route is direct-to-S3 multipart upload, with the server authorising each step, fixing the object key, checking size and type on completion, and cleaning up aborted uploads. It needs a migration, more IAM permissions and bucket CORS rules. **The bucket and IAM changes are yours to approve, and it affects every upload form, so it should be a separate phase.**

## 4. Proposed migration

**0053 is required for most of Phases 2 to 5.** I recommend one reviewed migration per phase. **None has been written or applied.** Local dev and Production are unaffected until you approve one.

Why it needs your decision: the dev app runs from this working tree, so code that depends on a new table fails until that migration is applied to your dev database, as the Chat page did with 0052. Each migration would first be tested on a throwaway database, including its rollback, with a verified backup before applying it to dev.

Production's migration state is still unverified, and it would need these too.
