# Staff invitation, login and password audit

> **Note on this file.** This file did not exist when Part 17 was written (3 Nov 2026). It was searched for in the repository and in the user's Documents, Desktop and Downloads folders. The main audit prompt and Parts 1–16 are not in this workspace, so this file currently contains **Part 17 only**. Earlier parts should be added above it if they exist elsewhere.

---

## PART 17: Production administrator identity, official email accounts and Super Admin access

| | |
|---|---|
| Date | 3 Nov 2026 |
| Branch | `refactor/express-api` (working tree, uncommitted) |
| Method | **Read-only.** Source code, migrations, scripts, `.env.example` and documentation. For the local `.env`, only whether each variable is *set* or *empty* was checked. No value was printed or recorded. |
| Not done | No database was queried, so no real or development account rows were read. No account, credential, email or DNS record was created or changed. No email was sent. No hosting account was accessed. |

### Labels used
**IMPLEMENTED**: built and covered by code or tests. **PARTIALLY IMPLEMENTED**: some parts built. **NOT IMPLEMENTED**: not built. **NOT CONFIGURED**: built, but the setting or account does not exist yet. **NOT VERIFIED**: cannot be confirmed from what this audit may read. **RECOMMENDED**: a proposal.

### Key evidence (where the facts come from)
| Fact | Source |
|---|---|
| Login is by **email address**. There are no usernames, and email is unique regardless of case. | `backend/db/migrations/0001_*.sql` (`user_profiles.email`; unique index on `lower(email)`) |
| Built-in roles `md`, `ceo`, `manager`, `counsellor`, `documentation`, `visa`, `finance`, `system_admin`, created **separately for each company** (EDX, GRD) | `backend/scripts/lib/defaults.ts` (`DEFAULT_ROLES`, `ORGANIZATIONS`) |
| MD role: `protected`, `privileged`, `mfa`; it **automatically holds every permission** and cannot be changed in the app | `defaults.ts`; `backend/src/services/admin.ts` (`setRolePermissions` refuses changes to a protected role) |
| Only one MD can exist. A second MD needs the database setup tool and `--allow-additional-md`. Granting MD is audited and raises a **critical** alert. | `backend/db/migrations/0032_staff_accounts.sql` (lines ~224–233); `0035_auth_rate_limits.sql` (`md_role_granted` alert); `backend/scripts/create-admin.ts` |
| Assigning a privileged role (MD, CEO, System Administrator) needs `users.create_admin`. A protected role (MD) can **never** be assigned in the app. A person may only assign roles whose permissions they hold themselves. | `0012_roles_mfa_departments.sql` (`app.can_assign_role`) |
| Initial privileged accounts are created **only** with `npm run admin:create`. The tool needs database admin access and prints a one-time 24-hour setup link; no password is ever printed or stored. | `backend/scripts/create-admin.ts`; `docs/DEPLOYMENT.md` §4 |
| Two-factor login is **always required** in a production build (`NODE_ENV=production`), whatever `MFA_ENFORCE` says. The local `.env` has it switched off for development only. | `backend/src/lib/auth/mfa.ts` (line ~138); local `.env`: `MFA_ENFORCE` = `off` (dev) |
| Demo accounts (`md@demo.test`, `ceo@demo.test`, `admin@demo.test`, …) are **fictional**. The seed refuses to run when `NODE_ENV` or `APP_ENV` is `production`. | `backend/scripts/lib/seed-demo.ts`; `backend/scripts/seed.ts` |
| No real email address or company domain appears anywhere in the repository. Only placeholders (`md@yourcompany.com`, `ceo@yourcompany.com`, `it.admin@yourcompany.com`) and fictional `@demo.test` / `@example.test` addresses. | Repository-wide search (excluding `node_modules`, `.data`) |
| Nothing has been deployed. No cloud account, database, bucket or domain has been configured. | `docs/DEPLOYMENT.md` (status note) |

---

### 17.1 MD login account

