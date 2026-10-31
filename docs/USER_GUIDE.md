# User guide

## Everyone

- **Signing in**: use your work email and password. After 5 wrong attempts you must wait 15 minutes.
  Forgot your password? Use *Forgot password* or ask your system administrator for a reset link.
- **Company switcher** (top left): choose which company you are working in. If you belong to both,
  *All my companies* shows both together. You only ever see what your role allows in each company.
- **Alerts** (top right): your overdue tasks, tasks due soon, new assignments, documents to review,
  rejected documents and students whose next action is due. Click an item to open the filtered list.
- **Change password**: your name (top right) → *Change password*. Other sessions are signed out.
- **Two-factor login (2FA)**: your name → *2FA* → *Set up two-factor login*. Scan the QR code with an
  authenticator app (Google Authenticator, Microsoft Authenticator…), enter the 6-digit code, and **save the
  10 recovery codes** somewhere safe. From then on you enter a code after your password at every sign-in.
  Required for MD, CEO, administrators and finance staff. New phone? Ask an administrator to *Reset 2FA*.
- Records marked **DEMO** are fictional training data.

## Managing Director (master super admin)

- Full access to both companies and every module, including all financial amounts, settings and the
  audit log. Your role is locked: nobody — including you — can change it inside the app.
- **Staff → Add a staff member**: you can create anyone, including the CEO and administrators.
- **Roles & permissions**: decide exactly what the CEO and every other role may do (e.g. allow the CEO to
  create staff by granting *Create staff accounts* and the permissions of the roles they should hand out).
- Changes to MD accounts are made by your technical administrator with the setup tool (`npm run admin:create`).

## CEO

- Dashboard (consolidated or per company), staff workload, students, tasks, document and approval status,
  reports without contact or financial data.
- Payments appear only as **counts** (students with fees outstanding, awaiting verification); you do not
  see amounts, the ledger or financial reports.
- Creating staff or administrators, or changing roles, is possible only if the MD grants you those
  permissions — and you can never give anyone (including yourself) access you do not have.

## Managing Director – daily use

- **Dashboard**: choose *All my companies* for the consolidated view, or one company. Use the filters
  (registration dates, destination, course, stage, staff). Every card opens the matching records.
- Overdue work is split into **internal** delays and items **waiting on external parties** (student,
  university, embassy, provider…). Workload figures describe volume and timeliness; read them together with
  external delays and task complexity before drawing conclusions about individuals.
- **Reports** → open a report, filter, and *Export CSV*. Exports are recorded in the audit log.
- **Audit log**: filter by action (e.g. `file_access`, `export`, `login_failed`) and outcome (*denied*).
- You can merge duplicate records (needs merge permission in both companies involved).

## Company Manager

- **Alerts → Documents awaiting your approval**: open each, read the checklist and comments, then
  **Approve** or **Request changes** (reason). You cannot approve a document you verified or submitted
  yourself — another manager or the MD must.

- **Students**: register, edit, assign counsellor / documentation / visa / finance staff
  (*Overview → Assigned staff*), change stages, archive (with reason).
- **Duplicates**: when two records belong to the same person, open the record to keep and use
  *Merge duplicate* with the other Student ID and a reason. History is preserved.
- **Tasks**: create and assign tasks; reassign or change due dates (recorded in task history).
  Use the *Overdue*, *Unassigned* and *Waiting on external* views daily.
- **Documents**: open files, review, record where originals are.

### Importing many students from a spreadsheet (managers)
1. **Students → Import CSV**. Click *Download template* if you are starting fresh, or use an export from
   your spreadsheet / Leadist CRM (common column names such as *Name*, *Mobile*, *Source* are recognised).
   A Leadist CRM export (*Name, Phone, Email, Assigned To, Purpose, Address*) works as-is: *Assigned To*
   may contain the counsellor's full name or work email, *Purpose* is saved in the student's internal
   note, and *Address* is ignored because addresses are not collected.
2. Choose the company, choose the file (Excel: *Save as → CSV UTF-8*; format the phone column as Text),
   then **Check file**. Nothing is saved yet.
3. Review the preview: **Ready**, **Possible duplicate** (same phone/email in the file or already in the
   system) and **Error** (with the reason, e.g. unknown country or invalid date). Click a count to filter.
4. Click **Import**. Ready rows are saved together (all or nothing); errors are skipped — fix them and
   import those rows in a new file. Tick *Also import possible duplicates* only after checking they are
   different people. Each imported student gets a Student ID, document checklist and timeline entry, and
   the import is recorded in the audit log.

### Universities (everyone can view; administrators/MD configure)
- **Universities** in the menu lists every university with its courses, next deadline and number of active
  students. Open one to see courses offered with admission requirements, intakes and deadlines, campuses, and
  the documents that university requires.
- With *Manage universities* permission you can add universities, campuses, courses (duration, medium,
  eligibility), intakes with application deadlines, and **required documents** (for all courses or one course).
  Students assigned to that university get those documents on their checklist automatically — including
  students already assigned when you add a new rule. Removing a rule affects only future checklists.

### Messages to students and parents
- When registering a student, tick **Agreed to receive updates by** only for what the student/parent
  actually agreed to (email, WhatsApp, SMS). No consent = no messages.
