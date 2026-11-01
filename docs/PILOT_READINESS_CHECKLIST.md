# Pilot readiness checklist (real-staff pilot)

**Version:** Phase D, 1 Nov 2026.

**Current status: NOT READY FOR PILOT.** The application is built and tested on the development Mac (Phases A–C, commit `eab9075`), but the external items below are not in place.

Nothing here has been deployed, purchased or subscribed to.

## A. Completed (with evidence)
| Item | Evidence |
|---|---|
| Staff accounts: invitations, account states, suspension and termination, sign out everywhere, task hand-over, protected MD | Phase A; SECURITY_EVIDENCE_REGISTER.md E-A1…A9 |
| 2-step login required for every user; recovery codes; MD-only reset with identity note | Phase B; E-B7, E-B8, E-B10, E-C7 |
| Virus-scan status, quarantine, manual clearance, approval and courier gates, scanner integration (simulated) | Phase B; E-B1…B3, E-B11 |
| Security alerts, login history, strict browser policy (also on the production build) | Phase B; E-B4…B6, E-B9, E-B12, E-B13 |
| Company and student isolation, role permissions, sessions | Phase C; E-C1…C7, E-C9 |
| Admissions scenarios A–L; payments, documents, courier and portal regression | Phase C; E-C8, E-C10…C13 |
| Backup → isolated restore drill on development data (31/31) | E-R1…R4; BACKUP_RESTORE_DRILL.md |
| Threat assessment, evidence register, incident plan, staff and administrator guides | Phase D (this set of documents) |

## B. Pending: technical, before the pilot
| # | Item | Owner | Status |
|---|---|---|---|
| B1 | **Staging environment:** hosting account, database, private file bucket, app deployment, its own secrets; fictional data only | MD decision → technical owner | Not started (needs Phase E approval) |
| B2 | **Production environment** (separate from staging) | MD decision → technical owner | Not started |
| B3 | **HTTPS:** domain, TLS certificate, HSTS verified; camera works over HTTPS | Technical owner | Not started |
| B4 | **Email provider and invitation delivery:** verified sending domain (SPF/DKIM/DMARC); test invitation, password and alert emails | MD choice → technical owner | Not started |
| B5 | **Real virus scanner:** ClamAV server (small always-on server or container reachable only from the app) **or** a commercial scanning API; set `CLAMAV_HOST`/`SCANNER_URL`; test with the EICAR test file on staging | MD choice → technical owner | Not started (integration built and tested against a simulator) |
| B6 | **PostgreSQL client tools** (`pg_dump`/`pg_restore`, free and official) on the admin machine, then test the logical-dump procedure | MD permission to download | Blocked: download not permitted in this session |
| B7 | **Off-site encrypted backups:** weekly dump plus files, separate credentials, retention | Technical owner | Not started |
| B8 | **Hosting-provider backup restore test** on staging, with the same checks as the drill | Technical owner | Not started |
| B9 | **Real devices:** Android (Chrome) and iPhone (Safari): sign-in, 2-step login, camera, uploads, PDF viewing, portal | Pilot testers | Not started (only simulated) |
| B10 | **Browsers:** Safari, Firefox and Edge on desktop | Pilot testers | Not started (only Chrome tested) |
| B11 | **Private Git repository** with MFA and branch protection; code currently only on this Mac | MD decision → technical owner | Not started |
| B12 | **Host firewall and bot protection**; database network restrictions; storage bucket privacy verified | Technical owner | Not started |
| B13 | **Independent penetration test** on staging | MD (external firm) | Not started |
| B14 | **Automated test for the password lockout** (currently implemented but untested) | Developer | Pending |
| B15 | **Monitoring:** error tracking and uptime alerts for the hosted app | Technical owner | Not started |

