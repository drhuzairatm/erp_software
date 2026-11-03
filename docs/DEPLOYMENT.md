# Cloud deployment guide

> **Status:** nothing has been deployed yet. These steps have been prepared and the app has been
> verified locally (tests, production build), but no cloud account, database, bucket or domain has been
> configured or tested. Each step below must be performed and checked by you or your developer.

## Recommended setup

| Piece | Recommended service | Alternatives |
|---|---|---|
| Web app hosting | Vercel (Pro plan for business use) | Render, Railway, Fly.io, any Node 24 host |
| PostgreSQL | Supabase (Pro plan for daily backups + PITR option) | Neon, AWS RDS, DigitalOcean |
| Private file storage | Supabase Storage (S3-compatible endpoint) | Cloudflare R2, AWS S3 |
| Email (optional) | Resend | Postmark, SES |
| Error monitoring (optional) | Vercel logs; Sentry can be added later | — |

Create **two separate environments**: `staging` (fictional data, used for UAT) and `production`
(real data only after sign-off). Each has its own database, bucket, secrets and URL. Choose a data region
close to your users and compliant with your requirements (e.g. Mumbai `ap-south-1`).

## 1. Database (per environment)

1. Create a Supabase project (strong database password, chosen region).
2. **Disable the Data API**: Project Settings → API → turn off "Data API" (this app does not use it).
3. From your computer, set `DATABASE_ADMIN_URL` to the project's **direct** connection string
   (`postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres`, or the session pooler on port 5432
   if your network lacks IPv6) and a new random `APP_DB_PASSWORD` (24+ chars), then run:
   ```bash
   npm run db:migrate      # creates schema, RLS, the erp_app role and sets its password
   npm run db:provision    # companies, default roles, reference data, workflows
   ```
   For **staging only**, optionally load fictional data: `SEED_ALLOW_REMOTE=true npm run db:seed`.
4. Runtime connection string for the app (low-privilege role), via the **transaction pooler**:
   `postgres://erp_app.<ref>:<APP_DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres`
   and set `DATABASE_POOLED=true`. Verify the login works before continuing
   (`psql "<url>" -c "select current_user"` should print `erp_app`).

## 2. File storage (per environment)

1. Supabase → Storage → create a **private** bucket, e.g. `student-documents` (no public access).
2. Storage → S3 connection → create an access key pair.
3. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3`, `S3_REGION=<region>`,
   `S3_BUCKET=student-documents`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`.
4. Test: upload a fictional PDF in staging, open it, confirm the link stops working after 60 seconds.

## 3. Web app (Vercel)

1. Put the code in a **private** GitHub repository (do not commit `.env`).
2. Vercel → New Project → import the repo. Framework: Next.js. Node.js version 24.
   **Root Directory: `frontend`** (the repository is an npm workspace; see README, *Project layout*). Keep
   "Include files outside the Root Directory in the Build Step" **enabled**: the app imports `backend/`. Vercel
   installs from the root `package-lock.json`. `frontend/vercel.json` holds the cron schedules, and
   `outputFileTracingRoot` in `frontend/next.config.ts` makes the deployed functions include the backend code they use.
   **Not yet verified on Vercel** (no project exists); verified locally with `npm run build` and `npm start`.
3. Environment variables (Production and Preview separately):
   `APP_URL`, `DATABASE_URL` (erp_app pooled URL), `DATABASE_POOLED=true`, `STORAGE_DRIVER=s3`, the `S3_*`
   values, `STORAGE_SIGNING_SECRET` (random 32+ chars), `MFA_ENCRYPTION_KEY` (32 random bytes, base64 —
   **back it up in the password manager; losing it means everyone must re-enrol 2FA**), `MFA_ENFORCE=all` (production enforces two-step login for everyone regardless), `CRON_SECRET` (32+ random chars), `PORTAL_SECRET` (32+ random chars), the notification settings in docs/NOTIFICATIONS.md
   (**Production must set `NOTIFICATIONS_MODE=live` exactly. Otherwise the server **will not serve the application**: every request, `/api/health` included, is answered with HTTP 500, and the log shows "Refusing to start: …". The process itself keeps running, so set up your health check on `/api/health`.** Until the go-live
   approval, use a staging/preview deployment with `APP_ENV=staging` and `NOTIFICATIONS_MODE=test`. Never set
   `NOTIFICATIONS_TEST_MAILBOX` outside development; see docs/NOTIFICATIONS.md, *Modes*), `APP_TIMEZONE=Asia/Kolkata`, optional
   `RESEND_API_KEY` and `EMAIL_FROM`.
   **Never** add `DATABASE_ADMIN_URL`, `APP_DB_PASSWORD` or `SEED_DEMO_PASSWORD` to Vercel.
