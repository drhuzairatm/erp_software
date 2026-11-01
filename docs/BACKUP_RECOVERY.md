# Backup and recovery

> **Status (1 Nov 2026):** no staging or production environment exists, so provider backups are **not yet configured**.
> **Tested so far:** a backup → isolated restore drill on the development database passed 31/31 checks (BACKUP_RESTORE_DRILL.md; repeat with `npx tsx scripts/backup-restore-drill.ts`, local/staging only).
> **Not yet tested:** the `pg_dump`/`pg_restore` procedure below (client tools not installed; downloading them needs owner permission) and the hosting provider's restore.

## What must be backed up

| Data | Where | Method |
|---|---|---|
| Database (all records, audit log) | Managed PostgreSQL | Provider daily backups (+ Point-in-Time Recovery if enabled) **and** a weekly logical dump you keep |
| Document files | Private bucket | Bucket versioning / replication, or a scheduled copy to a second bucket in another account |
| Configuration & secrets | Hosting env vars, password manager | Kept in a company password manager by two named people |
| Source code | Private Git repository | Hosted Git + local clones |

Targets for the pilot (adjust as needed): **RPO** ≤ 24 h (≤ minutes with PITR), **RTO** ≤ 4 h.

## Database

### Before every migration or release
1. `npm run db:backup` (needs PostgreSQL 17 client tools; writes `backups/*.dump`, git-ignored).
   On the development Mac these tools are not installed yet, so local backups are not possible until
   `pg_dump` is installed (e.g. via Homebrew `postgresql@17`).
2. Apply migrations. Every migration from `0017` has an undo script in `db/rollbacks/`; the migration tool
   refuses new migrations without one.
3. If something goes wrong: `npm run db:migrate -- --rollback 0018` undoes 0018 and anything newer
   (newest first). For non-local databases add `--confirm-rollback`; never run it in production without
   a fresh backup. Rollback scripts only remove what the migration added; they never delete pre-existing
   business data, and refuse/skip where data now depends on the new structures.

Supabase Pro includes daily backups (7 days); the PITR add-on gives second-level restore. In addition,
keep your own weekly encrypted dump (run with the owner URL from a trusted machine):

```bash
pg_dump "$DATABASE_ADMIN_URL" --format=custom --no-owner --file erp-$(date +%F).dump
gpg --symmetric --cipher-algo AES256 erp-$(date +%F).dump && rm erp-$(date +%F).dump
```
Store the encrypted file outside the provider (e.g. company cloud drive with restricted access).
Retain e.g. 8 weekly + 12 monthly copies, then delete (personal data must not be kept forever).

### Restore (test this quarterly)
1. Create a **new** empty database (never restore over production first).
2. Create the application role first (roles are not included in dumps):
   `psql "$NEW_ADMIN_URL" -c "create role erp_app nologin noinherit nobypassrls"`
3. `pg_restore --no-owner --dbname "$NEW_ADMIN_URL" erp-YYYY-MM-DD.dump`
4. Set the app role password: `APP_DB_PASSWORD=... DATABASE_ADMIN_URL=$NEW_ADMIN_URL npm run db:migrate`
   (applies nothing new but sets the `erp_app` password).
5. Point a staging deployment at it, log in, check counts on the dashboard and open a few documents.
6. When verified, switch production `DATABASE_URL` and record the incident in the audit notes.

## Files

- Enable versioning (S3/R2) or schedule a nightly sync of the bucket to a backup bucket with separate
  credentials (e.g. `rclone sync`). Database rows reference files by storage key, so a database restore
  needs the files from the same time or later.
- Never make the backup bucket public.

## Accidental changes inside the app

- Students are archived/merged, not deleted; payments are reversed, not deleted; the audit log keeps
  before/after values — most mistakes can be corrected in the app without a restore.

## Incidents

See **INCIDENT_RESPONSE_PLAN.md** (§4.8 database compromise, §4.9 backup failure or corruption). It replaces the short checklist that used to be here.
