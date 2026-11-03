# Test coverage report

**Date:** 2 November 2026. Nothing was deleted, weakened or changed in the tests during this audit.

## 1. What ran today [RUN]

All unit and integration tests use a **throwaway** PostgreSQL started for the run:
- data folder `.data/pg-test`, port 54339
- fictional seed, separate file storage `.data/storage-test`

Confirmed in `vitest.config.ts` and `tests/support/global-setup.ts`. The development database is not touched.

| Command | Result |
|---|---|
| `tsc --noEmit` | **Passed** |
| `eslint .` | **Passed**: 0 errors, 1 warning (unused parameter `label` in `tests/integration/auth-message-queue.test.ts:114`, an N-8 working-tree file) |
| `vitest run` inside `npm run check` | **Failed: 359 passed, 4 failed** of 363, in 41 files |
| `vitest run --reporter=verbose` (re-run) | **Failed: 362 passed, 1 failed** of 363 |
| `vitest run` of `portal-link-db-security` + `phase-h` only | 18 passed, 1 failed (the policy-text test) |
| `next build` (run separately, because the check stops after failing tests) | **Passed** |
| Production start guard (`next start`, port 3100) | Disallowed modes → HTTP 500 with "Refusing to start" in the log; `live` → `/api/health` 200 (A-02) |
| `npm audit` | 0 critical, 0 high, 15 moderate (development tooling) |

**Failures (A-01):**
1. `portal-link-db-security.test.ts`: "messages_select hides the two kinds from every branch". **Deterministic.** The test still expects the N-7 policy text, which N-8 (0037) deliberately extended to four kinds. **This is a test to update, not a security failure:** the received policy hides more, not less.
2. `phase-h.test.ts` (3 tests: retry after a temporary failure; test-mode allow-list; retry once consent exists). **Intermittent and order-dependent.** They failed in 2 of 4 full runs since the N-8 changes, when `phase-h` ran second. They passed alone, in the pair run, and when the file ran 28th. **Root cause not determined.** They passed at the N-7 commit (336/336 on 1 Nov). **This blocks the N-8 commit.**

## 2. Browser tests [PRIOR]

**Not re-run today**, because they create records in the development database (L-5), which this read-only audit must not alter.

Last run: **1 Nov 2026**, current source (only documentation changed since), development server started with `NOTIFICATIONS_TEST_MAILBOX=1`. Result: **57 passed, 0 failed, 0 skipped** (26 spec files, desktop Chrome only; log `.data/e2e-n8.log`).

`courier.spec.ts` contains 2 *conditional* skips (no suitable demo student, or no delivery address). Neither applied in that run.

## 3. Inventory

| Type | Files | Tests | Notes |
|---|---|---|---|
| Unit | 5 | (part of 363) | client IP, CSV import, helpers, MFA, notification configuration |
| Integration (service, database, security) | 36 | (part of 363) | Includes database-security tests (privileges, `search_path`, exact rollbacks) for N-1, N-7 and N-8, the company-isolation matrix, and scenarios A–L |
| Browser (Playwright) | 26 specs | 57 | Chrome only; phone sizes emulated by viewport |
| API tests | covered inside integration (cron route, file routes via services) | | |
| Load, penetration, accessibility | 0 | 0 | |

## 4. Tests that depend on external services

**None.** Email is replaced by a stub. WhatsApp uses the real request code with a stubbed network (`vi.stubGlobal('fetch')`). Storage uses the local driver. No scanner is used.

So the following are **covered only by stubs**: real email delivery, Gallabox acceptance, S3, scanner verdicts, cron on a host, `TRUST_PROXY` (A-15).

## 5. Missing or weak tests

| Gap | Why it matters | Ref |
|---|---|---|
| Student merge (`app.merge_students`) has no test | Destructive operation that moves data between records | A-18 |
| Browsers other than Chrome; real phones | iPhone Safari is common among students and parents | A-10 |
| MFA in the browser | Development disables enforcement | — |
| CSRF Origin check on `POST /api/students/[id]/merge` | Only Server Actions have framework protection | Security gap analysis |
| Security alerts per company | N-3 would not be caught | N-3 |
| Dashboard counts against a known dataset on staging | Counters were not reconciled today | A-17 |
| Task audit trail assertions | The triggers exist, but no test asserts task history entries | Business workflow audit §K |
| Tests that do not verify business behaviour | None found that are purely superficial. Several browser tests verify UI text plus database state together. The 2 conditional courier skips can hide a missing fixture on a reset database. | — |
| Order dependence | `phase-h` shows that the suite is not fully independent of file order | A-01 |
