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
3. Environment variables (Production and Preview separately):
   `APP_URL`, `DATABASE_URL` (erp_app pooled URL), `DATABASE_POOLED=true`, `STORAGE_DRIVER=s3`, the `S3_*`
   values, `STORAGE_SIGNING_SECRET` (random 32+ chars), `MFA_ENCRYPTION_KEY` (32 random bytes, base64 —
   **back it up in the password manager; losing it means everyone must re-enrol 2FA**), `MFA_ENFORCE=roles`
   (or `all`), `CRON_SECRET` (32+ random chars), `PORTAL_SECRET` (32+ random chars), the notification settings in docs/NOTIFICATIONS.md
   (`NOTIFICATIONS_MODE=test` until approved), `APP_TIMEZONE=Asia/Kolkata`, optional
   `RESEND_API_KEY` and `EMAIL_FROM`.
   **Never** add `DATABASE_ADMIN_URL`, `APP_DB_PASSWORD` or `SEED_DEMO_PASSWORD` to Vercel.
4. Deploy, then add your domain (e.g. `staff.yourcompany.com`) and confirm HTTPS.
5. Optional: enable Vercel Firewall rate limiting for `/login` and `/forgot-password`.

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
   Migrations are forward-only; never edit an applied migration (the runner refuses).
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
- [ ] Two-factor login: `MFA_ENFORCE=all` decided; MD, CEO, administrators and finance enrolled
- [ ] `MFA_ENCRYPTION_KEY` stored in the company password manager
- [ ] Retention policy and privacy notice for students agreed
- [ ] Demo accounts absent from production (never run `db:seed` there)
- [ ] Notifications: templates approved, channels tested with own number/address, then `NOTIFICATIONS_MODE=live`
