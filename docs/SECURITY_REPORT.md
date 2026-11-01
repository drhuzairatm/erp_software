# Security report

## Cross-company data leaks – how they are prevented

| Risk | Control | Verified by |
|---|---|---|
| Page/API forgets to filter by company | Row-level security on **every** table; app connects as `erp_app` (not owner, `NOBYPASSRLS`). No user context → zero rows. | `tests/integration/db-isolation.test.ts` |
| Guessed/edited record IDs in URLs | Same RLS; pages return a plain 404 without confirming existence | e2e `isolation.spec.ts` |
| Child record linked to another company's student | Triggers/policies require the task/payment/assignment company to have access to the student; role–company foreign key | db-isolation + services tests |
| Browser sends a different company ID or role | Company scope cookie is validated against memberships; permissions loaded server-side; DB re-checks | services tests (`grd.manager` asking for EDX) |
| Document file links shared or guessed | Files in a private bucket under random keys; `/api/files/:id` authorizes in the DB, audits, then redirects to a **60-second** signed URL; storage keys are not readable by the app role | services + e2e tests |
| Bypassing verification or approval | Status changes only via database functions; mandatory checks re-validated at verify and approve; approver ≠ verifier/submitter; new version resets everything; verification records and comments append-only | phase-c tests + e2e |
| Document contents sent to third parties | PDF text is read in the reviewer's browser only; viewer assets served from the portal (no CDN); no OCR service | design |
| Passport details exposure | Separate sensitive permission; not readable from the base table; masked in views, search and exports; redacted in the audit log | phase-b tests + e2e |
| Unwanted or unlawful messaging | Consent per channel and recipient, append-only history; rules off by default; test mode default; provider credentials only in environment; outbox visible only to contact-permitted roles | phase-h tests + e2e |
| Student portal access to other students' data | Portal data only via `app.portal_*` functions keyed by the session token (never a student id from the browser); one-time codes (HMAC-stored, 10 min, 5 tries, rate-limited per identifier and IP, single use); same response for unknown identifiers; separate cookie scoped to /portal; 30 min idle / 4 h sessions; sign-in codes hidden from non-outbox staff and removed after sending | phase-i tests + e2e |
| Exports leaking data | Exports run the same RLS-filtered queries; require `reports.export` (+ `.pii` / `.finance` for sensitive reports); every export and denied attempt is audited | services tests |
| Privilege escalation | Grant only what you hold; assign only roles within your own permissions; privileged roles need `users.create_admin`; MD role locked; no self-edits; all grants audited | db-isolation + phase-a tests |
| Account takeover via admin reset | Password/2FA resets and deactivation only for people whose access is within yours (e.g. an administrator cannot reset the MD) | phase-a tests |
| CEO seeing financial amounts | `payments.status` returns counts only via a database function; ledger, balances, payment events, finance reports and audit log refused by RLS | phase-a tests + e2e |
| Duplicate detection revealing another brand's data | Only "a record exists in <company>" is shown when the user cannot read it | services + e2e tests |
| Edulinks sales seeing GRADUATER pipeline | Processing access uses a separate permission (`students.read.processing`) not given to counsellors | db-isolation tests |

## Other controls

- **Passwords**: Argon2id (19 MiB, t=2); min 12 chars with 3 character classes; hashes live in
  `auth_private` and are only reachable through narrow functions.
- **Login protection**: 5 failed attempts per email / 30 per IP in 15 minutes → temporary block (the IP comes only from the trusted proxy set in `TRUST_PROXY`; unknown IP = per-IP limit skipped, see DEPLOYMENT.md §3a); generic
  error messages; constant-time-ish verification for unknown accounts; all attempts audited.
- **Two-factor login**: TOTP (RFC 6238) via authenticator apps; secrets encrypted with AES-256-GCM using a key held outside the database (`MFA_ENCRYPTION_KEY`); codes cannot be replayed; 10 single-use recovery codes stored hashed; 5 wrong codes cancel the sign-in; a password-only session cannot use any page or API until the code is entered. **Required for every user** (MD decision, Phase B); production builds always enforce it. Resets only with `users.mfa_reset` (MD by default) and a note of how identity was verified.
- **Sessions**: random 256-bit tokens, only SHA-256 hash stored; httpOnly + SameSite=Lax (+ Secure and
  `__Host-` prefix in production); 12 h absolute, 8 h idle; deactivating a user or resetting a password
  revokes sessions.
- **Password reset**: one-time tokens (hash stored), 1 h (self-service) / 24 h (admin-issued); the
  forgot-password form never reveals whether an account exists; it does not claim an email was sent
  unless email delivery is configured.
- **CSRF**: Next.js Server Actions check the Origin header; cookies are SameSite=Lax; state-changing
  operations are POST-only.
- **XSS / injection**: React output encoding; no `dangerouslySetInnerHTML`; parameterized SQL only
  (postgres.js tagged templates); whitelisted sort/filter values; Zod validation on all forms; CSV cells
  starting with `= + - @` are neutralised.
- **Headers**: strict Content-Security-Policy with a per-request nonce (no inline scripts; Phase B), `frame-ancestors 'none'`, X-Frame-Options DENY, nosniff,
  Referrer-Policy, Permissions-Policy, HSTS (production), `X-Powered-By` removed; reset-password pages
  use `no-referrer`.
- **Uploads**: type detected from file content (PDF, JPEG, PNG, WebP), 10 MB limit, safe filenames,
  never auto-approved; served with `Content-Disposition`, nosniff and a sandbox CSP. Virus-scan status,
  quarantine and manual clearance (Phase B): approval and courier release need a clean scan or an audited
  manual clearance.
- **Errors/logs**: users see generic messages; unexpected errors are logged server-side as JSON without
  request bodies; document contents, passwords and tokens are never logged.
- **Audit log**: append-only (update/delete/truncate blocked by triggers), records actor, company,
  student, before/after values, IP, outcome. Phone, email, date of birth and passport number are **redacted**
  (the log shows "(changed)"), so audit readers without contact/passport permission cannot see them; storage keys excluded.
- **Least privilege at the platform**: migration `0010` strips Supabase `anon`/`authenticated` roles; the
  admin/owner database URL must never be set in the hosting runtime.

## Residual risks and recommendations

**Superseded (1 Nov 2026):** the current, complete risk list is **SECURITY_THREAT_ASSESSMENT.md**, and test evidence is in **SECURITY_EVIDENCE_REGISTER.md**. Since this report was first written:
- two-step login became mandatory for all
- the browser policy became nonce-based (no inline scripts)
- virus-scan status, quarantine and security alerts were added
- **N-1 (migration 0035):** password resets no longer lock people out; trusted browsers keep their own sign-in limit; reset requests are rate-limited; reset links go through an encrypted queue that staff cannot read (SECURITY_THREAT_ASSESSMENT.md T1)

Still open:
- **N-7 (High):** fixed in development (migration 0036, not yet committed): student-portal set-up and reset links now go only through an encrypted queue that staff cannot read (SECURITY_THREAT_ASSESSMENT.md T3)
- **Adjacent to N-7:** in test mode, portal sign-in codes and email-verification links stay readable to outbox holders (awaiting decision)
- edge rate limiting
- a real virus scanner
- watermarking
- retention policy
- independent penetration test
