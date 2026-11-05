# Feature regression baseline

**Date:** 4 November 2026
**Replaces:** `FEATURE_PARITY_MATRIX.md`, which compared the system with a migration target that was withdrawn.
**Purpose:** what must keep working while the ERP is completed. Each phase in `IMPLEMENTATION_ROADMAP.md` re-runs the suites for anything it touches, then the whole set.

**Code:** `3df4171`. All rows are Verified in Local Source; suites matched by name. **The full set passed locally on this commit on 4 Nov** (405, 2, 129 and 130 tests), on PostgreSQL 17 with no real mail, scanner or S3 service. Nothing here is verified on production.

## 1. Working areas

| Area | Pages | Actions | Service | Suites | Must keep working |
|---|---|---|---|---|---|
| Reports | 2 | Route | `reports`, `analytics` | `services`, `boundary` | Export permissions; finance and PII exports separate |
| Master data | Admin | 5 | `master-data` | `master-data` | Request and approval, history, name at selection |
| Universities | 2 | 4 | `universities` | `services`, phase suites | Campuses, intakes, activation |
| Leads | 4 | 7 | `leads` | `phase-9-leads` | Central queue, duplicates flagged not merged, conversion through registration |
| Tasks | 3 | 3 | `tasks` | `services`, `scenarios-a-l` | Assignment, events, passport-created tasks |
| Students | 6 plus tabs | 12 | `students` | `contract-students`, `phase-2-*`, `scenarios-a-l` | Duplicate checks, stage gates, masking, merge |
| Import | 1 | 2 | `student-import` | `import`, `csv-import` | Row errors, permissions, template |
| Documents, verification | Within students | 7 + 6 | `documents`, `verification-rules` | `files`, `contract-files-photos`, `phase-b`, `security-phase-b` | Second-person approval, quarantine, 60-second links |
| Merge PDF | Within students | 1 | `merge` | `document-merge` | Allowed files only, file name rule, logging |
| Academic, One and Same | Students, admin | 14 | `academic` | `phase-3-academic` | Rule and template approval |
| Advisory requirements | Admin | 3 | `requirements` | `phase-3b-advisory`, `phase-4-rule-engine` | **Never blocking**, versions, acknowledgement |
| Attestation | Admin, students | 13 | `attestation` | `phase-1-attestation` | Route approval, exceptions |
| Passport, contacts | Admin, students | 7 | `passport` | `phase-2-passport-contacts` | Version history, reminders |
| Courier | Admin, portal | 5 | `courier` | `courier` | Release gates, custody |
| Payments, receipts | 2 | 5 | `payments` | `multi-currency`, `security-matrix` | Second-person verify, reversals only, historic rates, exact money |
| Notifications | 1 | 5 | `notifications` | `notifications-config` | Consent, outbox, config guard |
| Staff, roles, settings | Admin | 20 + 2 | `admin`, `security`, `staff-photos` | `staff-accounts`, `staff-profiles-roles`, `security-matrix` | No self-escalation, protected MD, role deactivation guard |
| Audit | 1 | 0 | Direct | `audit-remediation` | Read only |
| Dashboard | 1 | 1 | `dashboard`, `analytics`, `attention` | `services` | Consolidated permission |
| Staff sign-in, account | 7 | 11 | `lib/auth` | `mfa`, `auth-*`, `client-ip-lockout`, `n1-lockout` | Lockouts, MFA, trusted devices |
| Student portal | 5 + referral, verify | 12 + 4 | `portal`, `portal-accounts` | `phase-6-portal`, `portal-*`, `auth-message-*` | Separate sessions, isolation, logged downloads |
| Jobs | n/a | 2 routes | `notifications`, `lib/security/jobs` | `contract-route-handlers` | `CRON_SECRET`, 404 when unauthorised |
| Files, photos (internal API) | n/a | Route handlers | `files`, `photos` | `contract-files-photos`, `bff-boundary`, `files` | Signed links, authorization, scan state |

## 2. Cross-cutting behaviour

| # | Behaviour | Where | Check |
|---|---|---|---|
| 1 | Company isolation | RLS | `db-isolation`, `isolation` |
| 2 | Permissions | Page, action, database | `security-matrix` |
| 3 | Masked student columns | Grants | Existing tests |
| 4 | Audit actor and IP | `set_config`, triggers | `audit-remediation` |
| 5 | Sessions and sign out everywhere | `session.ts` | `staff-accounts` |
| 6 | MFA before data | `requireUser` | `mfa`, browser specs |
| 7 | Upload limits, type by content | Services | `files` |
| 8 | CSP and headers | `proxy.ts`, `next.config.ts` | Existing and manual check |
| 9 | Timezone and exact money | `db.ts` | `multi-currency` |
| 10 | Mobile layouts | `responsive.spec.ts` | 73 routes at 320–1440 px; real phones not yet tested |
| 11 | Camera and PDF viewing | `photo-capture`, viewer | Browser specs |
| 12 | Secure outbox | `0035`–`0037` | Queue suites |

## 3. Approved decisions to carry through

| Decision | Status in code |
|---|---|
| Registration always allowed, regardless of expiry | Allowed in form, import and database; no test specifically for expired or missing |
| Warnings and renewal reminders | Warnings after saving; staff tasks only |
| University Application: warning only by default, including missing expiry | **Global block still active.** Change is in Phase 0B, not approved. `phase-3-academic.test.ts` asserts the old block and changes with it |
| Only official university or programme rules may block | Scoping exists; source and approval fields don't |
| Bulgaria 60% configurable by university and programme | Form fields exist; current notice applies to all courses |
| Unverified rules need official sources and MD approval | Not started |
| Face matching and liveness deferred | Not built; retained for later |

## 4. Sign-off per phase

- [ ] Suites for touched areas and the full set pass
- [ ] No test weakened or skipped without approval
- [ ] New tables have RLS, audit and refusal tests
- [ ] Rollback rehearsed on staging
- [ ] Mobile checks pass
- [ ] MD or delegate acceptance signed
