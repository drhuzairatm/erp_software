# Staff Portal – Dr.Expert Edulinks & GRADUATER (MVP)

Internal web application for student admissions operations shared by **Dr.Expert Edulinks** and **GRADUATER**.
Separate from, and does not modify, the Leadist CRM.

> All data shipped with this project is **fictional** (names, `+91 90000 xxxxx` phone numbers, `@example.test`
> emails, placeholder PDFs). Do not load real student information until the UAT checklist is signed off.

## What it does

| Module | Highlights |
|---|---|
| Staff login | Argon2id passwords, two-factor login (authenticator app, recovery codes), rate-limited sign-in, 12-hour sessions with 8-hour idle timeout, admin-issued setup/reset links |
| Companies & roles | MD (locked super admin) → CEO → managers and staff; per-company roles, departments; nobody can grant more than they hold |
| Students | Server-generated Student IDs, previous-education country (separate from destination), passport details (permission-protected), CSV bulk import with preview, search/filters/pagination, contact-detail masking, duplicate warnings across brands, controlled merge, archive |
| Universities | Campuses, courses offered with admission requirements, intakes and deadlines, university-specific required documents added automatically to students' checklists |
| Admission workflow | 14 configurable stages, country/course-specific workflows, permission per stage, warnings, full stage history |
| Documents | In-app PDF viewer (pages, zoom, text selection, highlights + comments per version), configurable verification rules (mandatory wording, keywords, manual checks) with versioning and MD approval, immutable verification records, verify → submit → **manager approval by a different person**, checklist per workflow and university, private uploads (PDF/JPEG/PNG/WebP ≤ 10 MB, content-sniffed), versioning, review statuses, rejection reasons, expiry, physical-original custody tracking, 60-second signed links |
| Tasks | Assignment, priorities, due dates, overdue / due today / upcoming / unassigned / waiting views, delay reasons (internal vs external), comments, history |
| Payment ledger | Charges, receipts, waivers, refunds, disbursements, reversals; second-person verification; service vs third-party money kept apart; no edits/deletes |
| Timeline & audit | Per-student activity timeline; append-only audit log of changes, file access, exports, logins, denied attempts |
| Dashboards | Company and consolidated MD dashboards, filters, click-through cards, objective workload indicators |
| Reports | 8 reports, permission-checked CSV export (audited, formula-injection safe) |
| Student portal | `/portal`: students sign in with a one-time code (email/WhatsApp), see their stage, next step and document checklist, and upload requested documents; own record only; no internal or financial data |
| Alerts & notifications | In-app alerts; email (your business mailboxes) and WhatsApp (Gallabox) messages on configurable events, consent-based, per-brand templates, outbox with delivery status, test mode; SMS ready once a DLT provider exists |

## Quick start (local development)

Requirements: Node.js 24 LTS. No Docker or admin rights needed — a local PostgreSQL 17 runs from `node_modules`.

```bash
cp .env.example .env            # then replace every CHANGE_ME value (see below)
npm install
npm run db:start                # terminal 1: local PostgreSQL (keep running)
npm run db:reset                # terminal 2: create schema + fictional demo data
npm run dev                     # http://localhost:3000
```

Generate random values for `.env` with:
`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`

### Demo accounts (fictional, local only)

Password for all: the value of `SEED_DEMO_PASSWORD` in your `.env`. Locally `MFA_ENFORCE=off`, so two-factor login is optional for demo accounts (each user can still turn it on under their name → 2FA).

| Email | Role(s) |
|---|---|
| md@demo.test | **Managing Director** – master super admin in both companies (everything, incl. financial amounts) |
| ceo@demo.test | **CEO** in both companies – operations; payment counts only, no amounts |
| admin@demo.test | System Administrator in both (no student data by default) |
| edx.manager@demo.test / grd.manager@demo.test | Company Manager |
| edx.counsellor@demo.test, edx.counsellor2@… / grd.counsellor@…, grd.counsellor2@… | Sales / Counsellor |
| docs@demo.test, docs2@demo.test | Documentation Staff (Edulinks central processing) |
| visa@demo.test | Visa Coordinator (Edulinks) |
| edx.finance@…, edx.finance2@… / grd.finance@…, grd.finance2@… | Finance Staff (two per company, so verification by a second person can be tested) |

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / run |
| `npm run db:start` | Local PostgreSQL (development only) |
| `npm run db:migrate` | Apply new migrations (uses `DATABASE_ADMIN_URL`) |
| `npm run db:provision` | Install companies, default roles and reference data (idempotent) |
| `npm run db:seed` | Load fictional demo data (refuses production) |
| `npm run db:reset` | Drop and rebuild the **local** database with demo data |
| `npm run admin:create -- --email … --name "…"` | Create the first administrator; prints a one-time setup link |
| `npm test` | Unit + integration tests (starts its own throwaway PostgreSQL) |
| `npm run test:e2e` | Browser tests (needs the dev database with demo data and Google Chrome) |
| `npm run check` | Typecheck + lint + tests + production build |
| `npm run docs:permissions` | Regenerate docs/ROLE_PERMISSION_MATRIX.md from the database |
| `npm run docs:schema` | Regenerate docs/DATABASE_SCHEMA.md from the database |

## Project layout

```
db/migrations/        Versioned SQL: schema, row-level security, functions, system data
scripts/              Local DB, migrations, provisioning, demo seed, admin creation
src/server/           Server-only code: auth, DB access, services, storage, validation
src/app/(auth)/       Login, forgot/reset password
src/app/(app)/        Application pages (dashboard, students, tasks, payments, reports, admin, audit)
src/app/actions/      Server actions (form handlers)
src/app/api/          File access, signed local file serving, CSV export, health check
tests/integration/    Database isolation + service tests (Vitest)
tests/e2e/            Browser tests (Playwright)
docs/                 Architecture, security, deployment, backup, user guide, UAT checklist, roadmap
```

## Documentation

- [Architecture, data model and permissions](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md) (generated: `npm run docs:schema`)
- [Role and permission matrix](docs/ROLE_PERMISSION_MATRIX.md) (generated: `npm run docs:permissions`)
- [Security report](docs/SECURITY_REPORT.md)
- [Cloud deployment (staging and production)](docs/DEPLOYMENT.md)
- [Backup and recovery](docs/BACKUP_RECOVERY.md)
- [Document verification and approval](docs/DOCUMENT_VERIFICATION.md)
- [Country rules](docs/COUNTRY_RULES.md)
- [Notifications: email, WhatsApp, SMS](docs/NOTIFICATIONS.md)
- [User guide by role](docs/USER_GUIDE.md)
- [User acceptance testing checklist](docs/UAT_CHECKLIST.md)
- [Known limitations, open decisions and roadmap](docs/LIMITATIONS_AND_ROADMAP.md)
