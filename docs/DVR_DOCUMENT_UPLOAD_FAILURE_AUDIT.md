# Pre-Admission (DVR) Document Upload: Failure Audit

**Date:** 6 November 2026. **Handling: keep private, out of Git.** It describes file-handling behaviour and security gaps. It contains no credentials, private URLs or student data.

**Scope:** read-only audit on branch `chat-enhancement` (`f68e97e` plus uncommitted work). Nothing was fixed. The VPS and Production were not accessed. Your development database was only read. Tests used a throwaway database and a disposable copy of the development database, with fictional PDFs.

## 1. Conclusion

**The upload is not generally broken, and the exact failure you saw has not been identified yet.** Ordinary PDF uploads worked in every test, including on a copy of your own draft request as its owner.

I found **one confirmed defect** and **several conditions that block an upload by design**. Your database shows that none of your attempts reached the step that saves a document, so one of the conditions in section 3 is the likely explanation. I can't say which without the details in section 7.

| Finding | Status |
|---|---|
| PDFs up to 9.99 MB, one or several | **Work** |
| PDF or batch of exactly 10 MB (Add documents form) | **Confirmed defect:** HTTP 500 and an error page |
| Single PDF of exactly 10 MB or over (New version form) | **Confirmed defect:** same failure |
| Batch over 10 MB (Add documents form) | Blocked by design: **button disabled**, red message |
| JPEG or PNG scan | Blocked by design: **PDF only**, normally can't be chosen in the file window |
| Category left blank | Blocked by design: message shown |
| Request already submitted | Blocked by design: **form hidden for everyone** |
| Documentation reviewer | Blocked by design: never has an upload form |

## 2. Confirmed defect

**Affected:** `frontend/next.config.ts`, and the `experimental.serverActions.bodySizeLimit: '11mb'` setting it contains, together with `frontend/src/proxy.ts`.

**Cause:** two limits disagree.
- The app allows server action requests up to 11 MB.
- Because `proxy.ts` runs on page requests, Next.js buffers only the first **10 MB** of the request (`experimental.proxyClientMaxBodySize`, default 10 MB, not set here).
- A 10 MB file plus the form's own encoding goes over 10 MB, so the request is cut off.

**Layer:** application configuration. It is not permissions, the database, RLS or storage.

**Evidence from the server log:**

```
Request body exceeded 10MB for /pre-admission/<id>. Only the first 10MB will be available unless configured.
⨯ Error: Unexpected end of form
```

**Why the friendly message never appears:** the request fails before the app's own "larger than 10 MB" check runs. The user sees "Something went wrong" instead.

**How much it matters on the Add documents form:** little. Its browser check blocks anything over 10 MB, so only a batch almost exactly at 10 MB gets through. A 9.99 MB file worked and a 10.00 MB file failed; the exact point between them was not measured. It matters more on forms with no browser check; see section 6.

## 3. What the evidence says about your attempts

**In the development database (read-only):**

| Check | Result |
|---|---|
| Pre-admission requests | 1, status draft, created 5 Nov at 12:07 IST by the demo MD account in Dr.Expert Edulinks |
| Documents ever added to it, including removed ones | **0** |
| Events on it | Only `created` |
| DVR files | 0 |
| Attendance photos saved through the same file service | Latest today, 10:13 IST |

**What this means:** a refused file still leaves a trace. In testing, a PNG or a fake PDF added a removed document row each time. Your draft has none. So in this database, nothing got as far as saving a document, and the following are ruled out **for attempts made on this database**: storage failure, database insert failure, RLS rejection and file-type rejection on the server. Attendance uploads confirm the storage and file service are working.

The current dev server's log, from 5 Nov 21:15, has no upload errors and no "exceeded 10MB" warning. Its only errors are the Chat missing-table errors already fixed. Logs from before that restart no longer exist.

**Explanations that fit this evidence, most likely first:**

1. **The file or batch is over 10 MB.** Scanned PDFs often are. The button goes grey and a small red line appears.
2. **The documents are images.** The form accepts PDF only, so JPEG and PNG files normally can't be chosen in the file window. This could look like the upload doesn't work.
3. **The category was left blank.** It's a free-text field with suggestions, not a dropdown. The form shows "Choose the document category."
4. **The form wasn't found.** The New request page has no file field. Files are added on the next page, in a section **below the first screen** (about 1,113 px down on a 900 px high window), while "Submit to Documentation" is visible higher up on the right.
5. **The login or status doesn't allow it.** See the table in section 4.
6. **The attempt was on a different system.** Production was not accessed. Its reported baseline, migration 0037, predates this module (0046). If you tried on the VPS, this report doesn't explain the failure. A web server limit there, such as nginx `client_max_body_size`, would also need checking.
7. **A different browser.** Only Chromium was tested. Safari and Firefox were not.

