# Security threat assessment: Dr.Expert Edulinks + GRADUATER ERP

**Version:** Phase D, 1 Nov 2026.

**Code assessed:** commit `eab9075` (Phases A–C).

**Revised:** audit remediation of 1 Nov 2026 (migration 0034, not yet committed): findings H-1 (viewer quarantine), M-1 (client address) and M-2 (bulk-access alerts) from the read-only audit of `f3e8ce3`. The affected statements below are marked.

**Scope:**
- the staff web application, the student/parent portal, the PostgreSQL database and private file storage
- as built and tested **on the development Mac with fictional data**
- no staging or production environment exists yet

This is an internal assessment by the developer, **not an independent audit or certification**. An independent penetration test and a legal/privacy review are still required (see PILOT_READINESS_CHECKLIST.md).

## How to read this document

**Evidence status of each control:**

| Mark | Meaning |
|---|---|
| **T** | **Tested:** an automated test exercised it and passed (see SECURITY_EVIDENCE_REGISTER.md for the test and commit) |
| **I** | **Implemented, not tested by an automated test:** in the code or documentation, but not proven by a test |
| **P** | **Planned or external:** not built yet, or depends on hosting or a service that does not exist yet |

**Rating scales:**
- **Severity:** the residual rating with today's controls, assuming a real deployment.
- **Likelihood and impact:** High / Medium / Low.

## Summary
| # | Threat | Severity (residual) | Main remaining gap |
|---|---|---|---|
| T1 | Unauthorised access / account compromise | Medium | No edge rate limiting or bot protection; phishing of password + code |
| T2 | Cross-company data access | Low | Depends on correct role setup by the MD |
| T3 | Student-data exposure | Medium | Staff can screenshot/download what they may view; no watermarking |
| T4 | Staff privilege escalation | Low | The MD account itself is a single point of trust |
| T5 | Document upload / malware | **High** (until a scanner exists) | No real virus scanner configured |
| T6 | Manual virus clearance misuse | **High** (until a scanner exists) | A person can release a malicious file |
| T7 | 2-step login and recovery-code risks | Medium | Recovery codes can be stolen if stored badly; MD-assisted reset depends on identity checks |
| T8 | Payment manipulation | Low–Medium | Two finance staff could collude |
| T9 | Data exports and bulk downloads | Medium | Alerts are after the fact; alert emails need an email provider |
| T10 | Session theft | Low–Medium | Device malware or an unlocked shared computer |
| T11 | Database and file-storage security | Medium | Hosting not yet configured (encryption at rest, network rules, key custody) |
| T12 | Backup theft, corruption, restore failure | **High** (until hosting backups are set up) | No production/off-site backups exist yet; `pg_dump` path untested |
| T13 | Insider threat / admin misuse | Medium | MD and database owner can do most things; relies on audit review |

---

## T1. Unauthorised access and account compromise

- **Threats:** password guessing, credential stuffing, phishing, reused passwords, abandoned accounts of former staff.
- **Likelihood / impact:** Medium / High. A staff account reaches student personal data and documents.

**Existing controls:**
- **Passwords:**
  - **T:** strong hashing (Argon2id), minimum 12 characters with 3 character types
  - **T:** passwords never visible to administrators; invitations replace shared or default passwords
- **Brute force:**
  - **T:** 5 failed sign-ins per email in 15 minutes block that email on **unrecognised browsers**, even with forged forwarding headers (`client-ip-lockout.test.ts`, `auth-rate-limits.test.ts`)
  - **T (N-1, migration 0035):** a browser in which the person completed 2-step login (or a password reset) is **trusted** for 90 days and has its own limit (10 failures). Someone who only knows an email address therefore cannot lock the employee out of their usual browser. Only a SHA-256 hash of the browser cookie is stored. Trust ends on password change, 2-step reset or removal, suspension or termination, and **Sign out everywhere**. It never skips 2-step login (`auth-rate-limits.test.ts`, browser test `n1-lockout.spec.ts`)
  - **T (N-1):** a password-reset request no longer counts as a failed sign-in. Completing a reset clears the lockout and trusts that browser
  - **T (N-1):** reset requests are limited: 3 per hour per email (at most 1 every 2 minutes), 10 per hour per address, and 100 reset emails per hour for the whole system (high alert). The answer and the timing are the same whether or not the account exists
  - **T (N-1):** parallel guessing is serialised: 20 simultaneous wrong passwords count as 5, and refused attempts do not extend the block
  - **T (N-1):** many failed sign-ins across 20+ accounts in 15 minutes raise a **high** alert
  - **T:** 30 failures per **address** in 15 minutes, applied only when the address comes from the trusted proxy (`TRUST_PROXY`). With an unknown address the per-address limit is skipped, and no shared bucket can lock everyone out.
  - **T:** the error message is generic (browser test)
  - **T:** repeated failures raise a security alert to the MD
  - **T:** 5 wrong 2-step codes cancel a sign-in
