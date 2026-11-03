-- =============================================================================
-- 0015 Phase H: email / WhatsApp / SMS notifications
--
--   events → rules (per company, channel, audience) → outbox messages → sender
--
-- * Consent is recorded per student, channel and recipient (student/parent);
--   without current consent a message is recorded as "skipped – no consent".
-- * Nothing is ever reported as sent unless the provider accepted it.
-- * In test mode (default) messages stay in the outbox as "test – not sent".
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('notifications.view',    'Notifications', 'See the message outbox (contains contact details)', true),
  ('notifications.manage',  'Notifications', 'Configure message templates and which events send messages', false),
  ('notifications.consent', 'Notifications', 'Record or withdraw a student''s / parent''s consent to receive messages', false)
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, v.p from roles r join (values
  ('manager', 'notifications.view'), ('manager', 'notifications.consent'),
  ('counsellor', 'notifications.consent'),
  ('system_admin', 'notifications.manage')) v(k, p) on r.key = v.k
on conflict do nothing;

-- Parent / guardian contact (masked like the student's contact details)
alter table students
  add column parent_name text check (parent_name is null or length(parent_name) <= 120),
  add column parent_phone text check (parent_phone is null or parent_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  add column parent_email text check (parent_email is null or parent_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
grant insert (parent_name, parent_phone, parent_email) on students to erp_app;
grant update (parent_name, parent_phone, parent_email) on students to erp_app;
grant select (parent_name) on students to erp_app;

drop trigger students_audit on students;
create trigger students_audit after insert or update or delete on students
  for each row execute function app.audit_row('originating_org_id', 'id', 'phone_normalized', 'email_normalized', 'passport_normalized',
                                              '~phone', '~email', '~date_of_birth', '~passport_number', '~parent_phone', '~parent_email');

-- v_students: parent contact appended, masked without contact permission
create or replace view v_students with (security_barrier = true) as
select s.id, s.student_code, s.originating_org_id, s.processing_org_id, s.lead_source_id, s.full_name,
       case when p.pii then s.phone end as phone,
       case when p.pii then s.email end as email,
       case when p.pii then s.phone_normalized end as phone_normalized,
       case when p.pii then s.email_normalized end as email_normalized,
       case when s.phone_normalized is not null then '••••••' || right(s.phone_normalized, 2) end as phone_masked,
       case when s.email_normalized is not null then left(s.email_normalized, 1) || '•••@' || split_part(s.email_normalized, '@', 2) end as email_masked,
       case when p.pii then s.date_of_birth end as date_of_birth,
       p.pii as contact_visible,
       s.preferred_language, s.destination_country_id, s.course_id, s.preferred_university_id,
       s.highest_qualification, s.qualification_board, s.qualification_year, s.qualification_score,
       s.entrance_exam, s.entrance_score, s.academic_notes, s.registration_date, s.workflow_id,
       s.current_stage_key, s.stage_before_hold, s.stage_changed_at, s.status, s.next_action, s.next_action_due,
       s.contracting_entity_id, s.payment_recipient_entity_id, s.university_application_ref, s.admission_letter_date,
       s.visa_appointment_date, s.visa_outcome, s.visa_reference, s.merged_into_id, s.archived_at, s.archived_by,
       s.archive_reason, s.is_demo, s.created_by, s.created_at, s.updated_by, s.updated_at,
       s.previous_education_country_id, s.school_country_id, s.institution_name, s.preferred_campus_id,
       case when pp.passport then s.passport_number end as passport_number,
       case when pp.passport then s.passport_expiry end as passport_expiry,
       case when pp.passport then s.passport_country_id end as passport_country_id,
       case when s.passport_normalized is not null then '•••••' || right(s.passport_normalized, 3) end as passport_masked,
       pp.passport as passport_visible,
       s.parent_name,
       case when p.pii then s.parent_phone end as parent_phone,
       case when p.pii then s.parent_email end as parent_email
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);

-- -----------------------------------------------------------------------------
-- Consent (append-only history; the latest record per student/channel/recipient counts)
-- -----------------------------------------------------------------------------
create table contact_consents (
  id           bigint generated always as identity primary key,
  student_id   uuid not null references students(id),
  channel      text not null check (channel in ('email', 'whatsapp', 'sms')),
  recipient    text not null check (recipient in ('student', 'parent')),
  granted      boolean not null,
  source       text not null check (length(btrim(source)) between 2 and 200),
  recorded_by  uuid references user_profiles(id),
  recorded_at  timestamptz not null default now()
);
create index contact_consents_idx on contact_consents (student_id, channel, recipient, recorded_at desc);
create trigger contact_consents_immutable before update or delete on contact_consents
  for each row execute function app.audit_immutable();

create or replace function app.has_consent(p_student uuid, p_channel text, p_recipient text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select granted from contact_consents
                    where student_id = p_student and channel = p_channel and recipient = p_recipient
                    order by recorded_at desc, id desc limit 1), false)
$$;

create or replace function app.record_consent(p_student uuid, p_channel text, p_recipient text, p_granted boolean, p_source text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if not app.can_on_student(p_student, 'notifications.consent') then
    raise exception 'permission denied: notifications.consent' using errcode = '42501';
  end if;
  insert into contact_consents (student_id, channel, recipient, granted, source, recorded_by)
  values (p_student, p_channel, p_recipient, p_granted, btrim(p_source), app.current_user_id());
  select originating_org_id into v_org from students where id = p_student;
  perform app.add_event_internal(p_student, v_org, 'student', 'consent',
    initcap(p_recipient) || ' ' || case when p_granted then 'agreed to receive' else 'withdrew consent for' end || ' ' || p_channel || ' messages (' || btrim(p_source) || ')');
end $$;

-- -----------------------------------------------------------------------------
-- Templates and rules (per company)
-- -----------------------------------------------------------------------------
create table notification_templates (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organizations(id),
  name                    text not null check (length(btrim(name)) between 2 and 120),
  channel                 text not null check (channel in ('email', 'whatsapp', 'sms')),
  language                text not null default 'en',
  subject                 text,
  body                    text not null check (length(body) between 1 and 4000),
  provider_template_name  text,            -- WhatsApp (Gallabox) approved template name / SMS DLT template id
  provider_params         text[] not null default '{}',  -- placeholder names in the provider's variable order
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (org_id, name, channel, language),
  unique (id, org_id)
);
create trigger notification_templates_touch before update on notification_templates for each row execute function app.touch_updated_at();
create trigger notification_templates_audit after insert or update or delete on notification_templates
  for each row execute function app.audit_row('org_id', '');

create table notification_rules (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id),
  event_key    text not null check (event_key in ('student_registered', 'stage_changed', 'document_changes_required',
                                                 'document_rejected', 'document_approved', 'visa_outcome', 'portal_login_code')),
  channel      text not null check (channel in ('email', 'whatsapp', 'sms')),
  audience     text not null check (audience in ('student', 'parent')),
  template_id  uuid not null,
  stage_keys   text[] not null default '{}', -- for stage_changed: only these target stages (empty = all)
  is_enabled   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (org_id, event_key, channel, audience),
  foreign key (template_id, org_id) references notification_templates(id, org_id)
);
create trigger notification_rules_audit after insert or update or delete on notification_rules
  for each row execute function app.audit_row('org_id', '');

-- -----------------------------------------------------------------------------
-- Outbox
-- -----------------------------------------------------------------------------
create table notification_messages (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id),
  student_id           uuid references students(id),
  event_key            text not null,
  rule_id              uuid references notification_rules(id),
  template_id          uuid references notification_templates(id),
  channel              text not null check (channel in ('email', 'whatsapp', 'sms')),
  recipient_type       text not null check (recipient_type in ('student', 'parent')),
  to_address           text,
  params               jsonb not null default '{}'::jsonb,
  subject              text,
  body                 text,
  status               text not null default 'queued'
                         check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'test')),
  skip_reason          text,
  attempts             int not null default 0,
  next_attempt_at      timestamptz not null default now(),
  provider             text,
  provider_message_id  text,
  last_error           text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  updated_at           timestamptz not null default now()
);
create index notification_messages_due_idx on notification_messages (next_attempt_at) where status = 'queued';
create index notification_messages_student_idx on notification_messages (student_id, created_at desc);
create index notification_messages_org_idx on notification_messages (org_id, created_at desc);
create trigger notification_messages_touch before update on notification_messages for each row execute function app.touch_updated_at();

