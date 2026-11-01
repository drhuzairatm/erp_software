# Phase C: testing report (1 Nov 2026)

**Scope:** the MD-approved Phase C list.

**Environment:**
- this Mac only: local development database `erp_dev` and a temporary test database
- **fictional (synthetic) data only**
- **production:** none exists, so none was touched; nothing deployed or purchased

**Status:** Phase D and E not started.

## Summary
| | Passed | Failed | Skipped |
|---|---|---|---|
| Integration + unit tests (`npm run check`, incl. typecheck, lint, production build) | **260** | 0 | 0 |
| Browser (end-to-end) tests, Chrome | **54** | 0 | 0 |
| Backup → restore drill checks | **31** | 0 | 0 |

**New in Phase C:**
- `tests/integration/scenarios-a-l.test.ts`: 12 tests
- `tests/integration/security-matrix.test.ts`: 9 tests
- `scripts/backup-restore-drill.ts`
- the attestation browser test, previously skipped, now prepares its own data and runs

**Bugs and vulnerabilities:** no security vulnerability found. One documentation error found and fixed (below).

## 1. Admissions scenarios A–L
Each scenario is one fictional student taken through the real services and database rules (no shortcuts in the database).

| ID | Scenario | What was verified | Result |
|---|---|---|---|
| A | Plus Two → MBBS (Bulgaria) | Registration; checklist (passport, 10th, Plus Two, birth certificate); Plus Two marks meet the Bulgaria notice; acknowledgement; upload → verify → submit → manual clearance → manager approval; fee charge and receipt; self-verification refused; verified by a second finance person; balance 100 000 outstanding; stages Registration → University Application | PASS |
| B | Plus Two → Nursing (Germany) | Nursing – Germany workflow documents (language certificate, translations); school academic profile; stage progress | PASS |
| C | MBBS graduate → Postgraduate Medical | Postgraduate academic profile; MBBS, internship and medical registration records instead of Plus Two | PASS |
| D | Missing academic certificates | Registration not blocked; 10th and Plus Two listed as required and missing; academic notice says "missing" (advisory) | PASS |
| E | Name mismatch | Certificate name ≠ passport holder name → name check opened; counsellor cannot decide; documentation staff decide with a note | PASS |
| F | No passport | Registration allowed; the approved 12-month passport rule stops University Application; after a passport is recorded **and verified by a second person**, University Application is allowed | PASS |
| G | Expired passport | Registration allowed; passport flagged; passport follow-up tasks created; University Application blocked | PASS |
| H | Bulgaria applicant below requirement | "BULGARIA – IMPORTANT ACADEMIC REQUIREMENTS" shows *below*; acknowledgement; academic-verification task; progression **not** blocked | PASS |
| I | Egypt applicant | **No Egypt requirement is invented** (none supplied by the MD). A clearly labelled test-only Egypt notice works as advisory with acknowledgement and never blocks; removed after the test | PASS (mechanism) |
| J | One and Same | Mandatory rule → required checklist item → template preview → request → document verified, cleared, approved → case approved | PASS |
| K | Document corrections | Return with comment (comment required) → new version → review starts again (status reset, new file not cleared) → approval refused until re-verified and cleared → approved; history shows "changes required" and "approved" | PASS |
| L | Attestation / apostille | Attestation refused before approval; approved India-issued document for Bulgaria is offered the matching route; every stage completed with references; attestation completed | PASS |

**Business content still needed from the MD** (the system correctly shows nothing invented):
- real Egypt academic requirements
- final wording of attestation routes marked "[TO CONFIRM]"
- One and Same rules

## 2. Security and isolation
| Area | Test | Result |
|---|---|---|
| Company isolation: database | For **every** table with a `student_id` column (generic sweep), and for 6 Edulinks-only accounts (2 counsellors, manager, documentation, 2 finance): **zero rows** of a GRADUATER-only student | PASS |
| Company isolation: service reads | Student, checklist, document review, file download, academic, passport, advisories, attestation, task, ledger and timeline of the other company: nothing returned, for all 6 accounts | PASS |
| Company isolation: service writes | Update student, change stage, upload, document action, academic record, passport, payment, task, note, manual clearance: **all refused by the access rules** (the test proves refusals come from authorisation, not from input validation); the record was unchanged afterwards | PASS |
| Dual-company roles | CEO sees the GRADUATER student but **no amounts** (no ledger entries or balances, even in the database); System Administrator gets no student records; MD sees both | PASS |
| Student isolation | Documentation staff cannot read or upload for an unassigned student until assigned; a student-portal session reaches only that student (overview, uploads, downloads); a forged portal token reaches nothing | PASS |
| Role permissions | Approve: refused for counsellor, documentation, finance, CEO. Record payments: refused for counsellor, documentation, CEO. CEO sees no amounts even after a real charge exists. Staff administration and security alerts refused for counsellor, documentation, finance. | PASS |
| Sessions | Revoked, expired and idle (> 8 h) sessions refused; a session waiting for its 2-step code is not signed in; tokens stored only as hashes | PASS |
| Two-step login | Authenticator code cannot be replayed or used when too old; recovery codes work exactly once | PASS |
| Existing isolation suites (re-run) | `db-isolation`, `services`, browser `isolation.spec` (guessed URLs give 404) | PASS |
| Documents, scanning, clearance, quarantine, approval, courier (Phase B suite, re-run) | 8 integration + 4 browser tests, plus courier tests | PASS |
| Staff invitation, suspension, termination, task reassignment, MD protection (Phase A suite, re-run) | 10 integration + 1 browser test | PASS |
| Payments, applications, portal and all earlier modules (regression) | All earlier suites | PASS |

