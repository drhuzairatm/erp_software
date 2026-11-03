# Prioritised implementation roadmap (proposal: nothing here has been started)

**Date:** 2 November 2026.

Each phase needs your explicit approval before it starts, as before. Each change that touches the database comes with:
- a new migration and an exact rollback
- a verified backup before it is applied to development

Finding IDs refer to CONSOLIDATED_FINDINGS_REGISTER.md.

## Phase 0: Finish what is in progress (no new scope)

| Step | Findings | Complexity | Approval |
|---|---|---|---|
| 0.1 Diagnose and fix the intermittent `phase-h` failures; update the outdated N-7 policy test; fix the lint warning; re-run `npm run check` and every browser test | A-01 | Low–Medium | Already within the approved N-8 scope |
| 0.2 Decide on the startup guard: exit the process, or correct the documentation (HTTP 500, fail-closed) | A-02 | Low | Yes (small N-8 scope addition) |
| 0.3 Finish the N-8 documentation and schema doc; produce the N-8 report; your review; then commit | N-8 | Low | Yes, commit |
| 0.4 **Create a private Git repository** and push (2FA, branch protection) | N-6 | Low | Yes |

## Phase 1: Small security fixes (one combined migration)

| Step | Findings | Complexity |
|---|---|---|
| 1.1 Security alerts filtered per company; portal alerts linked to the student's company | N-3 | Low |
| 1.2 Revoke PUBLIC execute on `app.*`; grant to `erp_app` only | A-03 | Low–Medium |
| 1.3 RLS on `schema_migrations` (no policies) | N-4 | Low |
| 1.4 Constant-time cron secret comparison | L-1 | Low |
| 1.5 Document or remove `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | L-2 | Low |
| 1.6 Scan status and quarantine for attestation evidence | N-2 | Medium |
| 1.7 Keep tokens out of request URLs, or out of proxy logs | A-04 | Low–Medium |

## Phase 2: Test reliability and coverage

| Step | Findings |
|---|---|
| 2.1 Browser tests against a separate, disposable database (stop L-5 pollution) | L-5 |
| 2.2 Student-merge integration tests | A-18 |
| 2.3 CSRF Origin test; alerts-isolation test; task-audit assertions | Test gaps |
| 2.4 WebKit and Firefox Playwright projects (**needs approval to download browsers**) | A-10 |

## Phase 3: Go-live infrastructure (owner decisions first)

1. Hosting, region and domain decision (HOSTING_EMAIL_SCANNER_OPTIONS.md) → staging → production (A-09).
2. Virus scanner (A-07); email and WhatsApp accounts; S3 storage.
3. Monitoring, error reporting and CI (A-08); edge rate limiting (A-06).
4. Automated off-site backups for the database and files; scheduled restore drill.
5. Staging validation:
   - real providers with fictional records
   - EICAR test
   - an authenticated dynamic scan
   - real iPhone and Android checks
   - load test
   - independent penetration test (A-15, A-16)

## Phase 4: Missing business features (owner scope decisions)

In suggested order:
1. **F-09** ranked preferences
2. **F-05** staff overdue and payment reminders
3. **F-04** staff notification centre
4. **F-03** portal visa status
5. **F-01** Ask a Question and tickets
6. **F-02** parent access
7. **F-07** instalment plans (after the fee structure)
8. **F-06** front/back scans

Real country, university and programme rules from the owner: **PENDING OWNER CONFIRMATION**.

## Phase 5: Data lifecycle and documentation

- Retention periods and audit-log archiving (A-12).
- Foreign-key indexes after measurement (A-11).
- Documentation refresh (A-13).

## Owner decisions needed

1. Hosting, region, domain.
2. Scanner.
3. Email and WhatsApp accounts.
4. Retention periods.
5. Merged-PDF filename format.
6. Role names ("Admission Staff" / "Accounts Staff").
7. Which missing features, in what order.
8. Whether parents get accounts.
9. Approval to download the WebKit and Firefox test browsers.
