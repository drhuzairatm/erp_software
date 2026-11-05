# Local clean-up report

**Date:** 4 November 2026
**Branch:** `cleanup/local-readiness`, from `3df4171`. **Nothing is committed or pushed.**
**Baseline:** GitHub `main` / `3df4171`, by MD decision. `f36328f` is recorded as a historical deployment discrepancy.
**Not done:** no VPS or production connection, deployment, restart or Phase 1 work. No function permission changed. Migration 0038 is applied to the local development database only (`MIGRATION_0038_REVIEW.md`).

## Defects fixed

| Defect | Proof before the fix | Fix |
|---|---|---|
| Test mode sent real system email | Test failed: mail sent | Single gate in `sendEmail` for both providers |
| Apostrophe addresses failed to send | Test failed | Allowed in the local part, not the domain |
| Resend-only server stopped sending | Test failed | SMTP when fully configured, otherwise Resend |
| Alert re-sent to working recipients | Same person emailed 3 times in 3 runs | Marked once anyone is reached |
| Queue failure stopped the other senders | Test failed | Failure caught and reported without its text |
| Portal provider errors stored the link | Stored text contained the link | Masked before storage |
| University Application passport block | Old tests asserted it | Warning only, unless a verified university rule applies |

## Database change: `0038_passport_warning_only`

Data only. Inspection found the schema, trigger and `stage_requirement_issues` already support warnings, so none of them changed.

**Why it is needed:** the rule is a database row. `db:provision` installs it once, and the admin screen can't edit enforcement, so existing databases would keep blocking.

**What it changes:** `block` becomes `warn` for rules with no university, or starting at or before Registration. Rows, ids and history stay, and the audit trigger records each change. No student, employee or document record changes (test compares every student row).

**Rollback:** `npm run db:migrate -- --rollback 0038`, which restores only rows carrying its note. Tested. It would restore the block, against the MD decision.

**Manual alternative:** deactivate the rule and add a warning rule on the admin screen, in each database.

## Final results, 4 Nov 2026 (clean copy, no `.env`, no build cache, CI order)

| Check | Result |
|---|---|
| `npm ci`, typecheck, lint, SQL guard | Pass |
| Backend tests | 494 of 494 |
| Migration tests | 3 of 3 |
| Frontend integration tests | 131 of 131 |
| Build | Pass |
| Browser tests, throwaway database | 130 of 130 |

Browser tests ran on ports 3100 and 4100 in the copy, because a development server was using port 3000. They run with `MFA_ENFORCE=off`. The workflow itself hasn't run on GitHub, because it isn't committed.

See also `PRIVILEGED_FUNCTIONS_SECURITY_REVIEW.md`.
