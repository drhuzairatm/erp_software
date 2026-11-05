# Notifications: email, WhatsApp, SMS

## How it works

```
event (stage change, document review, registration, visa outcome)
  → rules of the student's brand (event × channel × student/parent; on/off; stage filter)
  → consent check → outbox message → sender → provider
```

- **Consent first.** A message is prepared only if the student (or parent) has consented to that channel;
  otherwise it is recorded as *Skipped – no consent*. Consent is recorded at registration (tick-boxes) or on
  the student's **Messages** tab, with how it was given; withdrawals ("STOP") are recorded the same way.
  Consent history cannot be edited or deleted.
- **Rules are per company** and start **switched off**. Turn them on under *Notification settings* after
  checking the wording. Stage-change messages can be limited to chosen stages.
- **Templates** are editable per company and channel; placeholders: `{{student_name}} {{student_code}}
  {{parent_name}} {{company}} {{stage}} {{next_action}} {{next_action_due}} {{document}} {{reason}}
  {{visa_outcome}} {{counsellor}}`. Internal notes are never included.
- **Sending** happens right after the staff action, plus every minute by the scheduled sender (retries).
  Temporary provider errors are retried up to 5 times with increasing delays; permanent errors are marked
  *Failed* with the provider's message. A message is shown as *Sent* only when the provider accepted it.
- **Test mode** (`NOTIFICATIONS_MODE=test`, the default) sends nothing; messages are kept as *Test – not
  sent* with the exact wording. Numbers/addresses in `NOTIFICATIONS_TEST_RECIPIENTS` (e.g. your own phone)
  do receive real messages, so you can try the providers safely.

## Employee notifications (Phase 1)

Separate from student and parent messages. Each employee sees their own at **My notifications** and in the header bell, with no permission needed; nobody else can read them, including the MD.

| Event | Goes to | Email |
|---|---|---|
| Task assigned or reassigned | New assignee | Yes |
| Comment on a task | Assignee and creator | No |
| Task completed by someone else | Creator | No |
| File added to a task | Assignee and creator | No |
| Task due within 2 days | Assignee | No |
| Task overdue, up to 3 days after its due date | Assignee | Yes |
| Document waiting for approval | People who can approve it, except its verifier and submitter | Yes |
| Document rejected or changes required | Staff assigned to the student | Yes |
| File quarantined by a later scan | Uploader | Yes |

- Nobody is told about their own action.
- Text and emails hold no personal data. The task or document name appears on the page only while the reader can still see that record.
- Email uses the system email settings and test mode below. The per-minute job sends it, retrying up to 5 times; mail older than 24 hours is skipped. If email isn't configured, notifications stay in the app.
- Reminders come from the daily job, once per task and due date. **Email and reminders need a scheduler calling the cron routes.**

## Modes and the required configuration (finding N-8)

| Environment | How it is recognised | `NOTIFICATIONS_MODE` | Local test mailbox |
|---|---|---|---|
| **Production** | `NODE_ENV=production` and `APP_ENV` unset, empty or `production` | **must be exactly `live`**. Missing, empty, `test`, `LIVE` or anything else → **the server serves nothing** (HTTP 500 to every request) | refused (server does not start) |
| **Staging / preview** | `NODE_ENV=production` and `APP_ENV=staging` | must be exactly `test` or `live` | refused |
| **Development / automated tests** | any other `NODE_ENV` | `test` or `live`; unset or invalid = test mode, with a warning | allowed with `NOTIFICATIONS_TEST_MAILBOX=1` |

Any other `APP_ENV` value in a production build is refused, so the rule cannot be bypassed by a misspelling. "Refused" means the
server **will not serve the application**: every request, `/api/health` included, is answered with HTTP 500, and the log shows "Refusing to start: …". The process itself keeps running, so set up your health check on `/api/health` so that the failure is noticed. The check
runs once when the server starts (`src/instrumentation.ts` → `src/server/config/notifications-config.ts`). It does not
run during `next build`. *Notification settings* shows the current configuration with any error or warning.

**Running a production build locally** (`npm run build && npm start`) is "production" too. Set `NOTIFICATIONS_MODE=live`
(without email/WhatsApp credentials nothing is delivered; messages are marked *Skipped – not configured*) or set
`APP_ENV=staging` with `NOTIFICATIONS_MODE=test`.