-- Queue messages for an event according to the student's brand's rules.
create or replace function app.enqueue_notification(p_student uuid, p_event text, p_params jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s students%rowtype;
  r record;
  v_to text;
  v_status text;
  v_reason text;
  v_n int := 0;
begin
  select * into v_s from students where id = p_student;
  if not found then return 0; end if;
  for r in select * from notification_rules
            where org_id = v_s.originating_org_id and event_key = p_event and is_enabled
              and (p_event <> 'stage_changed' or cardinality(stage_keys) = 0 or (p_params ->> 'to_stage') = any(stage_keys)) loop
    v_to := case
      when r.channel = 'email' and r.audience = 'student' then v_s.email
      when r.channel = 'email' and r.audience = 'parent' then v_s.parent_email
      when r.audience = 'student' then v_s.phone
      else v_s.parent_phone end;
    v_status := 'queued'; v_reason := null;
    if v_to is null then v_status := 'skipped'; v_reason := 'no ' || case when r.channel = 'email' then 'email address' else 'phone number' end;
    elsif not app.has_consent(p_student, r.channel, r.audience) then v_status := 'skipped'; v_reason := 'no consent';
    end if;
    insert into notification_messages (org_id, student_id, event_key, rule_id, template_id, channel, recipient_type, to_address, params, status, skip_reason)
    values (v_s.originating_org_id, p_student, p_event, r.id, r.template_id, r.channel, r.audience, v_to,
            coalesce(p_params, '{}'::jsonb), v_status, v_reason);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Event sources ---------------------------------------------------------------
create or replace function app.notify_on_stage_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.enqueue_notification(new.student_id, 'stage_changed', jsonb_build_object(
    'from_stage', new.from_stage, 'to_stage', new.to_stage,
    'stage', (select name from stages where key = new.to_stage),
    'next_action', new.next_action, 'next_action_due', new.next_action_due));
  return null;
end $$;
create trigger stage_history_notify after insert on student_stage_history
  for each row execute function app.notify_on_stage_history();

create or replace function app.notify_on_document_review() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid; v_doc text;
begin
  if new.to_status not in ('changes_required', 'rejected', 'approved') then return null; end if;
  select d.student_id, t.name || case when d.label <> '' then ' – ' || d.label else '' end into v_student, v_doc
    from student_documents d join document_types t on t.id = d.document_type_id where d.id = new.student_document_id;
  perform app.enqueue_notification(v_student,
    case new.to_status when 'changes_required' then 'document_changes_required' when 'rejected' then 'document_rejected' else 'document_approved' end,
    jsonb_build_object('document', v_doc, 'reason', new.reason));
  return null;
end $$;
create trigger document_reviews_notify after insert on document_reviews
  for each row execute function app.notify_on_document_review();

create or replace function app.notify_on_student_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform app.enqueue_notification(new.id, 'student_registered', '{}'::jsonb);
  elsif new.visa_outcome is distinct from old.visa_outcome and new.visa_outcome in ('approved', 'rejected', 'pending') then
    perform app.enqueue_notification(new.id, 'visa_outcome', jsonb_build_object('visa_outcome', new.visa_outcome));
  end if;
  return null;
end $$;
-- runs after the access/checklist triggers ("zzz")
create trigger students_zzz_notify after insert or update of visa_outcome on students
  for each row execute function app.notify_on_student_change();

-- Sender API (used by the application's dispatcher, protected by CRON_SECRET at
-- the HTTP layer). Claims due messages atomically so parallel runs never double-send.
create or replace function app.claim_notifications(p_limit int) returns setof notification_messages
language sql security definer set search_path = public, pg_temp as $$
  update notification_messages m set status = 'sending', attempts = attempts + 1
    from (select id from notification_messages where status = 'queued' and next_attempt_at <= now()
           order by next_attempt_at limit least(greatest(p_limit, 1), 200) for update skip locked) due
   where m.id = due.id
  returning m.*
$$;

create or replace function app.finish_notification(p_id uuid, p_status text, p_provider text, p_provider_id text, p_error text,
                                                   p_subject text, p_body text, p_retry_in_seconds int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('sent', 'failed', 'skipped', 'test', 'queued') then raise exception 'invalid status'; end if;
  update notification_messages set
    status = p_status, provider = p_provider, provider_message_id = p_provider_id, last_error = left(p_error, 1000),
    subject = coalesce(p_subject, subject), body = coalesce(p_body, body),
    skip_reason = case when p_status = 'skipped' then left(p_error, 200) else skip_reason end,
    sent_at = case when p_status = 'sent' then now() else sent_at end,
    next_attempt_at = case when p_status = 'queued' then now() + make_interval(secs => greatest(p_retry_in_seconds, 30)) else next_attempt_at end
  where id = p_id and status = 'sending';
end $$;

-- Data needed to render and send a message (sender only)
create or replace function app.notification_context(p_id uuid)
returns table (org_code text, company text, student_name text, student_code text, parent_name text, stage text, counsellor text,
               template_subject text, template_body text, provider_template_name text, provider_params text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select o.code, o.name, s.full_name, s.student_code, s.parent_name, st.name,
         (select u.full_name from student_assignments a join user_profiles u on u.id = a.user_id
           where a.student_id = s.id and a.is_active and a.assignment_type = 'counsellor' limit 1),
         t.subject, t.body, t.provider_template_name, t.provider_params
    from notification_messages m
    join organizations o on o.id = m.org_id
    left join students s on s.id = m.student_id
    left join stages st on st.key = s.current_stage_key
    left join notification_templates t on t.id = m.template_id
   where m.id = p_id
$$;

-- Manual retry of a failed / skipped message (e.g. after consent was recorded)
create or replace function app.retry_notification(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_m notification_messages%rowtype;
begin
  select * into v_m from notification_messages where id = p_id for update;
  if not found or not app.has_perm(v_m.org_id, 'notifications.view') then raise exception 'message not found' using errcode = 'P0002'; end if;
  if v_m.status not in ('failed', 'skipped', 'test') then raise exception 'only failed, skipped or test messages can be retried' using errcode = '23514'; end if;
  if v_m.student_id is not null and not app.has_consent(v_m.student_id, v_m.channel, v_m.recipient_type) then
    raise exception 'there is no consent for this channel' using errcode = '23514';
  end if;
  update notification_messages set status = 'queued', next_attempt_at = now(), last_error = null, skip_reason = null where id = p_id;
  perform app.audit('retry', 'notification_messages', p_id::text, v_m.org_id, v_m.student_id);
end $$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table contact_consents enable row level security;
alter table notification_templates enable row level security;
alter table notification_rules enable row level security;
alter table notification_messages enable row level security;

create policy consents_select on contact_consents for select to erp_app using (app.can_read_student(student_id));
create policy templates_select on notification_templates for select to erp_app
  using (app.has_perm(org_id, 'notifications.manage') or app.has_perm(org_id, 'notifications.view'));
create policy templates_write on notification_templates for all to erp_app
  using (app.has_perm(org_id, 'notifications.manage')) with check (app.has_perm(org_id, 'notifications.manage'));
create policy rules_select on notification_rules for select to erp_app
  using (app.has_perm(org_id, 'notifications.manage') or app.has_perm(org_id, 'notifications.view'));
create policy rules_write on notification_rules for all to erp_app
  using (app.has_perm(org_id, 'notifications.manage')) with check (app.has_perm(org_id, 'notifications.manage'));
-- Outbox: notifications.view in the company, or contact permission for that student
create policy messages_select on notification_messages for select to erp_app
  using (app.has_perm(org_id, 'notifications.view')
         or (student_id is not null and app.can_on_student(student_id, 'students.contact.view')));

grant select on contact_consents, notification_messages to erp_app;
grant select, insert, update, delete on notification_templates, notification_rules to erp_app;
grant execute on function
  app.has_consent(uuid, text, text), app.record_consent(uuid, text, text, boolean, text),
  app.claim_notifications(int), app.finish_notification(uuid, text, text, text, text, text, text, int),
  app.notification_context(uuid), app.retry_notification(uuid)
to erp_app;
