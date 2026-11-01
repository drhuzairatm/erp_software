# Student document merge and combined PDF download: Phase 1 audit

Audited on 1 Nov 2026 against the code and database (migrations 0004, 0014, 0016, 0018, 0025 and 0027).

## Existing document management
- **Checklist items:** `student_documents` (type, label, required, status, expiry, issuing country, custody). Versions are in **`document_files`** (private storage key, original filename, MIME, size, SHA-256, `uploaded_by`, `uploaded_via` = staff or portal).
- **Uploads come from:**
  - staff, on the Documents tab
  - students in the **student portal** (`portal_register_document_file`)
  - Parent/guardian portal: **does not exist**; parents use the student's portal sign-in
  - registration: no document upload at registration; the photo has its own feature
- **Formats accepted:** PDF, JPEG, PNG and WebP (signature-checked, 10 MB).
- **Verification:** uploaded → under review → verified (documentation, with the per-rule checklist) → pending approval → approved by a different manager. Changes required, rejected and expired are also possible. A new upload restarts the review.
- **Download and preview:**
  - an in-app viewer (`documents.file.view`)
  - download via a 60-second signed URL (`documents.download`)
  - every access is authorised and audited in the database (`app.authorize_file_access` / `app.authorize_file_download`)
- **Student data:**
  - name: `students.full_name`, which the form labels "as on passport"
  - passport number: `students.passport_number`, shown only to roles with `students.passport.view` (masked in `v_students` otherwise; the current verified passport since 0022)
  - university: **one preferred university per student** (`preferred_university_id`); there is **no separate multi-application model**
- **Permissions:** roles plus company and assignment rules, enforced by RLS.
- **Audit:** `app.audit` and the student timeline (`student_events`).
- **PDF processing:** `pdfjs-dist` (viewing in the browser only) and `sharp` (images). **No PDF writer.**

## Feature gap analysis
| Requirement | Status | Notes / action |
|---|---|---|
| Merge & Download PDF action on Student → Documents | Not implemented | Add a card on the Documents tab |
| List all uploaded documents (staff and portal) with metadata | Partial | The checklist shows them; the merge list will show type, filename, upload date, uploader (staff or "Student (portal)"), status and format |
| Parent-portal uploads | Not applicable | There is no parent portal; parents upload through the student portal, so those uploads are included |
| Select all / deselect / clear / per document | Not implemented | Build it |
| Ordering: drag-and-drop plus move up / down | Not implemented | Build it |
| PDF, JPG, JPEG, PNG input (WebP too, as it is accepted on upload) | Not implemented | `pdf-lib` (new, pure JavaScript): copy PDF pages; images placed on A4 at their aspect ratio, in portrait or landscape |
| DOC/DOCX | Not applicable | The upload system doesn't accept them |
| Corrupt, encrypted or unsupported files reported, never left out silently | Not implemented | Check step: if any file fails, **no PDF** is produced and the problems are listed |
| Preview (order, pages, warnings, filename) and an optional inline preview | Not implemented | "Check" step plus "Preview PDF" (opens in the browser) |
| Separate generated file; originals untouched | Not implemented | Generated in memory; source files are only read |
| Filename "Student Name - Passport Number - University Name.pdf" with fallbacks and sanitising | Not implemented | Built on the server from stored data; the passport part only if the user may see passports |
| University selection when there are several applications | Partial | One preferred university is stored; it is suggested and can be changed, or set to none |
| Submission purpose | Not implemented | University admission, Visa application, Embassy submission or General package |
| Verification rules respected | Partial | Statuses are shown. Including **unapproved** documents needs an explicit tick and a warning; statuses are never changed |
| Retention / history | Not implemented | **Generated files are not stored**, which avoids duplicate copies of passports. A history record is kept (filename, sources and versions, university, purpose, by, when) with "Generate again" |
| Security | Partial (reuse) | Every source file goes through `app.authorize_file_download` (permission plus audit); company and student rules apply; limits of 40 documents, 60 MB and 500 pages; the request's origin is checked |
| Audit | Not implemented | `document_merge` record plus an audit entry for success or failure; a timeline event |

## Integration point
**Student profile → Documents tab → "Merge & Download PDF"** card, placed above the courier and publication cards. It reuses the checklist data and the existing permissions.

## Risks
- Large scans could make PDFs heavy: images are re-encoded at their original resolution (not upscaled), and the totals are limited.
- Encrypted PDFs can't be merged; they are reported, never decrypted.
- The passport number in a filename is sensitive: it is only used in the download header for authorised users, never in URLs or stored paths.

## Implementation plan
1. **Migration 0029:** `document_merges` (history) plus `app.record_document_merge`.
2. **Server:**
   - `services/merge.ts`: candidates, filename builder, PDF builder with per-file checks
   - route `POST /api/students/[id]/merge`, which returns a download or an inline preview
3. **UI:** Documents tab card: selection, order, university, purpose, filename preview, Check, Preview and Download, plus history.
4. **Tests:** integration (merging, order, formats, filename rules, sanitising, errors, permissions, originals unchanged) and a browser test.
5. **Final report.**
