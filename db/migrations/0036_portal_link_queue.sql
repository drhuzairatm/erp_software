-- =============================================================================
-- 0036 Secure queue for student-portal set-up and password-reset links (finding N-7)
--
-- Finding: student-portal set-up and password-reset emails were queued in notification_messages with the one-time link
-- in params.link. Staff holding notifications.view (MD and Manager roles) could read the link while the message was
-- queued or sending, and in test mode the rendered body kept the full link. Opening it lets the reader choose the
-- student's portal password. (Staff with only students.contact.view were already excluded from these two kinds by 0025.)
--
-- This migration:
--   * auth_private.portal_email_outbox: dedicated durable queue. The link is stored ENCRYPTED (AES-256-GCM, encrypted by
--     the server; the database refuses anything that is not a v1 cipher text), tied to its one-time token, and WIPED as
--     soon as the email is sent, fails finally, is skipped, recorded in test mode, expires or is revoked (enforced by a
--     CHECK). Neither the application role nor any staff member can read the table (no USAGE on auth_private).
--   * delivery: claimed with SKIP LOCKED (no duplicate delivery), retry with back-off (max 5 attempts, never past the
--     link's expiry), stale "sending" rows are re-queued, the sender functions refuse any signed-in user context.
--   * revocation: when a link's token is used, superseded or the account is disabled, its queued email is revoked and the
--     link wiped at once (trigger), and every claim re-checks the token, the account and the student record.
--   * app.issue_portal_account_link / app.portal_request_reset (signatures unchanged) now queue in the secure outbox
--     and accept only the encrypted link. The plain link is returned by the application only to the issuing staff
--     member when it is NOT emailed (unchanged, approved hand-over behaviour).
--   * notification_messages: the two kinds can no longer be inserted (trigger); the messages_select policy hides them
--     from every staff branch; app.finish_notification masks them in every status, test mode included; any update of a
--     legacy row strips the link.
--   * legacy rows: existing messages of the two kinds are scrubbed (link removed, body masked, pending ones skipped) and
--     every still-open link of the affected accounts is invalidated (a new link must be issued). Counted in the audit log.
--   * app.portal_email_status: staff see delivery status only (never the link).
--
-- Not changed: any other policy, permission, role, company data, two-step login, audit-log or alert function; other
-- message kinds (portal login codes and email verification keep their existing behaviour).
-- Replaced (signatures unchanged): app.issue_portal_account_link, app.portal_request_reset, app.finish_notification,
-- policy messages_select on notification_messages.
-- =============================================================================

create table auth_private.portal_email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id),
  student_id          uuid not null references students(id),
  account_id          uuid not null references auth_private.student_accounts(id),
  token_id            uuid not null unique references auth_private.student_account_tokens(id),  -- one email per link
  kind                text not null check (kind in ('portal_account_setup', 'portal_password_reset')),
  template_id         uuid not null references notification_templates(id),
  to_address          text not null,
  link_encrypted      text check (link_encrypted is null
                                  or link_encrypted ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'),
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
  check (status in ('queued', 'sending') or link_encrypted is null)  -- the link can only exist while the email is pending
);
create index portal_email_outbox_due_idx on auth_private.portal_email_outbox (next_attempt_at) where status in ('queued', 'sending');
create index portal_email_outbox_student_idx on auth_private.portal_email_outbox (student_id, created_at desc);
revoke all on auth_private.portal_email_outbox from public;

