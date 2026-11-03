# API contract inventory (Express refactor, Stage 0)

**Recorded:** 3 November 2026, branch `refactor/express-api` (from `main` at `eb8dd7d`), before any application change.

**Purpose:** the behaviour every later stage must preserve when Server Actions, page loaders and route handlers move behind the Express API. Each Express endpoint is specified against this file, and each change is verified against the characterization tests listed here.

**Sources:**
- **Recorded:** asserted by characterization tests that ran against the current code on the throwaway test database.
  - `frontend/tests/integration/contract-route-handlers.test.ts` (23 tests)
  - `frontend/tests/integration/contract-actions.test.ts` (15 tests)
- **Source:** read from the code, not yet asserted by a test.

**Development and test cookie names** have no prefix. Production names: `__Host-erp_session`, `__Host-erp_device`, `__Secure-erp_portal`, `__Secure-erp_portal_device`, `erp_scope`.

## 1. Baseline (Stage 0)

| Check | Result |
|---|---|
| Typecheck (backend + frontend) | Passed |
| Lint | Passed, 0 problems |
| Unit + integration, unchanged suite, run 1 | 363/363 passed (backend 320 + migrations 2, frontend 41) |
| Unit + integration, unchanged suite, run 2 | 363/363 passed (no intermittent failures) |
| Production build | Passed, 0 warnings |
| With the characterization tests added, runs 1 and 2 | 401/401 passed each time (frontend 79 = 41 + 38) |
| Browser tests | **Not run** (Stage 0 rule; they need the approved disposable browser-test database) |

All tests used only the throwaway database: `.data/pg-test`, port 54339. The development database was not used.

## 2. Route handlers

Since Stage 1, `GET /api/health` is served by the internal Express API through the Next.js proxy (`frontend/src/server-api/proxy.ts`); the recorded contract is unchanged.

Since Stage 2, the read-only file and photo routes are served the same way: `GET /api/files/:id`, `/api/files/:id/content`, `/api/storage/local`, `/api/students/:id/photo`, `/api/students/:id/photo/download` and `/api/staff/:id/photo` (Next.js route → signed BFF call → Express route → controller → service → repository). Their full contracts were recorded against the former route handlers before the move, in `frontend/tests/integration/contract-files-photos.test.ts`, and pass unchanged through the API:
- every response header except `Content-Length` (exact sets; plain-text bodies are `text/plain;charset=UTF-8`)
- permission matrices for eight demo accounts (document files: only the documentation officer and the EDX manager; CEO, MD and system admin get 404; student photo: EDX manager and counsellor; staff photo: colleagues in the same company)
- audit rows written by the database (`file_access`, `file_download`, `photo_download`; denied attempts too), with the client address from the trusted proxy only (`X-Forwarded-For` ignored with `TRUST_PROXY=x-real-ip`)
- quarantine (an infected file: 404, audited as denied with reason `quarantined`)
- `size` parameter: exact match only; for a repeated key the first value counts
- signed links: tampered, expired, other key, type outside the allow-list, no parameters → 403; missing file → 404 without a cache header
- with the API unavailable these routes answer 502, empty, `no-store` (decision D6)

**Content-Length:** the former handlers' Response objects had no `Content-Length` header (Next.js chose the framing); the proxied responses carry the exact byte count from the API. This is the only header difference.

"Signed out" means no valid session cookie. "Not allowed" covers another company, no permission, or an unknown id.

