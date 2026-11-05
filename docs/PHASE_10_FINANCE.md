# Phase 10: Finance

**Status:** built and tested. Migration 0050 is applied to the local development database only, after a passing full regression and a verified backup. Nothing is committed, pushed or deployed.

## What already existed and was reused unchanged

| Requirement | Existing feature |
|---|---|
| INR, USD, EUR; original currency; rate and date; conversion display | `payment_entries` with `exchange_rate`, `inr_amount`, `rate_source`, `entry_date`; rate corrections in `payment_rate_changes` |
| Amount received, pending | `student_balances`, `payment_entry_effects` |
| Receipts | `payment_receipts`, `/receipts/[id]` |
| Student payment history | Payments tab on the student page |
| Finance dashboard | `/payments` |
| Approval rules | Receipts, refunds, waivers and reversals need a different verifier |
| Audit history | Append-only ledger, events and audit log |
| MD and Finance visibility | `payments.*` permissions and RLS. The CEO role sees counts only |

## What was missing and was added

- **Due dates** on charges (`payment_due_dates`), set by holders of `payments.record`. A change needs a reason and is written to the audit log with the old date.
- **`payment_due_status`**, a view that works out what is unpaid when it is read.
- **Reminders** to staff holding `payments.record`: daily job, one per person, charge and due date. Text is generic, with no amount or name. Overdue reminders stop 3 days after the due date and are also queued for email; due-soon reminders stay in the app.
- **Reports:** monthly summary, yearly summary and revenue by fee category. The existing outstanding balances report gained the earliest unpaid due date, the overdue amount and an overdue filter, rather than a duplicate report.
- **Overdue banner** on `/payments`.

## Rules to confirm

- **Oldest due date first.** The ledger records no link between a receipt and a charge. For reminders and reports, money received and waivers settle the earliest due date first. This is calculated when read and is never stored. Charges without a due date are not considered, so a receipt meant for one can make a dated charge look settled.
- **Revenue** means verified receipts less verified refunds on the service ledger. Third-party money such as university fees is excluded. Finance should confirm this definition.
- **"Split financial information"** was not defined in the requirement, so nothing was built for it. The separation in place is by company, by service and third-party ledger, and by permission.
- **Reversals** count in the period of their own entry date, so a closed month keeps its entries. A reader comparing periods will see the correction in the later month.

## Limits

- Staff reminders only. Students are not reminded.
- No payment gateway. No real payment or email was used in testing.
- The student page link in a reminder opens the Overview tab, because notification links do not allow query strings.
- `staff_notify` swallows errors by design and logs only a warning. An invalid link failed silently during this phase until a test caught it.
- Reminder delivery depends on the daily scheduler, which is unverified on the server (R-05).
- This is a basic ledger and not an accounting system.

## Tests

`backend/tests/integration/phase-10-finance.test.ts`, the 0050 test in `migrations.test.ts`, and `frontend/tests/e2e/phase-10-finance.spec.ts` (workflow 21).
