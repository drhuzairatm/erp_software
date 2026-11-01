# Phase D: security documentation and operational readiness (1 Nov 2026)

**Basis:** approved by the MD; builds on commit `eab9075` (preserved).

**Nature of the work:** documentation only. No workflow, permission or security control was changed. Nothing was deployed, purchased, downloaded or installed. Only fictional development data was touched (one cleanup, below).

**Status:** Phase E not started.

## 1. Documents created
| Document | Summary |
|---|---|
| `docs/SECURITY_THREAT_ASSESSMENT.md` | 13 threats (account compromise, cross-company, student data, escalation, malware, manual clearance, 2-step login, payments, exports/downloads, sessions, database/storage, backups, insiders). For each: severity, likelihood/impact, controls marked **T** (tested) / **I** (implemented, untested) / **P** (planned/external), gaps and mitigations. Residual **High**: no virus scanner (T5, T6) and no production backups (T12). |
| `docs/SECURITY_EVIDENCE_REGISTER.md` | Evidence IDs E-A1…A9, E-B1…B13, E-C1…C13, E-R1…R4, each with the test file, result, date and commit (`687db59`, `7ced178`, `eab9075`). Separate lists of controls **without** test evidence and items **not tested at all**. No certification claimed. |
| `docs/INCIDENT_RESPONSE_PLAN.md` | Roles and authority (who may suspend, reset 2-step login, clear files, restore, notify); severity levels; common steps (detect, record, contain, preserve evidence, investigate, recover, notify, close); 9 procedures: account compromise, lost device, unauthorised access, malware, excessive downloads, financial activity, data leak/export, database or hosting compromise, backup failure/corruption. Contacts table left for the MD. |
| `docs/STAFF_ONBOARDING_GUIDE.md` | Invitation and activation, first sign-in, mandatory 2-step setup, recovery-code storage, password and session safety, assignments and tasks, document upload/review, scan statuses and manual-clearance restrictions, payments, reporting suspicious activity, suspension and termination. |
| `docs/ADMIN_MD_OPERATIONS_GUIDE.md` | Roles and permissions, security permissions (MD-only by default), **special CEO and System Administrator access** (both companies by default; what each can and cannot do), staff and company access, suspension/termination/hand-over, security alerts, login history, manual clearance and quarantine, 2-step reset with identity checks, audit-log review routine, backup and restore. |
| `docs/PILOT_READINESS_CHECKLIST.md` | Status **NOT READY FOR PILOT**. Completed work (with evidence IDs); pending technical items B1–B15; legal and organisation C1–C6; owner decisions D1–D6; business information marked **PENDING OWNER CONFIRMATION**; go/no-go conditions. |
| `docs/PHASE_D_REPORT.md` | This report. |

## 2. Documents updated (to remove contradictions, not to duplicate)
| Document | Change |
|---|---|
| `docs/USER_GUIDE.md` | 2-step login is now "required for every staff account"; recovery and MD reset; System Administrator section (invitations, suspension on the profile, MD-only duties, master data) |
| `docs/SECURITY_REPORT.md` | 2-step login for everyone; nonce browser policy; virus-scan status; residual-risk section points to the new threat assessment and evidence register |
| `docs/BACKUP_RECOVERY.md` | Real status (drill passed; provider backups and `pg_dump` untested); old incident checklist replaced by a pointer to the incident plan |
| `docs/LIMITATIONS_AND_ROADMAP.md` | 2-step decision recorded; roadmap reflects the nonce policy and the scanner integration as done |
| `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/UAT_CHECKLIST.md` | Outdated "`MFA_ENFORCE=roles`" statements corrected; go-live checklist links to the pilot checklist (scanner / manual-clearance decision) |
| `docs/ROLE_PERMISSION_MATRIX.md` (+ generator `scripts/permission-matrix.ts`) | Column renamed "Marked high-risk (2FA flag)", with a note that 2-step login applies to everyone (wording only; no permission changed) |
| `README.md` | Links to all new documents and phase reports |
| `docs/SECURITY_EVIDENCE_REGISTER.md` | Phase D re-run recorded |

## 3. Findings during Phase D
1. **Leftover test notice:** an active "ROMANIA – ADDITIONAL UNIVERSITY REQUIREMENT …" notice on the **development** database came from an earlier browser-test run and was not labelled as a test.
   - **Deactivated** through the app's audited function, with the reason "Leftover from an automated browser test (fictional) – not a business rule".
   - **Fixed in the test:** it now titles its notices "ROMANIA – E2E TEST REQUIREMENT … (not a business rule)".
   - **Result:** the only active academic notice is now the MD-supplied Bulgaria notice.
2. **Attestation browser test:** it depended on leftover demo data and skipped once that ran out. It now creates its own fictional student through the same database path as the demo script. Verified stable over repeated runs.
3. **Accuracy of "tested" claims:** while writing the evidence register, two controls first marked as tested had **no** automated test. Both are now marked "implemented, untested":
   - the password lockout thresholds
   - "students cannot be deleted"

   A lockout test is listed as pilot item B14.
4. **[DEMO] One and Same rules:** the development database holds two One and Same rules labelled **[DEMO]** (from the demo data). They are documented as not business rules.

## 4. Outstanding risks and dependencies
- **High until resolved or formally accepted:**
  - no real virus scanner (manual clearance only)
  - no production/off-site backups or provider restore test
- **External:**
  - hosting (staging and production), HTTPS
  - email provider
  - scanner
  - PostgreSQL client tools (needs your download permission)
  - private Git repository with MFA
  - host firewall
  - real-device and Safari/Firefox/Edge tests
  - independent penetration test
  - legal/privacy (DPDP) review
- **Organisational:** two named technical owners; incident contacts; staff training; pilot plan.

## 5. Business decisions and information still required from the MD
**Decisions** (PILOT_READINESS_CHECKLIST.md section D):
- **D1:** accept manual clearance for the pilot, or require a scanner first
- **D2:** keep the CEO and System Administrator in both companies
- **D3:** who else, if anyone, receives the security permissions
- **D4:** a sealed second-MD "break-glass" account
- **D5:** hosting, email and scanner choices and budget
- **D6:** permission to download the PostgreSQL client tools

Also needed: data retention periods (C2); technical owners and incident contacts (C3, C6).

**Information marked PENDING OWNER CONFIRMATION:**
- Egypt academic requirements
- final wording of the attestation routes marked "[TO CONFIRM]"
- One and Same business rules
- official courier office address

## 6. Tests after Phase D (actually run, 1 Nov 2026)
| Run | Result |
|---|---|
| `npm run check`: typecheck, lint, all integration and unit tests, production build | **260 passed, 0 failed** |
| All browser tests (Chrome) | **54 passed, 0 failed, 0 skipped** |
| Attestation browser test, repeated runs | 4/4 passed |

## 7. Git
The Phase D commit follows `eab9075`; its reference is given in the completion message. No history was rewritten.
