# Production state report (Stage 0)

> **PAUSED by MD decision, 4 November 2026.** No VPS connection, SSH setup or production script for now. For current status see `LOCAL_PROJECT_READINESS_REPORT.md`. Kept for reference; do not run the script.

> **Historical deployment discrepancy (MD decision, 4 Nov 2026).** The development baseline is GitHub `main` / local `3df4171`, whose files are identical. The commit previously reported on the VPS, `f36328f`, is 8 commits behind (50 files, no schema change) and is not the development baseline. The VPS was not inspected, so what it runs now remains unverified.

**Date:** 4 November 2026
**Result:** **BLOCKED for everything that requires access to the server.** The repository side is complete.

This machine has no route to the VPS: there is no SSH configuration, no private key and no production address in the repository or local `.env`. I did not guess hosts or credentials. No production system was contacted, so nothing below describes the running server unless it is labelled **Reported**.

To finish this report, run `docs/audit/stage0_production_readonly_check.sh` on the VPS (see section 14). It was trialled here against the local development database: it ran to completion, all database checks returned results, and the only `.env` value of 8 or more characters in its output was a non-secret local folder path.

## Evidence labels

| Label | Meaning |
|---|---|
| **Verified on Production** | Observed on the VPS. So far only: SSH port open, password login offered |
| **Verified in Local Source** | Read in source, including GitHub through a throwaway clone |
| **Verified in Local Development Database** | Read-only session on fictional data; proves design, **not** production |
| **Reported but Not Verified** | Told to me, never confirmed |
| **Blocked / Requires Access** | Needs server access |
| **Not Applicable** | Doesn't apply |

## Summary

| Item | Status | Finding |
|---|---|---|
| A. Production commit and branch | **Blocked / Requires Access** | Reported: `main` at `f36328f` |
| B. Local vs production | **Partly verified** | `f36328f` compared with `main` below; running code unconfirmed |
| C. Frontend, backend, PM2, Nginx | **Blocked / Requires Access** | Reported running; no process, port or status seen |
| D. PostgreSQL, schema, migrations | **Blocked / Requires Access** | Reported PG 18; repository has 37 migrations at both commits |
| E. Backups | **Blocked / Requires Access** | No schedule in the repository; latest successful backup unknown |
| F. Jobs, email queue, passport reminders | **Blocked / Requires Access** | **The repository has no VPS schedule, so these may not be running** |
| G. Authentication, authorization, DB security | **Design verified** | Production settings unknown |
| H. Company isolation, student data | **Design verified** | Not proven on production |
| I. File storage, virus scanning | **Design verified** | Driver and scanner unknown on production |
| J. Tests and staging | **Partly verified** | 83 test files, no CI in the repository; tests passed locally on 4 Nov; staging not seen |

## Most urgent finding: do not pull `main` onto the VPS yet

**Verified in Local Source.** Remote `main` is `d123404`, a merge of PR #2. Its files are identical to `refactor/express-api` at `3df4171`.

So `main` now contains the email replacement that `docs/audit/RESEND_TO_NODEMAILER_DEPLOYMENT_READINESS.md` rated **NOT READY**. Nothing has been deployed by me, and whether the VPS has pulled it is unknown. If it is pulled before these are dealt with:

| Effect | Evidence |
|---|---|
| A server configured only for Resend stops sending system email without an obvious error (F-5) | Readiness audit |
| Test mode does not stop system email (F-1) | `backend/src/lib/email.ts:81-93`, re-read at `3df4171` |
| Addresses containing an apostrophe are refused (F-4) | `email.ts:21` against `validation.ts:194` |

### Which email defects apply depends on the deployed commit

Verified in Local Source. Deployed commit: Reported but Not Verified.

| Defect | At reported `f36328f` (Resend over HTTP) | At `main` (Nodemailer) |
|---|---|---|
| Test mode doesn't stop system email | **Present:** `sendEmail` has no mode check | **Present** |
| Apostrophe addresses refused | Not present in that code | **Present** |
| Resend-only setup silently stops | Not present; Resend is what it uses | **Present** |

