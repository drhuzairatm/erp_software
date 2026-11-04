# Resend to Nodemailer: deployment readiness audit

**Audit date:** 4 Nov 2026. Read-only, except for this report. Everything below was re-checked from the current files and Git state, not from earlier reports.

## Verdict: NOT READY

| Verdict | Meaning in this audit |
|---|---|
| READY TO DEPLOY | Every critical check passes, no Resend path remains, test mode cannot send real system email, the VPS baseline is confirmed, and production settings are confirmed. |
| NOT READY | At least one of those conditions fails because of a known defect or missing work. |
| BLOCKED | The repository is sound, and only something outside this audit's reach prevents a decision. |

**Why NOT READY rather than BLOCKED:** the repository itself has problems to fix, whatever the VPS turns out to be.

| READY condition | Result | Evidence |
|---|---|---|
| Critical checks pass | **Met** | Typecheck, lint, tests and build all exit 0 (section 3) |
| No Resend path remains | **Met** | No Resend call or setting in `backend/src`, `frontend/src` or `backend/scripts` |
| Test mode cannot send real system email | **FAILED** | Finding F-1; a passing test confirms it |
| VPS baseline verified | **Not met** | The Git relationship is verified, but what the VPS runs is not (F-3) |
| Required production configuration present | **Not met** | Cannot be confirmed without VPS access (section 5) |

The code replacement itself is sound: Resend is gone, the TLS settings are correct, and the tests and build pass.

## 1. Repository state

| Item | Value |
|---|---|
| Project path | `/Users/drhuzair/Documents/erp mvp` |
| Branch | `refactor/express-api` |
| HEAD | `af635265aaaa11e79c0bcb9c0d5e650901ae7c9f` ("new-stracture-created") |
| Local `main` and `origin/main` tracking ref | `eb8dd7d` (out of date) |
| Remote `main` (`git ls-remote`) | `f36328f9cdeafccd11b15f46fdf97cb95e5f846a` |
| Remote `refactor/express-api` | `af63526` |
| Worktree | **Not clean: 13 entries, and the whole candidate is uncommitted** |

**Changed files**

| Change | Files |
|---|---|
| Application code (1) | `backend/src/lib/email.ts` |
| Configuration template (1) | `.env.example` |
| Test settings (1) | `backend/tests/support/test-env.ts` |
| New tests (2, untracked) | `backend/tests/unit/system-mail.test.ts`, `frontend/tests/integration/system-mail-flows.test.ts` |
| Documents (6) | `docs/AUTHENTICATION_AND_PORTAL_IMPLEMENTATION_ROADMAP.md`, `docs/DEPLOYMENT.md`, `docs/HOSTING_EMAIL_SCANNER_OPTIONS.md`, `docs/LIMITATIONS_AND_ROADMAP.md`, `docs/NOTIFICATIONS.md`, `docs/PILOT_READINESS_CHECKLIST.md` |
| New reports (2, untracked; unrelated to deployment) | `docs/audit/EMAIL_DELIVERY_AUDIT.md`, `docs/audit/PART_17_DATABASE_VERIFICATION.md` |

Tracked changes total 131 insertions and 32 deletions across 9 files.

No difference from HEAD in `backend/src/lib/notifications`, `backend/src/lib/auth`, `backend/src/lib/security`, `frontend/src`, `backend/db`, `backend/scripts`, `frontend/next.config.ts`, or any `package.json` or `package-lock.json`.

### Baseline comparison

- `f36328f` is the merge of PR #1. Its parents are `eb8dd7d` and `af63526`.
- **`f36328f` and `af63526` have the identical tree (`953c2d9`).** The merge adds no content.
- The candidate is therefore `f36328f` plus the uncommitted changes above. It adds no migrations (37 at both, last `0037`) and no dependencies (`nodemailer` is already declared in `backend/package.json`).
- **Correction to my earlier reports:** I said `f36328f` was not in this repository and treated the baseline as unknown. It was missing only because the local refs were out of date.
- **Also corrected:** the Express process and `INTERNAL_API_SECRET` are not new requirements of this candidate. `f36328f` already needs them.
- **Still unverified:** that the VPS really runs `f36328f`, with no local edits. That commit comes from your report.

## 2. Findings

