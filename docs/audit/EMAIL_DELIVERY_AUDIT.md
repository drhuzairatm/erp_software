# Email delivery audit (read-only)

| | |
|---|---|
| Date | 4 Nov 2026 |
| Code reviewed | Local repository, branch `refactor/express-api`, commit `af63526` |
| Method | Read source, migrations, package files, tests and docs. For the local `.env`, only checked whether each variable is set, empty or absent. |
| Not done | No email sent. No test suite run. No database queried. No provider account, DNS record or server accessed. No value, credential or personal data printed. |

**Production caveat.** This audit describes the local code. The commit previously observed on the VPS (`f36328f`) is not in this repository, so the deployed email code may differ. The local `.env` is a development file and says nothing about production.

## 1. Summary

| Question | Answer |
|---|---|
| Is Nodemailer installed? | **Yes.** `nodemailer` `^10.2.1` in `backend/package.json:35`, 10.2.1 in `package-lock.json`, and it loads from `node_modules`. |
| Does application code use it? | **Yes, for student-facing email only.** One call site: `backend/src/lib/notifications/providers.ts:30,34`. |
| Is it configured? | **Not locally.** No SMTP URL or sender is set. Production is not verified. |
| Is it production-ready? | **Not shown.** The real transport has never been exercised: no test reaches Nodemailer, and no real SMTP server has been used. |
| Is it the only provider? | **No. There are two email paths**, plus WhatsApp. |

| Path | Used for | Transport | Code |
|---|---|---|---|
| **Resend HTTP API** | Staff email: invitations, password resets, security alerts | Direct `fetch` to `api.resend.com`. There is **no Resend SDK** dependency. | `backend/src/lib/email.ts:12-27` |
| **SMTP through Nodemailer** | Student and parent email: notifications, portal links and codes, email verification | `nodemailer.createTransport(<SMTP URL>)`, one per company | `backend/src/lib/notifications/providers.ts:24-42` |
| **Gallabox HTTP API** (not email) | WhatsApp for notifications and portal sign-in codes | Direct `fetch`. The code itself notes it has not been verified against a live account. | `providers.ts:45-92` |

**The two email paths do not back each other up.** Configuring only SMTP leaves staff mail unsent. Configuring only Resend leaves student mail unsent. Sending staff mail through SMTP would need a code change (also noted in `docs/HOSTING_EMAIL_SCANNER_OPTIONS.md` §3).

## 2. Provider and delivery behaviour per flow

| Flow | Provider | Delivery | Retries | If not configured | Source |
|---|---|---|---|---|---|
| **Staff invitation** | Resend | **Direct**, awaited inside the action | **None** (one attempt, 10 s timeout) | Link shown on screen for manual hand-over. The same happens if sending fails. | `frontend/src/app/actions/admin.ts:34-42` |
| **First admin / MD setup link** (`admin:create`) | **None** | Printed to the operator's terminal | n/a | n/a: this flow never emails | `backend/scripts/create-admin.ts` |
| **Admin-issued staff reset link** | **None** | Shown on screen (valid 24 hours) | n/a | n/a: this flow never emails | `frontend/src/app/actions/admin.ts:111-117` |
| **Staff self-service password reset** | Resend | **Queued** in `auth_private.staff_email_outbox`, link encrypted | Up to 5 attempts, backoff 30 s × 2^(n-1), never past the 1-hour expiry | Recorded as `skipped` and the link wiped. **The requester is not told.** | `backend/src/lib/auth/passwords.ts`, `lib/auth/staff-email.ts`; migration `0035` |
| **Staff MFA** | **None** | **No MFA message exists.** Staff use an authenticator app (TOTP) and recovery codes shown on screen. | n/a | n/a | `backend/src/lib/auth/mfa.ts`, `mfa-service.ts` |
| **Security alerts** (high and critical, including MFA resets) | Resend | Direct, from the per-minute job only | Re-attempted every job run until all recipients succeed (see finding E-3) | Not sent; stays pending | `backend/src/lib/security/jobs.ts:24-40` |
| **Student portal set-up and reset links** | Nodemailer (company SMTP) | **Queued** in `auth_private.portal_email_outbox`, link encrypted | Up to 5 attempts, backoff 60 s × 2^(n-1), never past expiry. Permanent errors fail at once. | `skipped` | `backend/src/lib/notifications/portal-email.ts`; migration `0036` |
| **Portal sign-in codes** | Nodemailer or Gallabox | **Queued** in `auth_private.auth_message_outbox`, code encrypted | Up to 5 attempts, backoff 30 s × 2^(n-1), never past expiry; re-checked before every send | `skipped` | `backend/src/lib/notifications/auth-message.ts`; migration `0037` |
| **Student email verification links** | Nodemailer | **Queued** in the same `auth_message_outbox` | Same as sign-in codes | `skipped` | same; `frontend/src/app/actions/passport.ts:38` |
| **Student and parent notifications** | Nodemailer or Gallabox (SMS has no provider) | **Queued** in `notification_messages` | Up to 5 attempts, backoff 60 s × 2^attempts; permanent errors fail at once; manual retry available | `skipped` | `backend/src/lib/notifications/dispatcher.ts`; migration `0015` |