So if the VPS is really at `f36328f`, the second and third arrive only on pulling `main`.

## A. Production commit and branch

| Item | Value | Evidence |
|---|---|---|
| Branch and commit on the VPS | `main`, `f36328f` | Reported but Not Verified |
| Commit exists on GitHub | Yes, an ancestor of `main` | Verified in Local Source |
| Uncommitted changes on the VPS | Unknown | Blocked / Requires Access |

## B. Local versus production

| Comparison | Result | Evidence |
|---|---|---|
| Local branch vs remote branch | Same, `3df4171` | Verified in Local Source |
| `refactor/express-api` vs `main` | No file differences; `main` has only the merge commits on top | Verified in Local Source |
| `f36328f` to `main` | 50 files, +1,464 / −146, from 9 commits plus the merge | Verified in Local Source |
| Schema (`backend/db`) | **No change**; 37 migrations at both | Verified in Local Source |
| Backend source | **Only `backend/src/lib/email.ts`** | Verified in Local Source |
| Configuration template | `.env.example` changes (mail settings) | Verified in Local Source |
| Remainder | Responsive frontend, tests and documents | Verified in Local Source |

If the VPS really is at `f36328f`, deploying `main` needs **no database migration**. It does change email behaviour and needs a frontend rebuild. Local `main` is stale at `eb8dd7d`; that does not affect the comparison above.

## C. Running services: Blocked

Nothing observed. Expected from the repository: `next start` plus `start:api` (Express, loopback only), which needs `INTERNAL_API_SECRET`.

There is no PM2 or Nginx configuration in the repository, so the server's setup can't be compared with a reference. `docs/DEPLOYMENT.md` has Nginx guidance for Hostinger, but its main path is Vercel and it omits PM2 and the API process (finding F-6).

## D. PostgreSQL, schema and migrations

| Item | Production | Local reference |
|---|---|---|
| Version | Reported 18; Blocked | 17.11 |
| Migrations applied | Blocked / Requires Access | 37 of 37 |
| Tables | Blocked / Requires Access | 90 public, 17 `auth_private` |
| RLS enabled | Blocked / Requires Access | 89 of 90 (only `schema_migrations` excluded) |
| Policies | Blocked / Requires Access | 149 on 89 tables |
| Triggers | Blocked / Requires Access | 154, of which 54 are audit |
| Functions in `app` | Blocked / Requires Access | 291, of which 263 SECURITY DEFINER |
| Foreign keys, checks, unique constraints | Blocked / Requires Access | 279, 281, 50 |

## E. Backups: Blocked

| Point | Finding | Evidence |
|---|---|---|
| Latest successful backup | **Unknown** | Blocked / Requires Access |
| Automated schedule | None in the repository | Verified in Local Source |
| Tool | `npm run db:backup`, documented as needing pg_dump matching server version 17 | Verified in Local Source |
| Risk | On PG 18 with an older pg_dump, a dump refuses to run (F-14) | Inference from reported version |
| Restore test | 31/31 on the development database, 1 Nov; never on production | `docs/BACKUP_RESTORE_DRILL.md`, not re-run |

**Treat production as having no proven backup until shown otherwise.** Taking one should come before any production change.

## F. Scheduled jobs, email queue, passport reminders: Blocked

| Job | Should do | Trigger in the repository |
|---|---|---|
| `/api/cron/notifications` | Send queued messages, every minute | Only `frontend/vercel.json`, which **does nothing on a VPS** |
| `/api/cron/daily` | Passport monitor, expiry housekeeping, rescan | Same |

Unless someone added cron on the VPS by hand, **queued email would not send and the daily passport monitor would not run**. This is an inference from the repository, to be settled by the script.

