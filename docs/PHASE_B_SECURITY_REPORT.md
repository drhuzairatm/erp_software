# Phase B: security, implementation report (1 Nov 2026)

Approved by the MD:
- Phase B in full
- two-step login mandatory for **every** user

Phase C has not started.

## 1. Security improvements
### Virus scanning, quarantine and manual clearance
- **Every student document file** (staff upload and parent/student portal upload) has a scan status. A **manual clearance** is always labelled as manual in the system, never as scanned. The statuses:
  - *Not virus-scanned*
  - *Virus-scanned: clean*
  - *Virus scan failed*
  - *Infected – quarantined*
  - *Manually cleared (not scanned)*
- **Scanner integration** (`src/server/security/scanner.ts`, no new dependency). Either:
  - **ClamAV** daemon over TCP (`CLAMAV_HOST`, `CLAMAV_PORT`), or
  - any **HTTPS scanning service** (`SCANNER_URL`, `SCANNER_TOKEN`; bytes POSTed, JSON `{status, signature}` returned).

  With neither configured, files stay *Not virus-scanned*; nothing pretends they were scanned.
- **Gates enforced in the database:**
  - **Approval** is refused unless the file being approved is *clean* or *manually cleared*.
  - **Original-document courier instructions** (including the existing emergency exception) are refused when an uploaded file is not *clean* or *manually cleared*.
- **Manual clearance:**
  - **Permission:** only with the new permission `documents.security_clear` (MD by default; delegable).
  - **Rules:** a reason is required (10+ characters); the clearer cannot be the uploader; infected files can never be cleared.
  - **Record:** the audit log stores who, when and the reason, plus the note "MANUAL clearance – not an automated virus scan", and an alert is raised.
- **Quarantine:** an infected file is kept for evidence but can never be downloaded, previewed, merged, published to the portal, approved, cleared or sent by courier. **Correction:** when this report was written, the in-app viewer (`/api/files/{id}/content` → `app.authorize_file_access`) did **not** check the scan status, so this sentence was overstated (audit finding H-1). The viewer was fixed in the audit remediation of 1 Nov 2026 (migration 0034, not yet committed) and is tested in `tests/integration/audit-remediation.test.ts`.. Every blocked attempt is audited, and a **critical** alert is raised. A later scan cannot turn "infected" back into "clean".
- **Daily re-scan:** once a scanner is configured, the daily job scans files stored earlier, including manually cleared ones.
- **Staff/student photos and attestation evidence:** scanned on upload when a scanner is configured; an infected file is refused and never stored (audited and alerted). Photos are always re-encoded before display.
- **Screens:** the document review page shows the scan status panel and the manual-clearance form (only for permitted users). The student's document checklist shows a badge for any file that is not scanned-clean. Quarantined files are not shown in the viewer.

### Security alerts
- **How they are raised:** automatically, by a database trigger on the append-only audit log, so they cannot be bypassed or edited. The app role cannot change or delete alerts.
- **Grouping:** repeats within an hour are grouped.
- **Who sees them:** new permission `security.alerts` (MD by default), on **Admin → Security alerts**. A sidebar count and a red banner appear for open high/critical alerts. Acknowledging records who did it and a note.

| Alert | Trigger | Severity |
|---|---|---|
| Repeated failed sign-ins (per email) | 5+ failures in 15 min (10+ = high) | warning / high |
| Many failed sign-ins from one address | 20+ in 15 min | high |
| Wrong two-factor codes | each occurrence (grouped) | warning |
| Role permission granted/removed | every change | warning (high if sensitive) |
| Staff role or company access changed | every change | warning |
| MD role granted | every grant | critical |
| Two-factor reset by administrator | every reset | high |
| Large export | 500+ rows | high |
| Frequent exports | 10+ in an hour by one person | warning |
| Export refused | every refusal | warning |
| Bulk document access | 100+ views **or** downloads in an hour by one person (views added in the audit remediation of 1 Nov 2026 (migration 0034, not yet committed); originally downloads only, finding M-2) | high |
| Bulk portal downloads | 100+ downloads in an hour through one student portal account (added in the same remediation) | high |
| Malware detected | every infected upload | critical |
| Manual security clearance | grouped per person | info |
| Staff account status changed | every change | info |

- **Email delivery:** high and critical alerts are emailed to holders of `security.alerts` by the every-minute job **once email is configured**. The email carries no personal data, only the title and a link.

