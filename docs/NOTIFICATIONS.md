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

## Setting up the channels (technical administrator)

Credentials live only in the server environment (never in the database or the code).

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
The same job also delivers staff password-reset emails (N-1) and student-portal set-up and reset emails (N-7) from their
encrypted queues. Without it they wait until the next request, and they expire (staff: 1 hour; portal: 1 or 72 hours).

## Switching to live
1. Wording of every enabled template approved (WhatsApp templates approved by Meta in Gallabox).
2. Channels configured and tested with your own number/address (test list).
3. Consent being recorded for real students.
4. Set `NOTIFICATIONS_MODE=live` and redeploy.

## Who can see what
- *Messages* (outbox) — `notifications.view` (managers, MD) and anyone who may see a student's contact
  details (the student's Messages tab). Finance and staff without contact permission see nothing.
  **Student-portal set-up and password-reset emails are not in the outbox at all** (finding N-7). They go through the
  encrypted portal email queue that no staff member can read, and staff see only their delivery status on the
  student's portal account card (docs/STUDENT_PORTAL_V2.md). Portal sign-in codes and email-verification messages are
  unchanged: they remain hidden from contact-details holders, and their code or link is removed once sent, failed or skipped.
- *Notification settings* — `notifications.manage` (MD, system administrator).
- Recording consent — `notifications.consent` (managers, counsellors, MD).
