# Global Chat Notifications: Implementation Report

**Date:** 6 November 2026. **Handling: keep private until you decide otherwise.** It contains no credentials or server details, but the repository this branch belongs to was public when last checked, so do not commit it without a decision.

**Branch:** `chat-enhancement`, based on `f68e97e`. **All work is local and uncommitted.** Nothing was pushed or deployed. The VPS and Production were not accessed. Migrations 0051 and 0052 were later applied to the local development database with your authorization, and otherwise ran only on throwaway databases.

**Status: built and tested locally, not approved for Production.** The final run has one browser failure and there was one intermittent backend failure. Both are explained in section 5.

## 1. Features implemented

| Requirement | Result |
|---|---|
| Alerts on every ERP page | Yes. The notifier lives in the shared staff layout, so it runs without the Chat page open |
| Header unread badge | Yes, with a list of unread conversations. It excludes muted conversations |
| Immediate toast | Yes, once a poll finds the message. See section 3 for the delay |
| Opens the right conversation | Yes, from the toast, the header list and the desktop notification |
| Duplicate prevention | Yes, across navigation, refresh, a second tab and a lost connection |
| Read and unread | A conversation becomes read only when it is actually opened. Polling never marks anything read |
| Desktop notifications | Yes, where the browser permits. Permission is asked only after a click, and never asked again after a refusal |
| Preferences | In-app, sound, desktop, desktop message text, and mute per conversation or group |
| Mobile | The toast and badge fit at 360 px and 390 px. The header menus stay on screen from 320 px |
| Isolation and authorization | Only the person's own active memberships are returned, read through the existing row-level security |

**Defaults:** in-app on, sound off, desktop off, message text hidden in desktop notifications.

## 2. Files changed

**Modified (13)**
- Backend: `backend/src/lib/auth/session.ts`, `backend/src/routes/chat.routes.ts`, `backend/src/services/chat.ts`
- Frontend: `frontend/src/app/(app)/layout.tsx`, `frontend/src/app/(app)/chat/chat-room.tsx`, `frontend/src/app/(app)/chat/list-refresher.tsx`, `frontend/src/app/(app)/chat/page.tsx`, `frontend/src/app/(app)/my-notifications/preferences/page.tsx`, `frontend/src/app/actions/chat.ts`
- Existing tests: `backend/tests/integration/migrations.test.ts`, `backend/tests/support/schema-counts.ts`, `frontend/tests/e2e/phase-6-chat.spec.ts`, `frontend/tests/e2e/responsive.spec.ts`

**New (12, plus this report)**
- Database: `backend/db/migrations/0052_chat_notifications.sql`, `backend/db/rollbacks/0052_chat_notifications.down.sql`
- Backend: `backend/src/services/chat-notifications.ts`
- Frontend: `frontend/src/app/(app)/chat-notifier.tsx`, `frontend/src/app/(app)/my-notifications/preferences/chat-alerts.tsx`, `frontend/src/app/api/chat/notifications/route.ts`, `frontend/src/components/chat-notify-logic.ts`, `frontend/src/components/desktop-notifications.ts`, `frontend/public/chat-notifications-sw.js`
- Tests: `backend/tests/integration/chat-notifications.test.ts`, `frontend/tests/integration/chat-notify-logic.test.ts`, `frontend/tests/e2e/phase-6b-chat-notifications.spec.ts`

`docs/PR_3_READ_ONLY_REVIEW.md` is also untracked. It is the earlier PR review, not part of this feature.

**Changes to existing tests, for your review**
- Policy count 202 → 204 and RLS table count 139 → 141, because 0052 adds two tables and two policies. These pins exist so that such a change is counted on purpose.
- The 0045 rollback test now expects 8 tables, 20 functions and 7 policies with chat names, for the same reason.
- `responsive.spec.ts` now expects three header menus (chat, alerts, profile) and checks all three on screen.
- `phase-6-chat.spec.ts` looks for message text inside the main page area, because a toast can now show the same text.

## 3. Delivery mechanism and expected delay

**Delivery is by polling. It is not instant and not push.** No new infrastructure was added.

