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
| `4612207` | 2026-11-01 | Audit remediation: H-1 viewer quarantine, M-1 trusted client address, M-2 bulk-access alerts |
| `7569feb` | 2026-11-01 | N-1: per-browser sign-in lockout, rate-limited password reset, encrypted staff email queue (migration 0035) |

**Naming note:** the older test files `phase-a.test.ts`, `phase-b.test.ts` and `phase-c.test.ts` belong to the **earlier development phases** (MD/CEO roles, passports, document verification), not to this remediation programme. The remediation tests are `staff-accounts`, `security-phase-b`, `scenarios-a-l` and `security-matrix`.

## Overall test runs
| Run | Date | Commit | Result | Source |
|---|---|---|---|---|
| Full check (typecheck, lint, all integration and unit tests, production build) | 2026-11-01 | `eab9075` | **260 passed, 0 failed** | PHASE_C_TEST_REPORT.md |
| All browser tests (Chrome, development server) | 2026-11-01 | `eab9075` | **54 passed, 0 failed, 0 skipped** | PHASE_C_TEST_REPORT.md |
| Browser-policy test on the **production build** (`next start`) | 2026-11-01 | `7ced178` | passed | PHASE_B_SECURITY_REPORT.md |
| Backup → isolated restore drill | 2026-11-01 | `eab9075` | **31/31 checks passed** | BACKUP_RESTORE_DRILL.md |
| Phase D re-run (after the documentation changes and two test-reliability fixes) | 2026-11-01 | Phase D commit | **260 passed** (full check incl. build); **54 browser passed, 0 skipped** | PHASE_D_REPORT.md |
| N-1 run (migration 0035 applied to the development database) | 2026-11-01 | `7569feb` | **315 passed, 0 failed** (36 files; full check incl. typecheck, lint, build); **56 browser passed, 0 failed, 0 skipped** | this register, section N-1 |
| N-7 run (migration 0036 applied to the development database) | 2026-11-01 | `8038ec9` | **336 passed, 0 failed** (38 files; full check incl. typecheck, lint, build); **56 browser passed, 0 failed, 0 skipped** | this register, section N-7 |
| N-8 run (migration 0037 applied to the development database) | 2026-11-03 | uncommitted, on top of `8038ec9` | **363 passed, 0 failed** (41 files; full check incl. typecheck, lint, build; repeated: 363 passed twice); **57 browser passed, 0 failed, 0 skipped** | this register, section N-8 |

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

### Audit remediation (H-1, M-1, M-2): audit remediation of 1 Nov 2026 (migration 0034, commit `4612207`)
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-X1 | **H-1:** infected files refused by the in-app viewer: service, database function, **direct request to the real `/api/files/{id}/content` handler** (404), even for the MD; denial audited "quarantined". Clean and manually cleared files still viewable by authorised staff; unauthorised users and signed-out requests refused; download, merge, clearance and approval stay closed; portal download of a later-infected publication refused. | `tests/integration/audit-remediation.test.ts` (5 tests) | Pass | `4612207` |
| E-X2 | **M-2:** 100 viewer accesses → alert; 50 views + 50 downloads → combined alert; 100 portal downloads → portal alert; 5 accesses → no alert; alerts and audit log immutable | same file (4 tests) | Pass | `4612207` |
| E-X3 | **M-1:** forged `X-Forwarded-For` ignored in all modes; trusted `X-Real-IP` / right-most `X-Forwarded-For` used only when configured; invalid values discarded | `tests/unit/client-ip.test.ts` (5 tests) | Pass | `4612207` |
| E-X4 | **M-1 + lockout:** the real `login()` with forged headers: per-email lockout after 5 failures, nothing fake stored; unknown addresses never lock out others (shared-bucket bug fixed); trusted proxy: per-address lockout at 30 and the address recorded; portal codes limited to 5 per identifier, forged address not stored | `tests/integration/client-ip-lockout.test.ts` (4 tests) | Pass | `4612207` |

