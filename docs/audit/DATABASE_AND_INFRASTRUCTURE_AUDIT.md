# Database and infrastructure audit

**Date:** 2 November 2026.

Every database figure below comes from **read-only** queries on the development database (`erp_dev`, port 54329, PostgreSQL 17.11):
- The session ran with `default_transaction_read_only = on`; a test write was refused (SQLSTATE 25006).
- Counts only. No record contents were read or reported.

The schema reference is DATABASE_SCHEMA.md. Its regeneration with `npm run docs:schema` is still outstanding for 0037 and was not done during this audit.

## 1. Schema and migrations

| Item | Result |
|---|---|
| Migrations applied | **37**: 0001 to 0037. 0037 (N-8) is applied to development but **not committed**. |
| Migration safety | sha256 checksum guard on applied files. Rollback files for recent migrations (`db/rollbacks/`). `db:reset` and rollback refuse non-local or production databases (`scripts/migrate.ts:16,25`). |
| Exact rollback tested | 0036 and 0037 (and earlier N-1), on the isolated test database only (`portal-link-db-security.test.ts` [RUN, passed today]; `auth-message-db-security.test.ts` [RUN]). The development database was **not** rolled back. |
| Tables | `public` 90 (RLS on 89), `auth_private` 17 (no RLS; the schema is closed to `erp_app`). |
| Constraints | 306 foreign keys and 308 CHECK constraints; **0 constraints not validated**. |
| Foreign-key indexes | 212 of 306 foreign keys have no index whose leading columns match (heuristic; A-11). |
| Functions | 291 in `app`: 263 SECURITY DEFINER, **0 without a fixed `search_path`**, 173 executable by PUBLIC (A-03). |
| RLS policies | 149 policies on 89 tables (unchanged by 0037 except the `messages_select` text). |
| Roles | Login roles: `postgres` (superuser) and `erp_app` (no superuser, no BYPASSRLS, no CREATEROLE or CREATEDB, no CREATE on `public`, `app` or the database, no USAGE on `auth_private`). |
| Audit records | `erp_app` cannot write, change or delete `audit_logs` directly. Triggers on `audit_logs` (3), `payment_entries` (6) and `contact_consents` (2). |
| Size | 38 MB |

## 2. Data integrity (development database)

| Check | Result |
|---|---|
| Students | 367: 49 demo-flagged, 318 without the flag (L-5; created 31 Oct–1 Nov by test runs, test-pattern names, `example.test` addresses or no email). |
| Staff accounts | 61 (all `@example.test` or `@demo.test`). |
| Companies | 2. Roles: 16 (8 per company). Permissions: 84. |
| Master data | 34 countries, **14 of them "Testland …"** created by browser tests (L-5). 26 universities. |
| Secret queues | `auth_message_outbox`: 8 rows, all `test`, **0 pending secrets**. `staff_email_outbox`: 5 `skipped`. `portal_email_outbox`: empty. |
| Duplicates and referential integrity | All foreign keys are validated, so no orphans are possible for them. Duplicate detection runs at registration (phone, email). No duplicate scan of existing records was run, because it would read record contents. |
| Retention | Not defined (A-12). The audit log grows indefinitely. |

## 3. Infrastructure (actual state)

| Area | Actual state | Status |
|---|---|---|
| Development | One macOS laptop. Embedded PostgreSQL 17 (`.data/pg`), local file storage (`.data/storage`), `next dev`. Node 24.22.2. | Present |
| Staging | **None** | Missing |
| Production | **None** (not deployed) | Missing |
| Environment separation | `.env` (development) and test values in `vitest.config.ts`. The N-8 startup guard enforces `NOTIFICATIONS_MODE=live` in production and `APP_ENV=staging` for staging; it fails closed with HTTP 500 rather than exiting (A-02). | Partial |
| Database separation | Development (54329) and throwaway test (54339) are separate. Browser tests write into development (L-5). | Partial |
| HTTPS, domain, DNS | Not configured (no host). HSTS and `upgrade-insecure-requests` are switched on in production builds. | Missing (external) |
| Scheduled jobs | `vercel.json`: notifications every minute, daily at 20:30 UTC. A VPS needs a system cron (DEPLOYMENT.md). Not tested on a real host. | Not Tested |
| Email | SMTP per company and Resend implemented; none configured. | Not configured |
| WhatsApp | Gallabox implemented; request format unconfirmed with a real account. | Not configured |
| Malware scanning | Integration implemented; no scanner (A-07). | Missing (external) |
| File storage | Local driver in development. S3 driver implemented but **never run against a real bucket**. | Not Tested |
| Database backups | Scripts plus a restore drill (31/31 passed on 1 Nov) [PRIOR]. No schedule and no off-site copy. | Partial |
| File backups | Not defined until storage is chosen. | Missing |
| Monitoring, logging, error reporting | `/api/health`; JSON console errors. No uptime monitor, error tracker or log shipping (A-08). | Missing |
| Deployment workflow and CI | Manual; no CI (no repository host, N-6). | Missing |
| Rollback procedure | Migration rollback files and procedure (DEPLOYMENT.md, BACKUP_RECOVERY.md). Application rollback depends on the host. | Partial |

## 4. Manual configuration still required (none performed)

1. Choose the host and region; create staging and production (HOSTING_EMAIL_SCANNER_OPTIONS.md).
2. Domain and DNS; HTTPS; `APP_URL`; `TRUST_PROXY` matching the real proxy.
3. Production database with `erp_app` (`npm run db:provision`). Before any host that adds database roles: apply the PUBLIC-execute revoke (A-03) and the `schema_migrations` RLS (N-4).
4. All secrets: `STORAGE_SIGNING_SECRET`, `MFA_ENCRYPTION_KEY` (backed up in a password manager), `CRON_SECRET`, `PORTAL_SECRET`.
5. `NOTIFICATIONS_MODE=live` in production; never `NOTIFICATIONS_TEST_MAILBOX`.
6. Email (SMTP per company or Resend) with SPF and DKIM; Gallabox keys, channel IDs and approved templates.
7. S3 bucket (private, versioning, lifecycle) and its backup.
8. Virus scanner (ClamAV or a service) and `SCANNER_*` settings.
9. Per-minute and daily cron with `CRON_SECRET`.
10. Automated database backups with off-site copies, plus a scheduled restore drill.
11. Uptime monitoring, error reporting, log retention.
12. A private Git repository with 2FA and branch protection (N-6).