| # | Question | Finding | Status |
|---|---|---|---|
| 1 | Designated MD account? | The **role** exists (`md`, "Managing Director", in both companies). The only MD **account** defined in source is the fictional `md@demo.test` (development/staging demo data). No real MD account is defined anywhere. | Role IMPLEMENTED; production account NOT CONFIGURED |
| 2 | Current MD login identity | Development: `md@demo.test`, a fictional demo identity, **not** for production. Production: **none**. `docs/DEPLOYMENT.md` shows only the placeholder `md@yourcompany.com`. | NOT CONFIGURED |
| 3 | Email or username? | Email address (no usernames exist) | IMPLEMENTED |
| 4 | Created in the database? | Development DB: probably, from the demo seed (**not queried**). Production DB: does not exist yet. | NOT VERIFIED (dev) / NOT CONFIGURED (prod) |
| 5 | Linked to the right companies? | The setup tool links the chosen companies (`--orgs EDX,GRD`, the default). The demo MD is linked to both. | IMPLEMENTED (mechanism) |
| 6 | Highest app-level permissions? | Yes. The protected role holds every permission automatically, including `users.create_admin`, `users.mfa_reset` and `roles.manage`. | IMPLEMENTED |
| 7 | Mandatory 2FA? | Yes. The role is flagged `mfa`, and production always requires two-factor login for everyone. | IMPLEMENTED |
| 8 | Verified and active? | An account becomes *active* and its email is marked verified when the person opens the setup link and sets a password (`0032_staff_accounts.sql`). For production this has not happened. | NOT CONFIGURED |
| 9 | Configured for production? | No: no production environment, domain or MD email exists | NOT CONFIGURED |
| 10 | Emergency recovery? | See 17.7. The MD has their own recovery codes. **No one in the app can reset the MD's 2FA**, because the MD role is protected. The guide says the technical owner resets it "with the setup tool", but **no such tool exists** (`create-admin.ts` re-issues a password link only and does not touch 2FA). | PARTIALLY IMPLEMENTED (gap, see finding P17-1) |

### 17.2 CEO login account

| Question | Finding | Status |
|---|---|---|
| Separate CEO account exists? | **CEO is a role** (`ceo`), not a built-in account. Any individual user can be given it. The only CEO account defined in source is the fictional `ceo@demo.test`. | Role IMPLEMENTED; production account NOT CONFIGURED |
| CEO login email configured? | No. Placeholder `ceo@yourcompany.com` only (DEPLOYMENT.md). | NOT CONFIGURED |
| Dedicated official email? | Not decided. The system only requires a unique, valid email address. | NOT CONFIGURED |
| How is it created? | `npm run admin:create -- --role ceo …` (database administrator), or in the app by someone holding `users.create_admin` plus every CEO permission (the MD by default) | IMPLEMENTED |
| Assigned a company? | Per membership. The documented command gives both companies (`--orgs EDX,GRD`). It can be limited to one company. | IMPLEMENTED |
| Permissions | Dashboards including consolidated, staff workload, all students (read), contacts, assign students, notes and documents (read), all tasks, create and assign tasks, **payment status only (no amounts)**, reports view and export, leads read. Changes only if the MD grants more. | IMPLEMENTED |
| Restricted to authorised information? | Yes, by role permissions and database row-level security. No financial amounts, user management or settings by default. | IMPLEMENTED |
| Mandatory 2FA? | Yes (role flag; and production requires it for everyone) | IMPLEMENTED |
| Secure password reset? | Two ways: (a) self-service "forgot password" through an encrypted, rate-limited queue with 1-hour links, which needs `RESEND_API_KEY` and `EMAIL_FROM` (both **empty** locally); (b) an administrator issues a one-time link (`users.manage`, and only for people they may administer: assigning CEO needs `users.create_admin`, so in practice the MD). | IMPLEMENTED; email delivery NOT CONFIGURED |
| Ready for production? | No account, no official email, no email provider | NOT CONFIGURED |

**Answer:** the CEO is **a role that can be assigned to an individual user**. It is not a separate built-in account. In practice each CEO person gets their own login.

### 17.3 Administrator accounts

