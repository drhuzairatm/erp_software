-- Phase 7: pre-admission document verification. A separate request (DVR-YYYY-000001), before registration. It creates no student, student ID, portal account or admission application.
-- Linking to a student is a separate, explicit step. Results are a preliminary assessment, never a guarantee of admission or a visa. Document versions and review history are kept.
-- One number sequence per company per year: the numbering rule still needs the company's confirmation.

insert into permissions (key, category, description, is_sensitive) values
  ('dvr.create', 'Pre-admission', 'Create and follow own pre-admission verification requests', false),
  ('dvr.review', 'Pre-admission', 'Review pre-admission verification requests', false),
  ('dvr.manage', 'Pre-admission', 'See all pre-admission requests in the company and assign reviewers', false)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'dvr.create' from roles r where r.key in ('md', 'ceo', 'manager', 'counsellor') on conflict do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'dvr.review' from roles r where r.key in ('md', 'ceo', 'documentation') on conflict do nothing;
insert into role_permissions (role_id, permission_key) select r.id, 'dvr.manage' from roles r where r.key in ('md', 'ceo', 'manager') on conflict do nothing;

create table dvr_counters (
  org_id uuid not null references organizations(id),
  year   int not null,
  last   int not null,
  primary key (org_id, year)
);

create table dvr_requests (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id),
  dvr_number             text not null check (dvr_number ~ '^DVR-[0-9]{4}-[0-9]{6,}$'),
  status                 text not null default 'draft' check (status in ('draft', 'submitted', 'new_request', 'assigned', 'under_verification', 'additional_documents_required', 'correction_required', 'pending_further_review', 'verification_completed', 'returned_to_counselor', 'resubmitted', 'closed', 'cancelled')),
  prospect_name          text not null check (length(btrim(prospect_name)) between 2 and 150),
  prospect_phone         text check (prospect_phone is null or length(prospect_phone) <= 40),
  prospect_email         text check (prospect_email is null or length(prospect_email) <= 200),
  destination_country_id uuid not null references countries(id),
  university_id          uuid references universities(id),
  university_text        text check (university_text is null or length(university_text) <= 200),
  course_id              uuid references courses(id),
  programme_text         text check (programme_text is null or length(programme_text) <= 200),
  intake                 text check (intake is null or length(intake) <= 80),
  academic_year          text check (academic_year is null or length(academic_year) <= 20),
  remarks                text check (remarks is null or length(remarks) <= 4000),
  special_instructions   text check (special_instructions is null or length(special_instructions) <= 4000),
  counsellor_id          uuid not null references user_profiles(id),
  reviewer_id            uuid references user_profiles(id),
  assigned_at            timestamptz,
  started_at             timestamptz,
  overall_result         text check (overall_result in ('possible', 'possible_with_conditions', 'not_possible', 'pending_further_review')),
  overall_notes          text check (overall_notes is null or length(overall_notes) <= 4000),
  reverification_required boolean not null default false,
  submitted_at           timestamptz,
  completed_at           timestamptz,
  returned_at            timestamptz,
  closed_at              timestamptz,
  cancelled_at           timestamptz,
  linked_student_id      uuid references students(id),
  linked_at              timestamptz,
  linked_by              uuid references user_profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (org_id, dvr_number)
);
create index dvr_requests_queue on dvr_requests (org_id, status, created_at desc);
create index dvr_requests_counsellor on dvr_requests (counsellor_id, created_at desc);
create index dvr_requests_student on dvr_requests (linked_student_id) where linked_student_id is not null;
create trigger dvr_requests_touch before update on dvr_requests for each row execute function app.touch_updated_at();

create table dvr_documents (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references dvr_requests(id),
  org_id       uuid not null references organizations(id),
  category     text not null check (length(btrim(category)) between 2 and 120),
  label        text check (label is null or length(label) <= 200),
  result       text check (result in ('verified', 'not_acceptable', 'correction_required', 'missing_document', 'additional_clarification_required')),
  result_notes text check (result_notes is null or length(result_notes) <= 2000),
  reviewed_by  uuid references user_profiles(id),
  reviewed_at  timestamptz,
  created_by   uuid not null references user_profiles(id),
  created_at   timestamptz not null default now(),
  removed_at   timestamptz
);
create index dvr_documents_request on dvr_documents (request_id, created_at);

