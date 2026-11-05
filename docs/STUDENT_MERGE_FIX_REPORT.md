# Student Merge Fix Report

**Date:** 5 November 2026. **Scope:** audit findings BC-03 and BC-04 only, on local development and throwaway test databases.
**Handling: keep private until you decide.** It describes open risks at summary level. It contains no credentials or server details.

## Result

Both defects are fixed in the working tree and tested on throwaway databases. **Nothing is committed or deployed, and 0051 has not been applied to the development or Production database.** The development app therefore still merges the old way until you approve applying it.

Results are in `docs/STUDENT_MERGE_REGRESSION_REPORT.md`.

## What was wrong

| Finding | Before the fix |
|---|---|
| BC-03 | A merge moved the charge but left its due date behind. A fully paid ₹50,000 charge showed ₹50,000 unpaid on the merged record, nothing on the surviving record, and could raise false overdue reminders and emails |
| BC-03, found during this fix | Moving the due date alone would not have been enough. The ledger has no link between a receipt and a charge: credits settle the earliest due date first. Pooling two records' credits could move the money onto the other record's older charge, and the paid charge would look unpaid again |
| BC-04 | Preferences, preference history, tickets and pre-admission links stayed on the merged record, which is read-only and no longer the working record |
| BC-04, found during this fix | A pre-admission request could still be linked to an already merged record, leaving the link orphaned |
| Testing gap | No automated test covered student merge at all before this work |

## Before and after

| Situation | Before | After |
|---|---|---|
| Paid charge, then merge | Shows unpaid on the merged record | Stays settled, shown on the surviving record |
| Paid charge on one record, older unpaid charge on the other | Wrong record affected | Each keeps its own figure; the total matches the balance |
| Partly paid or unpaid charge | Wrong or missing | Same unpaid amount as before the merge |
| Overdue reminder | Could fire falsely, linking to the merged record | None for settled charges; not repeated for open ones; new ones link to the surviving record |
| Receipt reversed after a merge | Not applicable | The recorded amounts no longer hold, so figures go back to earliest first and the total owed stays right |
| Preference | Stays behind | Moves to the same rank, or the free rank if that is taken |
| Preference already held, or equal to the surviving primary choice | Stays behind | Not duplicated; its details are kept in the history |
| Different preferences that cannot all fit (only ranks 2 and 3 exist) | Stays behind silently | **The merge stops, gives the reason, and nothing changes.** Clearing one lets it through |
| Ticket | Stays behind; the surviving portal account cannot see it | Moves with number, company, messages, files and assignee; event and audit entry added; ticket notices move too |
| Pre-admission link | Stays behind | Moves; who linked it and when are kept; event and audit entry added |
| Linking a request to a merged record | Allowed | Refused, naming the reason |
| Any failure during a merge | Whole merge undone | Same, and now proven by a test |
| Ledger totals | Not checked | Compared before and after inside the merge. A difference stops it |
| Merge audit entry | Reason and target | Also counts what moved |

**The ledger is not altered.** A merge still only changes `student_id` on each entry, as it always has, through the existing guard. No entry is added, deleted, copied or re-valued. Tests compare every other column by hash before and after.

## Files changed

| File | Change |
|---|---|
| `backend/db/migrations/0051_student_merge_related_records.sql` | **New.** All database changes |
| `backend/db/rollbacks/0051_student_merge_related_records.down.sql` | **New.** Rollback |
| `backend/tests/integration/student-merge.test.ts` | **New.** 21 tests |
| `frontend/tests/e2e/student-merge.spec.ts` | **New.** 2 browser tests |
| `backend/tests/integration/migrations.test.ts` | 2 tests added for 0051 |
| `backend/package.json` | `test` script: the merge tests run on their own fresh database, as `migrations.test.ts` already does. Their cross-company merges would otherwise upset other tests' counts. No dependency changed |
| `frontend/src/app/(app)/students/[id]/preferences-panel.tsx` | History wording for the two new actions |
| `frontend/src/app/(app)/students/[id]/panels.tsx` | The merge form now lists what moves |
| `docs/STUDENT_MERGE_FIX_REPORT.md`, `docs/STUDENT_MERGE_REGRESSION_REPORT.md` | **New.** These reports |

