#!/usr/bin/env bash
# Stage 0 read-only production check, revision 3.
# PAUSED by MD decision, 4 Nov 2026. Do not run.
# Run FROM THE MAC, as the non-root user, with SSH key authentication only:
#
#   ssh -o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no \
#       -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -i KEY_PATH erp@SERVER 'bash -s' \
#     < docs/audit/stage0_production_readonly_check.sh > .data/stage0-production/output.txt 2>&1
#
# Design rules:
#   - Sends all output down the SSH connection; creates no file on the VPS
#   - Refuses to run as root; never calls sudo, su, or a PostgreSQL superuser
#   - Uses DATABASE_URL only. Never reads the value of DATABASE_ADMIN_URL
#   - Stops database checks unless the role is non-superuser and the session is read-only
#   - Reads catalogues and statistics only, never a row of personal data
#   - Prints no .env value outside the short non-secret allow-list below
#   - Prints no raw cron or log line: only schedules, keywords and counts
#   - Does not call pm2, npm, nginx, git fetch, or any service control command
#   - Reports anything it can't check as BLOCKED or NOT VERIFIED
# What the server still records by itself: the SSH login, the database connection, one local
# health request, and possibly file access times. No data, configuration or service is changed.
main() {
  set -u
  APP_DIR="${APP_DIR:-/home/erp/app}"
  ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
  export GIT_OPTIONAL_LOCKS=0
  export LC_ALL=C

  h() { printf '\n=== %s\n' "$1"; }
  have() { command -v "$1" >/dev/null 2>&1; }
  redact() {
    sed -E \
      -e 's#(://)[^/@[:space:]]+@#\1***@#g' \
      -e 's/(Bearer[[:space:]]+)[^[:space:]"]+/\1***/g' \
      -e 's/((SECRET|TOKEN|PASSWORD|PASS|KEY)[A-Z_]*=)[^[:space:]]+/\1***/g'
  }
  is_set() { [ -f "$ENV_FILE" ] && grep -qE "^$1=[\"']?[^\"'[:space:]]" "$ENV_FILE"; }
  allowed_value() { [ -f "$ENV_FILE" ] && grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'"; }
  perms() { stat -c '%a %U:%G' "$1" 2>/dev/null || stat -f '%Lp %Su:%Sg' "$1" 2>/dev/null; }

  h "0. Identity and guards"
  echo "user: $(id -un)  host: $(hostname)  time: $(date -u '+%Y-%m-%d %H:%M UTC')"
  if [ "$(id -u)" = "0" ]; then echo "STOP: running as root. This check must run as the application user."; return 2; fi
  if [ ! -d "$APP_DIR/.git" ]; then echo "STOP: $APP_DIR is not a Git checkout. Production not identified."; return 3; fi
  if ! git -C "$APP_DIR" remote get-url origin 2>/dev/null | grep -q 'erp_software'; then
    echo "STOP: origin is not the expected ERP repository. Production not identified."; return 3
  fi
  echo "application directory confirmed: $APP_DIR"

  h "A. Git"
  echo "branch: $(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>&1)"
  echo "commit: $(git -C "$APP_DIR" rev-parse HEAD 2>&1)"
  git -C "$APP_DIR" log -1 --format='subject: %s%ndate: %ci' 2>&1
  git -C "$APP_DIR" remote get-url origin 2>&1 | redact
  echo "changed tracked files (names only):"
  git -C "$APP_DIR" status --porcelain --untracked-files=no 2>/dev/null | head -40
  echo "untracked count: $(git -C "$APP_DIR" status --porcelain 2>/dev/null | grep -c '^??')"
  echo "email implementation in checkout: nodemailer lines=$(grep -c nodemailer "$APP_DIR/backend/src/lib/email.ts" 2>/dev/null) resend lines=$(grep -c 'api.resend.com' "$APP_DIR/backend/src/lib/email.ts" 2>/dev/null)"
  echo "NOT VERIFIED: a checkout commit does not prove what the running processes loaded."

  h "B. Build and runtime"
  found=0
  for f in "$APP_DIR/frontend/.next/BUILD_ID" "$APP_DIR/.next/BUILD_ID"; do
    if [ -f "$f" ]; then ls -l --time-style=long-iso "$f"; found=1; fi
  done
  [ "$found" = 1 ] || echo "NOT VERIFIED: no Next.js BUILD_ID found"
  ls -ld --time-style=long-iso "$APP_DIR/backend/dist" 2>/dev/null || echo "NOT VERIFIED: no backend/dist found"
  if ! have node; then
    for d in /usr/local/bin "$HOME/.local/node/bin" "$HOME"/.nvm/versions/node/*/bin; do [ -x "$d/node" ] && PATH="$d:$PATH"; done
  fi
  echo "node: $(node -v 2>&1)"

  h "C. Services and processes (no command arguments)"
  if have systemctl; then
    for s in nginx postgresql clamav-daemon clamav-freshclam pm2-erp cron; do
      printf '%-20s active=%s enabled=%s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null)" "$(systemctl is-enabled "$s" 2>/dev/null)"
    done
  else
    echo "NOT VERIFIED: systemctl not available"
  fi
  procs="$(ps -eo user=,pid=,ppid=,etimes=,pcpu=,rss=,comm= 2>/dev/null | grep -Ei 'pm2|node|next|nginx|postgres|clam' | grep -v grep | head -40)"
  if [ -n "$procs" ]; then echo "$procs"; else echo "NOT VERIFIED: no matching processes visible"; fi
  echo "--- PM2 log file names and sizes (contents not read here)"
  ls -l --time-style=long-iso "$HOME/.pm2/logs" 2>/dev/null | head -20 || true
  [ -d "$HOME/.pm2/logs" ] || echo "NOT VERIFIED: no PM2 log directory for $(id -un)"
  echo "NOT VERIFIED: PM2 application names and restart counts. The PM2 command is deliberately not used."
  echo "--- listening TCP ports"
  if have ss; then ss -ltn 2>/dev/null; else echo "NOT VERIFIED: ss not available"; fi
  echo "--- local health status (body discarded)"
  printf 'http://127.0.0.1:3000/api/health -> '
  curl -s -o /dev/null -m 5 -w '%{http_code}\n' http://127.0.0.1:3000/api/health 2>/dev/null || echo "NOT VERIFIED: unreachable"
  echo "--- nginx directives"
  directives=""
  for d in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
    [ -d "$d" ] && directives="$directives$(grep -rhE '^[[:space:]]*(server_name|listen|proxy_pass|client_max_body_size|ssl_protocols|proxy_read_timeout|add_header)[[:space:]]' "$d" 2>/dev/null)
"
  done
  if [ -n "$(printf '%s' "$directives" | tr -d '[:space:]')" ]; then
    printf '%s\n' "$directives" | sed 's/^[[:space:]]*//' | grep -v '^$' | redact | sort -u
  else
    echo "NOT VERIFIED: nginx configuration not found or not readable"
  fi

  h "G, H, I. Environment (names only, plus allow-list)"
  if [ -f "$ENV_FILE" ]; then
    echo "$ENV_FILE permissions: $(perms "$ENV_FILE")"
    for f in "$APP_DIR"/.env* "$APP_DIR"/frontend/.env* "$APP_DIR"/backend/.env*; do
      [ -f "$f" ] && [ "${f##*.}" != "example" ] && echo "env file: $f  $(perms "$f")"
    done
    echo "--- non-secret values"
    for k in NODE_ENV APP_ENV APP_URL NOTIFICATIONS_MODE MFA_ENFORCE STORAGE_DRIVER STORAGE_LOCAL_DIR ALLOW_LOCAL_STORAGE_IN_PRODUCTION TRUST_PROXY TRUSTED_PROXY_HOPS APP_TIMEZONE DATABASE_POOLED API_HOST API_PORT; do
      printf '%s=%s\n' "$k" "$(allowed_value "$k")"
    done
    echo "--- set or absent (values never read into output)"
    for k in DATABASE_URL DATABASE_ADMIN_URL INTERNAL_API_SECRET API_INTERNAL_URL CRON_SECRET MFA_ENCRYPTION_KEY PORTAL_SECRET STORAGE_SIGNING_SECRET \
             RESEND_API_KEY EMAIL_FROM SYSTEM_MAIL_HOST SYSTEM_MAIL_PORT SYSTEM_MAIL_USER SYSTEM_MAIL_PASSWORD SYSTEM_MAIL_FROM_EMAIL \
             EMAIL_SMTP_URL_EDX EMAIL_FROM_EDX EMAIL_SMTP_URL_GRD EMAIL_FROM_GRD GALLABOX_API_KEY NOTIFICATIONS_TEST_RECIPIENTS \
             CLAMAV_HOST CLAMAV_PORT SCANNER_URL S3_BUCKET S3_ENDPOINT; do
      if is_set "$k"; then echo "$k: set"; else echo "$k: absent"; fi
    done
    echo "NOT VERIFIED: whether a set value is correct or working. No email or scan is attempted."
  else
    echo "BLOCKED: $ENV_FILE not found. Environment may come from PM2 or systemd, which this check does not read."
  fi

  h "F. Scheduled jobs (schedule and keywords only)"
  summarize_cron() {
    grep -vE '^[[:space:]]*(#|$)' | grep -vE '^[A-Za-z_]+=' | awk '{
      k=""
      if ($0 ~ /api\/cron\/notifications/) k=k" notifications-job"
      if ($0 ~ /api\/cron\/daily/) k=k" daily-job"
      if ($0 ~ /pg_dump|db:backup|backup/) k=k" backup-job"
      if (k=="") k=" other"
      print $1,$2,$3,$4,$5,"->"k
    }'
  }
  echo "--- crontab of $(id -un)"
  if have crontab; then
    jobs="$(crontab -l 2>/dev/null | summarize_cron)"
    if [ -n "$jobs" ]; then echo "$jobs"; else echo "none found for $(id -un)"; fi
  else
    echo "NOT VERIFIED: crontab command not available"
  fi
  echo "--- /etc/crontab and /etc/cron.d, job-related lines only"
  [ -r /etc/crontab ] && cat /etc/crontab /etc/cron.d/* 2>/dev/null | summarize_cron | grep -E 'job' || echo "none found or not readable"
  echo "cron.d names: $(ls /etc/cron.d 2>/dev/null | tr '\n' ' ')"
  echo "daily-script names: $(ls /etc/cron.daily 2>/dev/null | tr '\n' ' ')"
  echo "--- timers"
  if have systemctl; then systemctl list-timers --all --no-pager 2>/dev/null | grep -iE 'erp|backup|pg|postgres' || echo "none matching"; else echo "NOT VERIFIED: systemctl not available"; fi
  echo "BLOCKED: root crontab needs elevated access."
  echo "--- nginx access-log count of job requests"
  l=/var/log/nginx/access.log
  if [ -r "$l" ]; then echo "$l notifications=$(grep -c '/api/cron/notifications' "$l") daily=$(grep -c '/api/cron/daily' "$l")"; else echo "BLOCKED: $l not readable"; fi
  echo "NOT VERIFIED: a configured schedule does not prove that a job succeeded."

  h "E. Backups (names, sizes, dates; no file opened)"
  for d in "$APP_DIR/backups" "$HOME/backups" /var/backups/postgresql /var/backups/erp /backup /backups; do
    if [ -d "$d" ]; then
      echo "--- $d: $(find "$d" -type f 2>/dev/null | wc -l | tr -d ' ') files"
      ls -lt --time-style=long-iso "$d" 2>/dev/null | head -6
    fi
  done
  echo "--- dump files elsewhere under home (depth 4)"
  find "$HOME" -maxdepth 4 -type f \( -name '*.dump' -o -name '*.sql.gz' -o -name '*.backup' \) -not -path '*/node_modules/*' -exec ls -l --time-style=long-iso {} + 2>/dev/null | head -10
  echo "pg_dump: $(pg_dump --version 2>&1)"
  echo "disk:"; df -h "$APP_DIR" 2>/dev/null
  echo "NOT VERIFIED: file names and sizes are not proof of a successful backup or a working restore."
  echo "BLOCKED: provider snapshots in the Hostinger panel are not visible from here."

  h "I. File storage and scanner (no document opened)"
  local_dir="$(allowed_value STORAGE_LOCAL_DIR)"
  found=0
  for d in "$local_dir" "$APP_DIR/$local_dir" "$APP_DIR/.data/storage"; do
    if [ -n "$d" ] && [ -d "$d" ]; then
      echo "$d: $(nice -n 19 du -sh "$d" 2>/dev/null | cut -f1), $(find "$d" -type f 2>/dev/null | wc -l | tr -d ' ') files, permissions $(perms "$d")"; found=1
    fi
  done
  [ "$found" = 1 ] || echo "NOT VERIFIED: no local storage folder found here (may be S3; see STORAGE_DRIVER)"
  ls -l --time-style=long-iso /var/lib/clamav 2>/dev/null | head -5 || true
  [ -d /var/lib/clamav ] || echo "NOT VERIFIED: no ClamAV database folder found"
  echo "NOT VERIFIED: a scanner being configured does not prove that scanning works. No test file is sent."

  h "I. Application logs (counts only, never lines)"
  found=0
  for l in "$HOME"/.pm2/logs/*; do
    [ -f "$l" ] || continue
    found=1
    echo "$(basename "$l"): lines=$(wc -l < "$l") last_change=$(date -r "$l" '+%Y-%m-%d %H:%M' 2>/dev/null) error_level=$(grep -c '"level":"error"' "$l") unhandled=$(grep -cE 'unhandledRejection|uncaughtException' "$l") refused=$(grep -c 'ECONNREFUSED' "$l") mail_fail=$(grep -cE 'Email provider|not configured' "$l")"
  done
  [ "$found" = 1 ] || echo "NOT VERIFIED: no readable PM2 logs"
  if [ -r /var/log/nginx/error.log ]; then echo "nginx error.log lines=$(wc -l < /var/log/nginx/error.log)"; else echo "BLOCKED: nginx error.log not readable"; fi
  if [ -r /var/log/nginx/access.log ]; then
    awk '{c[substr($9,1,1)"xx"]++} END {for (k in c) print "nginx status", k, c[k]}' /var/log/nginx/access.log | sort
  else
    echo "BLOCKED: nginx access.log not readable"
  fi

  h "J. CI and staging indicators"
  ls -d "$APP_DIR/.github" 2>/dev/null || echo "no .github directory in the checkout"
  echo "nginx sites: $(ls /etc/nginx/sites-enabled 2>/dev/null | tr '\n' ' ')"
  echo "home folders named like staging: $(ls /home 2>/dev/null | grep -ci 'stag')"
  echo "NOT VERIFIED: staging hosted elsewhere is not visible from here."

  h "D. Database (DATABASE_URL only; catalogues and statistics only)"
  if ! have node; then echo "BLOCKED: node not found"; return 0; fi
  REQ_FROM="$APP_DIR/backend/package.json"; [ -f "$REQ_FROM" ] || REQ_FROM="$APP_DIR/package.json"
  REQ_FROM="$REQ_FROM" ENV_FILE="$ENV_FILE" node - <<'NODE' 2>&1 | redact
const { createRequire } = require('node:module'); const fs = require('node:fs')
const postgres = createRequire(process.env.REQ_FROM)('postgres')
const env = fs.existsSync(process.env.ENV_FILE) ? fs.readFileSync(process.env.ENV_FILE, 'utf8') : ''
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '')
if (!url) { console.log('BLOCKED: DATABASE_URL not found in the environment file'); process.exit(0) }
const sql = postgres(url, { max: 1, onnotice() {}, connect_timeout: 10, prepare: false,
  connection: { default_transaction_read_only: 'on', application_name: 'stage0-readonly' } })
const read = (text) => sql.begin('read only', (tx) => tx.unsafe(text))
const show = async (label, text) => {
  try { console.log(`${label}: ${JSON.stringify(await read(text))}`) }
  catch (e) { console.log(`${label}: BLOCKED (${e.code || 'error'})`) }
}
;(async () => {
  const [me] = await read(`select current_user who, r.rolsuper, r.rolbypassrls, current_setting('transaction_read_only') ro,
    split_part(version(), ' ', 2) pg, current_database() db from pg_roles r where r.rolname = current_user`)
  console.log('session:', JSON.stringify(me))
  if (me.ro !== 'on') { console.log('STOP: session is not read-only. No further queries.'); return }
  if (me.rolsuper || me.rolbypassrls) { console.log('STOP: DATABASE_URL has superuser or BYPASSRLS. CRITICAL finding. No further queries.'); return }
  await show('table owners', `select tableowner = current_user is_app_role, count(*)::int n from pg_tables where schemaname = 'public' group by 1`)
  await show('rows visible with no signed-in user (expected 0)', `select (select count(*)::int from students) students, (select count(*)::int from tasks) tasks, (select count(*)::int from payment_entries) payments, (select count(*)::int from leads) leads, (select count(*)::int from document_files) files`)
  await show('migration table', `select count(*)::int applied from schema_migrations`)
  await show('schema markers from later migrations', `select c.relname, n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where (n.nspname, c.relname) in (('public','document_merges'),('public','staff_photos'),('public','masterdata_requests'),('auth_private','staff_email_outbox'),('auth_private','portal_email_outbox'),('auth_private','auth_message_outbox')) order by 2, 1`)
  await show('tables by schema', `select n.nspname, count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('public', 'auth_private', 'app') group by 1 order by 1`)
  await show('RLS on public tables', `select count(*) filter (where c.relrowsecurity)::int rls_on, count(*) filter (where c.relforcerowsecurity)::int forced, count(*)::int total from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)
  await show('public tables without RLS', `select coalesce(string_agg(c.relname, ','), 'none') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
  await show('policies', `select count(*)::int n, count(distinct tablename)::int on_tables from pg_policies where schemaname = 'public'`)
  await show('triggers by state (O = enabled, D = disabled)', `select t.tgenabled::text state, count(*)::int n, count(*) filter (where t.tgname like '%audit%')::int audit from pg_trigger t where not t.tgisinternal group by 1`)
  await show('functions in app', `select count(*)::int total, count(*) filter (where p.prosecdef)::int security_definer, count(*) filter (where p.prosecdef and has_function_privilege('public', p.oid, 'EXECUTE'))::int definer_public_exec from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'`)
  await show('login roles', `select rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolcanlogin and rolname !~ '^pg_' order by 1`)
  await show('app role table grants', `select privilege_type, count(distinct table_name)::int tables from information_schema.role_table_grants where grantee = current_user and table_schema = 'public' group by 1 order by 1`)
  await show('app role on audit_logs', `select coalesce(string_agg(privilege_type, ','), 'none') from information_schema.role_table_grants where table_name = 'audit_logs' and grantee = current_user`)
  await show('app role can use auth_private', `select has_schema_privilege(current_user, 'auth_private', 'USAGE') usable`)
  await show('app role can read student phone and passport number', `select has_column_privilege(current_user, 'public.students', 'phone', 'SELECT') phone, has_column_privilege(current_user, 'public.students', 'passport_number', 'SELECT') passport`)
  await show('databases (staging indicator)', `select datname from pg_database where not datistemplate order by 1`)
  await show('settings', `select name, setting from pg_settings where name in ('ssl', 'listen_addresses', 'log_statement', 'password_encryption', 'server_version') order by 1`)
  await show('approximate row counts and activity (statistics, no rows read)', `select s.schemaname, s.relname, s.n_live_tup::int approx_rows, s.n_tup_ins::int inserts, s.n_tup_upd::int updates, s.last_autoanalyze::date from pg_stat_user_tables s where s.relname in ('students','user_profiles','document_files','payment_entries','tasks','audit_logs','notification_messages','staff_email_outbox','portal_email_outbox','auth_message_outbox','security_alerts','passport_validity_rules','verification_rules','attestation_routes','advisory_notices') order by 1, 2`)
  console.log('BLOCKED for this role, because RLS or grants hide them: exact migration list, queue status and age, passport task dates, scan, quarantine and clearance counts, rule contents, last audit date.')
  console.log('NOT VERIFIED: policy presence and the no-user result are not proof of complete company isolation. That needs signed-in tests per company and role.')
})().catch((e) => { console.log(`DATABASE CHECK FAILED (${e.code || 'error'})`) }).finally(() => sql.end({ timeout: 2 }))
NODE

  h "Finished. This check issued no write command."
}
main </dev/null