Passport reminders work two ways:
- When a passport is entered or changed, `app.passport_monitor` runs at once and raises a task.
- A passport that later crosses into a stricter tier relies on the daily job.

## G. Authentication, authorization and database security

**Design verified in source; local database figures only. Production settings are Blocked.**

| Control | Implementation |
|---|---|
| Passwords | Argon2 |
| Staff MFA | TOTP with recovery codes; `MFA_ENFORCE` defaults to `all` and must not be relaxed on production |
| Sessions | Hashed server-side, 12-hour life, `__Host-` cookie in production |
| Portal | Separate accounts and sessions |
| Database role | App connects as `erp_app`: not superuser, no BYPASSRLS, not table owner |
| Request identity | `set_config('app.user_id', …, true)` inside a transaction in `withUser` (`backend/src/lib/db.ts`) |
| Fail-closed | Tested locally: `erp_app` with no user sees 0 students, tasks, payments and leads |
| Secrets schema | `auth_private` not usable by `erp_app` |
| Audit | `erp_app` has SELECT only on `audit_logs`; written by triggers and SECURITY DEFINER functions |
| Sensitive columns | `erp_app` cannot directly read 13 `students` columns (phones, email, date of birth, passport, parent contacts) |

**Open weakness, now confirmed locally:** 173 SECURITY DEFINER functions in `app` are executable by PUBLIC (A-03). They rely on internal checks, and it should be tightened.

## H. Company isolation and student data protection

**Design verified; not proven on production.**

- Isolation is enforced by RLS through `app.has_perm` and `app.can_on_student`, not only in the application.
- Suites exist: `db-isolation`, `isolation`, `security-matrix`, `boundary`, `isolation.spec`. They last passed earlier on 4 Nov, before `3df4171`, and were not re-run now.
- The script repeats the no-user test on production, reading nothing personal.

## I. File storage and virus scanning

| Point | Finding | Evidence |
|---|---|---|
| Drivers | `local` or S3-compatible | Verified in Local Source |
| Links | Signed, 60 seconds | `storage/index.ts:30` |
| Scanner | ClamAV or an HTTPS scanning service (`scanner.ts`); configured by environment | Verified in Local Source |
| Without a scanner | Files are stored as `not_scanned`; manual clearance by an authorised person | Local DB: 353 not scanned, 25 cleared, 0 scanned |
| Production driver, scanner state, file counts | Unknown | Blocked / Requires Access |

## J. Automated tests and staging

| Point | Finding | Evidence |
|---|---|---|
| Test files | 83 | Verified in Local Source |
| Last full run | Backend 405/405, migrations 2/2, frontend 129/129, browser 130/130, earlier on 4 Nov, **before `3df4171`** | Earlier session run |
| Re-run for this report | **No.** Not run because of the no-write instruction | Not tested |
| CI | None in the repository | Verified in Local Source |
| Staging | None in the repository; docs last said none exists (1 Nov) | Server side Blocked |

## 11. Passport policy: existing rules

**Your decision:** registration must remain allowed with warnings and renewal reminders.

| Question | Finding | Evidence |
|---|---|---|
| Can a student register with an expired passport or under 12 months? | **Yes.** Expiry is an optional date with no future-date rule and no database check | `validation.ts:27,68`, `0019` |
| Tested? | Partly. A 200-day passport registers and moves to Registration. No test found specifically for an **expired** one | `phase-3-academic.test.ts` |
| Warning on the registration form? | **None found** in the expiry field section. Warnings appear after saving | `students/[id]/attention.tsx`, dashboard |
| Renewal reminders? | **Yes, as staff tasks** by tier (12 months or less, urgent, within 3 months, expired). No student-facing reminder found | `0019:220` |
| What blocks? | Rule **"Passport valid for at least 12 months (all destinations)"**: moving forward to University Application is refused, **including when no expiry is entered**. Enforced by service and database trigger | `defaults.ts:268`, `students.ts:491`, `0019`, `0024:263` |
| Source of that rule | "MD instruction Oct 2026" | `defaults.ts:269` |
| Installed by | `provision`, so **likely on production** if provisioned there (inference) | `provision.ts:119` |