| Situation | Expected delay |
|---|---|
| Tab visible | Up to about 5 seconds, plus request time |
| Tab hidden | Up to about 15 seconds as designed. Browsers often slow hidden tabs to about once a minute, and may freeze them |
| After network failures | Retries back off from 5 to 60 seconds. Unread counts recover on the next successful poll |
| Browser closed or device asleep | **Nothing is delivered until the ERP is next open.** There is no Web Push |

The tests allow up to 25 seconds for an alert to appear. Individual delivery times were not timed, so the figures above are the design intervals, not measurements.

**Load:** tabs in one browser share a single poller, chosen by a browser lock, and share results with each other. Each signed-in person therefore makes about 12 requests a minute per browser while visible, so 100 people with the ERP visible would make about 20 requests a second. This is arithmetic. **Load was not measured at Production scale.** If it proves too heavy, the interval is set in one place, `nextDelay` in `chat-notify-logic.ts`.

The poll uses a new read-only session check, so an idle open tab does not keep a session alive and the 8-hour idle limit still applies. An open conversation on the Chat page still extends the session, as it did before this work.

## 4. Mobile and browser limitations

- **iPhone Safari, ordinary tab:** no system notifications, because the browser has no Notification API there. Home Screen web apps have it from iOS 16.4, but this work does not use push, so nothing arrives when the app is closed. In-app alerts work while the page is open.
- **Android Chrome:** system notifications need the service worker route, which is included. It only handles the click and stores nothing.
- **Phones generally:** browsers suspend background pages, so background delivery is unreliable.
- **Not tested on real devices.** Mobile results come from Chromium at phone screen sizes, not from an iPhone or Android phone.
- **Simulated in tests:** the browser's Notification pop-up was replaced by a recorder, and hidden tabs were simulated. The real pop-up, the service worker click and real browser throttling were not exercised.
- Desktop on/off is remembered per browser. The other preferences follow the person.
- Sound plays only after the person has interacted with the page, as browsers require.

## 5. Test results

Run on fictional data on a throwaway PostgreSQL 17.11 database, in a scratch copy. The browser suite used separate ports, so your dev servers on 3000 and 4000 were not touched. The results come from the logs, not from exit codes.

| Check | Result |
|---|---|
| Backend, main run | **667 of 667 passed** |
| Backend, migrations | **15 of 15 passed**, including the 0052 rollback and re-apply |
| Backend, student merge | **21 of 21 passed** |
| Frontend | **141 of 141 passed** |
| Typecheck, lint | Passed |
| Browser, full suite | **182 of 183 passed, 1 failed, 0 skipped** |
| Existing chat browser tests | 8 of 8 passed |
| New notification browser tests | 8 of 8 passed |
| Responsive header menu tests | 5 of 5 passed |
| SQL guard | 374 files, 22 findings, all 22 approved in the baseline, 0 not approved |
| Build | Compiled successfully |

SQL guard and build ran just before the final run. Only test files changed after them.

**Failure in the final run: browser test, meetings workflow (`phases-2-5-workflows.spec.ts:172`).** All its workflow steps completed. It failed at the end because the browser reported `Failed to execute 'measure' on 'Performance': 'MeetingPage' cannot have a negative time stamp` on two pages. This appears to be a timing error from React's development mode, but I have not proved that. The test file then passed 5 of 5 on each of three repeat runs. The same error appears in the logs of the PR #3 review, from before this feature existed, so this work does not appear to have introduced it. It still counts as a failure, and the error has not been fixed.

**Intermittent backend failure, cause unknown: `phase-6-chat.test.ts`, "pagination returns earlier messages".** It failed once in an earlier full run. It then passed 6 of 6 runs alone, 6 of 6 full runs with diagnostics, and the final run. The diagnostics never fired, so the actual values were not captured. This work did not change the pagination code. It is worth watching because it concerns loading older messages.

**Found and fixed during verification**
- A long message made the toast about 66 px wider than a 360 px phone screen. This was a real display bug. The mobile test now uses a long message.
- Pages left open by earlier tests were marking messages read, which caused a false failure. The new spec now closes them first.
- The removed-member check could match the same person's name in the conversation list. It now looks only in the Members panel.