### Sign-in codes and email-verification links (secure authentication queue, N-8)
Portal sign-in codes (email or WhatsApp) and email-verification links are **not in the outbox**. They go through
`auth_private.auth_message_outbox`, which the application's database role cannot read. The code or link is stored only
**encrypted** (AES-256-GCM, key derived from `MFA_ENCRYPTION_KEY` with HKDF label `erp-auth-message-v1`, bound to the
message kind). It is decrypted only in server memory when it is sent. It is **wiped** as soon as the message is sent,
fails finally, is skipped, is recorded in test mode, expires or is cancelled. A queued message is **cancelled at once**
when the code is used, its 5 attempts are used up, a newer code or link replaces it, the link is used, the student's
email (or the phone or email it was sent to) changes, the student is archived or merged, or the code or link expires.
It is re-checked again just before every send and retry, so an expired, used or replaced secret is never sent, not even
on a retry. Staff see a status row only (*Sign-in code – hidden for security*), with no text and no *Retry*. The
student asks for a new code, and staff use *Send verification email* again.

In **test mode** these messages are recorded as *Test – not sent* and the code or link is wiped. It is not stored anywhere.

### Local test mailbox (development only)
To complete sign-in and email verification with **fictional** accounts in development, start the dev server with
`NOTIFICATIONS_TEST_MAILBOX=1 npm run dev` (and `NOTIFICATIONS_MODE=test`). Codes and links are then written to
`.data/test-mailbox/` (git-ignored; folder `0700`, files `0600`, owner only) instead of being sent. They never go to the
database, a staff screen or an API. The browser tests (`npm run e2e`) need this, and the helper deletes each message once
it has read it. The mailbox is off unless the value is exactly `1` and `NODE_ENV` is not `production`. Production and
staging serve nothing (HTTP 500) when the variable is set. Never use it with real student data.

## Setting up the channels (technical administrator)

Credentials live only in the server environment (never in the database or the code).

### System email — staff invitations, staff password resets, security alerts
Sent separately from the per-company student and parent email below. Two providers are supported: SMTP with Nodemailer
when all `SYSTEM_MAIL_*` settings are valid, otherwise Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set
(`EMAIL_FROM` may be a bare address or `Name <address>`). The SMTP steps are:
1. Create or choose one sending mailbox, e.g. `no-reply@<domain>`. A domain does not include mailboxes: create it with your email provider.
2. Get its SMTP settings. Google Workspace or Gmail: an *App password*, host `smtp.gmail.com`, port `465`. Microsoft 365:
   host `smtp.office365.com`, port `587`, with SMTP AUTH enabled for that mailbox. Check your provider's daily sending limit.
3. In the server environment only, set all five:
   `SYSTEM_MAIL_HOST`, `SYSTEM_MAIL_PORT` (`465` = implicit TLS, `587` = STARTTLS required; other ports are refused),
   `SYSTEM_MAIL_FROM_EMAIL` (one bare address, which your provider must allow this account to send from),
   `SYSTEM_MAIL_USER` and `SYSTEM_MAIL_PASSWORD`. Then restart the application so it reads them.
4. Make sure SPF, DKIM and DMARC for the sending domain include the mail provider.
5. Make sure the server can reach the SMTP host on that port (some hosts restrict outbound mail ports).

**If neither provider has complete, valid settings**, nothing is sent and no error appears at start-up. Invitation links are shown once
to the administrator, the forgot-password page asks staff to contact an administrator, and alerts stay pending.

**Test mode applies.** Unless `NOTIFICATIONS_MODE` is exactly `live`, system email goes only to `NOTIFICATIONS_TEST_RECIPIENTS`, and
no provider is contacted for anyone else. Invitation links are then shown to the administrator, reset emails are recorded as skipped
with the link wiped, and security alerts stay pending. A server moving to this version must have `NOTIFICATIONS_MODE=live` to keep
sending (production start-up already requires it).

### Email — your business mailboxes (Dr.Expert and GRADUATER)
1. Create a sending mailbox per brand, e.g. `updates@<drexpert-domain>` and `updates@<graduater-domain>`.
2. Get its SMTP settings from your email provider (Google Workspace: use an *App password* with
   `smtp.gmail.com:465`; Microsoft 365: `smtp.office365.com:587` with SMTP AUTH enabled for that mailbox).