4. Deploy, then add your domain (e.g. `staff.yourcompany.com`) and confirm HTTPS.
5. Optional: enable Vercel Firewall rate limiting for `/login` and `/forgot-password`.
6. **Scheduled jobs (required):** `/api/cron/notifications` must run **every minute**. It also delivers staff password-reset emails, student-portal set-up and reset emails, and portal sign-in codes and email-verification links from their encrypted queues (`auth_private.staff_email_outbox`, `auth_private.portal_email_outbox`, `auth_private.auth_message_outbox`); the sign-in action only tries a faster delivery. `/api/cron/daily` runs once a day and also removes expired trusted-browser and reset-request records. On Vercel, `frontend/vercel.json` sets both (per-minute needs Pro). On a **Hostinger VPS**, add a system cron (or systemd timer), for example `* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/notifications`, plus a daily call to `/api/cron/daily`. Without it, reset emails are never sent and expire after 1 hour.

### 3.1 Encryption key rotation (`MFA_ENCRYPTION_KEY`)

`MFA_ENCRYPTION_KEY` lives only in the server environment, never in the database. It protects: two-step login secrets;
the staff reset-link queue (N-1) and the portal set-up/reset-link queue (N-7), both encrypted with the key directly; and
the sign-in code and verification-link queue (N-8), encrypted with a sub-key derived by HKDF-SHA256 (label
`erp-auth-message-v1`). The key is never logged. Neither are the decrypted codes or links. There is no automatic
dual-key rotation. Changing the key means:

- **Every staff member must re-enrol two-step login** (existing secrets can no longer be read).
- **Queued, not yet sent** reset links, portal set-up/reset links, sign-in codes and verification links can no longer be
  read. The sender marks each one *Failed* ("could not be read"), sends nothing and wipes it. Nothing is exposed.
  Users simply request a new one: a sign-in code lasts 10 minutes, a staff reset link 1 hour, a portal link 1 or
  72 hours, and a verification link 48 hours.
- To keep the disruption small: rotate in a quiet hour, after the queues are empty (Messages page: no *Queued* sign-in
  rows). Change the key, restart, then have staff re-enrol two-step login.

## 3a. Client address and reverse proxy (`TRUST_PROXY`)

**Why it matters:** the client address feeds the per-address sign-in limit (30 failures in 15 minutes), the portal-code limit (20 per hour), the "many failed sign-ins from one address" alert and the audit log. Headers like `X-Forwarded-For` can be typed by anyone, so the app believes **only** the header that **your own proxy sets**, and only when `TRUST_PROXY` says so (`backend/src/lib/client-ip.ts`). Values that are not valid IPv4/IPv6 addresses are discarded.

**If `TRUST_PROXY` is not set (or the app is reached directly):**
- No forwarding header is trusted, and the address is **unknown**.
- Per-address limits are skipped.
- Per-email and per-identifier limits (5 failures / 5 codes) still apply.
- Audit records store no address. An address is never invented.

### Hostinger VPS (Nginx or Caddy in front of `next start` on 127.0.0.1:3000)
1. **Bind the app to localhost only** (`next start -H 127.0.0.1 -p 3000`) and block port 3000 in the firewall. Otherwise someone could bypass the proxy and send any header.
2. **Make the proxy overwrite the header with the real connecting address:**
   - **Nginx:**
     ```nginx
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;      # replaces anything the client sent
       proxy_set_header X-Forwarded-For $remote_addr; # do NOT use $proxy_add_x_forwarded_for here
       proxy_set_header X-Forwarded-Proto $scheme;
     }
     ```
   - **Caddy:**
     ```caddy
     erp.example.com {
       reverse_proxy 127.0.0.1:3000 {
         header_up X-Real-IP {remote_host}
       }
     }
     ```
