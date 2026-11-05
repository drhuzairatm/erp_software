# Production Migration Execution Plan

**Date:** 5 November 2026. **Handling: keep private, out of Git.** It contains no credentials or server details.

**This is a plan only. Nothing has been applied, and no step here is approved.** It assumes the reported baseline of 37 migrations, which has not been verified. Details for each migration are in `docs/PRODUCTION_PENDING_MIGRATION_INVENTORY.md`.

## 1. Order at a glance

1. Check Production read-only (section 3).
2. Rehearse on a restored copy, on the same PostgreSQL version (section 4).
3. Back up Production and prove the backup restores.
4. Apply migrations one at a time, verifying after each (section 5).
5. Run `ANALYZE`, then check the **old app** still works.
6. Deploy the new application and API together.
7. Run a signed-in smoke test.

```text
0038_passport_warning_only.sql
0039_staff_notifications_secure_files.sql
0040_notifications_files_completion.sql
0041_employee_profiles.sql
0042_attendance.sql
0043_task_lifecycle.sql
0044_meetings.sql
0045_internal_chat.sql
0046_pre_admission_dvr.sql
0047_chat_governance.sql
0048_student_tickets.sql
0049_preferences_admission_rules.sql
0050_finance_due_dates.sql
0051_student_merge_related_records.sql
```

If any of 0001 to 0037 turn out to be missing, they come first and this plan must be revised.

## 2. Why this order

| Option | Result | Evidence |
|---|---|---|
| **Code only** | **Never do this.** Every staff page tested returned HTTP 500, while `/api/health` stayed 200, so the health check would not catch it | Executed on a throwaway database |
| **Migrations first, old app still running** | Works, and gives a safe point to pause | Executed with the old app on 0050 and now 0051: browser 56 of 57, with only expected and intermittent backend failures. Fictional data only |
| **Partial migration with the old app** | Expected to work, because the set is additive | **Not tested state by state** |
| **New code with a partial schema** | Not supported. The code needs all of 0039 to 0051 | Inventory |

**What the old app will notice once migrations run:**
- Passport rules warn instead of block (0038).
- New triggers create staff notification rows. Those rows wait unsent until the new mail worker runs, and entries older than 24 hours are skipped.
- Existing roles hold additional permissions.

## 3. Verify against real Production first

**This needs your separate authorisation.** All of it is read-only. Print names and counts only, never connection strings, secrets or personal data.

| # | Check | Stop if |
|---|---|---|
| 1 | `select version, checksum from public.schema_migrations order by version` against Appendix A of the inventory | Any row missing, extra, or with a different checksum, or any of 0038 to 0051 already present |
| 2 | `select version()` | Not the version rehearsed |
| 3 | Commit actually running, and whether its files match the reported `f36328f` | Different from what was reported, until reviewed |
| 4 | Which role owns the objects and runs migrations; `erp_app` exists | Unclear ownership |
| 5 | Role keys in `roles` | A custom or renamed role, because grants match by key and silently skip it |
| 6 | All rows of `passport_validity_rules` | Any rule whose change to `warn` is unwanted |
| 7 | `countries` has `BG`; `document_types` has `bonafide_certificate` and `police_clearance` | Absent means 0049 adds fewer rules, with no error |
| 8 | None of the new tables, columns or functions already exist under the same names | A collision: the file would fail and undo itself |
| 9 | These constraints exist with these names: `tasks_status_check`, `user_profiles_account_status_check`, `portal_notices_kind_check` | Different name: the file would fail and undo itself |
| 10 | Definitions of `set_staff_status`, `save_advisory_notice`, `student_advisories`, `merge_students` match 0037 | Hand-edited on the server, because those edits would be overwritten |
| 11 | Row counts and sizes for `tasks`, `user_profiles`, `organization_memberships`, `portal_notices`, `advisory_notices`, `student_documents`, `document_files` | Needed for lock estimates |
| 12 | Long-running transactions and scheduled job times | Anything that overlaps the window |
| 13 | Environment variable **names** only: `NODE_ENV`, `APP_ENV`, `NOTIFICATIONS_MODE`, mail, `CRON_SECRET`, storage, `APP_DB_PASSWORD` | Missing or unclear (BC-07) |
| 14 | Existing backups, their age, and whether one has ever been restored | No restorable backup |

## 4. Rehearse before Production

Restore a Production backup to an isolated server on the **same PostgreSQL major version**. Handle it as real personal data, with mail, payments and schedulers off.

Then record, for each file: duration, locks and whether it blocks a simulated read. Run the old app, then the new app, and try a real-sized student merge. **This is what will replace the 0.1-second figure from fictional data.**

## 5. Execution

### Before starting

| Item | Why |
|---|---|
| **Deliver the files explicitly.** The 14 migrations and their rollback files are untracked | Do not pull `main` onto the VPS: it holds email code rated NOT READY (BC-08). How the work reaches the server needs your commit decision |
| **Check the delivered files against Appendix A.** Line-ending or copy changes alter the checksum | The runner records the checksum permanently |
| **Check the `pg_dump` version.** `db-backup.ts` documents major version 17, and a version 17 `pg_dump` refuses a version 18 server | The backup would fail on the reported version |
| **Check `APP_DB_PASSWORD`.** If it is set, every `db:migrate` run also resets the `erp_app` password to that value | A different value would stop the app connecting |
| **Decide on a lock limit.** The runner sets no `lock_timeout` | A waiting lock queues all later requests. A timeout on the migrating role makes that file fail and undo itself rather than stall the app. This is a Production setting that needs your approval, tested in rehearsal, and removed afterwards |
| **Do not run `db:provision`** as part of this | Not needed. It would add further configuration |
| Choose a quiet window, pause scheduled jobs, tell staff | Writes wait briefly, and 0041 and 0043 can stop requests while they hold their locks |