3. Set `EMAIL_SMTP_URL_EDX=smtps://updates%40domain:APP_PASSWORD@smtp.gmail.com:465` and
   `EMAIL_FROM_EDX="Dr.Expert Edulinks <updates@domain>"`; same for `_GRD`.
4. Make sure SPF/DKIM for the domains include the mail provider (usually already true for Workspace/365).

### WhatsApp — Gallabox
1. In Gallabox: Settings → **API keys** → create a key; note the API key and secret.
2. Note the **channel id** of each WhatsApp number (one per brand if the brands use different numbers).
3. Create and get Meta approval for one **template per message type** in Gallabox (e.g. `application_progress`
   with variables for name, student ID and stage). The template wording must match what you enter here.
4. In *Notification settings* → each WhatsApp template: enter the **approved template name** and the
   variables in order (`gallaboxVariable=placeholder` if the names differ, e.g. `name=student_name`).
5. Set `GALLABOX_API_KEY`, `GALLABOX_API_SECRET`, `GALLABOX_CHANNEL_ID_EDX`, `GALLABOX_CHANNEL_ID_GRD`.
6. **Verify before going live:** add your own number to `NOTIFICATIONS_TEST_RECIPIENTS`, trigger a stage
   change for a fictional student with your number, and confirm the message arrives.

> The request format used for Gallabox (`POST /devapi/messages/whatsapp` with `apikey`/`apiSecret` headers,
> `channelId`, `recipient`, `whatsapp.template.templateName` and `bodyValues`) follows Gallabox's API as
> commonly used but has **not yet been tested against your account**. Step 6 confirms it; adjust
> `GALLABOX_API_URL` or the variable names if Gallabox's response indicates a difference. Delivery/read
> receipts (Gallabox webhooks) are not yet connected — messages show *Sent* when Gallabox accepts them.

### SMS
Not available yet. In India, business SMS requires **DLT registration** (company as Principal Entity,
6-character sender ID, every message template pre-approved), then an SMS provider (e.g. MSG91, Gupshup).
Until then SMS rules record messages as *Skipped – SMS provider not configured*.

### Daily job
`GET /api/cron/daily` (same `CRON_SECRET`, scheduled once a day in `vercel.json`) creates passport follow-up and escalation tasks
and marks expired email-verification links. See docs/PASSPORT_AND_CONTACTS.md.

### Scheduled sender
Production calls `GET /api/cron/notifications` every minute with `Authorization: Bearer <CRON_SECRET>`.
On Vercel this is configured in `vercel.json` (per-minute cron needs the Pro plan) and Vercel adds the header
automatically when `CRON_SECRET` is set. Without it, messages are still sent right after staff actions,
but retries wait until the next action. Staff with outbox access can also click *Process queue now*.
The same job also delivers staff password-reset emails (N-1), student-portal set-up and reset emails (N-7), and portal
sign-in codes and email-verification links (N-8) from their encrypted queues. Without it they wait until the next request, and they expire (staff: 1 hour; portal: 1 or 72 hours).

## Switching to live
1. Wording of every enabled template approved (WhatsApp templates approved by Meta in Gallabox).
2. Channels configured and tested with your own number/address (test list).
3. Consent being recorded for real students.
4. Set `NOTIFICATIONS_MODE=live` and redeploy. (Production does not start without it; see *Modes* above.)

## Who can see what
- *Messages* (outbox) — `notifications.view` (managers, MD) and anyone who may see a student's contact
  details (the student's Messages tab). Finance and staff without contact permission see nothing.
  **Student-portal set-up and password-reset emails are not in the outbox at all** (finding N-7). They go through the
  encrypted portal email queue that no staff member can read, and staff see only their delivery status on the
  student's portal account card (docs/STUDENT_PORTAL_V2.md). **Portal sign-in codes and email-verification links are
  not in the outbox either** (finding N-8). They go through the encrypted authentication queue above. `notifications.view`
  holders (MD, managers) see a redacted status row for their own company only. Contact-details holders do not see them,
  and no staff member, the MD included, can see a code, a link or the rendered message in any status.
- *Notification settings* — `notifications.manage` (MD, system administrator).
- Recording consent — `notifications.consent` (managers, counsellors, MD).
