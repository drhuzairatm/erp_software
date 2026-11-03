# Complete ERP audit report: Dr.Expert Edulinks + GRADUATER

**Date:** 2 November 2026.

**Type:** read-only audit. Nothing was implemented, migrated, committed, pushed or deployed during it.
- Not touched: Leadist/CRM, real student data, hosting and DNS.
- Database queries ran on a read-only connection; a test write was refused (SQLSTATE 25006).
- Only these 8 files under `docs/audit/` were created.

| Document | Content |
|---|---|
| CONSOLIDATED_FINDINGS_REGISTER.md | Every finding, with severity, evidence and fix |
| SECURITY_GAP_ANALYSIS.md | ASVS-oriented security review |
| BUSINESS_WORKFLOW_AUDIT.md | Modules A–M |
| DATABASE_AND_INFRASTRUCTURE_AUDIT.md | Schema, integrity, infrastructure, manual configuration |
| TEST_COVERAGE_REPORT.md | Today's runs, failures, gaps |
| PRODUCTION_READINESS_SCORECARD.md | 16 areas, evidence-based status |
| PRIORITIZED_IMPLEMENTATION_ROADMAP.md | Proposed phases (none started) |

Existing documents were **referenced, not changed**:
- security: SECURITY_THREAT_ASSESSMENT.md, SECURITY_REPORT.md, SECURITY_EVIDENCE_REGISTER.md
- operations: DEPLOYMENT.md, LIMITATIONS_AND_ROADMAP.md, PILOT_READINESS_CHECKLIST.md, UAT_CHECKLIST.md, BACKUP_RESTORE_DRILL.md

## 1. Preserved state (Part 1)

| Item | Value |
|---|---|
| Branch | `main`; **no Git remote** (N-6); no stashes |
| HEAD | `8038ec94af2a01a7172a089e9e4e409b0bcedad7` ("N-7: secure encrypted queue…"); 26 commits |
| N-1 | **Committed** in `7569feb`, not uncommitted as the brief assumed. Files: migration 0035 and its rollback, `src/server/auth/trusted-device.ts`, `src/server/auth/staff-email.ts`, session, password, portal and cron changes, their tests and docs. |
| N-7 | **Committed** in `8038ec9` (migration 0036, `src/server/notifications/portal-email.ts`, tests and docs). It is no longer pending. Independent re-verification is in the register (§7). |
| **N-8 (uncommitted, in progress)** | **Not in the brief.** It is the third approved remediation: encrypted queue for portal sign-in codes and email-verification links. It was paused for this audit, and not a line of it was changed during the audit. Its migration **0037 is applied to the development database**. |
| Uncommitted files | 19 modified + 14 untracked = 33 entries. |
| Modified (N-8) | `src/app/(app)/admin/notifications/page.tsx`, `src/app/(app)/notifications/message-table.tsx`, `src/app/actions/passport.ts`, `src/app/api/cron/daily/route.ts`, `src/app/api/cron/notifications/route.ts`, `src/app/portal/actions.ts`, `src/server/portal.ts`, `src/server/services/notifications.ts`, `src/server/services/passport.ts`, `tests/e2e/{courier,helpers,phase-2-passport-contacts,phase-i}.spec/ts`, `tests/integration/{phase-2-passport-contacts,phase-i}.test.ts`, `docs/{DEPLOYMENT,NOTIFICATIONS,PASSPORT_AND_CONTACTS,STUDENT_PORTAL_V2}.md` |
| Untracked (N-8) | `db/migrations/0037_auth_message_queue.sql`, `db/rollbacks/0037_auth_message_queue.down.sql`, `src/instrumentation.ts`, `src/server/auth/auth-message-crypto.ts`, `src/server/config/`, `src/server/notifications/{auth-message,test-mailbox}.ts`, `tests/e2e/n8-auth-messages.spec.ts`, `tests/integration/auth-message-{db-security,queue}.test.ts`, `tests/unit/notifications-config.test.ts` |
| Untracked (not N-8) | The two official logo files `public/public:brands:{edx,grd}-logo.png`: not touched. |
| Created by this audit | `docs/audit/` (8 files) only. Plus run logs in the git-ignored `.data/` folder (`check-audit.log`, `vitest-order.log`, `build-audit.log`, `start-guard-*.log`). |

The production build ran during the audit; it rewrites the generated, git-ignored `.next/` folder. Production startup was verified on port 3100; only `/api/health` was requested, and the server was stopped.

## 2. Earlier findings (Part 2)

Full detail is in CONSOLIDATED_FINDINGS_REGISTER.md. Each status was checked again today in code or the database, not taken from documents.