Severity is judged for this deployment. "Introduced" means this candidate causes it; "existing" means the behaviour predates it.

### Prevents READY

| ID | Severity | Finding | Files | Origin |
|---|---|---|---|---|
| F-1 | **Critical** | **Test mode does not stop system email.** With `NOTIFICATIONS_MODE=test` and real `SYSTEM_MAIL_*` values, invitations, staff resets and alerts go to real recipients. Student and parent mail is filtered by test mode; system mail is not. | `backend/src/lib/email.ts:81-93`; contrast `backend/src/lib/notifications/dispatcher.ts`; recorded by the test at `backend/tests/unit/system-mail.test.ts:108` | Existing, and carried over |
| F-2 | **High** | **The candidate is uncommitted.** A deployment from `main` cannot include it. It needs a commit and a merge to `main`. | Worktree | Candidate |
| F-3 | **High** | **The VPS baseline is unverified.** The commit, local edits and running processes are reported, not observed. | n/a | External |
| F-4 | **High** | **Valid staff addresses containing an apostrophe are refused, and this can cause repeated alert emails.** The app accepts `o'brien@example.test` when creating staff (`z.email`, confirmed by running it), but system mail rejects it (confirmed by running the regex). See the effects below. | `backend/src/lib/email.ts:21`; `backend/src/lib/validation.ts:194`; `backend/src/lib/security/jobs.ts:30-36` | **Introduced** |
| F-5 | **High** | **A server configured only for Resend stops emailing silently.** There is no start-up error. With missing or partial `SYSTEM_MAIL_*`, password reset messages are marked skipped and their links wiped, and alerts stay pending. | `backend/src/lib/email.ts:42-50`; `backend/src/lib/config/notifications-config.ts:55`; `backend/src/lib/auth/staff-email.ts:40-42` | Silent start existing; the switch is **introduced** |
| F-6 | **High** | **No instructions for the VPS that is actually in use.** `docs/DEPLOYMENT.md` is written for Vercel and says nothing has been deployed. It never mentions `start:api`, `INTERNAL_API_SECRET` or `API_INTERNAL_URL` (0 matches), yet its `/api/health` check answers 503 without the internal API. The repository contains no PM2, Nginx or system-cron configuration, and the only schedule is `frontend/vercel.json`. | `docs/DEPLOYMENT.md`; `frontend/src/app/api/health/route.ts`; `README.md:40-41` | Existing |

**Effects of F-4**

| Flow | Result for an address with an apostrophe |
|---|---|
| Invitation | The link is shown to the administrator, with the message "Email is not configured". |
| Staff reset | Retried up to 5 times, then marked failed and audited as `password_reset_email_failed`. The person gets no email. |
| Security alert | **The alert is never marked as emailed. Every other recipient gets it again each minute until someone acknowledges it**, because `security_alerts_to_email` keeps returning it. This applies to any such holder of `security.alerts`. |

No such staff member was looked for, because this audit did not query any database.

### To fix or accept

| ID | Severity | Finding | Files | Origin |
|---|---|---|---|---|
| F-7 | Medium | One failing alert recipient causes all recipients to be re-sent to each minute. Tested as existing behaviour. | `backend/src/lib/security/jobs.ts:28-38` | Existing |
| F-8 | Medium | Staff resets retry permanent failures such as a rejected recipient. | `backend/src/lib/auth/staff-email.ts:46`; migration `0035` | Existing |
| F-9 | Medium | A failed send tells the administrator "Email is not configured", which is untrue. Tested as existing behaviour. | `frontend/src/app/actions/admin.ts:29,51` | Existing |
| F-10 | Medium | `processQueue(100)` has no `.catch` in the cron route. If it throws, that run's later steps, including system mail, do not run. | `frontend/src/app/api/cron/notifications/route.ts:18` | Existing |
| F-11 | Low | A bare sender only, so `SYSTEM_MAIL_FROM_EMAIL` cannot include a display name. Recipients may see only the address. Documented. | `backend/src/lib/email.ts:21,48` | **Introduced** |
| F-12 | Low | Slower failures. The old limit was a fixed 10 s; the new timeouts are 10 s to connect, 10 s for the greeting and 20 s of socket inactivity, so a stalled server can hold an invitation action longer. In an outage, a run of 50 resets can pass the 5-minute reclaim in `staff_email_claim` and send a link twice. That already applied at 10 s per message; the longer timeouts make it more likely. From reading the code, not tested. | `backend/src/lib/email.ts:14-16`; migration `0035` | Made worse |
| F-13 | Low | Out-of-date documents: `docs/HOSTING_EMAIL_SCANNER_OPTIONS.md:118-120` cost scenarios still include "Resend free". `docs/STAFF_INVITATION_LOGIN_PASSWORD_AUDIT.md` (9 mentions) and `docs/PHASE_A_STAFF_ACCOUNTS_REPORT.md:74` still describe Resend. Older `docs/audit/` reports are historical records. | As listed | Candidate gap |
| F-14 | Low | `backend/scripts/db-backup.ts:4-5` expects `pg_dump` 17, while the VPS reportedly runs PostgreSQL 18. Confirm before relying on backups. | As listed | Existing |
| F-15 | Info | `appUrl()` falls back to `http://localhost:3000`, and nothing requires `APP_URL` in production. Without it, emailed links are broken. | `backend/src/lib/email.ts:95-98` | Existing |

