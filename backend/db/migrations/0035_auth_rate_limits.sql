-- =============================================================================
-- 0035 Authentication rate limits (finding N-1 of the re-audit of 4612207)
--
-- Root cause: password-reset requests were recorded as FAILED SIGN-INS, and the sign-in lockout was per email only,
-- so anyone who knew a staff email could lock that person out (5 reset requests or 5 wrong passwords), and reset
-- requests had no per-email cap (unlimited reset emails). The check and the recording of a sign-in attempt were also
-- separate steps (race, L-4). The portal password lock was "sticky" (one wrong password after the lock re-locked).
--
-- This migration:
--   * trusted browsers (auth_private.trusted_devices, token HASHES only): failures from browsers that never completed a
--     sign-in (password + two-step code) are counted per email (5 / 15 min, as before); a trusted browser has its own
--     counter (10 / 15 min). The cookie never skips two-step login and is not a credential.
--   * revocation of trusted browsers on every account-security event (password change/reset/admin set, two-step reset or
--     re-enrolment, suspension/termination, sign out everywhere, portal account disabled / password changed), enforced by
--     triggers AND re-checked on every use.
--   * race-free sign-in: per-email lock → count → RESERVE the attempt (counted as a failure) → password check outside the
--     lock → finish. Refused attempts are recorded but no longer extend the lockout.
--   * password-reset requests have their own log and limits (3/hour and 1 per 2 minutes per email; 10/hour per address
--     when known; 100 reset emails/hour system-wide) and NEVER count as failed sign-ins. A new reset link invalidates
--     older ones; any password change invalidates all outstanding links.
--   * staff reset emails go through a dedicated durable queue (auth_private.staff_email_outbox): link encrypted at rest
--     (AES-256-GCM, encrypted by the server), wiped on sent / final failure / skip / expiry (enforced by a CHECK), claimed
--     with SKIP LOCKED, sender functions refuse any signed-in user context.
--   * completing a password reset clears that email's failure count for unrecognised browsers and trusts that browser.
--   * portal password sign-in: same reservation pattern, per-account / per-trusted-browser counters, sticky re-lock fixed.
--   * new security alerts: password-reset requests limited, reset email delivery failed, many failed sign-ins across accounts.
--
-- Not changed: RLS policies, permissions, roles, company data, two-step login tables and functions, existing functions
-- other than the three replaced below (signatures unchanged): app.revoke_user_sessions, app.portal_password_result,
-- app.audit_security_alerts. Old auth functions stay in place, so older application code keeps working.
-- Note: per-schema "alter default privileges ... revoke ... from public" (0010) cannot remove PostgreSQL's global
-- PUBLIC execute default, so EVERY new function below revokes PUBLIC explicitly and grants erp_app only where needed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables (all in auth_private: no access for erp_app; reached only through the functions below)
-- ---------------------------------------------------------------------------
create table auth_private.trusted_devices (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('staff', 'portal')),
  user_id         uuid references user_profiles(id) on delete cascade,
  account_id      uuid references auth_private.student_accounts(id) on delete cascade,
  token_hash      text not null check (token_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of the cookie value; the value itself is never stored
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '90 days',
  revoked_at      timestamptz,
  revoked_reason  text check (revoked_reason is null or length(revoked_reason) <= 60),
  failed_count    int not null default 0,        -- portal browsers: own failure counter
  locked_until    timestamptz,
  check ((kind = 'staff' and user_id is not null and account_id is null) or (kind = 'portal' and account_id is not null and user_id is null))
);
create unique index trusted_devices_token_owner_idx on auth_private.trusted_devices (token_hash, coalesce(user_id, account_id));
create index trusted_devices_user_idx on auth_private.trusted_devices (user_id) where revoked_at is null;
create index trusted_devices_account_idx on auth_private.trusted_devices (account_id) where revoked_at is null;

alter table auth_private.login_attempts
  add column device_id uuid,                                   -- trusted browser used (null = unrecognised browser)
  add column refused   boolean not null default false,         -- refused because of a limit (recorded, not counted)
  add column source    text not null default 'login' check (source in ('login', 'reset_recovery'));
create index login_attempts_time_idx on auth_private.login_attempts (attempted_at desc);
create index login_attempts_device_idx on auth_private.login_attempts (device_id, attempted_at desc) where device_id is not null;

create table auth_private.password_reset_requests (
  id            bigint generated always as identity primary key,
  email         text not null,
  ip            text,
  outcome       text not null check (outcome in ('accepted', 'no_account', 'limited_email', 'limited_ip', 'limited_global')),
  requested_at  timestamptz not null default now()
);
create index password_reset_requests_email_idx on auth_private.password_reset_requests (email, requested_at desc);
create index password_reset_requests_ip_idx on auth_private.password_reset_requests (ip, requested_at desc) where ip is not null;

create table auth_private.staff_email_outbox (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references user_profiles(id) on delete cascade,
  kind             text not null check (kind in ('password_reset')),
  to_address       text not null,
  link_encrypted   text check (link_encrypted is null or link_encrypted ~ '^v1:'),
  status           text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'expired')),
  attempts         int not null default 0,
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  last_error       text check (last_error is null or length(last_error) <= 300),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  finished_at      timestamptz,
  check (status in ('queued', 'sending') or link_encrypted is null)  -- the link can only exist while the email is pending
);
create index staff_email_outbox_due_idx on auth_private.staff_email_outbox (next_attempt_at) where status in ('queued', 'sending');
create index staff_email_outbox_created_idx on auth_private.staff_email_outbox (created_at desc);