| ID | Original finding | Status today | Tested | Action |
|---|---|---|---|---|
| L-1 | Cron secret: ordinary string comparison | **Still present** [SRC] | n/a | Constant-time compare (Phase 1) |
| L-2 | Undocumented `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | **Still present** [SRC] | n/a | Document or remove |
| L-3 | CSP `style-src 'unsafe-inline'`, `'wasm-unsafe-eval'` | Present, **accepted** [SRC] | n/a | Keep under review |
| L-4 | Lock-out race; no test | **Fixed by N-1** | **Yes**: 20 parallel attempts → exactly 5 checked [RUN] | none |
| L-5 | Browser tests write non-demo records to development | **Still present**: 318 of 367 students, 14 "Testland" countries [DB] | n/a | Separate test database for browser tests |
| N-1 | Reset requests locked accounts; uncapped resets | **Fixed**, `7569feb` | **Yes** [RUN today + PRIOR] | Gaps: real email; MFA in the browser |
| N-2 | Attestation evidence has no scan status | **Still present** [DB] | n/a | Phase 1 |
| N-3 | Security alerts cross companies | **Still present** [DB] | n/a | Phase 1 |
| N-4 | `schema_migrations` without RLS | **Still present**, contained locally [DB] | n/a | Before Supabase-style hosting |
| N-5 | `app.user_id` trust boundary | By design; no injection found [SRC] | n/a | Keep the code-review rule |
| N-6 | No off-machine code copy | **Still present** [RUN]; re-rated MEDIUM | n/a | Private repository (Phase 0) |
| N-7 | Portal links readable by staff | **Fixed**, `8038ec9` | **Yes**: queue and exact-rollback tests passed today. Its policy assertion is outdated by N-8. | Update the test with N-8 |
| N-8 | Sign-in codes and verification links readable by staff (HIGH) | **Fix in the working tree, uncommitted**, applied to development | **Partially**: the N-8 tests pass, but the full suite does not (A-01) | Phase 0 |

## 3. Main results

**No CRITICAL finding.** These HIGH items block go-live:
- **A-01**: the test suite is not green: 1 outdated assertion and 3 intermittent `phase-h` failures with an undetermined cause. Until resolved, a regression in ordinary notifications cannot be ruled out, so **N-8 must not be committed yet**.
- **A-07**: no virus scanner (external dependency).
- **A-09**: no staging or production; providers untested with real accounts (external dependency).

New findings from this audit:
- **A-02**: the startup guard fails closed with HTTP 500 instead of exiting.
- **A-04**: single-use tokens appear in request-log URLs.
- **A-03**: 173 definer functions executable by PUBLIC.
- **A-08**: no monitoring or CI.
- **A-10**: Chrome-only testing.
- **A-11**: foreign-key indexes.
- **A-13**: stale documentation.
- **A-18**: student merge has no test.
- **Missing features F-01 to F-09:**
  - F-01: portal questions and tickets
  - F-02: parent portal
  - F-03: portal visa status
  - F-04: staff notification centre
  - F-05: reminders
  - F-06: front/back scans
  - F-07: instalment plans
  - F-08: invitation emails not queued
  - F-09: ranked primary, secondary and tertiary preferences

**Verified strengths** (on fictional data, with tests that passed today):
- company isolation and IDOR protection
- role and permission enforcement in the database (no self-escalation; a single protected MD)
- CEO without amounts
- admissions scenarios A–L, including MBBS, Nursing and postgraduate, advisory (never blocking) academic rules, and no invented Egypt requirements
- document lifecycle and attestation
- courier only after approval
- multi-currency finance with second-person verification
- secret handling for staff resets (N-1) and portal links (N-7)

## 4. Test evidence (Part 8, summary)

| Run | Result |
|---|---|
| Typecheck | passed |
| Lint | 0 errors, 1 warning |
| Unit + integration, run 1 (inside `npm run check`) | 359/363 |
| Unit + integration, run 2 (verbose) | 362/363 |
| Build | passed |
| Startup guard | verified, with the A-02 caveat |
| `npm audit` | 0 critical, 0 high, 15 moderate (development tooling) |

**Browser tests were not re-run today**, because they write into the development database. Last result: 57/57 on 1 Nov, current source.

## 5. What was not done, and why

| Item | Reason |
|---|---|
| Browser tests (re-run) | They would add records to the development database (L-5) |
| Safari, Firefox, Edge, real phones | Would need downloading browsers or a device; not approved |
| Real email, WhatsApp, S3, scanner | Not configured; external services |
| Dynamic security scan, load test, EICAR | Need a staging environment and your approval |
| Dashboard reconciliation against development data | Would mean reading record contents |
| Duplicate scan of existing records | Would mean reading record contents |
| Root cause of the `phase-h` failures | Diagnosing further means changing tests or code; that belongs to Phase 0, after your approval |

**STOPPED.** Awaiting your review and approval before any fix is implemented.
