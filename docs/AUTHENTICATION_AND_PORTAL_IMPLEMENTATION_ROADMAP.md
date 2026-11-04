# Authentication and portal implementation roadmap

> **Note on this file.** This file did not exist when the Part 17 audit was written (3 Nov 2026), and the main audit prompt is not in this workspace. It currently holds only the **production account dependencies** from Part 17. The full findings and evidence are in `docs/STAFF_INVITATION_LOGIN_PASSWORD_AUDIT.md` (Part 17).

## Production account dependencies (from Part 17)

Nothing below has been created or configured. The labels are as in Part 17.

### A. Owner decisions (block everything below)
| # | Decision | Status | Reference |
|---|---|---|---|
| PA-1 | Hosting provider and production domain (and staging) | NOT CONFIGURED | DEPLOYMENT.md; HOSTING_EMAIL_SCANNER_OPTIONS.md; VITE_MIGRATION_PHASE1.md D-V1 |
| PA-2 | SMTP mailbox or relay for system mail (`SYSTEM_MAIL_*`, integrated) and the per-brand SMTP for student mail | NOT CONFIGURED | HOSTING_EMAIL_SCANNER_OPTIONS.md §3 |
| PA-3 | Real MD, CEO and administrator people, and their official mailboxes | NOT CONFIGURED | Part 17.8 |
| PA-4 | Named database administrator and hosting owner ("technical owner", two people) | NOT CONFIGURED | INCIDENT_RESPONSE_PLAN.md |
| PA-5 | Emergency MD design: approve, and decide E1–E6 (custodians, email, unseal period, offline authenticator) | PENDING OWNER CONFIRMATION | EMERGENCY_MD_ACCOUNT_DESIGN.md |
| PA-6 | Whether a separate "Finance Admin" role is wanted (today: `finance` role per company) | RECOMMENDED: keep `finance` | Part 17.8 |
| PA-7 | Recommendation to keep the MD as the only super admin (no separate Super Admin role) | RECOMMENDED | Part 17.4 |

### B. Work items before go-live
| # | Item | Depends on | Status |
|---|---|---|---|
| PB-1 | **MD 2FA recovery (gap P17-1).** No tool exists to reset a lost MD authenticator. Either build a database-administrator command (`mfa:reset`: reason required, audited, critical alert) or build the emergency MD account. Then correct ADMIN_MD_OPERATIONS_GUIDE.md §8, which refers to a "setup tool" that does not exist. | PA-5 | NOT IMPLEMENTED (needs approval) |
| PB-2 | Emergency MD: migration (flag, unseal record, extra alerts), `emergency:unseal` / `emergency:reseal` commands, automatic re-seal, tests, runbook | PA-5 | NOT IMPLEMENTED |
| PB-3 | Verify (test) how an MD's login email is changed when the MD loses their mailbox. No in-app path was confirmed, because the protected MD cannot be administered by others in the app. | — | NOT VERIFIED |
| PB-4 | Browser↔Express authentication model if Next.js is replaced (cookies, CSRF/Origin, headers) | PA-1 | Decision pending (VITE_MIGRATION_PHASE1.md D-V2) |

### C. Configuration at deployment (per environment)
| # | Item | Depends on | Status |
|---|---|---|---|
| PC-1 | Mailboxes: `md@`, `ceo@`, one named mailbox per administrator, `support@` per brand, and `emergency-md@` if approved | PA-1, PA-3 | NOT CONFIGURED |
| PC-2 | Sending domain(s) verified with SPF, DKIM and DMARC; `SYSTEM_MAIL_HOST`, `SYSTEM_MAIL_PORT`, `SYSTEM_MAIL_FROM_EMAIL` (e.g. `no-reply@<domain>`), `SYSTEM_MAIL_USER` and `SYSTEM_MAIL_PASSWORD` | PA-2 | NOT CONFIGURED |
| PC-3 | `EMAIL_SMTP_URL_EDX/GRD`, `EMAIL_FROM_EDX/GRD` (student mail, portal links and codes) | PA-2 | NOT CONFIGURED |
| PC-4 | `APP_URL` = production HTTPS address (used in invitation `/invite/…` and reset `/reset-password/…` links) | PA-1 | NOT CONFIGURED |
| PC-5 | `NOTIFICATIONS_MODE=live` (production refuses to start otherwise); cron every minute (sends invitations, resets, codes) and daily | PA-1, PC-2 | NOT CONFIGURED |
| PC-6 | Production database: `npm run db:migrate`, then `npm run db:provision`; never `db:seed` | PA-1, PA-4 | NOT CONFIGURED |
| PC-7 | Accounts, by the database administrator: `admin:create` for the MD (`--role md --orgs EDX,GRD`), the first System Administrator(s) and the CEO. Deliver each one-time 24-hour link privately. | PC-6, PC-1 | NOT CONFIGURED |
| PC-8 | 2FA enrolment for every privileged account at first sign-in (enforced automatically in production); MD recovery codes stored offline | PC-7 | NOT CONFIGURED |
| PC-9 | Other staff created in the app (Staff → Add), one account per person | PC-7, PC-2 (or manual link hand-over) | NOT CONFIGURED |
| PC-10 | Portal support email per company (Company settings) | PC-1 | NOT VERIFIED |
| PC-11 | Emergency MD account created and sealed at go-live with both custodians | PB-2 | NOT IMPLEMENTED |
| PC-12 | Confirm no demo (`@demo.test`) accounts exist in production | PC-6 | NOT VERIFIED (no production DB) |

### D. Already in place (no work needed)
- Login by unique email.
- One account per person.
- No shared or default credentials in code.
- A single protected MD, alerted if a second is granted.
- Privileged roles can only be granted by the MD (`users.create_admin`).
- 2FA mandatory in production.
- Invitation and reset links are one-time and time-limited; the reset queue is encrypted.
- Suspension and termination end all sessions.
- Audit log and security alerts.
- Production refuses demo seeding and test notification mode.
