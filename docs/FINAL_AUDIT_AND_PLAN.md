# Final master directive: Step 1–5 audit, gap report and prioritized plan (1 Nov 2026)

Status today: **NOT READY FOR PILOT**. There is no staging environment yet, and the staff account lifecycle has gaps (see section 3). All findings below come from inspecting the code and database and running the tools named. Nothing is assumed.

## 1. Existing architecture (discovered)
| Area | What exists |
|---|---|
| Frontend | Next.js 16 App Router, React 19, Tailwind v4; server components + server actions; one staff login portal; separate student/parent portal (`/portal`) |
| Backend | Server actions + route handlers (`/api/files`, `/api/students/:id/photo`, `/api/staff/:id/photo`, cron routes); services in `src/server/services` |
| Database | PostgreSQL 17; 31 versioned migrations with rollbacks (≥0017); **row-level security on every table**; app connects as low-privilege `erp_app` (NOBYPASSRLS); permission checks in SQL (`app.has_perm`, `app.can_read_student` …) |
| Authentication | Own implementation (no external provider): Argon2id passwords, 256-bit session tokens (hash stored), TOTP 2FA with encrypted secrets and hashed recovery codes, login rate limiting (5/email, 30/IP per 15 min), password reset tokens, audit of every attempt |
| Users/roles | `user_profiles`, `organization_memberships` (user × company × role × department), `roles` (per company, custom roles, hierarchy), `role_permissions`, 100+ permission keys; MD role protected; no-escalation rules in DB functions |
| Companies | EDX and GRD with company-scoped data; MD across both; company switcher validated server-side |
| Storage | Private bucket (local driver for dev, S3-compatible for production); random keys; 60-second signed links after DB authorization; type detected from content; 10 MB documents / 5 MB photos |
| Notifications | Email per brand (SMTP), WhatsApp (Gallabox), test mode by default, consent records, outbox; **not configured** (no credentials) |
| Payments | Manual multi-currency ledger (no payment gateway, no card data); CEO sees counts only |
| Tests | 25 integration files / 221 tests (vitest, real database); 49 browser tests (Playwright) |
| Deployment | `vercel.json` (cron jobs); docs/DEPLOYMENT.md targets Vercel + Supabase; **no hosting account, staging or production exists yet**; **no GitHub remote** (local git only, 18 commits) |
| Docs | Architecture, schema, permission matrix, security report, backup/recovery, user guide, UAT checklist, module reports |

## 2. Verified today
- `npm audit --omit=dev`: **0 vulnerabilities** in shipped code. With development tools: 15 moderate (ESLint's `minimatch`, development only).
- Secret scan of the full git history: **no real secrets**. Only throwaway passwords for the local, temporary test database (`tests/` config). `.env` is not committed; `.env.example` holds placeholders only.
- Full automated suite (earlier today): 221/221 integration tests, 48/49 browser tests passed, 1 skipped (courier test depends on leftover demo data; it should create its own data).

## 3. Gap report
**Severity scale:** Critical = breach or data loss; High = authentication, permission or workflow failure; Medium = notifications, reports or inconsistencies; Low = cosmetic.
No **Critical** findings: no way to bypass access control was found in the code or tests. To be confirmed by the security tests in Step 11.

| # | Gap | Severity | Today |
|---|---|---|---|
| G1 | Staff account states: only active/inactive. No *Invitation pending / accepted / Suspended / Employment terminated* | High | `user_profiles.is_active` |
| G2 | Employee onboarding is a password-setup link shown to the admin; no invitation record, expiry status, resend, or email delivery; email ownership not verified | High | admin "reset link" (24 h) |
| G3 | Employee fields missing: mobile, joining date, employment status, designation (job title exists) | Medium | — |
| G4 | No "sign out everywhere" (revoke sessions) action for admins except by deactivating | High | session revocation exists internally |
| G5 | No bulk reassignment of a leaving employee's open tasks | Medium | tasks editable one by one |
| G6 | MD bootstrap is a command-line script (good: not reachable from the web) but it does not refuse to create a **second** MD or record a bootstrap audit event | High | `npm run admin:create` |
| G7 | 2FA required only for MD, CEO, administrators and finance (`MFA_ENFORCE=roles`) | Medium | setting exists; `all` recommended |
| G8 | **No malware scanning of uploads**; files are treated as safe after type checks | High | type sniffing, size limits, never executed, sandboxed |
| G9 | No security alerts to the MD (repeated failed logins, privilege changes, large exports); no per-user login history screen | Medium | all events in the audit log |
| G10 | CSP allows inline scripts (Next.js without nonces) | Medium | strict otherwise |
| G11 | No passkeys / hardware keys | Low | TOTP 2FA |
| G12 | Backup restore never actually tested | High | backup script + documented procedure |
| G13 | One skipped browser test (courier) | Low | — |
| G14 | Missing security documents: threat model, risk register, ASVS evidence matrix, incident response, onboarding guide, pilot plan, bug register | Medium | security report exists |
| G15 | Admissions scenarios A–L: most covered by module tests; no single end-to-end scenario suite | Medium | module tests |

### Blocked by external setup (needs you, cannot be done in code)
- Hosting accounts for **staging and production** (database, storage, app hosting), domain, DNS, HTTPS certificate.
- Email provider credentials (needed for real invitations and password emails).
- GitHub (or similar) repository with MFA and branch protection. Today the code exists only on this Mac.
- Malware scanning engine: ClamAV cannot run inside Vercel's serverless functions; it needs a small server/container or a scanning service.
- Real-device testing (iPhone, Android, Windows, Safari, Edge, Firefox), an OWASP ZAP scan against staging, an independent penetration test, and legal review (DPDP Act 2023).
- Payment gateway: none is integrated (payments are recorded manually), so webhook/PCI items do not apply unless you add one.

## 4. Prioritized plan (each phase needs your approval)
| Phase | Work | Fixes |
|---|---|---|
| **A. Accounts** | Migration 0032: staff account states and employee fields; invitations (7-day expiry, resend, cancel; accepted = email verified; email sent when a provider is configured, else link shown to the admin once); 2FA set up during acceptance for required roles; "sign out everywhere"; suspend / deactivate / terminate (revokes sessions, blocks login, keeps history); bulk task reassignment; MD bootstrap refuses a second MD and is audited | G1–G6 |
| **B. Security hardening** | Upload scan status on every file (*Not scanned / Clean / Infected-quarantined*) with ClamAV when configured; unscanned files flagged to staff; infected files blocked; security alerts to the MD; login history per user; nonce-based CSP; `MFA_ENFORCE=all` recommendation | G7–G10 |
| **C. Verification** | Admissions scenario suite A–L, document/courier lifecycle test incl. direct-URL/API checks, permission/IDOR/cross-company tests, fix the skipped test, local backup-and-restore test into an isolated database | G12, G13, G15 |
| **D. Documents** | Threat model + risk register, ASVS 5.0 evidence matrix, incident response, onboarding guide, staging/deploy/rollback guide, pilot plan + bug register, final readiness report | G14 |
| **E. Staging** (needs accounts from you) | Set up staging, ZAP scan, real-device tests, pilot | external |

Passkeys (G11) would add a new dependency; I suggest leaving them for after the pilot.
