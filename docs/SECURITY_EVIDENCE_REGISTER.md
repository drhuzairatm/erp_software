# Security evidence register

**Version:** Phase D, 1 Nov 2026.

**What counts as evidence:** only tests that were actually run, and reports written from those runs. **This is not an independent certification.**

**Environment:** all evidence comes from the development Mac, with fictional data only:
- local PostgreSQL 17.11
- Chrome via Playwright for browser tests
- the temporary test database created by the test runner

No staging or production environment exists yet.

## Commits
| Commit | Date (local) | Content |
|---|---|---|
| `687db59` | 2026-11-01 12:45 | Phase A: staff account security (invitations, account states, sign out everywhere, task hand-over, protected MD) |
| `7ced178` | 2026-11-01 13:49 | Phase B: virus-scan status, quarantine, manual clearance, approval/courier gates, security alerts, login history, 2-step login for everyone, nonce browser policy |
| `eab9075` | 2026-11-01 14:12 | Phase C: admissions scenarios A–L, security/isolation matrix, backup → restore drill |

**Naming note:** the older test files `phase-a.test.ts`, `phase-b.test.ts` and `phase-c.test.ts` belong to the **earlier development phases** (MD/CEO roles, passports, document verification), not to this remediation programme. The remediation tests are `staff-accounts`, `security-phase-b`, `scenarios-a-l` and `security-matrix`.

## Overall test runs
| Run | Date | Commit | Result | Source |
|---|---|---|---|---|
| Full check (typecheck, lint, all integration and unit tests, production build) | 2026-11-01 | `eab9075` | **260 passed, 0 failed** | PHASE_C_TEST_REPORT.md |
| All browser tests (Chrome, development server) | 2026-11-01 | `eab9075` | **54 passed, 0 failed, 0 skipped** | PHASE_C_TEST_REPORT.md |
| Browser-policy test on the **production build** (`next start`) | 2026-11-01 | `7ced178` | passed | PHASE_B_SECURITY_REPORT.md |
| Backup → isolated restore drill | 2026-11-01 | `eab9075` | **31/31 checks passed** | BACKUP_RESTORE_DRILL.md |
| Phase D re-run (after the documentation changes and two test-reliability fixes) | 2026-11-01 | Phase D commit | **260 passed** (full check incl. build); **54 browser passed, 0 skipped** | PHASE_D_REPORT.md |

## Evidence by area
Each test was run on 2026-11-01. Columns: evidence ID, control, test or source (file), result, commit.

### Staff accounts and authentication (Phase A)
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-A1 | Invitation lifecycle: pending → accept → active; email confirmed; single use; Argon2id hash | `tests/integration/staff-accounts.test.ts` | Pass (10/10 in file) | `687db59` |
| E-A2 | Expired, replaced and cancelled invitations refused; duplicate and unauthorised invitations refused | same file | Pass | `687db59` |
| E-A3 | Suspension ends sessions at once; blocks sign-in and reset links; reason required; reactivation | same file | Pass | `687db59` |
| E-A4 | Termination keeps records; only the MD (`users.create_admin`) can reinstate | same file | Pass | `687db59` |
| E-A5 | Self, MD and escalation refusals; managers, counsellors and the CEO cannot change status | same file | Pass | `687db59` |
| E-A6 | Sign out everywhere (own and within authority), audited | same file | Pass | `687db59` |
| E-A7 | Bulk task hand-over keeps history and is audited; inactive receivers refused | same file | Pass | `687db59` |
| E-A8 | Second MD refused in the database; override audited | same file + setup script on dev database | Pass | `687db59` |
| E-A9 | Browser journey: invite → activate → sign in → suspend (session ended) → hand over → reactivate → sign out everywhere | `tests/e2e/staff-accounts.spec.ts` | Pass | `687db59` |

