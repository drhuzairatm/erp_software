# Stage 2 folder structure audit (read-only)

| | |
|---|---|
| Audit date | 2026-11-03 18:27 IST |
| Active workspace | `/Users/drhuzair/Documents/erp mvp`: the folder open in VS Code (VS Code workspace storage: `file:///Users/drhuzair/Documents/erp%20mvp`) |
| Project / Git root | `/Users/drhuzair/Documents/erp mvp` (`git rev-parse --show-toplevel`) |
| Branch | `refactor/express-api` (HEAD `eb8dd7d first commit`, the same commit as `main`) |
| Other checkouts | none found (searched `~/Documents`, `~/Desktop`, `~/Downloads` for this project's `package.json`) |
| Method | Read-only: directory listings, `git status`, `grep` of source files, existing test logs. No tests, builds or database access. |

## 1. Verdict

**DOES NOT MATCH** the requested layout. The workspace and branch are correct; this is not a wrong checkout.

- The four requested folders `backend/src/routes`, `backend/src/controllers`, `backend/src/services` and `backend/src/repositories` **do not exist**.
- The alternative layout reported after Stage 2 **does exist**: `backend/src/api/routes`, `backend/src/api/controllers`, `backend/src/server/services` and `backend/src/server/repositories`.
- The Repository Pattern **is implemented in code** for the read-only file and photo functions (section 4), in the alternative layout.
- **All Stage 1 and Stage 2 work is uncommitted.** HEAD (`eb8dd7d`) and `main`, including GitHub, still show the old structure. The new folders exist only in the working tree, as untracked files (`??`).

**Probable reason VS Code "still shows the old structure"** (an inference, not verified):
- The requested folders were never created; the new code sits one level deeper, under `backend/src/api/…` and `backend/src/server/…`.
- Nothing has been committed, so any view of the Git history, of `main` or of GitHub shows the old tree.

## 2. Working tree summary (`git status --short`: 42 entries)

- **Modified (26):**
  - root and config: `.env.example` (placeholders only), `.gitignore`, `README.md`, `eslint.config.mjs`, `package.json`, `package-lock.json`, `backend/package.json`, `backend/vitest.config.ts`, `frontend/tsconfig.json`, `frontend/vitest.config.ts`
  - backend code: `backend/src/server/auth/session.ts`, `auth/trusted-device.ts`, `portal.ts`, `scope.ts`, `services/documents.ts`, `services/photos.ts`, `services/staff-photos.ts`
  - backend tests: `backend/tests/support/test-env.ts`
  - Next.js route handlers (7): `frontend/src/app/api/health/route.ts`, `api/files/[id]/route.ts`, `api/files/[id]/content/route.ts`, `api/storage/local/route.ts`, `api/students/[id]/photo/route.ts`, `api/students/[id]/photo/download/route.ts`, `api/staff/[id]/photo/route.ts`
  - frontend tests: `frontend/tests/integration/audit-remediation.test.ts`
- **Untracked (16), including:**
  - `backend/src/api/`, `backend/src/server/http/`, `backend/src/server/repositories/`, `backend/src/server/services/files.ts`
  - `backend/scripts/build-api.mjs`, `backend/tests/api/`, three `backend/tests/unit/*.test.ts`
  - `frontend/src/server-api/`, five frontend test entries, `docs/API_CONTRACT_INVENTORY.md`
- **Committed changes for Stage 1/2:** none.
- **Database, migrations, seed, logos:** no entries under `backend/db`, the seed scripts or `frontend/public`.

## 3. Actual `backend/src/` tree (relevant parts)

```
backend/src/
├── api/                          (untracked, new)  Express API
│   ├── app.ts                    createApp: gate → request context → healthRouter → filesRouter → 404 → errors
│   ├── server.ts, start.ts, config.ts, replay-cache.ts, send.ts
│   ├── middleware/               internal-gate.ts, request-context.ts, errors.ts
│   ├── routes/                   files.ts, health.ts
│   └── controllers/              files.ts
├── lib/                          (unchanged)
└── server/
    ├── http/                     (untracked, new)  request-context.ts, context-provider.ts, internal-credential.ts
    ├── repositories/             (untracked, new)  files.ts, photos.ts
    ├── services/                 (existing; 29 files) incl. documents.ts*, photos.ts*, staff-photos.ts*, files.ts (new)
    ├── auth/, config/, notifications/, security/, storage/
    └── db.ts, errors.ts, portal.ts*, scope.ts*, …
(* = modified)

MISSING (requested): backend/src/routes/  backend/src/controllers/  backend/src/services/  backend/src/repositories/
```

## 4. Requested vs actual layout

| Responsibility | Requested path | Actual path | Present? |
|---|---|---|---|
| Express app / entry | `backend/src/app.ts`, `backend/src/server.ts` | `backend/src/api/app.ts`, `backend/src/api/server.ts` | different path |
| Routes | `backend/src/routes/files.routes.ts` | `backend/src/api/routes/files.ts` | different path and name |
| Controllers | `backend/src/controllers/files.controller.ts` | `backend/src/api/controllers/files.ts` | different path and name |
| Services | `backend/src/services/files.service.ts` | `backend/src/server/services/{documents,photos,staff-photos,files}.ts` | different path; the rules stay in the existing service files |
| Repositories | `backend/src/repositories/{files,photos}.repository.ts` | `backend/src/server/repositories/{files,photos}.ts` | different path and name |

The Stage 2 report said the layout was adapted ("services stay in `backend/src/server/services/` (D7)"). That matches the disk. However, the requested layout was never created.

## 5. Flow evidence (from code)

### File request: `GET /api/files/:id/content`
1. **Next.js route** `frontend/src/app/api/files/[id]/content/route.ts:11`: `return proxyToApi(req, \`/api/files/${apiPathSegment(id)}/content\`)`. No service import remains.
2. **BFF and signing (Stage 1 mechanism)**:
   - `frontend/src/server-api/proxy.ts:26` calls `forwardToApi(...)`.
   - `frontend/src/server-api/forward.ts:106` sets `headers.set(INTERNAL_HEADER, signRequest(secret, parts, contextFrom(r.incoming), body))`.
3. **Express gate** `backend/src/api/middleware/internal-gate.ts`: `verifyCredential` (line 60), one-time nonce `replay.reserve` (63), body digest check `digestsEqual` (88). Mounted first in `backend/src/api/app.ts:35`.
4. **Route** `backend/src/api/routes/files.ts:10`: `r.get('/api/files/:id/content', fileContentHandler)`.
5. **Controller** `backend/src/api/controllers/files.ts:39-45`: `getActiveSession()`, then `fileContent(ctx, id(req))`, then sets the headers. It imports no database or storage module.
6. **Service** `backend/src/server/services/documents.ts:198-202`: UUID check (business rule), then `run(ctx, (tx) => filesRepo.authorizeFileAccess(tx, fileId))`, then reads the bytes from storage. `run` (`services/base.ts:8`) wraps `withUser` (transaction, user and IP settings) and error mapping.
7. **Repository** `backend/src/server/repositories/files.ts:11-12`: `` tx`select * from app.authorize_file_access(${fileId})` ``.
8. **Database**: `app.authorize_file_access` performs authorization, the quarantine check and audit (migration `0034_audit_remediation.sql`, unchanged).

### Photo request: `GET /api/students/:id/photo`
1. **Next.js route** `frontend/src/app/api/students/[id]/photo/route.ts:11`: `proxyToApi(req, \`/api/students/${apiPathSegment(id)}/photo\`)`.
2. **Route** `backend/src/api/routes/files.ts:12`, then **controller** `controllers/files.ts:48-55` (the `size` parameter, then `studentPhotoBytes`).
3. **Service** `backend/src/server/services/photos.ts:102-106`: UUID check, then `run(ctx, (tx) => photosRepo.studentPhotoFile(tx, studentId, variant))`.
4. **Repository** `backend/src/server/repositories/photos.ts:10-11`: `` select * from app.student_photo_file(${studentId}, ${variant}) ``.

### SQL placement
- **Repositories:** 8 read queries in total; `files.ts` has 2 and `photos.ts` has 6.
- **Migrated read functions** (`fileContent`, `openFile`, `studentPhotoBytes`, `studentPhotoDownloadUrl`, `currentPhoto`, `staffPhotoBytes`, `staffPhotoVersions`): they call repositories and contain no SQL.
- **SQL still in services:** `documents.ts` still has 23 SQL lines, and `photos.ts` and `staff-photos.ts` 3 each. These belong to functions outside Stage 2 (uploads, saves, removals, checklists), which this slice did not cover by design.
- **Repository restrictions:** repositories open no transactions and do not set `app.*` settings. The guard test `backend/tests/unit/repository-guards.test.ts` checks this.

### Not migrated (still calling services directly from Next.js)
- `frontend/src/app/api/attestation-files/[id]/route.ts` and `frontend/src/app/portal/files/[id]/route.ts`: deferred to the attestation and portal slices.
- 7 page imports of `services/photos` / `services/staff-photos` under `frontend/src/app/(app)`: these run in-process; their SQL is in the repositories.

## 6. Is the Repository Pattern present? (separate from folder layout)

**Yes, for the Stage 2 read-only file and photo functions.** Each layer has the responsibility described in the code:
- **Routes:** map paths to handlers.
- **Controllers:** HTTP only (session lookup, input parsing, headers).
- **Services:** business rules and transactions.
- **Repositories:** SQL only.

It is **not** applied to the rest of the codebase yet; per the plan, that happens one module per slice.

## 7. Evidence about preserved behaviour (what can and cannot be claimed)

- **Recorded in this workspace (not re-run in this audit):**
  - `.data/stage2/char-4.log`: the contract tests passed 19/19 against the original route handlers before the change.
  - `.data/stage2/test-full-2.log` and `test-full-3.log`: two full runs, each 374 + 2 + 115 passed, after the change. These include `frontend/tests/integration/contract-files-photos.test.ts` and `backend/tests/api/files.test.ts`.
- **Code inspection:** the service diffs replace only the query lines with repository calls; the SQL text in the repositories matches the removed lines.
- **Not verified in this audit:** the tests were not re-run (forbidden by the audit rules), so the results above are as recorded in those logs. Browser tests and a production `next start` were never run for Stage 2.

## 8. Mismatches between the previous Stage 2 report and the workspace

- **Layout:** none. The report described the `api/` / `server/` layout, which is what exists on disk. It did not create, and did not claim to create, the requested top-level layout.
- **Gap:** the report did not stress that the requested folders are absent and that nothing is committed. Both are confirmed here.

## 9. Remaining action to match the requested layout (not done; needs your approval)

Two options:

**A. Move the code to the requested folders.** Move or rename, without changing behaviour:
- `backend/src/api/routes/files.ts` to `backend/src/routes/files.routes.ts`
- `backend/src/api/controllers/files.ts` to `backend/src/controllers/files.controller.ts`
- `backend/src/server/repositories/{files,photos}.ts` to `backend/src/repositories/{files,photos}.repository.ts`
- either move `backend/src/server/services/` to `backend/src/services/`, which affects about 29 service files and every `@/server/services/...` import (this conflicts with approved decision D7), or create a `backend/src/services/files.service.ts` facade that re-exports the existing service functions

Then update the imports in `app.ts`, the services and the guard tests, and re-run typecheck, lint, both test suites and the build.

**B. Keep the current layout** and record it as the accepted equivalent: `api/routes`, `api/controllers`, `server/services` (D7), `server/repositories`.

Separately, commit Stage 1 and Stage 2 on `refactor/express-api` once approved, so the new structure appears in Git history and on GitHub.
