-- =============================================================================
-- 0014 Phase C: document verification rules, immutable verification records,
--      verify → submit → manager approval workflow, PDF annotations.
--
-- Status flow (enforced by app.document_action):
--   missing → uploaded → under_review → verified → pending_approval → approved
--                    ↘ changes_required / rejected (new upload restarts the flow)
--   approved → expired | changes_required (re-opened by an approver)
-- A new file version ALWAYS returns the document to "uploaded": verification
-- and approval never carry over to a new version.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('documents.approve',           'Documents', 'Manager approval of verified documents (cannot approve own verification)', true),
  ('documents.download',          'Documents', 'Download original document files (viewing in the app needs documents.file.view)', true),
  ('verification.rules.manage',   'Administration', 'Draft document verification rules (mandatory wording, checks)', false),
  ('verification.rules.approve',  'Administration', 'Approve verification rules so they take effect', true)
on conflict (key) do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p from roles r cross join lateral (values
  ('manager', 'documents.approve'), ('manager', 'documents.download'),
  ('documentation', 'documents.download'), ('visa', 'documents.download'),
  ('system_admin', 'verification.rules.manage')) v(k, p)
where r.key = v.k
on conflict do nothing;

insert into document_types (key, name, category, has_expiry, sort_order)
values ('bonafide_certificate', 'Bonafide Certificate', 'academic', false, 35)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- New statuses and workflow columns
-- -----------------------------------------------------------------------------
alter table student_documents drop constraint student_documents_status_check;
alter table student_documents add constraint student_documents_status_check
  check (status in ('missing', 'uploaded', 'under_review', 'changes_required', 'rejected', 'verified',
                    'pending_approval', 'approved', 'expired'));
alter table student_documents drop constraint student_documents_check;
alter table student_documents add constraint student_documents_reason_check
  check (status not in ('rejected', 'changes_required') or coalesce(btrim(rejection_reason), '') <> '');
alter table student_documents
  add column verified_by uuid references user_profiles(id),
  add column verified_at timestamptz,
  add column submitted_by uuid references user_profiles(id),
  add column submitted_at timestamptz,
  add column approved_by uuid references user_profiles(id),
  add column approved_at timestamptz,
  add column approved_file_id uuid references document_files(id);
update student_documents set approved_file_id = current_file_id, approved_by = reviewed_by, approved_at = reviewed_at
 where status = 'approved';

-- Workflow columns are only changed by the functions below.
create or replace function app.guard_document_status() returns trigger
language plpgsql as $$
begin
  if (new.status is distinct from old.status
      or new.current_file_id is distinct from old.current_file_id
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.rejection_reason is distinct from old.rejection_reason
      or new.original_location is distinct from old.original_location
      or new.verified_by is distinct from old.verified_by
      or new.submitted_by is distinct from old.submitted_by
      or new.approved_by is distinct from old.approved_by
      or new.approved_file_id is distinct from old.approved_file_id)
     and coalesce(current_setting('app.doc_change', true), 'off') <> 'on' then
    raise exception 'document status can only be changed through the review workflow' using errcode = '42501';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Verification rules (versioned; take effect only once approved)
-- -----------------------------------------------------------------------------
create table verification_rules (
  id                             uuid primary key default gen_random_uuid(),
  rule_group_id                  uuid not null default gen_random_uuid(),
  version                        int not null default 1 check (version >= 1),
  name                           text not null check (length(btrim(name)) between 3 and 200),
  description                    text,
  document_type_id               uuid not null references document_types(id),
  previous_education_country_id  uuid references countries(id),
  destination_country_id         uuid references countries(id),
  university_id                  uuid references universities(id),
  course_id                      uuid references courses(id),
  status                         text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  effective_from                 date,
  effective_to                   date,
  created_by                     uuid references user_profiles(id) default app.current_user_id(),
  created_at                     timestamptz not null default now(),
  approved_by                    uuid references user_profiles(id),
  approved_at                    timestamptz,
  unique (rule_group_id, version),
  check (status <> 'approved' or (effective_from is not null and approved_at is not null))
);
create unique index verification_rules_one_draft on verification_rules (rule_group_id) where status = 'draft';
create index verification_rules_doc_idx on verification_rules (document_type_id) where status = 'approved';

create table verification_requirements (
  id              uuid primary key default gen_random_uuid(),
  rule_id         uuid not null references verification_rules(id) on delete cascade,
  sort_order      int not null default 100,
  kind            text not null check (kind in ('exact_phrase', 'keywords', 'statement', 'manual_check')),
  text            text not null check (length(btrim(text)) between 2 and 2000),
  keywords        text[] not null default '{}',
  is_mandatory    boolean not null default true,
  guidance        text,
  created_at      timestamptz not null default now()
);
create index verification_requirements_rule_idx on verification_requirements (rule_id, sort_order);

