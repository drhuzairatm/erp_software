# Hosting, email and virus-scanner options (for owner review; nothing purchased)

**Prepared:** 1 Nov 2026.

**Prices:**
- **Where they come from:** public pricing pages and pricing summaries checked on that date, in **US dollars, before Indian GST (18%)**.
- **Marking:** prices marked *verify* conflicted between sources and must be confirmed on the vendor's page before purchase.
- **Hostinger:** introductory prices require paying 24 months in advance, and renewal prices are much higher.

## 1. What the ERP needs from hosting (unchanged architecture)
| Need | Detail |
|---|---|
| Node.js 24 web app | Next.js 16 (`next start`), always-on; the per-request security nonce means every page is rendered on the server |
| PostgreSQL 17 | Row-level security, the `erp_app` role and SQL migrations, so a full PostgreSQL is needed (not a "MySQL hosting" plan) |
| Private file storage (S3-compatible) | Production refuses local disk storage by design. Options: Supabase Storage, Cloudflare R2, Backblaze B2, or self-hosted MinIO |
| Scheduled jobs | Every minute (notifications, alert emails); daily (passport monitoring, virus re-scan). On a VPS: system cron calling the two `/api/cron/...` URLs with `CRON_SECRET` |
| Virus scanner | Your decision: a **real server-side scanner** before any real-student documents. ClamAV needs an always-on server with roughly **2–3 GB RAM** for its signature database. It **cannot run on Vercel**. |
| HTTPS | Domain and TLS certificate (required for the camera, secure cookies and HSTS) |
| Region | India (Mumbai) is preferable for student personal data; confirm with the legal adviser (DPDP) |
| Separate staging and production | Separate databases, storage and secrets (Phase E requirement) |

## 2. Hosting options
### Option H1: Hostinger VPS only (self-managed everything)
- **What runs there:** the app, PostgreSQL 17 and ClamAV on one VPS per environment. Files go to Backblaze B2 or Cloudflare R2, or MinIO on the same VPS (then they must be backed up separately).
- **Plans** (official Hostinger page, 1 Nov 2026):

| Plan | vCPU / RAM / NVMe | Intro (24-month prepay) | Renewal | Suitable for |
|---|---|---|---|---|
| KVM 1 | 1 / 4 GB / 50 GB | $6.49/mo ($155.76 upfront) | $11.99/mo | Staging (app + DB + ClamAV is tight on 4 GB) |
| KVM 2 | 2 / 8 GB / 100 GB | $8.79/mo ($210.96 upfront) | $14.99/mo | **Production** (app + DB + ClamAV fit) |
| KVM 4 | 4 / 16 GB / 200 GB | $12.99/mo ($311.76 upfront) | $28.99/mo | Production with growth headroom |

- **Included:**
  - full root access
  - a managed firewall
  - DDoS filtering
  - **free weekly backups**
  - India (Mumbai) location available (choose it at creation; *verify* in the dashboard)
- **Daily backups:** paid add-on (*verify* the price; sources show about $6–12/mo) with 7–14 days' retention (*verify*).
- **Snapshots:** one manual snapshot only.
- **Compatibility:** works with the existing code without changes. Needs:
  - setup of Node.js, a reverse proxy with automatic HTTPS (e.g. Caddy), PostgreSQL 17, ClamAV (`CLAMAV_HOST=127.0.0.1`)
  - system cron for the two scheduled jobs
  - an S3-compatible bucket
- **Security:** strong isolation (your own server). But **you are responsible** for:
  - operating-system updates
  - SSH hardening (keys only)
  - the firewall
  - PostgreSQL backups and point-in-time recovery (e.g. pgBackRest or WAL-G to off-site storage)
  - monitoring
  - incident response on the server

  Hostinger's weekly or daily VPS backups are whole-server images, not tested database backups.
- **Risk:** the biggest risk is **database backup and restore quality**, which depends on the technical owner's skill.
- **Indicative monthly cost:** about $25–30/mo introductory, about $35–45/mo after renewal. Made up of KVM 2 production ($8.79 → $14.99) + KVM 1 staging ($6.49 → $11.99) + one daily-backup add-on ($6–12, *verify*) + off-site storage (about $1–2) + email (free tier).

### Option H2: Managed cloud (the architecture the ERP was designed for: Vercel + Supabase)
- **What runs where:**
  - **App:** Vercel Pro, functions in the Mumbai region.
  - **Database and files:** Supabase Pro in South Asia (Mumbai).
  - **ClamAV:** a small separate VPS, e.g. Hostinger KVM 1, reachable only from the app.
- **Prices:**
  - **Vercel Pro:** $20 per developer seat per month, plus usage beyond the included amounts (*verify*).
  - **Supabase Pro:** $25/mo per project. It includes daily backups (7 days). **Point-in-time recovery** is an add-on of about **$100/mo** for 7 days. Staging needs a second project, another $25/mo.
- **Compatibility:** the original target. DEPLOYMENT.md describes it step by step; no code changes.
- **Security:**
  - the provider patches servers
  - managed database backups (and PITR if bought)
  - fewer things for your team to get wrong
  - data processed by US-headquartered providers (data-processing agreements needed)
- **Indicative monthly cost:** about $75–85/mo without PITR; about $175–185/mo with PITR. Made up of Vercel 1 seat ($20) + 2 Supabase projects ($50) + ClamAV VPS ($6.49 → $11.99) + email (free tier).

### Option H3: Hybrid (recommended)
- **What runs where:**
  - **App and ClamAV:** Hostinger VPS KVM 2 (production) + KVM 1 (staging), Mumbai.
  - **Database and file storage:** Supabase Pro (Mumbai), production + staging.
