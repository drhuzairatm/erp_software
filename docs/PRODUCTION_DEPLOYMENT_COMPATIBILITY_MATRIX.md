# Production Deployment Compatibility Matrix

**Date:** 5 November 2026. **Handling: keep private, out of Git.** It contains no credentials or server details. **Nothing described here was deployed.**

Companion to `docs/PRODUCTION_BREAKING_CHANGE_AUDIT.md`; BC numbers refer to its register.

**The Production baseline is reported, not verified:** `f36328f`, 37 migrations, PostgreSQL 18. Every cell below assumes it. "Executed" means run on a throwaway database with fictional data and PostgreSQL 17.11, never on Production.

## Deployment stages

| Stage | What changes | Result | Evidence | Can it interrupt Production? | Verdict |
|---|---|---|---|---|---|
| **1. Application code only** | New Next.js and API, schema 0037 | **All staff pages tested return HTTP 500.** Sign-in works, `/api/health` stays 200 | Executed, R3 | **Yes, total for staff** | **Never do this** |
| **2. Database migration only** | Schema 0050, old app `f36328f` | Old app works. Passport rules warn. New triggers run, and queued staff emails wait unsent | Executed, R2: backend 369/374, frontend 119/119, browser 56/57; all failures explained | Short lock waits; real durations unknown | Compatible on fictional data. **Not verified on real data** |
| **3. Application plus migration** | Migrate, `ANALYZE`, then new app and API | Full suite passes, on a fresh database rather than an upgrade | Executed, R1: 651 + 12, 131, 173 | Brief, if order is kept | Staging first. Fix BC-03 |
| **4. Full application and infrastructure** | Stage 3 plus real email, scheduler, scanner, backups, monitoring | Unknown | **Not executed** | Unknown | NOT VERIFIED |

## Compatibility checks

| Check | Answer | Basis |
|---|---|---|
| New frontend with existing backend | **Not compatible, because the frontend queries the new schema directly.** With an old API process on top, `/api/chat/sync` and `/api/secure-files/:id` would also return not found | R3 executed for the schema; API mix reasoned only |
| New backend with existing frontend | Likely compatible: routes are only added. Old pages don't use the new ones | Reasoned only, not run |
| Production database supports new code | **No, not until 0038 to 0050 are applied** | R3 |
| Migration order | 0038 to 0050, in order, each in its own transaction. A failure stops there, leaving earlier ones applied; the old app should still work at that point, though partial states were not individually tested | Runner source |
| Existing environment variables | Keep working. `RESEND_API_KEY` and `EMAIL_FROM` work again as fallback in the working tree | Source |
| New mandatory environment variables | **None.** `SYSTEM_MAIL_*` is optional | `.env.example`, code scan |
| Environment to confirm | `NODE_ENV`, `APP_ENV`, `NOTIFICATIONS_MODE` (BC-07), mail settings, `CRON_SECRET`, storage settings. Names and presence only; values should not be printed | NOT VERIFIED |
| Scheduled job configuration | Both cron routes must run. Task reminders need a frequent schedule; otherwise reminders and queued mail stop quietly. Existing jobs remain | Source; server schedule NOT VERIFIED |
| Real email | Never tested | NOT VERIFIED |
| Virus scan infrastructure | Absent. Uploads are labelled, not blocked | Blocked |
| File storage | New modules need the same storage as documents. Attendance photos add volume. Rights and space unverified | NOT VERIFIED |
| Dependencies | No change since `f36328f`. Standard install and build still needed | Verified |
| Node version | CI uses 24. Production unknown | NOT VERIFIED |
| PostgreSQL version | Reported 18, tested on 17.11 | NOT VERIFIED |
| Provisioning | Not needed for the app to run. If run, it adds designations and Bulgaria rules marked verified (BC-12) | Source |
| Deployment ordering | **Backup → migrate → `ANALYZE` → check old app → application and API together → signed-in smoke test** | R2 and R3 |
| Health check | `/api/health` does not detect schema mismatch | R3 |
| Git state | The working tree is not committed. `main` holds email code rated NOT READY (BC-08) | Source; earlier report |

## Rollback

| Situation | Restores the previous app? | Data loss |
|---|---|---|
| App rollback only, schema stays at 0050 | **Yes, on fictional data** (same as Stage 2). Tasks marked `submitted` or staff marked `archived` by the new app may look unfamiliar to it | None. New module data stays in place |
| App and database rollback | Yes, rollback tested newest first on fictional data | **All data in new modules:** attendance, meetings, chat, governance, DVR, tickets, preferences, academic years, country rules, due dates, notifications, secure file records |
| Status values on database rollback | | `archived` → `terminated`; `submitted` → `in_progress` |
| 0038 rollback | Yes, exact, by test | Rules return to `block` |
| File contents on database rollback | **Not removed.** Files stay in storage, unreferenced | Needs a manual clean-up |
| Restore from backup | NOT VERIFIED on Production | Everything since the backup |

**Recommendation for a problem soon after go-live:** roll back the application and leave the schema in place. It loses nothing, and old-app compatibility is the better-tested path. Do not roll back the database once staff have used the new modules without a separate decision.

## Before each stage

| Before | Must be true |
|---|---|
| Any Production step | Baseline established read-only with your authorisation; backup restored and verified; uncommitted work safely copied |
| Staging | BC-03 and BC-04 fixed; decisions on BC-10, BC-11, BC-12 |
| Stage 2 in Production | Staging rehearsal with real-size lock times on PostgreSQL 18; `lock_timeout` plan; Production passport rule list reviewed; quiet window |
| Stage 3 in Production | Old app verified after migration; a signed-in smoke test ready; staff told about emails and changed labels |
| Stage 4 in Production | Real email, scheduler, scanner, monitoring and restore all proven |