## 4. Upload flow and who can upload

**Flow:**

1. `/pre-admission/new` creates the draft: `NewDvrForm`, `createDvrAction`, `app.dvr_create`.
2. `frontend/src/app/(app)/pre-admission/[id]/page.tsx:61` shows `AddDocumentsForm` only if `can_change_documents` is true and the person is the owner.
3. `AddDocumentsForm` (`pre-admission/forms.tsx:52`) submits through `ActionForm`, using the shared server action path. There is no separate upload API route.
4. `addDvrDocumentsAction` (`frontend/src/app/actions/dvr.ts:34`) checks the session.
5. `addDvrDocuments` (`backend/src/services/dvr.ts`) checks the category, file presence and the 10-file limit. It then calls `app.dvr_add_document` once per file.
6. `uploadSecureFile('dvr', …)` (`backend/src/services/secure-files.ts:20`) checks the size, the real file type and permission, and scans if a scanner is configured. It then stores the file and calls `app.register_secure_file`.
7. The trigger `app.dvr_on_file` refuses anything but PDF and logs the new version. If the file is refused, the document row is marked removed.

**Who sees the form:**

| Person | Draft | Submitted (`new_request`) |
|---|---|---|
| Owner counsellor | Yes | **No** |
| Same-company manager | Yes | **No** |
| MD | Yes | **No** |
| Documentation | Page returns 404 | Page opens, **no form** |
| Another counsellor | 404 | Not tested in the browser |
| Other company | 404 | Not tested in the browser |

By the rules in `app.dvr_can_change_documents`, CEO has the same access as MD, and uploads reopen only at `additional_documents_required`, `correction_required` or `returned_to_counselor`. These rules come from migration 0046.

## 5. Test results

**Existing tests:** backend DVR tests 13 of 13 passed. Browser DVR tests 4 of 4 passed, including sending back, new versions, and refusal of other companies and signed-out users.

**Add documents form, as a counsellor, on the throwaway database:**

| Attempt | HTTP | Message | Documents | Files |
|---|---|---|---|---|
| One small PDF | 200 | Documents added. | +1 | +1 |
| Three PDFs | 200 | Documents added. | +3 | +3 |
| Blank category | 200 | Choose the document category. | 0 | 0 |
| No file | 200 | Choose at least one PDF. | 0 | 0 |
| Real PNG | 200 | Only PDF files are accepted for verification. | 0, one removed row left | 0 |
| Real JPEG | 200 | Same | 0, one removed row left | 0 |
| EXE renamed `.pdf` | 200 | Only PDF, JPEG, PNG or WebP files are accepted. | 0, one removed row left | 0 |
| Empty PDF | 200 | Choose at least one PDF. | 0 | 0 |
| PDF with a leading blank line | 200 | Only PDF, JPEG, PNG or WebP files are accepted. | 0, one removed row left | 0 |
| Spaces, symbols and `../` in filename | 200 | Documents added. | +1 | +1 |
| 1, 5, 9, 9.9 and 9.99 MB | 200 | Documents added. | +1 each | +1 each |
| **10 MB exactly** | **500** | **Error page** | 0 | 0 |
| 10 MB + 1 byte, and 12 MB | No request | Button disabled, red message | 0 | 0 |
| Three PDFs, 9.6 MB in total | 200 | Documents added. | +3 | +3 |
| **Three PDFs, 10 MB in total** | **500** | **Error page** | 0 | 0 |
| Eleven small PDFs | 200 | Upload at most 10 files at a time. | 0 | 0 |
| Manager, then MD, small PDF on a draft | 200 | Documents added. | +1 each | +1 each |

Browser console errors appeared only on the 500 cases: `Unexpected end of form`.

The PNG and JPEG were sent directly by the test, bypassing the file window's PDF filter.

**On a disposable copy of your dev database, your draft, as its owner:**