### Inspection results

**`backend/src/lib/email.ts`**

| Requirement | Result |
|---|---|
| `emailConfigured()` checks only the five `SYSTEM_MAIL_*` settings | Passed (`:42-50`, `:77-79`) |
| No stale Resend logic; `sendEmail()` does not call Resend | Passed: no `fetch` and no Resend reference in the file |
| Valid control flow, no duplicate or unreachable branches | Passed |
| Settings come only from the environment | Passed. The `http://localhost:3000` default applies to `APP_URL` only |
| Port 587 requires STARTTLS; port 465 uses implicit TLS | Passed (`:62-63`); other ports count as not configured |
| Certificates checked, TLS 1.2 or later, timeouts set | Passed (`:65-68`) |
| One recipient only; header injection refused | Passed (`:21`, `:33-39`), with the over-strict side effect in F-4 |
| Logs and errors expose nothing sensitive | Passed: no logging, only fixed text or a numeric status is returned, and Nodemailer's logger is off |

**Real Nodemailer 10.2.1, rendered to memory only with no network**
- Subjects containing `U+2028` or `U+0085` followed by `Bcc:` produced no extra header and one envelope recipient.
- A `Bcc:` line in the body stayed in the body.

**Resend removal**
- The only provider-sense mention in application code is unrelated: `passport-forms.tsx:94` says "Resend verification email", meaning send again.
- `RESEND_API_KEY` remains as an empty, unused line in the local `.env`.

**Credentials (present, missing or empty only)**
- The real `.env` is ignored by Git and not tracked. It was not changed (hash matched before and after the checks).
- A pattern scan of the diff, the untracked files and all tracked files found no real API keys or private keys.
- SMTP URLs found are documentation examples or fictional test values, and the secret settings I checked in `.env.example` are `CHANGE_ME` placeholders.
- A pattern scan cannot prove that no secret exists. It covered the current files only, not Git history.

**Tests and SMTP**
- Both new test files mock Nodemailer.
- Only those two files and the blank `test-env.ts` set `SYSTEM_MAIL_*`. Only the mocked unit test sets `EMAIL_SMTP_URL_*`.
- Both Vitest configurations force `SYSTEM_MAIL_*` blank, and blank settings exit before any transport is created.
- This protection comes from configuration and mocks. No network block exists to enforce it.
- Playwright uses the development server, which reads `.env`. If real `SYSTEM_MAIL_*` values were ever added there, end-to-end runs could send real email (F-1).

**Per-company student and parent SMTP: unchanged.**
- `backend/src/lib/notifications/` has no diff from HEAD, including `providers.ts`.
- It still uses its own `EMAIL_SMTP_URL_<CODE>` and `EMAIL_FROM_<CODE>`.
- Tests confirm that neither mail system's settings configure the other.
- The `.env.example` comments are accurate.

## 3. Checks run