| Route | Case | Status | Body | Headers | Basis |
|---|---|---|---|---|---|
| `GET /api/health` | database up | 200 | `{"status":"ok"}` | `content-type: application/json`, `cache-control: no-store` | Recorded |
| `GET /api/health` | database down (Stage 1, served by Express) | 503 | `{"status":"database_unavailable"}` | `content-type: application/json`, `cache-control: no-store` | Recorded |
| `GET /api/health` | internal API not running or not configured (new in Stage 1, decision D6) | 503 | `{"status":"api_unavailable"}` | `cache-control: no-store` | Recorded |
| | database down | 503 | `{"status":"database_unavailable"}` | `no-store` | Source |
| `GET /api/files/:id` | signed out | 404 | `Not found` | **no** `cache-control` | Recorded |
| | not allowed / unknown | 404 | `Not found` | `cache-control: no-store` | Recorded |
| | allowed | 302 | empty | `location: /api/storage/local?k&e&f&t&s` (local driver), `cache-control: no-store`, `referrer-policy: no-referrer` | Recorded |
| `GET /api/storage/local` | valid signed link | 200 | file bytes | `content-type` = `t`; `content-disposition: inline; filename="<f sanitised>"`; `cache-control: private, no-store`; `x-content-type-options: nosniff`; `content-security-policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox`; `referrer-policy: no-referrer` | Recorded |
| | bad signature, or type not allowed | 403 | `Link expired or invalid` | `no-store` | Recorded |
| | storage driver not local | 404 | `Not found` | none | Source |
| `GET /api/files/:id/content` | signed out | 404 | `Not found` | no `cache-control` | Recorded |
| | not allowed / unknown / quarantined | 404 | `Not found` | `no-store` | Recorded (quarantine: `audit-remediation.test.ts`) |
| | allowed | 200 | file bytes | `content-type` = file type, `content-disposition: inline`, `private, no-store`, `nosniff`, `content-security-policy: default-src 'none'; sandbox` | Recorded |
| `GET /api/attestation-files/:id` | signed out | 404 | `Not found` | no `cache-control` | Recorded |
| | unknown | 404 | `Not found` | `no-store` | Recorded |
| | allowed | 200 | bytes | same as `/content` | Source |
| `GET /api/students/:id/photo[?size=portrait]` | allowed (thumb and portrait) | 200 | JPEG | `content-type: image/jpeg`, `cache-control: private, max-age=300`, `nosniff`, `content-security-policy: default-src 'none'` | Recorded |
| | signed out | 404 | `Not found` | no `cache-control` | Recorded |
| | other company | 404 | `Not found` | `no-store` | Recorded |
| `GET /api/students/:id/photo/download` | allowed | 302 | empty | `location: /api/storage/local?…`, `no-store`, `no-referrer` | Recorded |
| | signed out / other company | 404 | `Not found` | none / `no-store` | Recorded |
| `GET /api/staff/:id/photo[?size=display]` | signed out | 404 | `Not found` | no `cache-control` | Recorded |
| | no photo / unknown | 404 | `Not found` | `no-store` | Recorded |
| | allowed | 200 | JPEG | `image/jpeg`, `private, max-age=300`, `nosniff`, `default-src 'none'` | Source |
| `GET /api/students/import-template` | signed out | 404 | `Not found` | none | Recorded |
| | signed in | 200 | the template CSV, **beginning with a UTF-8 byte-order mark (EF BB BF)** | `text/csv; charset=utf-8`, `attachment; filename="student-import-template.csv"`, `no-store` | Recorded |
| `GET /api/reports/:key?…` | signed out | 404 | `Not found` | no `cache-control` | Recorded |
| | unknown report, or a report not listed for the user (e.g. counsellor + `by-stage`) | 404 | `Report not found.` | `no-store` | Recorded |
| | allowed | 200 | CSV | `text/csv; charset=utf-8`, `attachment; filename="<name>.csv"`, `no-store` | Recorded |
| | listed but export not allowed | 403 | `You are not allowed to export this report.` (audited as denied) | `no-store` | Source |
| `POST /api/students/:id/merge` (form: `mode`, `files[]`, `universityId`, `purpose`, `allowUnapproved`) | signed out (checked **before** Origin) | 404 | `Not found` | none | Recorded |
| | missing Origin, or Origin host ≠ Host | 403 | `Forbidden` | none | Recorded |
| | selection error (e.g. no files) | 422 | the service message, e.g. `Select at least one document.` | `text/plain; charset=utf-8`, `no-store` | Recorded |
| | a file that cannot be read | 422 | `The combined PDF was not generated.` + blank line + reason + `• <document>: <error>` lines + `Go back, correct the selection and try again.` | `text/plain; charset=utf-8`, `no-store` | Recorded |
| | success | 200 | PDF | `application/pdf`; `inline` (preview) or `attachment` (download) with `filename="<ASCII>"; filename*=UTF-8''<encoded>`; `private, no-store`; `nosniff` | Recorded |
| | unexpected error | 500 | `The combined PDF could not be generated.` | `text/plain; charset=utf-8`, `no-store` | Source |
| `GET /portal/files/:id` | no portal session / not published | 404 | `Not found` | `no-store` | Recorded |
| | allowed | 200 | bytes | `attachment; filename="<sanitised>"`, `private, no-store`, `nosniff`, `default-src 'none'; sandbox` | Source |
| `GET /api/cron/daily` | secret unset, shorter than 32 characters, missing, wrong, or without `Bearer ` | 404 | `Not found` | none | Recorded |
| | correct `Authorization: Bearer <CRON_SECRET>` | 200 | JSON keys `passportTasksCreated, emailVerificationsExpired, virusScan, authHousekeeping, portalLinkEmailsRemoved, authMessagesRemoved` | `no-store` | Recorded |
| `GET /api/cron/notifications` | same failures | 404 | `Not found` | none | Recorded |
| | correct secret | 200 | JSON incl. `processed, securityAlerts, staffEmails, portalLinkEmails, authMessages` | `no-store` | Recorded |