| Attempt | Result |
|---|---|
| Blank category, no file | Message shown, nothing saved |
| Over 10 MB | Button disabled |
| Small PDF, 5 MB PDF | **Added and stored** |
| 10 MB exactly | 500, error page |

**Opening files:**

| Who | Result |
|---|---|
| Owner | 302 to a signed link, then 200, PDF shown inline |
| Documentation, after submission | 302 |
| Documentation on a draft, other counsellor, other company | 404 |
| Signed out | 404 |
| Signed link, within 60 seconds, signed out | **200** (the link itself is the permission) |
| Signed link after 61 seconds, tampered signature, path traversal | 403 |

**Not tested:**
- Safari, Firefox or real phones.
- An unauthorized person sending a hand-crafted upload request. This is enforced by the database functions and refused in existing tests, but I did not replay it in the browser.
- Real scanned PDFs. All test files were generated.
- The S3 storage driver, or anything on the VPS.

**Evidence logs:**
- `/private/tmp/claude-501/-Users-drhuzair-Documents-erp-mvp/44dcbb36-30dc-4ca3-ae81-5e3956d1d91c/scratchpad/dvr/logs/browser.log`
- `/private/tmp/claude-501/-Users-drhuzair-Documents-erp-mvp/44dcbb36-30dc-4ca3-ae81-5e3956d1d91c/scratchpad/dvr/logs/copy.log`
- `/private/tmp/claude-501/-Users-drhuzair-Documents-erp-mvp/44dcbb36-30dc-4ca3-ae81-5e3956d1d91c/scratchpad/dvr/logs/browser2.log`

## 6. Other modules and recent changes

**The same defect affects other forms using server actions. Those without a browser size check fail on every file of 10 MB or more:**

| Form | Over-limit file | Result |
|---|---|---|
| DVR new version | 12 MB and 10 MB | 500, error page, no friendly message |
| Student document | 12 MB | 500, error page, no friendly message |
| Chat attachment | 12 MB and 10 MB | 500. Shows "The message was not sent. Check your connection", which is misleading in this case |

The same 9 MB file worked on the DVR new version and student document forms, and 9.99 MB worked in chat. Attestation evidence, ticket attachments, task files and the student portal use the same path and have no browser size check, so they are likely affected, but I **did not test** them. Student and staff photos are compressed to 5 MB in the browser, so they should not reach this limit.

**This is not a recent regression.**
- The module (DVR code, migration 0046) arrived in `7c32354`, 5 November.
- `proxy.ts` and the 11 MB setting date from `3321240` and earlier, and the DVR form's 10 MB check dates from `7c32354`.
- No DVR, storage or upload service file has changed in the working tree.
- The chat work changed only one shared thing: `forms.tsx` now exports `usePending`, with no change in behaviour. Chat's own failure message was added in `chat-room.tsx`.
- No permission or storage policy for DVR has changed since 0046. Migration 0048 added tickets to the secure-file rules and kept DVR.

## 7. What I need from you to confirm your failure

1. The exact on-screen message, or a screenshot, and whether the button was grey.
2. The file's type and size.
3. Which login you used, and the request's status.
4. Which address you used: `localhost:3000`, or the VPS.
5. Which browser.

## 8. Recommended minimal fix (not applied)

1. **Fix the limit mismatch.** Add `proxyClientMaxBodySize: '11mb'` under `experimental` in `frontend/next.config.ts`, matching the existing 11 MB limit. With that, oversized files should reach the app's own "larger than 10 MB" check. **No migration needed.** Retest at 10 MB and 12 MB on each form.
   **Side effects:** each page POST can buffer up to 11 MB in memory instead of 10 MB, a small increase. Requests above 11 MB still fail, so a clear browser-side size check on forms lacking one is a sensible follow-up. On the VPS, any web server limit must also allow this size.
2. **Then, depending on section 7**, make small form improvements such as a clearer size message, a visible link from the top of the page to Add documents, or a dropdown for category. Each is a small change to `pre-admission/forms.tsx` or `page.tsx`, with no effect on permissions.
3. **A business decision, only if you want it:** accept JPEG and PNG in DVR. This reverses a deliberate rule, needs a **migration** to change `app.dvr_on_file`, and needs the form's `accept` list and text updated. The request's review screens would also need checking for images. Merging images into a PDF in the browser would be a larger change.

**Stopped here, awaiting your approval. Nothing has been fixed.**