**When queued mail is sent.** The job `GET /api/cron/notifications` (`frontend/src/app/api/cron/notifications/route.ts`) runs all queues. After a request, `after()` also starts a faster attempt. Queues use `SKIP LOCKED`, so parallel senders do not claim the same message.

**Sender addresses (local code).**
- Resend flows: `EMAIL_FROM`.
- SMTP flows: `EMAIL_FROM_<EDX|GRD>`, falling back to the unsuffixed `EMAIL_FROM` (`providers.ts:10`).
- No sender address is hard-coded, and none is configured locally.
- All email is plain text.

**Test and development behaviour.**
- SMTP and Gallabox flows honour `NOTIFICATIONS_MODE=test`: only addresses in `NOTIFICATIONS_TEST_RECIPIENTS` receive mail. Everything else is recorded as "test" and not sent.
- With `NOTIFICATIONS_TEST_MAILBOX=1` in development, portal codes and verification links go to `.data/test-mailbox/`. Production refuses this setting.
- **Resend flows ignore test mode** (see finding E-1).
- Production refuses to serve requests unless `NOTIFICATIONS_MODE` is exactly `live` (`backend/src/lib/config/notifications-config.ts`).

## 3. Configuration status (local `.env`; values not read out)

| Variable | Needed for | Local `.env` | In `.env.example` |
|---|---|---|---|
| `RESEND_API_KEY` | Resend flows | **present, empty** | yes |
| `EMAIL_FROM` | Resend flows; SMTP fallback sender | **present, empty** | yes |
| `EMAIL_SMTP_URL_EDX` | EDX student email | **absent** | yes |
| `EMAIL_FROM_EDX` | EDX student email | **absent** | yes |
| `EMAIL_SMTP_URL_GRD` | GRD student email | **absent** | yes |
| `EMAIL_FROM_GRD` | GRD student email | **absent** | yes |
| `APP_URL` | Links in email | set (localhost, so not usable for real links) | yes |
| `NOTIFICATIONS_MODE` | Test or live | set (`test`) | yes |
| `NOTIFICATIONS_TEST_RECIPIENTS` | Test-mode allow-list | absent | yes |
| `NOTIFICATIONS_TEST_MAILBOX` | Local test mailbox | absent | **no** (documented in `docs/NOTIFICATIONS.md`) |
| `CRON_SECRET` | Scheduled sender (must be 32+ characters) | set, meets the length rule | yes |
| `MFA_ENCRYPTION_KEY` | Encrypts queued links and codes | set | yes |
| `PORTAL_SECRET` | Portal tokens | absent (falls back to `STORAGE_SIGNING_SECRET`) | yes |
| `GALLABOX_API_KEY`, `GALLABOX_API_SECRET`, `GALLABOX_CHANNEL_ID_EDX`, `GALLABOX_CHANNEL_ID_GRD` | WhatsApp | absent | yes |
| `EMAIL_SMTP_URL` (unsuffixed fallback) | Accepted by code for any company | absent | **no** (undocumented) |

**Result:** with this configuration, no real email of any kind can be sent. **Production values: NOT VERIFIED.**

