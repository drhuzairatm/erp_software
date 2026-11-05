# Architecture assessment

**Date:** 4 November 2026
**Code assessed:** `3df4171`
**Status:** for MD review. Nothing has been implemented.
**Replaces:** `ARCHITECTURE_MIGRATION_ASSESSMENT.md`. The React, Vite, Express and TypeORM migration plan was withdrawn by MD decision and is not part of this document.

Unless labelled otherwise, findings are **Verified in Local Source**. Production has not been inspected.

## 1. Decision

The ERP continues on its existing architecture. It will be completed and improved, not rebuilt.

| Stays | Not being introduced |
|---|---|
| Next.js App Router with Server Actions | React + Vite SPA, React Router, Axios |
| `backend/src/services/*` | New Express API architecture |
| PostgreSQL, raw SQL through postgres.js | TypeORM |
| RLS, grants, triggers and database functions | Any move of that logic into application code |
| Hand-written SQL migrations with rollback files | Generated migrations |

## 2. How the system works today

```
Browser
  → Next.js pages and Server Actions (frontend/)
    → services (backend/src/services)
      → withUser(): transaction with app.user_id set
        → PostgreSQL as erp_app: RLS, grants, triggers, app.* functions

Next.js file, photo, import and health route handlers
  → HMAC-signed call → internal Express API on loopback (8 routes)
    → same services and database rules
```

| Part | Size |
|---|---|
| Pages | 62 |
| Route handlers | 14 |
| Server Actions | About 150, in 22 files plus the portal |
| Services | 5,385 lines in `backend/src/services` |
| Migrations | 37 |
| Test files | 83 |

**Verified in Local Development Database (not production):** 90 public tables, 89 with RLS, 149 policies, 154 triggers including 54 audit triggers, 291 `app` functions of which 263 are SECURITY DEFINER, 279 foreign keys, 281 check constraints.

### The internal Express layer

The internal Express API stays as it is. It serves working file, photo, import and health routes, and is covered by contract tests.

- **It will not be expanded.** New features use Server Actions, services and SQL.
- It must stay running in production, on loopback, with `INTERNAL_API_SECRET` set. Whether that is so on the VPS is **Blocked / Requires Access**.
- Retiring it could be considered later, but only as a separate proposal if there is a real reason.

## 3. Standard pattern for new work

Every new module follows the same path, so nothing new has to be invented:

| Layer | Convention | Existing example |
|---|---|---|
| Page | `frontend/src/app/(app)/<module>` | `tasks/` |
| Action | `frontend/src/app/actions/<module>.ts`, wrapped in `runAction` | `actions/tasks.ts` |
| Service | `backend/src/services/<module>.ts`, using `run(ctx, …)` | `services/tasks.ts` |
| Validation | `backend/src/lib/validation.ts` (zod) | Existing schemas |
| Database | New numbered migration from `0038`, with a file in `backend/db/rollbacks` | `0037` |
| Isolation | RLS on every new table, using `app.has_perm` | Existing policies |
| Audit | Existing audit trigger attached to each table | 54 existing |
| Permissions | New keys in `permissions`, granted to roles, checked by `can` and RLS | `0030` |
| Tests | Integration and isolation in Vitest on the throwaway database; Playwright for screens, including phone widths | `db-isolation`, `responsive.spec` |

**Rules:**
- Applied migrations are never edited.
- Grants are not widened to make code easier.
- Only 21 of the 37 existing migrations have rollback files, so every new migration must have one and it must be tested.

## 4. What can be reused

| Need | Reuse | Module |
|---|---|---|
| Live camera capture | `components/photo-capture.tsx` | Attendance |
| Trusted client IP | `backend/src/lib/client-ip.ts` | Attendance |
| QR codes | `qrcode` (already a dependency); signing with Node's built-in crypto | Attendance |
| PDF viewing | Existing document viewer | Pre-admission |
| Private storage, 60-second links | `backend/src/lib/storage` | All file features |
| Scanning and quarantine | `lib/security/scanner.ts`, `file-scan.ts`, `scan-badge.tsx` | All file features |
| Queues and senders | `notification_messages`, `lib/notifications`, cron routes | Notifications, reminders |
| Conversion to student | Leads' "Register as student" path | Pre-admission |
| Rules by country, university, course | Advisory notices, passport rules, `condition-builder` | Requirements, pre-admission |
| Charts | `components/charts.tsx` | Dashboards |
| Audit view | `/audit`, `components/login-activity.tsx` | History views |
| Workload and task counts | `taskCounts`, `workloadQuery`, `managementAnalytics` | Tasks, dashboards |

**Existing limits that need internal improvement, without replacing anything:**

