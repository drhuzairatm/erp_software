# Migration 0038 review

**Status:** **applied to the local development database only, 4 Nov 2026, with MD approval.** Not applied to production or any other database.

## Result on the development database

| Check | Result |
|---|---|
| Target | `erp_dev` on localhost, PostgreSQL 17.11 |
| Backup first | `.data/backups/pre-0038-2026-11-04T16-31-55`, verified: 107 tables identical |
| Rehearsal | Isolated copy; matched exactly |
| Rule changed | The one row below, `block` → `warn`, with the note added |
| Passport issues | 239 at `block` before, 239 at `warn` after |
| Tables changed | Only `schema_migrations`, `audit_logs`, `passport_validity_rules` |
| Schema | Unchanged |
| Migrations recorded | 38 |
| Audit | The change is recorded |

The sections below are the review carried out before it was applied.
**Files:** `backend/db/migrations/0038_passport_warning_only.sql`, `backend/db/rollbacks/0038_passport_warning_only.down.sql`.

## Row changed in the development database

Read-only dry run of the migration's `WHERE` clause. **Exactly one row matches.**

| Field | Value |
|---|---|
| id | `4610d324-29ac-4cd9-91db-1b48ca0ac889` |
| Name | Passport valid for at least 12 months (all destinations) |
| Scope | All students: no destination, university or course |
| From stage | `university_application`; 12 months |
| Enforcement | `block` → `warn` |
| Notes, after | Existing note, then `[0038: warning only by MD decision, 4 Nov 2026]` |

**Why it must change:** it blocks every student globally, including when the expiry is missing, which is what the MD decision forbids. It has no university scope, so it can't be a verified university-specific restriction.

The other 34 rules are inactive warning rules from test runs and don't match. The development database has **no** blocking university rule.

## Effect on verified university rules

| Rule | Result | Tested |
|---|---|---|
| Blocks one university, starts after Registration, active or inactive, with or without a course | **Unchanged** | Yes |
| Blocks one university, starts at or before Registration | Becomes `warn`, because Registration must stay allowed | Yes |
| Blocks a whole country, a course with no university, or everyone | Becomes `warn` | Yes |

**Caution for other databases:** a rule with no university is changed even if it has an official source, because the MD decision allows blocking only for a specific university. So a verified **country-wide or course-only** restriction would be downgraded. Production was not inspected, so run this read-only check before any future application. On a test with all seven rule types, it listed exactly the four that changed:

```sql
select id, name, stage_key, university_id, course_id, destination_country_id, is_active, notes
  from passport_validity_rules r
 where r.enforcement = 'block'
   and (r.university_id is null
        or (select s.sort_order from stages s where s.key = r.stage_key) <= (select s.sort_order from stages s where s.key = 'registration'));
```

## Disposable database results

An exact copy of the development rule was set on a throwaway database, with one verified university rule and one inactive global block added. Every table in `public` and `auth_private` was fingerprinted.

| Check | Result |
|---|---|
| Passport issue for a student with no expiry | `block` → `warn` → `block` (rollback) → `warn` (re-applied) |
| Tables changed by the migration | Only `passport_validity_rules`, `audit_logs` (+2 rows), `schema_migrations` |
| Tables changed by the rollback, compared with the start | Only `audit_logs` (its own entries are kept) |
| Schema: functions, access lists, policies, triggers, table grants, constraints | **No difference** |
| Notes after rollback | Restored exactly, including on the seven rule types above |
| Audit entries | Before and after values recorded; actor is empty, because a migration has no signed-in user |
| Student, employee and document tables | **No difference** |

**Limits of the rollback:**
- It finds rows by the note text, so a rule whose note was later edited to remove that text stays `warn`.
- On a database first created with the new default, the rule was never `block`, so rollback leaves it `warn`.
- It restores blocking, which conflicts with the MD decision unless the MD approves it.
