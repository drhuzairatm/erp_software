# Administrator and MD operations guide

**Version:** Phase D, 1 Nov 2026.

**For:** the MD and the people the MD authorises.

**Related documents:**
- **Permissions:** ROLE_PERMISSION_MATRIX.md (generated from the database) is the authoritative list.
- **Incidents:** INCIDENT_RESPONSE_PLAN.md is the authority for incidents.

## 1. Roles and permissions
**How roles work:**
- **Per company:** roles are set up separately for Edulinks and for GRADUATER. A role in one company gives **nothing** in the other.
- **Changing them:** sidebar → **Roles & permissions**.
- **Granting rules:** people can only grant permissions they hold themselves, can never change their own role, and privileged roles need **Assign privileged roles** (`users.create_admin`).

**The MD role** is locked:
- **Permissions:** it holds every permission, including future ones.
- **Changes:** it cannot be granted, changed or removed in the app.
- **A second MD:** only possible through the database setup tool with a deliberate override. The database refuses it otherwise, and a critical alert is raised.

**Default holders of the security permissions** (MD only unless the MD delegates):

| Permission | Allows |
|---|---|
| `security.alerts` | Security alerts page; everyone's login history |
| `users.mfa_reset` | Reset someone's 2-step login (identity check and note required) |
| `documents.security_clear` | Manual security clearance of unscanned files |
| `users.create_admin` | Assign privileged roles; reinstate terminated staff |

**Delegate sparingly:** one or two trusted people at most. Every grant raises a "Role permission granted" alert.

## 2. Special access: CEO and System Administrator
By default **both are members of both companies**. This is intentional, but the MD should confirm it suits the business:

| Account | Can | Cannot (by default) |
|---|---|---|
| **CEO** | Dashboards of both companies; student records, contact details and document **statuses**; staff workload; tasks; non-financial reports and exports | See **any payment amount** (counts only, also enforced in the database); open document files; manage staff, roles or security |
| **System Administrator** | Create staff accounts and manage memberships within its own permissions; edit roles within its own permissions; settings, departments, reference data, notification settings; **read the audit log of both companies** (contact and passport details redacted) | See student records; change master data, rules or approvals (MD-only since master-data approval); reset 2-step login; clear files; see security alerts; assign privileged roles |

**To change these:** Roles & permissions, or remove a company membership on the Staff list.

## 3. Company access and staff accounts
**Add staff** (Admin → **Staff** → *Add a staff member*):
- **Profile:** name, official email, company and role, department, mobile, joining date, reporting manager, optional photo.
- **Invitation:**
  - The person receives a single-use invitation, valid 7 days (`STAFF_INVITE_DAYS`).
  - Until email is configured, the link is shown **once** to you. Give it to the person through a channel only they can read. Never paste it in group chats.
- **Status:** the list shows **Invitation pending** until they activate.

**Company access:**
- **Changing it:** per row on the Staff list (role, department, active per company).
- **Second company:** add a person to the second company by "adding" them again with the same email and the other company's role.

**Profile page** (click a name):
- **Details:** edit them here.
- **Account and access:**
  - invitation (resend or cancel)
  - status
  - sign out everywhere
- **Open tasks and sign-in activity:** also on this page.

## 4. Suspension, termination and task reassignment
**Suspend:**
- **Where:** profile → *Change account status* → **Suspend** (reason required).
- **For:** investigations and leave.
- **Effect:**
  - all sessions end immediately
  - sign-in and password links stop working
  - access to all data, including documents, ends
  - history is kept

**Terminate:** same effect, for leavers. **Only the MD can reinstate** a terminated employee.

**Reassign open tasks:**
- **Where:** profile → *Open tasks* → **Reassign all … open tasks to** a colleague (needs `tasks.assign`).
- **History:** each task records the previous owner and who moved it.
- **What moves:** completed and cancelled tasks stay with the original person.

**Order for a leaver:**
1. Suspend or terminate.
2. Reassign tasks.
3. Check their recent downloads and exports (Audit log).
4. Remove the role if they are not coming back.

## 5. Security alerts
**Where:** Admin → **Security alerts** (sidebar shows the open count; a red banner appears for high or critical).

**How they work:**
- **Origin:** created automatically by the database from the audit log, so nobody can edit or delete them.
- **Grouping:** repeats within an hour are grouped.
- **What raises them:**

  | Category | Events |
  |---|---|
  | Sign-in | Repeated failed sign-ins (per email; per address when `TRUST_PROXY` is configured, see DEPLOYMENT.md §3a); failed sign-ins across **many accounts** (high: 100+ failures on 20+ accounts in 15 minutes); wrong 2-step codes |
  | Password reset | Reset requests limited for an email or address (warning); **system-wide** reset limit reached (high); a reset email could not be delivered after 5 attempts (warning) |
  | Access changes | Permission granted or removed; role or company access changed; **MD role granted** (critical); 2-step reset (high); staff status changed |
  | Data | Large export (500+ rows); 10+ exports in an hour; refused export; 100+ document **views or downloads** in an hour by one person; 100+ downloads in an hour through one student portal account |
  | Files | **Malware detected** (critical); manual security clearance |

