# Multi-currency payment management: final implementation and testing report

## 1. Audit summary (see `MULTI_CURRENCY_PAYMENT_PHASE_1_AUDIT.md`)
**Existing:** an append-only ledger with verification by a second person, reversals, per-currency balances, company isolation, an audit log, and management finance figures per currency.
**Missing:** currency choice on the form, a per-transaction exchange rate, INR equivalents, consolidated INR reporting, receipt numbers and documents, duplicate-reference protection, and audited rate corrections.
All 169 existing entries were INR.

## 2. Reused, not duplicated
- the `payment_entries` ledger, `payment_verifications`, the reversal workflow and the immutability guard
- per-currency `student_balances`, extended with INR effects
- permissions: payments.read, record, verify and reverse; the CEO's counts-only access
- the audit log, the student Payments tab, the Payment ledger and the management dashboard

## 3. Enhanced
- **Payment form:** a currency selector (active currencies from the database), the **exchange rate applied (INR for 1 unit)** for non-INR entries (pre-filled from an optional reference rate, which staff can change), and a live INR-equivalent preview.
- **Student Payments tab:** a rate and INR-equivalent column, "Correct rate" (pending entries and charges only), a receipt link, and INR equivalents beside each foreign-currency balance.
- **Payment ledger:**
  - a currency filter and an INR-equivalent column
  - receipt links
  - a separate, clearly labelled **Consolidated – INR equivalents** box
- **Management dashboard:** a **Fees by currency** table (expected, received, outstanding and awaiting verification for each currency) plus a separate **Consolidated – INR equivalent** row.

## 4. New
- `currencies` master table (INR, USD, EUR; more can be added without code changes) with optional reference rates. **Admin → Currencies & rates** is MD-only (`currencies.manage`).
- **Numbered receipts** (`EDX-RCP-2026-00001`, per company and year), issued automatically when a receipt is verified.
  - Printable receipt page `/receipts/[id]` (print or save as PDF) showing student, company, original amount and currency, rate, INR equivalent, date, method, reference, verification and receipt number.
  - A receipt shows a warning if the payment was later reversed.
- **Audited rate correction** (`app.correct_exchange_rate`): allowed only while an entry is pending or for an unreversed charge, a reason is required, and every change goes into the append-only `payment_rate_changes` history. Verified entries can't be changed (reverse and re-enter instead).
- **Duplicate protection:** a transaction reference can be used once per company for receipts and refunds (case-insensitive). The database enforces this and the form checks it.

## 5. Database (migration `0028_multi_currency.sql`, rollback in `db/rollbacks/`)
- **New tables:** `currencies`, `payment_rate_changes`, `payment_receipts`, and the permission `currencies.manage`.
- **`payment_entries`:**
  - adds `exchange_rate numeric(18,8)`, `inr_amount numeric(16,2)` and `rate_source`
  - a foreign key to `currencies`
  - a duplicate-reference index
- **`payment_entry_effects`:** gains `due_inr`, `received_inr` and `inr_missing` as appended columns, so existing dependants are unchanged.
- **Functions:** `payments_before_insert` (rate validation, INR calculation; reversals copy the original rate), `payments_guard` (allows only the audited rate change), `verify_payment` (issues receipts), `correct_exchange_rate` and `issue_payment_receipt`.
- **Backfill:** existing **INR** entries got rate 1 and INR = amount, which is mathematically certain. No rates were invented. Checked: 169 of 169 correct.

## 6. Exchange-rate logic
- **INR equivalent** = round(amount × rate, 2), calculated **in the database** on insert. The client can't supply it.
- **Rates for INR entries** are always 1.
- **History:** the rate is stored on each entry and never recalculated. Reference-rate changes never affect recorded entries.
- **Precision:** rates have 8 decimals; INR is rounded to paise.

## 7. Reporting rules
- Balances and totals are always **per currency**, and original amounts are never added together. An INR payment never reduces a USD balance.
- Consolidated figures are labelled **INR equivalent**, use the stored rates, and state how many entries were left out for lack of a rate.

## 8. Permissions and security
- All checks happen in the database (RLS by company).
- Recording, verifying and reversing use the existing permissions, and the recorder can't verify their own entry.
- Currency administration is **MD only** by default and can be delegated through Roles.
- The CEO still sees no amounts: the ledger is refused, and receipts give 404.
- Other companies' finance staff can't see entries or receipts.

## 9. Audit trail
- **Logged:** entry creation (all fields, including currency, rate and INR), verification, reversal, receipt issue, currency changes, and rate corrections (old and new rate and INR, reason, user, time).
- **Permanent:** entries, rate history and receipts can't be edited or deleted.

## 10. Tests run (actual results)
- **`tests/integration/multi-currency.test.ts`, 5 tests, all passed:**
  - INR fixed at rate 1; USD and EUR rates; INR calculated and rounded (333.33 × 97.123456 = ₹32,374.16)
  - a non-INR entry without a rate, or an unknown currency, is refused; clients can't write the INR amount
  - different rates per payment; history unchanged after reference-rate changes
  - partial and multiple payments; USD outstanding 8,000 while an INR payment doesn't offset it; INR equivalents of a USD balance
  - receipt numbering and contents
  - CEO and other-company access denied
  - a reversal copies the original rate
  - duplicate references refused (case-insensitive)
  - rate correction with reason and history while pending; refused once verified; direct database updates and deletes refused
  - existing INR entries intact
  - only the MD manages currencies
- **`tests/e2e/multi-currency.spec.ts`, passed:**
  - finance records **USD 1,000 at 90**; the form shows ₹90,000.00 and the history shows $1,000.00 and ₹90,000.00
  - the MD verifies, a receipt EDX-RCP-… appears, and it shows "1 USD = 90 INR" and ₹90,000.00
  - the dashboard shows the consolidated INR row
- **Full suite:** see the commit (all integration and browser tests run together).
- **Not automated:** printing the receipt on paper (uses the browser's print), and mobile layout of the form (it uses the same responsive grid as before).

## 11. Known limitations
- No automatic exchange-rate feed: reference rates are entered by the MD. This is intentional; the applied rate is always entered on the payment.
- No invoices or tax; the ledger is not an accounting system (unchanged).
- Settling a USD liability with an INR payment must be recorded explicitly, for example as an INR receipt plus a USD waiver, with notes. There is no automatic conversion.
- The dashboard's top KPI cards show the first currency; the per-currency table shows all of them.

## 12. Backward compatibility
- The INR workflow is unchanged: the default currency is INR, which needs no rate.
- Existing entries keep their amounts and were given only rate 1 and INR equal to the amount.
- Existing reports and balances still work.
- Rollback refuses to run if non-INR entries exist, so their rates can't be silently lost.

## 13. Deployment
1. Back up.
2. Run `npx tsx scripts/migrate.ts` (applies 0028).
3. Run `npm run db:provision` (no change needed for currencies).
4. Optionally have the MD set USD/EUR reference rates under Currencies & rates.