- **Two-step login:**
  - **T:** required for every user, and production builds cannot switch it off
  - **T:** a password-only session cannot open any page
- **Account lifecycle:**
  - **T:** suspension and termination end all sessions at once and block sign-in
  - **T:** invitations are single-use and expire (7 days by default)
- **T:** Login history is visible to the person, their administrators and the MD.

**Remaining gaps:**
- **New-browser limitation (N-1 trade-off):** while someone is guessing an employee's password, the employee cannot sign in from a browser they have **never used before** (for example a new laptop) until the 15 minutes pass. The way in is **Forgot your password?** or an administrator-issued reset link; completing the reset restores access in that browser.
- **Reset emails depend on the email provider:** without one, reset requests are recorded but skipped, and an administrator must issue the link.
- **Per-address protection depends on configuration:** set `TRUST_PROXY` correctly behind the VPS proxy (DEPLOYMENT.md §3a). This is not yet verified on a real proxy (no VPS exists).
- **P:** edge rate limiting or bot protection at the host (WAF).
- **P:** alert emails (need an email provider).
- **I/P:** no detection of unusual sign-in location or device.
- A real-time phishing site could relay a password and a 6-digit code. Passkeys or hardware keys would prevent this (not built).

**Recommended mitigation:**
- enable the host's firewall and bot protection
- configure the email provider so alerts reach the MD
- train staff on phishing and on checking the address bar
- consider passkeys after the pilot
- review login history weekly during the pilot

## T2. Cross-company data access (Edulinks ↔ GRADUATER)

- **Threats:** a staff member of one company opens, edits or exports the other company's students, documents or payments, for example by changing an ID in the address bar or a request.
- **Likelihood / impact:** Medium / High (commercial and privacy impact).

**Existing controls:**
- **Database rules:**
  - **T:** row-level security on every table; the app connects with a low-privilege role that cannot bypass it
  - **T:** a generic sweep of every table holding student data showed zero rows of the other company's student for six Edulinks-only accounts (Phase C)
- **Service reads and writes:**
  - **T:** cross-company reads return nothing, and 10 kinds of write are refused for authorisation reasons
  - **T:** guessed URLs return "not found" (browser test)
- **T:** A role in one company gives no rights in the other.

**Remaining gaps:**
- The **CEO and System Administrator default roles exist in both companies.** This is by design: the CEO reads student records of both (never amounts), and the System Administrator reads the audit log of both (contact/passport details redacted). If this is not intended, the MD must change it.
- **I:** isolation depends on the MD assigning roles correctly. A wrong role assignment is not a software flaw, but it has the same effect.

**Recommended mitigation:**
- MD reviews company memberships monthly (Staff list, filter by company)
- keep the "role/company access changed" alerts on and review them

## T3. Student-data exposure

- **Threats:** personal data, passports, certificates and family details seen by the wrong staff, students or outsiders; leaks through the portal, links, logs or error messages.
- **Likelihood / impact:** Medium / High (DPDP Act exposure, reputational harm).

**Existing controls:**
- **Staff access:**
  - **T:** documentation staff only see students assigned to them
  - **T:** the System Administrator gets no student records
  - **T:** the CEO sees no amounts
- **Sensitive fields:**
  - **T:** passport and contact details need separate permissions and are masked in lists and exports
  - **T:** these details are redacted in the audit log
- **Student portal:**
  - **T:** a portal session only reaches its own student; forged tokens reach nothing
  - **T:** sign-in codes are single-use, expire and are rate-limited
- **Files:**
  - **T:** files sit in private storage under random names and open only through a 60-second link after a permission check; storage locations are unreadable to the app
  - **T:** every file download is audited
- **I:** error messages are generic, and request bodies, passwords and document contents are not logged.

