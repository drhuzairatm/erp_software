# ERP File Storage Architecture Audit

**Date:** 6 November 2026. **Handling: keep private, out of Git.** It describes where sensitive files sit and which protections are missing. It contains no credentials, private URLs or student data.

**Scope:** read-only review of branch `chat-enhancement`, and read-only counts from the local development database and storage. Production and the VPS were not accessed, so **their storage settings are unknown**. Companion report: `docs/DVR_DOCUMENT_UPLOAD_FAILURE_AUDIT.md`.

## 1. Summary

The ERP has **one storage layer** (`backend/src/lib/storage/index.ts`), with one private location, and **several record tables and upload services** on top of it. Files are stored as bytes under random keys. Database rows hold the ownership, permission and scan state.

**No virus scanner is configured in the development environment.** Files show as "Not virus-scanned". Passing a file-type check is not a virus scan.

## 2. Storage layer

| Item | Details |
|---|---|
| Drivers | `local` (`STORAGE_LOCAL_DIR`, default `.data/storage`) and `s3` (any S3-compatible private bucket) |
| Dev setting | `local`, `.data/storage`, folder mode `700`, files `600` |
| S3 bucket | One bucket, `S3_BUCKET`. **Empty in dev.** The S3 driver was not exercised in this audit |
| Production protection | The `local` driver refuses to start under `NODE_ENV=production` unless `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` |
| Limits | `MAX_UPLOAD_BYTES` 10 MB; `PHOTO_MAX_BYTES` 5 MB |
| Accepted types | PDF, JPEG, PNG and WebP, by first bytes (`sniffMime`), not by name |
| Signed links | 60 seconds. Local: HMAC via `/api/storage/local`. S3: presigned URL |

**There are no separate buckets per module.** Separation comes from key prefixes:

| Files | Key pattern |
|---|---|
| Student documents, student photos, attestation evidence | `org/<org>/students/<student>/<random>` (photos add a version suffix) |
| Secure files | `org/<org>/secure/<type>/<context>/<random>` |
| Staff photos | `staff/<user>/<random>-original`, `-display`, `-thumb` |

## 3. Categories

| Category | Upload form | Server action | Service | Table | Open route |
|---|---|---|---|---|---|
| **A. Student documents** (passport, academic, identity, bonafide, PCC, admission, visa, others) | `students/[id]/tab-forms.tsx` `UploadForm` | `actions/documents.ts` | `documents.ts` `uploadDocument` | `student_documents` (requirement) and `document_files` (versions) | `/api/files/:id`, `/api/files/:id/content` |
| Same, by the student | `portal/forms.tsx` | Portal actions | `portal.ts` | Same tables | Portal route |
| Attestation evidence | `attestation-forms.tsx` | Attestation actions | `attestation.ts` | `attestation_step_files` | `/api/attestation-files/...` |
| Merged documents | Document merge | Merge actions | `merge.ts` (`sharp`, `pdf-lib`) | `document_merges` | Through documents |
| **B. Student photos** | `components/photo-capture.tsx` | `actions/students.ts` | `photos.ts` | `student_photos` | `/api/students/:id/photo`, `/photo/download` |
| **C. Staff photos** | `photo-capture.tsx` | `actions/admin.ts` | `staff-photos.ts`, using `photos.ts` | `staff_photos` | `/api/staff/:id/photo` |
| **D. DVR documents** | `pre-admission/forms.tsx` | `actions/dvr.ts` | `dvr.ts`, then `secure-files.ts` | `dvr_documents`, `secure_files` (`context_type='dvr'`) | `/api/secure-files/:id` |
| **E. Chat attachments** | `chat/chat-room.tsx` | `actions/chat.ts` | `chat.ts`, then `secure-files.ts` | `secure_files` (`'chat'`) | `/api/secure-files/:id` |
| Tasks, employee files, meetings | `components/secure-file-forms.tsx` | `actions/secure-files.ts` | `secure-files.ts` | `secure_files` | `/api/secure-files/:id` |
| Attendance photos | `attendance/mark-form.tsx` | Attendance actions | `attendance.ts`, then `secure-files.ts` | `secure_files` (`'attendance'`) | `/api/secure-files/:id` |
| Ticket attachments | `tickets/forms.tsx`, `portal/tickets/forms.tsx` | Ticket actions | `tickets.ts`, partly `secure-files.ts` | `secure_files` (`'ticket'`) | `/api/secure-files/:id`, portal route |
| CSV imports | `students/import/import-wizard.tsx`, `leads/lead-forms.tsx` | Import actions | Read, **not stored as files** | None | None |