- **Why:**
  - **Your preference:** keeps Hostinger and its low monthly cost.
  - **Managed database:** moves the hardest part (database backups, PITR option, restore) to a managed service.
  - **ClamAV next to the app:** files never leave your infrastructure for scanning.
- **Compatibility:** no code changes. Supabase provides both PostgreSQL and S3-compatible storage. Cron runs on the VPS.
- **Indicative monthly cost:** about $65–70/mo introductory, about $77–80/mo after renewal, without PITR. Made up of KVM 2 ($8.79 → $14.99) + KVM 1 ($6.49 → $11.99) + 2 × Supabase Pro ($50) + email (free tier). Add about $100/mo if you want point-in-time recovery for production.

**Recommendation:**
- **Overall:** **H3**. It gives the lowest risk per rupee, and the database restore can be tested on staging exactly as Phase E requires.
- **H1 instead:** choose it only if a named technical owner is confident running and restoring PostgreSQL themselves.
- **H2 instead:** the simplest to operate but the most expensive.

## 3. Email (invitations, password links, alerts, notifications)
**Current code:**
- **Invitations, password and alert emails:** sent through the **Resend API** (`RESEND_API_KEY`).
- **Student and parent notifications:** sent through each brand's **SMTP mailbox** (`EMAIL_SMTP_URL_EDX` / `_GRD`).

| Option | Price | Compatibility | Notes |
|---|---|---|---|
| **Resend** | Free: 3,000 emails/mo (100/day); Pro $20/mo for 50,000 | **Works now** (already integrated) | US provider; needs a verified sending domain (DNS: SPF, DKIM, DMARC). The free tier is enough for a pilot. |
| **Amazon SES** (Mumbai region) | $0.10 per 1,000 emails | SMTP works for notifications now. Invitations would need a small code change to send through SMTP. | Very cheap; AWS account and domain verification; starts in a "sandbox" until AWS approves |
| **Zoho ZeptoMail** | Pay-as-you-go credits (1 credit = 10,000 emails; *verify* INR price) | Same as SES | Indian company (Zoho); transactional only |
| **Brand mailboxes** (Google Workspace / Zoho Mail SMTP) | Usually already paid | Works now for notifications | Daily sending limits; not ideal for system mail |

**Recommendation:** **Resend** for system emails (no code change; free for the pilot). Keep brand SMTP for student notifications once their wording is approved. Whichever you choose, the sending domain(s) need SPF, DKIM and DMARC DNS records.

## 4. Virus scanner (your requirement: real, server-side, before real-student documents)
| Option | Price | Data protection | Compatibility | Notes |
|---|---|---|---|---|
| **ClamAV (open source), on your own VPS** | Free software; needs about 2–3 GB RAM on the VPS (fits KVM 2) | **Files never leave your servers** | **Works now** (`CLAMAV_HOST`); integration tested against the ClamAV protocol | Signatures updated automatically (`freshclam`). Detection is good for known malware; weaker than commercial engines for brand-new threats. |
| **Cloudmersive Virus Scan API** | Free about 600 calls/mo; paid monthly plans (*verify*) | Files are **sent to a third party** (US): a data-processing agreement is needed for passports and certificates | Small adapter change needed (their response format differs) | Multiple engines; cloud only |
| AWS GuardDuty Malware Protection for S3 | Per GB scanned (*verify*) | Stays in AWS | Only if files are stored in AWS S3; design change | Not a fit for H1/H3 |
| ~~VirusTotal~~ | n/a | **Not suitable:** uploaded files are shared with security researchers | n/a | Excluded: would expose student documents |

**Recommendation:** **ClamAV on the Hostinger VPS** (H1 or H3). No extra cost, no student documents leave your infrastructure, and it is already built. Before any real document: verify on staging with the standard **EICAR test file**. Optionally add a commercial engine later.

## 5. Budget summary (indicative, before GST)
Hostinger amounts assume the 24-month prepay; Supabase and Vercel are monthly.

| Choice | First 24 months | After renewal |
|---|---|---|
| H1 Hostinger only + ClamAV + Resend free | about $25–30/mo | about $35–45/mo |
| **H3 Hybrid + ClamAV + Resend free** | **about $65–70/mo** | **about $77–80/mo** |
| H2 Vercel + Supabase + ClamAV VPS + Resend free | about $77/mo | about $82/mo |
| Add: point-in-time recovery (Supabase, production) | +$100/mo | +$100/mo |
| Add: independent penetration test | one-off; quote needed | |

## Sources (checked 1 Nov 2026)
- **Hostinger:** [Hostinger VPS plans](https://www.hostinger.com/vps-hosting) · [Hostinger India data centre](https://www.hostinger.com/blog/hostinger-newly-launched-data-center-location-in-india) · [Hostinger daily backups](https://www.hostinger.com/support/1665153-how-to-activate-daily-backups/)
- **Supabase:** [Supabase pricing](https://supabase.com/pricing.md) · [Supabase regions](https://supabase.com/docs/guides/platform/regions)
- **Vercel:** [Vercel Pro plan](https://vercel.com/docs/plans/pro-plan)
- **Email:** [Resend pricing](https://www.resend.com/pricing.md) · [Amazon SES pricing](https://aws.amazon.com/ses/pricing/) · [Zoho ZeptoMail pricing](https://www.zoho.com/zeptomail/pricing.html)
- **Virus scanning:** [Cloudmersive Virus API](https://cloudmersive.com/virus-api)
- **Storage:** [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing) · [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