**Finding N-7 (High, found 1 Nov 2026; fixed in development by migration 0036, not yet committed or deployed):**
- **Exposure before the fix:** while a student-portal **set-up or password-reset** message was queued or sending, and in test mode, staff with `notifications.view` (MD and Manager roles) could read its one-time link in the notification outbox. A staff member could open the link and set the student's portal password. Staff with only contact-details access were already excluded from these two message types (migration 0025). The first description of N-7 wrongly included them.
- **Fix:** the links go only through an encrypted portal email queue that no staff member and not the application role can read. They are wiped when sent, failed, skipped, recorded in test mode, expired or revoked. The outbox policy hides the two message types from every role, and existing exposed links were invalidated by the migration (none existed in development).
- **Tests:** `portal-link-queue.test.ts`, `portal-link-db-security.test.ts`.
- **Still open (adjacent, not part of N-7):** in **test mode**, portal **sign-in codes** and **email-verification links** stay readable to `notifications.view` holders, because they are masked only once sent, failed or skipped. This awaits an owner decision.

**Remaining gaps:**
- Anyone allowed to view a document can screenshot or save it. There is no watermarking.
- **P:** retention periods and a deletion procedure are not yet decided by the business.

**Recommended mitigation:**
- least-privilege roles
- monthly review of download activity
- decide retention periods
- legal review of privacy notices (DPDP Act 2023)

## T4. Staff privilege escalation

- **Threats:** a staff member gives themselves or a friend more rights; an administrator creates a second MD; manipulated requests skip permission checks.
- **Likelihood / impact:** Low / High.

**Existing controls:**
- **Role assignment rules:**
  - **T:** people can only grant permissions they hold themselves, and can never change their own role or membership
  - **T:** privileged roles need extra permission
- **The MD role:**
  - **T:** cannot be granted or changed in the app
  - **T:** a second MD is refused by the database unless the database administrator deliberately uses an override, which raises a critical alert
- **Reinstatement and 2-step reset:**
  - **T:** only someone allowed to create administrators (MD by default) can reinstate a terminated employee
  - **T:** a System Administrator cannot reset anyone's 2-step login
- **T:** every permission or role change raises an alert.

**Remaining gaps:**
- The MD account is all-powerful by design. Its compromise is covered in T13 and the incident plan.

**Recommended mitigation:**
- protect the MD account with 2-step login on a dedicated phone
- keep recovery codes offline
- consider a second, sealed MD "break-glass" account (owner decision)

## T5. Document upload and malware

- **Threats:** infected PDFs or images uploaded by students, parents or compromised staff accounts, then opened by staff; disguised files (an executable renamed `.pdf`).
- **Likelihood / impact:** Medium / High (staff computers infected, ransomware).

**Existing controls:**
- **File checks:**
  - **T:** the file type is detected from its content; only PDF, JPEG, PNG and WebP are accepted, up to 10 MB (photos 5 MB)
  - **T:** files are stored under random names and never executed
  - **I:** files are served with headers that stop the browser running them
- **Scanner integration:**
  - **T:** ClamAV scanning is built and tested against a simulated scanner speaking the real ClamAV protocol
  - **T:** an infected file is quarantined: it can never be opened, downloaded, merged, published, approved, cleared or sent by courier, and a critical alert is raised
    - **Correction:** before the audit remediation, the in-app viewer route did not enforce this (H-1). It now does, and is tested by `audit-remediation.test.ts`, including a direct request to the route.
- **Gates:**
  - **T:** unscanned files cannot be approved or released for courier without manual clearance
  - **T:** photos and attestation evidence that the scanner flags are refused outright
- **Photos:** always re-encoded.

**Remaining gaps:**
- **P:** **no real scanner is configured.** Every file is "Not virus-scanned" until one exists.
- Files are viewed by staff on their own computers, so endpoint antivirus on staff devices is outside this system.

**Recommended mitigation:**
- configure a scanner before real documents are uploaded: a small ClamAV server, or a commercial scanning service
- require up-to-date antivirus and operating systems on staff devices
- open documents only in the built-in viewer, not in desktop programs

## T6. Manual virus-clearance risks

- **Threats:** while no scanner exists, an authorised person "clears" a malicious file; clearance becomes a rubber stamp; someone clears their own upload.
- **Likelihood / impact:** Medium / High.

**Existing controls:**
- **Who can clear:**
  - **T:** only the `documents.security_clear` permission (MD by default)
  - **T:** never by the uploader, and never for an infected file
- **How it is recorded:**
  - **T:** a reason is required (10+ characters)
  - **T:** each clearance is audited, labelled "MANUAL clearance – not an automated virus scan" everywhere, and raises an alert
