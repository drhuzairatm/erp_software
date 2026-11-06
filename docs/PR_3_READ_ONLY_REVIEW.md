# PR #3 Read-Only Review

**Date:** 5 November 2026. **Handling: keep private, out of Git.** It lists where sensitive documents sit, without their contents. It contains no credentials or server details.

**Scope:** https://github.com/drhuzairatm/erp_software/pull/3, head `7c32354`. GitHub, the PR and its settings were only read. The VPS and Production were not accessed, and no migration ran on an existing database. Tests ran in a scratch copy on a throwaway database with fictional data.

## Verdict: 3. NOT SAFE TO MERGE

**PR #3 has already been merged.** GitHub shows it merged into `main` on 5 November at 13:05 UTC (18:35 IST) as `f68e97e`, by the repository owner, with no reviews and with CI failing. **The repository is public**, so the private reports are publicly readable now. This is the urgent problem, and reviewing the PR can't undo it.

No credential or personal data was found by the checks described in section 2. The migrations look sound. The problems are the public documents, the failing CI, and what `main` would do if pulled onto the VPS.

## Blocking issues

| # | Issue | Exact location | Recommended action |
|---|---|---|---|
| **1** | **Private security and production reports are public.** They include the unresolved Trust Boundary finding and how it works, the open risk register, and the note that the server offers password login | Section 2 tables | **First, make the repository private** (your decision). Then remove the files from `main` |
| **2** | **Removing the files won't erase them.** They remain in commit `7c32354`, merge `f68e97e` and the PR's stored diff | Git history; `refs/pull/3/head` | History rewrite needs your separate approval, and GitHub Support to purge the PR's references. Assume anything already public may have been copied |
| **3** | **CI fails on the PR commit and on `main`** | Section 5 | Read the browser logs, which need a signed-in GitHub session. Fix the unstable tests, and require CI before merging |
| **4** | **`main` isn't safe to pull onto the VPS.** The new code on the 37-migration schema returned HTTP 500 on every staff page tested. GitHub shows no deployment, but the VPS was not inspected | `main`, `backend/db/migrations/0038`–`0051` | Don't pull `main` on the server. Follow `docs/PRODUCTION_MIGRATION_EXECUTION_PLAN.md`, after you approve it |
| **5** | **Nothing stops an unreviewed merge.** `main` is unprotected, and the PR had no reviews | GitHub branch settings | Protect `main` and require CI |

## 1. Git and branches