Node v24.22.2. Tests used only the disposable test database on port 54339 and `.data/storage-test`.

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | **Passed** |
| Lint | `npm run lint` | 0 | **Passed** |
| Focused unit tests | `cd backend && npx vitest run tests/unit/system-mail.test.ts` | 0 | **Passed:** 31/31 |
| Focused flow tests | `cd frontend && npx vitest run tests/integration/system-mail-flows.test.ts` | 0 | **Passed:** 10/10 |
| Full suite | `npm test` | 0 | **Passed:** backend 405/405 (46 files), migrations 2/2, frontend 129/129 (9 files) |
| Production build | `npm run build`, with both database URLs pointed at a closed port and `SYSTEM_MAIL_*` blank | 0 | **Passed** |
| Offline Nodemailer rendering | Scratchpad script, memory output only | 0 | **Passed** |

| Not verified | Why |
|---|---|
| Real SMTP login, TLS negotiation and delivery | Connecting to an SMTP server is prohibited |
| Playwright end-to-end tests | They use the development database, which is prohibited |
| Everything on the VPS | No connection allowed |
| Existing staff addresses containing an apostrophe | No development or production queries allowed |
| Vitest network behaviour beyond mocks | No network block exists; the conclusion rests on configuration and mocks |

## 4. Email-flow comparison

Call sites and database queues are unchanged, so the same content reaches `sendEmail()`. "Same" below comes from the zero diff, and the listed subjects and text are asserted by the flow tests.

| Aspect | Staff invitation | Staff password reset | Security alert |
|---|---|---|---|
| Subject and text | Same | Same | Same |
| Recipient | Same, except F-4 | Same, except F-4 | Same, except F-4 |
| Sender | **Changed:** `SYSTEM_MAIL_FROM_EMAIL`, bare address (was `EMAIL_FROM`) | **Changed:** same | **Changed:** same |
| URL | `APP_URL` + `/invite/…` | `APP_URL` + `/reset-password/…` | `APP_URL` + `/admin/security` |
| When sent | Immediately, in the action | Queue: `after()` and the per-minute cron | Per-minute cron only |
| Queue | None | `auth_private.staff_email_outbox`, encrypted | `security_alerts.emailed_at`, 20 oldest per run |
| Retries | None: one attempt | Up to 5, at 30 s × 2^(n-1), within the 1-hour expiry | Each minute until all succeed or it is acknowledged |
| If not configured | Link shown to the administrator | Marked skipped, link wiped; page says to ask an administrator | `{ emailed: 0, reason }`; stays pending |
| If sending fails | Link shown to the administrator (misleading text, F-9) | Stays queued; only status text stored | Stays pending; all recipients re-sent (F-7) |
| Return values | Same | Same | Same |
| Permissions | Same | Public request, no account disclosure | System job |
| Rate limits | 5 per person per 24 h | 3 per hour and 1 per 2 min per email; 10 per hour per IP; 100 per hour overall | None for sending |
| Audit records | `staff_invitation_issued` | `password_reset_email_sent`, `password_reset_email_failed` | No change |
| Test mode | Not filtered (F-1) | Not filtered (F-1) | Not filtered (F-1) |

Other differences across all three flows:
- **Provider:** Resend HTTPS API replaced by SMTP.
- **Error text:** a new message, "The email recipient or subject is not valid.", is added. The existing messages keep their wording, but the number in "Email provider returned N" is now an SMTP status rather than an HTTP status.
- **Timeouts:** see F-12.

Not used by these flows: `resetLinkAction` and `admin:create` never email. Staff MFA is TOTP, so it sends no message.

## 5. Required production settings

Names only. Status on the VPS is **not verified** for all of them.

| Purpose | Variables |
|---|---|
| **New for this change** | `SYSTEM_MAIL_HOST`, `SYSTEM_MAIL_PORT`, `SYSTEM_MAIL_FROM_EMAIL`, `SYSTEM_MAIL_USER`, `SYSTEM_MAIL_PASSWORD` |
| No longer used by system mail | `RESEND_API_KEY`; `EMAIL_FROM` remains only as the student-mail fallback |
| Links and jobs | `APP_URL`, `CRON_SECRET`, `NOTIFICATIONS_MODE=live` |
| Internal API (already required at `f36328f`) | `INTERNAL_API_SECRET`, `API_INTERNAL_URL`, `API_HOST`, `API_PORT` |
| Database | `DATABASE_URL`, `DATABASE_ADMIN_URL` for administrative commands |
| Security | `MFA_ENCRYPTION_KEY`, `MFA_ENFORCE`, `STORAGE_SIGNING_SECRET`, `TRUST_PROXY` (with `TRUSTED_PROXY_HOPS` if used) |
| Storage | `STORAGE_DRIVER`, plus `STORAGE_LOCAL_DIR` or the `S3_*` settings |
| Student and parent email | `EMAIL_SMTP_URL_EDX`, `EMAIL_FROM_EDX`, `EMAIL_SMTP_URL_GRD`, `EMAIL_FROM_GRD` |

