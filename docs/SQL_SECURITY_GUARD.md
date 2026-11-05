# SQL security guard

A read-only check for unsafe SQL in new or changed code. It reads source files and reports. It never changes a file, a function or a permission, and it never connects to a database.

```
npm run guard:sql                     every source file, and migrations after 0038
npm run guard:sql -- --changed REF    only files changed since a local git ref (never fetches)
```

It exits with an error if a finding isn't approved, and CI runs it before the tests.

## What it detects

**Application code** (`backend/src`, `frontend/src`), by reading the code's structure rather than searching text:

| Rule | Detects |
|---|---|
| SG01 | `.unsafe()` with text that isn't fixed in the source, including request values, joined text, `let` variables and function parameters |
| SG02 | `.unsafe` taken as a value, so its later use can't be checked |
| SG03 | SQL built as an ordinary string from values that aren't fixed |
| SG04 | Setting any `app.*` database setting (identity, IP, guard flags) outside `backend/src/lib/db.ts` |
| SG05 | Changing the database role from application code |
| SG06 | Reading or writing `auth_private` directly |
| SG07 | Using `DATABASE_ADMIN_URL` in running application code |
| SG08 | A secret-looking value exposed to the browser through `NEXT_PUBLIC_` |

**New migrations and rollbacks** (numbered after 0038; earlier ones are applied and can't change):

| Rule | Detects |
|---|---|
| SQL01 | SECURITY DEFINER function with no fixed `search_path` |
| SQL02 | New SECURITY DEFINER function with no `revoke execute ... from public` in the same file |
| SQL03 | Any grant to PUBLIC. The proposed Stage A and B rollback is the one exception, because restoring that access is its purpose |
| SQL04 | Dynamic SQL built by joining text or with `%s` |
| SQL05 | Turning off row-level security or a trigger |
| SQL06 | New table with no row-level security in the same file |
| SQL07 | A policy that allows every row |
| SQL08 | Reading or setting `app.user_id` |

## Approved findings

`backend/scripts/sql-guard.baseline.json` lists the only three approved findings today, each with a written reason. An entry approves that exact code only. If the code changes, the finding returns; if the code goes away, the guard reports the entry as stale.

| Finding | Why it is approved |
|---|---|
| SG01 and SG03, `attestation.ts` | Fixed text: a constant with a `.replace()` of two literals. The route id is a bound parameter |
| SG01, `dashboard.ts` | `alias` is a parameter, but no caller passes it from a request |

## Limits

It raises the cost of a mistake, and it doesn't prove the code is safe.

- **It can't see intent.** A correct query that forgets a permission check passes.
- **It follows values only within one file.** A constant imported from another file is reported, which is a false alarm, and text received from another file inside a tagged template isn't seen, which is a miss.
- **The `tx(column)` identifier helper isn't checked.** A column name taken from a request would pass. No such use exists today, but the guard doesn't prove that.
- **It doesn't read `backend/scripts`.** Those scripts run by hand with the administrator connection.
- **It doesn't read function bodies in migrations up to 0038.** The privileged functions review covers those.
- **A person can approve a bad finding.** Baseline changes need review.
- **It doesn't address the `erp_app` trust problem.** It reduces the chance of SQL injection, but anyone who gets SQL access some other way is unaffected.

## Tests

`backend/tests/unit/sql-guard.test.ts` has 42 tests: every rule against bad code, safe code that must not be flagged, and the approval logic. Three of them record known misses, so a future improvement will show up as a test change.
