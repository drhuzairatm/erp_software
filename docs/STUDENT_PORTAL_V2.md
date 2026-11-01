# Student portal v2 (Phase 6, approved 1 Nov 2026)

## Password sign-in
- **Accounts:** staff with `portal.accounts.manage` (Company Manager, Counsellor; MD always) create the account on the student profile → **Student portal account → Create account & issue set-up link**.
- **How the link is delivered:**
  - If the student's email is **verified**, the link is emailed using the "Portal account set-up" template.
  - Otherwise the one-time link is shown to the staff member once, to hand over personally.
  - Links are valid for 72 hours, work once, and replace any earlier link. At most 5 links can be issued per hour.
- **Password:** the student chooses a password of at least 12 characters, using three character types. It is stored as Argon2id, like staff passwords.
- **Signing in:** with the **Student ID**, or the **email address once it is verified**, plus the password.
  - A wrong ID, a wrong password and a locked account all get the same answer.
  - **5 wrong attempts lock the account for 15 minutes.**
- **Forgot password:** emails a 1-hour reset link, but **only to a verified address**. The page never reveals whether an account exists.
- **One-time code login is still available** on the same page, as before.
- **Disable / enable** (a reason is required): disabling signs the student out at once and cancels open links.
- **Outbox:** set-up and reset messages are visible only to staff with outbox permission, and the link is removed from the stored message once it is sent.

## Documents from us (publication)
- Staff with `documents.publish` (Company Manager, Documentation Staff) publish **approved** documents from the Documents tab.
- The student sees them under "Documents from us" and can download them.
- Every download is logged permanently and audited, and staff see the download count.
- Withdrawing a document (a reason is required) stops downloads immediately.

## Notifications in the portal
The portal creates notices automatically for:
- a document being approved, needing changes or not accepted
- courier instructions
- a newly published document
- a stage change

A bell in the header shows how many are unread, and the student can "Mark all as read". No internal notes are ever shown.

## Payments (optional)
- **Company settings → "Show students their own fees, confirmed payments and balance in the portal"** is **off by default**.
- When it is on, the student sees their own service-fee charges, payments, refunds and waivers, plus the outstanding balance per currency.
- Pending payments show as "being confirmed". Third-party money and internal notes are never shown.

## Not included (left for later, as these change behaviour)
- Limiting portal uploads to documents staff have requested: uploads work as before.
- Parent or guardian accounts.
- Students changing their password while signed in: they use "Forgot password" instead.

## Technical
- Migration `0025_portal_v2.sql` (rollback in `db/rollbacks/`).
- Server: `src/server/portal.ts` (public) and `src/server/services/portal-accounts.ts` (staff).
- Pages: `/portal`, `/portal/password`, `/portal/forgot`, and the download route `/portal/files/[id]`.
- Tests: `tests/integration/phase-6-portal-v2.test.ts` and `tests/e2e/phase-6-portal.spec.ts`.
