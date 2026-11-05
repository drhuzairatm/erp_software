# `erp_app` trust boundary review

**Date:** 4 November 2026
**Tested on:** a throwaway database with fictional data; every attempt rolled back. Production was not inspected.
**Status:** findings and options. **Nothing has been changed, and this vulnerability is unresolved.**

**MD decision, 4 Nov 2026:** remediation, including the proposed `erp_system` login, is postponed until after Phase 11 and stays on the Security Hardening roadmap (`IMPLEMENTATION_ROADMAP.md`). The system must not be described as fully secure.

**Handling:** this file stays uncommitted. The GitHub repository answers anonymous requests, so it appears to be public.

## Result

**Severity: High, with Critical impact.** This replaces the "Medium" in my earlier review, which understated it.

**Anyone able to run SQL as `erp_app` can act as any user, in any company, and the audit log will name that user.** RLS doesn't stop them, because `app.current_user_id()` simply reads a setting that the same role can set itself:

```sql
select nullif(current_setting('app.user_id', true), '')::uuid
```

RLS therefore protects against application bugs, such as a forgotten filter. It doesn't protect against a stolen `erp_app` password or SQL injection.

## How someone could get there

| Route | Status |
|---|---|
| SQL injection through the app | **None found.** All 7 uses of `.unsafe` were reviewed: fixed text, bound parameters, or an allow-list |
| Unguarded functions reached with a user-supplied ID | **None found.** All 15 such functions were reviewed: an RLS-protected read or permission check comes first, or they are internal or run only from cron |
| Password in the browser bundle | **None found** in local static build output |
| Stolen server `.env`, backup or process memory | **Not assessed.** It is on the VPS |
| Code execution through the app or a dependency | **Not assessed** |
| Database port reachable from outside; password strength | **Not assessed.** This is the first thing to check when VPS work resumes |

This isn't a claim that no route exists. It wasn't a penetration test.

## What was proven, as `erp_app`

| Attempt | Result |
|---|---|
| Read another company's student as own user | 0 rows: **RLS holds** |
| Same, after setting `app.user_id` to the MD | **1 row** |
| Students visible: own user vs impersonated MD | **17 vs 37** |
| Update another company's student as MD | **Succeeded** |
| Passport number through `student_passports` as MD | **Returned** |
| Audit entry names the impersonated MD, with a forged IP | **Yes** |
| Write a fake audit entry through `app.audit` | **Succeeded** |
| Create a signed-in session for an MD with MFA enabled, without the code | **Succeeded:** the session isn't marked as waiting for a code |
| Read the MD's password hash, by `auth_login_lookup` or `auth_begin_attempt` | **Returned** (not displayed) |
| Change the MD's password through reset, with no email | **Succeeded** |
| Give a role a new permission as MD | **Succeeded** |
| Verify a payment under a second identity, defeating second-person approval | **Succeeded** |
| Claim outgoing notifications | Allowed; none were queued |
| Create a temporary table | Allowed |

## What held

| Attempt | Result |
|---|---|
| Delete or edit audit rows | Refused |
| Disable RLS or triggers | Refused: not the table owner |
| Become superuser | Refused |
| Read server files or run server programs | Refused |
| Create tables in `public`; read `auth_private` directly | Refused |
| Read masked `students` columns directly | Refused |
| Change stage, payment or document status directly | Refused, by column grants, with or without bypass flags |
| Add a second MD, or edit an approved rule | Refused, with or without bypass flags |
| A role with no grants calling `app` functions | Refused |

## What each fix would change

| Fix | Effect on the attacks above |
|---|---|
| Stages A and B | **None:** all results identical. Protects against other roles only |
| Stage C | Removes `auth_create_session`, `auth_login_lookup`, `auth_request_reset` and `auth_complete_reset` from direct reach. **Partial:** `auth_begin_attempt` still returns a hash, the app's rate-limited reset functions stay reachable, and impersonation remains |
| Stage D | Stops signed-in contexts using system functions. **Partial:** an attacker can simply not set a user |
| Identity the database can verify (option 3 below) | **Addresses impersonation and audit forgery.** The only option here that does |

## Options (none started)

| # | Option | Cost and risk |
|---|---|---|
| 1 | **Server hardening:** PostgreSQL on localhost only, firewall, strong unique `erp_app` password, rotation, restricted `.env` permissions, encrypted off-site backups | Low. Needs VPS work, separately approved |
| 2 | **Detection:** database logging, and copying audit logs off the server so forged entries can be compared | Low to medium. Needs server work |
| 3 | **Verified identity:** the database derives the user from a valid session token rather than trusting a setting. Sign-in and cron use a separate login role | **High:** touches the core of RLS, runs on every row, and needs design and load testing. Stays within Next.js and PostgreSQL |
| 4 | **Keep SQL safe:** a CI check refusing new `.unsafe` calls with non-constant text | Low |
| 5 | **Stages A to D** | See `PRIVILEGED_FUNCTIONS_SECURITY_REVIEW.md` |

**Superseded on timing by the MD decision above.** Option 4 is written and runs in CI once committed. The other options wait for Security Hardening. Original recommendation, kept for the record: do 1 and 4 first, because they reduce the chance of access most cheaply. Then commission a design for 3 before modules that hold more sensitive data, such as attendance selfies and location. A to D are still worth doing, but they don't replace it.