| Question | Finding | Status |
|---|---|---|
| Dedicated Admin account? | Role `system_admin` ("System Administrator": users, roles, settings, reference data, departments, notification settings, audit log; **no student records by default**). Only the fictional `admin@demo.test` exists in source. | Role IMPLEMENTED; account NOT CONFIGURED |
| Separate Super Admin account? | **No separate Super Admin role or account.** The **MD role is the application super admin** ("Master super administrator: both companies, every module, all settings"). See 17.4. | NOT IMPLEMENTED (by design: MD = super admin) |
| Multiple administrators with individual logins? | Yes. Every account is one person and one email; any number can hold `system_admin`. | IMPLEMENTED |
| Shared admin credentials anywhere? | **None found in code.** No built-in account, no default password, no password in scripts or files. Each account sets its own password via a one-time link. Process-level sharing (e.g. one mailbox used by two people) cannot be prevented by code. | IMPLEMENTED (no shared credentials in code); practice NOT VERIFIED |
| Admin email configured? | No. Placeholder `it.admin@yourcompany.com` only. | NOT CONFIGURED |
| Who can create more Admins? | Anyone with `users.manage` **and** `users.create_admin` who also holds every permission of the role, which by default is **only the MD**. `system_admin` does **not** have `users.create_admin`, so an administrator cannot create another administrator. Also the database administrator via `admin:create`. | IMPLEMENTED |
| Suspend Admin accounts? | Yes: status *suspended* or *terminated* with a mandatory reason; sessions end immediately. Only someone who may administer that person (MD for privileged roles). | IMPLEMENTED |
| Revoke admin privileges? | Yes: change or deactivate the membership (`updateMembership`), under the same rules. You cannot change your own role's permissions. | IMPLEMENTED |
| Admin actions audited? | Yes: database audit log (`app.audit`) for user, role, permission, status, invitation, 2FA reset and setting changes. Privileged grants raise alerts (critical for MD). The audit log cannot be edited or deleted. | IMPLEMENTED |
| 2FA enforced for all privileged admins? | Yes. Privileged roles are flagged `mfa`, and production requires it for **all** staff. | IMPLEMENTED |

### 17.4 Super Admin architecture