### N-1: sign-in lockout and password reset (migration 0035, commit `7569feb`, 1 Nov 2026)
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-N1 | Database security of 0035: every new function SECURITY DEFINER with fixed `search_path`; PUBLIC executes none; `erp_app` executes exactly the 11 application functions and no internal or trigger function; `auth_private` closed to `erp_app` (no USAGE, no table privilege); public policies 149 and RLS tables 89 unchanged | `tests/integration/auth-db-security.test.ts` | Pass | `7569feb` |
| E-N2 | **Exact rollback** in the throwaway test database: the 3 replaced functions restored byte-for-byte (md5 of definition and access list match the pre-0035 development fingerprints); every new function, table, column and trigger removed; re-apply works. **The development database was not rolled back.** | same file | Pass | `7569feb` |
| E-N3 | Staff: resets never lock; 3 per hour per email plus supersede; identical answers and timing (median difference under 15 ms); 10 per hour per address; trusted vs unrecognised browsers with 2-step login still required; hash-only storage; trust only after 2-step login; trusted limit 10; stolen cookie on another account, expiry; revocation on 5 events; recovery on a new browser; 20 parallel → 5 counted; refused attempts do not extend; many-accounts and global alerts | `tests/integration/auth-rate-limits.test.ts` (16 tests) | Pass | `7569feb` |
| E-N4 | Reset-email queue: link encrypted, delivered once, then erased; retry with back-off → failed after 5 with audit and alert; not configured → skipped and erased; expired → erased; 3 parallel senders deliver exactly once; CHECK constraints; global cap; `erp_app` cannot read the queue; sender functions refuse MD, admin and manager contexts; **the MD's reset link appears in no audit log, alert or notification outbox** and the MD's sign-in is unaffected | `tests/integration/staff-email-outbox.test.ts` | Pass | `7569feb` |
| E-N5 | Portal: the usual browser survives a lockout; trusted limit 10; another student's cookie gives nothing; sticky re-lock fixed (new and legacy functions); 20 parallel → 5 counted; revocation on new password or disabling; recovery trust | `tests/integration/portal-rate-limits.test.ts` | Pass | `7569feb` |
| E-N6 | Real browser: staff reset in own browser → trusted; another browser locked after 5 failures, even with the right password; the employee's browser still signs in; same answer for unknown and known emails; HttpOnly device cookie. Portal: lockout from another browser while the usual browser still signs in | `tests/e2e/n1-lockout.spec.ts` (2 tests) | Pass | `7569feb` |

**N-1 not tested / externally dependent (verified in development only; not production-ready):**
- **Real email delivery** of reset emails: the queue is tested with a stub provider only.
- **Production cookie behaviour:** the `__Host-erp_device` / `__Secure-erp_portal_device` names and the Secure flag apply only in production and were not exercised under `next start` over HTTPS.
- **Real proxy behaviour:** the per-address sign-in and reset limits behind the VPS proxy (`TRUST_PROXY`).
- **Browser test of trust after 2-step login:** development runs with `MFA_ENFORCE=off`, so the browser test reaches trust through a completed reset. Trust after 2-step login is covered only by the integration tests (`MFA_ENFORCE=roles`).

**Known deviation (N-1):** the planned extra caps on portal sign-in codes (1 per minute, 5 per 15 minutes) were **not** built. They conflict with existing tested behaviour (`phase-i.test.ts`); the existing limit of 5 per hour per identifier stays.

**Finding N-7:** fixed by migration 0036, commit `8038ec9` (see the next section). **Finding N-8:** fixed in development by migration 0037, uncommitted (section N-8).

### N-7: secure portal link queue (migration 0036, commit `8038ec9`, 1 Nov 2026)
| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-P1 | Database security of 0036: new functions SECURITY DEFINER with fixed `search_path`; PUBLIC executes none; `erp_app` executes exactly the 4 application functions and no internal or trigger function; queue closed to `erp_app` (no USAGE, no privilege, no grant); public policies 149 and RLS tables 89 unchanged; `messages_select` hides both portal-link kinds from every branch | `tests/integration/portal-link-db-security.test.ts` | Pass | `8038ec9` |
| E-P2 | **Exact rollback** in the throwaway test database: the 3 replaced functions (definition and access list) and the `messages_select` policy (qual, roles, command) match the pre-0036 development fingerprints; new objects removed. A real legacy exposure, created with the restored old function, is scrubbed on re-apply: link removed, message skipped, exposed link no longer valid, audited. **The development database was not rolled back.** | same file | Pass | `8038ec9` |
| E-P3 | Set-up link stored encrypted, delivered once by the company sender, then wiped; it appears in no outbox, audit log, student event or alert, and not to the manager, the MD or a counsellor; the student completes set-up and signs in; staff see the delivery status only | `tests/integration/portal-link-queue.test.ts` | Pass | `8038ec9` |
| E-P4 | Forgot password: the reset link reaches only the student; the reset works; replay is refused; neither contact-details nor outbox holders can read it | same file | Pass | `8038ec9` |
| E-P5 | Test mode → status "test", link wiped, nothing sent (allow-listed addresses do receive it); email not configured → skipped and wiped; expired before sending → never sent; an expired delivered link cannot be used; re-issue revokes the older queued email and link; disabling revokes; claim-time re-check catches a revocation the trigger did not see | same file | Pass | `8038ec9` |
| E-P6 | 3 parallel senders deliver each message exactly once; temporary failure → retry with back-off, link kept encrypted while pending, failed after 5 attempts, wiped and audited; permanent failure → failed at once | same file | Pass | `8038ec9` |
| E-P7 | Direct access denied: `erp_app` and staff (MD, admin, manager, counsellor) cannot read the queue; sender functions refuse staff contexts; plain links refused (22023); the CHECK refuses plain or pending links in final states; portal-link messages cannot be inserted into the outbox; status function respects company isolation; legacy rows hidden and stripped in every status (test, queued, sent, failed, skipped) | same file | Pass | `8038ec9` |
| E-P8 | Existing portal tests adapted to the secure queue (forgot password: one queue row, none in the outbox, queue unreadable to counsellor and manager) | `tests/integration/phase-6-portal-v2.test.ts` | Pass | `8038ec9` |