- A student's **Messages** tab shows consent (and its history) and every message prepared for them, with its
  status: *Test – not sent*, *Queued*, *Sent*, *Failed* (with the reason), *Skipped* (e.g. no consent).
  Record a new consent or a withdrawal ("replied STOP") there.
- Managers/MD: **Messages** in the menu lists all messages; **Notification settings** (MD/administrator)
  controls which events send messages on which channel, and the wording.

### Student portal (what students see)
- Students go to **/portal** (e.g. `https://staff.yourcompany.com/portal`), enter the email or mobile number
  you registered, and receive a 6-digit code by email or WhatsApp (valid 10 minutes).
- They see: Student ID, programme, counsellor, current stage with a progress list, the next step and its date,
  and each document as *Please upload*, *Received – being checked*, *Please upload a corrected copy*
  (with the reason), *Approved* or *Expired*. They can upload requested documents; uploads appear to staff as
  *Student (portal)* and go through the normal verification and manager approval.
- They never see internal notes, staff comments, payments, or anything about other students.
- **Reasons you type when requesting changes or rejecting a document are shown to the student** — write
  them for the student. Keep the **Next action** text student-friendly too.
- Support phone/email shown in the portal are set per company under Company settings.

## Sales / Counsellor

1. **Students → Register student**. Fill company, lead source, name, phone and/or email, destination,
   course, university (and campus), and the **previous education country** — where the student studied, which
   is separate from the destination. Passport number/expiry go in the Passport section (visible only to roles
   with passport permission). Only collect what is needed; date of birth only if required.
2. If you see **Possible duplicate records**: open the match if you can; if it belongs to the other brand
   you will only see the company name — ask your manager. Tick *register anyway* only if it is a
   different person.
3. On the profile: log **follow-ups** (calls, WhatsApp, visits) with the next follow-up date, add notes,
   and move students through *Lead → Registration*, or *On Hold / Cancelled* (reason required).
4. Upload documents the student gives you (*Documents* tab). You cannot open files or approve them.
5. Keep the **Next action** and its due date up to date — it drives alerts and dashboards.

## Documentation Staff

- You see students **assigned** to you (including GRADUATER students processed by Edulinks).
- *Documents* tab → **Open review** opens the document inside the portal: pages, zoom, and on the right
  the **verification checklist** for that student (e.g. the exact Bonafide wording for their
  previous-education country).
- "Found on page 2" (green highlight) shows where the wording appears in a PDF's text. It is only a hint —
  read the document. Scans have no text, so check them visually.
- For each check click **✓ Present** or **✗ Missing** (with a comment). Select text in the document to
  highlight it and add a comment for the manager.
- When every mandatory check is present: **Mark verified** → **Submit for manager approval**. Or
  **Request changes** / **Reject** with a reason. A new upload restarts the checks.
- Your ticks are permanent records (who, when, which file version, which rule version).
- *History, location of original and details*: record where the physical original is (with the student,
  staff, provider, embassy, university, returned) and tracking numbers; set expiry dates.
- Move students through document, attestation/apostille, translation and university application stages.
  If required documents are not approved the system warns you; continue only if justified.
- Use tasks with *Waiting on external party* + the right party when you are blocked by others.

## Visa Coordinator

- On assigned students: *Overview → Admission & visa* — record appointment date, outcome and reference.
- Move students to *Visa Processing*, *Travel Preparation*, *Travel Completed*. Warnings appear if the
  admission letter or visa approval is not recorded, or a service-fee balance is outstanding.

## Finance Staff

- Student → *Payments* tab → **Record an entry**: *Charge* (amount due), *Receipt* (money received,
  method + reference), *Waiver*, *Refund*, *Disbursement* (money paid to a university/provider — third-party
  categories only).
- Receipts, waivers, refunds, disbursements and reversals count **only after verification by another
  finance colleague** (*Payment ledger* → filter *Awaiting verification* → *Verify* / *Reject…* with note).
- Mistakes are never edited: use **Reverse** with a reason; the reversal also needs verification.
- Service fees and third-party money (e.g. university tuition collected) are shown separately.
- This is a basic ledger: no tax, invoices or statutory accounting.

## Verification rules (MD / authorised staff)

- **Verification rules** → *New rule*: choose the document type and who it applies to (previous-education
  country, destination, university, course), then add checks: exact phrase, statement, keywords, or manual
  check. It stays a **draft** until the MD clicks **Approve rule**. To change an approved rule, *Create new
  version*, edit, approve — the old one is retired but past checks keep their version.
- Rules named [PLACEHOLDER] are demo examples: replace them with your approved wording.

## System Administrator

- **Staff**: *Add a staff member* (company + role). Without email configured you get a one-time setup
  link (24 h) to give the person privately. *Issue reset link* for forgotten passwords (requests appear
  as a badge). **Deactivate** leavers immediately — all their sessions end.
- **Roles & permissions**: adjust what each role can do per company. You cannot edit your own role.
  Sensitive permissions are marked.
- **Company settings**: company name, ledger currency, self-verification rule, fee categories,
  lead sources, legal entities, countries, courses, universities, and workflows (applicable stages and
  required documents per country/course).
- By default administrators do **not** see student records. If you also do operational work, ask for
  an additional role.
- You can only assign roles whose permissions you hold yourself, so in practice the MD (or someone the MD
  has authorised) assigns operational roles. *Departments* are managed under Company settings.