## 4. Findings (reported, not fixed)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **E-1** | Medium | **Test mode does not cover Resend.** With `RESEND_API_KEY` and `EMAIL_FROM` set, invitations, staff resets and security alerts are really sent even under `NOTIFICATIONS_MODE=test`, so a staging site with real addresses could email real people. | No mode check in `lib/email.ts`, `lib/auth/staff-email.ts`, `lib/security/jobs.ts` or `actions/admin.ts` |
| **E-2** | Medium | **Production can start with no email configured.** The start-up guard checks only `NOTIFICATIONS_MODE`, not any provider. The site runs while reset emails, codes and notifications end as `skipped`. | `lib/config/notifications-config.ts` has no provider check |
| **E-3** | Medium | **Security alerts can repeat.** An alert is marked as emailed only if every recipient succeeds, so one failing recipient causes all recipients to be re-sent the alert on every job run (every minute). | `lib/security/jobs.ts:30-36` |
| **E-4** | Medium | **Invitations have no retry.** A provider failure falls back to showing the link on screen, which works but depends on the administrator noticing. Already known as F-08. | `actions/admin.ts:34-42` |
| **E-5** | Low | **Staff reset retries permanent errors.** The Resend path treats every failure as retryable (up to 5 attempts), unlike the SMTP path. | `lib/auth/staff-email.ts:44-46` |
| **E-6** | Low | **No explicit SMTP timeouts.** Library defaults apply and were not measured. Messages send one at a time, and `sending` rows are reclaimed after 5 minutes on the secure queues, so a very slow server could delay a job run or, in theory, cause a duplicate send. **Possible, not observed.** | `providers.ts:30` |
| **E-7** | Low | **One failure can stop the whole job.** `processQueue` in the cron route has no `.catch`, unlike the other four steps, so a thrown error there skips staff, portal and sign-in delivery for that run. | `api/cron/notifications/route.ts:18` |
| **E-8** | Low | **Portal link errors are stored unmasked.** Only the sign-in code queue masks provider error text before storing it. Whether any provider echoes a link in an error is not verified. | `portal-email.ts`; compare `auth-message.ts:33-37` |
| **E-9** | Low | **Docs are incomplete.** `DEPLOYMENT.md` calls `RESEND_API_KEY` and `EMAIL_FROM` "optional", yet they are the only route for emailed invitations, staff resets and alerts. `.env.example` omits the unsuffixed `EMAIL_SMTP_URL`. | `docs/DEPLOYMENT.md` §3; `.env.example` |

## 5. Verified and not verified

**Verified in source and package files:**
- Nodemailer is installed and is used only in `providers.ts`.
- Resend is called directly over HTTP, with no SDK.
- The flow, queue and retry behaviour in section 2.
- Staff MFA sends no email.
- The local configuration status in section 3.

**Covered by existing tests, with providers simulated.** These tests were read but not run in this audit:
- `backend/tests/integration/staff-email-outbox.test.ts`, `portal-link-queue.test.ts` and `phase-h.test.ts`;
- `frontend/tests/integration/auth-message-queue.test.ts` and `auth-rate-limits.test.ts`.

They exercise queue logic and retries. **No test reaches real Nodemailer SMTP sending or a real Resend request**: a search of both test folders finds no use of `nodemailer`, `createTransport`, `sendMail` or `api.resend`.

**Not verified:**
- Which email code is deployed, and any production setting.
- Any real delivery through Resend or an SMTP server, including inbox placement.
- Whether a Resend account or SMTP mailbox exists.
- SPF, DKIM, DMARC and sending-domain verification. No domain is recorded in the repository and no DNS was checked.
- Whether a per-minute job calls `/api/cron/notifications` on the VPS. The only schedule in the repository is `frontend/vercel.json`, which applies only on Vercel.
- Whether the local `after()` faster attempts work under the deployed process manager.
- Queue contents in any database, which were not read.

## 6. Required before production email can work

**Owner decisions**
1. Sending domain and addresses for system mail and for each company.
2. Keep the two-provider design (the code as it stands), or approve a code change to send staff mail through SMTP.

**Provider and DNS setup**
3. A Resend account with a verified sending domain (SPF and DKIM per the provider's instructions), and DMARC, if Resend is kept.
4. An SMTP mailbox or service for EDX and for GRD, with matching SPF, DKIM and DMARC.

**Server settings (set on the server only, never in the repository)**
5. `APP_URL` as the real HTTPS address.
6. `RESEND_API_KEY` and `EMAIL_FROM`.
7. `EMAIL_SMTP_URL_EDX`, `EMAIL_FROM_EDX`, `EMAIL_SMTP_URL_GRD` and `EMAIL_FROM_GRD`.
8. `NOTIFICATIONS_MODE=live`, `CRON_SECRET` (32+ characters) and `MFA_ENCRYPTION_KEY`.
9. A per-minute scheduled call to `/api/cron/notifications` with the bearer secret, plus the daily job. Without it, retries wait for the next request and queued messages can expire.

**Verification (with your approval, using your own addresses)**
10. On staging first, with test recipients, send one message through each flow in section 2 and confirm its queue status and arrival. Because of E-1, use only your own staff addresses when testing Resend flows.
11. Confirm the sender domain passes SPF, DKIM and DMARC in the received message headers.
12. Consider fixing E-1, E-2 and E-3 first. They need approval because they change application code.

Until steps 1–9 are done, invitations and admin reset links can still be handed over manually from the screen. **Self-service staff resets, student portal links and codes, and notifications will not reach anyone.**