All uploads go through Next.js **server actions**. The Express API serves only reads. The `/api/...` routes above are Next.js routes proxied to it.

**File rules by category:**

| Category | Allowed | Max | Virus check order, when configured |
|---|---|---|---|
| Student documents | PDF, JPEG, PNG, WebP | 10 MB | **Stored first, then scanned.** Infected files stay stored, quarantined |
| Attestation evidence | PDF, JPEG, PNG, WebP | 10 MB | Scanned first, infected refused |
| Secure files, general | PDF, JPEG, PNG, WebP | 10 MB, 20 per record | Scanned first, infected refused |
| DVR | **PDF only** (database trigger), 10 files per upload | 10 MB in total in the browser | Scanned first, infected refused |
| Attendance | JPEG in the form | 10 MB | Scanned first, infected refused |
| Tickets | PDF, JPEG, PNG, WebP | 10 MB in total | Scanned first, infected refused |
| Photos | JPEG, PNG | 5 MB, min 200 × 200 px | Scanned first, infected refused |

**Photo processing (`photos.ts`):** the browser accepts a camera, native phone capture or a file (`photo-capture.tsx`). Large images are compressed to 5 MB there. The server decodes with `sharp`, applies the EXIF orientation and drops **all metadata** from each stored version. It saves an original, a passport-format or square display version, and a thumbnail. Staff avatars with no photo show initials (`Avatar`).

## 4. Upload flow, by step

| Step | How it works |
|---|---|
| 1–2. Form and file choice | Native file input. `accept` filter, and in DVR, photos and CSV imports a size check. **Most forms have no browser size check** |
| 3. Endpoint | Server action POST to the current page, through `proxy.ts` |
| 4. Authentication | `requireUser()` on each action |
| 4. Authorization | Database functions such as `app.can_on_student`, `app.secure_file_can_write`, `app.dvr_can_change_documents` |
| 5–6. Validation | Service checks size and real type. Database checks size, type and hash format on `secure_files` |
| 7–8. Storage | `getStorage().put()`, random key, written only if new |
| 9. Record | `app.register_document_file`, `app.register_secure_file`, `app.register_attestation_file`, photo functions. Each runs with permission checks and audit |
| 10. Ownership | `org_id` and context on each row; the key prefix is checked against the context on `secure_files` |
| 11. Isolation | RLS on all file tables, read-only for `erp_app`. Changes go through database functions |
| 12–13. Opening | Permission check and audit, then a 60-second signed link. Local-driver files are served with `sandbox` CSP, `nosniff` and `no-store` |
| 14. Errors | `runAction` turns service errors into on-screen messages. **Requests over the 10 MB proxy limit fail before this; see section 7** |

## 5. Security and reliability

**Tested in this audit (DVR files, local driver)**

| Control | Result |
|---|---|
| Storage is private, outside `/public` | Yes, by code and folder permissions |
| Permission before opening | Yes: other counsellor, other company and signed-out all got 404 |
| Signed link expiry | Yes: 403 after 61 seconds |
| Tampered signature | 403 |
| Path traversal in the key | 403 |
| Renamed EXE as PDF | Refused by file signature |
| Filename with `../` and symbols | Accepted and stored safely as a cleaned name |
| Company isolation | Yes for DVR files |
| Audit | `secure_file_uploaded`, and `file_download` success and denied, recorded |

**From code, not tested here:** S3 driver behaviour, student document and photo opening rules (existing test suites cover these on the local driver), and scanner behaviour.

**Gaps**

