# Phase A: staff account security, implementation report (1 Nov 2026)

Approved scope: the remediation prompt, Step 1 (Phase A only). Phase B has not started.

## 1. Problems resolved (from FINAL_AUDIT_AND_PLAN.md)
| Gap | Resolution |
|---|---|
| G1: only active/inactive accounts | Account states **Invitation pending → Active → Suspended / Terminated**, enforced in the database. Only *Active* accounts can sign in. Reason, date and who changed it are recorded. |
| G2: onboarding by a handed-over link, email not verified | One-time **invitations**: random 256-bit token (only its hash stored), valid `STAFF_INVITE_DAYS` (default 7, max 14), one open invitation per person (resending replaces the old link), at most 5 per person per day, cancellable, single use. Accepting sets the private password (Argon2id, strength rules), **confirms the email address** and activates the account. Roles that require 2-step login must set it up right after the first sign-in (existing rule). Emailed automatically once an email provider is configured; until then the link is shown once to the inviting administrator. |
| G3: missing employee fields | Mobile, joining date, department (at creation), designation (existing job title), employment status, email-confirmed date; editable by authorised administrators on the profile. |
| G4: no "sign out everywhere" | For administrators (on the profile, within their authority) and for everyone on their own *Two-factor login* page. Ends every session immediately (existing session tokens stop working). |
| G5: no bulk task hand-over | "Reassign all open tasks to …" on the profile (needs `tasks.assign`). Each task records the previous owner, the new owner and who did it. Completed/cancelled tasks are untouched; one audit entry for the hand-over. |
| G6: MD bootstrap | The MD role still cannot be granted from the web app (existing rule). The database now **refuses a second active MD** even through the setup script, unless the database administrator deliberately adds `--allow-additional-md`. Every MD grant is audited, recording whether it was the initial setup or an override. New script accounts start as *Invitation pending*. |

## Suspension / termination behaviour
- **Access:** all sessions end immediately; sign-in, open invitations and password links stop working. Every data access needs a valid session, so private student documents are no longer reachable.
- **Records:** tasks, history, documents and audit records are kept. Nothing is deleted.
- **Who:** the person cannot change their own status, nobody can change the MD's, and managers, counsellors and the CEO cannot change anyone's. A *terminated* employee can only be reinstated by someone allowed to create administrators (the MD by default).

## 2. Files modified / added
- **Database:**
  - `db/migrations/0032_staff_accounts.sql` (new)
  - `db/rollbacks/0032_staff_accounts.down.sql` (new)
- **Server:**
  - `src/server/services/admin.ts`: invitations, status, sessions, details, task hand-over
  - `src/server/auth/passwords.ts`: invitation check and acceptance
  - `src/server/validation.ts`
  - `src/app/actions/admin.ts`, `src/app/actions/auth.ts`
- **Screens:**
  - `src/app/(auth)/invite/[token]/page.tsx` + `invite-form.tsx` (new, public)
  - `src/app/(auth)/login/page.tsx`
  - `src/app/(app)/admin/users/page.tsx`, `[id]/page.tsx`, `status-badge.tsx` (new)
  - `src/app/(app)/admin/admin-forms.tsx`
  - `src/app/(app)/account/security/page.tsx` + `sign-out-all.tsx` (new)
- **Setup and config:**
  - `scripts/create-admin.ts`
  - `.env.example` (`STAFF_INVITE_DAYS`)
- **Docs:** `docs/PERMISSIONS.md` / schema docs regenerated
- **Tests (new):**
  - `tests/integration/staff-accounts.test.ts`
  - `tests/e2e/staff-accounts.spec.ts`

## 3. Database changes (additive, nothing deleted)
- **`user_profiles`:** adds `account_status`, `phone`, `joining_date`, `email_verified_at`, `status_reason`, `status_changed_at`, `status_changed_by`.
- **Backfill:**
  - deactivated accounts → *Suspended*
  - active accounts without a password → *Invitation pending* (5 fictional test accounts on the development database)
  - everyone else → *Active*
- **`is_active` is kept in step automatically,** so existing checks continue to work.
- **New table** `auth_private.staff_invitations`: not readable by the application role.
- **New functions** (each checks authority in the database and writes an audit entry): `set_staff_status`, `revoke_user_sessions`, `issue_staff_invitation`, `cancel_staff_invitation`, `auth_invitation_info`, `auth_accept_invitation`, `staff_invitations_overview`.
- **Updated functions:**
  - `auth_login_lookup`: active accounts only
  - `auth_complete_reset`: a password link also confirms an invited person's email
- **New triggers:** status sync, and protected-role guard on memberships.
- **Rollback** script provided; the migration test rolls back to 0017 and re-applies everything.

## 4–5. Tests executed and results (this Mac, development and test databases, fictional data only)
| Test | Result |
|---|---|
| `staff-accounts.test.ts`: 10 integration tests (invitation lifecycle, expiry/replace/cancel, duplicate and unauthorised invitations, suspension ends sessions and blocks sign-in/reset links, reactivation, termination and reinstatement rule, self/MD/escalation refusals, sign out everywhere incl. own, legacy deactivate path, task hand-over with history and audit, second-MD refusal and audited override) | **10/10 passed** |
| `staff-accounts.spec.ts`: browser journey: MD invites (department, mobile, joining date) → *Invitation pending* → employee cannot sign in → accepts invitation → signs in → link unusable again → MD suspends with reason → employee's open session redirected to sign-in, sign-in refused → MD hands over the open task → reactivates → employee signs in → employee signs out everywhere | **passed** |
| Setup script on the development database: attempt to create a second MD | **refused**, nothing created |
| Full check: typecheck, lint, all integration tests (incl. migration rollback/re-apply), production build | **231/231 passed**, build OK |
| All browser tests | **49 passed, 1 skipped** (courier test needing leftover demo data; scheduled for Phase C) |

## 6. Remaining problems
- **Invitation email:** not sent automatically until an email provider is configured. The link is shown once to the administrator, who must pass it on securely.
- **2-step login:** required only for MD, CEO, administrators and finance (`MFA_ENFORCE=roles`). `MFA_ENFORCE=all` is recommended before real staff use the system (your earlier decision 4 is still open).
- **Task hand-over message:** the confirmation disappears once no open tasks remain (the profile then shows "Open tasks (0)"). Cosmetic.

## 7. External services still required
- **Email provider:** for invitations and password emails, either
  - Resend: `RESEND_API_KEY`, `EMAIL_FROM`, plus a verified sending domain (DNS records), or
  - the brands' own SMTP mailboxes.
- **Hosting:** HTTPS address set in `APP_URL`, so links point to the real site.

## 8. Security risks still outstanding (Phases B–D)
- **Uploads:** no virus scanning yet.
- **Monitoring:** no alerts to the MD for failed logins, privilege changes or exports; no login-history screen.
- **Browser policy:** still allows inline scripts.
- **Verification:** backup restore not yet tested; no independent penetration test.