## 3. Backup → restore (isolated environment)
Full evidence: **docs/BACKUP_RESTORE_DRILL.md**. Repeatable with `npx tsx scripts/backup-restore-drill.ts`, which refuses to run against anything but a local database.

**Method:**
- online physical backup of the running development database with PostgreSQL's low-level backup API, plus a copy of all stored files
- restored into a **separate PostgreSQL server** (own folder, own port)
- one change was made to the source after the backup, to prove the restore point
- the copy was deleted afterwards

**Result: PASSED, 31/31 checks:**
- all **102 tables** identical (row counts and content hashes), including:
  - students (261)
  - student documents (2 555)
  - document files (338)
  - payment entries (183)
  - staff assignments (343)
  - company memberships (38)
  - roles and permissions
  - tasks
  - audit log (10 281)
  - security alerts
  - courier shipments
  - credentials and two-step secrets
- payment balances identical
- **293 foreign keys, no orphaned rows**
- company relationships and staff assignments consistent
- security rules, policies, triggers, functions and the application role restored; RLS still hides data; storage keys still unreadable; audit log still append-only
- migration history (up to 0033) restored
- the post-backup change is absent (exact restore point)
- **395/395 live files present and byte-identical** (SHA-256 checked against the database)

**Timing:** the backup took about 1 s, and the restore with full verification about 1 s, for a 108 MB database plus 3.5 MB of files.

**Missing or corrupted data:** none. The 25 replaced photo versions have no files **by design** (STUDENT_PHOTOS.md: old photo files are deleted when replaced; the history record stays). The drill reports them separately so they can't mask a real loss.

**Not tested:**
- **`pg_dump`/`pg_restore`:** the logical-dump path that BACKUP_RECOVERY.md describes for off-site copies. These PostgreSQL tools are not installed on this Mac, and **downloading them was refused by this session's safety rules** (running a program fetched from the internet needs your explicit permission).
- **Production backups:** hosting-provider backups (e.g. Supabase daily/PITR) must be restore-tested on staging once hosting exists (Phase E).

## 4. Bugs and vulnerabilities found
| ID | Severity | Description | Fix | Verified |
|---|---|---|---|---|
| C-1 | Low (documentation) | PHOTO_CAPTURE_REPORT.md said previous photo versions are kept; by approved design their files are deleted on replacement | Report corrected; drill now reports replaced versions separately | Drill passes |

The test-side corrections below were not app defects and changed no security control:
- **Expectations corrected to match the existing approved rules:**
  - a new passport counts only after verification
  - an academic notice needs a subject
  - a document type without checks has no unmet checks
- **Test data:** dual-company accounts (CEO, System Administrator) were wrongly listed as Edulinks-only in a first draft.
- **Ledger check:** it now inspects real amounts.

**Security vulnerabilities:** none found.

**By design, worth knowing:**
- The CEO and System Administrator are members of both companies:
  - **CEO:** reads student records in both, but never amounts.
  - **System Administrator:** reads the audit log of both, with contact and passport details redacted.
- Change either through Roles if that is not what you want.

## 5. Remaining external dependencies
1. **Hosting** for staging and production (database, file storage, HTTPS domain) is needed for:
   - a restore test of the provider's backups
   - real-device and other-browser tests
   - the pilot
2. **Virus scanner** (ClamAV server or scanning service). Until then, every upload needs manual clearance.
3. **Email provider:** for invitations, password emails and alert emails.
4. **PostgreSQL 17 client tools** (`pg_dump`/`pg_restore`), free and official: only if you want the logical-dump procedure tested on this Mac. This needs your permission to download them.
5. **Business content:** Egypt academic requirements, final attestation route wording, One and Same rules, courier office address.

## 6. Assessment
- **The application is ready for Phase D (security documentation).** Admissions scenarios A–L, company and student isolation, role permissions, document security, two-step login, staff accounts and regression all pass. The backup restores completely in an isolated environment.
- **It is not yet ready for a pilot with real staff.** That needs Phase E (staging hosting, real devices, the pilot plan), a virus scanner or an accepted manual-clearance process, email delivery, and the business content above.