## C. Pending: legal, privacy and organisation
| # | Item | Owner | Status |
|---|---|---|---|
| C1 | **Legal and privacy review** (India's DPDP Act 2023 and rules; any foreign obligations): privacy notice for students and parents, consent wording, breach notification duties | MD with legal adviser | Not started |
| C2 | **Data retention periods** and a deletion-request procedure | MD with legal adviser | Not decided |
| C3 | **Two named technical owners** (hosting and database credentials, backups) and a deputy incident lead | MD | Not appointed |
| C4 | **Staff onboarding and training:** STAFF_ONBOARDING_GUIDE.md walkthrough; phishing awareness; incident reporting | MD / managers | Not started |
| C5 | **Pilot plan:** 7–14 days on staging with fictional students; testers (MD, 1 admin, 1 manager, 2 admission, 2 documentation, 1 accounts); bug register; daily alert review | MD | To be prepared in Phase E |
| C6 | **Contacts table** in INCIDENT_RESPONSE_PLAN.md §5 | MD | Pending |

## D. Owner decisions required
| # | Decision | Notes |
|---|---|---|
| D1 | **Manual clearance until a scanner exists:** accept it formally for the pilot, or require a scanner first | Threat T5/T6 are High without a scanner. Recommendation: scanner before real documents; manual clearance acceptable only with fictional pilot data. |
| D2 | **CEO and System Administrator in both companies:** keep the defaults? | The CEO reads both companies' student records (no amounts); the System Administrator reads both companies' audit log (redacted). |
| D3 | **Who else (if anyone) receives** `security.alerts`, `users.mfa_reset`, `documents.security_clear` | Default: MD only. |
| D4 | **A sealed second MD "break-glass" account** for emergencies | Needs the database override; audited and alerted. |
| D5 | **Hosting provider and region; email provider; scanner option; budget** | No purchases made. |
| D6 | **Permission to download the PostgreSQL client tools** for the `pg_dump` test (B6) | Free and official. |

## E. Business information: PENDING OWNER CONFIRMATION
The system deliberately contains **no invented content** for these items. Demo records are labelled **[DEMO]** and test-only notices are labelled **TEST**. Neither is a business rule. On 1 Nov 2026 a leftover browser-test notice ("ROMANIA – ADDITIONAL UNIVERSITY REQUIREMENT …", not labelled as a test) was found active on the development database during the Phase D review. It was deactivated with an audited reason, and the test now titles its notices "E2E TEST … (not a business rule)".

| Item | Status | Where it is used |
|---|---|---|
| **Egypt academic requirements** (subjects, minimum marks, wording) | **PENDING OWNER CONFIRMATION** | Country-wise requirements: currently none for Egypt (by design) |
| **Final wording of attestation routes marked "[TO CONFIRM]"** (e.g. Bulgaria – India-issued – Apostille; Bulgaria – UAE-issued – Legalisation; Egypt routes) | **PENDING OWNER CONFIRMATION** | Attestation routes |
| **One and Same business rules** (which name differences require a One and Same document) | **PENDING OWNER CONFIRMATION** | Academic & name rules: the development database holds only two rules labelled **[DEMO]** (from the fictional demo data). They are **not** business rules and must not be copied to production. The One and Same *declaration wording* itself was approved by the MD earlier. |
| **Official courier office address** for original documents | **PENDING OWNER CONFIRMATION** | Courier addresses: demo addresses only, marked [DEMO] |

## F. Go / no-go for the pilot
The pilot may start when all of these are true:
- **Staging and HTTPS:** B1 and B3 are done.
- **Email:** B4 is done.
- **Virus scanning:** B5 is done, **or** D1 has been accepted in writing for fictional data only.
- **Backups:** B7 and B8 are done.
- **Devices and browsers:** B9 and B10 are done on staging.
- **Organisation:** C3, C4 and C5 are done.

The go/no-go also requires the following, so that the pilot isn't blocked mid-way:
- **Business content:** the items in section E are confirmed, or explicitly deferred.
- **Real student data:** additionally requires B2, B12, B13, C1 and C2.