**The 15 requested scenarios**

| # | Scenario | Evidence |
|---|---|---|
| 1, 2 | Staff to MD, MD to staff | Browser |
| 3 | Group reaches all members | Browser, backend |
| 4 | Unauthorized user receives nothing | Browser, backend |
| 5 | Other company receives nothing | Browser, backend |
| 6 | No duplicates | Browser |
| 7 | Unread count correct | Browser, backend |
| 8 | Click opens the conversation | Browser |
| 9 | Read status correct | Browser, backend |
| 10 | Continues after navigation | Browser |
| 11 | Permission granted | Browser, **with a simulated Notification** |
| 12 | Permission denied or unavailable | Browser, **with a simulated Notification** |
| 13 | Background tab | Browser, **with a simulated hidden tab** |
| 14 | Mobile | Browser, **phone screen sizes only** |
| 15 | Existing chat still works | Browser, backend |

## 6. Database migration requirements

**Migration 0052 is required.** With your authorization, 0051 and 0052 were applied to the local development database on 6 November 2026 after a verified backup (`.data/backups/pre-0051-2026-11-06T04-56-40`). They have not been applied to Production or the VPS.

- **Adds:** tables `chat_notification_settings` and `chat_conversation_mutes`, each with a policy letting a person read only their own rows; functions `app.chat_save_notification_settings`, `app.chat_set_mute` and `app.auth_peek_session`.
- **Order:** after 0038 to 0051. Production's pending count is now 15 if its baseline is as reported. `docs/PRODUCTION_PENDING_MIGRATION_INVENTORY.md` still says 14 and was not changed.
- **Apply before the new code runs.** From reading the code, the Chat page, the preferences page and the poll all use these objects, so they fail without 0052. The local Chat page showed exactly this error before 0052 was applied.
- **Rollback:** tested on a throwaway database. It loses alert settings and mutes only. Messages, memberships and read state are not changed. Roll the application back first.
- **Not verified:** PostgreSQL 18 (reported for Production), real data size, or lock times.

## 7. Security and privacy checks

**Tested**
- Only members of a conversation receive it. Removed members and inactive memberships stop receiving it.
- The MD and managers get no extra access through this feature. Direct messages between others do not appear in the MD's response.
- Other companies receive nothing.
- A signed-out request receives only `{ signedIn: false }`.
- No message text is stored in browser storage.
- Desktop notifications show generic text unless the person turns message text on.
- Polling does not mark messages read or extend the session.
- The service worker accepts only `/chat?c=<uuid>` links and caches nothing.

**Unchanged:** Argon2id, MFA, RLS design, database login, audit logging and chat governance.

**For your review: an auth-adjacent change.** `session.ts` gains `getPassiveSession()`, and 0052 adds `app.auth_peek_session`. These are additive. The check is the same as the existing session check, except that it does not update the last-seen time. `getSession` itself behaves as before.

**Message previews do reach the browser.** Members receive up to 20 unread conversations with sender and preview in the poll response. They are authorized to read these messages, but a preview can appear on screen in a toast, so a shared or watched screen could show it.

These checks cover this feature only. They are not a penetration test and do not show the ERP is fully secure. The existing `erp_app` trust boundary is unchanged and still open. Passing local tests does not prove Production compatibility.

## 8. Remaining issues

1. Meetings browser test: intermittent development-mode error, not fixed (section 5).
2. Pagination backend test: one unexplained failure (section 5).
3. No real iPhone, Android, or real system notification testing.
4. No delivery when the browser is closed, because there is no Web Push.
5. Load not measured at Production scale, and delivery times not timed.
6. Muted conversations are left out of the badge but stay unread in the conversation list.
7. "Delivered" receipts update only from the Chat page, not from the global poll.
8. The existing bell is unchanged. `docs/PHASE_6_INTERNAL_CHAT.md` describes that bell and doesn't mention these alerts.
9. The migration inventory needs updating to include 0052.
10. The final browser run covers this code on a fresh test database, not an upgrade of real data.

**Stopped here, awaiting your approval.**