### Documents, scanning, alerts and 2-step login (Phase B)
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-B1 | No scanner → "not scanned"; approval refused; manual-clearance rules (permission, not the uploader, reason) | `tests/integration/security-phase-b.test.ts` | Pass (8/8 in file) | `7ced178` |
| E-B2 | ClamAV protocol with a **simulated** clamd: clean, infected/quarantined (no download, clearance, approval or courier; stays infected), critical alert | same file | Pass | `7ced178` |
| E-B3 | Scan failure blocks approval; the daily re-scan marks files clean | same file | Pass | `7ced178` |
| E-B4 | Alerts: failed sign-ins (grouped), visibility in the service and database, not editable, acknowledgement | same file | Pass | `7ced178` |
| E-B5 | Alerts: permission change, large, frequent and refused exports, bulk downloads | same file | Pass | `7ced178` |
| E-B6 | Login history and sessions visible only to the person, their administrators and alert holders | same file | Pass | `7ced178` |
| E-B7 | 2-step reset only with `users.mfa_reset` plus a note; System Administrator refused; high alert | same file | Pass | `7ced178` |
| E-B8 | 2-step login required for everyone; production ignores any weaker setting | `tests/unit/mfa.test.ts` | Pass | `7ced178` |
| E-B9 | Browser policy: nonce, no inline scripts, injected handler blocked, app works (dev **and** production build) | `tests/e2e/security-phase-b.spec.ts` | Pass | `7ced178` |
| E-B10 | Enrolment with an authenticator; password alone opens nothing; wrong code refused; recovery code works once | same file | Pass | `7ced178` |
| E-B11 | Manual clearance in the browser, shown as manual; no option for a manager | same file | Pass | `7ced178` |
| E-B12 | Failed sign-ins → MD alert → acknowledged; no access for manager or System Administrator | same file | Pass | `7ced178` |
| E-B13 | Production build: 13/13 script tags carry the nonce; no `unsafe-eval`; HSTS sent | manual check, recorded in PHASE_B_SECURITY_REPORT.md | Pass | `7ced178` |

### Isolation, permissions and scenarios (Phase C)
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-C1 | **Company isolation, database:** every table with a student column, 6 Edulinks-only accounts, zero rows of a GRADUATER-only student | `tests/integration/security-matrix.test.ts` | Pass (9/9 in file) | `eab9075` |
| E-C2 | **Company isolation, services:** 11 kinds of read return nothing; 10 kinds of write refused for authorisation reasons | same file | Pass | `eab9075` |
| E-C3 | Dual-company roles: the CEO sees no amounts; the System Administrator gets no student records | same file | Pass | `eab9075` |
| E-C4 | **Student isolation:** assigned-only documentation staff; portal session limited to one student; forged token | same file | Pass | `eab9075` |
| E-C5 | **Role permissions:** approve, pay, ledger amounts, staff administration, alerts | same file | Pass | `eab9075` |
| E-C6 | **Sessions:** revoked, expired, idle (8 h), waiting for 2-step code; tokens hashed | same file | Pass | `eab9075` |
| E-C7 | **2-step login:** no code replay; recovery codes work exactly once | same file + `tests/integration/phase-a.test.ts` | Pass | `eab9075` |
| E-C8 | Admissions scenarios A–L end to end | `tests/integration/scenarios-a-l.test.ts` | Pass (12/12) | `eab9075` |
| E-C9 | Earlier isolation suites (row-level security, guessed IDs, cross-company writes, storage keys, audit log immutable) | `tests/integration/db-isolation.test.ts` (17), `tests/e2e/isolation.spec.ts` (4) | Pass | `eab9075` |
| E-C10 | Document workflow: approver ≠ verifier, new upload resets, verification records immutable | `tests/integration/phase-c.test.ts` (10) | Pass | `eab9075` |
| E-C11 | Payments: verification by a second person, no edits or deletes, reversals, other companies refused | `tests/integration/services.test.ts` (28), `tests/integration/multi-currency.test.ts` (5) | Pass | `eab9075` |
| E-C12 | Courier: instructions only after approval; exceptions need permission and a reason | `tests/integration/courier.test.ts`, `tests/e2e/courier.spec.ts` | Pass | `eab9075` |
| E-C13 | Exports: permissions, audit, formula injection neutralised | `tests/integration/services.test.ts` | Pass | `eab9075` |