| Limit | Why it matters | Improvement |
|---|---|---|
| `document_files` belongs to a student document | Pre-admission, task, chat and ticket files have no student | One shared secure-file table and service using the same storage and scanner |
| `notification_rules.event_key` is a fixed list of student events; `/notifications` is a message outbox | Staff have no notification centre | Add staff notifications, reusing the senders |
| The only schedule in the repository is `vercel.json` | It does nothing on a VPS | Real scheduler calling the existing cron routes (approved configuration change) |
| `tasks.due_date` is a date | Reminders at 1–6 hours need a time | Additive column change |
| Single destination, course and university on `students` | Three preferences are required | Existing columns remain Primary; add a preferences table |
| Hard-coded role keys at `(app)/page.tsx:32` and `students/[id]/page.tsx:284` | Custom roles behave differently | Permission checks |
| Permissions-Policy allows the camera | Attendance needs location | Confirm and allow `geolocation=(self)` when building |

## 5. Hard technical questions, answered within this architecture

### Real-time chat without a new service

A separate WebSocket server would add a process, a dependency and more Nginx configuration, so it isn't the first choice.

| Step | Method | New dependency |
|---|---|---|
| First | Reload messages on a short interval | None |
| Next | Server-Sent Events from a Next route handler, woken by PostgreSQL `LISTEN/NOTIFY` | None; postgres.js supports both |

**Security:** a notification carries only IDs, so the browser then reads messages through a normal RLS-protected request. Private text never travels outside that path.

**Conditions to prove on staging:**
- Nginx needs `X-Accel-Buffering: no` and a long enough read timeout (`next/dist/docs/01-app/02-guides/streaming.md`).
- `LISTEN` needs a direct database connection, not a transaction pooler.
- Long-lived connections must not use up the database pool. One shared listener per process serves all users.
- If this fails under real load, a dedicated service would come back to the MD as a separate decision.

### Attendance

No new package and no new architecture. Face matching and liveness are **deferred and remain an approved future requirement**. Evidence is stored so that another signal can be added later without changing records.

Selfie and GPS can be faked on a determined user's device, so they are treated as signals, not proof. They are combined with short-lived signed QR codes, office IP and Manual Review.

### Push notifications

The first release uses in-app and email. Browser push needs a provider decision and, on iPhone, an installed web app. It is listed as an open decision rather than assumed.

## 6. Protections and how they stay intact

| Protection | Approach | Proof |
|---|---|---|
| Company isolation | RLS on every new table; existing policies untouched | `db-isolation`, `isolation`, `security-matrix`, new per-module refusal tests |
| Role permissions | `app.has_perm` stays the single authority | Permission matrix extended for new keys |
| Sensitive columns | Existing grants unchanged | Existing tests |
| Audit | Same triggers on new tables; `audit_logs` stays read-only for `erp_app` | Test that each write creates an audit row |
| Records | Additive schema changes only; no record rewritten without an approved migration | Row counts and checks before and after |
| Migration safety | Backup first, staging first, tested rollback | Rollback rehearsal |

**Recommended safeguard:** a read-only schema fingerprint of policies, triggers, grants and functions, compared before and after each release. Any difference must match an approved migration.

## 7. Rollback

| Layer | Approach |
|---|---|
| Database | Additive changes, each with a rollback file rehearsed on staging |
| New features | Hidden until permissions are granted, so a module can be switched off by removing permissions |
| Application | Tagged release, so the previous tag can be redeployed |
| Before production | Fresh backup with a verified restore |

## 8. Passport rule behaviour within this architecture

| MD decision | Existing support (Verified in Local Source) | Gap |
|---|---|---|
| Registration always allowed | No expiry check on the form, import or database | No test for expired or missing |
| Warning-only default, including missing expiry | `app.stage_requirement_issues` returns the rule's enforcement, and `warn` becomes a warning | Global rule is `block`; change needs a migration |
| Enforce only for a specific university or programme | `passport_validity_rules` has `university_id`, `course_id` and conditions, on the admin form | No source or approval fields |

## 9. Superseded documents

| Document | Status |
|---|---|
| `docs/VITE_MIGRATION_PHASE1.md` | **SUPERSEDED — DO NOT USE** notice added; kept as a record. D-V1 to D-V8 closed |
| `docs/API_CONTRACT_INVENTORY.md` | Still useful as a record of behaviour |
| `docs/audit/PRIORITIZED_IMPLEMENTATION_ROADMAP.md` | **SUPERSEDED — DO NOT USE** notice added; kept as a record |

## 10. Not verified

- Production: see `PRODUCTION_STATE_REPORT.md`.
- Tests were re-run on `3df4171` on 4 Nov and passed locally. See `LOCAL_PROJECT_READINESS_REPORT.md`.
- The chat approach in section 5 is a design from source and documentation, not yet proven under load.