revoke all on auth_private.trusted_devices, auth_private.password_reset_requests, auth_private.staff_email_outbox from public;

-- ---------------------------------------------------------------------------
-- Internal helpers (not executable by the application role)
-- ---------------------------------------------------------------------------
create function app.staff_device_valid(p_hash text, p_user uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id from auth_private.trusted_devices d
    join user_profiles u on u.id = d.user_id
    join auth_private.credentials c on c.user_id = d.user_id
    left join auth_private.mfa m on m.user_id = d.user_id
   where p_hash is not null and d.token_hash = p_hash and d.kind = 'staff' and d.user_id = p_user
     and d.revoked_at is null and d.expires_at > now()
     and u.is_active and u.account_status = 'active'
     and d.created_at >= c.password_changed_at                          -- issued after the current password
     and d.created_at >= coalesce(u.status_changed_at, '-infinity')     -- and after the last status change
     and (m.enabled_at is null or d.created_at >= m.enabled_at)         -- and after the current two-step setup
$$;

create function app.portal_device_valid(p_hash text, p_account uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id from auth_private.trusted_devices d join auth_private.student_accounts a on a.id = d.account_id
   where p_hash is not null and d.token_hash = p_hash and d.kind = 'portal' and d.account_id = p_account
     and d.revoked_at is null and d.expires_at > now() and a.status = 'active'
     and d.created_at >= coalesce(a.password_set_at, '-infinity')
$$;

-- keeps at most 20 active trusted browsers per person
create function app.trusted_device_add(p_kind text, p_user uuid, p_account uuid, p_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into auth_private.trusted_devices (kind, user_id, account_id, token_hash) values (p_kind, p_user, p_account, p_hash) returning id into v_id;
  update auth_private.trusted_devices set revoked_at = now(), revoked_reason = 'limit_20'
   where id in (select id from auth_private.trusted_devices
                 where revoked_at is null and (user_id = p_user or account_id = p_account)
                 order by last_used_at desc offset 20);
  return v_id;
end $$;

revoke execute on function app.staff_device_valid(text, uuid), app.portal_device_valid(text, uuid),
  app.trusted_device_add(text, uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Staff sign-in: reserve → check password (application) → finish
-- ---------------------------------------------------------------------------
create function app.auth_begin_attempt(p_email text, p_ip text, p_device_hash text)
returns table (attempt_id bigint, allowed boolean, user_id uuid, password_hash text, trusted boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user uuid; v_hash text; v_dev uuid; v_last timestamptz; v_n int; v_limit int; v_ip_n int := 0; v_id bigint;
begin
  if v_email = '' or length(v_email) > 200 then return query select null::bigint, false, null::uuid, null::text, false; return; end if;
  -- one attempt per email at a time: the count and the reservation cannot race
  perform pg_advisory_xact_lock(hashtextextended('auth-login:' || v_email, 0));
  select l.user_id, l.password_hash into v_user, v_hash from app.auth_login_lookup(v_email) l;
  if v_user is not null then v_dev := app.staff_device_valid(p_device_hash, v_user); end if;
  if v_dev is not null then
    -- trusted browser: its own counter
    select max(attempted_at) into v_last from auth_private.login_attempts where device_id = v_dev and success;
    select count(*) into v_n from auth_private.login_attempts
     where device_id = v_dev and not success and not refused and attempted_at > greatest(now() - interval '15 minutes', coalesce(v_last, '-infinity'));
    v_limit := 10;
  else
    -- every unrecognised browser shares one counter per email (the original 5-failure protection)
    select max(attempted_at) into v_last from auth_private.login_attempts a where lower(a.email) = v_email and a.device_id is null and a.success;
    select count(*) into v_n from auth_private.login_attempts a
     where lower(a.email) = v_email and a.device_id is null and not a.success and not a.refused
       and a.attempted_at > greatest(now() - interval '15 minutes', coalesce(v_last, '-infinity'));
    v_limit := 5;
  end if;
  if p_ip is not null then
    select count(*) into v_ip_n from auth_private.login_attempts a where a.ip = p_ip and not a.success and not a.refused and a.attempted_at > now() - interval '15 minutes';
  end if;
  if v_n >= v_limit or v_ip_n >= 30 then
    insert into auth_private.login_attempts (email, ip, success, device_id, refused) values (v_email, p_ip, false, v_dev, true);
    perform app.audit('login_failed', 'session', null, null, null, null, null, 'denied',
      jsonb_build_object('email', v_email, 'reason', case when v_n >= v_limit then 'locked' else 'address_limit' end, 'trusted_browser', v_dev is not null), v_user);
    return query select null::bigint, false, null::uuid, null::text, v_dev is not null; return;
  end if;
  -- reservation: counts as a failure until the password is confirmed
  insert into auth_private.login_attempts (email, ip, success, device_id) values (v_email, p_ip, false, v_dev) returning id into v_id;
  return query select v_id, true, v_user, v_hash, v_dev is not null;
end $$;

create function app.auth_finish_attempt(p_attempt bigint, p_ok boolean, p_session_token_hash text, p_ttl_hours int, p_ip text, p_user_agent text)
returns table (ok boolean, mfa_pending boolean, must_change_password boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a auth_private.login_attempts%rowtype; v_user uuid; v_must boolean; v_mfa boolean;
begin
  select * into v_a from auth_private.login_attempts where id = p_attempt and not success and not refused and source = 'login'
     and attempted_at > now() - interval '5 minutes' for update;
  if not found then return query select false, false, false; return; end if;
  if p_ok and p_session_token_hash is not null then
    select l.user_id, l.must_change_password into v_user, v_must from app.auth_login_lookup(v_a.email) l;
  end if;
  if v_user is null then
    perform app.audit('login_failed', 'session', null, null, null, null, null, 'denied',
      jsonb_build_object('email', v_a.email, 'trusted_browser', v_a.device_id is not null),
      (select l.user_id from app.auth_login_lookup(v_a.email) l));
    return query select false, false, false; return;
  end if;
  v_mfa := app.auth_mfa_enabled(v_user);
  perform app.auth_create_session(v_user, p_session_token_hash, p_ttl_hours, p_ip, coalesce(p_user_agent, ''), v_mfa);
  update auth_private.login_attempts set success = true where id = v_a.id;
  if v_a.device_id is not null then update auth_private.trusted_devices set last_used_at = now() where id = v_a.device_id; end if;
  perform app.audit('login', 'session', null, null, null, null, null, 'success',
    jsonb_build_object('email', v_a.email, 'trusted_browser', v_a.device_id is not null), v_user);
  return query select true, v_mfa, coalesce(v_must, false);
end $$;

-- After a COMPLETE sign-in (password + two-step code): keep or add the browser as trusted.
-- Only for accounts with two-step login switched on, and only for a session that has just finished its two-step step.
create function app.auth_trust_device_after_mfa(p_session_token_hash text, p_current_hash text, p_new_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_dev uuid;
begin
  select s.user_id into v_user from auth_private.sessions s
    join auth_private.mfa m on m.user_id = s.user_id and m.enabled_at is not null
    join user_profiles u on u.id = s.user_id and u.is_active and u.account_status = 'active'
   where s.token_hash = p_session_token_hash and not s.mfa_pending and s.revoked_at is null and s.expires_at > now()
     and s.created_at > now() - interval '15 minutes';
  if v_user is null then return null; end if;
  v_dev := app.staff_device_valid(p_current_hash, v_user);
  if v_dev is not null then
    update auth_private.trusted_devices set last_used_at = now() where id = v_dev;
    return 'kept';
  end if;
  if p_new_hash is null or p_new_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  perform app.trusted_device_add('staff', v_user, null, p_new_hash);
  perform app.audit('trusted_browser_added', 'user_profiles', v_user::text, null, null, null, null, 'success', jsonb_build_object('via', 'two_step_sign_in'), v_user);
  return 'added';
end $$;

-- ---------------------------------------------------------------------------
-- Staff password reset: limits, token, durable queue (no failed-sign-in records)
-- ---------------------------------------------------------------------------
create function app.auth_request_reset_limited(p_email text, p_ip text, p_token_hash text, p_link_encrypted text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user user_profiles%rowtype; v_outcome text; v_n int;
begin
  if v_email = '' or length(v_email) > 200 then return; end if;
  if p_link_encrypted is null or p_link_encrypted !~ '^v1:' then raise exception 'the reset link must be encrypted' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('auth-reset:' || v_email, 0));
  select * into v_user from user_profiles where lower(email) = v_email and is_active;
  if (select count(*) from auth_private.password_reset_requests where email = v_email and outcome = 'accepted' and requested_at > now() - interval '1 hour') >= 3
     or exists (select 1 from auth_private.password_reset_requests where email = v_email and outcome = 'accepted' and requested_at > now() - interval '2 minutes') then
    v_outcome := 'limited_email';
  elsif p_ip is not null and (select count(*) from auth_private.password_reset_requests where ip = p_ip and requested_at > now() - interval '1 hour') >= 10 then
    v_outcome := 'limited_ip';
  elsif v_user.id is null then
    v_outcome := 'no_account';
  else
    select count(*) into v_n from auth_private.staff_email_outbox where kind = 'password_reset' and created_at > now() - interval '1 hour';
    v_outcome := case when v_n >= 100 then 'limited_global' else 'accepted' end;
  end if;
  insert into auth_private.password_reset_requests (email, ip, outcome) values (v_email, p_ip, v_outcome);
  if v_outcome = 'accepted' then
    insert into auth_private.password_resets (user_id, token_hash, requested_via, expires_at)
    values (v_user.id, p_token_hash, 'self_service', now() + interval '1 hour');
    insert into auth_private.staff_email_outbox (user_id, kind, to_address, link_encrypted, expires_at)
    values (v_user.id, 'password_reset', v_user.email, p_link_encrypted, now() + interval '1 hour');
    perform app.audit('password_reset_requested', 'user_profiles', v_user.id::text, null, null, null, null, 'success', jsonb_build_object('queued', true), v_user.id);
  elsif v_outcome = 'no_account' then
    perform app.audit('password_reset_requested', 'user_profiles', null, null, null, null, null, 'denied', jsonb_build_object('email', v_email, 'reason', 'no_account'), null);
  else
    perform app.audit('password_reset_rate_limited', 'user_profiles', v_user.id::text, null, null, null, null, 'denied',
      jsonb_build_object('email', v_email, 'reason', replace(v_outcome, 'limited_', '')), v_user.id);
  end if;
end $$;

-- Completing a reset: the existing reset (password + revocations), then RECOVERY: clears this email's failure count for
-- unrecognised browsers and trusts the browser that completed it (proves control of the mailbox; two-step still required).
create function app.auth_complete_reset_trusted(p_token_hash text, p_password_hash text, p_device_hash text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_email text;
begin
  v_user := app.auth_complete_reset(p_token_hash, p_password_hash);
  if v_user is null then return null; end if;
  select lower(email) into v_email from user_profiles where id = v_user;
  insert into auth_private.login_attempts (email, ip, success, source) values (v_email, null, true, 'reset_recovery');
  if p_device_hash ~ '^[0-9a-f]{64}$' and exists (select 1 from user_profiles where id = v_user and is_active and account_status = 'active') then
    perform app.trusted_device_add('staff', v_user, null, p_device_hash);
  end if;
  perform app.audit('lockout_cleared_by_password_reset', 'user_profiles', v_user::text, null, null, null, null, 'success',
    jsonb_build_object('browser_trusted', p_device_hash ~ '^[0-9a-f]{64}$'), v_user);
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- Durable staff email queue: sender functions (system context only)
-- ---------------------------------------------------------------------------
create function app.staff_email_claim(p_limit int)
returns table (id uuid, to_address text, full_name text, kind text, link_encrypted text, attempts int)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  update auth_private.staff_email_outbox o set status = 'expired', link_encrypted = null, finished_at = now()
   where o.status in ('queued', 'sending') and o.expires_at <= now();
  update auth_private.staff_email_outbox o set status = 'skipped', link_encrypted = null, finished_at = now(), last_error = 'account no longer active'
   where o.status = 'queued' and not exists (select 1 from user_profiles u where u.id = o.user_id and u.is_active);
  -- a sender that crashed mid-send: the message becomes due again (its attempt is already counted)
  update auth_private.staff_email_outbox o set status = 'queued' where o.status = 'sending' and o.claimed_at < now() - interval '5 minutes';
  return query
    with c as (select x.id from auth_private.staff_email_outbox x where x.status = 'queued' and x.next_attempt_at <= now()
                order by x.next_attempt_at limit least(greatest(coalesce(p_limit, 25), 1), 100) for update skip locked)
    update auth_private.staff_email_outbox o set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from c, user_profiles u
     where o.id = c.id and u.id = o.user_id
    returning o.id, o.to_address, u.full_name, o.kind, o.link_encrypted, o.attempts;
end $$;

create function app.staff_email_finish(p_id uuid, p_result text, p_error text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o auth_private.staff_email_outbox%rowtype; v_final text;
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  if p_result not in ('sent', 'retry', 'failed', 'skipped') then raise exception 'invalid result' using errcode = '22023'; end if;
  select * into v_o from auth_private.staff_email_outbox where id = p_id and status = 'sending' for update;
  if not found then return null; end if;
  v_final := case
    when p_result = 'retry' and (v_o.attempts >= 5 or now() + make_interval(secs => 30 * power(2, v_o.attempts - 1)::int) >= v_o.expires_at) then 'failed'
    when p_result = 'retry' then 'queued'
    else p_result end;
  if v_final = 'queued' then
    update auth_private.staff_email_outbox set status = 'queued', last_error = left(p_error, 300),
           next_attempt_at = now() + make_interval(secs => 30 * power(2, v_o.attempts - 1)::int) where id = p_id;
  else
    update auth_private.staff_email_outbox set status = v_final, link_encrypted = null, finished_at = now(),
           last_error = case when v_final = 'sent' then null else left(p_error, 300) end where id = p_id;
    if v_final = 'failed' then
      perform app.audit('password_reset_email_failed', 'user_profiles', v_o.user_id::text, null, null, null, null, 'failure',
        jsonb_build_object('attempts', v_o.attempts, 'error', left(p_error, 200)), v_o.user_id);
    elsif v_final = 'sent' then
      perform app.audit('password_reset_email_sent', 'user_profiles', v_o.user_id::text, null, null, null, null, 'success',
        jsonb_build_object('attempts', v_o.attempts), v_o.user_id);
    end if;
  end if;
  return v_final;
end $$;

-- Daily housekeeping of authentication working data (never the audit log)
create function app.auth_housekeeping() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a int; b int; c int;
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  delete from auth_private.trusted_devices where coalesce(revoked_at, expires_at) < now() - interval '30 days';
  get diagnostics a = row_count;
  delete from auth_private.password_reset_requests where requested_at < now() - interval '90 days';
  get diagnostics b = row_count;
  delete from auth_private.staff_email_outbox where status in ('sent', 'failed', 'skipped', 'expired') and created_at < now() - interval '30 days';
  get diagnostics c = row_count;
  return jsonb_build_object('trusted_browsers_removed', a, 'reset_requests_removed', b, 'emails_removed', c);
end $$;

-- ---------------------------------------------------------------------------
-- Portal password sign-in: reserve → check (application) → finish
-- ---------------------------------------------------------------------------
create function app.portal_password_begin(p_identifier text, p_device_hash text)
returns table (account_id uuid, password_hash text, trusted boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_dev uuid; v_d auth_private.trusted_devices%rowtype; v_a auth_private.student_accounts%rowtype;
begin
  for r in select a.id from auth_private.student_accounts a join students s on s.id = a.student_id
            where a.status = 'active' and s.status <> 'merged' and s.archived_at is null
              and (upper(s.student_code) = upper(btrim(p_identifier))
                   or (position('@' in p_identifier) > 0 and s.email_status = 'verified' and s.email_normalized = lower(btrim(p_identifier))))
            order by a.id limit 5 loop
    select * into v_a from auth_private.student_accounts where id = r.id for update;   -- serialises attempts per account
    v_dev := app.portal_device_valid(p_device_hash, r.id);
    if v_dev is not null then
      select * into v_d from auth_private.trusted_devices where id = v_dev for update;
      if v_d.locked_until is not null and v_d.locked_until <= now() then
        update auth_private.trusted_devices set failed_count = 0, locked_until = null where id = v_dev; v_d.failed_count := 0; v_d.locked_until := null;
      end if;
      if v_d.locked_until > now() then return query select r.id, null::text, true; continue; end if;
      if v_d.failed_count >= 10 then
        update auth_private.trusted_devices set locked_until = now() + interval '15 minutes' where id = v_dev;
        return query select r.id, null::text, true; continue;
      end if;
      update auth_private.trusted_devices set failed_count = failed_count + 1 where id = v_dev;
      return query select r.id, v_a.password_hash, true;
    else
      if v_a.locked_until is not null and v_a.locked_until <= now() then   -- an expired lock starts a fresh window (sticky re-lock fixed)
        update auth_private.student_accounts set failed_attempts = 0, locked_until = null where id = r.id; v_a.failed_attempts := 0; v_a.locked_until := null;
      end if;
      if v_a.locked_until > now() then return query select r.id, null::text, false; continue; end if;
      if v_a.failed_attempts >= 5 then
        update auth_private.student_accounts set locked_until = now() + interval '15 minutes' where id = r.id;
        return query select r.id, null::text, false; continue;
      end if;
      update auth_private.student_accounts set failed_attempts = failed_attempts + 1 where id = r.id;
      return query select r.id, v_a.password_hash, false;
    end if;
  end loop;
end $$;

create function app.portal_password_finish(p_identifier text, p_ok uuid[], p_failed uuid[], p_device_hash text, p_token_hash text,
                                           p_ip text, p_user_agent text, p_new_device_hash text)
returns table (ok boolean, device_added boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_students uuid[]; v_acc uuid; v_dev uuid; v_added boolean := false; v_first uuid;
begin
  -- failures were already counted when reserved; locks are set when the limit is reached
  update auth_private.student_accounts set locked_until = now() + interval '15 minutes'
   where id = any(coalesce(p_failed, '{}')) and status = 'active' and failed_attempts >= 5 and coalesce(locked_until, '-infinity') <= now()
     and app.portal_device_valid(p_device_hash, id) is null;
  update auth_private.trusted_devices set locked_until = now() + interval '15 minutes'
   where kind = 'portal' and account_id = any(coalesce(p_failed, '{}')) and token_hash = p_device_hash and failed_count >= 10
     and coalesce(locked_until, '-infinity') <= now();
  if coalesce(cardinality(p_ok), 0) = 0 then
    perform app.audit('portal_login_failed', 'portal', null, null, null, null, null, 'denied',
                      jsonb_build_object('ip', p_ip, 'method', 'password', 'identifier', left(lower(btrim(p_identifier)), 3) || '…'));
    return query select false, false; return;
  end if;
  foreach v_acc in array p_ok loop
    v_dev := app.portal_device_valid(p_device_hash, v_acc);
    if v_dev is not null then
      update auth_private.trusted_devices set failed_count = 0, locked_until = null, last_used_at = now() where id = v_dev and coalesce(locked_until, '-infinity') <= now();
      update auth_private.student_accounts set last_login_at = now() where id = v_acc and status = 'active';
    else
      update auth_private.student_accounts set failed_attempts = 0, locked_until = null, last_login_at = now()
       where id = v_acc and status = 'active' and coalesce(locked_until, '-infinity') <= now();
      if not v_added and p_new_device_hash ~ '^[0-9a-f]{64}$' and exists (select 1 from auth_private.student_accounts where id = v_acc and status = 'active') then
        perform app.trusted_device_add('portal', null, v_acc, p_new_device_hash);
        v_added := true; v_first := v_acc;
      end if;
    end if;
  end loop;
  select array_agg(student_id) into v_students from auth_private.student_accounts where id = any(p_ok) and status = 'active';
  if coalesce(cardinality(v_students), 0) = 0 then return query select false, false; return; end if;
  insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id, ip, user_agent)
  values (p_token_hash, v_students, case when cardinality(v_students) = 1 then v_students[1] end, p_ip, left(p_user_agent, 300));
  perform app.audit('portal_login', 'portal', null, null, v_students[1], null, null, 'success',
                    jsonb_build_object('ip', p_ip, 'method', 'password', 'trusted_browser', p_device_hash is not null and not v_added));
  return query select true, v_added;
end $$;

-- Portal password set / reset with recovery: the existing function, then trust the browser that completed it
create function app.portal_set_password_trusted(p_token_hash text, p_password_hash text, p_device_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_acc uuid;
begin
  select account_id into v_acc from auth_private.student_account_tokens where token_hash = p_token_hash;
  v_code := app.portal_set_password(p_token_hash, p_password_hash);
  if v_code is null then return null; end if;
  if p_device_hash ~ '^[0-9a-f]{64}$' then perform app.trusted_device_add('portal', null, v_acc, p_device_hash); end if;
  return v_code;
end $$;

-- ---------------------------------------------------------------------------
-- Revocation triggers (account-security events)
-- ---------------------------------------------------------------------------
create function app.revoke_trusted_on_credentials() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.password_hash is distinct from old.password_hash then
    update auth_private.trusted_devices set revoked_at = now(), revoked_reason = 'password_changed' where user_id = new.user_id and revoked_at is null;
    -- any password change also ends every outstanding reset link
    update auth_private.password_resets set used_at = now() where user_id = new.user_id and used_at is null;
  end if;
  return null;
end $$;
create trigger credentials_revoke_trusted after update of password_hash on auth_private.credentials
  for each row execute function app.revoke_trusted_on_credentials();

create function app.revoke_trusted_on_mfa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' or new.enabled_at is distinct from old.enabled_at then
    update auth_private.trusted_devices set revoked_at = now(), revoked_reason = 'two_step_changed'
     where user_id = coalesce(new.user_id, old.user_id) and revoked_at is null;
  end if;
  return null;
end $$;
create trigger mfa_revoke_trusted after update of enabled_at or delete on auth_private.mfa
  for each row execute function app.revoke_trusted_on_mfa();

create function app.revoke_trusted_on_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.account_status is distinct from old.account_status and new.account_status <> 'active' then
    update auth_private.trusted_devices set revoked_at = now(), revoked_reason = 'account_' || new.account_status where user_id = new.id and revoked_at is null;
  end if;
  return null;
end $$;
create trigger user_profiles_revoke_trusted after update of account_status on user_profiles
  for each row execute function app.revoke_trusted_on_status();

create function app.revoke_trusted_on_portal_account() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status or new.password_hash is distinct from old.password_hash then
    update auth_private.trusted_devices set revoked_at = now(), revoked_reason = 'portal_account_changed' where account_id = new.id and revoked_at is null;
  end if;
  return null;
end $$;
create trigger student_accounts_revoke_trusted after update of status, password_hash on auth_private.student_accounts
  for each row execute function app.revoke_trusted_on_portal_account();

-- a new reset link makes older unused links of the same person invalid
create function app.password_reset_supersede() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update auth_private.password_resets set used_at = now() where user_id = new.user_id and id <> new.id and used_at is null;
  return null;
end $$;
create trigger password_resets_supersede after insert on auth_private.password_resets
  for each row execute function app.password_reset_supersede();

revoke execute on function app.revoke_trusted_on_credentials(), app.revoke_trusted_on_mfa(), app.revoke_trusted_on_status(),
  app.revoke_trusted_on_portal_account(), app.password_reset_supersede() from public;

-- ---------------------------------------------------------------------------
-- Replaced function 1/3: sign out everywhere also revokes trusted browsers (signature unchanged)
-- ---------------------------------------------------------------------------
create or replace function app.revoke_user_sessions(p_user uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; d int;
begin
  if app.current_user_id() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_user <> app.current_user_id() and not app.can_administer_user(p_user) then
    raise exception 'permission denied: this account is outside your authority' using errcode = '42501';
  end if;
  update auth_private.sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  get diagnostics n = row_count;
  update auth_private.trusted_devices set revoked_at = now(), revoked_reason = 'signed_out_everywhere' where user_id = p_user and revoked_at is null;
  get diagnostics d = row_count;
  perform app.audit('sessions_revoked', 'user_profiles', p_user::text, null, null, null, null, 'success',
    jsonb_build_object('sessions', n, 'own_account', p_user = app.current_user_id(), 'trusted_browsers', d));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Replaced function 2/3: legacy portal password outcome – sticky re-lock fixed, attempts while locked no longer extend
-- ---------------------------------------------------------------------------
create or replace function app.portal_password_result(p_identifier text, p_ok uuid[], p_failed uuid[], p_token_hash text, p_ip text, p_user_agent text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_students uuid[];
begin
  update auth_private.student_accounts set
         failed_attempts = case when locked_until is not null and locked_until <= now() then 1 else failed_attempts + 1 end,
         locked_until = case when locked_until is not null and locked_until <= now() then null
                             when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
   where id = any(coalesce(p_failed, '{}')) and status = 'active' and coalesce(locked_until, '-infinity') <= now();
  if coalesce(cardinality(p_ok), 0) = 0 then
    perform app.audit('portal_login_failed', 'portal', null, null, null, null, null, 'denied',
                      jsonb_build_object('ip', p_ip, 'method', 'password', 'identifier', left(lower(btrim(p_identifier)), 3) || '…'));
    return false;
  end if;
  update auth_private.student_accounts set failed_attempts = 0, locked_until = null, last_login_at = now()
   where id = any(p_ok) and status = 'active' and coalesce(locked_until, '-infinity') <= now();
  select array_agg(student_id) into v_students from auth_private.student_accounts where id = any(p_ok) and status = 'active';
  if coalesce(cardinality(v_students), 0) = 0 then return false; end if;
  insert into auth_private.portal_sessions (token_hash, student_ids, active_student_id, ip, user_agent)
  values (p_token_hash, v_students, case when cardinality(v_students) = 1 then v_students[1] end, p_ip, left(p_user_agent, 300));
  perform app.audit('portal_login', 'portal', null, null, v_students[1], null, null, 'success', jsonb_build_object('ip', p_ip, 'method', 'password'));
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Replaced function 3/3: security alerts (0034 + three new alerts)
-- ---------------------------------------------------------------------------
create or replace function app.audit_security_alerts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; v_email text; v_sens boolean; v_name text; v_views int; v_downloads int; v_accounts int; v_reason text;
begin
  if new.action = 'login_failed' then
    v_email := new.metadata ->> 'email';
    select count(*) into n from auth_private.login_attempts where lower(email) = v_email and not success and attempted_at > now() - interval '15 minutes';
    if n >= 5 then
      perform app.raise_security_alert('repeated_failed_logins', case when n >= 10 then 'high' else 'warning' end,
        'Repeated failed sign-ins for ' || v_email, 'email:' || v_email, jsonb_build_object('email', v_email, 'failures_15_min', n, 'ip', new.request_ip), null, null);
    end if;
    if new.request_ip is not null then
      select count(*) into n from auth_private.login_attempts where ip = new.request_ip and not success and attempted_at > now() - interval '15 minutes';
      if n >= 20 then
        perform app.raise_security_alert('failed_logins_from_ip', 'high', 'Many failed sign-ins from one address', 'ip:' || new.request_ip,
          jsonb_build_object('ip', new.request_ip, 'failures_15_min', n), null, null);
      end if;
    end if;
    -- distributed guessing (many addresses / no trusted proxy): many accounts failing at once, system-wide. Alert only, never a block.
    select count(*), count(distinct lower(email)) into n, v_accounts from auth_private.login_attempts
     where not success and source = 'login' and attempted_at > now() - interval '15 minutes';
    if n >= 100 and v_accounts >= 20 then
      perform app.raise_security_alert('failed_logins_many_accounts', 'high', 'Many failed sign-ins across accounts', 'global',
        jsonb_build_object('failures_15_min', n, 'accounts_15_min', v_accounts), null, null);
    end if;
  elsif new.action = 'password_reset_rate_limited' then
    v_email := new.metadata ->> 'email'; v_reason := new.metadata ->> 'reason';
    perform app.raise_security_alert('password_reset_limited', case when v_reason = 'global' then 'high' else 'warning' end,
      case when v_reason = 'global' then 'Password-reset email limit reached (system-wide)' else 'Password-reset requests limited' end,
      case v_reason when 'global' then 'global' when 'ip' then 'ip:' || coalesce(new.request_ip, '?') else 'email:' || coalesce(v_email, '?') end,
      jsonb_build_object('email', v_email, 'reason', v_reason, 'ip', new.request_ip), null, null);
  elsif new.action = 'password_reset_email_failed' then
    perform app.raise_security_alert('password_reset_email_failed', 'warning', 'Password-reset email could not be delivered', 'user:' || coalesce(new.entity_id, '?'),
      jsonb_build_object('attempts', new.metadata -> 'attempts', 'error', new.metadata ->> 'error'), new.actor_user_id, null);
  elsif new.action = 'mfa_failed' then
    perform app.raise_security_alert('mfa_failures', 'warning', 'Wrong two-factor codes entered', 'user:' || coalesce(new.actor_user_id::text, '?'),
      jsonb_build_object('ip', new.request_ip), new.actor_user_id, null);
  elsif new.action = 'export' then
    if new.outcome = 'denied' then
      perform app.raise_security_alert('export_denied', 'warning', 'Export refused (no permission)', 'user:' || coalesce(new.actor_user_id::text, '?'),
        jsonb_build_object('report', new.entity_id), new.actor_user_id, new.org_id);
    else
      if coalesce((new.metadata ->> 'rows')::int, 0) >= 500 then
        perform app.raise_security_alert('large_export', 'high', 'Large data export (' || (new.metadata ->> 'rows') || ' rows)', 'user:' || coalesce(new.actor_user_id::text, '?'),
          jsonb_build_object('report', new.entity_id, 'rows', (new.metadata ->> 'rows')::int, 'pii', new.metadata -> 'pii', 'finance', new.metadata -> 'finance'), new.actor_user_id, new.org_id);
      end if;
      select count(*) into n from audit_logs where action = 'export' and outcome = 'success' and actor_user_id = new.actor_user_id and occurred_at > now() - interval '1 hour';
      if n >= 10 then
        perform app.raise_security_alert('frequent_exports', 'warning', 'Unusually many exports by one person', 'user:' || coalesce(new.actor_user_id::text, '?'),
          jsonb_build_object('exports_last_hour', n), new.actor_user_id, new.org_id);
      end if;
    end if;
  elsif new.action in ('file_download', 'file_access') and new.outcome = 'success' and new.actor_user_id is not null then
    -- staff: in-app VIEWS and DOWNLOADS of document files both count (one audit row per access, so nothing is counted twice)
    select count(*) filter (where action = 'file_access'), count(*) filter (where action = 'file_download') into v_views, v_downloads
      from audit_logs where action in ('file_download', 'file_access') and outcome = 'success' and actor_user_id = new.actor_user_id
       and occurred_at > now() - interval '1 hour';
    if v_views + v_downloads >= 100 then
      perform app.raise_security_alert('bulk_downloads', 'high', 'Unusually many document views or downloads by one person', 'user:' || new.actor_user_id,
        jsonb_build_object('views_last_hour', v_views, 'downloads_last_hour', v_downloads, 'total_last_hour', v_views + v_downloads), new.actor_user_id, new.org_id);
    end if;
  elsif new.action = 'portal_download' and new.outcome = 'success' and new.student_id is not null then
    -- student/parent portal: downloads through one student's portal access (no staff actor)
    select count(*) into n from audit_logs where action = 'portal_download' and outcome = 'success' and student_id = new.student_id
       and occurred_at > now() - interval '1 hour';
    if n >= 100 then
      perform app.raise_security_alert('bulk_portal_downloads', 'high', 'Unusually many document downloads through one student portal account', 'portal-student:' || new.student_id,
        jsonb_build_object('portal_downloads_last_hour', n, 'student_id', new.student_id), null, new.org_id);
    end if;
  elsif new.action = 'malware_detected' then
    perform app.raise_security_alert('malware_detected', 'critical', 'Malware detected in an uploaded file (quarantined)', 'file:' || coalesce(new.entity_id, '?'),
      jsonb_build_object('entity', new.entity_type, 'id', new.entity_id, 'detail', new.after_data -> 'detail', 'student_id', new.student_id), new.actor_user_id, new.org_id);
  elsif new.action = 'file_manual_security_clearance' then
    perform app.raise_security_alert('manual_clearance', 'info', 'Files released by MANUAL security clearance (not virus-scanned)', 'clearer:' || coalesce(new.actor_user_id::text, '?'),
      jsonb_build_object('last_file', new.entity_id, 'reason', new.after_data -> 'reason', 'student_id', new.student_id), new.actor_user_id, new.org_id);
  elsif new.entity_type = 'role_permissions' and new.action in ('grant', 'revoke') then
    v_name := new.after_data ->> 'permission';
    select is_sensitive into v_sens from permissions where key = v_name;
    perform app.raise_security_alert('permission_change', case when v_sens then 'high' else 'warning' end,
      'Role permission ' || case when new.action = 'grant' then 'granted' else 'removed' end || ': ' || coalesce(v_name, '?'),
      'role:' || coalesce(new.entity_id, '?'),
      jsonb_build_object('permission', v_name, 'change', new.action, 'role_id', new.entity_id), new.actor_user_id, new.org_id);
  elsif new.entity_type = 'organization_memberships' and (new.action = 'insert'
        or (new.action = 'update' and (new.before_data ->> 'role_id' is distinct from new.after_data ->> 'role_id'
                                       or new.before_data ->> 'is_active' is distinct from new.after_data ->> 'is_active'))) then
    perform app.raise_security_alert('role_assignment', 'warning', 'Staff role or company access changed', 'user:' || coalesce(new.after_data ->> 'user_id', '?'),
      jsonb_build_object('user_id', new.after_data ->> 'user_id', 'from_role', new.before_data ->> 'role_id', 'to_role', new.after_data ->> 'role_id',
                         'active', new.after_data ->> 'is_active'), new.actor_user_id, new.org_id);
  elsif new.action = 'md_role_granted' then
    perform app.raise_security_alert('md_role_granted', 'critical', 'MD (super-admin) role granted', 'user:' || new.entity_id,
      new.metadata, new.actor_user_id, new.org_id);
  elsif new.action = 'mfa_reset_by_admin' then
    perform app.raise_security_alert('mfa_reset', 'high', 'Two-factor login reset by an administrator', 'user:' || new.entity_id,
      jsonb_build_object('reason', new.metadata ->> 'reason'), new.actor_user_id, null);
  elsif new.action = 'staff_status_changed' then
    perform app.raise_security_alert('staff_status_changed', 'info', 'Staff account ' || coalesce(new.after_data ->> 'account_status', 'changed'), 'user:' || new.entity_id,
      new.after_data, new.actor_user_id, null);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Execute permissions: PUBLIC never; erp_app only for what the application calls
-- ---------------------------------------------------------------------------
revoke execute on function
  app.auth_begin_attempt(text, text, text), app.auth_finish_attempt(bigint, boolean, text, int, text, text),
  app.auth_trust_device_after_mfa(text, text, text), app.auth_request_reset_limited(text, text, text, text),
  app.auth_complete_reset_trusted(text, text, text), app.staff_email_claim(int), app.staff_email_finish(uuid, text, text),
  app.auth_housekeeping(), app.portal_password_begin(text, text),
  app.portal_password_finish(text, uuid[], uuid[], text, text, text, text, text), app.portal_set_password_trusted(text, text, text)
from public;
grant execute on function
  app.auth_begin_attempt(text, text, text), app.auth_finish_attempt(bigint, boolean, text, int, text, text),
  app.auth_trust_device_after_mfa(text, text, text), app.auth_request_reset_limited(text, text, text, text),
  app.auth_complete_reset_trusted(text, text, text), app.staff_email_claim(int), app.staff_email_finish(uuid, text, text),
  app.auth_housekeeping(), app.portal_password_begin(text, text),
  app.portal_password_finish(text, uuid[], uuid[], text, text, text, text, text), app.portal_set_password_trusted(text, text, text)
to erp_app;
