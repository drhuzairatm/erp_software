# Security incident response plan

**Version:** Phase D, 1 Nov 2026.

**Applies to:** the staff ERP, the student/parent portal, the database, file storage and backups. It takes effect once the system holds real data.

**This plan replaces** the short incident checklist that used to be in BACKUP_RECOVERY.md.

> **Golden rules**
> - **Contain first, investigate second.**
> - **Never delete or edit evidence:** the audit log cannot be edited anyway; do not wipe devices before evidence is preserved.
> - **Write down what you did and when.**
> - **Tell the MD immediately for anything rated High or Critical.**

## 1. Roles and authority
| Role | Who (default) | May decide / do |
|---|---|---|
| **Incident lead** | **MD** (or a deputy the MD names in writing) | Declares an incident and its severity. Approves containment that affects business (suspending staff, taking the system offline, restoring backups). Decides on notification to students, authorities and partners. |
| **Account actions** | MD; administrators with `users.manage` **within their authority** | Suspend, terminate or reactivate staff; sign out everywhere; cancel invitations. Nobody can act on the MD account or on their own account. |
| **2-step reset** | Holders of `users.mfa_reset` (MD by default) | Reset a person's 2-step login after verifying identity (note required). |
| **Security alerts and login history** | Holders of `security.alerts` (MD by default) | Review, acknowledge and annotate alerts; review login history. |
| **Document quarantine / clearance** | Infected files are quarantined automatically. Manual clearance only with `documents.security_clear` (MD by default). | Nobody can release an infected file. |
| **Finance actions** | Finance staff (record, verify a different person's entry); MD | Reverse entries (with reason); never delete. |
| **Technical owner** (hosting and database administrator: two named people, to be appointed) | Not yet appointed (see PILOT_READINESS_CHECKLIST.md) | Rotate secrets; take the app offline; restore databases and files; preserve server logs. **Only on the incident lead's instruction**, except an emergency shutdown during active damage. |
| **Legal / privacy adviser** | External (to be appointed) | Advises on notification duties (e.g. India's DPDP Act 2023 and its rules) and wording. |

## 2. Severity
| Level | Examples | Response |
|---|---|---|
| **Critical** | Confirmed leak of student documents or personal data; database or hosting compromise; ransomware; MD account compromised | Immediately, any time. MD informed at once. Consider taking the system offline. |
| **High** | Staff account compromised; malware detected; bulk export or download by a leaver; suspicious payment entries; failed backups | Same working day. MD informed within 1 hour. |
| **Medium** | Repeated failed sign-ins on one account; lost device with 2-step login; refused export attempts | Within 1 working day. |
| **Low** | One-off failed sign-ins; acknowledged informational alerts | Routine weekly review. |

## 3. Common steps (every incident)
1. **Detect:** sources are listed per incident below.
2. **Record:** open an incident note (date and time, who reported, what was seen, alert IDs). Use a shared document outside the ERP, in case the ERP is affected.
3. **Contain:** the incident-specific actions below.
4. **Preserve evidence:**
   - **Audit log:** export the entries for the period (Audit log → filters).
   - **Alerts:** keep the security-alert IDs.
   - **Hosting logs:** ask the technical owner to save them.
   - **Devices:** do not wipe a device until the MD agrees.
5. **Investigate:** who, what, when and how much.
   - **Who:** login history of the person.
   - **What:** their downloads and exports.
   - **Changes:** what they changed (audit log before/after values).
6. **Recover:** restore access or data. Only restore backups on the MD's decision (see section 4.9).
7. **Notify:**
   - **Internally:** the MD.
   - **Externally:** on the MD's decision with the legal adviser (students and parents, partner universities, authorities under applicable law).
8. **Close:**
   - acknowledge the related security alerts with a note
   - write a short lessons-learned entry
   - update this plan if needed

## 4. Procedures

### 4.1 Suspected account compromise (staff)
**Detect:**
- alerts: "Repeated failed sign-ins", "Failed sign-ins across many accounts" (high), "Password reset requests limited", "Wrong two-factor codes", "Staff role or company access changed"
- unusual login history (unknown address or browser, odd hours)
- the person reports it

**Contain:** an administrator within authority, or the MD:
1. Staff → person → **Suspend** (reason: "Suspected compromise"). This ends all sessions and **trusted browsers** immediately and blocks sign-in and password links.
2. If 2-step login may be compromised: MD (`users.mfa_reset`) resets it **only after** identity is verified (see 4.2).

**Password guessing only (no successful sign-in):** suspension is not needed. The person's usual browser keeps working; others are blocked for 15 minutes. If they are locked out on a new device, help them reset (ADMIN_MD_OPERATIONS_GUIDE.md §6). For "many accounts" alerts, consider host firewall or bot protection.

**Investigate:**
- the person's login history and active sessions
- the audit log for their actions: downloads, exports, document actions, payments, role changes

**Recover:**
1. The person changes their password through an administrator-issued link.
2. They set up 2-step login again.
3. Reactivate the account.
4. Reverse any wrong changes through the normal workflows (payments are reversed, documents re-reviewed).

**If the MD account is suspected:**
- **Severity:** Critical.
- **Action:** the technical owner revokes MD sessions with database access, rotates secrets and resets the MD's 2-step login with the setup tool, under the MD's own (in-person) instruction. A second MD exists only if one was deliberately created (an owner decision).

### 4.2 Lost or stolen staff device
1. **The staff member reports it immediately** (phone, email, in person).
2. Administrator or MD: **Sign out everywhere** for that person. If the phone held the authenticator, the person signs in with a recovery code and sets up 2-step login on the new phone.
3. **If recovery codes were on the device or are used up:**
   - The MD resets 2-step login after verifying identity: a video call with photo ID, or in person, plus a question only the employee can answer.
   - Record the method in the reset note (the system requires it).
4. **If the device was a laptop with downloaded documents:**
   - treat it as a possible data leak (4.3)
   - list what the person downloaded (audit log: file downloads)

### 4.3 Unauthorised student-data access
**Detect:**
- a complaint
- audit log: a person viewing or downloading students outside their work
- alerts: bulk document views/downloads, bulk portal downloads, large export, role/company access changed

**Contain:**
- suspend the account if misuse is likely
- remove the wrong role or company access (Staff list)

**Investigate:**
- exactly which students and documents (audit log, filtered by person and date)
- whether data left the system (downloads, exports)

**Recover:**
- correct role configuration
- check other people with the same role

**Notify:** MD; legal adviser for the decision on informing affected students or parents and any authority.

### 4.4 Malware or infected document upload
**Detect:**
- critical alert "Malware detected in an uploaded file (quarantined)" (when a scanner is configured)
- a staff device antivirus warning after opening a file

**Contain:**
- **Infected files:** quarantined automatically. They cannot be opened, downloaded, merged, published, approved, cleared or sent by courier.
- **If a staff device warned:** disconnect it from the network, do not open more files, inform the MD.
- **If the file had been manually cleared earlier:** treat the clearance as an incident; review the other clearances by the same person.

**Investigate:**
- which upload channel (staff or portal) and which account
- whether the uploader account is compromised (4.1)
- other uploads from the same source

**Recover:**
- ask the student for a clean copy (a new version)
- the device is cleaned by IT before reconnecting

**Note:** without a scanner there is no automatic detection. This is why manual clearance is restricted and alerted.

### 4.5 Unauthorised or excessive document downloads
**Detect:** high alert "Unusually many document views or downloads by one person", or "Unusually many document downloads through one student portal account"; audit log of file views (`file_access`), downloads (`file_download`) and portal downloads (`portal_download`).

**Contain:** suspend the account if the activity is not explained by work (ask the manager first if possible).

**Investigate:** which documents and students; whether the person was leaving the company.

**Recover:** retrieve or delete copies where possible (written confirmation from the person); continue with 4.3 if personal data left the company.

### 4.6 Suspicious financial activity
**Detect:**
- unexpected reversals or rate corrections
- receipts verified unusually fast
- mismatches in the monthly bank reconciliation
- complaints from students about payments

**Contain:** the MD suspends the finance accounts involved if fraud is likely. Entries **cannot be deleted or edited**, so the history is intact.

**Investigate:**
- audit log of payment entries, verifications, reversals and rate corrections (who recorded, who verified)
- compare with bank statements

**Recover:**
- correct through reversals by a different finance person
- inform the accountant
- consider police or legal action (MD decision)

### 4.7 Data leakage or bulk export
**Detect:** alerts "Large data export", "Unusually many exports", "Export refused"; reports of student data appearing outside the company.

**Contain:**
- suspend the account
- remove export permissions from the role if they were too wide

**Investigate:** audit log of exports (report, rows, whether contact or finance data was included).

**Recover and notify:** as 4.3. A leak of contact or passport data is **Critical**.

### 4.8 Suspected database or hosting compromise
**Detect:**
- signs in hosting logs
- unexpected database users or settings
- missing audit entries
- the app behaving unexpectedly
- an alert from the hosting provider

**Contain:** the technical owner, on the MD's instruction (or immediately during active damage):
1. Put the app in maintenance or take it offline.
2. Rotate:
   - the database owner and application passwords
   - storage keys
   - `STORAGE_SIGNING_SECRET`
   - the cron secret
   - the email and WhatsApp keys
3. Revoke all sessions. This can be done in the database by the technical owner.

**Preserve:**
- hosting and database logs
- a copy of the current database **before** any restore, for investigation

**Recover:**
- restore into a **new** database from the last backup known to be clean (4.9)
- verify with the restore checks (`scripts/backup-restore-drill.ts`-style counts, files and security objects)
- switch the app over

**Notify:** Critical. MD with the legal adviser decides on notification.

### 4.9 Backup failure or data corruption
**Detect:**
- a failed backup job (hosting notification)
- the quarterly restore test fails
- staff report missing or wrong data

**First check whether a restore is needed:**
- many mistakes are corrected in the app: students are archived, not deleted; payments are reversed; the audit log shows before/after values
- **do not restore over production**

**Restore** (MD decision; technical owner performs):
1. Choose a backup from before the problem.
2. Restore into a **new** database (BACKUP_RECOVERY.md).
3. Restore the files from the same time.
4. Run the verification checks:
   - row counts
   - referential integrity
   - security objects
   - files present
5. Compare the important records with the reported problem.
6. Switch the app over.
7. Record in the incident note what was lost between the backup and the incident (RPO).

**Backup job failure:** fix within one working day. Until fixed, take a manual dump.

## 5. Contacts (to be completed by the MD)
| Role | Name | Phone | Email |
|---|---|---|---|
| Incident lead (MD) | PENDING OWNER CONFIRMATION | | |
| Deputy | PENDING OWNER CONFIRMATION | | |
| Technical owner 1 / 2 | PENDING OWNER CONFIRMATION | | |
| Hosting provider support | PENDING (hosting not chosen) | | |
| Legal / privacy adviser | PENDING OWNER CONFIRMATION | | |

## 6. Practice
Run a short tabletop exercise during the pilot: a "lost phone" case and a "leaver bulk download" case. Also run one restore test on staging.