**MD decision:** warning only by default at University Application, including when expiry is missing. Enforce only an official university or programme rule, with source and approval recorded. Registration always stays allowed.

**Not changed yet.** Source still blocks, and the change is in Phase 0B, which isn't approved. Whether production has this rule is Blocked / Requires Access. Bulk import has no expiry block either (`student-import.ts:208`), but has no test for it.

## 12. Country rules inventory

**Nothing was changed or invented.** Production contents are Blocked; the script counts them.

| Rule | Source | Class | Note |
|---|---|---|---|
| Bulgaria advisory: 60% Chemistry, Biology, Physics, English | Brief, Oct 2026; `provision` | **Verified, incomplete** | Applies to **all courses** at country level. The requirement names Nursing and MBBS, so Postgraduate Medical also receives it |
| Bonafide: Indian student, Qatar school → MU Varna | MD approval, commit `42d6c9b`; test | **Verified** | `ACADEMIC_AND_NAME_CHECKS.md` still calls it draft (stale doc) |
| One and Same wording | MD approved 1 Nov | **Verified** | |
| Universities: MU Varna, MU Pleven | Oct 2026 | **Verified** | |
| Passport 12 months at University Application | MD instruction, Oct 2026 | **Conflicting** | See P1 |
| `[PLACEHOLDER]` Passport basic checks: **validity ≥ 18 months** | Demo seed only | **Placeholder, conflicting** | Differs from the 12-month rule |
| `[PLACEHOLDER]` Bonafide India, Qatar, UAE; Plus Two | Demo seed only | **Placeholder** | Marked approved in demo data |
| `[TO CONFIRM]` Attestation: Bulgaria (India, UAE), Egypt (India) | Demo seed only | **Unverified** | Marked approved in demo data, so harmful if seeded on production |
| `[DEMO]` One and Same rules (2) | Demo seed | **Placeholder** | |
| Workflows: MBBS Russia, MBBS Georgia, Nursing Germany | `provision`, no recorded business source | **Unverified** | Installed outside demo data |
| Country list | `defaults.ts:132` says placeholders until confirmed | **Unverified** | |
| Workflows for Bulgaria, Egypt, Philippines, Uzbekistan, Kazakhstan, Tajikistan, Romania | None | **Incomplete** | They use Standard admission |
| PCC | Document type only | **Incomplete** | No timing or issuing-country rule; supply rather than assume |

**Correction to my previous audit:** the four inactive Bulgaria thresholds are not a gap. A test confirms they were deliberately replaced by the advisory notice. I also said placeholder rules might be real; source shows they come from demo data, and production should have none. The script checks that.

## 13. Still needed from you

| # | Item | Status |
|---|---|---|
| P1 | University Application passport rule | **Decided:** warning only by default. Implementation not approved |
| P2 | Bulgaria 60% scope | MD decided: configurable by university and programme. The form fields exist |
| P3 | Unverified rules | MD decided: official sources plus MD approval. Owner open: roadmap question 11 |

## 14. How to complete this report

**Script:** `stage0_production_readonly_check.sh` revision 3. **Not approved for execution and not run on the VPS.** It was trialled only on this Mac, against the local development database.

**SSH: not available.** Key authentication for `erp` can't work from this Mac, because it has no private key in `~/.ssh` and the SSH agent holds none (Verified in Local Source: inspected on the Mac, server not contacted). A key has to be created and its public half installed for `erp` by the MD or server administrator.

**Stays Blocked / Requires Access even after running:** exact migration list, queue status and age, passport task dates, scan and clearance counts, rule contents, last audit date, root crontab, protected logs, provider snapshots.

**Stays not verified even after running:** backup validity and restore, complete company isolation under signed-in users, whether a running process matches the checkout, and whether email and scanning actually work.