### Login history
- **What it shows:** active sessions (start, last activity, address, browser) and the latest sign-in events: successes, failures, 2-step results, recovery-code use, password changes, sign out everywhere, resets.
- **Who sees it:**
  - **Everyone:** their own, on *Two-factor login* (account menu).
  - **Administrators:** on the staff profile, for people within their authority.
  - **`security.alerts` holders:** staff of their companies.
- **Secrets:** no tokens or password hashes are exposed.

### Two-step login for every user
- **Enforcement:** required for every staff account, including MD, CEO, administrators, managers, finance and all staff. Production builds **always** require it, whatever the setting, and the former production escape flag (`ALLOW_MFA_OFF_IN_PRODUCTION`) has been removed.
- **First sign-in:** a new user must set it up before using anything else (existing rule).
- **Recovery:**
  - **Self-service:** 10 single-use recovery codes, stored hashed.
  - **Assisted:** if those are lost, a reset by someone holding the new `users.mfa_reset` permission (MD by default), who must record how the person's identity was verified. The reset ends all their sessions, is audited and raises a **high** alert.
- **No ordinary bypass:** a System Administrator can no longer reset anyone's 2-step login.

### Stricter browser security policy
- **Page policy:** pages now get a **fresh random nonce on every request** (`src/proxy.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, with **no `'unsafe-inline'` for scripts**. Injected inline scripts and event handlers do not run.
- **Directives:** `frame-ancestors 'none'`, `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, `form-action 'self'`; in production also `upgrade-insecure-requests`.
- **Remaining allowances (documented):**
  - `style-src 'unsafe-inline'`: React style attributes for photo cropping; this cannot run scripts.
  - `'wasm-unsafe-eval'`: the in-app PDF viewer's decoders.
  - `'unsafe-eval'`: development only.
- **File routes:** they keep their own `default-src 'none'; sandbox` policies.
- **Other headers unchanged:** HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy.

### Audit logging of sensitive actions
New audited actions:
- `file_scanned`, `malware_detected`, `file_manual_security_clearance`
- quarantined download refusals
- `security_alert_acknowledged`
- `mfa_reset_by_admin` (with reason)

Together with the existing log, these cover sign-ins, exports, downloads, permission/role changes, staff status and sessions.

## 2. Files changed
- **Database:** `db/migrations/0033_security_phase_b.sql`, `db/rollbacks/0033_security_phase_b.down.sql` (new)
- **New server code:**
  - `src/server/security/scanner.ts`, `file-scan.ts`, `jobs.ts`
  - `src/server/services/security.ts`
  - `src/proxy.ts`
  - `src/app/actions/security.ts`
- **Changed server code:**
  - `src/server/services/documents.ts`, `photos.ts`, `staff-photos.ts`, `attestation.ts`
  - `src/server/portal.ts`
  - `src/server/auth/mfa.ts`, `mfa-service.ts`
  - `src/app/actions/auth.ts`
  - `src/app/api/cron/daily/route.ts`, `notifications/route.ts`
- **Screens:**
  - **New:**
    - `src/app/(app)/admin/security/*`
    - `students/[id]/documents/[docId]/scan-panel.tsx`
    - `src/components/scan-badge.tsx`, `login-activity.tsx`
  - **Changed:**
    - `(app)/layout.tsx`, `admin/layout.tsx`
    - `admin/admin-forms.tsx`, `admin/users/page.tsx`, `admin/users/[id]/page.tsx`
    - `account/security/page.tsx`
    - `students/[id]/page.tsx`, document review page
    - root `layout.tsx` (per-request rendering for the nonce)
- **Configuration:**
  - `next.config.ts`: page CSP moved to the proxy
  - `.env.example`: `MFA_ENFORCE=all`; scanner settings
- **Demo data:**
  - `scripts/lib/seed-demo.ts`, `scripts/demo-addon-attestation.ts`: demo files receive a **labelled manual clearance** ("Fictional demo file … NOT virus-scanned") by the demo MD, so demo approvals still work honestly.
- **New tests:**
  - `tests/integration/security-phase-b.test.ts`
  - `tests/e2e/security-phase-b.spec.ts`
- **Updated tests:** 7 test files approve or courier uploaded files and now perform the required manual clearance first (helpers `securityClear` / `securityClearAsMd`, which call the real audited function). 2FA reset tests now pass a verification note.

## 3. Migration
`0033_security_phase_b`, additive:
- **Permissions:** 3 new (`documents.security_clear`, `security.alerts`, `users.mfa_reset`), granted automatically to the protected MD role only.
- **Scan columns** on `document_files`. Existing files become *Not virus-scanned*. Already-approved documents stay approved (no retroactive change), but need clearance before courier release.
- **New table** `security_alerts` with row-level security.
- **Functions and triggers** as above.
- **Replaced functions:**
  - `authorize_file_download` and `portal_download` (quarantine check)
  - `mfa_admin_reset` (now permission + reason)
- **Rollback:** tested by rolling back and re-applying on the development database. The migration test (roll back to 0017 and re-apply) also passes.
- **Fresh install:** migrate → provision → demo seed succeeds.

## 4. Test results (this Mac; fictional data only)
| Suite | Result |
|---|---|
| New integration tests, `security-phase-b.test.ts` (8): no scanner → not scanned, approval refused, clearance rules (no permission / uploader / short reason refused), MD clearance labelled manual + audited + alerted, approval then allowed; **ClamAV protocol** with an in-test clamd server: clean → approved without manual step; infected → quarantined, download refused (audited "quarantined"), clearance/approval/courier refused, cannot be re-marked clean, critical alert; unreachable scanner → *scan failed*, approval refused, daily re-scan marks clean; ClamAV client replies; failed-sign-in alert grouping, visibility (manager/System Administrator/CEO refused in service **and** database), alerts not editable, acknowledgement; permission-change, large/frequent/refused export and bulk-download alerts; login history and sessions visibility; 2FA reset permission + note + alert | **8/8 passed** |
| Unit test: 2FA required for everyone by default; production requires it whatever `MFA_ENFORCE` says (old escape flag ignored) | passed |
| Full check: typecheck, lint, **239/239** integration and unit tests (incl. migration rollback/re-apply), production build | **passed** |
| New browser tests (4): CSP nonce / no inline scripts / injected handler blocked / app works; new employee enrols an authenticator → password alone opens nothing → wrong code refused → code accepted → recovery code works once → sign-in activity shown; unscanned file → MD manual clearance with reason shown as manual, manager has no option; failed sign-ins → MD sees and acknowledges alert; manager/System Administrator have no access | **4/4 passed** |
| All browser tests (development server) | **53 passed, 1 skipped** (attestation demo data, Phase C). The courier journey, skipped before, now **runs and passes**. |
| **Production build** (`next start`): every script tag (13/13) carries the request's nonce; no `'unsafe-eval'`; HSTS sent. The browser-policy test passes on the production build, where 2-step setup was compulsory even though the local setting says "off". | **passed** |

**Not tested:**
- a real ClamAV installation or a real scanning service (the protocol was tested against a simulated clamd)
- email delivery of alerts (no email provider)
- other browsers (Safari, Firefox, Edge), phones

## 5. Outstanding external dependencies
1. **A virus scanner (not purchased or created):**
   - **ClamAV:** Vercel functions cannot run it. It needs a small always-on server or container (e.g. a $5–10/month VM or container service) running `clamd`, reachable only from the app (private network or firewall), then `CLAMAV_HOST`/`CLAMAV_PORT` set.
   - **Or a commercial scanning API:** with an HTTPS endpoint (adapter may need a small change to match its answer format), then `SCANNER_URL` and `SCANNER_TOKEN` set.

   Until then, every upload needs manual clearance by the MD or a delegate before approval or courier release.
2. **Email provider:** for alert emails, as well as invitations.
3. **Hosting with HTTPS:** for production headers, HSTS and the camera.

## 6. Security risks still outstanding
- **Manual clearance is not virus scanning:** while no scanner is configured, a malicious file could be cleared by a person. Mitigations: permission + reason + not the uploader + alert + audit; files are never executed and are served with `nosniff` / sandbox CSP. **Configure a scanner before real use.**
- **Style policy:** `style-src 'unsafe-inline'` remains (no script execution possible through it).
- **Rate limits:** login rate limiting is per database, not at the network edge (a WAF at the host is recommended).
- **Recovery codes:** users cannot regenerate them themselves; when they run out, the MD-verified reset is the path.
- **Not done:** backup restore not yet tested (Phase C); no independent penetration test; legal (DPDP) review pending.

## Post-audit corrections (audit remediation of 1 Nov 2026 (migration 0034, not yet committed))
- **H-1:** quarantine was not enforced by the in-app viewer. It is now enforced there too (migration 0034).
- **M-2:** the bulk-access alert now counts in-app views and portal downloads, not only staff downloads.
- **M-1:** client addresses came from the client-controlled first `X-Forwarded-For` entry. They are now taken only from the trusted proxy configured in `TRUST_PROXY` (see DEPLOYMENT.md §3a). An unknown address no longer shares one rate-limit bucket.
- **Evidence:** the tests are listed in SECURITY_EVIDENCE_REGISTER.md (E-X1…X4).
