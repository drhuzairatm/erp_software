# Risk register

**Date:** 4 November 2026
**Replaces:** `MIGRATION_RISK_REGISTER.md`. All framework and TypeORM migration risks are withdrawn with that plan.
**Scale:** likelihood (L) and impact (I) are judgement calls: Low, Medium, High.

## Open now

| ID | Risk | L | I | Mitigation | Evidence | Owner action |
|---|---|---|---|---|---|---|
| R-01 | Old root password was pasted into chat | Low | Medium | **Changed by the MD, 4 Nov** (reported). Key-based login remains a later decision | Reported but Not Verified | None now |
| R-02 | **Production state is unknown:** commit, migrations, env | High | High | Local work only for now; assess before any deployment | Paused by MD | Decide before deploying |
| R-03 | **No proven backup**, with a possible PG 18 and pg_dump 17 mismatch | Medium | **Critical** | Matching tools, off-site copy, restore test on an isolated system | Blocked; tool expectation Verified in Local Source | Phase 0B, not approved |
| R-04 | **`main` contains email defects, fixed only on uncommitted branch `cleanup/local-readiness`**, so pulling `main` can stop or misdirect email | High | High | Do not pull `main` until the fixes are approved and merged | Verified in Local Source and on GitHub | Phase 0B, not approved |
| R-05 | **Scheduled jobs may not run on the VPS,** affecting queued mail and passport monitoring | Medium | High | Inspect; add a real scheduler | Repo has only `vercel.json`; server Blocked | Phase 0B, not approved |
| R-06 | **CI not yet active; no staging** | High | High | Workflow written on the clean-up branch; activates once committed and pushed. Staging still needed | Staging not assessed | Commit approval |
| R-07 | **Password login for root on a public server** | Medium | High | Move to keys, separately approved | Password login offered: Verified on Production. Root use: Reported but Not Verified | Phase 0B, not approved |
| R-09 | **Stage 0 can't fully complete with non-root, non-superuser access:** migrations list, queues, scan counts and root crontab stay hidden | High | Medium | Report as blocked; MD may approve a read-only monitoring role separately | Verified in Local Source and by trial on the local database | MD decision after 0A |
| R-08 | **173 SECURITY DEFINER functions are executable by PUBLIC.** No other role can reach them today (no `USAGE` on `app`), but a future role would | Low | High | Staged fix in `PRIVILEGED_FUNCTIONS_SECURITY_REVIEW.md` | Verified in Local Development Database; production not inspected | MD decision on stages A and B |
| R-08A | **Anyone with SQL as `erp_app` can impersonate any user, cross companies, create sessions and forge audit entries**, shown on a throwaway database. Stages A and B don't change this | Low to Medium, not assessed on the server | **Critical** | **Unresolved. Remediation postponed by MD decision, 4 Nov 2026, to the Security Hardening phase after Phase 11.** In place today: the SQL guard in CI (limits in `docs/SQL_SECURITY_GUARD.md`). Not in place: server hardening and verified identity. See `ERP_APP_TRUST_BOUNDARY_REVIEW.md` | Verified on disposable database; server not inspected | Security Hardening phase |
| R-60 | **GitHub reports the repository as public** (4 Nov, after the MD reported making it private). Security documents and server details are committed there, and may already have been copied | High | High | MD to confirm the setting. Move or revise the committed documents, separately approved | Verified by anonymous GitHub API and page requests | MD action |

## Protecting what already works

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-10 | **Change breaks a working feature** | Medium | High | Full regression per phase; `FEATURE_REGRESSION_BASELINE.md`; no test weakened without approval |
| R-11 | **New table lacks RLS or a correct policy**, exposing another company's data | Medium | **Critical** | Automated test failing on any public table without RLS; refusal tests per module |
| R-12 | **Schema change damages records** | Low | **Critical** | Additive only, backup first, staging first, counts checked |
| R-13 | **Rollback untested;** only 22 of 38 migrations have rollback files | Medium | High | Every new migration has a rehearsed rollback |
| R-14 | **Duplicate modules or logic**, such as a second notification system | Medium | Medium | Reuse table in `ARCHITECTURE_ASSESSMENT.md`; review each plan against it |
| R-15 | **Task change affects passport tasks, reports and analytics** | Medium | High | Compatibility mapping; existing scenario tests stay green |
| R-16 | **Internal Express API not running or misconfigured** in production, breaking files and photos | Medium | High | Check in Phase 0; health check |

## New module risks

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-20 | **Attendance:** selfie and location are sensitive personal data | High | High | Consent, retention period and access limits approved before launch; legal review |
| R-21 | **Attendance:** GPS or camera can be spoofed | Medium | Medium | Combine QR, IP and review; never rely on one signal |
| R-22 | **Attendance:** IP checks are worthless if `TRUST_PROXY` is wrong | Medium | High | Verify on production, tested on staging |
| R-23 | **Attendance:** wrong automatic result harms staff | Medium | High | Failures go to Manual Review, never automatic rejection |
| R-24 | **Face matching forgotten, or added without review** | Medium | Medium | Kept in the roadmap as deferred; separate approval |
| R-25 | **Chat:** private messages become readable by administrators | Medium | High | Membership-only RLS from the start; governed access only |
| R-26 | **Chat:** long-lived connections exhaust the pool or are cut by Nginx | Medium | Medium | Single listener, heartbeat, load test on staging; polling remains the fallback |
| R-27 | **Core meetings:** privileged roles can read private minutes | Medium | High | Membership RLS; explicit MD decision on System Admin |
| R-28 | **Shared file service misconfigured**, bypassing scanning or exposing files | Medium | High | Same checks as student files; tests for each file type |
| R-29 | **Files unscanned** without a scanner on production | High | High | Install ClamAV in Phase 0 or 1; keep manual clearance |
| R-30 | **Pre-admission data kept too long** for people who never register | Medium | Medium | Retention period set by MD |
| R-31 | **Reminder duplicates or floods** | Medium | Medium | Sent-log, one send per stage, tested |
| R-32 | **Portal ticket leak** between students or of internal notes | Low | High | Portal isolation tests |
| R-33 | **Money errors in finance changes** | Low | High | Exact numeric handling, reversals retained, historic rates untouched |

## Business rules

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-40 | **Unverified rule treated as verified** | Medium | High | Official source and MD approval recorded; label kept |
| R-41 | **The global 12-month passport block remains in any database without migration 0038.** The local development database has it (applied 4 Nov). Production was not inspected | High | High | Code and 0038 are on the clean-up branch, uncommitted; applying 0038 elsewhere needs separate approval |
| R-43 | **A university block is added without an official source** | Medium | High | Source and approval fields required, Phase 9 |
| R-42 | **Demo rules on production** marked approved | Low | High | Count in Phase 0; remove only with approval |

## Delivery

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-50 | **Estimates overrun:** 29–43 person-weeks is low confidence | High | Medium | Re-estimate after each phase |
| R-51 | **Scope grows** across ten modules | High | Medium | Approve one phase at a time |
| R-52 | **Earlier documents mislead** (Vite plan, old roadmap) | Low | Low | **Done:** superseded notices added |

## Withdrawn

Risks about Vite, React Router, public Express exposure, TypeORM schema tooling, `save()` under RLS, two database drivers, side-by-side frontends and removal of Next.js no longer apply.

## Top six to watch

1. **R-02:** what production is running is unassessed.
2. **R-03:** no proven backup.
3. **R-08A:** `erp_app` can impersonate any user.
4. **R-04:** email defects already on `main`.
5. **R-11:** RLS on every new table.
6. **R-20:** privacy of attendance data.