-- Never overwritten: every review of every version stays.
create table dvr_document_reviews (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references dvr_documents(id),
  request_id  uuid not null references dvr_requests(id),
  file_id     uuid references secure_files(id),
  result      text not null,
  notes       text,
  reviewed_by uuid not null references user_profiles(id),
  reviewed_at timestamptz not null default now()
);
create index dvr_document_reviews_doc on dvr_document_reviews (document_id, reviewed_at);

create table dvr_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references dvr_requests(id),
  action      text not null,
  from_status text,
  to_status   text,
  note        text check (note is null or length(note) <= 4000),
  actor_id    uuid references user_profiles(id),
  created_at  timestamptz not null default now()
);
create index dvr_events_request on dvr_events (request_id, created_at);

create table dvr_field_changes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references dvr_requests(id),
  field       text not null,
  old_value   text,
  new_value   text,
  needs_reverification boolean not null,
  changed_by  uuid not null references user_profiles(id),
  changed_at  timestamptz not null default now()
);

create or replace function app.dvr_can_read(p_request uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from dvr_requests r where r.id = p_request and app.is_member(r.org_id)
    and (r.counsellor_id = app.current_user_id() or app.has_perm(r.org_id, 'dvr.manage') or (app.has_perm(r.org_id, 'dvr.review') and r.status <> 'draft')))
