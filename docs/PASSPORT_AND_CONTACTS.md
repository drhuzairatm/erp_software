# Passport records, phone numbers and email verification (Phase 2)

## Passports

- The Passport tab (roles with **students.passport.view**) records exactly what is printed:
  - passport number and holder name as printed
  - date of birth and gender
  - **nationality** and **country of citizenship**
  - **issuing country**
  - issue date, expiry date and place of issue

  Country of residence is recorded separately on the student. Each phone number has its own country.
- **Nothing is overwritten.** Every change creates a new passport version: a renewal, a correction (a reason is required), or an edit on the student form. Previous versions stay in the history with their dates and authors. The database refuses updates and deletes, even by its owner.
- **A new passport becomes active only after verification** (MD decision, Nov 2026; migration 0022):
  - A first passport or a renewal recorded on the Passport tab is saved as **awaiting verification**. Until then, the current passport, the 12-month rule and the expiry alerts are unchanged. The student profile shows an amber "New passport awaiting verification" notice.
  - A task "Verify new passport – <ID>" is created for the documentation staff on the student (else the counsellor, else a manager).
  - A user with `students.passport.verify` (Company Manager, Documentation Staff; MD always) chooses **Verify and activate** or **Reject** (a reason is required). Verification makes it the current passport, closes the old passport's renewal tasks and re-runs the expiry monitor. Rejection keeps the previous passport active.
  - Only one new passport can wait at a time. Records cannot be changed directly in the database.
  - **Corrections** (same passport number, reason required) still apply immediately.
  - The student form can no longer replace a recorded passport number. It asks for a renewal on the Passport tab instead. Expiry and issuing country can still be edited there, as a new version.
- A **renewal** must have a new passport number. When it is recorded:
  - "Renewed passport received – awaiting verification" is added to the follow-up log
  - the Passport document's current scan is linked, if one exists
  - the open passport tasks close once it is verified

  Scans stay in the Documents module, not on the Passport tab.
- **Follow-up log:** remarks, contact attempts, renewal commitments with an expected date, and when the renewed passport was received.
- Passport data recorded before Phase 2 became version 1. Holder details were left empty rather than guessed.

### Expiry status (most severe applies)

| Status | When |
|---|---|
| Valid | more than 12 months left |
| Expiry warning | 12 months or less |
| Urgent renewal required | 6 months or less |
| Critical | 3 months or less |
| Expired | past the expiry date |

The status is shown in these places:
- the student header and profile
- the Passport tab
- the dashboard card "Passports needing renewal"
- the **Passport expiry** report

Staff without passport permission see the status only, never the number or the dates.

### Automatic tasks

The monitor runs daily (`/api/cron/daily`) and immediately whenever passport data changes.
- It creates **one task per passport version and status**, assigned to the student's counsellor or, if none, the documentation staff.
- From **Urgent** onwards it also creates an **escalation task for a manager** of the company.
- A more severe status cancels the open tasks of the milder one.
- Running the monitor again never creates duplicates.

The staff Notification Centre is a later phase. Until then, these alerts appear as tasks.

### Minimum validity rules

**Admin → Passport & contact rules** (permission `passport.rules.manage`: System Administrator and MD).
- Each rule sets a minimum number of months of validity.
- It is checked when a student moves forward to the chosen stage or any later one.
- It can be limited to a destination, university and/or course.
- When the rule is not met, it **warns** (staff acknowledge). Only a rule for one university, with its official source recorded and starting after Registration, may **block** the stage change. A block is enforced by the database.

Passport expiry on its own never blocks anything. One warning-only rule is installed: 12 months from University Application, for all destinations.

## Phone numbers

- There are three numbers: **primary**, **secondary**, and an optional **third** with a contact type (e.g. "Father", "Relative in UAE").
- Each number has its own country selector covering every country and territory. You can search by name or calling code, and flags are shown.
  - The data comes from `libphonenumber-js` (Google's maintained metadata).
  - Choosing a country never changes the number. A number whose `+code` doesn't match the chosen country is refused with an explanation.
- Numbers are validated for their country and stored in **E.164** (e.g. `+971501234567`).
  - A number typed without `+` and without a chosen country (CSV import) is treated as Indian.
  - CSV imports accept a "Secondary phone" column.
- **Drafts may be incomplete.** From a configurable stage (default **University Application**), moving a student forward requires primary phone, secondary phone and email. The form, the server and the database all enforce this. The stage is set on the same admin page.
- Phones are shown as **not verified**. The system never claims a phone is verified.

## Contact change history

Every change to a primary, secondary or third phone, email, parent phone or parent email is recorded with:
- old value and new value
- country
- author and time
- verification status at the time

The history is append-only and visible on the Overview tab to staff with contact permission.

## Email verification

| Status | Meaning |
|---|---|
| Entered | address recorded, not verified (also after any change of address) |
| Pending | verification email sent; link valid for 48 hours |
| Verified | the student opened the link and pressed **Confirm** |
| Expired | the link expired before it was used |
| Failed | the email could not be sent |

- Staff with contact and update permission use **Send verification email** (at most 3 per hour per student).
- The confirmation page needs a button press, so automatic link scanners cannot verify an address.
- Links are single-use and stored only as a hash. **The email goes through the encrypted authentication queue (finding N-8), not the Messages outbox.** No staff member can see the link in any status, the MD included. Managers see a redacted status row (*Verification link – hidden for security*). A new verification, a used or expired link, or a change of email cancels a queued email at once.
- Only the verification functions can change the status. In test mode the email isn't sent and the link is wiped. In development only, `NOTIFICATIONS_TEST_MAILBOX=1` writes it to the local test mailbox (docs/NOTIFICATIONS.md).

## Database

Migration `0019_passport_contacts.sql`; undo script `db/rollbacks/0019_passport_contacts.down.sql`.
- **New tables:** `student_passports`, `passport_followups`, `passport_validity_rules`, `student_contact_changes` and `auth_private.email_verifications`.
- **New columns on `students`:** phone countries, `phone2`, `phone3`, `phone3_label`, `residence_country_id`, `email_status` and `email_verified_at`.
- **`tasks`:** new columns `source_key` (prevents duplicates) and type `passport`; `created_by` may now be empty for automatic tasks.
- **`stages`:** new column `requires_complete_contact`.