-- Approved rules are frozen: change them by creating a new version.
create or replace function app.guard_rule_frozen() returns trigger
language plpgsql as $$
declare v_status text;
begin
  if tg_table_name = 'verification_rules' then
    if old.status <> 'draft' and coalesce(current_setting('app.rule_change', true), 'off') <> 'on' then
      raise exception 'approved rules cannot be edited; create a new version' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from verification_rules where id = coalesce(new.rule_id, old.rule_id);
  if v_status <> 'draft' then
    raise exception 'requirements of an approved rule cannot be changed; create a new version' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger verification_rules_frozen before update or delete on verification_rules
  for each row execute function app.guard_rule_frozen();
create trigger verification_requirements_frozen before insert or update or delete on verification_requirements
  for each row execute function app.guard_rule_frozen();
create trigger verification_rules_audit after insert or update or delete on verification_rules
  for each row execute function app.audit_row('', '');
create trigger verification_requirements_audit after insert or update or delete on verification_requirements
  for each row execute function app.audit_row('', '');

-- Approve a draft: it becomes effective today; the previous version is retired.
create or replace function app.approve_verification_rule(p_rule uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r verification_rules%rowtype;
begin
  if not exists (select 1 from app.orgs_with_perm('verification.rules.approve')) then
    raise exception 'permission denied: verification.rules.approve' using errcode = '42501';
  end if;
  select * into v_r from verification_rules where id = p_rule for update;
  if not found or v_r.status <> 'draft' then raise exception 'only draft rules can be approved' using errcode = '23514'; end if;
  if not exists (select 1 from verification_requirements where rule_id = p_rule) then
    raise exception 'add at least one requirement before approving' using errcode = '23514';
  end if;
  perform set_config('app.rule_change', 'on', true);
  update verification_rules set status = 'retired', effective_to = current_date
   where rule_group_id = v_r.rule_group_id and status = 'approved';
  update verification_rules set status = 'approved', effective_from = current_date, approved_by = app.current_user_id(), approved_at = now()
   where id = p_rule;
  perform set_config('app.rule_change', 'off', true);
end $$;

-- Copy an approved rule into a new draft version.
create or replace function app.new_rule_version(p_rule uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r verification_rules%rowtype; v_new uuid;
begin
  if not exists (select 1 from app.orgs_with_perm('verification.rules.manage')) then
    raise exception 'permission denied: verification.rules.manage' using errcode = '42501';
  end if;
  select * into v_r from verification_rules where id = p_rule;
  if not found then raise exception 'rule not found' using errcode = 'P0002'; end if;
  if exists (select 1 from verification_rules where rule_group_id = v_r.rule_group_id and status = 'draft') then
    raise exception 'a draft version already exists' using errcode = '23514';
  end if;
  insert into verification_rules (rule_group_id, version, name, description, document_type_id, previous_education_country_id,
                                  destination_country_id, university_id, course_id, created_by)
  select v_r.rule_group_id, (select max(version) + 1 from verification_rules where rule_group_id = v_r.rule_group_id),
         v_r.name, v_r.description, v_r.document_type_id, v_r.previous_education_country_id, v_r.destination_country_id,
         v_r.university_id, v_r.course_id, app.current_user_id()
  returning id into v_new;
  insert into verification_requirements (rule_id, sort_order, kind, text, keywords, is_mandatory, guidance)
  select v_new, sort_order, kind, text, keywords, is_mandatory, guidance from verification_requirements where rule_id = p_rule;
  return v_new;
end $$;

-- Which approved rules apply to a checklist item (by document type and the
-- student's previous-education country, destination, university and course;
-- an empty scope field means "any").
create or replace function app.applicable_rules(p_document uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id
    from student_documents d
    join students s on s.id = d.student_id
    join verification_rules r on r.document_type_id = d.document_type_id and r.status = 'approved'
   where d.id = p_document
     and r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)
     and (r.previous_education_country_id is null or r.previous_education_country_id = s.previous_education_country_id)
     and (r.destination_country_id is null or r.destination_country_id = s.destination_country_id)
     and (r.university_id is null or r.university_id = s.preferred_university_id)
     and (r.course_id is null or r.course_id = s.course_id)
$$;

-- -----------------------------------------------------------------------------
-- Verification records: append-only, tied to the exact file version and rule version
-- -----------------------------------------------------------------------------
create table document_verifications (
  id                   bigint generated always as identity primary key,
  student_document_id  uuid not null references student_documents(id),
  file_id              uuid not null references document_files(id),
  rule_id              uuid not null references verification_rules(id),
  rule_version         int not null,
  requirement_id       uuid not null references verification_requirements(id),
  requirement_text     text not null,
  result               text not null check (result in ('present', 'absent', 'not_applicable')),
  detected             boolean,
  comment              text check (comment is null or length(comment) <= 2000),
  verified_by          uuid not null references user_profiles(id),
  verified_at          timestamptz not null default now()
);
create index document_verifications_doc_idx on document_verifications (student_document_id, file_id, requirement_id, verified_at desc);
create trigger document_verifications_immutable before update or delete on document_verifications
  for each row execute function app.audit_immutable();
create trigger document_verifications_no_truncate before truncate on document_verifications
  for each statement execute function app.audit_immutable();

create or replace function app.record_verification(p_document uuid, p_requirement uuid, p_result text, p_comment text, p_detected boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc student_documents%rowtype; v_req verification_requirements%rowtype; v_rule verification_rules%rowtype;
begin
  select * into v_doc from student_documents where id = p_document for update;
  if not found or not app.can_read_student(v_doc.student_id) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_doc.student_id, 'documents.review') then
    raise exception 'permission denied: documents.review' using errcode = '42501';
  end if;
  if v_doc.status not in ('uploaded', 'under_review') or v_doc.current_file_id is null then
    raise exception 'verification can only be recorded while the current file is being reviewed' using errcode = '23514';
  end if;
  select * into v_req from verification_requirements where id = p_requirement;
  select * into v_rule from verification_rules where id = v_req.rule_id;
  if v_req.id is null or v_rule.id not in (select app.applicable_rules(p_document)) then
    raise exception 'this requirement does not apply to the document' using errcode = '23514';
  end if;
  if p_result = 'not_applicable' and v_req.is_mandatory then
    raise exception 'a mandatory requirement cannot be marked not applicable' using errcode = '23514';
  end if;
  if p_result = 'absent' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'add a comment explaining what is missing' using errcode = '23514';
  end if;
  insert into document_verifications (student_document_id, file_id, rule_id, rule_version, requirement_id, requirement_text,
                                      result, detected, comment, verified_by)
  values (p_document, v_doc.current_file_id, v_rule.id, v_rule.version, v_req.id, v_req.text,
          p_result, p_detected, nullif(btrim(p_comment), ''), app.current_user_id());
  if v_doc.status = 'uploaded' then
    perform set_config('app.doc_change', 'on', true);
    update student_documents set status = 'under_review', reviewed_by = app.current_user_id(), reviewed_at = now() where id = p_document;
    perform set_config('app.doc_change', 'off', true);
    insert into document_reviews (student_document_id, file_id, from_status, to_status, reviewed_by)
    values (p_document, v_doc.current_file_id, 'uploaded', 'under_review', app.current_user_id());
  end if;
end $$;

-- Mandatory requirements of applicable rules whose latest result for the
-- CURRENT file is not "present".
create or replace function app.unmet_requirements(p_document uuid) returns table (requirement_id uuid, text text)
language sql stable security definer set search_path = public, pg_temp as $$
  select q.id, q.text
    from verification_requirements q
    join student_documents d on d.id = p_document
   where q.rule_id in (select app.applicable_rules(p_document)) and q.is_mandatory
     and coalesce((select v.result from document_verifications v
                    where v.student_document_id = d.id and v.file_id = d.current_file_id and v.requirement_id = q.id
                    order by v.verified_at desc, v.id desc limit 1), 'missing') <> 'present'
$$;

-- -----------------------------------------------------------------------------
-- Workflow actions
-- -----------------------------------------------------------------------------
create or replace function app.document_action(p_document uuid, p_action text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc student_documents%rowtype;
  v_type document_types%rowtype;
  v_org uuid;
  v_to text;
  v_me uuid := app.current_user_id();
  v_needs text;
begin
  select * into v_doc from student_documents where id = p_document for update;
  if not found or not app.can_read_student(v_doc.student_id) then raise exception 'document not found' using errcode = 'P0002'; end if;

  case p_action
    when 'start_review' then
      v_needs := 'documents.review';
      if v_doc.status <> 'uploaded' then raise exception 'only newly uploaded documents can be taken into review' using errcode = '23514'; end if;
      v_to := 'under_review';
    when 'verify' then
      v_needs := 'documents.review';
      if v_doc.status not in ('uploaded', 'under_review') then raise exception 'only documents under review can be marked verified' using errcode = '23514'; end if;
      if exists (select 1 from app.unmet_requirements(p_document)) then
        raise exception 'all mandatory checks must be ticked as present for the current version first' using errcode = '23514';
      end if;
      v_to := 'verified';
    when 'submit' then
      v_needs := 'documents.review';
      if v_doc.status <> 'verified' then raise exception 'only verified documents can be submitted for approval' using errcode = '23514'; end if;
      v_to := 'pending_approval';
    when 'approve' then
      v_needs := 'documents.approve';
      if v_doc.status <> 'pending_approval' then raise exception 'only documents awaiting approval can be approved' using errcode = '23514'; end if;
      if v_doc.verified_by = v_me or v_doc.submitted_by = v_me then
        raise exception 'a different person must approve: you verified or submitted this document' using errcode = '42501';
      end if;
      if exists (select 1 from app.unmet_requirements(p_document)) then
        raise exception 'the current version has unmet mandatory checks' using errcode = '23514';
      end if;
      v_to := 'approved';
    when 'request_changes' then
      v_needs := case when v_doc.status in ('pending_approval', 'approved') then 'documents.approve' else 'documents.review' end;
      if v_doc.status not in ('uploaded', 'under_review', 'verified', 'pending_approval', 'approved') then
        raise exception 'changes cannot be requested in this status' using errcode = '23514';
      end if;
      v_to := 'changes_required';
    when 'reject' then
      v_needs := case when v_doc.status = 'pending_approval' then 'documents.approve' else 'documents.review' end;
      if v_doc.status not in ('uploaded', 'under_review', 'verified', 'pending_approval') then
        raise exception 'the document cannot be rejected in this status' using errcode = '23514';
      end if;
      v_to := 'rejected';
    when 'expire' then
      v_needs := 'documents.review';
      if v_doc.status <> 'approved' then raise exception 'only approved documents can be marked expired' using errcode = '23514'; end if;
      v_to := 'expired';
    else
      raise exception 'unknown action' using errcode = '23514';
  end case;

  if not app.can_on_student(v_doc.student_id, v_needs) then
    raise exception 'permission denied: %', v_needs using errcode = '42501';
  end if;
  if p_action in ('request_changes', 'reject', 'expire') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = '23514';
  end if;

  perform set_config('app.doc_change', 'on', true);
  update student_documents set
    status = v_to,
    rejection_reason = case when v_to in ('rejected', 'changes_required') then btrim(p_reason) else null end,
    reviewed_by = v_me, reviewed_at = now(),
    verified_by = case when v_to = 'verified' then v_me else verified_by end,
    verified_at = case when v_to = 'verified' then now() else verified_at end,
    submitted_by = case when v_to = 'pending_approval' then v_me else submitted_by end,
    submitted_at = case when v_to = 'pending_approval' then now() else submitted_at end,
    approved_by = case when v_to = 'approved' then v_me when v_to in ('changes_required', 'rejected') then null else approved_by end,
    approved_at = case when v_to = 'approved' then now() when v_to in ('changes_required', 'rejected') then null else approved_at end,
    approved_file_id = case when v_to = 'approved' then current_file_id when v_to in ('changes_required', 'rejected') then null else approved_file_id end
  where id = p_document;
  perform set_config('app.doc_change', 'off', true);

  insert into document_reviews (student_document_id, file_id, from_status, to_status, reason, reviewed_by)
  values (p_document, v_doc.current_file_id, v_doc.status, v_to, nullif(btrim(p_reason), ''), v_me);
  select * into v_type from document_types where id = v_doc.document_type_id;
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', p_action,
    v_type.name || case when v_doc.label <> '' then ' – ' || v_doc.label else '' end || ': '
    || replace(v_doc.status, '_', ' ') || ' → ' || replace(v_to, '_', ' ')
    || case when coalesce(btrim(p_reason), '') <> '' then ' (' || btrim(p_reason) || ')' else '' end,
    'student_documents', p_document::text);
end $$;

-- A new upload resets everything for the new version.
create or replace function app.register_document_file(
  p_document uuid, p_storage_key text, p_filename text, p_mime text, p_size int, p_sha256 text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc student_documents%rowtype;
  v_type document_types%rowtype;
  v_version int;
  v_file uuid;
  v_org uuid;
begin
  select * into v_doc from student_documents where id = p_document for update;
  if not found or not app.can_read_student(v_doc.student_id) then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if not app.can_on_student(v_doc.student_id, 'documents.upload') then
    raise exception 'permission denied: documents.upload' using errcode = '42501';
  end if;
  select * into v_type from document_types where id = v_doc.document_type_id;
  select coalesce(max(version), 0) + 1 into v_version from document_files where student_document_id = p_document;
  insert into document_files (student_document_id, version, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
  values (p_document, v_version, p_storage_key, p_filename, p_mime, p_size, p_sha256, app.current_user_id())
  returning id into v_file;
  perform set_config('app.doc_change', 'on', true);
  update student_documents set current_file_id = v_file, status = 'uploaded', rejection_reason = null,
         reviewed_by = null, reviewed_at = null, verified_by = null, verified_at = null,
         submitted_by = null, submitted_at = null, approved_by = null, approved_at = null, approved_file_id = null
   where id = p_document;
  perform set_config('app.doc_change', 'off', true);
  insert into document_reviews (student_document_id, file_id, from_status, to_status, reviewed_by)
  values (p_document, v_file, v_doc.status, 'uploaded', app.current_user_id());
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'uploaded',
                        v_type.name || case when v_doc.label <> '' then ' – ' || v_doc.label else '' end
                        || ' uploaded (version ' || v_version || ')'
                        || case when v_doc.status in ('approved', 'pending_approval', 'verified') then ' – previous verification/approval no longer applies' else '' end,
                        'student_documents', p_document::text);
  return v_file;
end $$;

-- The old single-step status function is retired.
revoke execute on function app.set_document_status(uuid, text, text) from erp_app;

-- -----------------------------------------------------------------------------
-- Annotations (highlights / comments) linked to a file version and page
-- -----------------------------------------------------------------------------
create table document_annotations (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references document_files(id),
  page         int not null check (page >= 1),
  rects        jsonb not null default '[]'::jsonb,
  quote        text check (quote is null or length(quote) <= 2000),
  body         text not null check (length(btrim(body)) between 1 and 4000),
  created_by   uuid not null references user_profiles(id) default app.current_user_id(),
  created_at   timestamptz not null default now()
);
create index document_annotations_file_idx on document_annotations (file_id, page);
create trigger document_annotations_immutable before update or delete on document_annotations
  for each row execute function app.audit_immutable();

-- Can the current user see / open files of this document file?
create or replace function app.can_view_file(p_file uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from document_files f join student_documents d on d.id = f.student_document_id
                  where f.id = p_file and app.can_on_student(d.student_id, 'documents.file.view'))
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table verification_rules enable row level security;
alter table verification_requirements enable row level security;
alter table document_verifications enable row level security;
alter table document_annotations enable row level security;

create policy verification_rules_select on verification_rules for select to erp_app using (app.current_user_id() is not null);
create policy verification_rules_write on verification_rules for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('verification.rules.manage')))
  with check (exists (select 1 from app.orgs_with_perm('verification.rules.manage')) and status = 'draft');
create policy verification_requirements_select on verification_requirements for select to erp_app using (app.current_user_id() is not null);
create policy verification_requirements_write on verification_requirements for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('verification.rules.manage')))
  with check (exists (select 1 from app.orgs_with_perm('verification.rules.manage')));
