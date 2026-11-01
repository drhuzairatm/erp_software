# Leads and referrals (Phase 9, approved 1 Nov 2026)

## Leads
- **Where:** Workspace → **Leads**. Leads are enquiries before registration and are **company-specific**.
- **Permissions:**
  - `leads.read`: CEO, counsellors and managers
  - `leads.manage`: counsellors and managers
  - `leads.review`: managers; the MD always has everything
- **Sources:** entered by staff, referrals (portal or shared link), and **Leadist import**.
  - Leadist import uses a CSV export uploaded under Leads → Import. Leadist itself is never changed.
  - Rows with a Lead ID that was already imported are skipped. Bad rows are listed; good rows are still added.
- **Central review queue:** leads whose company is uncertain (for example "Not sure yet") have no company. Reviewers route them to Dr.Expert Edulinks or GRADUATER.
  - A counsellor can't move a lead to another company.
- **Duplicates:** a lead with the same phone or email as another open lead or a student is flagged **"possible duplicate"**, with the matches shown.
  - Staff mark it "Not a duplicate" or "It is a duplicate"; the latter sets the lead to Invalid.
  - **Nothing is ever merged.**
- **Follow-up:** status (New, Contacted, Interested, Not interested, Closed, Invalid), assigned person, next follow-up date, and a log of notes and calls.
  - Closing requires a reason.
  - Everything goes into the lead's permanent activity history and the audit log.
- **Converting:** **Register as student** creates the student through normal registration (duplicate checks and permissions apply) and links the lead.
  - The status becomes **Application started**.
  - It becomes **Admission confirmed** automatically when the student reaches Admission Letter.
- **Report:** Reports → *Leads and referrals*.

## Refer a Friend (student portal)
- **The student's link:** each student gets a unique, non-guessable 10-character code and the link `/refer/<code>`.
  - Sharing options: copy link, WhatsApp, email, and the phone's share menu.
  - Students can also enter a friend's details, with the friend's consent.
- **Public page:** the friend fills in their own details. Consent is required. The page shows only the referrer's first name and company, never ids or contact data.
- **Routing (from the brief):**
  - MBBS, Nursing, Medical PG → **Dr.Expert Edulinks**
  - Bachelor's, General PG → **GRADUATER**
  - Not sure → **central review queue**
- **Blocked:**
  - **self-referrals:** the referrer's own phone or email
  - rapid repeats: 20 per day per code, 10 per hour per IP address
- **What students see:** the friend's first name, the date and a simple status (Received, Contacted, Interested, Application started, Admission confirmed, Closed). No internal remarks, documents or money.
- **Rewards and points:** not implemented, so they stay disabled until configured and approved.

## Technical
- Migration `0026_leads_referrals.sql` (rollback in `db/rollbacks/`).
- Service `src/server/services/leads.ts`; portal functions in `src/server/portal.ts`.
- Pages: `/leads`, `/leads/new`, `/leads/[id]`, `/leads/import`, and `/refer/[code]`.
- Tests: `tests/integration/phase-9-leads.test.ts` and `tests/e2e/phase-9-leads.spec.ts`.