- **T:** When a scanner is configured, manually cleared files are re-scanned by the daily job; if infected they become quarantined.

**Remaining gaps:**
- A person cannot reliably detect malware by looking.

**Recommended mitigation:**
- treat manual clearance as a temporary measure with a written MD acceptance
- keep the number of people holding the permission to one or two
- review the manual-clearance alerts weekly
- configure a scanner as early as possible

## T7. Two-step login and recovery-code risks

- **Threats:** stolen or lost phone; recovery codes saved in email or photos; social engineering of the person who resets 2-step login; code replay.
- **Likelihood / impact:** Medium / High.

**Existing controls:**
- **Codes:**
  - **T:** codes cannot be replayed, and old codes are refused
  - **T:** 5 wrong codes cancel the sign-in
- **Recovery codes:**
  - **T:** 10 codes, each working once, stored only as hashes
  - **I:** authenticator secrets are encrypted with a key held outside the database
- **Reset:**
  - **T:** only with `users.mfa_reset` (MD by default) and a written note of how identity was verified
  - **T:** a reset ends all sessions and raises a high alert; there is no ordinary administrator bypass

**Remaining gaps:**
- Staff cannot regenerate their own recovery codes; when they run out, an MD reset is needed.
- The quality of identity checks before a reset is a human process.

**Recommended mitigation:**
- identity check procedure: video call with ID, or in person (see the operations guide)
- staff keep recovery codes on paper in a locked place, or in a password manager

## T8. Payment manipulation and unauthorised financial actions

- **Threats:** fake receipts, altered amounts, deleting entries, self-approval, exchange-rate manipulation, the CEO or other staff seeing amounts they should not.
- **Likelihood / impact:** Low / High.

**Existing controls:**
- **Entries:**
  - **T:** entries cannot be edited or deleted; corrections are reversals that keep history
  - **T:** a receipt counts only after verification by a **different** finance person
- **Visibility:**
  - **T:** only finance roles record entries
  - **T:** the CEO sees counts, never amounts, even in the database
- **Currency:**
  - **T:** each entry stores its currency and applied rate, and the INR equivalent is calculated by the database
  - **T:** rate corrections need a reason and keep history
- **T:** All finance actions are audited.
- **No gateway:** no card data is stored, and there is no payment gateway, so card-payment and PCI risks do not apply today.

**Remaining gaps:**
- Two finance staff acting together can record and verify a false receipt.
- **P:** no reconciliation against bank statements in the system.

**Recommended mitigation:**
- monthly reconciliation of verified receipts against bank statements by the MD or an accountant outside the finance team
- review reversals and rate corrections

## T9. Data exports and bulk downloads

- **Threats:** a staff member exports student lists or downloads many documents before leaving or for a competitor.
- **Likelihood / impact:** Medium / High.

**Existing controls:**
- **Permissions:**
  - **T:** exports need the right permission, with separate permissions for contact details and for finance reports
  - **T:** exports use the same access rules as the screens
- **Audit:**
  - **T:** every export and every refused export is audited
  - **T:** exported spreadsheet cells cannot run formulas
- **Alerts:**
  - **T:** 500+ rows → high alert
  - **T:** 10+ exports in an hour → warning
  - **T:** 100+ document **views or downloads** in an hour by one person → high alert (views added in the audit remediation, M-2)
  - **T:** 100+ downloads in an hour through one student portal account → high alert (audit remediation, M-2)
  - **T:** refused export → warning

**Remaining gaps:**
- Alerts are raised after the fact and cannot stop a single large export.
- **P:** alert emails need an email provider.
- Screenshots: see T3.

**Recommended mitigation:**
- keep export permissions with managers and the MD only
- suspend accounts immediately when staff resign (task hand-over is built)
- review export alerts daily during the pilot

## T10. Session theft and unauthorised access

- **Threats:** stolen session cookie, shared or unlocked computer, cross-site scripting stealing sessions, clickjacking.
- **Likelihood / impact:** Low / High.

**Existing controls:**
- **Session tokens:**
  - **T:** random tokens, stored only as hashes
  - **T:** sessions expire after 12 hours, or 8 hours idle
- **Ending sessions:**
  - **T:** revoked, expired or suspended sessions stop immediately
  - **T:** "Sign out everywhere" is available for each person and for administrators
