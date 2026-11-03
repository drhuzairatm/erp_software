# Next.js → React + Vite migration: phase 1 (inventory, baseline, blocking decisions)

| | |
|---|---|
| Date | 2026-11-03 |
| Workspace / branch | `/Users/drhuzair/Documents/erp mvp`, `refactor/express-api` (HEAD `eb8dd7d`; Stage 0–2 and the backend restructure are uncommitted and preserved) |
| Status | **Phase 1 only.** No application code changed and no dependency installed. Phase 2 has **not** started: it needs the decisions in section 5 (the request says to stop before any hosting or security decision that cannot be inferred safely). |

## 1. Summary

The Next.js app is a **server-rendered** application: 61 of its 62 pages are server components that read data directly from backend services, and 149 Server Actions perform every change. The Express API (Stages 1–2) currently serves **8 routes**, and only behind the Next.js BFF: it is **loopback-only and refuses any request without the BFF's HMAC credential**, by design (approved decisions D1, D2, D5).

Replacing Next.js with a browser-only React app therefore changes the security architecture, not just the UI framework:
- The browser would talk to Express **directly**: Express becomes internet-facing.
- The HMAC credential cannot be used by a browser (its secret must never be shipped), so session cookies, CSRF/Origin checks and security headers must be enforced by Express itself.
- About 60 page data loaders and 149 actions need new Express endpoints, and every authorization decision currently made inside a server component must move into the backend.

That reverses approved decisions D1, D2 and D5, and touches D8 (Origin requirement) and the notification design (§6 of the approved plan). Several of the replacements depend on the hosting choice, which is not decided (docs/DEPLOYMENT.md recommends Vercel, documents a Hostinger VPS alternative, and neither is verified).

## 2. Baseline (recorded before any change)

See section 7 for the exact results (logs: `.data/vite-phase1/`).

## 3. What Next.js does today that needs a replacement