| Layer | Exists? | What it is in this ERP |
|---|---|---|
| **A. Application-level Super Admin** | **IMPLEMENTED, as the MD role.** There is no separate "Super Admin" role. | `md` holds every permission, cannot be edited, and there is one per installation (a second needs the database administrator and is alerted). It manages both companies when the account is a member of both. |
| **B. Company-level MD** | Technically **per company**: a role row in each company, assigned per membership. | The same person normally holds `md` in **both** EDX and GRD (the setup tool's default). An MD of only one company is possible. |
| **C. Global system administrator** | **PARTIALLY.** `system_admin` is assigned **per company**. Holding it in both companies gives cross-company administration of users, roles and settings, but **not** student data, **not** creating privileged accounts, and **not** MD powers. | No single "global" flag exists. Global means "member of both companies". |
| **D. Hosting infrastructure administrator** | **NOT CONFIGURED.** Outside the application. | The "technical owner" in `INCIDENT_RESPONSE_PLAN.md` (two named people, *not yet appointed*). No hosting account exists. |
| **E. Database administrator** | **Designed; NOT CONFIGURED.** Outside the application. | Holds `DATABASE_ADMIN_URL` (migrations, provisioning, `admin:create`). It must never be configured in the web host's runtime environment (`.env.example`). Not yet appointed for production. |

**Does a global Super Admin who manages both companies exist?** Yes, functionally: **an MD account that is a member of both companies** has full power over both, including company configuration, users, permissions and settings. **Recommendation:** do **not** add a separate Super Admin role. That would be a second all-powerful identity. Keep the MD as the only application super admin, keep `system_admin` without `users.create_admin` and without student data, and handle emergencies with the sealed emergency MD design (17.7). Ordinary company administrators do not get global access automatically: each company membership is granted separately, and privileged roles can only be granted by the MD.

### 17.5 Official business email vs application login email

| Purpose | Separately configured? | Where | Current value |
|---|---|---|---|
| Official business email addresses | Not modelled. The ERP stores **one** email per user, which is both the login ID and the contact address. | `user_profiles.email` | — |
| Staff Login IDs | Per user (email) | `user_profiles.email` | fictional demo only |
| MD Login ID | Same mechanism (email) | — | NOT CONFIGURED (demo: `md@demo.test`) |
| CEO Login ID | Same | — | NOT CONFIGURED (demo: `ceo@demo.test`) |
| Admin Login IDs | Same | — | NOT CONFIGURED (demo: `admin@demo.test`) |
| Student Login IDs | **Separate system.** Student portal accounts sign in with the student's **email or mobile number**, plus a password or a one-time code. | portal accounts (`frontend/src/app/portal/forms.tsx`, `services/portal-accounts.ts`) | real student data, not inspected |
| System notification email (security alerts, staff emails) | **One sender** `EMAIL_FROM` via Resend | `backend/src/lib/email.ts`, `lib/security/jobs.ts` | **empty** locally; not configured anywhere |
| Invitation sender | **The same** `EMAIL_FROM` (Resend) | `frontend/src/app/actions/admin.ts` (`deliverInvitation`) | empty |
| Password reset sender (staff) | **The same** `EMAIL_FROM` (Resend) | `backend/src/lib/auth/staff-email.ts` | empty |
| Student notifications, portal set-up/reset links, sign-in codes, email verification | **Separate, per company:** `EMAIL_FROM_EDX` / `EMAIL_FROM_GRD` over each brand's SMTP (`EMAIL_SMTP_URL_EDX/GRD`) | `backend/src/lib/notifications/providers.ts` | not present in the local `.env` (not configured) |
| Support email (student portal) | **Separate**, per company, set in the app (Company settings → "Student portal: support email"). Shown to students. | `organizations.settings.support_email` | NOT VERIFIED (stored in the DB; not queried) |

**Findings:**
- Staff invitations, staff password resets and security-alert emails all use **one shared sender** (`EMAIL_FROM`). Student-facing mail uses the per-brand senders. That is a reasonable split, but neither is configured.
- The login ID **is** the person's email. Using a personal mailbox (e.g. Gmail) as an MD or CEO login is **technically allowed**: there is no domain restriction on staff emails.
- **No domain email is configured**, and no company domain appears in the repository. Owning a domain does not provide mailboxes or a verified sending domain. Both must be set up with an email provider and DNS.

### 17.6 Production hosting and deployment email configuration

| Item | Finding | Status |
|---|---|---|
| Production domain and subdomains | None configured. Example only: `staff.yourcompany.com`. | NOT CONFIGURED |
| Hosting provider | Undecided. DEPLOYMENT.md recommends Vercel + Supabase; HOSTING_EMAIL_SCANNER_OPTIONS.md recommends hybrid H3 (Hostinger VPS + Supabase); nothing purchased. `frontend/vercel.json` defines crons only. Express currently loopback-only (see VITE_MIGRATION_PHASE1.md D-V1). | NOT CONFIGURED |
| Production environment variables | Only the template `.env.example` exists. The local `.env` is development (localhost `APP_URL`, `NOTIFICATIONS_MODE=test`). Production refuses to start unless `NOTIFICATIONS_MODE=live`. | NOT CONFIGURED |
| SMTP / transactional provider | Code: **Resend** (staff mail) and **SMTP per brand** (student mail, via nodemailer). Locally `RESEND_API_KEY` and `EMAIL_FROM` are **empty**, and the brand SMTP variables are absent. | IMPLEMENTED in code; NOT CONFIGURED |
| Sender address | None configured | NOT CONFIGURED |
| Sender-domain verification, SPF, DKIM, DMARC | Required by Resend, SES and ZeptoMail (HOSTING_EMAIL_SCANNER_OPTIONS.md §3). No DNS records exist or were checked. | NOT CONFIGURED / NOT VERIFIED |
| Production database | None. Designed: separate low-privilege runtime role `erp_app` + admin URL only for scripts. | NOT CONFIGURED |
| Auth callback URLs | No external identity provider or OAuth, so there are no callbacks. Links are built from `APP_URL`. | Not applicable |
| Password reset URLs | `APP_URL` + `/reset-password/<token>` (1 hour for self-service; 24 hours for setup links from `admin:create`) | IMPLEMENTED; `APP_URL` NOT CONFIGURED for production |
| Invitation acceptance URLs | `APP_URL` + `/invite/<token>` (valid `STAFF_INVITE_DAYS`, 1–14 days, default 7) | IMPLEMENTED; NOT CONFIGURED |
| Secure cookies / HTTPS | In production: `__Host-erp_session`, `Secure`, `HttpOnly`, `SameSite=Lax`; HSTS in production (`next.config.ts`). HTTPS depends on the host. | IMPLEMENTED in code; HTTPS NOT VERIFIED |
| Separate dev / staging / production | Designed (`APP_ENV=staging`; separate databases, buckets and secrets per environment). Only development exists. | PARTIALLY IMPLEMENTED |

**Which addresses will actually send system email after deployment?** None yet: until `EMAIL_FROM` and the per-brand `EMAIL_FROM_EDX` / `EMAIL_FROM_GRD` are set and verified, **no email is sent**. Invitations and reset links are then shown on screen for the administrator to pass on securely, and self-service reset emails are recorded as "skipped".

**Are MD, CEO and Admin production logins configured?** **No.** All three still need creating with `admin:create` after the production database exists.

### 17.7 Emergency MD account and recovery

| # | Question | Finding | Status |
|---|---|---|---|
| 1 | Dedicated emergency MD account implemented? | **No.** `docs/EMERGENCY_MD_ACCOUNT_DESIGN.md` is a **proposal only** ("Nothing has been built, created or activated"). PILOT_READINESS_CHECKLIST.md D4: "Wanted, but not to be created until the design is approved". | **Documented design, NOT IMPLEMENTED** |
| 2 | Separate from normal MD login? | In the design, yes: own account and own email, kept *suspended* ("sealed") | design only |
| 3 | Email configured? | No. Design placeholder `emergency-md@<company domain>`, decision E3 PENDING OWNER CONFIRMATION. | NOT CONFIGURED |
| 4 | 2FA required? | Design: yes, with the authenticator held offline and two-person custody. Production already enforces 2FA for any account. | design only |
| 5 | MD loses primary email? | The login ID is the email, but sign-in needs **password + 2FA**, not email access, so losing the mailbox does not lock the MD out. **Self-service** password reset needs that mailbox. Changing the MD's email: not verified, because no in-app path to edit a protected MD's email was confirmed (the MD cannot be administered by others in the app). | NOT VERIFIED |
| 6 | Recover without bypassing security? | Today: the MD's own **recovery codes** (single-use) are the only in-app route. If the MD loses both the authenticator and the recovery codes, **nobody in the app can reset the MD's 2FA** (`app.can_administer_user` excludes protected roles and yourself). The only route is the database administrator acting directly on the database, and **no tool or runbook exists** for that. | **PARTIALLY IMPLEMENTED (gap P17-1)** |
| 7 | Emergency actions recorded? | Existing: 2FA resets, sign-ins, status changes and MD grants are audited and alerted. The design adds critical alerts on unseal, every sign-in and re-seal (not built). | PARTIALLY IMPLEMENTED |
| 8 | Recovery procedures documented? | Partially: ADMIN_MD_OPERATIONS_GUIDE.md §8 and INCIDENT_RESPONSE_PLAN.md §4.2. However, §8 says the technical owner resets the MD's 2FA "with the setup tool", and **that tool does not exist** (`create-admin.ts` issues password links only). | PARTIALLY IMPLEMENTED (documentation inaccurate) |
| 9 | Restore access if the primary MD is locked or compromised? | Locked by failed attempts: the lock expires (15 minutes). Compromised: a second MD can be created by the database administrator (`--allow-additional-md`, audited and alerted); the compromised account must then be suspended. No in-app user can suspend the MD, so this also needs the database administrator or the second MD. | PARTIALLY IMPLEMENTED |
| 10 | Emergency credentials stored securely? | Design: two sealed envelopes, two custodians (E2 pending). No credentials exist. | NOT IMPLEMENTED |

**Gap P17-1 (reported, not fixed: read-only audit).** There is **no supported way to recover the MD's two-factor login** if the authenticator and all recovery codes are lost. The operations guide refers to a "setup tool" for this that does not exist. Options to decide on: (a) a database-administrator CLI `mfa:reset` that requires a reason, is audited and raises a critical alert (mirrors `admin:create`); or (b) rely on the sealed emergency MD account once it is built. Until one exists, recovery depends on hand-written SQL by the database administrator, which is neither tested nor documented.

### 17.8 Production account readiness matrix

| Account / Purpose | Existing Email Configured? | Existing Login Account? | Role / Permissions | 2FA Status | Production Ready? | Missing Configuration | Recommended Action |
|---|---|---|---|---|---|---|---|
| **MD** | NOT CONFIGURED (demo `md@demo.test` only) | NOT CONFIGURED (prod); demo only (dev, not queried) | IMPLEMENTED: `md`, protected, every permission, both companies | IMPLEMENTED (mandatory) | NOT CONFIGURED | Official mailbox; production DB; `admin:create --role md --orgs EDX,GRD`; 2FA enrolment; recovery codes offline | RECOMMENDED: `md@<domain>`, created by the DB administrator at go-live, recovery codes in a safe |
| **CEO** | NOT CONFIGURED | NOT CONFIGURED | IMPLEMENTED: `ceo` role (oversight; no financial amounts) | IMPLEMENTED (mandatory) | NOT CONFIGURED | Official mailbox; `admin:create --role ceo` | RECOMMENDED: `ceo@<domain>` as an individual account |
| **Super Admin** | — | NOT IMPLEMENTED (no separate role; the MD **is** the super admin) | MD role | — | — | None, if the MD-as-super-admin design is kept | RECOMMENDED: do not add a separate super-admin role |
| **Company Admin** | NOT CONFIGURED | NOT CONFIGURED | IMPLEMENTED: `system_admin` per company (users, roles, settings; no student data; cannot create privileged accounts) | IMPLEMENTED (mandatory) | NOT CONFIGURED | Named individual(s); mailbox(es); `admin:create --role system_admin --orgs <EDX/GRD>` | RECOMMENDED: one named person per admin, e.g. `firstname.lastname@<domain>`, not a generic `admin@` |
| **Finance Admin** | NOT CONFIGURED | NOT CONFIGURED | PARTIALLY IMPLEMENTED: no "Finance Admin" role; `finance` ("Finance Staff": record/verify/reverse payments, finance exports) per company. The MD can create a custom role. | IMPLEMENTED (role flag + production rule) | NOT CONFIGURED | Owner decision whether a separate finance-admin role is needed | RECOMMENDED: use `finance` per company, created in the app by the MD/admin |
| **Other Administrators** | NOT CONFIGURED | NOT CONFIGURED | IMPLEMENTED: individual accounts, any role, custom roles via Roles | IMPLEMENTED (mandatory for all staff in production) | NOT CONFIGURED | Staff list; email provider for invitations | Create in the app (Staff), one account per person |
| **Emergency MD Account** | NOT CONFIGURED (E3 pending) | NOT IMPLEMENTED (design only) | Design: MD powers, sealed, time-limited | Design: offline authenticator | NOT IMPLEMENTED | Owner decisions E1–E6; migration, unseal/reseal commands, tests, runbook | RECOMMENDED: approve and build the design, or at least the `mfa:reset` tool (P17-1), before go-live |
| **System Email Sender** | NOT CONFIGURED (`EMAIL_FROM`, `RESEND_API_KEY` empty) | n/a | Invitations, staff resets, security alerts | n/a | NOT CONFIGURED | Provider account; verified sending domain; SPF, DKIM, DMARC; `EMAIL_FROM`; per-brand `EMAIL_FROM_EDX/GRD` + SMTP for student mail | RECOMMENDED: `no-reply@<domain>` (Resend, verified domain); brand senders for student mail |
| **Student Support Email** | NOT VERIFIED (in-app setting per company; DB not queried) | n/a | Shown on the student portal | n/a | NOT VERIFIED | A monitored mailbox per brand; set in Company settings | RECOMMENDED: `support@<edx domain>` and `support@<grd domain>`, staffed mailboxes |

### 17.9 Recommended production email architecture (RECOMMENDED; not created)

**Created by the domain/email provider (mailboxes and DNS), outside the ERP:**
1. `md@<domain>`: personal official mailbox of the MD (the login ID; the MD alone has access).
2. `ceo@<domain>`: personal official mailbox of the CEO.
3. One **named** mailbox per administrator (e.g. `firstname.lastname@<domain>`). No shared `admin@` login.
4. `emergency-md@<domain>`: only if the emergency design is approved (E3). Access restricted to the custodians.
5. `no-reply@<domain>` (or `notifications@`): **sending-only** address for invitations, staff password resets and security alerts (`EMAIL_FROM`), on a sending domain verified with SPF, DKIM and DMARC.
6. Per-brand student senders (`EMAIL_FROM_EDX`, `EMAIL_FROM_GRD`), e.g. `admissions@<edx domain>` and `admissions@<grd domain>`, with the same DNS records.
7. `support@<edx domain>` and `support@<grd domain>`: monitored mailboxes, entered as the portal support email.
8. Optionally a `security@<domain>` distribution list for incident contacts (alerts themselves go to holders of `security.alerts` by their own email).

**Created inside the ERP (by the people shown):**
| Account | Created by | How |
|---|---|---|
| MD | Database administrator, at go-live | `npm run admin:create -- --email md@<domain> --name "…" --role md --orgs EDX,GRD` |
| First System Administrator(s) | Database administrator | `admin:create --role system_admin` |
| CEO | Database administrator, or the MD in the app | `admin:create --role ceo`, or Staff → Add |
| Finance, managers, counsellors, documentation, visa | System Administrator or MD in the app | Staff → Add (invitation link) |
| Emergency MD | Database administrator with both custodians, only after the design is approved and built | `admin:create --role md --allow-additional-md` + sealing |

**Rules:** one login per person; 2FA compulsory (already enforced in production); invitations and resets only through one-time, time-limited links (already built); audit log and alerts (already built); MD recovery codes offline; no generic or shared logins for privileged roles.

### 17.10 Direct answers

1. **MD email / Login ID:** none for production. The only MD identity in the code is the fictional development demo `md@demo.test`. Production placeholder: `md@yourcompany.com` (not real).
2. **MD ready for production?** **No.** No production environment, mailbox or account exists, and MD 2FA recovery has a gap (P17-1).
3. **Separate CEO login exists?** CEO is a **role**, given to an individual account. No production CEO account exists; a fictional demo `ceo@demo.test` exists for development.
4. **CEO Login ID:** none configured (placeholder `ceo@yourcompany.com`).
5. **Dedicated Admin account configured?** **No.** The role `system_admin` exists; the account does not (demo `admin@demo.test` only).
6. **Global Super Admin exists?** Not as a separate account or role. **The MD role is the application super admin** for both companies.
7. **Can the MD manage both companies?** **Yes**, when the MD account is a member of both (the default of the setup tool and of the demo).
8. **Individual administrator accounts available?** **Yes**: one email per person, any number of administrators, and no shared credentials in code.
9. **Invitation sender:** `EMAIL_FROM` through Resend. **Not configured**, so invitations are currently shown on screen for manual, secure hand-over.
10. **Password reset sender:** the same `EMAIL_FROM` (Resend) for staff. Student portal links use `EMAIL_FROM_EDX/GRD`. **Not configured.**
11. **Official domain emails to create:** `md@`, `ceo@`, one named mailbox per administrator, `no-reply@` (sender), per-brand student senders, `support@` per brand, and `emergency-md@` if approved. All also need SPF, DKIM and DMARC on the sending domain(s).
12. **Emergency MD recovery mechanism exists?** **No.** Only a documented, unapproved design. Today the MD's recovery codes are the only supported recovery. If they are lost, there is no tool (P17-1).
13. **Configuration still required before production:**
    - hosting decision and domain, with HTTPS;
    - production and staging databases and buckets;
    - all secrets;
    - `APP_URL`;
    - `NOTIFICATIONS_MODE=live`;
    - email provider, verified sending domain(s) and SPF, DKIM, DMARC;
    - `EMAIL_FROM` and the per-brand SMTP and senders;
    - `TRUST_PROXY`;
    - cron schedulers;
    - virus scanner;
    - a named database administrator and technical owner;
    - MD, CEO and admin accounts via `admin:create`, with 2FA enrolment;
    - portal support emails;
    - owner decisions E1–E6;
    - a fix or decision for P17-1.
14. **Recommended final production account structure:**
    - **one MD** (`md@<domain>`, both companies, protected);
    - an optional **sealed emergency MD**;
    - **one CEO** account (both companies);
    - **named System Administrators** per company (no student data, cannot create privileged accounts);
    - **finance and other staff** as individual accounts created in the app;
    - a **sending-only** `no-reply@` for system mail and per-brand student senders;
    - **support mailboxes** per brand;
    - **database administrator and hosting owner** as named people **outside** the app.
