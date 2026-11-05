# Architecture

## Overview

```
Browser (staff only)
   │  HTTPS, session cookie (httpOnly, SameSite=Lax, Secure in production)
   ▼
Next.js 16 app (TypeScript, server components + server actions)
   │  every request: resolve session → open transaction → SET app.user_id
   ▼
PostgreSQL 17  ── row-level security on every table, connected as low-privilege role `erp_app`
   │
Private object storage (S3-compatible) ── random keys, 60-second signed URLs
```

- **One application, one database** for both companies. Separation is enforced **inside the database**
  (row-level security + column privileges + SECURITY DEFINER functions), and again in the server code.
  A bug in a page cannot return another company's rows because the database will not return them.
- **No client-side trust.** Company scope, roles and permissions are always derived from the
  authenticated user's memberships in the database. The company switcher is only a preference cookie
  and is validated on every request.
- Stack: Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · postgres.js · Zod 4 ·
  Argon2id · Vitest · Playwright. Hosting-agnostic: any managed PostgreSQL + any S3-compatible bucket +
  a Node.js host (recommended: Supabase Postgres & Storage + Vercel, see DEPLOYMENT.md).

### Why not Supabase Auth / client SDK?
The development machine has no Docker, so the Supabase local stack cannot run. The app therefore uses
plain PostgreSQL features that work identically on a laptop, in CI and on Supabase/Neon/RDS. Login,
sessions and RLS context are implemented in the database (`auth_private` schema and `app.*` functions).

## Database roles

| Role | Used by | Rights |
|---|---|---|
| owner (e.g. `postgres`) | migrations, provisioning, seed, admin CLI | owns all objects; **never** configured in the web runtime |
| `erp_app` | the web application | `NOBYPASSRLS`, not owner; column-level grants; reads and writes are limited by policies for the user set in `app.user_id` |

**Limit:** these controls protect against application mistakes, such as a forgotten company filter. They don't protect against someone who gains direct SQL access with the application's database role. Strengthening this is planned for the Security Hardening phase after Phase 11, so the system must not be described as fully secure.

## Data model (main tables)

| Area | Tables |
|---|---|
| Companies & people | `organizations`, `user_profiles`, `organization_memberships`, `roles` (flags: privileged, protected, requires 2FA), `role_permissions`, `permissions`, `departments` |
| Authentication (private schema) | `auth_private.credentials`, `sessions` (incl. 2FA-pending state), `login_attempts`, `password_resets`, `mfa` (encrypted TOTP secret), `mfa_recovery_codes` (hashed) |
| Reference data | `countries` (flags: destination, previous-education origin), `courses`, `universities` (+ `university_campuses`, `university_courses`, `university_intakes`, `university_document_requirements`), `lead_sources` (per company), `legal_entities`, `fee_categories` (per company) |
| Workflow configuration | `stages`, `workflow_definitions`, `workflow_stages`, `document_types`, `document_requirements` |
| Students | `students`, `student_org_access`, `student_assignments`, `student_notes`, `followups`, `student_stage_history`, `student_events` (timeline), `student_merges` |
| Documents | `student_documents` (checklist item), `document_files` (versions), `document_reviews`, `document_custody_events` |
| Tasks | `tasks`, `task_comments`, `task_events` |
| Payments | `payment_entries`, `payment_verifications`, views `payment_entry_effects`, `student_balances` |
| Audit | `audit_logs` (append-only) |
| Views | `v_students` (row-filtered, contact details masked unless permitted) |

### Brand, processing team, legal entity and payment recipient
Each student has four **independent** fields:
- `originating_org_id` – the brand that brought the student (drives sales visibility and attribution);
- `processing_org_id` – the company doing documentation/visa work (e.g. Edulinks central processing);
- `contracting_entity_id` and `payment_recipient_entity_id` – free-standing `legal_entities`, not tied to
  either brand, because the legal/accounting relationship is not yet confirmed.

### Company access to a student (`student_org_access`)
| Relation | Created when | Grants |
|---|---|---|
| `originating` | student registered | `students.read.all` holders of that brand see the student |
| `processing` | processing team set | `students.read.processing` holders of that company see the student |
| `secondary_brand` | a duplicate from another brand is merged in | the other brand keeps visibility/attribution |

Any company with access + `students.read.assigned` also sees students **assigned** to that user.
This lets Edulinks documentation staff work on GRADUATER students without Edulinks salespeople seeing
GRADUATER's pipeline.

### Education background vs destination
Students record **previous education country**, **school/institution country** and name separately from the
**destination country**; each document records its **certificate issuing country**. These fields drive the
country-specific verification and attestation rules in later phases.

### Automatic document checklist
A student's checklist = requirements of their workflow (country + course) **plus** the requirements of
their chosen university (course-specific ones only for that course). Changing university/course/workflow, or
adding a rule to a university, adds missing items; nothing is removed automatically (existing items keep
their history). Items show where they came from (workflow, university, manual).

### Passport details
`passport_number`, `passport_expiry`, `passport_country_id` are not readable from the `students` table by the
application role; `v_students` shows them only with `students.passport.view` (masked otherwise). They are
redacted in the audit log (only "(changed)" is recorded), as are phone, email and date of birth.

### Student ID
Generated by a database trigger: `<PREFIX>-<YY>-<6-digit sequence>`, e.g. `EDX-26-001042`. Never accepted
from the browser; unique constraint; not derived from name/phone.

### Deletion and retention
- Nothing business-critical is hard-deleted through the app. Students are **archived** (with reason) or
  **merged** (kept as history). Reference data is **deactivated**.
- Payment entries and audit logs are immutable (database triggers block update/delete, even for the owner,
  except the narrowly-scoped verification/merge paths).
- A retention policy (how long to keep personal data of cancelled/completed students, and how to purge
  on request) is an **open decision** — see LIMITATIONS_AND_ROADMAP.md.

## Roles and permissions

Hierarchy: **MD** (locked master super admin) → **CEO** (operations; payment counts only) → Managers →
Counsellors / Documentation / Visa / Finance staff; plus a technical **System Administrator**.
The full, always-current matrix is generated from the database: [ROLE_PERMISSION_MATRIX.md](ROLE_PERMISSION_MATRIX.md).

Rules that hold regardless of configuration (enforced by database policies):
- A role belongs to exactly one company; membership role and company must match; departments likewise.
- You can only grant permissions you hold; only assign roles whose permissions you all hold; privileged
  roles (MD, CEO, administrators) also need `users.create_admin`; you can never change your own role or membership.
- You can only reset passwords / two-factor login or deactivate people whose access is entirely within yours.
- The MD role is locked: it always holds every permission and cannot be changed or assigned in the app.
- Financial amounts need `payments.read`; `payments.status` (CEO) returns counts only.
- Payment entries must be verified by someone other than the recorder (unless a company enables self-verification).
- Two-factor login is required for **every** user (Phase B). Production builds always enforce it; only local development/tests may relax it with `MFA_ENFORCE`.

## Request flow (example: open a student profile)
1. `requireUser()` hashes the session cookie, calls `app.auth_resolve_session()`; loads memberships.
2. `withUser()` opens a transaction, sets `app.user_id`, `app.request_ip` and the business time zone.
3. `select … from v_students where id = $1` – the view returns nothing unless `app.can_read_student()`.
4. Not found → standard 404 (no hint whether the record exists).