**N-7 not tested / externally dependent:** real email delivery (stub provider only); the per-minute scheduled job on a real host; a browser test of an emailed link. Development has no email provider, so the emailed path is covered by the integration tests only.

### N-8: secure authentication-message queue (migration 0037, **uncommitted**, 3 Nov 2026)
Portal sign-in codes and email-verification links are no longer in the staff-visible outbox. **Not committed; awaiting the owner's review.**

| ID | Control | Test / source | Result | Commit |
|---|---|---|---|---|
| E-A1 | Database security of 0037: functions SECURITY DEFINER with fixed `search_path`; PUBLIC executes none of the new ones; `erp_app` executes exactly the 4 application functions; queue closed to `erp_app`; policy count 149 unchanged; `messages_select` hides all four secret kinds; the CHECK refuses badly formed ciphertext and secrets in final states; secret kinds cannot be inserted into the outbox (42501); a re-queue from a final status is refused (23514) | `tests/integration/auth-message-db-security.test.ts` | Pass | uncommitted |
| E-A2 | **Exact rollback** in the throwaway test database: the replaced functions and policy match the pre-0037 fingerprints; new objects removed. A real legacy exposure, created with the restored old functions, is scrubbed on re-apply (code and link invalid, audited). **The development database was not rolled back.** | same file | Pass | uncommitted |
| E-A3 | MD, CEO, Admin, Manager, Counsellor, Finance and the other company's manager see **no** code or link in **any** status (queued, sending, sent, failed, skipped, test, expired, cancelled), across Messages, the outbox, the redacted log, audit, events and alerts; managers keep a redacted status row (no text, no Retry); company isolation | `tests/integration/auth-message-queue.test.ts` | Pass | uncommitted |
| E-A4 | The right student signs in with the delivered code and verifies the email with the delivered link; replay refused; expired, used, replaced, 5-attempt and email-changed codes and links are revoked and never sent, including on retry | same file | Pass | uncommitted |
| E-A5 | 3 concurrent senders deliver each message exactly once; back-off retry, failure after 5 attempts (wiped, audited); permanent failure at once; Gallabox: the code is only in the request body, and an echoing error is stored masked; authenticated decryption rejects tampered, wrong-kind and N-1/N-7-format ciphertext; the cron response and console contain no secret | same file | Pass | uncommitted |
| E-A6 | Test mode: wiped, nothing stored; local test mailbox only with `NODE_ENV≠production` and `NOTIFICATIONS_TEST_MAILBOX=1` (folder 0700, files 0600); production requires exactly `NOTIFICATIONS_MODE=live` | `tests/unit/notifications-config.test.ts`, same file | Pass | uncommitted |
| E-A7 | Production build with a disallowed mode serves nothing (HTTP 500 to every request, "Refusing to start" in the log); with `live`, `/api/health` 200 | manual run of the production build, 2 Nov 2026 (port 3100) | Pass (fail-closed; the process does not exit) | uncommitted |
| E-A8 | Browser: the MD's Messages page shows only a redacted row with no code; the student signs in with the code from the local test mailbox; existing sign-in and email-verification browser tests adapted | `tests/e2e/n8-auth-messages.spec.ts`, `phase-i`, `courier`, `phase-2-passport-contacts` | Pass | uncommitted |
| E-A9 | Development database after 0037 and the browser runs: 0 secrets in final states, 0 pending; 0 new secret-kind messages in the outbox; 80 legacy messages with 0 codes and 0 real tokens (masked); 0 audit entries with secrets; `erp_app` has no access to `auth_private` | read-only queries, 3 Nov 2026 | Pass | uncommitted |

**Test reliability fixes made while finishing N-8 (tests only):**
- `phase-h.test.ts`: three lookups did not say "student" and could pick the parent's message (always *skipped*, "no phone number"). Intermittent failure; it now filters by recipient, as its other lookups do.
- `portal-link-db-security.test.ts`: still requires both portal-link kinds to be hidden, and now accepts the kinds added by 0037.
- `auth-message-queue.test.ts`: phone numbers made unique (no duplicate-detection collisions with other tests).

**N-8 not tested / externally dependent:** real email and WhatsApp delivery (stub provider; Gallabox request built by the real code with a stubbed network); the per-minute scheduled job on a real host; behaviour behind a real reverse proxy. Request logs may record the URL of a student's own (single-use) link visit (audit finding A-04).

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
- **Delivery:** real email delivery of invitations, alerts or password-reset emails (the queue is tested with a stub provider only).
- **N-1 on a real proxy:** the per-address reset and sign-in limits behind the VPS proxy (needs `TRUST_PROXY`).
- **Devices and browsers:** real phones (iPhone, Android), Safari, Firefox and Edge.
- **Hosting:**
  - HTTPS / TLS configuration
  - the host firewall
  - storage bucket privacy on the real provider
- **Backups:** the hosting provider's backups and restore; the `pg_dump`/`pg_restore` procedure (tools not installed; download not permitted in this session).
- **Independent review:** penetration test; legal and privacy (DPDP) review.