No application service, route, authentication, session, cookie, MFA, Argon2id or RLS code changed. No policy changed. The Trust Boundary work was not started. Policy and table counts are unchanged at 202 and 139.

## Database changes (0051)

| Object | Change |
|---|---|
| `payment_due_dates` | New column `settled_on_merge`, default 0 |
| `student_preference_history` | New nullable column `note`; two new allowed actions, `merged_in` and `merged_duplicate` |
| `payment_due_status` view | Takes the student from the charge itself, so the two cannot disagree; honours recorded amounts first, then spare credit earliest first. **Same columns.** With no merge involved, the figures are the same as before |
| `app.merge_students` | Records settled amounts; moves due dates, preferences, history, tickets, ticket notices and links; checks ledger totals; extends the audit entry. Permission checks unchanged |
| `app.dvr_link_student` | One added line refusing a merged record |
| Existing rows | A due date not matching its charge's student is corrected. No other row changes when the migration runs |

Execute permissions are unchanged, and a test confirms it: closed to PUBLIC, open to the application role.

**Rollback:** tested with real merges in place. Moved records stay on the surviving student, where they are correct. Recorded settled amounts are lost, so figures go back to earliest first, which can change which charge shows as unpaid, though not the total. History rows written by a merge are removed, while the audit log keeps the counts. After a rollback, merges leave these records behind again.

**Deployment:** 0051 belongs with 0038 to 0050 and depends on them. It must not be applied before them.

## Remaining risks and limitations

| Severity | Item | Note |
|---|---|---|
| **Your decision** | **Ticket access after a merge across companies.** A counsellor of the surviving company can read a question that belongs to the other company | This follows the existing rule: ticket access follows access to the student, and a merge shares the student. I did not change it because you excluded security boundaries. A test records today's behaviour, so any change will be deliberate |
| **Your decision** | Whether stopping the merge is right when preferences cannot all fit | I chose to stop, as you instructed for anything that cannot merge safely. Staff must clear one first |
| Medium | **Other student records still stay on the merged record, as they always have:** passports, academic records, name checks, one-and-same cases, consents, contact changes, advisory acknowledgements, shipments, photos, document merges, portal publications, other portal notices, referral codes, referrals, leads, stage history, events and messages | Older behaviour, outside BC-03 and BC-04, so not changed. They remain readable on the merged record, which the surviving record links to. Worth reviewing separately |
| Medium | **Portal access:** a merged record's portal account stops working. The student sees moved tickets only with an account on the surviving record | Existing rule. Staff must set one up if it is missing |
| Medium | **"Settled" remains a display rule.** The ledger still does not link receipts to charges | Open decision 8 in the readiness report. Instalment allocation would be a separate feature |
| Low | The merged record's **primary** choice stays on that record and does not become a preference | It stays visible there. Converting it automatically would be guesswork |
| Low | Merges done before 0051 are repaired only for due dates, and with no recorded settled amounts | Production has no such data, as these tables do not exist there yet (reported, not verified). Preferences, tickets and links left on an earlier merged record are not moved. The development database was deliberately not inspected or changed |
| Low | Reminders sent before the fix stay in staff notification lists | Not rewritten |
| Low | A due date saved at the same instant as a merge could keep the old student on its row | The view follows the charge, so figures stay right. Not tested under real concurrency |
| Low | A merge still cannot be undone from the app | Existing behaviour |
| Not verified | Real data, PostgreSQL 18, Production | All tests use fictional data and PostgreSQL 17.11. Production verdict is unchanged: **insufficient evidence** |