The Next-wide headers from `frontend/next.config.ts` (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS in production) are added by Next on top of these. The tests call the handlers directly, so they do not include them.

## 3. Server Actions: recorded behaviour

| Action | Case | Result |
|---|---|---|
| `loginAction` | empty email or password | `{ ok:false, message:'Enter your email and password.' }`, no cookie |
| | wrong password | `{ ok:false, message:'Incorrect email or password.' }`, no cookie |
| | success (no two-step login) | redirect `/`. One cookie set: `erp_session`, `{ httpOnly:true, secure:false (true in production), sameSite:'lax', path:'/', maxAge:43200 }`. No post-response send. |
| `logoutAction` | signed in | redirect `/login`; `erp_session` deleted (no options); the session no longer resolves |
| `forgotPasswordAction` | empty | `{ ok:false, message:'Enter your email address.' }`, nothing scheduled |
| | known or unknown address | the **same** result for both. Without email configured: `{ ok:true, message:'Your request has been recorded. Email delivery is not set up yet, so please ask your administrator for a reset link.' }`. One post-response send each. |
| `setScopeAction` | signed out | redirect `/login`, no cookie |
| | signed in | `erp_scope` set to the company id (or `all`) with `{ httpOnly:true, sameSite:'lax', secure:false (true in production), path:'/', maxAge:7776000 }`. Redirect to `back` when it starts with `/` and not `//`, otherwise `/`. A company the user doesn't belong to falls back to the first company. |
| `createTaskAction` | signed out | redirect `/login` |
| | success | redirect `/tasks/<uuid>?created=1`; one post-response send |
| | success with `returnTo=/students/…` | `{ ok:true, message:'Task created.' }`; that path revalidated; no redirect |
| | validation error | `{ ok:false, message:'Please correct the highlighted fields.', fieldErrors:{ title:['Enter a title.'] } }`; nothing scheduled |
| | other company | `{ ok:false, message:'You cannot create tasks for this company.', fieldErrors: undefined }` |
| `updateTaskAction` | success | `{ ok:true, message:'Task updated.' }`; `/tasks/<id>` revalidated; one send |
| | unknown task | `{ ok:false, message:'The record was not found or you do not have access to it.', fieldErrors: undefined }` |
| `commentAction` | success | `{ ok:true, message:'Comment added.' }`; `/tasks/<id>` revalidated; one send |
| `uploadAction` (documents) | no file | `{ ok:false, message:'Choose a file to upload.' }` (no `fieldErrors` key) |
| | 10 MB + 1 byte | `{ ok:false, message:'The file is larger than 10 MB.', fieldErrors: undefined }` |
| | non-PDF content named `.pdf` | `{ ok:false, message:'Only PDF, JPEG, PNG or WebP files are accepted.', fieldErrors: undefined }` |
| | exactly 10 MB, valid | `{ ok:true, message:'File uploaded. It now needs review.' }`; `/students/<id>` revalidated; one send |
| `requestCodeAction` (portal) | any identifier, known or not | redirect `/portal/verify?c=<challenge>`; a post-response send is scheduled; no cookie |
| `logoutAction` (portal) | any | redirect `/portal?signedout=1`; `erp_portal` deleted with `{ path:'/portal' }` |