### Backup and restore
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-R1 | Online physical backup → separate PostgreSQL instance; exact restore point | `scripts/backup-restore-drill.ts` → BACKUP_RESTORE_DRILL.md | Pass | `eab9075` |
| E-R2 | All 102 tables identical (counts and content hashes); 293 foreign keys without orphans; balances identical | same | Pass | `eab9075` |
| E-R3 | Security objects, application role, row-level security, unreadable storage keys and append-only audit log all survive restore | same | Pass | `eab9075` |
| E-R4 | 395/395 live files present and SHA-256 identical; replaced photo versions deleted by design (reported separately) | same | Pass | `eab9075` |

### Audit remediation (H-1, M-1, M-2): audit remediation of 1 Nov 2026 (migration 0034, not yet committed)
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-X1 | **H-1:** infected files refused by the in-app viewer: service, database function, **direct request to the real `/api/files/{id}/content` handler** (404), even for the MD; denial audited "quarantined". Clean and manually cleared files still viewable by authorised staff; unauthorised users and signed-out requests refused; download, merge, clearance and approval stay closed; portal download of a later-infected publication refused. | `tests/integration/audit-remediation.test.ts` (5 tests) | Pass | audit remediation (commit after f3e8ce3) |
| E-X2 | **M-2:** 100 viewer accesses → alert; 50 views + 50 downloads → combined alert; 100 portal downloads → portal alert; 5 accesses → no alert; alerts and audit log immutable | same file (4 tests) | Pass | audit remediation (commit after f3e8ce3) |
| E-X3 | **M-1:** forged `X-Forwarded-For` ignored in all modes; trusted `X-Real-IP` / right-most `X-Forwarded-For` used only when configured; invalid values discarded | `tests/unit/client-ip.test.ts` (5 tests) | Pass | audit remediation (commit after f3e8ce3) |
| E-X4 | **M-1 + lockout:** the real `login()` with forged headers: per-email lockout after 5 failures, nothing fake stored; unknown addresses never lock out others (shared-bucket bug fixed); trusted proxy: per-address lockout at 30 and the address recorded; portal codes limited to 5 per identifier, forged address not stored | `tests/integration/client-ip-lockout.test.ts` (4 tests) | Pass | audit remediation (commit after f3e8ce3) |

## Controls without test evidence
These are implemented or documented, but **no automated test proves them**:
- **Real reverse proxy:** the `TRUST_PROXY` behaviour on an actual VPS proxy or on Vercel (requires external validation).
- **Session cookie flags:** HttpOnly, SameSite, Secure, `__Host-` (Secure and `__Host-` apply in production only).
- **Cross-site request protection:** the framework's Origin check.
- **Logging hygiene:** no secrets in logs; generic error messages beyond the tested cases.
- **Production-only settings:** production refuses local file storage.
- **Students cannot be deleted:** enforced by database permissions, but not tested.
- **Alert emails:** need an email provider.

## Not tested at all (external or blocked)
- **A real virus scanner:** ClamAV server or scanning service.
- **Delivery:** real email delivery of invitations or alerts.
- **Devices and browsers:** real phones (iPhone, Android), Safari, Firefox and Edge.
- **Hosting:**
  - HTTPS / TLS configuration
  - the host firewall
  - storage bucket privacy on the real provider
- **Backups:** the hosting provider's backups and restore; the `pg_dump`/`pg_restore` procedure (tools not installed; download not permitted in this session).
- **Independent review:** penetration test; legal and privacy (DPDP) review.
