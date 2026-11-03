-- =============================================================================
-- 0026 Leads and referrals (Phase 9, approved by the MD on 1 Nov 2026)
--
-- * Leads are company-specific (leads.read / leads.manage). Leads whose company
--   is uncertain sit in a CENTRAL REVIEW QUEUE (org_id null) seen by users with
--   leads.review, who route them to a company.
-- * Sources: manual entry, referral (portal or shared link), Leadist import
--   (CSV export; Leadist itself is never modified), other imports.
-- * Duplicates (same phone or email as another open lead or a student) are
--   FLAGGED for review – never merged automatically.
-- * Refer a Friend: each student gets a non-guessable code; referrals are routed
--   by programme (MBBS, Nursing, Medical PG → Dr.Expert Edulinks; Bachelor's,
--   General PG → GRADUATER; anything else → central review queue). Self-
--   referrals are refused. Students see only progress, never internal details.
--   Rewards / points are not implemented (disabled until configured).
-- * Conversion creates the student record through the normal registration and
--   links it; reaching Admission Letter marks the lead "Admission confirmed".
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('leads.read', 'Leads', 'View the company''s leads', false),
  ('leads.manage', 'Leads', 'Create, update, assign, import and convert leads of the company', false),
  ('leads.review', 'Leads', 'Central review queue: route leads with an uncertain company; review duplicates', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, v.p from roles r join (values ('manager', 'leads.read'), ('manager', 'leads.manage'), ('manager', 'leads.review'),
  ('counsellor', 'leads.read'), ('counsellor', 'leads.manage'), ('ceo', 'leads.read')) v(k, p) on r.key = v.k
on conflict do nothing;

create table leads (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid references organizations(id),          -- null = central review queue
  full_name               text not null check (length(btrim(full_name)) between 2 and 200),
  phone                   text check (phone is null or length(phone) <= 40),
  whatsapp                text check (whatsapp is null or length(whatsapp) <= 40),
  email                   text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_normalized        text generated always as (nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '')) stored,
  email_normalized        text generated always as (nullif(lower(btrim(coalesce(email, ''))), '')) stored,
  residence_country_id    uuid references countries(id),
  destination_country_id  uuid references countries(id),
  course_id               uuid references courses(id),
  programme               text check (programme in ('mbbs', 'nursing', 'medical_pg', 'bachelors', 'general_pg', 'other', 'not_sure')),
  qualification           text check (qualification is null or length(qualification) <= 200),
  preferred_company       text check (preferred_company is null or length(preferred_company) <= 120),
  remarks                 text check (remarks is null or length(remarks) <= 2000),
  source                  text not null check (source in ('manual', 'referral', 'leadist', 'import', 'web')),
  lead_source_id          uuid references lead_sources(id),
  external_ref            text check (external_ref is null or length(external_ref) <= 120),
  status                  text not null default 'new' check (status in ('new', 'contacted', 'interested', 'application_started',
                            'admission_confirmed', 'not_interested', 'closed', 'invalid')),
  assigned_to             uuid references user_profiles(id),
  next_followup_on        date,
  consent                 boolean not null default false,
  consent_at              timestamptz,
  duplicate_status        text not null default 'none' check (duplicate_status in ('none', 'possible', 'not_duplicate', 'duplicate')),
  duplicate_note          text,
  converted_student_id    uuid references students(id),
  closed_reason           text check (closed_reason is null or length(closed_reason) <= 500),
  created_by              uuid references user_profiles(id) default app.current_user_id(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (phone is not null or email is not null)
);
create index leads_org_status_idx on leads (org_id, status, created_at desc);
create index leads_phone_idx on leads (phone_normalized);
create index leads_email_idx on leads (email_normalized);
create unique index leads_external_ref on leads (source, external_ref) where external_ref is not null;
create trigger leads_touch before update on leads for each row execute function app.touch_updated_at();
create trigger leads_audit after insert or update on leads for each row execute function app.audit_row('org_id', '');

create table lead_activities (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references leads(id),
  kind        text not null check (kind in ('created', 'note', 'call', 'status', 'assignment', 'routing', 'followup', 'duplicate', 'conversion')),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  actor       uuid references user_profiles(id) default app.current_user_id(),
  created_at  timestamptz not null default now()
);
create index lead_activities_idx on lead_activities (lead_id, id desc);
create trigger lead_activities_immutable before update or delete on lead_activities for each row execute function app.audit_immutable();

create table referral_codes (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null unique references students(id),
  code        text not null unique check (code ~ '^[A-Z2-9]{10}$'),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table referrals (
  id                   uuid primary key default gen_random_uuid(),
  referral_code_id     uuid not null references referral_codes(id),
  referrer_student_id  uuid not null references students(id),
  lead_id              uuid not null unique references leads(id),
  channel              text not null check (channel in ('portal', 'link')),
  ip                   text,
  created_at           timestamptz not null default now()
);
create index referrals_referrer_idx on referrals (referrer_student_id, created_at desc);
alter table leads add column referral_id uuid references referrals(id);

-- Protected fields: origin and conversion change only through the functions below
create or replace function app.guard_lead() returns trigger
language plpgsql as $$
begin
  if (new.source, new.external_ref, new.created_by, new.created_at, new.consent_at) is distinct from
     (old.source, old.external_ref, old.created_by, old.created_at, old.consent_at)
     or ((new.converted_student_id is distinct from old.converted_student_id or new.referral_id is distinct from old.referral_id)
         and coalesce(current_setting('app.lead_change', true), 'off') <> 'on') then
    raise exception 'lead origin and conversion cannot be edited' using errcode = '42501';
  end if;
  if new.status in ('closed', 'not_interested', 'invalid') and new.status is distinct from old.status and coalesce(btrim(new.closed_reason), '') = '' then
    raise exception 'give the reason' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger leads_guard before update on leads for each row execute function app.guard_lead();

-- Routing by programme (the brief's rule)
create or replace function app.lead_route(p_programme text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from organizations where code = case
    when p_programme in ('mbbs', 'nursing', 'medical_pg') then 'EDX'
    when p_programme in ('bachelors', 'general_pg') then 'GRD' end
$$;

-- Duplicate flag (never merges)
create or replace function app.lead_flag_duplicates() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_hit text;
begin
  if new.duplicate_status in ('not_duplicate', 'duplicate') and tg_op = 'UPDATE'
     and new.phone_normalized is not distinct from old.phone_normalized and new.email_normalized is not distinct from old.email_normalized then
    return null;
  end if;
  select string_agg(x, '; ') into v_hit from (
    select 'lead ' || l.full_name || ' (' || coalesce(o.name, 'central queue') || ', ' || l.status || ')' as x
      from leads l left join organizations o on o.id = l.org_id
     where l.id <> new.id and l.status not in ('invalid', 'closed')
       and ((new.phone_normalized is not null and l.phone_normalized = new.phone_normalized) or (new.email_normalized is not null and l.email_normalized = new.email_normalized))
    union all
    select 'student ' || s.student_code from students s
     where s.status <> 'merged' and ((new.phone_normalized is not null and s.phone_normalized = new.phone_normalized)
        or (new.email_normalized is not null and s.email_normalized = new.email_normalized))
    limit 5) d;
  if v_hit is not null then
    update leads set duplicate_status = 'possible', duplicate_note = 'Same phone or email as: ' || v_hit where id = new.id and duplicate_status <> 'possible';
  elsif tg_op = 'UPDATE' and new.duplicate_status = 'possible' then
    update leads set duplicate_status = 'none', duplicate_note = null where id = new.id;
  end if;
  return null;
end $$;
create trigger leads_zz_duplicates after insert or update of phone, email on leads for each row execute function app.lead_flag_duplicates();

-- Activity log for important changes
create or replace function app.lead_log_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_activities (lead_id, kind, body, actor) values (new.id, 'created',
      'Lead created (' || new.source || case when new.org_id is null then ', central review queue' else '' end || ')', app.current_user_id());
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into lead_activities (lead_id, kind, body) values (new.id, 'status', replace(old.status, '_', ' ') || ' → ' || replace(new.status, '_', ' ')
      || coalesce(' – ' || nullif(btrim(new.closed_reason), ''), ''));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into lead_activities (lead_id, kind, body) values (new.id, 'assignment', 'Assigned to ' || coalesce((select full_name from user_profiles where id = new.assigned_to), 'nobody'));
  end if;
  if new.org_id is distinct from old.org_id then
    insert into lead_activities (lead_id, kind, body) values (new.id, 'routing', 'Routed to ' || coalesce((select name from organizations where id = new.org_id), 'the central review queue'));
  end if;
  if new.next_followup_on is distinct from old.next_followup_on and new.next_followup_on is not null then
    insert into lead_activities (lead_id, kind, body) values (new.id, 'followup', 'Next follow-up ' || to_char(new.next_followup_on, 'DD Mon YYYY'));
  end if;
  if new.duplicate_status is distinct from old.duplicate_status and new.duplicate_status in ('not_duplicate', 'duplicate') then
    insert into lead_activities (lead_id, kind, body) values (new.id, 'duplicate',
      case new.duplicate_status when 'duplicate' then 'Confirmed as a duplicate' else 'Reviewed: not a duplicate' end);
  end if;
  return null;
end $$;
create trigger leads_log after insert or update on leads for each row execute function app.lead_log_changes();

-- Conversion: link the student created through normal registration
create or replace function app.link_lead_student(p_lead uuid, p_student uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_l leads%rowtype; v_code text;
begin
  select * into v_l from leads where id = p_lead for update;
  if not found or v_l.org_id is null or not app.has_perm(v_l.org_id, 'leads.manage') then raise exception 'permission denied: leads.manage' using errcode = '42501'; end if;
  if v_l.converted_student_id is not null then raise exception 'this lead is already converted' using errcode = '23514'; end if;
  if not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  select student_code into v_code from students where id = p_student;
  perform set_config('app.lead_change', 'on', true);
  update leads set converted_student_id = p_student, status = 'application_started' where id = p_lead;
  perform set_config('app.lead_change', 'off', true);
  insert into lead_activities (lead_id, kind, body) values (p_lead, 'conversion', 'Registered as student ' || v_code);
end $$;

create or replace function app.lead_on_admission() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.to_stage = 'admission_letter' then
    update leads set status = 'admission_confirmed' where converted_student_id = new.student_id and status = 'application_started';
  end if;
  return null;
end $$;
create trigger student_stage_history_lead after insert on student_stage_history for each row execute function app.lead_on_admission();

-- -----------------------------------------------------------------------------
-- Refer a Friend
-- -----------------------------------------------------------------------------
create or replace function app.new_referral_code() returns text
language plpgsql volatile set search_path = public, pg_temp as $$
declare v text; c text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; i int;
begin
  loop
    v := '';
    b := uuid_send(gen_random_uuid());   -- 122 random bits; bytes 6 and 8 carry version/variant and are skipped
    foreach i in array array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12] loop v := v || substr(c, 1 + (get_byte(b, i) % 32), 1); end loop;
    exit when not exists (select 1 from referral_codes where code = v);
  end loop;
  return v;
end $$;

create or replace function app.portal_referral_code(p_token_hash text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid := app.portal_student(p_token_hash); v_code text;
begin
  if v_student is null then return null; end if;
  select code into v_code from referral_codes where student_id = v_student and is_active;
  if v_code is null and not exists (select 1 from referral_codes where student_id = v_student) then
    insert into referral_codes (student_id, code) values (v_student, app.new_referral_code()) returning code into v_code;
  end if;
  return v_code;
end $$;

-- Shared by the portal form and the public referral link
create or replace function app.create_referral(p_code text, p_channel text, p jsonb, p_ip text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rc referral_codes%rowtype; v_s students%rowtype; v_lead uuid; v_ref uuid; v_prog text := p ->> 'programme';
  v_phone text := nullif(btrim(p ->> 'phone'), ''); v_email text := nullif(lower(btrim(p ->> 'email')), '');
begin
  select * into v_rc from referral_codes where code = upper(btrim(p_code)) and is_active;
  if not found then raise exception 'this referral link is not valid' using errcode = 'P0002'; end if;
  select * into v_s from students where id = v_rc.student_id;
  if v_s.status = 'merged' or v_s.archived_at is not null then raise exception 'this referral link is not valid' using errcode = 'P0002'; end if;
  if coalesce((p ->> 'consent')::boolean, false) is not true then raise exception 'the friend''s consent to be contacted is required' using errcode = '23514'; end if;
  if coalesce(btrim(p ->> 'name'), '') = '' or (v_phone is null and v_email is null) then
    raise exception 'enter the friend''s name and a mobile number or email' using errcode = '23514';
  end if;
  if v_prog is null or v_prog not in ('mbbs', 'nursing', 'medical_pg', 'bachelors', 'general_pg', 'other', 'not_sure') then
    raise exception 'choose the course or programme' using errcode = '23514';
  end if;
  -- self-referral
  if (v_phone is not null and right(regexp_replace(v_phone, '\D', '', 'g'), 10) = v_s.phone_normalized)
     or (v_email is not null and v_email = v_s.email_normalized) then
    raise exception 'you cannot refer yourself' using errcode = '23514';
  end if;
  -- rate limits
  if (select count(*) from referrals where referral_code_id = v_rc.id and created_at > now() - interval '1 day') >= 20
     or (p_ip is not null and (select count(*) from referrals where ip = p_ip and created_at > now() - interval '1 hour') >= 10) then
    raise exception 'too many referrals; please try again later' using errcode = '23514';
  end if;
  insert into leads (org_id, full_name, phone, whatsapp, email, residence_country_id, destination_country_id, programme, qualification,
                     preferred_company, remarks, source, consent, consent_at, created_by)
  values (app.lead_route(v_prog), btrim(p ->> 'name'), v_phone, nullif(btrim(p ->> 'whatsapp'), ''), v_email,
          (select id from countries where id::text = p ->> 'residenceCountryId'), (select id from countries where id::text = p ->> 'destinationCountryId'),
          v_prog, left(nullif(btrim(p ->> 'qualification'), ''), 200), left(nullif(btrim(p ->> 'preferredCompany'), ''), 120),
          left(nullif(btrim(p ->> 'remarks'), ''), 2000), 'referral', true, now(), null)
  returning id into v_lead;
  insert into referrals (referral_code_id, referrer_student_id, lead_id, channel, ip) values (v_rc.id, v_rc.student_id, v_lead, p_channel, p_ip) returning id into v_ref;
  perform set_config('app.lead_change', 'on', true);
  update leads set referral_id = v_ref where id = v_lead;
  perform set_config('app.lead_change', 'off', true);
  insert into lead_activities (lead_id, kind, body, actor) values (v_lead, 'note', 'Referred by student ' || v_s.student_code
    || case p_channel when 'portal' then ' (student portal)' else ' (shared referral link)' end, null);
  perform app.audit('referral_created', 'leads', v_lead::text, v_s.originating_org_id, v_s.id, null, jsonb_build_object('channel', p_channel, 'ip', p_ip));
end $$;

create or replace function app.portal_submit_referral(p_token_hash text, p jsonb, p_ip text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := app.portal_referral_code(p_token_hash);
begin
  if v_code is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform app.create_referral(v_code, 'portal', p, p_ip);
end $$;

-- Public referral page: only the referrer's first name and company (no ids, no contact data)
create or replace function app.public_referral_info(p_code text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('first_name', split_part(s.full_name, ' ', 1), 'company', o.name)
    from referral_codes r join students s on s.id = r.student_id join organizations o on o.id = s.originating_org_id
   where r.code = upper(btrim(p_code)) and r.is_active and s.status <> 'merged' and s.archived_at is null
$$;

create or replace function app.public_submit_referral(p_code text, p jsonb, p_ip text) returns void
language sql security definer set search_path = public, pg_temp as $$
  select app.create_referral(p_code, 'link', p, p_ip)
$$;

-- Country names for the referral forms (public pages; names only)
create or replace function app.public_countries() returns table (id uuid, name text, is_destination boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select id, name, is_destination from countries where is_active order by name
$$;

-- What the referrer sees: friend's first name and a simplified status only
create or replace function app.portal_referrals(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', split_part(l.full_name, ' ', 1), 'created_at', r.created_at,
           'status', case l.status when 'new' then 'Received' when 'contacted' then 'Contacted' when 'interested' then 'Interested'
                                   when 'application_started' then 'Application started' when 'admission_confirmed' then 'Admission confirmed'
                                   else 'Closed' end) order by r.created_at desc), '[]')
    from referrals r join leads l on l.id = r.lead_id
   where r.referrer_student_id = app.portal_student(p_token_hash)
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table leads enable row level security;
alter table lead_activities enable row level security;
alter table referral_codes enable row level security;
alter table referrals enable row level security;
create policy leads_select on leads for select to erp_app
  using ((org_id is not null and app.has_perm(org_id, 'leads.read')) or (org_id is null and exists (select 1 from app.orgs_with_perm('leads.review'))));
create policy leads_insert on leads for insert to erp_app
  with check ((org_id is not null and app.has_perm(org_id, 'leads.manage')) or (org_id is null and exists (select 1 from app.orgs_with_perm('leads.review'))));
create policy leads_update on leads for update to erp_app
  using ((org_id is not null and app.has_perm(org_id, 'leads.manage')) or (org_id is null and exists (select 1 from app.orgs_with_perm('leads.review'))))
  with check ((org_id is not null and app.has_perm(org_id, 'leads.manage')) or (org_id is null and exists (select 1 from app.orgs_with_perm('leads.review'))));
create policy lead_activities_select on lead_activities for select to erp_app using (exists (select 1 from leads l where l.id = lead_id));
create policy lead_activities_insert on lead_activities for insert to erp_app
  with check (kind in ('note', 'call') and exists (select 1 from leads l where l.id = lead_id
              and ((l.org_id is not null and app.has_perm(l.org_id, 'leads.manage')) or (l.org_id is null and exists (select 1 from app.orgs_with_perm('leads.review'))))));
create policy referrals_select on referrals for select to erp_app using (exists (select 1 from leads l where l.id = lead_id));
create policy referral_codes_select on referral_codes for select to erp_app using (app.can_read_student(student_id));
grant select, insert on leads, lead_activities to erp_app;
grant update (org_id, full_name, phone, whatsapp, email, residence_country_id, destination_country_id, course_id, programme, qualification,
              preferred_company, remarks, lead_source_id, status, assigned_to, next_followup_on, duplicate_status, duplicate_note, closed_reason) on leads to erp_app;
grant select on referrals, referral_codes to erp_app;
grant usage on sequence lead_activities_id_seq to erp_app;
revoke all on function app.create_referral(text, text, jsonb, text) from public;
grant execute on function app.lead_route(text), app.link_lead_student(uuid, uuid), app.portal_referral_code(text), app.portal_submit_referral(text, jsonb, text),
  app.public_referral_info(text), app.public_submit_referral(text, jsonb, text), app.portal_referrals(text), app.public_countries() to erp_app;
