-- =============================================================================
-- 0037 Secure queue for student-portal sign-in codes and email-verification links (finding N-8)
--
-- Finding: portal sign-in codes (email and WhatsApp) and email-verification links were queued in notification_messages
-- with the secret in params; the sender stored the rendered message back. Masking covered only the body and params, and
-- only once a message was sent / failed / skipped: the code stayed readable in TEST mode, while waiting for a RETRY, and
-- in the email SUBJECT ("Your sign-in code: …") in every status, including "sent". Staff holding notifications.view
-- (MD, Manager) could read it in Messages and sign in to the portal as the student, or verify a student's address.
--
-- This migration:
--   * auth_private.auth_message_outbox: dedicated durable queue. The secret (code or link) is stored ENCRYPTED with a
--     separate HKDF-derived key (AES-256-GCM, server side; the database refuses anything that is not an "am1" cipher
--     text), tied to its challenge / verification record, and WIPED (set to NULL) as soon as the message is sent, fails
--     finally, is skipped, recorded in test mode, expires or is revoked (enforced by a CHECK). Nobody but the owner can
--     read the table (no USAGE on auth_private for the application role).
--   * delivery: claimed with SKIP LOCKED (no duplicates), retry with back-off, never past expiry; every claim re-checks
--     that the code / link is still valid, so an expired, used or replaced secret is never (re)sent. Sender functions
--     refuse any signed-in user context. Provider errors are stored with digits and tokens masked.
--   * revocation (triggers): a sign-in code used, its 5 attempts spent, or replaced by a newer code for the same
--     identifier; a verification link used or replaced; the student's email or phone changed.
--   * app.portal_request_code / app.request_email_verification (signatures unchanged) accept only the encrypted secret
--     and queue in the secure outbox; rate limits and the challenge / verification records are unchanged.
--   * notification_messages: the two kinds can no longer be inserted or re-queued; any update strips the secret from
--     params, body and subject; the messages_select policy hides all four authentication kinds from every staff branch.
--   * legacy rows: existing messages of the two kinds are scrubbed (code / link removed from params, body and subject;
--     pending ones skipped) and the still-open codes / links of the affected students invalidated. Counted in the audit log.
--   * app.auth_message_log: staff with notifications.view see REDACTED status rows (never the secret or rendered text),
--     company by company.
--
-- Not changed: any other policy, permission, role, company data, rate limit, two-step login, audit-log or alert function,
-- the notification dispatcher's handling of other messages, and every 0035 / 0036 object.
-- Replaced (signatures unchanged): app.portal_request_code, app.request_email_verification, policy messages_select.
-- =============================================================================

create table auth_private.auth_message_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id),
  student_id          uuid not null references students(id),
  kind                text not null check (kind in ('portal_login_code', 'email_verification')),
  channel             text not null check (channel in ('email', 'whatsapp')),
  challenge_id        uuid unique references auth_private.portal_challenges(id),
  verification_id     uuid unique references auth_private.email_verifications(id),
  template_id         uuid not null references notification_templates(id),
  to_address          text not null,
  secret_encrypted    text check (secret_encrypted is null
                                  or secret_encrypted ~ '^am1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$'),
  status              text not null default 'queued'
                      check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'test', 'expired', 'revoked')),
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null default now(),
  claimed_at          timestamptz,
  provider            text,
  provider_message_id text,
  last_error          text check (last_error is null or length(last_error) <= 300),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  finished_at         timestamptz,
  check ((kind = 'portal_login_code' and challenge_id is not null and verification_id is null)
         or (kind = 'email_verification' and verification_id is not null and challenge_id is null and channel = 'email')),
  check (status in ('queued', 'sending') or secret_encrypted is null)  -- the secret can only exist while pending
);
create index auth_message_outbox_due_idx on auth_private.auth_message_outbox (next_attempt_at) where status in ('queued', 'sending');
create index auth_message_outbox_student_idx on auth_private.auth_message_outbox (student_id, created_at desc);
create index auth_message_outbox_org_idx on auth_private.auth_message_outbox (org_id, created_at desc);
revoke all on auth_private.auth_message_outbox from public;

-- ---------------------------------------------------------------------------
-- Internal helpers (not executable by the application role)
-- ---------------------------------------------------------------------------
create function app.auth_secret_cipher_ok(p text) returns boolean
language sql immutable security definer set search_path = public, pg_temp as $$
  select coalesce(p ~ '^am1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$', false)
$$;

