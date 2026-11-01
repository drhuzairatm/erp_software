# Student document merge and combined PDF download: final report

## 1. Audit summary
See `DOCUMENT_MERGE_PHASE_1_AUDIT.md`.
- **Already in place:** versioned uploads from staff and the student portal (there is no separate parent portal; parents use the student portal), verification statuses, per-file authorised and audited downloads, and the student's name, passport number and preferred university.
- **Missing:** any way to combine files, plus ordering, filename rules, history and a PDF writer.

## 2. Reused
- `student_documents` / `document_files` (no copies of source records)
- `app.authorize_file_download`: each source file is authorised **and audited**, exactly like a normal download
- the verification statuses, student and passport data, universities, `app.audit`, the student timeline, and RLS company/assignment rules

## 3. New
- **UI:** Student profile → **Documents** tab → **Merge & Download PDF** card.
  - Lists every current uploaded file with type, status, format, original filename, version, upload date, uploader (staff name, or "Student (portal)") and size.
  - Select all / Deselect all / Clear selection, plus per-document ticks.
  - **Order in the PDF:** drag and drop, or ↑ ↓.
  - University for this submission (the student's university is pre-selected; others in the destination country can be chosen, or "No university").
  - Purpose: University admission, Visa application, Embassy submission or General document package.
  - **File name shown before download.**
  - **1. Check documents:** pages per document, warnings for unapproved documents, and errors for damaged or encrypted files.
  - **Preview PDF** (opens in a new tab) and **2. Download Combined PDF**.
  - **Generated submission PDFs** history with "Use again".
- **Server:**
  - `src/server/services/merge.ts`
  - shared filename rules in `src/lib/merge-filename.ts`
  - route `POST /api/students/[id]/merge` (same-origin only)
  - check action `src/app/actions/merge.ts`
- **Database:** migration `0029_document_merges.sql` adds history (`document_merges`, permanent) and `app.record_document_merge` (permission check, audit, timeline). Rollback is in `db/rollbacks/`.

## 4. Formats
- **PDF:** all pages, in their own order.
- **JPG/JPEG, PNG and WebP** (WebP is accepted by uploads, so it is supported):
  - each image becomes an A4 page in portrait or landscape to match the image
  - centred, aspect ratio kept, not enlarged more than 1.5×
  - camera orientation applied, transparency on white
- DOC/DOCX are not accepted by the upload system, so they are not offered.
- **Damaged, encrypted, password-protected or unsupported files** are reported per document, and then **no PDF is produced at all**. Nothing is ever silently left out, and the failure is recorded.

## 5. Processing
`pdf-lib` (added: a pure-JavaScript PDF writer with no native parts; nothing suitable was installed) copies PDF pages. `sharp` (already present) prepares images. Everything happens in memory on the server; **source files are only read.**

## 6. Filename
`{Student Name} - {Passport Number} - {University Name}.pdf`. Example: `Mohammed Huzair - A1234567 - Tbilisi State University.pdf`.
- **Data used:**
  - student name: the official name on the record
  - passport number: the current verified passport, and **only if the user may see passports**; otherwise it is left out, with a note
  - university: the one chosen for the submission
- **Fallbacks:**
  - `Name - Passport.pdf`
  - `Name - University.pdf`
  - `Name.pdf`
  - `StudentID.pdf` if no name
- **Sanitising:**
  - removes `\ / : * ? " < > |` and control characters, and collapses spaces
  - turns a " - " inside a name into "–" so separators stay unambiguous
  - removes spaces inside the passport number and limits the length
  - never changes stored data
- **Delivery:** the download header carries an ASCII name plus the UTF-8 name, so it works on desktop, Android and iPhone. The name appears only in the download header and the history, **never in a URL or a storage path**.

## 7. Verification rules
Statuses are shown. Including documents that are **not approved** needs an explicit tick confirming that their status doesn't change. Merging never changes any status or file.

## 8. Retention
**Combined PDFs are not stored** (no duplicate copies of passports or certificates). The history keeps:
- filename, exact source file versions in order, university, purpose
- pages, whether unapproved documents were included, preview or download, outcome
- who and when

"Use again" rebuilds the same selection.

## 9. Security
- Requires `documents.download` on the student, with company and assignment rules from the database.
- Every source file is authorised and audited.
- Same-origin POST only.
- Limits: 40 documents, 60 MB of source files, 500 pages; duplicates in the selection are refused.
- Images are decoded with pixel limits.
- Other companies' staff and roles without download permission can't see the card or call the route.

## 10. Audit
Every merge records `documents_merged` (success or failure, with filename, files, university, purpose, pages and mode) and a timeline event. Per-file `file_download` audit entries are kept, as before.

## 11. Tests run (actual results)
- **`tests/integration/document-merge.test.ts`, 5 tests, all passed:**
  - two PDFs (2 + 1 pages), a landscape JPG and a portrait PNG merged in a custom order: 5 pages, order and orientation checked
  - filename with university, passport and the exact data
  - all fallbacks (university missing, passport missing, both missing, no name) and sanitising of invalid characters and dashes; `.pdf` extension
  - a damaged PDF stops the merge, with the reason shown; no PDF produced; failure recorded
  - unapproved documents need confirmation; source file hashes and statuses unchanged
  - history and audit recorded
  - counsellor (no download permission) and another company refused; duplicate and empty selections refused
- **`tests/e2e/document-merge.spec.ts`, passed:** tick two documents, move one up (order checked), the filename shown equals the expected one, Check, Download. The browser receives `Name - Passport - University.pdf` and the file starts with `%PDF-`.
- **Not automated:** downloads on real Android and iPhone devices (the standard attachment headers are used), and creating an encrypted test PDF (pdf-lib refuses encrypted files on load and the code reports them; no fixture was made).

## 12. Limitations
- Each student has one stored university (no multi-application model). Other universities in the destination country can be chosen per submission.
- There is no page-by-page thumbnail preview before generation. "Preview PDF" opens the actual combined file.
- Very large scans make large PDFs; images aren't compressed below their original quality (JPEG 90).

## 13. Deployment
Run `npx tsx scripts/migrate.ts` (applies 0029). `pdf-lib` is in `package.json`.
