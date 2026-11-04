# Part 17: verification of the three unverified items (read-only)

| | |
|---|---|
| Date | 3 Nov 2026 |
| Branch / HEAD | `refactor/express-api` at `af63526` (clean working tree before this file) |
| Related | `docs/STAFF_INVITATION_LOGIN_PASSWORD_AUDIT.md` (Part 17), `docs/AUTHENTICATION_AND_PORTAL_IMPLEMENTATION_ROADMAP.md` (both left unchanged) |

## Method and safety

- **Database:** the local **development** database only (`erp_dev` on localhost:54329, the embedded PostgreSQL that was already running). No production, staging or test database was used. The script refused to run unless the host was local, the port was 54329 and the database was `erp_dev`.
- **Connections tried, in order:**
  1. `DATABASE_URL`, the low-privilege application role `erp_app`, in a read-only transaction. It returned **0 rows** for every table: row-level security hides staff, role and company rows when no signed-in user is set. It could not answer items 1 or 2.
  2. `DATABASE_ADMIN_URL`, the database owner role, on the **same** `erp_dev` database. No dedicated read-only role exists. Writes were blocked on the server in two ways: the session setting `default_transaction_read_only=on`, and `BEGIN READ ONLY`. A guard query confirmed `transaction_read_only = on` before any other query ran. Every statement was a `SELECT`.
- **Tables and columns read** (taken from `backend/db/migrations/0001_foundation.sql`, `0032_staff_accounts.sql`):
  - `user_profiles`: `email`, `account_status`, `is_active`, and whether `email_verified_at` is set;
  - `organization_memberships`: `user_id`, `org_id`, `role_id`, `is_active`;
  - `roles`: `key`;
  - `organizations`: `code`, `name`, `settings ->> 'support_email'`.
- **Not read:** names, phones, students, documents, finance, passwords and hashes, 2FA secrets, recovery codes, sessions and tokens. No connection string or secret was printed; for `.env` only the host, port, database and role names were checked.
- **Nothing changed:** no write, migration, seed, test or application-code change.
- **Files:** a temporary script and its raw output were kept in the session's scratchpad (outside the repository), and the raw output was deleted after counting. A copy of the script was briefly created at `backend/.p17-tmp.mjs` by mistake and deleted before it was run or committed.

---

## 1. Staff accounts in the development database and their roles: **VERIFIED** (development only)

**70** staff accounts in `user_profiles`, each with one membership per company:

| Group | Count | Login IDs (emails) | Roles (`roles.key`) by company | Status |
|---|---|---|---|---|
| Demo MD | 1 | `md@demo.test` | `md` in **EDX and GRD** | active, email not verified |
| Demo CEO | 1 | `ceo@demo.test` | `ceo` in EDX and GRD | active |
| Demo System Administrator | 1 | `admin@demo.test` | `system_admin` in EDX and GRD | active |
| Demo managers | 2 | `edx.manager@demo.test`, `grd.manager@demo.test` | `manager` (EDX; GRD) | active |
| Demo counsellors | 4 | `edx.counsellor@`, `edx.counsellor2@`, `grd.counsellor@`, `grd.counsellor2@demo.test` | `counsellor` (EDX ×2; GRD ×2) | active |
| Demo documentation | 2 | `docs@`, `docs2@demo.test` | `documentation` (EDX) | active |
| Demo visa | 1 | `visa@demo.test` | `visa` (EDX) | active |
| Demo finance | 4 | `edx.finance@`, `edx.finance2@`, `grd.finance@`, `grd.finance2@demo.test` | `finance` (EDX ×2; GRD ×2) | active |
| Automated-test leftovers | 53 | `invite.e2e.*`, `mfa.e2e.*`, `n1.e2e.*`, `photo.staff.*` `@example.test` | `counsellor` (EDX) | 13+14+7 active; 1 suspended; 18 invited |
| **Non-fictional address** | **1** | a personal **gmail.com** address (local part withheld here) | **`system_admin` in EDX** | **invited** (setup not completed), email not verified |