-- digits and tokens never stay in a stored error (a provider may echo the request)
create function app.auth_mask_error(p text) returns text
language sql immutable security definer set search_path = public, pg_temp as $$
  select left(regexp_replace(regexp_replace(regexp_replace(p, '\d{4,}', '••••', 'g'), 'token=[A-Za-z0-9_-]+', 'token=••••', 'g'),
                             'am1:[A-Za-z0-9+/=:]+', 'am1:••••', 'g'), 300)
$$;

-- a code that is used or whose attempts are spent takes its queued message with it
create function app.auth_challenge_revoke_message() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.used_at is not null and old.used_at is null) or (new.attempts >= 5 and old.attempts < 5) then
    update auth_private.auth_message_outbox set status = 'revoked', secret_encrypted = null, finished_at = now(), last_error = 'code no longer valid'
     where challenge_id = new.id and status = 'queued';
  end if;
  return null;
end $$;
create trigger portal_challenges_revoke_message after update of used_at, attempts on auth_private.portal_challenges
  for each row execute function app.auth_challenge_revoke_message();

create function app.auth_verification_revoke_message() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update auth_private.auth_message_outbox set status = 'revoked', secret_encrypted = null, finished_at = now(), last_error = 'link no longer valid'
   where verification_id = new.id and status = 'queued';
  return null;
end $$;
create trigger email_verifications_revoke_message after update of used_at on auth_private.email_verifications
  for each row when (old.used_at is null and new.used_at is not null) execute function app.auth_verification_revoke_message();

-- the student's email or phone changed: queued codes / links to the old address are revoked
create function app.auth_contact_revoke_message() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update auth_private.auth_message_outbox o set status = 'revoked', secret_encrypted = null, finished_at = now(), last_error = 'contact details changed'
   where o.student_id = new.id and o.status = 'queued'
     and (o.kind = 'email_verification' or o.to_address is distinct from case o.channel when 'email' then new.email else new.phone end);
  return null;
end $$;
create trigger students_revoke_auth_messages after update of email, phone on students
  for each row when (old.email_normalized is distinct from new.email_normalized or old.phone_normalized is distinct from new.phone_normalized)
  execute function app.auth_contact_revoke_message();

-- notification_messages may never again carry a sign-in code or verification link, nor re-queue a legacy one
create function app.notification_messages_no_auth_secrets() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.event_key in ('portal_login_code', 'email_verification') then
    if tg_op = 'INSERT' then
      raise exception 'sign-in codes and verification links are sent only through the secure authentication queue' using errcode = '42501';
    end if;
    if new.status in ('queued', 'sending') and old.status not in ('queued', 'sending') then
      raise exception 'legacy sign-in code / verification messages cannot be sent again' using errcode = '23514';
    end if;
    new.params := case when jsonb_typeof(new.params) = 'object' then new.params - 'code' - 'link' else '{}'::jsonb end;
    new.body := regexp_replace(regexp_replace(new.body, '\d{6}', '••••••', 'g'), 'token=[A-Za-z0-9_-]+', 'token=••••', 'g');
    new.subject := regexp_replace(regexp_replace(new.subject, '\d{6}', '••••••', 'g'), 'token=[A-Za-z0-9_-]+', 'token=••••', 'g');
    new.last_error := app.auth_mask_error(new.last_error);
  end if;
  return new;
end $$;
create trigger notification_messages_no_auth_secrets before insert or update on notification_messages
  for each row execute function app.notification_messages_no_auth_secrets();