-- ---------------------------------------------------------------------------
-- Internal helpers (not executable by the application role)
-- ---------------------------------------------------------------------------
create function app.portal_link_cipher_ok(p_link text) returns boolean
language sql immutable security definer set search_path = public, pg_temp as $$
  select coalesce(p_link ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$', false)
$$;

-- a link that stops working (used, superseded, account disabled) takes its queued email with it
create function app.portal_token_revoke_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update auth_private.portal_email_outbox set status = 'revoked', link_encrypted = null, finished_at = now(),
         last_error = 'link no longer valid'
   where token_id = new.id and status = 'queued';
  return null;
end $$;
create trigger student_account_tokens_revoke_email after update of used_at on auth_private.student_account_tokens
  for each row when (old.used_at is null and new.used_at is not null) execute function app.portal_token_revoke_email();

-- notification_messages may never again carry a portal set-up/reset link
create function app.notification_messages_no_portal_links() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.event_key in ('portal_account_setup', 'portal_password_reset') then
    if tg_op = 'INSERT' then
      raise exception 'portal account links are sent only through the secure portal email queue' using errcode = '42501';
    end if;
    new.params := coalesce(new.params, '{}'::jsonb) - 'link';
    new.body := regexp_replace(new.body, 'token=[A-Za-z0-9_-]+', 'token=••••', 'g');
  end if;
  return new;
end $$;
create trigger notification_messages_no_portal_links before insert or update on notification_messages
  for each row execute function app.notification_messages_no_portal_links();

-- ---------------------------------------------------------------------------
-- Replaced: issuing a set-up / reset link (signature unchanged; p_link is now the ENCRYPTED link)
-- ---------------------------------------------------------------------------
create or replace function app.issue_portal_account_link(p_student uuid, p_token_hash text, p_link text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s students%rowtype; v_a auth_private.student_accounts%rowtype; v_tpl uuid; v_purpose text; v_tok auth_private.student_account_tokens%rowtype;
begin
  if not app.portal_link_cipher_ok(p_link) then raise exception 'the link must be encrypted' using errcode = '22023'; end if;
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'portal.accounts.manage') then raise exception 'permission denied: portal.accounts.manage' using errcode = '42501'; end if;
  select * into v_s from students where id = p_student for update;
  if v_s.status = 'merged' or v_s.archived_at is not null then raise exception 'this record is archived or merged' using errcode = '23514'; end if;
  select * into v_a from auth_private.student_accounts where student_id = p_student;
  if not found then
    insert into auth_private.student_accounts (student_id, created_by) values (p_student, app.current_user_id()) returning * into v_a;
  elsif v_a.status = 'disabled' then
    raise exception 'the portal account is disabled; enable it first' using errcode = '23514';
  end if;
  if (select count(*) from auth_private.student_account_tokens where account_id = v_a.id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many links issued; try again later' using errcode = '23514';
  end if;
  v_purpose := case when v_a.password_hash is null then 'setup' else 'reset' end;
  -- older open links stop working (their queued emails are revoked by trigger)
  update auth_private.student_account_tokens set used_at = now() where account_id = v_a.id and used_at is null;
  insert into auth_private.student_account_tokens (account_id, token_hash, purpose, created_by, expires_at)
  values (v_a.id, p_token_hash, v_purpose, app.current_user_id(), now() + interval '72 hours') returning * into v_tok;
  perform app.add_event_internal(p_student, v_s.originating_org_id, 'student', 'portal_account',
    case v_purpose when 'setup' then 'Student portal account: set-up link issued' else 'Student portal account: password reset link issued' end, 'students', p_student::text);
  perform app.audit('portal_account_link', 'student_accounts', v_a.id::text, v_s.originating_org_id, p_student, null, jsonb_build_object('purpose', v_purpose));
  if v_s.email is not null and v_s.email_status = 'verified' then
    select id into v_tpl from notification_templates
     where org_id = v_s.originating_org_id and name = 'Portal account set-up' and channel = 'email' and is_active limit 1;
    if v_tpl is not null then
      insert into auth_private.portal_email_outbox (org_id, student_id, account_id, token_id, kind, template_id, to_address, link_encrypted, expires_at)
      values (v_s.originating_org_id, p_student, v_a.id, v_tok.id, 'portal_account_setup', v_tpl, v_s.email, p_link, v_tok.expires_at);
      return 'emailed';
    end if;
  end if;
  return 'link';
end $$;

-- ---------------------------------------------------------------------------
-- Replaced: "forgot password" in the portal (signature unchanged; p_link is now the ENCRYPTED link). Reveals nothing.
-- ---------------------------------------------------------------------------
create or replace function app.portal_request_reset(p_identifier text, p_token_hash text, p_link text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_tpl uuid; v_tok auth_private.student_account_tokens%rowtype;
begin
  if not app.portal_link_cipher_ok(p_link) then raise exception 'the link must be encrypted' using errcode = '22023'; end if;
  for r in select a.id, s.id as student_id, s.originating_org_id as org, s.email from auth_private.student_accounts a join students s on s.id = a.student_id
            where a.status = 'active' and s.email_status = 'verified' and s.email is not null and s.archived_at is null and s.status <> 'merged'
              and (upper(s.student_code) = upper(btrim(p_identifier)) or s.email_normalized = lower(btrim(p_identifier)))
            limit 1 loop
    continue when (select count(*) from auth_private.student_account_tokens where account_id = r.id and created_at > now() - interval '1 hour') >= 3;
    select id into v_tpl from notification_templates where org_id = r.org and name = 'Portal password reset' and channel = 'email' and is_active limit 1;
    continue when v_tpl is null;
    update auth_private.student_account_tokens set used_at = now() where account_id = r.id and used_at is null;
    insert into auth_private.student_account_tokens (account_id, token_hash, purpose, expires_at) values (r.id, p_token_hash, 'reset', now() + interval '1 hour')
    returning * into v_tok;
    insert into auth_private.portal_email_outbox (org_id, student_id, account_id, token_id, kind, template_id, to_address, link_encrypted, expires_at)
    values (r.org, r.student_id, r.id, v_tok.id, 'portal_password_reset', v_tpl, r.email, p_link, v_tok.expires_at);
    perform app.audit('portal_password_reset_requested', 'student_accounts', r.id::text, r.org, r.student_id, null, null);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Replaced: finishing an outbox message (signature unchanged). The two portal-link kinds are masked in EVERY status;
-- portal login codes and email verification keep their existing behaviour.
-- ---------------------------------------------------------------------------
create or replace function app.finish_notification(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text,
                                                   p_subject text, p_body text, p_retry_in_seconds int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event text; v_student uuid; v_secret boolean;
begin
  if p_status not in ('sent', 'failed', 'skipped', 'test', 'queued') then raise exception 'invalid status'; end if;
  select event_key, student_id into v_event, v_student from notification_messages where id = p_id;
  v_secret := (v_event in ('portal_login_code', 'email_verification') and p_status in ('sent', 'failed', 'skipped'))
              or v_event in ('portal_account_setup', 'portal_password_reset');
  update notification_messages set
    status = p_status, provider = p_provider, provider_message_id = p_provider_id, last_error = left(p_error, 1000),
    subject = coalesce(p_subject, subject),
    body = case when v_secret then regexp_replace(regexp_replace(coalesce(p_body, body), '\d{6}', '••••••', 'g'), 'token=[A-Za-z0-9_-]+', 'token=••••', 'g')
                else coalesce(p_body, body) end,
    params = case when v_secret then params - 'code' - 'link' else params end,
    skip_reason = case when p_status = 'skipped' then left(p_error, 200) else skip_reason end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    next_attempt_at = case when p_status = 'queued' then now() + make_interval(secs => greatest(p_retry_in_seconds, 30)) else next_attempt_at end
  where id = p_id and status = 'sending';
  if v_event = 'email_verification' and p_status in ('failed', 'skipped') and v_student is not null then
    perform set_config('app.email_verify', 'on', true);
    update students set email_status = 'failed' where id = v_student and email_status = 'pending';
    perform set_config('app.email_verify', 'off', true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Replaced policy: the two portal-link kinds are hidden from every staff branch (also from notifications.view)
-- ---------------------------------------------------------------------------
drop policy messages_select on notification_messages;
create policy messages_select on notification_messages for select to erp_app
  using (event_key not in ('portal_account_setup', 'portal_password_reset')
         and (app.has_perm(org_id, 'notifications.view')
              or (event_key not in ('portal_login_code', 'email_verification')
                  and student_id is not null and app.can_on_student(student_id, 'students.contact.view'))));

-- ---------------------------------------------------------------------------
-- Sender (system context only)
-- ---------------------------------------------------------------------------
create function app.portal_email_claim(p_limit int)
returns table (id uuid, kind text, to_address text, link_encrypted text, attempts int, org_code text, company text,
               student_name text, student_code text, template_subject text, template_body text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  update auth_private.portal_email_outbox o set status = 'expired', link_encrypted = null, finished_at = now()
   where o.status in ('queued', 'sending') and o.expires_at <= now();
  -- re-check every link before it leaves: token unused and unexpired, account not disabled, record not archived/merged
  update auth_private.portal_email_outbox o set status = 'revoked', link_encrypted = null, finished_at = now(), last_error = 'link no longer valid'
   where o.status = 'queued'
     and not exists (select 1 from auth_private.student_account_tokens t join auth_private.student_accounts a on a.id = t.account_id
                       join students s on s.id = a.student_id
                      where t.id = o.token_id and t.used_at is null and t.expires_at > now() and a.status <> 'disabled'
                        and s.archived_at is null and s.status <> 'merged');
  -- a sender that crashed mid-send: the message becomes due again (its attempt is already counted)
  update auth_private.portal_email_outbox o set status = 'queued' where o.status = 'sending' and o.claimed_at < now() - interval '5 minutes';
  return query
    with c as (select x.id from auth_private.portal_email_outbox x where x.status = 'queued' and x.next_attempt_at <= now()
                order by x.next_attempt_at limit least(greatest(coalesce(p_limit, 25), 1), 100) for update skip locked)
    update auth_private.portal_email_outbox o set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from c, organizations g, students s, notification_templates t
     where o.id = c.id and g.id = o.org_id and s.id = o.student_id and t.id = o.template_id
    returning o.id, o.kind, o.to_address, o.link_encrypted, o.attempts, g.code, g.name, s.full_name, s.student_code, t.subject, t.body;
end $$;

create function app.portal_email_finish(p_id uuid, p_result text, p_error text, p_provider text, p_provider_id text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o auth_private.portal_email_outbox%rowtype; v_final text; v_wait int;
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  if p_result not in ('sent', 'retry', 'failed', 'skipped', 'test') then raise exception 'invalid result' using errcode = '22023'; end if;
  select * into v_o from auth_private.portal_email_outbox where id = p_id and status = 'sending' for update;
  if not found then return null; end if;
  v_wait := 60 * power(2, v_o.attempts - 1)::int;
  v_final := case
    when p_result = 'retry' and (v_o.attempts >= 5 or now() + make_interval(secs => v_wait) >= v_o.expires_at) then 'failed'
    when p_result = 'retry' then 'queued'
    else p_result end;
  if v_final = 'queued' then
    update auth_private.portal_email_outbox set status = 'queued', last_error = left(p_error, 300), provider = p_provider,
           next_attempt_at = now() + make_interval(secs => v_wait) where id = p_id;
  else
    update auth_private.portal_email_outbox set status = v_final, link_encrypted = null, finished_at = now(),
           provider = p_provider, provider_message_id = case when v_final = 'sent' then left(p_provider_id, 300) end,
           last_error = case when v_final = 'sent' then null else left(p_error, 300) end where id = p_id;
    if v_final in ('sent', 'failed') then
      perform app.audit(case v_final when 'sent' then 'portal_link_email_sent' else 'portal_link_email_failed' end,
        'student_accounts', v_o.account_id::text, v_o.org_id, v_o.student_id, null, null,
        case v_final when 'sent' then 'success' else 'failure' end,
        jsonb_build_object('kind', v_o.kind, 'attempts', v_o.attempts, 'error', case when v_final = 'failed' then left(p_error, 200) end));
    end if;
  end if;
  return v_final;
end $$;

create function app.portal_email_housekeeping() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  if app.current_user_id() is not null then raise exception 'system context only' using errcode = '42501'; end if;
  delete from auth_private.portal_email_outbox
   where status in ('sent', 'failed', 'skipped', 'test', 'expired', 'revoked') and created_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- Staff: delivery status of the latest portal link email (never the link). Same access as the portal account card or the outbox.
create function app.portal_email_status(p_student uuid)
returns table (kind text, status text, created_at timestamptz, finished_at timestamptz, attempts int, last_error text)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.kind, o.status, o.created_at, o.finished_at, o.attempts, o.last_error
    from auth_private.portal_email_outbox o
   where o.student_id = p_student and app.can_read_student(p_student)
     and (app.can_on_student(p_student, 'portal.accounts.manage') or app.has_perm(o.org_id, 'notifications.view'))
   order by o.created_at desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Legacy rows in notification_messages (links exposed before this migration)
-- ---------------------------------------------------------------------------
do $$
declare v_tokens int; v_messages int;
begin
  -- 1. every still-open link of an affected account stops working (the student or staff issue a new one)
  update auth_private.student_account_tokens t set used_at = now()
    from auth_private.student_accounts a
   where a.id = t.account_id and t.used_at is null
     and exists (select 1 from notification_messages m
                  where m.student_id = a.student_id and m.event_key in ('portal_account_setup', 'portal_password_reset')
                    and (m.params ? 'link' or coalesce(m.body, '') ~ 'token=[A-Za-z0-9_-]{8,}'));
  get diagnostics v_tokens = row_count;
  -- 2. scrub the messages (the BEFORE UPDATE trigger above also strips any link); pending ones are never sent
  update notification_messages set
    status = case when status in ('queued', 'sending') then 'skipped' else status end,
    skip_reason = case when status in ('queued', 'sending') then 'Moved to the secure portal email queue (N-7); issue a new link' else skip_reason end,
    params = params - 'link',
    body = regexp_replace(body, 'token=[A-Za-z0-9_-]+', 'token=••••', 'g')
   where event_key in ('portal_account_setup', 'portal_password_reset');
  get diagnostics v_messages = row_count;
  if v_tokens > 0 or v_messages > 0 then
    perform app.audit('portal_links_invalidated', 'notification_messages', null, null, null, null, null, 'success',
      jsonb_build_object('reason', 'N-7 migration 0036', 'links_invalidated', v_tokens, 'messages_scrubbed', v_messages));
  end if;
  raise notice '0036: % open portal link(s) invalidated, % legacy message(s) scrubbed', v_tokens, v_messages;
end $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke all on function app.portal_link_cipher_ok(text), app.portal_token_revoke_email(), app.notification_messages_no_portal_links(),
  app.portal_email_claim(int), app.portal_email_finish(uuid, text, text, text, text), app.portal_email_housekeeping(),
  app.portal_email_status(uuid) from public;
grant execute on function app.portal_email_claim(int), app.portal_email_finish(uuid, text, text, text, text),
  app.portal_email_housekeeping(), app.portal_email_status(uuid) to erp_app;