$$;
-- The counsellor who owns it, or a company manager.
create or replace function app.dvr_is_owner(p_request uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from dvr_requests r where r.id = p_request and app.is_member(r.org_id) and ((r.counsellor_id = app.current_user_id() and app.has_perm(r.org_id, 'dvr.create')) or app.has_perm(r.org_id, 'dvr.manage')))
$$;
create or replace function app.dvr_is_reviewer(p_request uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from dvr_requests r where r.id = p_request and r.reviewer_id = app.current_user_id() and app.has_perm(r.org_id, 'dvr.review'))
$$;
create or replace function app.dvr_can_change_documents(p_request uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.dvr_is_owner(p_request) and exists (select 1 from dvr_requests r where r.id = p_request and r.status in ('draft', 'additional_documents_required', 'correction_required', 'returned_to_counselor'))
$$;

alter table dvr_counters enable row level security;
alter table dvr_requests enable row level security;
alter table dvr_documents enable row level security;
alter table dvr_document_reviews enable row level security;
alter table dvr_events enable row level security;
alter table dvr_field_changes enable row level security;
create policy dvr_requests_select on dvr_requests for select to erp_app using (app.dvr_can_read(id));
create policy dvr_documents_select on dvr_documents for select to erp_app using (app.dvr_can_read(request_id));
create policy dvr_document_reviews_select on dvr_document_reviews for select to erp_app using (app.dvr_can_read(request_id));
create policy dvr_events_select on dvr_events for select to erp_app using (app.dvr_can_read(request_id));
create policy dvr_field_changes_select on dvr_field_changes for select to erp_app using (app.dvr_can_read(request_id));
grant select on dvr_requests, dvr_documents, dvr_document_reviews, dvr_events, dvr_field_changes to erp_app;

-- Records the action. Audit entries hold statuses only: never the prospect's details or any notes.
create or replace function app.dvr_log(p_request uuid, p_org uuid, p_action text, p_from text, p_to text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into dvr_events (request_id, action, from_status, to_status, note, actor_id) values (p_request, p_action, p_from, p_to, p_note, app.current_user_id());
  perform app.audit('dvr_' || p_action, 'dvr_requests', p_request::text, p_org, null, null, jsonb_build_object('from', p_from, 'to', p_to));
end $$;

create or replace function app.dvr_notify(p_org uuid, p_user uuid, p_event text, p_title text, p_request uuid, p_email boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.staff_notify(p_user, p_org, p_event, p_title, '/pre-admission/' || p_request, 'dvr', p_request, 'info', null, p_email);
end $$;

create or replace function app.dvr_notify_reviewers(p_org uuid, p_event text, p_title text, p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select distinct m.user_id from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active where m.org_id = p_org and m.is_active and app.role_has_perm(m.role_id, 'dvr.review') loop
    perform app.dvr_notify(p_org, r.user_id, p_event, p_title, p_request, false);
  end loop;
end $$;

create or replace function app.dvr_check(p jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_country uuid := nullif(p->>'destination_country_id', '')::uuid; v_uni uuid := nullif(p->>'university_id', '')::uuid; v_course uuid := nullif(p->>'course_id', '')::uuid;
begin
  if length(btrim(coalesce(p->>'prospect_name', ''))) < 2 then raise exception 'Enter the name of the prospective student.' using errcode = '23514'; end if;
  if coalesce(btrim(p->>'prospect_phone'), '') = '' and coalesce(btrim(p->>'prospect_email'), '') = '' then raise exception 'Enter a phone number or an email address.' using errcode = '23514'; end if;
  if v_country is null or not exists (select 1 from countries c where c.id = v_country and c.is_active) then raise exception 'Choose the destination country.' using errcode = '23514'; end if;
  if v_uni is not null and not exists (select 1 from universities u where u.id = v_uni and u.country_id = v_country and u.is_active) then raise exception 'That university is not in the chosen country.' using errcode = '23514'; end if;
  if v_course is not null and not exists (select 1 from courses c where c.id = v_course and c.is_active) then raise exception 'Choose an active programme.' using errcode = '23514'; end if;
end $$;

create or replace function app.dvr_create(p_org uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_year int := extract(year from (now() at time zone 'Asia/Kolkata'))::int; v_n int;
begin
  if not app.has_perm(p_org, 'dvr.create') then raise exception 'permission denied: pre-admission request' using errcode = '42501'; end if;
  perform app.dvr_check(p);
  insert into dvr_counters as c (org_id, year, last) values (p_org, v_year, 1) on conflict (org_id, year) do update set last = c.last + 1 returning last into v_n;
  insert into dvr_requests (org_id, dvr_number, prospect_name, prospect_phone, prospect_email, destination_country_id, university_id, university_text, course_id, programme_text, intake, academic_year, remarks, special_instructions, counsellor_id)
  values (p_org, 'DVR-' || v_year || '-' || lpad(v_n::text, 6, '0'), btrim(p->>'prospect_name'), nullif(btrim(p->>'prospect_phone'), ''), nullif(btrim(p->>'prospect_email'), ''), (p->>'destination_country_id')::uuid, nullif(p->>'university_id', '')::uuid,
          nullif(btrim(p->>'university_text'), ''), nullif(p->>'course_id', '')::uuid, nullif(btrim(p->>'programme_text'), ''), nullif(btrim(p->>'intake'), ''), nullif(btrim(p->>'academic_year'), ''), nullif(btrim(p->>'remarks'), ''), nullif(btrim(p->>'special_instructions'), ''), app.current_user_id())
  returning id into v_id;
  perform app.dvr_log(v_id, p_org, 'created', null, 'draft', null);
  return v_id;
end $$;

-- A change to country, university, programme or intake after review has started is logged and flags the request for re-verification. Finished results are not erased.
create or replace function app.dvr_update(p_request uuid, p jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_me uuid := app.current_user_id(); r record; v_changed int := 0; v_started boolean; v_uni uuid := nullif(p->>'university_id', '')::uuid; v_course uuid := nullif(p->>'course_id', '')::uuid; v_country uuid := nullif(p->>'destination_country_id', '')::uuid;
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_can_read(p_request) then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not app.dvr_is_owner(p_request) then raise exception 'permission denied: pre-admission request' using errcode = '42501'; end if;
  if v.status in ('closed', 'cancelled') then raise exception 'This request is finished.' using errcode = '23514'; end if;
  perform app.dvr_check(p);
  v_started := v.started_at is not null;
  for r in select * from (values
      ('Destination country', (select name from countries where id = v.destination_country_id), (select name from countries where id = v_country)),
      ('University', coalesce((select name from universities where id = v.university_id), v.university_text), coalesce((select name from universities where id = v_uni), nullif(btrim(p->>'university_text'), ''))),
      ('Programme', coalesce((select name from courses where id = v.course_id), v.programme_text), coalesce((select name from courses where id = v_course), nullif(btrim(p->>'programme_text'), ''))),
      ('Intake', v.intake, nullif(btrim(p->>'intake'), '')),
      ('Academic year', v.academic_year, nullif(btrim(p->>'academic_year'), ''))
    ) x(field, o, n) where x.o is distinct from x.n loop
    insert into dvr_field_changes (request_id, field, old_value, new_value, needs_reverification, changed_by) values (p_request, r.field, r.o, r.n, v_started, v_me);
    v_changed := v_changed + 1;
  end loop;
  update dvr_requests set prospect_name = btrim(p->>'prospect_name'), prospect_phone = nullif(btrim(p->>'prospect_phone'), ''), prospect_email = nullif(btrim(p->>'prospect_email'), ''), destination_country_id = v_country, university_id = v_uni,
    university_text = nullif(btrim(p->>'university_text'), ''), course_id = v_course, programme_text = nullif(btrim(p->>'programme_text'), ''), intake = nullif(btrim(p->>'intake'), ''), academic_year = nullif(btrim(p->>'academic_year'), ''),
    remarks = nullif(btrim(p->>'remarks'), ''), special_instructions = nullif(btrim(p->>'special_instructions'), ''), reverification_required = reverification_required or (v_started and v_changed > 0)
   where id = p_request;
  perform app.dvr_log(p_request, v.org_id, 'details_updated', v.status, v.status, null);
  if v_started and v_changed > 0 then
    if v.status in ('verification_completed', 'returned_to_counselor') then
      update dvr_requests set status = 'pending_further_review' where id = p_request;
      perform app.dvr_log(p_request, v.org_id, 'reverification_needed', v.status, 'pending_further_review', null);
    end if;
    perform app.dvr_notify(v.org_id, v.reviewer_id, 'dvr_changed', 'A pre-admission request changed and may need re-verification', p_request, false);
  end if;
  return v_started and v_changed > 0;
end $$;

create or replace function app.dvr_add_document(p_request uuid, p_category text, p_label text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  if not app.dvr_can_change_documents(p_request) then raise exception 'permission denied: documents can be changed only when the request is with the counsellor' using errcode = '42501'; end if;
  select org_id into v_org from dvr_requests where id = p_request;
  insert into dvr_documents (request_id, org_id, category, label, created_by) values (p_request, v_org, btrim(coalesce(p_category, '')), nullif(btrim(p_label), ''), app.current_user_id()) returning id into v_id;
  return v_id;
end $$;

-- Only something never reviewed and with no file, or anything still in a draft. Files themselves stay stored.
create or replace function app.dvr_remove_document(p_document uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d dvr_documents%rowtype; v_status text;
begin
  select * into v_d from dvr_documents d where d.id = p_document and d.removed_at is null for update;
  if v_d.id is null or not app.dvr_can_change_documents(v_d.request_id) then raise exception 'permission denied: document' using errcode = '42501'; end if;
  select status into v_status from dvr_requests where id = v_d.request_id;
  if v_status <> 'draft' and (exists (select 1 from dvr_document_reviews x where x.document_id = p_document) or exists (select 1 from secure_files f where f.context_type = 'dvr' and f.context_id = p_document)) then
    raise exception 'A document that has been reviewed or has files stays on the record.' using errcode = '23514';
  end if;
  update dvr_documents set removed_at = now() where id = p_document;
  perform app.dvr_log(v_d.request_id, v_d.org_id, 'document_removed', v_status, v_status, null);
end $$;

-- Every new version clears the current result, so it is reviewed again. Earlier versions and reviews stay.
create or replace function app.dvr_on_file() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d dvr_documents%rowtype; v_status text;
begin
  if new.mime_type <> 'application/pdf' then raise exception 'Only PDF files are accepted for verification.' using errcode = '23514'; end if;
  select * into v_d from dvr_documents where id = new.context_id;
  update dvr_documents set result = null, result_notes = null, reviewed_by = null, reviewed_at = null where id = new.context_id;
  select status into v_status from dvr_requests where id = v_d.request_id;
  perform app.dvr_log(v_d.request_id, v_d.org_id, 'document_version_added', v_status, v_status, null);
  return null;
end $$;
create trigger secure_files_dvr_version after insert on secure_files for each row when (new.context_type = 'dvr') execute function app.dvr_on_file();

create or replace function app.dvr_submit(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_owner(p_request) then raise exception 'permission denied: pre-admission request' using errcode = '42501'; end if;
  if v.status = 'draft' then
    if not exists (select 1 from dvr_documents d join secure_files f on f.context_type = 'dvr' and f.context_id = d.id and f.removed_at is null where d.request_id = p_request and d.removed_at is null) then
      raise exception 'Attach at least one document before submitting.' using errcode = '23514';
    end if;
    update dvr_requests set status = 'new_request', submitted_at = now() where id = p_request;
    perform app.dvr_log(p_request, v.org_id, 'submitted', 'draft', 'submitted', v_note);
    perform app.dvr_log(p_request, v.org_id, 'queued', 'submitted', 'new_request', null);
    perform app.dvr_notify_reviewers(v.org_id, 'dvr_new', 'A new pre-admission request needs verification', p_request);
  elsif v.status in ('additional_documents_required', 'correction_required', 'returned_to_counselor') then
    if exists (select 1 from dvr_documents d where d.request_id = p_request and d.removed_at is null and d.result in ('missing_document', 'correction_required')) then
      raise exception 'Upload the missing or corrected documents before resubmitting.' using errcode = '23514';
    end if;
    update dvr_requests set status = 'resubmitted', submitted_at = now() where id = p_request;
    perform app.dvr_log(p_request, v.org_id, 'resubmitted', v.status, 'resubmitted', v_note);
    if v.reviewer_id is not null then perform app.dvr_notify(v.org_id, v.reviewer_id, 'dvr_resubmitted', 'A pre-admission request was resubmitted', p_request, false);
    else perform app.dvr_notify_reviewers(v.org_id, 'dvr_resubmitted', 'A pre-admission request was resubmitted', p_request); end if;
  else raise exception 'This request cannot be submitted now.' using errcode = '23514';
  end if;
end $$;

create or replace function app.dvr_assign(p_request uuid, p_reviewer uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_me uuid := app.current_user_id(); v_new text;
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_can_read(p_request) then raise exception 'request not found' using errcode = 'P0002'; end if;
  if not (app.has_perm(v.org_id, 'dvr.manage') or (app.has_perm(v.org_id, 'dvr.review') and (p_reviewer = v_me or v.reviewer_id is not distinct from v_me))) then raise exception 'permission denied: assigning a reviewer' using errcode = '42501'; end if;
  if v.status in ('draft', 'closed', 'cancelled') then raise exception 'This request cannot be assigned now.' using errcode = '23514'; end if;
  if p_reviewer = v.counsellor_id then raise exception 'The counsellor who raised a request cannot review it.' using errcode = '23514'; end if;
  if not exists (select 1 from organization_memberships m where m.org_id = v.org_id and m.user_id = p_reviewer and m.is_active and app.role_has_perm(m.role_id, 'dvr.review')) then raise exception 'That person cannot review requests in this company.' using errcode = '23514'; end if;
  if v.reviewer_id is not null and v.reviewer_id <> v_me and v.reviewer_id <> p_reviewer and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give the reason for reassigning.' using errcode = '23514'; end if;
  v_new := case when v.status = 'new_request' then 'assigned' else v.status end;
  update dvr_requests set reviewer_id = p_reviewer, assigned_at = now(), status = v_new where id = p_request;
  perform app.dvr_log(p_request, v.org_id, case when v.reviewer_id is null then 'assigned' else 'reassigned' end, v.status, v_new, nullif(btrim(coalesce(p_reason, '')), ''));
  perform app.dvr_notify(v.org_id, p_reviewer, 'dvr_assigned', 'A pre-admission request was assigned to you', p_request, false);
end $$;

create or replace function app.dvr_start(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype;
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_reviewer(p_request) then raise exception 'permission denied: only the assigned reviewer starts verification' using errcode = '42501'; end if;
  if v.status not in ('assigned', 'resubmitted', 'pending_further_review') then raise exception 'Verification cannot start from this status.' using errcode = '23514'; end if;
  update dvr_requests set status = 'under_verification', started_at = coalesce(started_at, now()) where id = p_request;
  perform app.dvr_log(p_request, v.org_id, 'verification_started', v.status, 'under_verification', null);
end $$;

create or replace function app.dvr_review_document(p_document uuid, p_result text, p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d dvr_documents%rowtype; v_status text; v_file uuid; v_me uuid := app.current_user_id(); v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select * into v_d from dvr_documents d where d.id = p_document and d.removed_at is null for update;
  if v_d.id is null or not app.dvr_is_reviewer(v_d.request_id) then raise exception 'permission denied: only the assigned reviewer records results' using errcode = '42501'; end if;
  select status into v_status from dvr_requests where id = v_d.request_id;
  if v_status <> 'under_verification' then raise exception 'Start verification first.' using errcode = '23514'; end if;
  if p_result not in ('verified', 'not_acceptable', 'correction_required', 'missing_document', 'additional_clarification_required') then raise exception 'Choose a result.' using errcode = '23514'; end if;
  if p_result <> 'verified' and (v_notes is null or length(v_notes) < 3) then raise exception 'Say what is wrong, so the counsellor can act on it.' using errcode = '23514'; end if;
  select f.id into v_file from secure_files f where f.context_type = 'dvr' and f.context_id = p_document and f.removed_at is null order by f.uploaded_at desc, f.id desc limit 1;
  if v_file is null and p_result <> 'missing_document' then raise exception 'This document has no file to review.' using errcode = '23514'; end if;
  update dvr_documents set result = p_result, result_notes = v_notes, reviewed_by = v_me, reviewed_at = now() where id = p_document;
  insert into dvr_document_reviews (document_id, request_id, file_id, result, notes, reviewed_by) values (p_document, v_d.request_id, v_file, p_result, v_notes, v_me);
  perform app.dvr_log(v_d.request_id, v_d.org_id, 'document_reviewed', v_status, v_status, null);
end $$;

-- The reviewer names a document that was not supplied.
create or replace function app.dvr_request_document(p_request uuid, p_category text, p_notes text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_id uuid; v_me uuid := app.current_user_id();
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_reviewer(p_request) then raise exception 'permission denied: only the assigned reviewer requests documents' using errcode = '42501'; end if;
  if v.status <> 'under_verification' then raise exception 'Start verification first.' using errcode = '23514'; end if;
  if length(btrim(coalesce(p_notes, ''))) < 3 then raise exception 'Say what is needed.' using errcode = '23514'; end if;
  insert into dvr_documents (request_id, org_id, category, result, result_notes, reviewed_by, reviewed_at, created_by) values (p_request, v.org_id, btrim(coalesce(p_category, '')), 'missing_document', btrim(p_notes), v_me, now(), v_me) returning id into v_id;
  insert into dvr_document_reviews (document_id, request_id, result, notes, reviewed_by) values (v_id, p_request, 'missing_document', btrim(p_notes), v_me);
  perform app.dvr_log(p_request, v.org_id, 'document_requested', v.status, v.status, null);
  return v_id;
end $$;

-- Back to the counsellor for documents or corrections, or held internally for further review.
create or replace function app.dvr_send_back(p_request uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_note text := btrim(coalesce(p_note, ''));
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_reviewer(p_request) then raise exception 'permission denied: only the assigned reviewer does this' using errcode = '42501'; end if;
  if p_status not in ('additional_documents_required', 'correction_required', 'pending_further_review') then raise exception 'Choose where the request goes next.' using errcode = '23514'; end if;
  if v.status <> 'under_verification' then raise exception 'Start verification first.' using errcode = '23514'; end if;
  if length(v_note) < 3 then raise exception 'Add a note for the next person.' using errcode = '23514'; end if;
  update dvr_requests set status = p_status, returned_at = case when p_status <> 'pending_further_review' then now() else returned_at end where id = p_request;
  perform app.dvr_log(p_request, v.org_id, 'sent_back', v.status, p_status, v_note);
  if p_status <> 'pending_further_review' then perform app.dvr_notify(v.org_id, v.counsellor_id, 'dvr_action_needed', 'A pre-admission request needs your action', p_request, true); end if;
end $$;

create or replace function app.dvr_complete(p_request uuid, p_overall text, p_notes text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_notes text := nullif(btrim(coalesce(p_notes, '')), ''); v_new text;
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_reviewer(p_request) then raise exception 'permission denied: only the assigned reviewer completes verification' using errcode = '42501'; end if;
  if v.status <> 'under_verification' then raise exception 'Start verification first.' using errcode = '23514'; end if;
  if p_overall not in ('possible', 'possible_with_conditions', 'not_possible', 'pending_further_review') then raise exception 'Choose the overall assessment.' using errcode = '23514'; end if;
  if exists (select 1 from dvr_documents d where d.request_id = p_request and d.removed_at is null and d.result is null) then raise exception 'Record a result for every document first.' using errcode = '23514'; end if;
  if p_overall <> 'possible' and v_notes is null then raise exception 'Explain this assessment.' using errcode = '23514'; end if;
  v_new := case when p_overall = 'pending_further_review' then 'pending_further_review' else 'verification_completed' end;
  update dvr_requests set status = v_new, overall_result = p_overall, overall_notes = v_notes, completed_at = case when v_new = 'verification_completed' then now() end, reverification_required = case when v_new = 'verification_completed' then false else reverification_required end where id = p_request;
  perform app.dvr_log(p_request, v.org_id, 'assessment_recorded', v.status, v_new, null);
end $$;

create or replace function app.dvr_return(p_request uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype;
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_reviewer(p_request) then raise exception 'permission denied: only the assigned reviewer returns a request' using errcode = '42501'; end if;
  if v.status <> 'verification_completed' then raise exception 'Complete the verification first.' using errcode = '23514'; end if;
  update dvr_requests set status = 'returned_to_counselor', returned_at = now() where id = p_request;
  perform app.dvr_log(p_request, v.org_id, 'returned', v.status, 'returned_to_counselor', nullif(btrim(coalesce(p_note, '')), ''));
  perform app.dvr_notify(v.org_id, v.counsellor_id, 'dvr_returned', 'A pre-admission verification was returned to you', p_request, true);
end $$;

create or replace function app.dvr_close(p_request uuid, p_cancel boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_note text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not (app.dvr_is_owner(p_request) or (not p_cancel and app.dvr_is_reviewer(p_request))) then raise exception 'permission denied: pre-admission request' using errcode = '42501'; end if;
  if v.status in ('closed', 'cancelled') then raise exception 'This request is already finished.' using errcode = '23514'; end if;
  if p_cancel then
    if v_note is null or length(v_note) < 3 then raise exception 'Give the reason for cancelling.' using errcode = '23514'; end if;
    update dvr_requests set status = 'cancelled', cancelled_at = now() where id = p_request;
    perform app.dvr_log(p_request, v.org_id, 'cancelled', v.status, 'cancelled', v_note);
  else
    if v.status not in ('verification_completed', 'returned_to_counselor') then raise exception 'Only a completed verification can be closed.' using errcode = '23514'; end if;
    update dvr_requests set status = 'closed', closed_at = now() where id = p_request;
    perform app.dvr_log(p_request, v.org_id, 'closed', v.status, 'closed', v_note);
  end if;
end $$;

-- Explicit and separate from registration. Only records the link: it changes nothing on the student and creates nothing.
create or replace function app.dvr_link_student(p_request uuid, p_student uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_owner(p_request) then raise exception 'permission denied: pre-admission request' using errcode = '42501'; end if;
  if v.status not in ('verification_completed', 'returned_to_counselor', 'closed') then raise exception 'Link a student after verification is complete.' using errcode = '23514'; end if;
  if v.linked_student_id is not null then raise exception 'This request is already linked to a student.' using errcode = '23514'; end if;
  if not app.can_read_student(p_student) or not exists (select 1 from student_org_access a where a.student_id = p_student and a.org_id = v.org_id) then raise exception 'That student was not found in this company.' using errcode = '23514'; end if;
  update dvr_requests set linked_student_id = p_student, linked_at = now(), linked_by = v_me where id = p_request;
  perform app.audit('dvr_student_linked', 'dvr_requests', p_request::text, v.org_id, p_student, null, null);
  insert into dvr_events (request_id, action, from_status, to_status, actor_id) values (p_request, 'student_linked', v.status, v.status, v_me);
end $$;

create or replace function app.dvr_reviewers(p_org uuid) returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (app.has_perm(p_org, 'dvr.review') or app.has_perm(p_org, 'dvr.manage')) then return; end if;
  return query select distinct u.id, u.full_name from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active where m.org_id = p_org and m.is_active and app.role_has_perm(m.role_id, 'dvr.review') order by u.full_name;
end $$;

-- Secure files: a file belongs to one DVR document, and each upload is a version.
alter table secure_files drop constraint secure_files_context_type_check;
alter table secure_files add constraint secure_files_context_type_check check (context_type in ('task', 'employee', 'attendance', 'meeting', 'chat', 'dvr'));
create or replace function app.sf_dvr_org(p_context uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$ select org_id from dvr_documents where id = p_context $$;
create or replace function app.sf_dvr_read(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from dvr_documents d where d.id = p_context and app.dvr_can_read(d.request_id))
$$;
create or replace function app.sf_dvr_write(p_context uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from dvr_documents d where d.id = p_context and d.removed_at is null and app.dvr_can_change_documents(d.request_id))
$$;
create or replace function app.sf_org(p_type text, p_context uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return case p_type when 'task' then app.sf_task_org(p_context) when 'employee' then app.sf_employee_org(p_context) when 'attendance' then app.sf_attendance_org(p_context)
    when 'meeting' then app.sf_meeting_org(p_context) when 'chat' then app.sf_chat_org(p_context) when 'dvr' then app.sf_dvr_org(p_context) end;
end $$;
create or replace function app.secure_file_can_read(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_read(p_context) when 'employee' then app.sf_employee_read(p_context) when 'attendance' then app.sf_attendance_read(p_context)
    when 'meeting' then app.meeting_can_read(p_context) when 'chat' then app.sf_chat_read(p_context) when 'dvr' then app.sf_dvr_read(p_context) end, false);
end $$;
create or replace function app.secure_file_can_write(p_context_type text, p_context uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return coalesce(case p_context_type when 'task' then app.sf_task_write(p_context) when 'employee' then app.sf_employee_write(p_context) when 'attendance' then app.sf_attendance_write(p_context)
    when 'meeting' then app.meeting_can_edit(p_context) when 'chat' then app.sf_chat_write(p_context) when 'dvr' then app.sf_dvr_write(p_context) end, false);
end $$;
create or replace function app.remove_secure_file(p_file uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f secure_files%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v_f from secure_files f where f.id = p_file and f.removed_at is null for update;
  if not found or not app.secure_file_can_read(v_f.context_type, v_f.context_id) then raise exception 'file not found' using errcode = 'P0002'; end if;
  if v_f.context_type = 'dvr' then raise exception 'Every version of a verification document is kept.' using errcode = '23514'; end if;
  if not ((v_f.uploaded_by = v_me and app.secure_file_can_write(v_f.context_type, v_f.context_id))
          or (v_f.context_type = 'task' and app.has_perm(v_f.org_id, 'tasks.update.all'))
          or (v_f.context_type = 'employee' and app.has_perm(v_f.org_id, 'users.manage'))) then
    raise exception 'permission denied: secure file removal' using errcode = '42501';
  end if;
  update secure_files set removed_at = now(), removed_by = v_me where id = p_file;
  perform app.audit('secure_file_removed', 'secure_files', p_file::text, v_f.org_id, app.sf_student(v_f.context_type, v_f.context_id), null,
    jsonb_build_object('context_type', v_f.context_type, 'context_id', v_f.context_id));
end $$;

revoke execute on function app.dvr_can_read(uuid), app.dvr_is_owner(uuid), app.dvr_is_reviewer(uuid), app.dvr_can_change_documents(uuid), app.dvr_log(uuid, uuid, text, text, text, text), app.dvr_notify(uuid, uuid, text, text, uuid, boolean),
  app.dvr_notify_reviewers(uuid, text, text, uuid), app.dvr_check(jsonb), app.dvr_create(uuid, jsonb), app.dvr_update(uuid, jsonb), app.dvr_add_document(uuid, text, text), app.dvr_remove_document(uuid), app.dvr_on_file(), app.dvr_submit(uuid, text),
  app.dvr_assign(uuid, uuid, text), app.dvr_start(uuid), app.dvr_review_document(uuid, text, text), app.dvr_request_document(uuid, text, text), app.dvr_send_back(uuid, text, text), app.dvr_complete(uuid, text, text), app.dvr_return(uuid, text),
  app.dvr_close(uuid, boolean, text), app.dvr_link_student(uuid, uuid), app.dvr_reviewers(uuid), app.sf_dvr_org(uuid), app.sf_dvr_read(uuid), app.sf_dvr_write(uuid),
  app.sf_org(text, uuid), app.secure_file_can_read(text, uuid), app.secure_file_can_write(text, uuid), app.remove_secure_file(uuid) from public;
grant execute on function app.dvr_can_read(uuid), app.dvr_is_owner(uuid), app.dvr_is_reviewer(uuid), app.dvr_can_change_documents(uuid), app.dvr_create(uuid, jsonb), app.dvr_update(uuid, jsonb), app.dvr_add_document(uuid, text, text), app.dvr_remove_document(uuid),
  app.dvr_submit(uuid, text), app.dvr_assign(uuid, uuid, text), app.dvr_start(uuid), app.dvr_review_document(uuid, text, text), app.dvr_request_document(uuid, text, text), app.dvr_send_back(uuid, text, text), app.dvr_complete(uuid, text, text), app.dvr_return(uuid, text),
  app.dvr_close(uuid, boolean, text), app.dvr_link_student(uuid, uuid), app.dvr_reviewers(uuid) to erp_app;