**Routine:**
- **Review:** daily during the pilot, then at least weekly.
- **Acknowledge** each alert with a note of what you checked. High or critical items follow INCIDENT_RESPONSE_PLAN.md.
- **Email delivery:** high and critical alerts are emailed to alert holders **only once an email provider is configured**. Until then, check the page.

## 6. Login history
- **Where:**
  - **One person:** their profile → **Sign-in activity** (active sessions plus recent events).
  - **Your own:** your name → *Two-factor login*.
- **What to look for:** unknown addresses or browsers; sign-ins at odd hours; many failures followed by a success; recovery-code use; 2-step resets.
- **Action:** use **Sign out everywhere** on the profile to end someone's sessions without suspending them. This also ends their trusted browsers.

**Helping someone who is locked out:**
- **What they see:** "Too many failed attempts from this browser". The block applies only to browsers they have not used before; their usual browser (where they completed 2-step login) keeps working.
- **What to do:**
  - Ask them to use their usual computer or phone, or to wait 15 minutes.
  - Or they use **Forgot your password?**. A reset request never locks the account.
  - Or you issue a reset link (Staff → **Issue reset link**) and hand it over through a channel you trust. Completing the reset clears the block and trusts that browser.
- **Check:** many failures they did not cause mean someone is guessing. Look at the login history and follow INCIDENT_RESPONSE_PLAN.md §4.1.
- **Reset links are private:** reset emails go through an encrypted queue that no staff member can read, the MD included, and the link is erased once sent, failed or expired.

## 7. Manual document clearance and quarantine
**While no virus scanner is configured,** every uploaded file is *Not virus-scanned*. Approval and courier release need **manual clearance**.

**How to clear:**
1. Open the document.
2. Look at the **File v… security** panel.
3. Enter a **reason** (what you checked: e.g. "original certificate seen in person; file opened in the built-in viewer only").
4. Press **Give manual clearance**.

**What it does and does not mean:**
- **Not a scan:** it is labelled everywhere as *Manually cleared (not scanned)*, never as scanned.
- **Rules:** you cannot clear a file you uploaded, or an infected file.
- **Tracking:** every clearance is audited and alerted.
- **Later scanning:** when a scanner is configured, manually cleared files are re-scanned by the daily job. If one turns out infected, it becomes quarantined.

**Infected files:**
- **Effect:** quarantined automatically. They can never be opened (including through the in-app viewer), downloaded, merged, published, approved, cleared or couriered. Every refused attempt is audited with the reason "quarantined".
- **Correction:** until the audit remediation of 1 Nov 2026, the in-app viewer's direct address did not enforce this (finding H-1). Fixed in migration 0034 and tested.
- **Records:** the record is kept for evidence.
- **Action:** ask the student for a clean copy and follow INCIDENT_RESPONSE_PLAN.md §4.4.

## 8. Two-step login: recovery and reset
- **Required for everyone;** production cannot switch it off.
- **Staff recover themselves** with their single-use recovery codes.
- **Reset** (only `users.mfa_reset`, MD by default):
  - **Where:** Staff list → the person's row → *How was their identity verified?* → **Reset 2FA**.
  - **Before resetting:** verify identity by a video call with photo ID, or in person, plus a question only the employee can answer. Never reset on the strength of an email or chat message alone.
  - **What it does:** ends the person's sessions, requires a new set-up at next sign-in, is audited with your note, and raises a high alert.
- **The MD's own 2-step login:**
  - keep the authenticator on a dedicated, locked phone and the recovery codes offline in a safe place
  - if lost, the technical owner resets it with the setup tool under the MD's in-person instruction

## 9. Audit log review
- **Where:** sidebar → **Audit log** (needs `audit.read`).
- **What it holds:** sign-ins, exports, downloads, document actions, payments, staff and permission changes, with before/after values.
- **Integrity:** it is append-only; it cannot be changed even by the database owner through normal means.
- **Redaction:** contact and passport details show as "(changed)".
- **Routine (suggested):**
  - **Weekly:** exports, downloads and permission changes.
  - **Monthly:** payment reversals and rate corrections, plus reconciliation of verified receipts with bank statements by someone outside the finance team.
  - **On every leaver:** their last 30 days.
- **Keep incident evidence** by exporting the filtered entries.

## 10. Backup and restore
- **Status today:** only the development database exists. A backup → isolated restore drill passed 31/31 checks (BACKUP_RESTORE_DRILL.md). Production backups do not exist yet.
- **Procedures:**
  - **Setup and routine:** BACKUP_RECOVERY.md (provider backups plus weekly encrypted off-site dump, quarterly restore tests on staging).
  - **Repeatable drill:** `npx tsx scripts/backup-restore-drill.ts` (local/staging only; refuses anything else).
- **Rules:**
  - restore into a **new** database, never over production
  - restore files from the same time
  - verify before switching
  - only on the MD's decision (INCIDENT_RESPONSE_PLAN.md §4.9)
- **Credentials:** backup credentials and hosting owner credentials are held by **two named people**, with 2-step login on the hosting account (to be appointed; see PILOT_READINESS_CHECKLIST.md).