3. **Set** `TRUST_PROXY=x-real-ip`.
4. **If a CDN or WAF** (e.g. Cloudflare) sits in front of the VPS:
   - **Nginx:** use its real-IP module, restricted to the CDN's published address ranges, so `$remote_addr` becomes the visitor's address.
   - **Otherwise:** keep `TRUST_PROXY=none`.
5. **Verify on staging:** sign in once with a wrong password, then check *Sign-in activity* or the audit log. It must show your real public address. Sending a fake `X-Forwarded-For` / `X-Real-IP` header from your computer must **not** change it. **(Not yet verified: no VPS exists.)**

### Vercel
- **Setting:** `TRUST_PROXY=vercel` (reads `X-Real-IP`, which the platform sets).
- **Verification:** **requires external validation** on the real deployment, with the same test as step 5 above.

### Own proxy that appends to X-Forwarded-For
- **Setting:** `TRUST_PROXY=xff-last` with `TRUSTED_PROXY_HOPS` = the number of your own proxies.
- **Which entry is used:** the right-most entry, the one your proxy added. The client-supplied left part is never used.

## 4. First administrator

From your computer, with `DATABASE_ADMIN_URL` and `APP_URL` pointing at the target environment:
```bash
npm run admin:create -- --email it.admin@yourcompany.com --name "Full Name" --role system_admin --orgs EDX,GRD
npm run admin:create -- --email md@yourcompany.com --name "MD Name" --role md --orgs EDX,GRD
npm run admin:create -- --email ceo@yourcompany.com --name "CEO Name" --role ceo --orgs EDX,GRD
```
Each prints a one-time 24-hour setup link. Deliver it privately. After setting a password, MD, CEO and
administrators are asked to set up two-factor login before they can continue. The administrator then creates all other
staff from **Staff** in the app.

## 5. Release procedure (each change)

1. `npm run check` locally (typecheck, lint, unit/integration tests, build) and `npm run test:e2e`.
2. Push to a branch → Vercel preview deploy (against staging) → smoke test.
3. Apply new migrations to staging (`npm run db:migrate` with staging admin URL), test, then production.
   Never edit an applied migration (the runner refuses). From 0017 every migration ships with an undo
   script in `backend/db/rollbacks/` (`npm run db:migrate -- --rollback NNNN`). Take `npm run db:backup` first.
   Code changes are tracked in git: deploy a tagged commit so a release can be rolled back.
4. Merge to main → production deploy. Check `/api/health` returns `{"status":"ok"}`.

## 6. Monitoring

- `/api/health` for an uptime monitor (e.g. Better Stack, UptimeRobot) every 1–5 minutes.
- Vercel runtime logs: server errors are logged as JSON lines with `"level":"error"`.
- Review the **Audit log** weekly (denied file access, exports, permission changes, failed logins).
- Sentry or similar is **not** configured; add it if you need alerting on errors.

## Go-live checklist

- [ ] Staging UAT completed with fictional data (docs/UAT_CHECKLIST.md) and signed off
- [ ] Data API disabled; `erp_app` connection verified; admin URL not present in Vercel
- [ ] Bucket private; signed-link expiry verified
- [ ] Backups enabled and a **restore test** performed (docs/BACKUP_RECOVERY.md)
- [ ] Two-factor login (mandatory for everyone): every pilot user enrolled; MD recovery codes stored offline
- [ ] Virus scanner configured (`CLAMAV_HOST` or `SCANNER_URL`) and tested on staging, or manual clearance formally accepted (PILOT_READINESS_CHECKLIST.md D1)
- [ ] Full pre-pilot list: PILOT_READINESS_CHECKLIST.md
- [ ] `MFA_ENCRYPTION_KEY` stored in the company password manager
- [ ] Retention policy and privacy notice for students agreed
- [ ] Demo accounts absent from production (never run `db:seed` there)
- [ ] Notifications: templates approved, channels tested with own number/address, then `NOTIFICATIONS_MODE=live` (required in production: otherwise every request gets HTTP 500, including `/api/health`; `NOTIFICATIONS_TEST_MAILBOX` not set)
