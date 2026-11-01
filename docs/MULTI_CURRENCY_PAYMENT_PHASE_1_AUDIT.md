# Multi-currency payment management: Phase 1 audit of the existing system

Audited on 1 Nov 2026: code, database (migrations 0006 and later), live dev data (169 ledger entries, **all INR**) and tests.

## 1. Architecture relevant to payments
- **Database:**
  - `payment_entries`: one append-only ledger for charges, receipts, refunds, waivers, disbursements and reversals
  - `payment_verifications`: the history of verification decisions
  - views `payment_entry_effects` and `student_balances`: balances per student, company, ledger and **currency**
  - `fee_categories` (per company; service vs third-party money)
- **Server:**
  - `src/server/services/payments.ts`: ledger list, student ledger, record, verify and reverse
  - `src/server/services/analytics.ts`: management dashboard finance
  - `src/server/services/reports.ts`: the "Outstanding balances" report
- **Screens:**
  - student → **Payments** tab: record entries, verify, reverse, balances
  - **Payment ledger** (`/payments`)
  - management dashboard finance section, shown only with `payments.read`
- **Security:** RLS by company (`payments.read`). The CEO has `payments.status` only, which gives counts and never amounts (tested).

## 2. Existing tables and fields
`payment_entries` has these columns:
- id, org_id, student_id, entry_type, fee_category_id, ledger
- **amount numeric(12,2)**, **currency (3 letters, default INR)**, entry_date, method
- reference_no, receipt_ref (manual), recipient_entity_id, payee, reverses_entry_id, notes
- verification_status, verified_by/at, recorded_by/at

There are **no exchange-rate or INR-equivalent fields**.

## 3. Existing payment workflow
Entries are **recorded** (charges count at once; receipts, refunds, waivers and disbursements start "pending"), then **verified** by a different person (unless the company allows self-verification), with a note required for rejection.
- Corrections are made **only by reversal** (the original is never edited or deleted, which the database enforces).
- Balances count only verified entries and charges.

## 4. Currency and exchange-rate capabilities
- A currency column exists and balances are already grouped **per currency**, so unlike currencies are never added together.
- **The entry form has no currency choice:** the company's "ledger currency" setting (INR) is always used.
- **No exchange rate, no INR equivalent, no currency master and no reference rates.**

## 5. Accounts permissions
| Permission | Who has it |
|---|---|
| `payments.read` | Manager, Finance, MD |
| `payments.record` | Finance, MD |
| `payments.verify` | Finance, MD |
| `payments.reverse` | Finance, MD |
| `payments.disbursement` | Finance, MD |
| `reports.export.finance` | Finance, MD |

The CEO has `payments.status` only (counts). Everything is enforced in the database by company.

## 6. MD dashboard and reporting
- The management analytics finance section shows **per currency**: received in the period, due, outstanding, pending and a 12-month trend.
- The ledger page shows 30-day totals per currency.
- **There is no consolidated INR-equivalent section.**

## 7. Receipts and invoices
**No receipt documents and no receipt numbering:** `receipt_ref` is a free-text field typed by staff. There are no invoices.

## 8. Audit trail
`payment_entries` and `payment_verifications` are audit-logged (before and after values, user, time). Entries are immutable, truncation is blocked, and reversals keep the original.

## 9. Company isolation
RLS uses `app.has_perm(org_id, 'payments.read')`. An entry is accepted only if its company has access to the student.