| Check | Result |
|---|---|
| Base and head | `main` and `cleanup/local-readiness`. **Correct** |
| State | **Merged**, 1 commit, 257 files, +21,096 / −182. 174 added, 83 modified, **0 deleted, 0 renamed** |
| Merge result | `f68e97e` has parents `d123404` and `7c32354`, and its tree is identical to `7c32354`. Nothing was lost in the merge, and there is no conflict left |
| `7c32354` | Parent is `3df4171`. It's the whole PR |
| `3df4171` | Ancestor of the PR commit, and its tree equals `d123404` (the merge of PR #2) |
| `f36328f` | **Not an ancestor of the PR commit** (1 commit against 9). It is an ancestor of `main` through PR #2. It differs from `3df4171` in 50 files, none in `backend/db` |
| Missing commits | None found. The PR holds all the work on its branch |
| Complete working tree? | **Yes.** Before the merge, the local tree was clean at `7c32354`, and all 51 migration checksums match the inventory |
| Unrelated changes | No application code outside the planned work. The main surprise is **documents that were meant to stay out of Git**. `.github/workflows/ci.yml` is new in this PR |
| Commit message | `new-features-added`, a single commit for 11 phases, so history can't be reviewed or undone by phase |

**Your local repository has since moved on:** at 21:15 IST `main` was pulled to `f68e97e` and `chat-enhancement` was created from it. This review did not do that.

## 2. Private information

### Files that say they must stay private, all now public

| File | What it says about itself |
|---|---|
| `docs/FINAL_ERP_SECURITY_AND_RISK_REPORT.md` | Keep private, out of Git |
| `docs/FINAL_ERP_PRODUCTION_READINESS_REPORT.md` | Keep private |
| `docs/PRODUCTION_BREAKING_CHANGE_AUDIT.md` | Keep private, out of Git |
| `docs/PRODUCTION_DEPLOYMENT_COMPATIBILITY_MATRIX.md` | Keep private, out of Git |
| `docs/PRODUCTION_PENDING_MIGRATION_INVENTORY.md` | Keep private, out of Git |
| `docs/PRODUCTION_MIGRATION_EXECUTION_PLAN.md` | Keep private, out of Git |
| `docs/STUDENT_MERGE_FIX_REPORT.md`, `docs/STUDENT_MERGE_REGRESSION_REPORT.md` | Keep private until you decide |
| `docs/audit/ERP_APP_TRUST_BOUNDARY_REVIEW.md` | "Stays uncommitted". **The most sensitive file:** it explains an unresolved High/Critical weakness |
| `docs/audit/PRIVILEGED_FUNCTIONS_SECURITY_REVIEW.md` | On the implementation report's must-stay-out list |
| `docs/audit/RISK_REGISTER.md` | Same list |
| `docs/audit/IMPLEMENTATION_ROADMAP.md` | Same list |
| `docs/audit/PRODUCTION_STATE_REPORT.md` | Same list. Says the SSH port is open and password login is offered, with no address |
| `docs/audit/stage0_production_readonly_check.sh` | Same list. Shows the server user pattern and application path, with no address or key |
| `docs/audit/LOCAL_PROJECT_READINESS_REPORT.md` | Same list |
| `docs/audit/STAGE_A_B_FUNCTION_MAP.md`, `docs/audit/STAGE_A_B_PERMISSION_PROPOSAL.md` | Same list |
| `docs/audit/proposed/` (4 files) | Same list |

### Suitable only for a private repository, by their own wording

`docs/FINAL_ERP_IMPLEMENTATION_REPORT.md`, `docs/FINAL_ERP_FEATURE_VERIFICATION_MATRIX.md`, `docs/FINAL_ERP_BROWSER_TEST_REPORT.md`.

### Already public before this PR

These 16 were on `main` before PR #3 and name security gaps or findings. They need the same decision: `docs/PHASE_B_SECURITY_REPORT.md`, `docs/SECURITY_EVIDENCE_REGISTER.md`, `docs/SECURITY_REPORT.md`, `docs/SECURITY_THREAT_ASSESSMENT.md`, and in `docs/audit/`: `BUSINESS_WORKFLOW_AUDIT.md`, `COMPLETE_ERP_AUDIT_REPORT.md`, `CONSOLIDATED_FINDINGS_REGISTER.md`, `DATABASE_AND_INFRASTRUCTURE_AUDIT.md`, `EMAIL_DELIVERY_AUDIT.md`, `PART_17_DATABASE_VERIFICATION.md`, `PRIORITIZED_IMPLEMENTATION_ROADMAP.md`, `PRODUCTION_READINESS_SCORECARD.md`, `RESEND_TO_NODEMAILER_DEPLOYMENT_READINESS.md`, `SECURITY_GAP_ANALYSIS.md`, `STAGE2_FOLDER_STRUCTURE_AUDIT.md`, `TEST_COVERAGE_REPORT.md`. I identified these by name and did not read all of them.

### Credentials and personal data

I scanned the full PR tree, and every added line in all 43 commits on all branches, with values masked in the output. This is pattern matching, so a clean result lowers the risk without proving there is none.

| Looked for | Result |
|---|---|
| Private keys, GitHub tokens, AWS keys, live payment keys, JWTs | **None** |
| Real database or mail connection strings | **None.** Only localhost, CI dummies and `<placeholder>` examples |
| Resend-style keys | 2 in `backend/tests/unit/system-mail.test.ts`. **Fictional** |
| `.env`, dumps, backups, key files | **None tracked.** `.env.example` holds `CHANGE…` placeholders |
| Public IP addresses, server hostnames, SSH commands with a target | **None.** The script's example uses `SERVER` and `KEY_PATH` |
| Personal mailboxes in files | **None.** Test accounts use `demo.test` and `example.test` |
| Phone or ID-style numbers | Fictional test values and UUID fragments |

**Smaller points to check:**
- `backend/tests/integration/document-merge.test.ts` and `docs/DOCUMENT_MERGE_FINAL_REPORT.md` use the name "Mohammed Huzair" as a sample student, which may be a real person's name. Replace it if so. They predate this PR.
- `backend/scripts/lib/defaults.ts` names the company.
- Commit metadata publicly shows the author's Gmail address.
- Some documents show the local path `/Users/drhuzair/…`.

**Earlier chat exposure:** a root password was pasted into an earlier conversation. I did not search for its value, by the standing rule. If it has not already been changed, change it. Password login should also be reconsidered, since the public reports mention it.

## 3. Migrations 0038–0051

| Check | Result |
|---|---|
| Filenames and order | **Correct:** 14 files, in sequence, no gaps |
| Rollback files | **All 14 present** |
| SQL correctness | All applied in order from a 37-migration database with fictional data, and rolled back fully (earlier audit). Fresh-database tests pass on this commit |
| Dependencies | Extracted from the SQL, none point forward. 0047 depends on 0045, and 0051 on 0046, 0048, 0049 and 0050 |
| New tables | 50, all with row-level security on. Five have no policy on purpose, which denies direct reads |
| SECURITY DEFINER functions | 168 new, all with a fixed `search_path`. 167 revoke PUBLIC in the same file |
| Exception | `set_staff_status` (0041) replaces an existing function and keeps its old PUBLIC grant. No other role has `USAGE` on the schema, so this is low risk |
| Existing Production data | No student, employee, task, payment or document row changed in the rehearsal. **Not verified on real data, or on PostgreSQL 18** |

**`docs/audit/proposed/0039_function_permissions.sql`:** **not executable as a migration.** The runner reads only `backend/db/migrations`. Nothing in the application, CI or scripts runs it; the SQL guard only mentions its rollback by name. Its header says "PROPOSED ONLY". It must not be applied: it would need separate approval, its number collides with the real 0039, and its list of functions is out of date. **Its problem is that it's public**, not that it could run.

Details and pre-run checks: `docs/PRODUCTION_PENDING_MIGRATION_INVENTORY.md`.

## 4. Application and security

**Depth:** I checked all 257 files by automated checks, and read the highest-risk code directly, but **did not read all 21,096 added lines**. Several areas also rely on earlier audits and tests.

| Area | Finding | Basis |
|---|---|---|
| Regression | Tests on this exact commit pass except as listed in section 5. Failures with the old app on the new schema were expected or intermittent | Executed |
| Weakened tests | 12 assertions removed. All are explained: policy counts, the passport decision, JSON key lists, a mail call count. None of them hid a security check. No `.skip` or `.only` added | Diff read |
| Company isolation | New tables are filtered by membership or role. Flagged functions were read and have a guard, or are used behind one. Isolation tests pass | Read and executed |
| Global reference data | `set_country_document_rule_active` and rule editing are not company-specific, so someone with that permission in one company changes them for all. **Confirm this is intended** | Read |
| Authentication | **Not redesigned.** Argon2id, MFA and session code unchanged except one test-mode line in `backend/src/lib/auth/staff-email.ts`. RLS on existing tables is unchanged | Diff read |
| Trust Boundary | **Unresolved**, by your decision. It covers more data now, and the explanation is public (issue 1) | Earlier review |
| Student merge | Moves related records, stops if payment totals would change, and needs permission in both companies | 21 tests pass |
| Payments | No ledger change. Due dates are separate | Read and tested |
| Email | Real delivery never tested. Resend fallback is now on `main`, which replaces the earlier BC-08 concern. New staff emails start once mail and scheduler run. `NOTIFICATIONS_MODE` must be checked (BC-07) | Read |
| Uploads | Type is checked from file content, 10 MB limit, signed 60-second links, private storage. **No virus scanner:** files are labelled, not blocked, and with no scanner set they open | Read |
| API and database | New code needs all 14 migrations. New routes require the new API process | Executed earlier |
| Open decisions | Ticket access by role (BC-10), self-service names (BC-11), Bulgaria rules marked verified by 0049 (BC-12 corrected) | Reports |

**The ERP is not described as fully secure.**

## 5. CI on the exact commit

| Run | Check | Result | Detail |
|---|---|---|---|
| PR event, `7c32354` | Typecheck, lint, tests, build | **Pass** | All steps passed |
| PR event, `7c32354` | Browser tests | **Fail** | `npm run test:e2e:disposable` |
| Push event, `7c32354` | Typecheck, lint, tests, build | **Fail** | `frontend/tests/integration/auth-message-queue.test.ts:117` timed out at 30 s. Build step **skipped** as a result |
| Push event, `7c32354` | Browser tests | **Fail** | Same step |
| Merge on `main`, `f68e97e` | Typecheck, lint, tests, build | **Fail** | Same test timed out. Build step **skipped** |
| Merge on `main`, `f68e97e` | Browser tests | **Fail** | Same step |

**Pending:** none. **Warnings:** Node 20 action deprecation; `ubuntu-latest` label moving to Ubuntu 26.

**What I could not see:** GitHub logs need a signed-in session, and `gh` isn't installed here. **So the browser failures in CI have no known test names.**

**Same commit on this Mac (scratch copy, throwaway database, PostgreSQL 17.11):**

| Step | Result |
|---|---|
| Typecheck, lint, SQL guard, build | Pass |
| Backend | 651 + 14 + 21, all pass |
| Frontend | 131, all pass |
| Browser, first run | **Not valid.** 159 of 175 in 2 hours, because the Mac went to sleep with the lid closed during the run |
| Browser, second run | **174 of 175** in 12 minutes. The failure is `workflow.spec.ts:8`: the page was still on `/login` after the 5-second wait in the sign-in helper |

**Likely, not proven:** the sign-in helper's 5-second wait and the 30-second N-8 test are too tight for slower machines. The same PR commit passed N-8 once and failed it once, so that test is unstable.

## Recommended order

1. Make the repository private.
2. Change the root password if it hasn't been changed, and review SSH password login.
3. Decide about removing private files and rewriting history. Treat the public period as a disclosure, and check whether anything was copied.
4. Don't pull `main` on the VPS.
5. Open the browser logs, and fix or stabilise the failing tests.
6. Protect `main`, and require CI before merging.
7. Add the private document paths to `.gitignore`, or keep them outside the repository.

**Stopped here: nothing above has been done.** This report is an uncommitted local file.