### Backup

1. Run `npm run db:backup` immediately before the window. Do not overwrite earlier backups.
2. Restore it to an isolated database and compare row counts for key tables.
3. Record the time. Everything written after it would be lost on a restore.
4. Copy uploaded file storage separately. A database dump does not contain file contents.

### Applying one file at a time

`db:migrate` applies **every** pending file in the folder, and has no option to stop after one. To verify between files without changing the runner, **add one migration and its rollback file to the folder, run `db:migrate`, verify, and only then add the next.** Running it with all 14 present is simpler, but it gives no checkpoint between files.

**After every file:**
- `schema_migrations` has the new row with the checksum from Appendix A.
- The old app's sign-in and one student page still work.
- There are no new errors in the database or app logs, and no blocked sessions.
- `/api/health` alone is not sufficient.

| File | Extra check | Watch |
|---|---|---|
| 0038 | No `block` rule remains among global or registration-stage rules; count matches check 6 | Rule behaviour changes at once |
| 0039 | Both tables exist; 4 triggers present; update one test-safe task on staging only, not Production | Short write block |
| 0040 | Permission `announcements.publish` exists and role grants match | New security alerts are expected |
| 0041 | Status check includes `archived`; 9 designations per organisation; staff can still sign in | **Full lock on `user_profiles`** |
| 0042 | 8 tables present | |
| 0043 | Status check includes `submitted`; `tasks_open_deadline_idx` is valid; task count unchanged | **Full lock on `tasks`, plus an index build** |
| 0044 | 7 tables present | |
| 0045 | 6 tables present | |
| 0046 | 6 tables present; `dvr.*` permissions exist | |
| 0047 | 6 tables present | |
| 0048 | Portal notice check includes `ticket`; `tickets.*` grants match | Full lock on `portal_notices` |
| 0049 | 2 Bulgaria rules, or as predicted by check 7; advisories load | Full lock on `advisory_notices` |
| 0050 | `payment_due_status` view answers; ledger totals unchanged from before | |
| 0051 | `settled_on_merge` column exists; ledger totals unchanged | |

**Compare before and after the set:** counts of students, users, tasks, payment entries and student documents, and ledger totals. They must match unless normal work continued during the window.

### Afterwards

1. Run `ANALYZE`. In local testing, the dashboard took 12.6 s without it and 0.9 s with it, after a restore.
2. Keep the old app running and check it again. **This is a safe point to pause for as long as needed.**
3. Deploy the new application and API **together**. New routes such as `/api/chat/sync` need the new API.
4. Run a signed-in smoke test: dashboard, student, task, payment, and a page from each new module.
5. Only then start the mail worker and schedulers, watching the first run. The first task tick marks recent open tasks overdue (BC-13).

Real email, scheduler, virus scanner, monitoring and restore remain **not verified** (matrix Stage 4). This plan does not cover them.

## 6. Rollback and recovery

Use the first row that fits.

| Situation | Action | Data loss |
|---|---|---|
| **A file fails while running** | It undoes itself and later files don't run. Stop and diagnose. **Do not edit the file** if it has been applied anywhere; otherwise re-delivery changes the checksum, which needs a decision | None. Earlier files remain, which should suit the old app, though this was not tested state by state |
| **Old app misbehaves during migration, no new data yet** | Roll back the newest file(s) with their rollback scripts, or restore | Little, apart from the effects listed per file |
| **New app has a problem after go-live** | **Roll back the application only and keep the schema** | None. New module data stays. Tasks marked `submitted` or staff marked `archived` may look unfamiliar to the old app |
| **Schema must be undone after staff used new modules** | Separate decision. Roll back newest first | **All data in the rolled-back modules**, plus the status conversions and merge effects listed in the inventory |
| **Data damage** | Restore the backup to a new database, compare, then switch | **Everything since the backup** |

**Rollback tool limits:**
- `db:migrate --rollback NNNN` undoes newest first, down to and including that number.
- It is **refused when `NODE_ENV=production`**, and on a non-local database it needs `--confirm-rollback`. That guard is deliberate, so overriding it needs your explicit approval at that moment.
- The 0038 rollback **restores blocking rules**, which conflicts with your 4 Nov decision unless you approve it.
- Rolling back does not remove uploaded files from storage. They need manual clean-up.

**Tested so far:** the full chain from 0051 to 0038 on fictional data with empty new tables. **Not tested:** rollback on real data, rollback after the new modules are in use, restore on Production.

## 7. Approvals needed

| # | Decision |
|---|---|
| 1 | Read-only check of Production (section 3) |
| 2 | How the uncommitted work reaches the server, and the Git step behind that |
| 3 | Rehearsal environment, using a real backup |
| 4 | Business decisions: passport rule list, Bulgaria rules, role access, self-service names, legal notice, virus scanner |
| 5 | Accepting the postponed Trust Boundary risk before real data enters the new modules |
| 6 | Lock timeout and maintenance window |
| 7 | The migration itself, separately, after 1 to 6 |