**Findings:**
- **There is exactly one MD (`md@demo.test`), and it is fictional demo data for development.** It is not a production identity, and it confirms the Part 17 answer.
- **The CEO and admin accounts are also demo data.** No production MD, CEO or admin account exists, and no production database exists.
- **New finding P17-2: one real-looking personal Gmail address holds a pending System Administrator invitation (EDX) in the development database.** This conflicts with the Part 17 recommendation of official, named domain mailboxes for privileged roles. It is development data only. Please confirm whether it is expected. If it is not, an MD or administrator can cancel the invitation in the app (Staff → the person → Cancel invitation). Nothing was changed by this audit.
- The 53 `@example.test` accounts were left by browser tests run against the development database in the past. They are harmless and fictional, but they make the development database noisier.

## 2. Student-portal support email per company: **VERIFIED** (development only)

| Company | `organizations.settings ->> 'support_email'` |
|---|---|
| EDX (Dr.Expert Edulinks) | **not set** (the key is absent) |
| GRD (GRADUATER) | **not set** (the key is absent) |

**Where it is set and used:** Company settings → "Student portal: support email" (`frontend/src/app/(app)/admin/admin-forms.tsx`, saved by `backend/src/services/admin.ts` into `settings.support_email`, maximum 120 characters). It is shown on the student portal home page only when set (`frontend/src/app/portal/home/page.tsx:269`). Today students see **no** support email for either company.

## 3. How an MD's login email can be changed: **VERIFIED** (code); **no supported procedure exists**

| Path | Can it change a staff login email? | Evidence |
|---|---|---|
| Web app (any user, including the MD) | **No.** The application database role has no permission to update the `email` column at all. | `0007_security.sql:406` grants `update (full_name, job_title, is_active)` and `0032_staff_accounts.sql:55` grants `update (phone, joining_date)`; `email` is never granted |
| Staff details form | **No.** It updates only name, job title, phone and joining date, and refuses your own record. | `backend/src/services/admin.ts` `updateStaffDetails` (around line 114) |
| For an MD specifically | No one in the app may administer an MD at all | `app.can_administer_user` / `app.can_assign_role` exclude protected roles (`0012_roles_mfa_departments.sql:84–103`) and yourself |
| Setup tool `npm run admin:create` | **No.** It looks people up by email, and a new email creates a **new** account. | `backend/scripts/create-admin.ts` |
| Any other script or database function | **None found.** No `update … set email` for staff anywhere in the code or migrations. | repository search |
| Documentation | **No procedure documented.** No section of ADMIN_MD_OPERATIONS_GUIDE.md, INCIDENT_RESPONSE_PLAN.md or DEPLOYMENT.md covers changing a staff or MD login email. | docs search |

**Conclusion:** today the only way to change an MD's login email is a **hand-written SQL update by the database administrator** (owner connection). The `user_profiles` audit trigger would record that change (`0001_foundation.sql:319`). However, it is **not supported, not tested and not documented**:
- it does not end the MD's sessions;
- it does not notify the old or new address;
- it does not reset the email-verified flag.

**New finding P17-3 (reported, not fixed).** There is no supported procedure to change the MD's login email (for example, when moving from a personal to an official mailbox, or after losing a mailbox). The options for the owner are:

(a) A database-administrator command (like `admin:create`). It would:
- require a reason;
- refuse duplicates;
- clear email verification;
- end sessions;
- write an audit entry;
- raise a critical alert;
- send a notice to both addresses.

(b) Re-provision instead: create the MD on the new address with `--allow-additional-md`, then suspend the old account. This is possible today, but it is not documented as a procedure and it raises the critical "MD role granted" alert.

## Summary

| # | Item | Result | Key answer |
|---|---|---|---|
| 1 | Staff accounts and roles in the development database | **VERIFIED** | 70 accounts. The single MD is fictional demo `md@demo.test` (MD in EDX and GRD); the CEO and admin are also demo. 53 test leftovers. **One personal Gmail address with a pending EDX System Administrator invitation (P17-2).** |
| 2 | Student-portal support email per company | **VERIFIED** | Not set for EDX or GRD |
| 3 | Changing an MD's login email | **VERIFIED** (no supported path) | Impossible in the app (no column permission); no script; not documented. Only direct SQL by the database administrator (P17-3). |

The database results describe the **development** database only. Production does not exist yet, so nothing here describes production.
