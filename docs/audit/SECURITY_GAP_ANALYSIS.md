# Security gap analysis (OWASP ASVS 5.0.0-oriented, read-only)

**Date:** 2 November 2026.

This is a **code, configuration and test-evidence review**. It is not a penetration test:
- no destructive testing
- no production systems (none exist)
- no external scanning

Finding IDs refer to CONSOLIDATED_FINDINGS_REGISTER.md. The existing threat model stays authoritative: SECURITY_THREAT_ASSESSMENT.md, SECURITY_REPORT.md and SECURITY_EVIDENCE_REGISTER.md.

**Status:** Effective (evidence today) · Effective (prior evidence) · Partial · Gap · Not Tested.

| Area (ASVS chapter, approx.) | Control in place | Evidence | Status | Gaps |
|---|---|---|---|---|
| **Authentication (V6)** | Argon2 password hashes (`@node-rs/argon2`) [SRC]. Per-email, per-browser lock-out with an atomic reservation (N-1). Reset requests rate-limited and not counted as failures. Generic error messages. | `auth-rate-limits.test.ts` (20 parallel attempts → exactly 5 checked) [RUN] | Effective | Edge/IP rate limiting missing (A-06). |
| **Multi-factor (V6)** | TOTP for every user in production. Secrets AES-256-GCM encrypted with a key outside the database. Replay refused. Recovery codes hashed. | `mfa.test.ts`, `phase-b.test.ts` [RUN] | Effective | Development runs `MFA_ENFORCE=off`, so browser tests do not cover the MFA path. |
| **Session management (V7)** | Opaque token, hashed in the database. Cookies `httpOnly`, `SameSite=Lax`, `Secure` in production. 12 h absolute, 8 h idle. "Sign out everywhere"; suspension revokes sessions. | [SRC] `session.ts:13,56-60`; `0012:274`; `phase-a.test.ts` [RUN] | Effective | none found |
| **Authorization (V8)** | Row-level security on 89 of 90 public tables (the 90th, `schema_migrations`, is closed to the app role). Permission checks in `app.*` functions. No self-escalation: a grant requires holding the permission and not holding the target role. Protected single MD. | [DB] counts; `security-matrix.test.ts`, `db-isolation.test.ts`, `phase-c.test.ts` [RUN] | Effective | N-3 (alerts across companies). A-03 (PUBLIC execute; matters only on hosts with extra database roles). |
| **IDOR / multi-company** | Every read goes through RLS with company scope. File links are short-lived and HMAC-signed after a permission check. | `db-isolation.test.ts`, isolation matrix [RUN]; e2e `isolation.spec.ts` [PRIOR] | Effective | none found |
| **Injection: SQL (V1)** | postgres.js tagged templates everywhere. 2 `unsafe` fragments use fixed values only. | [SRC] `students.ts:68`, `dashboard.ts:19` | Effective | N-5: the app server is the trust boundary (by design). |
| **XSS (V3)** | React escaping. No `dangerouslySetInnerHTML` [SRC]. Nonce-based CSP with `strict-dynamic`; no inline scripts. | [SRC] `src/proxy.ts`; e2e `security-phase-b.spec.ts` [PRIOR] | Effective | L-3: `style-src 'unsafe-inline'` and `'wasm-unsafe-eval'` (accepted). |
| **CSRF (V3/V4)** | Server Actions (Next.js origin check). The only state-changing API route (combined-PDF `POST`) checks Origin against Host. Cookies `SameSite=Lax`. | [SRC] `api/students/[id]/merge/route.ts:13-14` | Effective | No automated CSRF test of the Origin check. |
| **SSRF (V1/V13)** | Outbound requests go only to configured providers (Resend, Gallabox, scanner URL). No user-supplied URL is fetched. | [SRC] the 3 `fetch` calls on the server | Effective | none found |
| **File upload (V5)** | Allow-listed types, magic-byte check (e2e: disguised file refused), size limits, random storage names, private storage. Scan status, quarantine and manual clearance (Phase B, H-1). Files served with `default-src 'none'; sandbox` and `nosniff`. | `phase-b.test.ts`, `audit-remediation.test.ts` [RUN]; e2e `phase-i` [PRIOR] | Partial | **No scanner configured (A-07).** Attestation evidence has no scan status (N-2). |
| **Malware protection** | ClamAV and HTTP-scanner integrations exist. The fail-safe is MD manual clearance. | [SRC] `scanner.ts` | **Gap (external dependency)** | Connect a scanner and test with EICAR on staging. |
| **Secrets (V13)** | Secrets in the environment only. `.env` git-ignored. No secrets in tracked files. Separate test credentials. The key derivation for N-8 is documented with rotation impact. | [RUN] git grep; `.gitignore` | Effective (local) | No secret manager or host yet. No off-machine code copy (N-6). |
| **Sensitive data exposure** | Reset links, portal links and sign-in codes are kept out of staff screens (N-1, N-7; N-8 in the working tree). Redacted status rows. Masked provider errors. CEO sees no amounts. | `staff-email-outbox`, `portal-link-queue`, `auth-message-queue`, `multi-currency` tests [RUN] | Effective for N-1 and N-7; **N-8 pending commit (A-01)** | A-04: tokens in request logs. |
| **HTTP headers (V3)** | CSP (per request), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (camera self only), COOP, HSTS in production, no `X-Powered-By`. | [SRC] `next.config.ts`, `src/proxy.ts`; e2e header test [PRIOR] | Effective | HSTS preload and the domain are not set (no domain yet). |
| **CORS** | No CORS headers are sent, so the browser's same-origin rule applies. | [SRC] no `Access-Control-*` | Effective | none found |
| **Rate limiting** | Application-level only (see Authentication). | [SRC], tests [RUN] | Partial | A-06 |
| **Audit log protection (V16)** | `erp_app` has **no** INSERT, UPDATE, DELETE or TRUNCATE on `audit_logs`; writes only through definer functions; 3 triggers. | [DB] privileges | Effective | No archiving or retention (A-12). No off-host log shipping (A-08). |
| **Database security** | `erp_app`: not superuser, no BYPASSRLS, cannot create in `public` or `app`, no access to `auth_private`. 263 definer functions, all with a fixed `search_path`. | [DB] | Effective | A-03, N-4 before Supabase-style hosting. |
| **Dependencies (V15)** | `npm audit`: 0 critical, 0 high, 15 moderate (ESLint toolchain, development only). | [RUN] | Effective | No automated dependency alerts (no repository host, N-6). |
| **GitHub / repository security** | **No remote repository.** | [RUN] | **Gap** | N-6: private repository, 2FA, branch protection, secret scanning. |
| **Payment security** | No payment gateway; the ERP records payments. Second-person verification, reversal instead of deletion, audited rate corrections. | `multi-currency.test.ts`, e2e `workflow` [RUN/PRIOR] | Effective | none for the current scope |
| **Backups** | Backup scripts (`db:backup`, `pg_backup_start`/`stop`). A restore drill passed 31/31 checks on 1 Nov. Development backups exist in `.data/backups` (owner-only folder). | [DOC] BACKUP_RESTORE_DRILL.md [PRIOR] | Partial | No off-site or automated backups (no host). File storage backup not defined until S3 is chosen. |
| **Incident response** | INCIDENT_RESPONSE_PLAN.md; security alerts; login history. | [DOC] | Partial | No monitoring or alerting to wake someone (A-08). Not exercised. |
| **Logging (V16)** | Structured JSON errors. No passwords, codes or document contents logged; the N-8 test checks console output for codes. | `auth-message-queue.test.ts` [RUN] | Partial | A-04 (token URLs in request logs). No central log store. |

## Risky tests not performed (approval needed)

These were deliberately **not** run. Each would need your explicit approval and a suitable environment:

1. **Real-provider tests** (email, WhatsApp) with a fictional student and your own address or number, on staging.
2. **EICAR malware test file** through upload, once a scanner is connected (staging).
3. **Authenticated dynamic scan** (for example OWASP ZAP) against a **staging** deployment with fictional data.
4. **Load test** of sign-in and upload on staging.
5. **Browser tests on WebKit and Firefox.** Installing Playwright's extra browsers downloads software, which you have not approved.
