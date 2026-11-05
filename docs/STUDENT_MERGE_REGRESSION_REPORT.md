# Student Merge Regression Report

**Date:** 5 November 2026. **Handling: keep private until you decide.**

All tests ran on fresh throwaway PostgreSQL 17.11 databases with fictional data, in a scratch copy confirmed identical to the project before the run, apart from build output and the browser port change applied by the run script. The test tools apply the migration files only to those throwaway databases. **The development database and Production were not touched, and no real email or payment was involved.** The servers on ports 3000 and 4000 were left running.

## Final results

| Check | Result |
|---|---|
| Typecheck | Pass |
| Lint | Pass |
| SQL guard | Pass: 366 files, 22 findings, all 22 in the approved baseline, 0 unapproved |
| Backend tests | **651 of 651** |
| Migration tests | **14 of 14** (12 existing + 2 new for 0051) |
| Student merge tests | **21 of 21** (new) |
| Frontend tests | **131 of 131** |
| Build | Pass |
| Browser tests | **175 of 175** (173 existing + 2 new) |

No test was skipped, and no existing test expectation was changed. `migrations.test.ts` gained 2 tests; the existing ones were not edited.

## The tests can fail: control run

The new merge tests were first run **without 0051**, to confirm they detect the defects.

| Run | Result |
|---|---|
| Without the fix (20 tests at that point) | **19 failed, 1 passed.** Includes the original defect: `expected '50000.00' to be '0.00'`. The one that passed checks merge permissions, which were already correct |
| With the fix | All passed |

Some of the 19 fail because they read things that only exist with the fix, such as the new history action. They show the fix is needed less directly than the money tests do. The 21st test, on function permissions, was added after this control run.

## Coverage against your list

| Requirement | Test | Result |
|---|---|---|
| Fully paid charge | `a fully paid charge stays fully paid…`; browser test | Pass |
| Partly paid and unpaid | `partly paid, several payments… unpaid charges keep their exact amounts` | Pass |
| Several payments on one charge | Same test | Pass |
| Multiple charges and currencies | Same; `currencies are kept apart` | Pass |
| Money not shifted between records | `money on one record is not shifted…` | Pass |
| Ledger unchanged | Hash of every entry column except `student_id`, before and after | Pass |
| Balances accurate | Due, received and outstanding checked; unpaid total equals outstanding | Pass |
| Overdue reminders before and after | `reminders: one reminder before the merge is not repeated…` | Pass |
| Payment or reversal after a merge | `money received after a merge…` | Pass |
| Chain of merges | `a chain of merges keeps the same figures` | Pass |
| Preferences | 4 tests: moved, already held, equal to primary, cannot fit | Pass |
| Tickets and conversation | Messages, number, company, assignee; portal of the surviving record reads and replies; merged session refused | Pass |
| Pre-admission links | 3 tests: moved with history, both records' links kept, new link to merged record refused | Pass |
| Audit history | Merge counts, ticket and link audit entries, `student_merges` | Pass |
| Company isolation | Each company sees only its own money; other company refused tickets and pages; merge refused without permission | Pass, **see the ticket note below** |
| Merge rollback after a simulated failure | A temporary trigger makes the last step fail; hashes of all affected tables match; the same merge then succeeds | Pass |
| Migration rollback | With real merges in place, then re-applied | Pass |
| Browser | MD merges through the screen after finance records a paid charge; and a merge stopped with the reason shown | Pass |

**Ticket note:** after a merge **across companies**, a counsellor of the surviving company can read a question belonging to the other company. This follows the existing rule and was not changed. A test records it. It's a decision for you, listed in the fix report.

## Problems met on the way

All three happened in the first full run, which I rejected. None was in the merge logic.

| Problem | Cause | Action |
|---|---|---|
| SQL guard: 4 findings | The guard expects an explicit `revoke` next to a re-created function | Added. It changes nothing, since both were already closed to PUBLIC. A test confirms this |
| 5 backend tests failed | My cross-company merge test left merged students in the shared test database, upsetting counts in other tests | The merge tests now run on their own fresh database |
| 4 frontend tests failed | My scratch copy still had the browser port patch applied. It expected port 3000 and got 3100 | Restored the copy. Not a project problem |

I also corrected my own arithmetic in one new test (received 13,000, not 13,500) and a reversal test that had not completed the second-person verification. In both cases the test was wrong and the application was right.

## Not tested

- Real or development data, or an upgrade of a populated database
- PostgreSQL 18
- A true simultaneous merge and due date save
- Merges on the development app, which needs 0051 applied, and that was not allowed in this task
- Real phones or Safari, for this screen
- Old application code with 0051; the compatibility runs in the audit stopped at 0050
- Production build served end to end; browser tests use development mode
