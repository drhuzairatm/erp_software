# Production readiness scorecard

**Date:** 2 November 2026. Evidence-based status only; there are no percentages or scores.

**Overall: NOT READY for production with real student data.** The application logic is largely verified on fictional data. Hosting, providers, malware scanning, monitoring and an off-machine code copy do not exist yet. The N-8 fix is uncommitted and its verification is incomplete.

| # | Area | Status | Evidence | Open risks | Required action |
|---|---|---|---|---|---|
| 1 | Core application functionality | **Partially Verified** | 362/363 integration tests (best run today); 57/57 browser tests on 1 Nov | A-01 (test failures); missing features F-01 to F-09 | Fix A-01; owner decides on the missing features |
| 2 | Authentication and employee management | **Verified** (on fictional data) | N-1 tests and staff-account tests [RUN]; browser tests [PRIOR] | Real email Not Tested; MFA not browser-tested | Staging test with real email |
| 3 | Role and permission security | **Verified** | Security matrix, database isolation, no self-escalation [RUN, DB] | N-3; A-03 (hosting-dependent) | Small migration for N-3 and A-03 |
| 4 | Multi-company isolation | **Verified**, with one gap | Isolation matrix, IDOR tests [RUN] | N-3 (security alerts) | Fix N-3 |
| 5 | Admissions workflows | **Partially Verified** | Scenarios A–L [RUN] | Real country rules are placeholders (PENDING OWNER CONFIRMATION); Georgia, Uzbekistan, Kazakhstan, Philippines and Romania Not Tested with real rules; no ranked preferences (F-09) | Owner supplies the rules; test each destination |
| 6 | Document management | **Partially Verified** | Document, merge and attestation tests [RUN] | No scanner (A-07); N-2; no front/back (F-06); merge filename format PENDING OWNER CONFIRMATION | Scanner; N-2 |
| 7 | Student and parent portal | **Partially Verified** | Portal, N-7 and N-8 tests [RUN] | **N-8 not committed (A-01)**; parent portal, ticketing and visa status missing (F-01 to F-03) | Complete N-8; owner decides on features |
| 8 | Finance | **Verified** for the current scope | Multi-currency, CEO no-amounts, second-person verification [RUN] | No instalment plans or reminders (F-05, F-07) | After the fee structure is decided |
| 9 | Cybersecurity | **Partially Verified** | SECURITY_GAP_ANALYSIS.md | A-04, A-06, L-1, L-2; no penetration test | Low-effort fixes; penetration test on staging |
| 10 | Malware protection | **Blocked** | Integration present; no scanner | All files *Not virus-scanned*; manual clearance only | Owner chooses a scanner (A-07) |
| 11 | Infrastructure | **Blocked** | No staging or production | A-09 | Owner hosting decision |
| 12 | Backup and recovery | **Partially Verified** | Restore drill 31/31 on 1 Nov [PRIOR] | No automation, off-site copy or file backup; no Git remote (N-6) | Repository plus scheduled backups on the host |
| 13 | Monitoring | **Failed** (absent) | No monitor, error tracker or CI | Outages and errors go unnoticed (A-08) | Uptime monitoring, error reporting, CI |
| 14 | Mobile compatibility | **Not Tested** (real devices) | Chrome viewport emulation only | iPhone Safari, Android, Firefox, Edge (A-10) | WebKit and Firefox runs (needs approval to download browsers) and real phones |
| 15 | Testing coverage | **Partially Verified** | 363 + 57 tests | Order dependence (A-01); A-18; no load or penetration tests | See TEST_COVERAGE_REPORT.md §5 |
| 16 | Operational readiness | **Partially Verified** | Guides exist (ADMIN_MD_OPERATIONS_GUIDE, INCIDENT_RESPONSE_PLAN, UAT_CHECKLIST with 62 open items) | UAT not done; retention undecided (A-12); documentation partly stale (A-13) | UAT with fictional data on staging; owner decisions |