| Next.js feature (where) | What it guarantees today | Replacement needed in React + Express | Decision |
|---|---|---|---|
| Server components, 61 pages (`frontend/src/app/**/page.tsx`); 52 call services directly | Data is fetched and rendered on the server; the browser only receives HTML for what the page chose to show | One or more Express `GET` endpoints per page; React fetches JSON | — |
| **Authorization inside components**: 27 pages/layouts call `can(ctx, …)` or similar (e.g. `payments/page.tsx` checks `payments.read`, `reports.export.finance`, `payments.verify` per company; the app layout builds the menu from 10 permissions) | Data the component decides not to show never leaves the server | Every such decision must move into the backend endpoint (service/controller). With an SPA, anything the API returns is visible in the browser, even if the UI hides it | Per page during migration (security review per slice) |
| `requireUser()` redirects in layouts/pages (sign-in, must-change-password, MFA set-up) | No page HTML or data before the checks pass | API answers 401 `{reason:'redirect', location}` (already in Stage 1's error handler); a React route guard navigates. The page **code** (JS bundle) becomes downloadable without signing in, but no data does | **D-V7** |
| 149 Server Actions (22 files) with `useActionState`, `redirect()`, `revalidatePath()` | Next checks the request's `Origin` against the host for every action (built-in CSRF protection), 11 MB body limit, encrypted action ids | One Express endpoint per action (proposal: `POST /api/<module>/<action>`, same inputs and results); **explicit CSRF protection** (see D-V2); React re-fetches instead of `revalidatePath` | **D-V2** |
| `after()` post-response sends (5 files; sign-in codes, reset links, notifications) | Message is queued durably; a faster send is attempted after the response | Express equivalent after the response is sent (the approved plan rejected `res.on('finish')`); durable outboxes + per-minute cron stay the guarantee | **D-V4** |
| `src/proxy.ts`: per-request **nonce CSP** for pages (`script-src 'self' 'nonce-…' 'strict-dynamic' 'wasm-unsafe-eval'`, `frame-ancestors 'none'`, …) | Only scripts carrying the nonce run | A static SPA has no per-request HTML; policy becomes `script-src 'self' 'wasm-unsafe-eval'` with no inline scripts, set by whichever server serves `index.html` | **D-V3** |
| `next.config.ts` security headers (X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy camera=(self), COOP, HSTS in production), `poweredByHeader:false`, Server Action limit 11 MB | Every response carries them | The same headers on the SPA's static files **and** on every API response | **D-V1/D-V3** |
| `instrumentation.ts` | Production refuses to start with an unsafe notification mode | Already applied by the Express start-up (`server.ts`) | — |
| Route handlers (14) | See table B | Express routes (8 exist) | — |
| Cookies via `next/headers` (staff session, trusted browser, portal session, portal browser, company scope; `__Host-`/`__Secure-` names in production) | HttpOnly, Secure, SameSite=Lax, set only by the server | Express sets the same cookies with the same names and flags (Stage 1's request-context jar already serialises them) | — |
| Client address (`TRUST_PROXY`) | Resolved in Next from the trusted proxy header only | Express resolves it itself with the same `resolveClientIp` rule (today it takes it only from the signed context and **ignores** forwarding headers) | **D-V1** |
| `vercel.json` crons → `/api/cron/notifications` (every minute), `/api/cron/daily` | Delivery guarantee for queued messages | Same routes on Express + a scheduler for the chosen host | **D-V1** |
| Uploads through Server Actions (`FormData`, up to 11 MB) and the merge route | Parsed by Next | Multipart parser in Express (approved plan §3: busboy with limits and memory measurement), not yet built | **D-V5** |
| `export const metadata` (63 titles), `next/link` (51 files), `next/navigation` (31), one `<Image>`, `notFound()` (13), `error.tsx`, `not-found.tsx` | Titles, client navigation, error pages | `document.title` per route, React Router `Link`/`useNavigate`, route-level error/not-found elements | — |
| Environment | Server-only variables only; **no `NEXT_PUBLIC_*`** variables exist | Nothing needs to be exposed to the browser; Vite must not define any secret. API base URL is same-origin (`/api`) if D-V1 allows | — |
| Client components importing backend modules (9) | 3 are `import type` only (services/students, documents, student-import); 6 import client-safe helpers (`lib/validation`, `lib/conditions`, `lib/phone`, `lib/merge-filename`) | Keep type-only imports type-only; move the client-safe helpers into a shared module the SPA can bundle (they must never pull `lib/db`, storage or secrets) | — |
| Tests | 119 frontend integration tests call route handlers / actions directly; 54 Playwright browser tests start `next dev` | Rewrite against Express + the SPA; browser tests need the approved disposable browser-test DB (D3, not yet built) | **D-V6** |

## 4. Proposed target design (for approval, not implemented)

```
Browser ──HTTPS──▶ one origin (e.g. https://erp.example)
                    ├── /            static React app (Vite build: index.html + hashed assets)
                    └── /api/*, /portal/files/*, /api/storage/local, /api/cron/*  → Express (single process)
```
- **Same origin, no CORS:** the SPA and the API share one origin through the host or reverse proxy, so session cookies stay `__Host-`, `SameSite=Lax`, `HttpOnly`, `Secure`, and no CORS headers are ever sent (as today).
- **CSRF:** every state-changing request (non-GET/HEAD) must carry an `Origin` header equal to the configured app origin (`APP_URL`), and a custom header (e.g. `X-ERP-Request: 1`) that cross-site forms cannot send. Requests failing either check are refused before any service runs. This replaces Next's built-in Server Action check and is stricter than today on one point: a *missing* Origin is refused (D8 deferred this; it needs your approval).
- **Authentication:** unchanged session model: the session cookie set by the existing `login()` is resolved per request by `getSession()` and `getActiveSession()`. The flows for MFA pending, must-change-password and MFA set-up keep their redirects, returned as 401 with `{reason:'redirect', location}`.
- **The internal HMAC credential** (Stage 1) would no longer be used for browser requests. Express would bind publicly behind the proxy instead of loopback-only, and `apiConfig` would change accordingly. **This is the main security change and needs explicit approval.**
- **Client IP:** Express resolves it from the trusted proxy header only (`TRUST_PROXY`, existing rule); Express's own `trust proxy` stays off.
- **Static files and headers:** the server of the static files sends the CSP (section 3) and the same security headers. Express sends them on API responses too.
- **Frontend layout:** `frontend/src/{main.tsx, app/, features/<feature>/{api,components,hooks,pages,types}, shared/{api,components,hooks,layouts,utils}, styles/}`, built by Vite.
  - Features (from section 6): auth, dashboard, students, documents, files, photos, finance, leads, tasks, universities, master-data, requirements, verification-rules, attestation, academic, passport, courier, notifications, security, admin, reports, audit, portal.
  - `shared/api` is the only module that calls `fetch`: same-origin, `credentials: 'same-origin'`, the CSRF header, and 401-redirect handling.
- **Migration order:** Next.js keeps serving everything not yet migrated; both apps run behind one origin during the migration, with the proxy routing migrated paths to the SPA. Next.js is removed only when table A/B/C has no "Not migrated" row.

## 5. Decisions needed before phase 2 (blocking)

| # | Decision | Why it cannot be inferred | Options |
|---|---|---|---|
| **D-V1** | **Hosting and topology after Next.js.** | Vercel (the documented recommendation) hosts static sites and serverless functions, not a long-running Express process with in-process state. The VPS option fits a single Express process behind Nginx or Caddy, but the hosting comparison (H3 hybrid) was never approved, and no purchases are allowed. It also decides: TLS, how the proxy routes paths, `TRUST_PROXY`, the cron scheduler, and where static files are served. | (a) VPS: Nginx/Caddy serves the SPA and proxies the API paths to Express on 127.0.0.1. (b) Vercel: static SPA + Express adapted to serverless functions (larger change: no per-process state, a different start-up model). (c) Something else. |
| **D-V2** | **Browser→Express security model**, replacing D1/D2/D5. | It removes the HMAC boundary and makes Express internet-facing. It adds a stricter Origin rule (missing Origin refused), which D8 deferred. | Approve section 4 as written, or amend. |
| **D-V3** | **CSP for the SPA:** no per-request nonce. | It changes the policy text; it is equivalent or stricter for scripts, but it is a security-header change. | `script-src 'self' 'wasm-unsafe-eval'` (no inline, no nonce), the other directives unchanged. |
| **D-V4** | **Post-response sends in Express** (replacing `after()`). | The approved plan's §6 rejected `res.on('finish')`; an alternative is needed. | Send after `res.end()` has completed, in the same process; the outbox + cron stay the guarantee. |
| **D-V5** | **New dependencies:** `vite`, `@vitejs/plugin-react`, `react-router` (and `busboy` for uploads). | Standing rule: no downloads or new dependencies without permission; these are not in the approved plan. | Approve installation (exact versions recorded in the lockfile). |
| **D-V6** | **Test strategy:** rewrite the 119 integration tests and 54 browser tests; build the disposable browser-test DB (D3). | The browser tests are the only end-to-end proof for the UI. They cannot run against the dev DB. | Approve building D3 at the start of phase 2. |
| **D-V7** | **Signed-out users can download the SPA's JavaScript** (UI code for all screens, including admin; **no data**). | Today a signed-out user receives only the login page. | Accept, or split the bundle so admin and portal code load only after sign-in (it is still downloadable by anyone who knows the file URL). |
| **D-V8** | **Supersede the approved plan:** D1 (all actions via the Next.js BFF), D2 (HMAC), D5 (loopback only), the stage order and review stops. | This changes approved decisions. | Approve, with the new review stops (proposed: after auth, after uploads, after portal, before removing Next.js). |

**Scale, for planning:** 62 pages, 6 layouts plus error and not-found pages, 14 route handlers and 149 actions → an estimated 23 feature slices, each with its own contract tests and a security review of the authorization checks that move out of the components.

## 6. Inventory and coverage (every route, page and action)

"Status" is the state today. Nothing in tables A and C has a replacement yet. Of the 14 route handlers in table B, 8 already have Express routes, but they are reached only through the Next.js BFF.

### A. Pages (62) and layouts

| Current URL | Feature | Server data loaded (services) | Server Actions used | Next-specific | Replacement (React route / Express) | Status |
|---|---|---|---|---|---|---|
| `/` | dashboard | analytics, base, dashboard, lookups, scope, tasks | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `dashboard` | Not migrated |
| `/account/password` | auth | — | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |
| `/account/security` | auth | security | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |
| `/admin/academic-rules` | academic | academic, lookups, rules | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `academic` | Not migrated |
| `/admin/attestation-routes` | attestation | attestation, lookups | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `attestation` | Not migrated |
| `/admin/attestation-routes/[id]` | attestation | attestation, rules | — | notFound, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `attestation` | Not migrated |
| `/admin/attestation-routes/new` | attestation | attestation, rules | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `attestation` | Not migrated |
| `/admin/courier` | courier | courier | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `courier` | Not migrated |
| `/admin/currencies` | finance | payments | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `finance` | Not migrated |
| `/admin/master-data` | master-data | master-data | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `master-data` | Not migrated |
| `/admin/master-data/countries` | master-data | master-data, payments | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `master-data` | Not migrated |
| `/admin/master-data/courses` | master-data | master-data | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `master-data` | Not migrated |
| `/admin/master-data/history` | master-data | master-data | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `master-data` | Not migrated |
| `/admin/master-data/permissions` | master-data | master-data | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `master-data` | Not migrated |
| `/admin/master-data/requests` | master-data | lookups, master-data | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `master-data` | Not migrated |
| `/admin/notifications` | notifications | lookups, notifications | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `notifications` | Not migrated |
| `/admin/passport-rules` | passport | base, lookups, passport, rules | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `passport` | Not migrated |
| `/admin/requirements` | requirements | requirements | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `requirements` | Not migrated |
| `/admin/requirements/[id]` | requirements | requirements | — | notFound, searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `requirements` | Not migrated |
| `/admin/requirements/new` | requirements | requirements | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `requirements` | Not migrated |
| `/admin/roles` | admin | admin | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `admin` | Not migrated |
| `/admin/rule-tester` | verification-rules | rules | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `verification-rules` | Not migrated |
| `/admin/security` | security | security | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `security` | Not migrated |
| `/admin/settings` | admin | admin, lookups | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `admin` | Not migrated |
| `/admin/users` | admin | admin | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `admin` | Not migrated |
| `/admin/users/[id]` | admin | admin, security | — | notFound, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `admin` | Not migrated |
| `/admin/verification-rules` | verification-rules | verification-rules | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `verification-rules` | Not migrated |
| `/admin/verification-rules/[id]` | verification-rules | rules, verification-rules | — | notFound, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `verification-rules` | Not migrated |
| `/admin/verification-rules/new` | verification-rules | rules, verification-rules | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `verification-rules` | Not migrated |
| `/audit` | audit | admin, scope, staff-photos | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `audit` | Not migrated |
| `/forgot-password` | auth | — | auth | — | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |
| `/invite/[token]` | auth | — | — | — | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |
| `/leads` | leads | leads, scope, staff-photos | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `leads` | Not migrated |
| `/leads/[id]` | leads | leads | — | notFound, searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `leads` | Not migrated |
| `/leads/import` | leads | — | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `leads` | Not migrated |
| `/leads/new` | leads | — | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `leads` | Not migrated |
| `/login` | auth | — | — | redirect, searchParams | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |
| `/login/verify` | auth | — | — | redirect | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |
| `/notifications` | notifications | notifications, scope | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `notifications` | Not migrated |
| `/payments` | finance | payments, scope | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `finance` | Not migrated |
| `/portal` | portal | portal | — | redirect, searchParams | same URL in React Router; data from new `GET` endpoint(s) of feature `portal` | Not migrated |
| `/portal/forgot` | portal | — | — | — | same URL in React Router; data from new `GET` endpoint(s) of feature `portal` | Not migrated |
| `/portal/home` | portal | portal | — | redirect, searchParams | same URL in React Router; data from new `GET` endpoint(s) of feature `portal` | Not migrated |
| `/portal/password` | portal | portal | — | searchParams | same URL in React Router; data from new `GET` endpoint(s) of feature `portal` | Not migrated |
| `/portal/verify` | portal | — | — | searchParams | same URL in React Router; data from new `GET` endpoint(s) of feature `portal` | Not migrated |
| `/receipts/[id]` | finance | payments | — | notFound, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `finance` | Not migrated |
| `/refer/[code]` | leads | portal | — | — | same URL in React Router; data from new `GET` endpoint(s) of feature `leads` | Not migrated |
| `/reports` | reports | reports, scope | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `reports` | Not migrated |
| `/reports/[key]` | reports | lookups, reports, scope | — | notFound, searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `reports` | Not migrated |
| `/reset-password/[token]` | auth | — | — | — | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |
| `/students` | students | lookups, scope, students, tasks | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `students` | Not migrated |
| `/students/[id]` | students | base, documents, lookups, master-data, merge, notifications, passport, payments, photos, staff-photos, students, tasks | — | notFound, searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `students` | Not migrated |
| `/students/[id]/documents/[docId]` | documents | documents | — | notFound, searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `documents` | Not migrated |
| `/students/[id]/edit` | students | lookups, master-data, passport, requirements, students | students | notFound, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `students` | Not migrated |
| `/students/import` | students | lookups, scope, student-import | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `students` | Not migrated |
| `/students/new` | students | base, lookups, passport, requirements, scope | students | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `students` | Not migrated |
| `/tasks` | tasks | scope, staff-photos, tasks | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `tasks` | Not migrated |
| `/tasks/[id]` | tasks | staff-photos, tasks | — | notFound, searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `tasks` | Not migrated |
| `/tasks/new` | tasks | tasks | — | requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `tasks` | Not migrated |
| `/universities` | universities | lookups, universities | — | searchParams, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `universities` | Not migrated |
| `/universities/[id]` | universities | lookups, rules, universities | — | notFound, requireUser | same URL in React Router; data from new `GET` endpoint(s) of feature `universities` | Not migrated |
| `/verify-email` | auth | passport | — | redirect, searchParams | same URL in React Router; data from new `GET` endpoint(s) of feature `auth` | Not migrated |

- `layout.tsx` (/): services —; replacement: shared layout / route guard — Not migrated
- `error.tsx` (/): services —; replacement: shared layout / route guard — Not migrated
- `not-found.tsx` (/): services —; replacement: shared layout / route guard — Not migrated
- `portal/layout.tsx` (/portal): services —; replacement: shared layout / route guard — Not migrated
- `(app)/layout.tsx` (/): services dashboard, scope, security, staff-photos; requireUser; replacement: shared layout / route guard — Not migrated
- `(app)/admin/layout.tsx` (/admin): services master-data, rules; requireUser; replacement: shared layout / route guard — Not migrated
- `(app)/admin/master-data/layout.tsx` (/admin/master-data): services —; replacement: shared layout / route guard — Not migrated
- `(auth)/layout.tsx` (/): services —; replacement: shared layout / route guard — Not migrated

### B. Route handlers (14)

| Path | Methods | Today | Replacement | Status |
|---|---|---|---|---|
| `/api/attestation-files/[id]` | GET | Next.js handler calling services directly | new Express route (same path and contract) | Not migrated |
| `/api/cron/daily` | GET | Next.js handler calling services directly | new Express route (same path and contract) | Not migrated |
| `/api/cron/notifications` | GET | Next.js handler calling services directly | new Express route (same path and contract) | Not migrated |
| `/api/files/[id]` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/api/files/[id]/content` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/api/health` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/api/reports/[key]` | GET | Next.js handler calling services directly | new Express route (same path and contract) | Not migrated |
| `/api/staff/[id]/photo` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/api/storage/local` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/api/students/[id]/merge` | POST | Next.js handler calling services directly | new Express route (same path and contract) | Not migrated |
| `/api/students/[id]/photo` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/api/students/[id]/photo/download` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/api/students/import-template` | GET | Express (via Next BFF proxy) | Express route already exists; browser would call it directly | Partly (Express exists; BFF still in front) |
| `/portal/files/[id]` | GET | Next.js handler calling services directly | new Express route (same path and contract) | Not migrated |

### C. Server Actions (149)

| File | Action | Feature | Redirect | Revalidate | Cookies | Post-response send | Proposed Express replacement | Status |
|---|---|---|---|---|---|---|---|---|
| actions/academic.ts | `saveRecordAction` | academic |  | yes |  | yes | `POST /api/academic/save-record` (proposal) | Not migrated |
| actions/academic.ts | `deleteRecordAction` | academic |  | yes |  | yes | `POST /api/academic/delete-record` (proposal) | Not migrated |
| actions/academic.ts | `reviewNameCheckAction` | academic |  | yes |  | yes | `POST /api/academic/review-name-check` (proposal) | Not migrated |
| actions/academic.ts | `prepareOasAction` | academic |  | yes |  | yes | `POST /api/academic/prepare-oas` (proposal) | Not migrated |
| actions/academic.ts | `requestOasAction` | academic |  | yes |  | yes | `POST /api/academic/request-oas` (proposal) | Not migrated |
| actions/academic.ts | `cancelOasAction` | academic |  | yes |  | yes | `POST /api/academic/cancel-oas` (proposal) | Not migrated |
| actions/academic.ts | `addThresholdAction` | academic |  | yes |  | yes | `POST /api/academic/add-threshold` (proposal) | Not migrated |
| actions/academic.ts | `toggleThresholdAction` | academic |  | yes |  | yes | `POST /api/academic/toggle-threshold` (proposal) | Not migrated |
| actions/academic.ts | `addOasRuleAction` | academic |  | yes |  | yes | `POST /api/academic/add-oas-rule` (proposal) | Not migrated |
| actions/academic.ts | `toggleOasRuleAction` | academic |  | yes |  | yes | `POST /api/academic/toggle-oas-rule` (proposal) | Not migrated |
| actions/academic.ts | `addTemplateAction` | academic |  | yes |  | yes | `POST /api/academic/add-template` (proposal) | Not migrated |
| actions/academic.ts | `approveTemplateAction` | academic |  | yes |  | yes | `POST /api/academic/approve-template` (proposal) | Not migrated |
| actions/academic.ts | `retireTemplateAction` | academic |  | yes |  | yes | `POST /api/academic/retire-template` (proposal) | Not migrated |
| actions/academic.ts | `academicCheckAction` | academic |  | yes |  | yes | `POST /api/academic/academic-check` (proposal) | Not migrated |
| actions/admin.ts | `createStaffAction` | admin |  | yes |  | yes | `POST /api/admin/create-staff` (proposal) | Not migrated |
| actions/admin.ts | `inviteAction` | admin |  | yes |  | yes | `POST /api/admin/invite` (proposal) | Not migrated |
| actions/admin.ts | `cancelInviteAction` | admin |  | yes |  | yes | `POST /api/admin/cancel-invite` (proposal) | Not migrated |
| actions/admin.ts | `staffStatusAction` | admin |  | yes |  | yes | `POST /api/admin/staff-status` (proposal) | Not migrated |
| actions/admin.ts | `revokeSessionsAction` | admin |  | yes |  | yes | `POST /api/admin/revoke-sessions` (proposal) | Not migrated |
| actions/admin.ts | `staffDetailsAction` | admin |  | yes |  | yes | `POST /api/admin/staff-details` (proposal) | Not migrated |
| actions/admin.ts | `reassignTasksAction` | admin |  | yes |  | yes | `POST /api/admin/reassign-tasks` (proposal) | Not migrated |
| actions/admin.ts | `membershipAction` | admin |  | yes |  | yes | `POST /api/admin/membership` (proposal) | Not migrated |
| actions/admin.ts | `userActiveAction` | admin |  | yes |  | yes | `POST /api/admin/user-active` (proposal) | Not migrated |
| actions/admin.ts | `resetLinkAction` | admin |  |  |  | yes | `POST /api/admin/reset-link` (proposal) | Not migrated |
| actions/admin.ts | `rolePermissionsAction` | admin |  | yes |  | yes | `POST /api/admin/role-permissions` (proposal) | Not migrated |
| actions/admin.ts | `createRoleAction` | admin |  | yes |  | yes | `POST /api/admin/create-role` (proposal) | Not migrated |
| actions/admin.ts | `orgSettingsAction` | admin |  | yes |  | yes | `POST /api/admin/org-settings` (proposal) | Not migrated |
| actions/admin.ts | `addReferenceAction` | admin |  | yes |  | yes | `POST /api/admin/add-reference` (proposal) | Not migrated |
| actions/admin.ts | `toggleReferenceAction` | admin |  | yes |  | yes | `POST /api/admin/toggle-reference` (proposal) | Not migrated |
| actions/admin.ts | `workflowAction` | admin |  | yes |  | yes | `POST /api/admin/workflow` (proposal) | Not migrated |
| actions/admin.ts | `staffPhotoAction` | admin |  | yes |  | yes | `POST /api/admin/staff-photo` (proposal) | Not migrated |
| actions/admin.ts | `removeStaffPhotoAction` | admin |  | yes |  | yes | `POST /api/admin/remove-staff-photo` (proposal) | Not migrated |
| actions/admin.ts | `reportingManagerAction` | admin |  | yes |  | yes | `POST /api/admin/reporting-manager` (proposal) | Not migrated |
| actions/admin.ts | `roleStructureAction` | admin |  | yes |  | yes | `POST /api/admin/role-structure` (proposal) | Not migrated |
| actions/attestation.ts | `startAttestationAction` | attestation |  | yes |  | yes | `POST /api/attestation/start-attestation` (proposal) | Not migrated |
| actions/attestation.ts | `stepAction` | attestation |  | yes |  | yes | `POST /api/attestation/step` (proposal) | Not migrated |
| actions/attestation.ts | `stepFileAction` | attestation |  | yes |  | yes | `POST /api/attestation/step-file` (proposal) | Not migrated |
| actions/attestation.ts | `cancelAttestationAction` | attestation |  | yes |  | yes | `POST /api/attestation/cancel-attestation` (proposal) | Not migrated |
| actions/attestation.ts | `saveRouteAction` | attestation | yes | yes |  | yes | `POST /api/attestation/save-route` (proposal) | Not migrated |
| actions/attestation.ts | `addStageAction` | attestation |  | yes |  | yes | `POST /api/attestation/add-stage` (proposal) | Not migrated |
| actions/attestation.ts | `removeStageAction` | attestation |  | yes |  | yes | `POST /api/attestation/remove-stage` (proposal) | Not migrated |
| actions/attestation.ts | `moveStageAction` | attestation |  | yes |  | yes | `POST /api/attestation/move-stage` (proposal) | Not migrated |
| actions/attestation.ts | `approveRouteAction` | attestation |  | yes |  | yes | `POST /api/attestation/approve-route` (proposal) | Not migrated |
| actions/attestation.ts | `newRouteVersionAction` | attestation | yes |  |  | yes | `POST /api/attestation/new-route-version` (proposal) | Not migrated |
| actions/attestation.ts | `deleteRouteDraftAction` | attestation | yes |  |  | yes | `POST /api/attestation/delete-route-draft` (proposal) | Not migrated |
| actions/attestation.ts | `addAuthorityAction` | attestation |  | yes |  | yes | `POST /api/attestation/add-authority` (proposal) | Not migrated |
| actions/attestation.ts | `toggleAuthorityAction` | attestation |  | yes |  | yes | `POST /api/attestation/toggle-authority` (proposal) | Not migrated |
| actions/auth.ts | `loginAction` | auth | yes |  |  |  | `POST /api/auth/login` (proposal) | Not migrated |
| actions/auth.ts | `logoutAction` | auth | yes |  |  |  | `POST /api/auth/logout` (proposal) | Not migrated |
| actions/auth.ts | `forgotPasswordAction` | auth |  |  |  | yes | `POST /api/auth/forgot-password` (proposal) | Not migrated |
| actions/auth.ts | `resetPasswordAction` | auth | yes |  | yes | yes | `POST /api/auth/reset-password` (proposal) | Not migrated |
| actions/auth.ts | `changePasswordAction` | auth | yes |  |  | yes | `POST /api/auth/change-password` (proposal) | Not migrated |
| actions/auth.ts | `verifyMfaAction` | auth | yes |  |  |  | `POST /api/auth/verify-mfa` (proposal) | Not migrated |
| actions/auth.ts | `startMfaAction` | auth |  |  |  | yes | `POST /api/auth/start-mfa` (proposal) | Not migrated |
| actions/auth.ts | `finishMfaAction` | auth |  |  |  | yes | `POST /api/auth/finish-mfa` (proposal) | Not migrated |
| actions/auth.ts | `adminResetMfaAction` | auth |  |  |  | yes | `POST /api/auth/admin-reset-mfa` (proposal) | Not migrated |
| actions/auth.ts | `acceptInvitationAction` | auth | yes |  |  | yes | `POST /api/auth/accept-invitation` (proposal) | Not migrated |
| actions/auth.ts | `signOutEverywhereAction` | auth | yes |  |  | yes | `POST /api/auth/sign-out-everywhere` (proposal) | Not migrated |
| actions/courier.ts | `issueCourierAction` | courier |  | yes |  | yes | `POST /api/courier/issue-courier` (proposal) | Not migrated |
| actions/courier.ts | `recordDispatchAction` | courier |  | yes |  | yes | `POST /api/courier/record-dispatch` (proposal) | Not migrated |
| actions/courier.ts | `shipmentStatusAction` | courier |  | yes |  | yes | `POST /api/courier/shipment-status` (proposal) | Not migrated |
| actions/courier.ts | `reconcileShipmentAction` | courier |  | yes |  | yes | `POST /api/courier/reconcile-shipment` (proposal) | Not migrated |
| actions/courier.ts | `saveCourierAddressAction` | courier |  | yes |  | yes | `POST /api/courier/save-courier-address` (proposal) | Not migrated |
| actions/documents.ts | `uploadAction` | documents |  | yes |  | yes | `POST /api/documents/upload` (proposal) | Not migrated |
| actions/documents.ts | `documentActionAction` | documents |  | yes |  | yes | `POST /api/documents/document-action` (proposal) | Not migrated |
| actions/documents.ts | `verificationAction` | documents |  | yes |  | yes | `POST /api/documents/verification` (proposal) | Not migrated |
| actions/documents.ts | `annotationAction` | documents |  | yes |  | yes | `POST /api/documents/annotation` (proposal) | Not migrated |
| actions/documents.ts | `custodyAction` | documents |  | yes |  | yes | `POST /api/documents/custody` (proposal) | Not migrated |
| actions/documents.ts | `documentDetailsAction` | documents |  | yes |  | yes | `POST /api/documents/document-details` (proposal) | Not migrated |
| actions/documents.ts | `addChecklistItemAction` | documents |  | yes |  | yes | `POST /api/documents/add-checklist-item` (proposal) | Not migrated |
| actions/import.ts | `previewImportAction` | students |  |  |  | yes | `POST /api/import/preview-import` (proposal) | Not migrated |
| actions/import.ts | `commitImportAction` | students |  | yes |  | yes | `POST /api/import/commit-import` (proposal) | Not migrated |
| actions/leads.ts | `createLeadAction` | leads | yes |  |  | yes | `POST /api/leads/create-lead` (proposal) | Not migrated |
| actions/leads.ts | `updateLeadAction` | leads |  | yes |  | yes | `POST /api/leads/update-lead` (proposal) | Not migrated |
| actions/leads.ts | `leadWorkAction` | leads |  | yes |  | yes | `POST /api/leads/lead-work` (proposal) | Not migrated |
| actions/leads.ts | `routeLeadAction` | leads |  | yes |  | yes | `POST /api/leads/route-lead` (proposal) | Not migrated |
| actions/leads.ts | `duplicateAction` | leads |  | yes |  | yes | `POST /api/leads/duplicate` (proposal) | Not migrated |
| actions/leads.ts | `convertLeadAction` | leads | yes |  |  | yes | `POST /api/leads/convert-lead` (proposal) | Not migrated |
| actions/leads.ts | `importLeadsAction` | leads |  | yes |  | yes | `POST /api/leads/import-leads` (proposal) | Not migrated |
| actions/master-data.ts | `saveCountryAction` | master-data |  |  |  | yes | `POST /api/master-data/save-country` (proposal) | Not migrated |
| actions/master-data.ts | `saveCourseAction` | master-data |  |  |  | yes | `POST /api/master-data/save-course` (proposal) | Not migrated |
| actions/master-data.ts | `masterStatusAction` | master-data |  |  |  | yes | `POST /api/master-data/master-status` (proposal) | Not migrated |
| actions/master-data.ts | `requestMasterDataAction` | master-data |  | yes |  | yes | `POST /api/master-data/request-master-data` (proposal) | Not migrated |
| actions/master-data.ts | `decideRequestAction` | master-data |  |  |  | yes | `POST /api/master-data/decide-request` (proposal) | Not migrated |
| actions/merge.ts | `checkMergeAction` | documents |  |  |  | yes | `POST /api/merge/check-merge` (proposal) | Not migrated |
| actions/notifications.ts | `consentAction` | notifications |  | yes |  | yes | `POST /api/notifications/consent` (proposal) | Not migrated |
| actions/notifications.ts | `retryMessageAction` | notifications |  | yes |  | yes | `POST /api/notifications/retry-message` (proposal) | Not migrated |
| actions/notifications.ts | `processNowAction` | notifications |  | yes |  | yes | `POST /api/notifications/process-now` (proposal) | Not migrated |
| actions/notifications.ts | `saveTemplateAction` | notifications |  | yes |  | yes | `POST /api/notifications/save-template` (proposal) | Not migrated |
| actions/notifications.ts | `saveRuleAction` | notifications |  | yes |  | yes | `POST /api/notifications/save-rule` (proposal) | Not migrated |
| actions/passport.ts | `recordPassportAction` | passport |  | yes |  | yes | `POST /api/passport/record-passport` (proposal) | Not migrated |
| actions/passport.ts | `verifyPassportAction` | passport |  | yes |  | yes | `POST /api/passport/verify-passport` (proposal) | Not migrated |
| actions/passport.ts | `passportFollowupAction` | passport |  | yes |  | yes | `POST /api/passport/passport-followup` (proposal) | Not migrated |
| actions/passport.ts | `sendEmailVerificationAction` | passport |  | yes |  | yes | `POST /api/passport/send-email-verification` (proposal) | Not migrated |
| actions/passport.ts | `addValidityRuleAction` | passport |  | yes |  | yes | `POST /api/passport/add-validity-rule` (proposal) | Not migrated |
| actions/passport.ts | `toggleValidityRuleAction` | passport |  | yes |  | yes | `POST /api/passport/toggle-validity-rule` (proposal) | Not migrated |
| actions/passport.ts | `contactStageAction` | passport |  | yes |  | yes | `POST /api/passport/contact-stage` (proposal) | Not migrated |
| actions/payments.ts | `recordPaymentAction` | finance |  | yes |  | yes | `POST /api/payments/record-payment` (proposal) | Not migrated |
| actions/payments.ts | `verifyPaymentAction` | finance |  | yes |  | yes | `POST /api/payments/verify-payment` (proposal) | Not migrated |
| actions/payments.ts | `reversePaymentAction` | finance |  | yes |  | yes | `POST /api/payments/reverse-payment` (proposal) | Not migrated |
| actions/payments.ts | `correctRateAction` | finance |  | yes |  | yes | `POST /api/payments/correct-rate` (proposal) | Not migrated |
| actions/payments.ts | `saveCurrencyAction` | finance |  | yes |  | yes | `POST /api/payments/save-currency` (proposal) | Not migrated |
| actions/portal-accounts.ts | `issuePortalLinkAction` | portal |  |  |  | yes | `POST /api/portal-accounts/issue-portal-link` (proposal) | Not migrated |
| actions/portal-accounts.ts | `portalAccountStatusAction` | portal |  | yes |  | yes | `POST /api/portal-accounts/portal-account-status` (proposal) | Not migrated |
| actions/portal-accounts.ts | `publishAction` | portal |  | yes |  | yes | `POST /api/portal-accounts/publish` (proposal) | Not migrated |
| actions/portal-accounts.ts | `unpublishAction` | portal |  | yes |  | yes | `POST /api/portal-accounts/unpublish` (proposal) | Not migrated |
| actions/requirements.ts | `acknowledgeAction` | requirements |  | yes |  | yes | `POST /api/requirements/acknowledge` (proposal) | Not migrated |
| actions/requirements.ts | `saveRequirementAction` | requirements | yes | yes |  | yes | `POST /api/requirements/save-requirement` (proposal) | Not migrated |
| actions/requirements.ts | `requirementStatusAction` | requirements |  | yes |  | yes | `POST /api/requirements/requirement-status` (proposal) | Not migrated |
| actions/scope.ts | `setScopeAction` | shared (company scope) | yes |  | yes |  | `POST /api/scope/set-scope` (proposal) | Not migrated |
| actions/security.ts | `clearFileAction` | security |  | yes |  | yes | `POST /api/security/clear-file` (proposal) | Not migrated |
| actions/security.ts | `acknowledgeAlertAction` | security |  | yes |  | yes | `POST /api/security/acknowledge-alert` (proposal) | Not migrated |
| actions/students.ts | `createStudentAction` | students | yes |  |  | yes | `POST /api/students/create-student` (proposal) | Not migrated |
| actions/students.ts | `uploadStudentPhotoAction` | students |  | yes |  | yes | `POST /api/students/upload-student-photo` (proposal) | Not migrated |
| actions/students.ts | `removeStudentPhotoAction` | students |  | yes |  | yes | `POST /api/students/remove-student-photo` (proposal) | Not migrated |
| actions/students.ts | `updateStudentAction` | students | yes |  |  | yes | `POST /api/students/update-student` (proposal) | Not migrated |
| actions/students.ts | `changeStageAction` | students |  | yes |  | yes | `POST /api/students/change-stage` (proposal) | Not migrated |
| actions/students.ts | `assignAction` | students |  | yes |  | yes | `POST /api/students/assign` (proposal) | Not migrated |
| actions/students.ts | `noteAction` | students |  | yes |  | yes | `POST /api/students/note` (proposal) | Not migrated |
| actions/students.ts | `followupAction` | students |  | yes |  | yes | `POST /api/students/followup` (proposal) | Not migrated |
| actions/students.ts | `visaAction` | students |  | yes |  | yes | `POST /api/students/visa` (proposal) | Not migrated |
| actions/students.ts | `admissionAction` | students |  | yes |  | yes | `POST /api/students/admission` (proposal) | Not migrated |
| actions/students.ts | `mergeAction` | students |  | yes |  | yes | `POST /api/students/merge` (proposal) | Not migrated |
| actions/students.ts | `archiveAction` | students |  | yes |  | yes | `POST /api/students/archive` (proposal) | Not migrated |
| actions/tasks.ts | `createTaskAction` | tasks | yes | yes |  | yes | `POST /api/tasks/create-task` (proposal) | Not migrated |
| actions/tasks.ts | `updateTaskAction` | tasks |  | yes |  | yes | `POST /api/tasks/update-task` (proposal) | Not migrated |
| actions/tasks.ts | `commentAction` | tasks |  | yes |  | yes | `POST /api/tasks/comment` (proposal) | Not migrated |
| actions/universities.ts | `saveUniversityAction` | universities | yes | yes |  | yes | `POST /api/universities/save-university` (proposal) | Not migrated |
| actions/universities.ts | `addPartAction` | universities |  | yes |  | yes | `POST /api/universities/add-part` (proposal) | Not migrated |
| actions/universities.ts | `togglePartAction` | universities |  | yes |  | yes | `POST /api/universities/toggle-part` (proposal) | Not migrated |
| actions/universities.ts | `removeRequirementAction` | universities |  | yes |  | yes | `POST /api/universities/remove-requirement` (proposal) | Not migrated |
| actions/verification-rules.ts | `saveRuleAction` | verification-rules | yes | yes |  | yes | `POST /api/verification-rules/save-rule` (proposal) | Not migrated |
| actions/verification-rules.ts | `addRequirementAction` | verification-rules |  | yes |  | yes | `POST /api/verification-rules/add-requirement` (proposal) | Not migrated |
| actions/verification-rules.ts | `removeRequirementAction` | verification-rules |  | yes |  | yes | `POST /api/verification-rules/remove-requirement` (proposal) | Not migrated |
| actions/verification-rules.ts | `approveRuleAction` | verification-rules |  | yes |  | yes | `POST /api/verification-rules/approve-rule` (proposal) | Not migrated |
| actions/verification-rules.ts | `newVersionAction` | verification-rules | yes |  |  | yes | `POST /api/verification-rules/new-version` (proposal) | Not migrated |
| actions/verification-rules.ts | `deleteDraftAction` | verification-rules | yes |  |  | yes | `POST /api/verification-rules/delete-draft` (proposal) | Not migrated |
| portal/actions.ts | `requestCodeAction` | portal | yes |  |  | yes | `POST /api/portal/request-code` (proposal) | Not migrated |
| portal/actions.ts | `verifyCodeAction` | portal | yes |  |  |  | `POST /api/portal/verify-code` (proposal) | Not migrated |
| portal/actions.ts | `chooseAction` | portal | yes |  |  |  | `POST /api/portal/choose` (proposal) | Not migrated |
| portal/actions.ts | `logoutAction` | portal | yes |  |  |  | `POST /api/portal/logout` (proposal) | Not migrated |
| portal/actions.ts | `uploadAction` | portal | yes | yes |  | yes | `POST /api/portal/upload` (proposal) | Not migrated |
| portal/actions.ts | `submitCourierAction` | portal |  | yes |  | yes | `POST /api/portal/submit-courier` (proposal) | Not migrated |
| portal/actions.ts | `passwordLoginAction` | portal | yes |  |  |  | `POST /api/portal/password-login` (proposal) | Not migrated |
| portal/actions.ts | `setPasswordAction` | portal | yes |  | yes | yes | `POST /api/portal/set-password` (proposal) | Not migrated |
| portal/actions.ts | `forgotPasswordAction` | portal |  |  |  | yes | `POST /api/portal/forgot-password` (proposal) | Not migrated |
| portal/actions.ts | `markNoticesReadAction` | portal |  | yes |  |  | `POST /api/portal/mark-notices-read` (proposal) | Not migrated |
| portal/actions.ts | `portalReferralAction` | portal |  | yes |  | yes | `POST /api/portal/portal-referral` (proposal) | Not migrated |
| portal/actions.ts | `publicReferralAction` | portal |  |  |  | yes | `POST /api/portal/public-referral` (proposal) | Not migrated |

## 7. Baseline results (phase 1, before any change)

Run on 2026-11-03 with the disposable test database only (`.data/pg-test`, port 54339; `.data/storage-test`). Logs: `.data/vite-phase1/{typecheck,lint,test,build}.log`.

| Check | Command (repo root, Node from `~/.local/node/bin`) | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Passed (exit 0) |
| Lint | `npm run lint` | Passed (exit 0) |
| Tests | `npm test` | Passed: backend 374/374 (45 files), backend API 2/2 (1 file), frontend integration 119/119 (8 files) |
| Build | `npm run build` | Passed (exit 0; Next.js build + Express bundle) |
| Browser tests (Playwright, 54) | — | Not tested (they need the disposable browser-test DB, D3, not built) |

## 8. What phase 1 changed

- Added this document. No source, configuration, dependency, database, migration, `.env` or logo file was changed.
- Next.js has **not** been removed; every route, page and action still runs on Next.js exactly as before.