-- ---------------------------------------------------------------------------
-- Replaced: portal sign-in code request (signature unchanged; p_code is now the ENCRYPTED code)
-- Rate limits, challenge record and audit unchanged. A newer code revokes older queued codes for the same identifier.
-- ---------------------------------------------------------------------------
create or replace function app.portal_request_code(p_identifier text, p_code text, p_code_hash text, p_ip text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := lower(btrim(p_identifier));
  v_is_email boolean := position('@' in v_id) > 0;
  v_digits text := nullif(right(regexp_replace(v_id, '\D', '', 'g'), 10), '');
  v_hash text := encode(sha256(convert_to(case when v_is_email then v_id else coalesce(v_digits, v_id) end, 'UTF8')), 'hex');
  v_students uuid[];
  v_challenge uuid;
  v_s students%rowtype;
  v_tpl uuid;
  v_channel text := case when v_is_email then 'email' else 'whatsapp' end;
begin
  if not app.auth_secret_cipher_ok(p_code) then raise exception 'the code must be encrypted' using errcode = '22023'; end if;
  -- rate limits: 5 per identifier per hour, 20 per IP per hour
  if (select count(*) from auth_private.portal_challenges where identifier_hash = v_hash and created_at > now() - interval '1 hour') >= 5
     or (p_ip is not null and (select count(*) from auth_private.portal_challenges where ip = p_ip and created_at > now() - interval '1 hour') >= 20) then
    insert into auth_private.portal_challenges (identifier_hash, code_hash, ip, expires_at) values (v_hash, 'rate-limited', p_ip, now())
    returning id into v_challenge;
    perform app.audit('portal_code_rate_limited', 'portal', null, null, null, null, null, 'denied', jsonb_build_object('ip', p_ip));
    return v_challenge;
  end if;
  select array_agg(id order by created_at) into v_students from students
   where status <> 'merged' and archived_at is null
     and ((v_is_email and email_normalized = v_id) or (not v_is_email and v_digits is not null and length(v_digits) >= 7 and phone_normalized = v_digits));
  insert into auth_private.portal_challenges (identifier_hash, code_hash, student_ids, ip)
  values (v_hash, p_code_hash, coalesce(v_students, '{}'), p_ip) returning id into v_challenge;
  if v_students is not null and cardinality(v_students) > 0 then
    select * into v_s from students where id = v_students[1];
    select id into v_tpl from notification_templates
     where org_id = v_s.originating_org_id and name = 'Portal sign-in code' and channel = v_channel and is_active limit 1;
    -- an older code for the same identifier that has not been sent yet is replaced
    update auth_private.auth_message_outbox o set status = 'revoked', secret_encrypted = null, finished_at = now(), last_error = 'replaced by a newer code'
      from auth_private.portal_challenges c
     where c.id = o.challenge_id and c.identifier_hash = v_hash and o.status = 'queued';
    if v_tpl is not null then
      insert into auth_private.auth_message_outbox (org_id, student_id, kind, channel, challenge_id, template_id, to_address, secret_encrypted, expires_at)
      select v_s.originating_org_id, v_s.id, 'portal_login_code', v_channel, v_challenge, v_tpl,
             case when v_is_email then v_s.email else v_s.phone end, p_code, c.expires_at
        from auth_private.portal_challenges c where c.id = v_challenge;
    end if;
    perform app.audit('portal_code_requested', 'portal', v_challenge::text, v_s.originating_org_id, v_s.id, null, null, 'success',
                      jsonb_build_object('ip', p_ip) || case when v_tpl is null then jsonb_build_object('not_sent', 'no sign-in code template') else '{}'::jsonb end);
  end if;
  return v_challenge;
end $$;

-- ---------------------------------------------------------------------------
-- Replaced: email verification request (signature unchanged; p_link is now the ENCRYPTED link)
-- ---------------------------------------------------------------------------
create or replace function app.request_email_verification(p_student uuid, p_token_hash text, p_link text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s students%rowtype; v_tpl uuid; v_v auth_private.email_verifications%rowtype;
begin
  if not app.auth_secret_cipher_ok(p_link) then raise exception 'the link must be encrypted' using errcode = '22023'; end if;
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'students.contact.view') or not app.can_on_student(p_student, 'students.update') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_s from students where id = p_student for update;
  if v_s.email is null then raise exception 'the student has no email address' using errcode = '23514'; end if;
  if v_s.email_status = 'verified' then raise exception 'this email address is already verified' using errcode = '23514'; end if;
  if (select count(*) from auth_private.email_verifications where student_id = p_student and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'too many verification emails; try again later' using errcode = '23514';
  end if;
  select id into v_tpl from notification_templates
   where org_id = v_s.originating_org_id and name = 'Email verification' and channel = 'email' and is_active limit 1;
  if v_tpl is null then raise exception 'the "Email verification" email template is missing or inactive' using errcode = '23514'; end if;
  insert into auth_private.email_verifications (student_id, email_normalized, token_hash, requested_by)
  values (p_student, v_s.email_normalized, p_token_hash, app.current_user_id()) returning * into v_v;
  -- an older link for this student that has not been sent yet is replaced
  update auth_private.auth_message_outbox set status = 'revoked', secret_encrypted = null, finished_at = now(), last_error = 'replaced by a newer link'
   where student_id = p_student and kind = 'email_verification' and status = 'queued';
  insert into auth_private.auth_message_outbox (org_id, student_id, kind, channel, verification_id, template_id, to_address, secret_encrypted, expires_at)
  values (v_s.originating_org_id, p_student, 'email_verification', 'email', v_v.id, v_tpl, v_s.email, p_link, v_v.expires_at);
  perform set_config('app.email_verify', 'on', true);
  update students set email_status = 'pending', email_verified_at = null where id = p_student;
  perform set_config('app.email_verify', 'off', true);
  perform app.add_event_internal(p_student, v_s.originating_org_id, 'student', 'email_verification_sent', 'Email verification link sent', 'students', p_student::text);
end $$;

-- ---------------------------------------------------------------------------
-- Replaced policy: all four authentication kinds are hidden from every staff branch
-- ---------------------------------------------------------------------------
drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (event_key not in ('portal_account_setup', 'portal_password_reset', 'portal_login_code', 'email_verification')
         and (app.has_perm(org_id, 'notifications.view')
              or (student_id is not null and app.can_on_student(student_id, 'students.contact.view'))));

-- ---------------------------------------------------------------------------
-- Sender (system context only)
-- ---------------------------------------------------------------------------
create function app.auth_message_claim(p_limit int)
returns table (id uuid, kind text, channel text, to_address text, secret_encrypted text, attempts int, org_code text, company text,
               student_name text, student_code text, template_subject text, template_body text, provider_template_name text, provider_params text[])
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  update auth_private.auth_message_outbox o set status = 'expired', secret_encrypted = null, finished_at = now()
   where o.status in ('queued', 'sending') and o.expires_at <= now();
  -- re-check every secret before it leaves (an expired, used or replaced code / link is never sent, also not on retry)
  update auth_private.auth_message_outbox o set status = 'revoked', secret_encrypted = null, finished_at = now(), last_error = 'no longer valid'
   where o.status = 'queued'
     and not exists (select 1 from students s where s.id = o.student_id and s.archived_at is null and s.status <> 'merged'
                       and o.to_address is not distinct from case o.channel when 'email' then s.email else s.phone end
                       and (o.kind <> 'email_verification' or s.email_status = 'pending'))
      or (o.status = 'queued' and o.kind = 'portal_login_code'
          and not exists (select 1 from auth_private.portal_challenges c where c.id = o.challenge_id and c.used_at is null
                            and c.expires_at > now() and c.attempts < 5 and c.code_hash <> 'rate-limited'))
      or (o.status = 'queued' and o.kind = 'email_verification'
          and not exists (select 1 from auth_private.email_verifications v join students s on s.id = v.student_id
                           where v.id = o.verification_id and v.used_at is null and v.expires_at > now()
                             and v.email_normalized is not distinct from s.email_normalized));
  -- a sender that crashed mid-send: the message becomes due again (its attempt is already counted)
  update auth_private.auth_message_outbox o set status = 'queued' where o.status = 'sending' and o.claimed_at < now() - interval '2 minutes';
  return query
    with c as (select x.id from auth_private.auth_message_outbox x where x.status = 'queued' and x.next_attempt_at <= now()
                order by x.next_attempt_at limit least(greatest(coalesce(p_limit, 25), 1), 100) for update skip locked)
    update auth_private.auth_message_outbox o set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from c, organizations g, students s, notification_templates t
     where o.id = c.id and g.id = o.org_id and s.id = o.student_id and t.id = o.template_id
    returning o.id, o.kind, o.channel, o.to_address, o.secret_encrypted, o.attempts, g.code, g.name, s.full_name, s.student_code,
              t.subject, t.body, t.provider_template_name, t.provider_params;
end $$;

create function app.auth_message_finish(p_id uuid, p_result text, p_error text, p_provider text, p_provider_id text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o auth_private.auth_message_outbox%rowtype; v_final text; v_wait int; v_err text := app.auth_mask_error(p_error);
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  if p_result not in ('sent', 'retry', 'failed', 'skipped', 'test') then raise exception 'invalid result' using errcode = '22023'; end if;
  select * into v_o from auth_private.auth_message_outbox where id = p_id and status = 'sending' for update;
  if not found then return null; end if;
  v_wait := 30 * power(2, v_o.attempts - 1)::int;
  v_final := case
    when p_result = 'retry' and (v_o.attempts >= 5 or now() + make_interval(secs => v_wait) >= v_o.expires_at) then 'failed'
    when p_result = 'retry' then 'queued'
    else p_result end;
  if v_final = 'queued' then
    update auth_private.auth_message_outbox set status = 'queued', last_error = v_err, provider = p_provider,
           next_attempt_at = now() + make_interval(secs => v_wait) where id = p_id;
  else
    update auth_private.auth_message_outbox set status = v_final, secret_encrypted = null, finished_at = now(),
           provider = p_provider, provider_message_id = case when v_final = 'sent' then left(p_provider_id, 300) end,
           last_error = case when v_final = 'sent' then null else v_err end where id = p_id;
    if v_final = 'failed' then
      perform app.audit('auth_message_failed', 'auth_message_outbox', v_o.id::text, v_o.org_id, v_o.student_id, null, null, 'failure',
        jsonb_build_object('kind', v_o.kind, 'channel', v_o.channel, 'attempts', v_o.attempts, 'error', left(v_err, 200)));
    end if;
  end if;
  return v_final;
end $$;

create function app.auth_message_housekeeping() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  delete from auth_private.auth_message_outbox
   where status in ('sent', 'failed', 'skipped', 'test', 'expired', 'revoked') and created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- Staff with notifications.view: REDACTED status rows for the Messages page (never the secret or rendered text).
-- Same company scoping as the outbox policy.
create function app.auth_message_log(p_org_ids uuid[], p_student uuid, p_status text, p_channel text, p_event text, p_limit int)
returns table (id uuid, org_id uuid, org_name text, student_id uuid, student_code text, student_name text, event_key text, channel text,
               to_address text, status text, last_error text, attempts int, provider text, created_at timestamptz, sent_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.id, o.org_id, g.name, o.student_id, s.student_code, s.full_name, o.kind, o.channel, o.to_address, o.status, o.last_error,
         o.attempts, o.provider, o.created_at, case when o.status = 'sent' then o.finished_at end
    from auth_private.auth_message_outbox o
    join organizations g on g.id = o.org_id
    left join students s on s.id = o.student_id and app.can_read_student(s.id)
   where o.org_id = any(coalesce(p_org_ids, '{}')) and app.has_perm(o.org_id, 'notifications.view')
     and (p_student is null or o.student_id = p_student)
     and (p_status is null or o.status = p_status)
     and (p_channel is null or o.channel = p_channel)
     and (p_event is null or o.kind = p_event)
   order by o.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500)
$$;

-- ---------------------------------------------------------------------------
-- Legacy rows in notification_messages (secrets exposed before this migration)
-- ---------------------------------------------------------------------------
do $$
declare v_codes int; v_links int; v_messages int;
begin
  -- 1. still-open sign-in codes and verification links of affected students stop working (a new one must be requested)
  update auth_private.portal_challenges c set used_at = now()
   where c.used_at is null and c.expires_at > now()
     and exists (select 1 from notification_messages m where m.event_key = 'portal_login_code' and m.student_id = any(c.student_ids)
                   and (m.params ? 'code' or coalesce(m.body, '') ~ '\d{6}' or coalesce(m.subject, '') ~ '\d{6}'));
  get diagnostics v_codes = row_count;
  update auth_private.email_verifications v set used_at = now()
   where v.used_at is null and v.expires_at > now()
     and exists (select 1 from notification_messages m where m.event_key = 'email_verification' and m.student_id = v.student_id
                   and (m.params ? 'link' or coalesce(m.body, '') ~ 'token=[A-Za-z0-9_-]{8,}'));
  get diagnostics v_links = row_count;
  -- 2. scrub the messages (the BEFORE UPDATE trigger above strips params, body, subject and error); pending ones are never sent
  update notification_messages set
    status = case when status in ('queued', 'sending') then 'skipped' else status end,
    skip_reason = case when status in ('queued', 'sending') then 'Moved to the secure authentication queue (N-8)' else skip_reason end
   where event_key in ('portal_login_code', 'email_verification');
  get diagnostics v_messages = row_count;
  if v_codes > 0 or v_links > 0 or v_messages > 0 then
    perform app.audit('auth_secrets_invalidated', 'notification_messages', null, null, null, null, null, 'success',
      jsonb_build_object('reason', 'N-8 migration 0037', 'codes_invalidated', v_codes, 'links_invalidated', v_links, 'messages_scrubbed', v_messages));
  end if;
  raise notice '0037: % code(s) and % verification link(s) invalidated, % legacy message(s) scrubbed', v_codes, v_links, v_messages;
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke all on function app.auth_secret_cipher_ok(text), app.auth_mask_error(text), app.auth_challenge_revoke_message(),
  app.auth_verification_revoke_message(), app.auth_contact_revoke_message(), app.notification_messages_no_auth_secrets(),
  app.auth_message_claim(int), app.auth_message_finish(uuid, text, text, text, text), app.auth_message_housekeeping(),
  app.auth_message_log(uuid[], uuid, text, text, text, int) from public;
grant execute on function app.auth_message_claim(int), app.auth_message_finish(uuid, text, text, text, text),
  app.auth_message_housekeeping(), app.auth_message_log(uuid[], uuid, text, text, text, int) to erp_app;