| # | Gap | Effect |
|---|---|---|
| 1 | **No real virus scanner in dev. Production is unknown.** Earlier decisions require one before real student documents | Files are not scanned. The UI says so honestly. Without a scanner, unscanned files **can be opened**. With one configured, unscanned secure files are held until scanned or cleared |
| 2 | A signed link works for anyone holding it for 60 seconds, signed out | Accepted design, short window |
| 3 | File type check reads only the first bytes | A malicious PDF with a valid header passes. It's a type check, not a safety check |
| 4 | Files open inline | Local driver uses a sandbox policy. S3 links set inline without one, depending on bucket settings |
| 5 | Student documents and secure files treat infected files differently (keep and quarantine, versus refuse) | Different behaviour to explain and maintain |
| 6 | A removed DVR draft document keeps its file record | From code: `app.dvr_remove_document` marks the document removed, not the file. It stays stored and readable by whoever can read the request |
| 7 | Refused DVR uploads leave a removed document row and a "Document removed" history entry | Clutter in the request's history |
| 8 | Removing a file from storage is best-effort (`.catch(() => {})`) | A storage failure could leave an unreferenced file |
| 9 | `npm run db:backup` uses `pg_dump`, which **doesn't include stored files** | Storage needs its own backup. Confirm this on the VPS |

**Local data check (counts only, read-only)**

| Item | Result |
|---|---|
| Student document files (`document_files`) | 378 rows, **0 missing** |
| Secure files, live | 13 rows, **0 missing** |
| Current staff photos | 20 rows, **0 missing** |
| Current student photos | 25 rows, **0 missing** |
| Replaced staff photos | 18 rows, files gone |
| Replaced student photos | 27 rows, files gone |
| Files on disk not referenced by any row | **489**, all student-document files dated 1 Nov |

Replaced photos have their files deleted on purpose by the service. The history row stays, but **old photo versions can't be recovered from storage**. The 489 unreferenced files look like leftovers from an earlier demo reseed on 1 November, but I didn't prove that. They need no action now, and they should not be deleted without a separate decision.

## 6. Duplicate implementations

The storage layer itself is shared, and that part works well. The repetition is one level above it:

| Logic | Repeated in |
|---|---|
| Size check, type check, store, register, remove on failure | `documents.ts`, `portal.ts`, `attestation.ts`, `tickets.ts` (student side), `secure-files.ts` |
| Scan order | `scanAndRecord` for documents and portal, `refuseIfInfected` for the rest |
| Size check in the browser | DVR, photos and CSV import only |

There is **no conflict between storage systems**, and no second bucket or provider. **I don't recommend a new architecture.** Nothing found shows the current one can't meet the requirements.

## 7. Existing limitations

1. **Upload limit mismatch (confirmed defect).** Page requests are buffered to 10 MB by the proxy, while the app allows 11 MB. Files of 10 MB or more on forms without a browser check get a 500 and an error page. Confirmed on DVR, DVR new version, student documents and chat. Details are in the DVR report.
2. DVR accepts PDF only, by design. Student documents accept images.
3. DVR's 10 MB limit is per upload batch; other multi-file forms vary.
4. Whole files are held in memory during upload, and buffered again in the proxy. With 10 MB limits this is moderate, but it was not load-tested.
5. Production storage driver, bucket, scanner, web server upload limit and file backups are **all unverified**.
6. Real Safari, Firefox and phone uploads were not tested in this audit.

## 8. Safe reuse opportunities (not applied)

1. **One config line** fixes limitation 1 for all server-action uploads.
2. **A small shared browser size check** based on the DVR form's, for `UploadForm`, `secure-file-forms`, chat, tickets and attestation.
3. **Later, a shared server helper** for "check, store, register, remove on failure", used by the five services above. This is refactoring only, so it should wait until the features are stable and be retested per module.
4. **New modules should keep using `uploadSecureFile`,** as DVR, chat, attendance and meetings already do. No new upload system is needed.
5. **Connect a real scanner.** The ClamAV and HTTP integrations already exist (`backend/src/lib/security/scanner.ts`) and need only infrastructure and configuration.

## 9. Are existing files at risk?

**No data loss or exposure was found locally, and this audit changed nothing in your database or storage.** All files for live records are present. The main risks are prospective: **no scanner**, and **unverified Production storage and file backups**. Only an inspection you authorize can settle those.

**Stopped here, awaiting your approval.**