Local `.env`, for reference only:
- **Absent:** all five `SYSTEM_MAIL_*`, `INTERNAL_API_SECRET`, `API_INTERNAL_URL`, `API_HOST`, `API_PORT`, `TRUST_PROXY`, `EMAIL_SMTP_URL_EDX`, `EMAIL_SMTP_URL_GRD`.
- **Empty:** `RESEND_API_KEY`, `EMAIL_FROM`.
- **Set:** `APP_URL`, `NOTIFICATIONS_MODE`, `CRON_SECRET`, `MFA_ENCRYPTION_KEY`, `STORAGE_SIGNING_SECRET`, `DATABASE_URL`.

**Required processes**
- Next.js: `npm start`.
- Express internal API: `npm run start:api`, one instance, loopback only.
- A scheduler calling `/api/cron/notifications` every minute and `/api/cron/daily` daily, with `Authorization: Bearer` and the `CRON_SECRET` value. All system mail except invitations depends on it.

**Health check:** `/api/health` must return 200 `{"status":"ok"}`. A 503 with `api_unavailable` means the internal API is down, and `database_unavailable` means the database is. **It does not check email,** so a healthy result says nothing about mail.

## 6. Before deployment

**Code decisions, needing your approval (this audit changed nothing)**
1. **F-1:** make system mail respect test mode, or decide to rely only on the documented rule of never setting `SYSTEM_MAIL_*` outside production. By your criteria, READY requires this risk to be removed.
2. **F-4:** accept apostrophes in addresses, and add a test. Fix F-7 at the same time if you want to end repeated alerts.
3. **F-5:** add a clear start-up warning or error for missing or partial settings.

**Release steps**
4. Commit the candidate, leaving unrelated reports out if you prefer, and merge it to `main` (F-2).
5. Write a VPS runbook covering PM2, Nginx, the cron, the internal API and restarts (F-6).

**Read-only checks on the VPS, run by you**
6. Run `git rev-parse HEAD` and `git status --short`. Expect `f36328f` and a clean tree.
7. Check that the PM2 list includes both the Next.js and Express processes, and that `/api/health` returns 200.
8. Check that a per-minute scheduler exists and calls the cron route.
9. Report whether each setting in section 5 is present, without printing values.
10. Test outbound access to the SMTP host on 465 or 587 (TCP only, without sending mail). Some hosts block these ports.
11. Confirm the backup tool works with PostgreSQL 18 (F-14) and take a backup before deploying.

**At deployment**
12. Choose the mailbox and set SPF, DKIM and DMARC.
13. Set all five `SYSTEM_MAIL_*`, build, and restart so they are read.
14. Send one approved live test each for an invitation, a reset and an alert, using a mailbox you control. This is the first real SMTP test.
15. Keep rollback ready: `f36328f` needs no database rollback, because this candidate adds no migrations. It would need Resend settings again to send mail.

**Separately**
- Rotate the secret-looking value that appeared in the pasted chat, if it is real.
- Run Playwright in an approved environment before release. It was last recorded passing (57/57) on 1 Nov, before this change.

## 7. Audit statement

**This audit made no application or deployment changes.** It did not edit application code, tests, configuration, `.env`, database data or deployment settings. It installed nothing, did not commit, push or deploy, did not connect to the VPS or any SMTP server, sent no email, and did not query the development or production database.

Side effects, all outside tracked files:
- This report is the only new project file.
- `git fetch --dry-run` and `git ls-remote` contacted GitHub read-only. The dry run downloaded the `f36328f` objects into the local `.git` store. No branch or tracking ref changed.
- The checks wrote to the disposable test database and test storage, and regenerated ignored build output.
- A helper script and logs were written to the session scratchpad.

Before this report was written, the worktree still showed the same 13 entries.