- **Cookies:**
  - **I:** cookies are HttpOnly and SameSite=Lax, plus Secure and the `__Host-` prefix in production
  - **I:** cross-site request protection through the framework's Origin check
- **Browser policy:**
  - **T:** strict script policy with a fresh nonce per page and no inline scripts; injected inline handlers are blocked (tested on the production build)
  - **T:** framing of the site is forbidden
- **I:** HSTS is sent in production.

**Remaining gaps:**
- Malware on a staff computer can act as the user.
- Inline *styles* are still allowed (needed for photo cropping); this cannot run scripts.

**Recommended mitigation:**
- screen lock on staff devices
- no shared accounts
- "Sign out everywhere" after using a shared computer

## T11. Database and file-storage security

- **Threats:** database credentials leaked, public bucket, direct database access, SQL injection, missing encryption at rest.
- **Likelihood / impact:** Low / High.

**Existing controls:**
- **Database access:**
  - **T:** the application role is low-privilege, row-level security is everywhere, and storage keys are unreadable to the app
  - **T:** the audit log is append-only, even for the database owner
- **Queries:** **I:** all SQL is parameterised and inputs are validated.
- **Secrets:**
  - **I:** the owner credential is used only by migration scripts and must never be set in the hosting runtime
  - **I:** no secrets in the repository (history scanned in the audit)
- **Storage:**
  - **I:** production refuses to use local file storage
  - **I:** S3-compatible private bucket, with signed 60-second links

**Remaining gaps:**
- **P:** hosting does not exist yet. Still to configure and verify there:
  - encryption at rest
  - network restrictions on the database
  - bucket privacy and versioning
  - credential custody by two named people
- **P:** no private Git repository with MFA and branch protection yet (the code exists only on this Mac).

**Recommended mitigation:**
- follow DEPLOYMENT.md and the pilot checklist
- verify bucket privacy and database network rules on staging before any real data
- move the code to a private repository with MFA

## T12. Backup theft, corruption and restoration failure

- **Threats:** no usable backup when needed; backups stolen (they contain all personal data); ransomware encrypting both data and backups; database and files out of step.
- **Likelihood / impact:** Medium / Very high.

**Existing controls:**
- **Restore drill:**
  - **T:** an online backup of the development database and its files restored into a separate server: 31/31 checks passed (all tables identical, 293 foreign keys intact, 395 files byte-identical)
  - **T:** the drill can be repeated: `scripts/backup-restore-drill.ts`
- **Procedure:** **I:** BACKUP_RECOVERY.md (encrypted weekly logical dumps, retention, quarterly restore tests).
- **In-app mistakes:**
  - **I:** students are archived or merged, never deleted (the application role has no delete right on students)
  - **T:** payments are reversed, not deleted
  - **T:** the audit log keeps before and after values

**Remaining gaps:**
- **P:** no production or staging backups exist (no hosting).
- **P:** hosting-provider backups not yet restore-tested.
- **P:** the `pg_dump`/`pg_restore` procedure is untested here, because the tools are not installed and downloading them needs owner permission.
- **P:** off-site encrypted copies not yet arranged.

**Recommended mitigation:**
- enable provider backups (with point-in-time recovery if affordable)
- weekly encrypted off-site dump held under separate credentials
- quarterly restore test on staging
- restrict who can delete backups

## T13. Insider threats and misuse of administrator privileges

- **Threats:** the MD account, the database owner, a System Administrator or a finance person misusing their access; covering tracks.
- **Likelihood / impact:** Low–Medium / Very high.

**Existing controls:**
- **Audit:**
  - **T:** the audit log is append-only even for the database owner (triggers block changes), and is preserved through backup and restore
  - **T:** security alerts cannot be edited or deleted by the app
- **Separation of duties:**
  - **T:** document approval by a different person from the verifier
  - **T:** payment verification by a different person from the recorder
  - **T:** manual clearance never by the uploader
- **T:** System Administrators get no student records by default.

**Remaining gaps:**
- The database owner (hosting administrator) can disable triggers. This is outside application control.
- The MD can grant any permission.

**Recommended mitigation:**
- hosting and database owner credentials held by two named people, with 2-step login on the hosting account
- periodic export of audit logs to separate storage
- MD reviews security alerts weekly
- independent annual review

## Residual-risk acceptance

Items rated **High** (T5, T6, T12) must be resolved, or formally accepted in writing by the MD, before real student documents are stored. See PILOT_READINESS_CHECKLIST.md.