## 10. Requirement status
| Requirement | Existing | Status | Reference | Action |
|---|---|---|---|---|
| INR, USD and EUR; more currencies later without code changes | Free 3-letter code, always INR in practice | Partial | `payment_entries.currency`, `recordEntry` | Add a `currencies` master table (INR, USD, EUR) and a currency choice on the form |
| Transaction-specific exchange rate | — | Missing | — | `exchange_rate` per entry, entered by staff; INR fixed at 1 |
| Automatic INR equivalent | — | Missing | — | `inr_amount` calculated **in the database** (amount × rate, rounded to paise) |
| Historical rates never recalculated | n/a | Missing | — | Rate stored on the entry; reference rates only pre-fill the form |
| Reference rate that never overrides | — | Missing | — | Optional `currencies.reference_rate`, used only to suggest |
| Precision | numeric(12,2) | Partial | — | Rate `numeric(18,8)`, INR `numeric(16,2)` |
| Student: expected, received, outstanding per currency | Balances per currency | Implemented | student Payments tab, `student_balances` | Add INR equivalents and rate columns to the history |
| Partial / multiple / mixed-currency payments | Yes, per currency | Implemented | — | Reuse |
| No cross-currency offsetting | Per-currency balances | Implemented | `student_balances` | Keep; document explicit settlement through charges and waivers |
| MD dashboard per currency | Yes | Implemented | analytics finance | Reuse; add a consolidated INR-equivalent section |
| Consolidated INR from stored equivalents | — | Missing | — | Sum stored `inr_amount` effects; show entries without a rate separately |
| Filters: company, date, currency, status, student | Ledger: company, date, status, type, search | Partial | `/payments` | Add a currency filter |
| Accounts permissions | Granular | Implemented | §5 | Reuse; add `currencies.manage` (MD only) for the currency list and reference rates |
| Receipts with number, rate and INR | — | Missing | — | Number assigned on verification (`payment_receipts`), plus a printable receipt page |
| Audit of creation, verification, reversal | Yes | Implemented | audit_row | Reuse |
| Rate changes audited | n/a | Missing | — | Rate correction only while **pending** (or for a charge), with a reason, in an append-only history; verified entries are protected |
| No destructive deletion | Yes | Implemented | payments_guard | Keep |
| Duplicate payment protection | — | Missing | — | A transaction reference is unique per company for receipts and refunds (rejected ones excluded) |
| Existing INR records intact | — | — | 169 INR entries | Backfill **rate 1 and INR = amount for INR entries only**; no rates are invented for any other currency (none exist) |

## 11. Risks and backward compatibility
- The guard trigger blocks updates, so the INR backfill runs inside the migration with the guard briefly disabled, then re-enabled. Values are written only where they are mathematically certain.
- Views gain columns **appended at the end** (`create or replace` keeps their dependants valid).
- Existing screens keep working: INR stays the default currency and rate.

## 12. Plan
1. **Migration 0028:**
   - `currencies`; entry columns `exchange_rate`, `inr_amount`, `rate_source`
   - insert-trigger checks: currency must exist and be active, rate required for non-INR, INR equivalent calculated, reversal copies the original's rate
   - `payment_rate_changes` plus `app.correct_exchange_rate`
   - `payment_receipts` (numbered on verification)
   - view columns for INR effects
   - duplicate-reference index
   - `currencies.manage`
2. **Server:** recordEntry (currency and rate), rate correction, receipts, INR totals in the ledger, dashboard and student balances.
3. **UI:**
   - form with currency, rate and a live INR preview
   - history columns for rate and INR
   - receipt page and print
   - currency filter
   - consolidated INR panel
   - Admin → Currencies & reference rates
4. **Tests:** integration (all 20 scenarios that can be automated) plus a browser test.
5. **Final report.**

## 13. Migration requirements
One additive migration (0028) with a rollback. Data changes only for existing INR entries (rate 1). Run `npx tsx scripts/migrate.ts`, then `npm run db:provision`.

## 14. Testing plan
- INR, USD and EUR entries; automatic INR; different rates; history unchanged when a later entry uses another rate
- partial and multiple payments; currency-wise outstanding
- dashboard per currency plus consolidated INR
- receipts; Accounts and CEO permissions; company isolation
- audit of a rate change; reversal copies the rate; duplicate reference refused
- existing INR entries keep their values
- browser: record a USD payment and see the INR equivalent; receipt page