## 4. Parity details found while recording
These must be reproduced exactly by the Express/BFF path:
1. **`fieldErrors: undefined`.** Results produced by `runAction` from a `ServiceError` contain the key `fieldErrors` with value `undefined`. Early returns inside an action do not. JSON drops `undefined`, so the BFF must rebuild `ActionResult` the way `runAction` does, not just pass parsed JSON through.
2. **Signed-out 404s have no `cache-control` header**; other 404s carry `no-store`.
3. **The import template starts with a UTF-8 byte-order mark.** Bytes must be relayed unchanged; `Response.text()` would strip it.
4. **Merge order:** the session check comes before the Origin check, so a signed-out request gets 404 rather than 403.
5. **Reports:** a report the user can't see gets 404 `Report not found.`; 403 is only for listed reports whose export is not allowed.
6. **Server Action redirects** are carried by Next's `NEXT_REDIRECT` mechanism. The target URL is the contract; Next chooses the status (303 for actions).
7. **Post-response sends:** `runAction` schedules one `after()` per successful call, and none on error. `forgotPasswordAction` and `requestCodeAction` always schedule one, so the response reveals nothing about the account.

## 5. Not captured yet (to record before the slice that changes them)
Planned as characterization tests at the start of each module's slice, before any of its code changes:
- attestation-file and portal-file success (attestation and portal slices); the reports 403 export path; merge 500
- staff sign-in redirects for must-change-password and two-step login (`/login/verify`, MFA cookies, trusted-browser cookie); password reset, invitation and MFA actions
- portal sign-in with code and password (portal and device cookies), upload, courier, referral
- the remaining 139 actions marked "slice" below; and the 61 page loaders (their data shapes are recorded when each page's module is migrated)

## 6. All Server Actions (149; a static extraction, confirmed for rows marked "yes")
Columns come from the source. "Post-response send" lists `after()` work; `processQueue (runAction)` means one send after a successful `runAction`. Cookie columns are incomplete where cookies are set inside services (for example trusted-device, portal and password sign-in). Those rows are completed when each module is characterized.


#### `frontend/src/app/actions/academic.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| saveRecordAction | studentId, recordId | formObject(fd)→schema | - | tab(studentId) | - | processQueue (runAction) | - | slice |
| deleteRecordAction | studentId, recordId | - | - | tab(studentId) | - | processQueue (runAction) | Removed. | slice |
| reviewNameCheckAction | studentId, checkId | decision, note | - | tab(studentId) | - | processQueue (runAction) | - | slice |
| prepareOasAction | studentId, caseId | templateId | - | tab(studentId) | - | processQueue (runAction) | Preview generated. | slice |
| requestOasAction | studentId, caseId | channel, note | - | tab(studentId) | - | processQueue (runAction) | - | slice |
| cancelOasAction | studentId, caseId | reason | - | tab(studentId) | - | processQueue (runAction) | Requirement cancelled. | slice |
| addThresholdAction | - | formObject(fd)→schema | - | admin | - | processQueue (runAction) | Threshold added. | slice |
| toggleThresholdAction | id, active | - | - | admin | - | processQueue (runAction) | - | slice |
| addOasRuleAction | - | formObject(fd)→schema | - | admin | - | processQueue (runAction) | Rule added. | slice |
| toggleOasRuleAction | id, active | - | - | admin | - | processQueue (runAction) | - | slice |
| addTemplateAction | - | formObject(fd)→schema | - | admin | - | processQueue (runAction) | Draft template saved. A manager or the MD must approve it. | slice |
| approveTemplateAction | id | - | - | admin | - | processQueue (runAction) | Template approved. | slice |
| retireTemplateAction | id | - | - | admin | - | processQueue (runAction) | Template retired. | slice |
| academicCheckAction | stageKey | check | - | admin | - | processQueue (runAction) | Saved. | slice |

#### `frontend/src/app/actions/admin.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| createStaffAction | - | formObject(fd)→schema, photo, photoCrop | - | '/admin/users' | - | deliverInvitation, processQueue (runAction) | - | slice |
| inviteAction | userId | - | - | `/admin/users/${userId}`; '/admin/users' | - | deliverInvitation, processQueue (runAction) | - | slice |
| cancelInviteAction | userId | - | - | `/admin/users/${userId}` | - | processQueue (runAction) | Invitation cancelled. | slice |
| staffStatusAction | userId | formObject(fd)→schema | - | `/admin/users/${userId}`; '/admin/users' | - | processQueue (runAction) | - | slice |
| revokeSessionsAction | userId | - | - | `/admin/users/${userId}` | - | processQueue (runAction) | - | slice |
| staffDetailsAction | userId | formObject(fd)→schema | - | `/admin/users/${userId}` | - | processQueue (runAction) | Details saved. | slice |
| reassignTasksAction | userId | toUserId | - | `/admin/users/${userId}`; '/tasks' | - | processQueue (runAction) | - | slice |
| membershipAction | membershipId | formObject(fd)→schema | - | '/admin/users' | - | processQueue (runAction) | Access updated. | slice |
| userActiveAction | userId, active | - | - | '/admin/users' | - | processQueue (runAction) | - | slice |
| resetLinkAction | userId | - | - | - | - | processQueue (runAction) | - | slice |
| rolePermissionsAction | roleId | perm | - | '/admin/roles' | - | processQueue (runAction) | Permissions saved. | slice |
| createRoleAction | - | formObject(fd)→schema | - | '/admin/roles' | - | processQueue (runAction) | Role created. Now choose its permissions. | slice |
| orgSettingsAction | orgId | formObject(fd)→schema | - | '/admin/settings' | - | processQueue (runAction) | Company settings saved. | slice |
| addReferenceAction | kind | formObject(fd)→schema | - | '/admin/settings' | - | processQueue (runAction) | Added. | slice |
| toggleReferenceAction | kind, id, active | - | - | '/admin/settings' | - | processQueue (runAction) | - | slice |
| workflowAction | workflowId | stage, doc | - | '/admin/settings' | - | processQueue (runAction) | - | slice |
| staffPhotoAction | userId | photo, photoCrop | - | `/admin/users/${userId}`; '/admin/users' | - | processQueue (runAction) | Photo saved. It is now shown wherever this person appears. | slice |
| removeStaffPhotoAction | userId | - | - | `/admin/users/${userId}`; '/admin/users' | - | processQueue (runAction) | Photo removed. | slice |
| reportingManagerAction | userId | reportsTo | - | `/admin/users/${userId}` | - | processQueue (runAction) | Reporting manager saved. | slice |
| roleStructureAction | roleId | isActive, parentRoleId | - | '/admin/roles' | - | processQueue (runAction) | Role saved. | slice |

#### `frontend/src/app/actions/attestation.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| startAttestationAction | studentId, docId | routeId | - | docPath(studentId, docId) | - | processQueue (runAction) | Attestation started. | slice |
| stepAction | studentId, docId, stepId | formObject(fd)→schema | - | docPath(studentId, docId) | - | processQueue (runAction) | - | slice |
| stepFileAction | studentId, docId, stepId | file | - | docPath(studentId, docId) | - | processQueue (runAction) | Supporting document uploaded. | slice |
| cancelAttestationAction | studentId, docId, attestationId | reason | - | docPath(studentId, docId) | - | processQueue (runAction) | Attestation cancelled. | slice |
| saveRouteAction | id | formObject(fd)→schema | `${base}/${newId}` | base; `${base}/${id}` | - | processQueue (runAction) | Saved. | slice |
| addStageAction | routeId | formObject(fd)→schema | - | `${base}/${routeId}` | - | processQueue (runAction) | Stage added. | slice |
| removeStageAction | routeId, stageId | - | - | `${base}/${routeId}` | - | processQueue (runAction) | Removed. | slice |
| moveStageAction | routeId, stageId, dir | - | - | `${base}/${routeId}` | - | processQueue (runAction) | - | slice |
| approveRouteAction | routeId | - | - | base; `${base}/${routeId}` | - | processQueue (runAction) | Approved. The route can be used from today. | slice |
| newRouteVersionAction | routeId | - | `${base}/${id}` | - | - | processQueue (runAction) | - | slice |
| deleteRouteDraftAction | routeId | - | base | - | - | processQueue (runAction) | - | slice |
| addAuthorityAction | - | formObject(fd)→schema | - | base | - | processQueue (runAction) | Authority added. | slice |
| toggleAuthorityAction | id, active | - | - | base | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/auth.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| loginAction | - | formObject(fd)→schema, password | '/login/verify'; r.mustChangePassword ? '/account/password?required=1' : '/' | - | login | - | Enter your email and password. | yes |
| logoutAction | - | - | '/login' | - | logout | - | - | yes |
| forgotPasswordAction | - | formObject(fd)→schema | - | - | - | deliverStaffEmails | Enter your email address. | yes |
| resetPasswordAction | - | token, password, confirm | '/login?reset=1' | - | - | processQueue (runAction) | - | slice |
| changePasswordAction | - | current, next, confirm | '/?password=changed' | - | - | processQueue (runAction) | Please correct the highlighted fields. | slice |
| verifyMfaAction | - | code | '/login'; '/login?mfa=locked'; '/' | - | logout | - | - | slice |
| startMfaAction | - | - | - | - | - | processQueue (runAction) | - | slice |
| finishMfaAction | - | code | - | - | - | processQueue (runAction) | Two-factor login is now on. | slice |
| adminResetMfaAction | userId | reason | - | - | - | processQueue (runAction) | - | slice |
| acceptInvitationAction | - | token, password, confirm | '/login?invited=1' | - | - | processQueue (runAction) | - | slice |
| signOutEverywhereAction | - | - | '/login?signedout=all' | - | logout | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/courier.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| issueCourierAction | studentId | addressId, documents, exception | - | docsPath(studentId) | - | processQueue (runAction) | - | slice |
| recordDispatchAction | studentId, shipmentId | formObject(fd)→schema | - | docsPath(studentId) | - | processQueue (runAction) | Courier details saved. | slice |
| shipmentStatusAction | studentId, shipmentId | status, note | - | docsPath(studentId) | - | processQueue (runAction) | - | slice |
| reconcileShipmentAction | studentId, shipmentId | - | - | docsPath(studentId) | - | processQueue (runAction) | - | slice |
| saveCourierAddressAction | id | formObject(fd)→schema | - | '/admin/courier' | - | processQueue (runAction) | Delivery address saved. | slice |

#### `frontend/src/app/actions/documents.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| uploadAction | studentId, documentId | file | - | tab(studentId) | - | processQueue (runAction) | File uploaded. It now needs review. | yes |
| documentActionAction | studentId, documentId | formObject(fd)→schema | - | tab(studentId); `${tab(studentId)}/documents/${documentId}` | - | processQueue (runAction) | - | slice |
| verificationAction | studentId, documentId, requirementId | formObject(fd)→schema | - | `${tab(studentId)}/documents/${documentId}` | - | processQueue (runAction) | Recorded. | slice |
| annotationAction | studentId, documentId, fileId | rects, page, quote, body | - | `${tab(studentId)}/documents/${documentId}` | - | processQueue (runAction) | Comment added. | slice |
| custodyAction | studentId, documentId | formObject(fd)→schema | - | tab(studentId) | - | processQueue (runAction) | Location recorded. | slice |
| documentDetailsAction | studentId, documentId | formObject(fd)→schema | - | tab(studentId) | - | processQueue (runAction) | Saved. | slice |
| addChecklistItemAction | studentId | formObject(fd)→schema | - | tab(studentId) | - | processQueue (runAction) | Checklist item added. | slice |

#### `frontend/src/app/actions/import.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| previewImportAction | - | - | - | - | - | processQueue (runAction) | Choose a CSV file first. | slice |
| commitImportAction | - | includeDuplicates | - | '/students' | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/leads.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| createLeadAction | - | formObject(fd)→schema | `/leads/${id}?created=1` | - | - | processQueue (runAction) | - | slice |
| updateLeadAction | id | formObject(fd)→schema | - | `/leads/${id}` | - | processQueue (runAction) | Details saved. | slice |
| leadWorkAction | id | formObject(fd)→schema | - | `/leads/${id}` | - | processQueue (runAction) | Saved. | slice |
| routeLeadAction | id | orgId | - | `/leads/${id}` | - | processQueue (runAction) | Lead routed. | slice |
| duplicateAction | id, decision | - | - | `/leads/${id}` | - | processQueue (runAction) | - | slice |
| convertLeadAction | id | - | `/students/${studentId}?created=1` | - | - | processQueue (runAction) | - | slice |
| importLeadsAction | - | file, orgId, source | - | '/leads' | - | processQueue (runAction) | Choose a CSV file. | slice |

#### `frontend/src/app/actions/master-data.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| saveCountryAction | id | formObject(fd)→schema | - | - | - | processQueue (runAction) | - | slice |
| saveCourseAction | id | formObject(fd)→schema, countryIds | - | - | - | processQueue (runAction) | - | slice |
| masterStatusAction | kind, id, active | - | - | - | - | processQueue (runAction) | - | slice |
| requestMasterDataAction | - | formObject(fd)→schema | - | '/admin/master-data/requests' | - | processQueue (runAction) | - | slice |
| decideRequestAction | id, approve | note, code | - | - | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/merge.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| checkMergeAction | studentId | files, universityId, purpose | - | - | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/notifications.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| consentAction | studentId | formObject(fd)→schema | - | `/students/${studentId}` | - | processQueue (runAction) | Consent recorded. | slice |
| retryMessageAction | id, back | - | - | back | - | processQueue (runAction) | Message queued again. | slice |
| processNowAction | - | - | - | '/notifications' | - | processQueue (runAction) | - | slice |
| saveTemplateAction | id | formObject(fd)→schema | - | '/admin/notifications' | - | processQueue (runAction) | Template saved. | slice |
| saveRuleAction | orgId, eventKey, channel, audience, templateId | enabled, stage | - | '/admin/notifications' | - | processQueue (runAction) | Saved. | slice |

#### `frontend/src/app/actions/passport.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| recordPassportAction | studentId | formObject(fd)→schema | - | studentPath(studentId) | - | processQueue (runAction) | - | slice |
| verifyPassportAction | studentId, passportId | decision, note | - | studentPath(studentId) | - | processQueue (runAction) | - | slice |
| passportFollowupAction | studentId | formObject(fd)→schema | - | studentPath(studentId) | - | processQueue (runAction) | Saved. | slice |
| sendEmailVerificationAction | studentId | - | - | studentPath(studentId) | - | deliverAuthMessages, processQueue (runAction) | - | slice |
| addValidityRuleAction | - | formObject(fd)→schema | - | '/admin/passport-rules' | - | processQueue (runAction) | Rule added. | slice |
| toggleValidityRuleAction | id, active | - | - | '/admin/passport-rules' | - | processQueue (runAction) | - | slice |
| contactStageAction | - | stageKey | - | '/admin/passport-rules' | - | processQueue (runAction) | Saved. | slice |

#### `frontend/src/app/actions/payments.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| recordPaymentAction | studentId | formObject(fd)→schema | - | `/students/${studentId}` | - | processQueue (runAction) | - | slice |
| verifyPaymentAction | entryId, back | formObject(fd)→schema | - | back | - | processQueue (runAction) | - | slice |
| reversePaymentAction | entryId, back | reason | - | back | - | processQueue (runAction) | Reversal recorded and awaiting verification. | slice |
| correctRateAction | entryId, back | rate, reason | - | back | - | processQueue (runAction) | - | slice |
| saveCurrencyAction | - | formObject(fd)→schema | - | '/admin/currencies' | - | processQueue (runAction) | Saved. Existing payments keep their own rates. | slice |

#### `frontend/src/app/actions/portal-accounts.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| issuePortalLinkAction | studentId | - | - | - | - | deliverPortalEmails, processQueue (runAction) | - | slice |
| portalAccountStatusAction | studentId, enable | reason | - | path(studentId) | setPortalAccountEnabled | processQueue (runAction) | - | slice |
| publishAction | studentId, documentId | title | - | path(studentId) | - | processQueue (runAction) | - | slice |
| unpublishAction | studentId, publicationId | reason | - | path(studentId) | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/requirements.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| acknowledgeAction | studentId, noticeId | - | - | `/students/${studentId}` | - | processQueue (runAction) | - | slice |
| saveRequirementAction | groupId | formObject(fd)→schema | `/admin/requirements/${g}?saved=1` | '/admin/requirements' | - | processQueue (runAction) | - | slice |
| requirementStatusAction | groupId, active | reason | - | `/admin/requirements/${groupId}`; '/admin/requirements' | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/scope.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| setScopeAction | - | scope, back | back.startsWith('/') && !back.startsWith('//') ? back : '/' | - | - | - | - | yes |

#### `frontend/src/app/actions/security.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| clearFileAction | fileId | reason | - | '/students', 'layout' | - | processQueue (runAction) | - | slice |
| acknowledgeAlertAction | alertId | note | - | '/admin/security' | - | processQueue (runAction) | Alert acknowledged. | slice |

#### `frontend/src/app/actions/students.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| createStudentAction | - | formObject(fd)→schema, photo, photoCrop | `${path(id)}?created=1${photoError ? '&photoerror=1' : ''}` | - | - | processQueue (runAction) | - | slice |
| uploadStudentPhotoAction | id | photo, photoCrop | - | path(id); '/students' | - | processQueue (runAction) | Photo saved. It now appears wherever this student is shown. | slice |
| removeStudentPhotoAction | id | - | - | path(id); '/students' | - | processQueue (runAction) | Photo removed. | slice |
| updateStudentAction | id | formObject(fd)→schema | `${path(id)}?updated=1` | - | - | processQueue (runAction) | - | slice |
| changeStageAction | id | formObject(fd)→schema, toStage | - | path(id) | - | processQueue (runAction) | Please review these warnings before continuing. / Stage updated. | slice |
| assignAction | id | formObject(fd)→schema | - | path(id) | - | processQueue (runAction) | Assignment saved. | slice |
| noteAction | id | formObject(fd)→schema | - | path(id) | - | processQueue (runAction) | Note added. | slice |
| followupAction | id | formObject(fd)→schema | - | path(id) | - | processQueue (runAction) | Follow-up logged. | slice |
| visaAction | id | formObject(fd)→schema | - | path(id) | - | processQueue (runAction) | Visa details saved. | slice |
| admissionAction | id | formObject(fd)→schema | - | path(id) | - | processQueue (runAction) | Admission details saved. | slice |
| mergeAction | id | formObject(fd)→schema | - | path(id) | - | processQueue (runAction) | - | slice |
| archiveAction | id | formObject(fd)→schema | - | path(id) | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/tasks.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| createTaskAction | - | formObject(fd)→schema | `/tasks/${id}?created=1` | v.returnTo | - | processQueue (runAction) | Task created. | yes |
| updateTaskAction | id | formObject(fd)→schema | - | `/tasks/${id}` | - | processQueue (runAction) | Task updated. | yes |
| commentAction | id | body | - | `/tasks/${id}` | - | processQueue (runAction) | Comment added. | yes |

#### `frontend/src/app/actions/universities.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| saveUniversityAction | id | formObject(fd)→schema | `/universities/${newId}` | '/universities'; `/universities/${id}` | - | processQueue (runAction) | Saved. | slice |
| addPartAction | universityId, part | formObject(fd)→schema | - | `/universities/${universityId}` | - | processQueue (runAction) | - | slice |
| togglePartAction | universityId, part, id, active | - | - | `/universities/${universityId}` | - | processQueue (runAction) | - | slice |
| removeRequirementAction | universityId, id | - | - | `/universities/${universityId}` | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/actions/verification-rules.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| saveRuleAction | id | formObject(fd)→schema | `${base}/${newId}` | base; `${base}/${id}` | - | processQueue (runAction) | Saved. | slice |
| addRequirementAction | ruleId | formObject(fd)→schema | - | `${base}/${ruleId}` | - | processQueue (runAction) | Check added. | slice |
| removeRequirementAction | ruleId, reqId | - | - | `${base}/${ruleId}` | - | processQueue (runAction) | Removed. | slice |
| approveRuleAction | ruleId | - | - | base; `${base}/${ruleId}` | - | processQueue (runAction) | - | slice |
| newVersionAction | ruleId | - | `${base}/${id}` | - | - | processQueue (runAction) | - | slice |
| deleteDraftAction | ruleId | - | base | - | - | processQueue (runAction) | - | slice |

#### `frontend/src/app/portal/actions.ts`

| Action | Bound args | Form fields read | Redirects | Revalidates | Cookies | Post-response send | Success message | Characterized (stage 0) |
|---|---|---|---|---|---|---|---|---|
| requestCodeAction | - | identifier | `/portal/verify?c=${challenge}` | - | - | deliverAuthMessages, processQueue (runAction) | - | yes |
| verifyCodeAction | challenge | code | '/portal/home'; '/portal?expired=1' | - | verifyCode | - | - | slice |
| chooseAction | studentId | - | '/portal/home' | - | chooseStudent | - | Please sign in again. | slice |
| logoutAction | - | - | '/portal?signedout=1' | - | portalLogout | - | - | yes |
| uploadAction | documentId | file | '/portal/home?uploaded=1' | '/portal/home' | - | processQueue (runAction) | Choose a file. | slice |
| submitCourierAction | shipmentId | courierCompany, trackingNumber, dispatchDate | - | '/portal/home' | - | processQueue (runAction) | Thank you. Your courier details were sent to our team. | slice |
| passwordLoginAction | - | loginId, password | '/portal/home' | - | - | - | - | slice |
| setPasswordAction | token | password, confirm | '/portal?passwordset=1' | - | - | processQueue (runAction) | - | slice |
| forgotPasswordAction | - | loginId | - | - | - | deliverPortalEmails, processQueue (runAction) | - | slice |
| markNoticesReadAction | - | - | - | '/portal/home' | - | - | - | slice |
| portalReferralAction | - | - | - | '/portal/home' | - | processQueue (runAction) | - | slice |
| publicReferralAction | code | - | - | - | - | processQueue (runAction) | Thank you! Our team will contact you soon. | slice |