create policy document_verifications_select on document_verifications for select to erp_app
  using (exists (select 1 from student_documents d where d.id = student_document_id));
create policy document_annotations_select on document_annotations for select to erp_app using (app.can_view_file(file_id));
create policy document_annotations_insert on document_annotations for insert to erp_app
  with check (created_by = app.current_user_id() and app.can_view_file(file_id));

grant select, insert, update, delete on verification_rules, verification_requirements to erp_app;
grant select on document_verifications to erp_app;
grant select, insert on document_annotations to erp_app;

grant execute on function
  app.approve_verification_rule(uuid), app.new_rule_version(uuid), app.applicable_rules(uuid),
  app.record_verification(uuid, uuid, text, text, boolean), app.unmet_requirements(uuid),
  app.document_action(uuid, text, text), app.can_view_file(uuid)
to erp_app;

-- Downloading the original file is a separate, audited permission.
create or replace function app.authorize_file_download(p_file uuid) returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_file document_files%rowtype; v_doc student_documents%rowtype; v_org uuid;
begin
  select * into v_file from document_files where id = p_file;
  if found then select * into v_doc from student_documents where id = v_file.student_document_id; end if;
  if v_file.id is null or not app.can_read_student(v_doc.student_id) or not app.can_on_student(v_doc.student_id, 'documents.download') then
    perform app.audit('file_download', 'document_files', p_file::text, null, v_doc.student_id, null, null, 'denied');
    return;
  end if;
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.audit('file_download', 'document_files', p_file::text, v_org, v_doc.student_id, null,
                    jsonb_build_object('version', v_file.version, 'document_id', v_doc.id));
  return query select v_file.storage_key, v_file.mime_type, v_file.original_filename;
end $$;
grant execute on function app.authorize_file_download(uuid) to erp_app;
