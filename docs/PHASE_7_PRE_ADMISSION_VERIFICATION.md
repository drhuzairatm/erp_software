# Phase 7: Pre-Admission Document Verification

**Status:** built and tested locally. Nothing is committed, pushed or deployed. See "Test results" for what was actually run.

## Gap analysis

| Need | Before | Decision |
|---|---|---|
| Request before registration, with its own number | Missing. Leads and students exist, but both are other workflows | New separate request, `DVR-YYYY-000001` |
| Countries, universities, courses, intakes | Working master data | Reused. Free text is allowed when a university or programme is not listed |
| Roles | Working | Reused, with three new permissions |
| File storage, scan state, signed links, audit | Working `secure_files` | Reused with a new `dvr` context |
| Notifications | Working `staff_notify` | Reused. Text is generic: no prospect name |

## What it does

- **Counsellor:** captures the prospect, contact, destination, university, programme, intake, academic year, remarks and special instructions, then adds PDFs by category. Each file is its own document for review.
- **Documentation:** queue with filters, assign or reassign (a reason is required to take a request from another reviewer), start, record a result for each document, name a missing document, send back, record the overall assessment, return.
- **Document results:** Verified, Not Acceptable, Correction Required, Missing Document, Additional Clarification Required.
- **Overall results:** Possible, Possible with Conditions, Not Possible, Pending Further Review.
- **Versions:** a corrected upload adds a version and clears that document's current result, so it is reviewed again. Files on a request cannot be removed, and every review is kept against the version it looked at.
- **Later changes:** a change to country, university, programme, intake or academic year after review started is logged with old and new values and flags the request for re-verification. A finished request moves to Pending Further Review. The earlier result stays visible until re-verification completes.
- **Student link:** explicit and separate. It needs an existing student the user can read in the same company, and it changes nothing on the student. The student page shows the DVR reference.

**Nothing here creates a student, Student ID, portal account or admission application.** Pages state that results are a preliminary assessment and not a guarantee of admission or a visa.

## Permissions

| Permission | Roles | Allows |
|---|---|---|
| `dvr.create` | MD, CEO, Manager, Counsellor | Raise requests and follow one's own |
| `dvr.review` | MD, CEO, Documentation | See submitted requests in the company; review when assigned |
| `dvr.manage` | MD, CEO, Manager | See all requests in the company, act for the counsellor, assign reviewers |

System Admin has none of these. Other counsellors do not see a colleague's requests. A counsellor cannot review their own request. Students have no access: no portal function reads these tables.

## Database

Migration `0046_pre_admission_dvr.sql`, rollback `0046_pre_admission_dvr.down.sql` (tested). Six tables, all with RLS: `dvr_counters` (no access for the application role), `dvr_requests`, `dvr_documents`, `dvr_document_reviews`, `dvr_events`, `dvr_field_changes`. Reads through five policies; writes only through functions, each closed to PUBLIC. Audit entries record statuses only, never prospect details or notes.

0046 was written after 0047. It does not depend on 0047, and the runner applies any missing file, so the local development database applies it after 0047 while a fresh database applies it first. Rolling back 0046 on a database also rolls back 0047, as the runner undoes newest first.

## Limits and decisions still open

- **Numbering:** one sequence per company per year is a recommendation awaiting confirmation. Numbers can repeat across companies; they are unique within one.
- **"Submitted" status:** a submission passes immediately to "New Request". Both are recorded in the history, but no request rests in "Submitted".
- **Conversion:** there is no prefilled conversion. The counsellor registers the student separately, then links them by Student ID.
- **Upload size:** up to 10 PDFs and 10 MB per upload, because of the existing upload limit. Larger sets go in smaller groups.
- **Virus scanning:** no scanner is installed, so files show "Not virus-scanned".
- **Prospect contact details** are visible to everyone who can read the request, including Documentation. They are not covered by `students.contact.view`.
- **Email:** tested with notifications in test mode. No real email was sent.
- **Retention:** no retention period exists for these requests or files; it needs a decision.
- **Browser tests** ran in desktop and phone-sized emulation, not on real phones.
