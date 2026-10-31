# Known limitations, open decisions and roadmap

## Known limitations of this MVP

| Area | Limitation |
|---|---|
| Deployment | Not deployed. Cloud steps are documented but untested against real accounts. The S3 storage driver is implemented but has only been exercised through code review and type-checking, not against a real bucket. |
| Authentication | Two-factor login via authenticator app (no SMS codes, no single sign-on). Self-service disabling/regenerating recovery codes is not available; an administrator resets 2FA. |
| Email | Password-reset and account-setup emails require `RESEND_API_KEY`; without it, admins hand out one-time links. No other notifications are emailed. |
| Notifications | Email (SMTP) and WhatsApp (Gallabox) built and tested with simulated providers only; the Gallabox request format must be confirmed with your account; no delivery/read receipts or inbound STOP handling yet (record withdrawals manually); SMS needs DLT registration and a provider. In-app alerts have no "read" state. |
| Finance | Basic ledger only: no invoices, tax, receipts PDF, multi-currency conversion, or accounting integration. Balances are grouped per currency. |
| Workflow | Stage rules are permission- and warning-based; no configurable approval chains or SLA timers per stage. Changing a workflow adds new required documents for students when their country/course changes, not retroactively for all students. |
| Documents | Text detection works only for PDFs that contain text (not scans); no OCR yet. Comments cannot be edited or deleted (by design). Images can be viewed and commented on, but not highlighted. No virus scanning (files are type-checked by content). |
| Verification rules | All current rules are [PLACEHOLDER] demo examples; the approved wording per country must be supplied. |
| Search | Simple matching (ID, name contains, phone, exact email); no fuzzy search. Phone search requires contact permission. |
| Reports | Fixed set of 8 reports; exports capped at 5,000 rows. |
| Dates | Business dates use `Asia/Kolkata` (configurable via `APP_TIMEZONE`). |
| Audit | The audit log has no automatic archiving; it grows indefinitely. |
| Reference data | Countries (incl. Bulgaria, Egypt, Gulf countries), courses and demo universities are **placeholders** until the real lists are supplied. |
| Student portal | Sign-in codes reach students only once email/WhatsApp are configured and live; no portal for parents; no messaging/chat with staff; English only; attestation progress will appear after Phase D. |
| Import | CSV only (no .xlsx); max 1,000 rows / 2 MB per file; values must match configured countries/courses/universities/lead sources; no update of existing students. |
| Tests | 138 automated (unit + integration) and 21 browser tests cover the critical paths; not every UI permutation is covered. No load testing. No independent penetration test. |
| Platform | Developed on macOS with Node 24 and a local PostgreSQL 17 (no Docker). |

- Attestation routes in the demo are **[TO CONFIRM]** examples from the brief; production starts with none. Expected days are informational only (no SLA alerts yet).
- An attestation covers one file version. Physical courier/original-document tracking for attestation is not yet linked to stages.

- Phone numbers are validated but never verified (no SMS/WhatsApp verification yet). Numbers without "+" and without a country are treated as Indian (CSV imports).
- Passport alerts are delivered as tasks; the staff Notification Centre (with read/unread and escalation messages) is a later phase. Expiry tiers (12/6/3 months) are fixed as specified; minimum-validity rules are configurable but "pathway" is represented by course.
- Email verification needs a working email provider in live mode; in test mode links can only be opened from the outbox.

- Name checks compare the passport holder name with certificate names recorded in the Academic tab (typed by staff; OCR is not used). They need the holder name on the Passport tab.
- One and Same requests by message use the notification rules (off by default, consent required); otherwise record a manual request. No real One and Same wording has been supplied yet.
- Bonafide rules cannot yet be conditioned on nationality (the Qatar-school rule is scoped by previous education country, destination and university). The generic AND/OR rule engine is Phase 4.

## Decisions recorded (Nov 2026)

- Portal sign-in: students need a **password** login (Phase 6 — to confirm then whether one-time codes stay as an alternative).
- Leads come from **both** this ERP and the Leadist CRM (Phase 9: own lead module plus an import/integration; Leadist itself is not modified).
- Super admins (MD; System Administrator) add countries, courses, universities and attestation routes in the app.
- Passport validity of **12 months or more is mandatory** (installed as a blocking rule from University Application).
- Secondary phone and email are required from **University Application** (confirmed).

## Decisions still needed from the business

1. Legal/accounting relationship between the brands: which legal entity contracts with the student and
   receives which fees? (Fields exist; no invoicing logic until decided.)
2. Which company processes which students by default (currently chosen per student).
3. Exact default permissions per role (especially: should the MD open document files? should managers
   do Fee Clearance? should counsellors see payment status?).
4. Data retention periods for cancelled/completed students and a procedure for deletion requests.
5. Whether two-factor login is mandatory for all staff before go-live (`MFA_ENFORCE=all`, recommended).
6. Hosting region, domain name, and who holds admin credentials (two named people recommended).
7. Leadist CRM: how leads should flow in later (manual for now; "Leadist CRM (manual)" lead source exists).
8. Fee structure and categories per company and per country/course.

## Roadmap after the pilot (prioritised)

1. **Production hardening**: nonce-based CSP, edge rate limiting, Sentry alerts, automated restore drills.
2. **Leadist CRM integration**: one-way lead import (API/webhook) with duplicate detection, then status sync.
3. **Notifications**: email digests of overdue work; WhatsApp/SMS with consent, templates, delivery status and retry tracking.
4. **Finance**: receipt PDFs, invoice numbering per legal entity, tax rules once confirmed, accounting export (Tally/Zoho).
5. **Workflow engine**: per-stage checklists, approvals, SLA timers and escalation; university application tracking per university.
6. **Student portal**: secure document upload and status view for students/parents.
7. **Reporting**: custom report builder, scheduled reports, conversion funnel by lead source/brand.
8. **Documents**: virus scanning, watermarking on download, bulk upload, expiry reminders.
9. **Data lifecycle**: retention automation, anonymisation of old records, audit-log archiving.
10. **Wider ERP**: HR/payroll, agent/sub-agent management, accounting — only after the core workflow is proven.
