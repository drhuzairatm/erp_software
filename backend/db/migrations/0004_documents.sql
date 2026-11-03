-- =============================================================================
-- 0004 Documents: checklist items, private file versions, reviews, custody of
--      physical originals.
-- =============================================================================

create table student_documents (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references students(id),
  document_type_id   uuid not null references document_types(id),
  label              text not null default '' check (length(label) <= 120),
  is_required        boolean not null default true,
  status             text not null default 'missing'
                       check (status in ('missing', 'uploaded', 'under_review', 'approved', 'rejected', 'expired')),
  current_file_id    uuid,
  expiry_date        date,
  rejection_reason   text,
  reviewed_by        uuid references user_profiles(id),
  reviewed_at        timestamptz,
  original_location  text check (original_location in ('with_student', 'with_staff', 'with_provider', 'at_embassy',
                                                       'at_university', 'returned_to_student')),
  location_note      text,
  third_party_ref    text,
  notes              text,
  created_by         uuid references user_profiles(id) default app.current_user_id(),
  created_at         timestamptz not null default now(),
  updated_by         uuid references user_profiles(id),
  updated_at         timestamptz not null default now(),
  unique (student_id, document_type_id, label),
  check (status <> 'rejected' or coalesce(btrim(rejection_reason), '') <> '')
);
create index student_documents_status_idx on student_documents (status);
create trigger student_documents_touch before update on student_documents
  for each row execute function app.touch_updated_by();

create table document_files (
  id                   uuid primary key default gen_random_uuid(),
  student_document_id  uuid not null references student_documents(id),
  version              int not null check (version >= 1),
  storage_key          text not null unique,
  original_filename    text not null check (length(original_filename) <= 255),
  mime_type            text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes           int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256               text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by          uuid not null references user_profiles(id),
  uploaded_at          timestamptz not null default now(),
  unique (student_document_id, version)
);

alter table student_documents add constraint student_documents_current_file_fk
  foreign key (current_file_id) references document_files(id);

create table document_reviews (
  id                   uuid primary key default gen_random_uuid(),
  student_document_id  uuid not null references student_documents(id),
  file_id              uuid references document_files(id),
  from_status          text not null,
  to_status            text not null,
  reason               text,
  reviewed_by          uuid not null references user_profiles(id),
  reviewed_at          timestamptz not null default now()
);
create index document_reviews_doc_idx on document_reviews (student_document_id, reviewed_at desc);

create table document_custody_events (
  id                   uuid primary key default gen_random_uuid(),
  student_document_id  uuid not null references student_documents(id),
  location             text not null check (location in ('with_student', 'with_staff', 'with_provider', 'at_embassy',
                                                         'at_university', 'returned_to_student')),
  note                 text,
  third_party_ref      text,
  recorded_by          uuid not null references user_profiles(id),
  recorded_at          timestamptz not null default now()
);

create trigger student_documents_audit after insert or update or delete on student_documents
  for each row execute function app.audit_row('', 'student_id', 'notes');
create trigger document_files_audit after insert or update or delete on document_files
  for each row execute function app.audit_row('', '', 'storage_key', 'sha256');

-- Status/file columns can only change through the functions below.
create or replace function app.guard_document_status() returns trigger
language plpgsql as $$
begin
  if (new.status is distinct from old.status
      or new.current_file_id is distinct from old.current_file_id
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.rejection_reason is distinct from old.rejection_reason
      or new.original_location is distinct from old.original_location)
     and coalesce(current_setting('app.doc_change', true), 'off') <> 'on' then
    raise exception 'document status can only be changed through upload/review actions' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger student_documents_guard before update on student_documents
  for each row execute function app.guard_document_status();

-- Create checklist items for a student's workflow requirements.
create or replace function app.ensure_document_checklist(p_student uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  insert into student_documents (student_id, document_type_id, is_required, created_by)
  select s.id, r.document_type_id, r.is_required, coalesce(app.current_user_id(), s.created_by)
    from students s join document_requirements r on r.workflow_id = s.workflow_id
   where s.id = p_student
  on conflict (student_id, document_type_id, label) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function app.students_after_insert_checklist() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.ensure_document_checklist(new.id);
  return null;
end $$;
-- Named "zz" so it fires AFTER students_sync_access (same-event triggers fire
-- in alphabetical order); the checklist needs the access rows to exist.
create trigger students_zz_checklist after insert on students
  for each row execute function app.students_after_insert_checklist();

-- Register an uploaded file (the bytes were already stored by the server under
-- a random key). Never approves: status becomes 'uploaded'.
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
  update student_documents set current_file_id = v_file, status = 'uploaded',
         reviewed_by = null, reviewed_at = null
   where id = p_document;
  perform set_config('app.doc_change', 'off', true);
  insert into document_reviews (student_document_id, file_id, from_status, to_status, reviewed_by)
  values (p_document, v_file, v_doc.status, 'uploaded', app.current_user_id());
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'uploaded',
                        v_type.name || case when v_doc.label <> '' then ' – ' || v_doc.label else '' end
                        || ' uploaded (version ' || v_version || ')', 'student_documents', p_document::text);
  return v_file;
end $$;

-- Review decisions. Approve requires a file; reject requires a reason.
create or replace function app.set_document_status(p_document uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc student_documents%rowtype;
  v_type document_types%rowtype;
  v_org uuid;
begin
  select * into v_doc from student_documents where id = p_document for update;
  if not found or not app.can_read_student(v_doc.student_id) then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if p_status not in ('under_review', 'approved', 'rejected', 'expired', 'missing') then
    raise exception 'invalid review status' using errcode = '23514';
  end if;
  if not app.can_on_student(v_doc.student_id, 'documents.review') then
    raise exception 'permission denied: documents.review' using errcode = '42501';
  end if;
  if p_status = v_doc.status then raise exception 'document already has this status' using errcode = '23514'; end if;
  if p_status in ('approved', 'under_review') and v_doc.current_file_id is null then
    raise exception 'a file must be uploaded before it can be reviewed or approved' using errcode = '23514';
  end if;
  if p_status = 'rejected' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a rejection reason is required' using errcode = '23514';
  end if;
  if p_status = 'missing' and v_doc.current_file_id is not null then
    raise exception 'documents with an uploaded file cannot be reset to missing' using errcode = '23514';
  end if;
  perform set_config('app.doc_change', 'on', true);
  update student_documents set status = p_status,
         rejection_reason = case when p_status = 'rejected' then btrim(p_reason) else null end,
         reviewed_by = app.current_user_id(), reviewed_at = now()
   where id = p_document;
  perform set_config('app.doc_change', 'off', true);
  insert into document_reviews (student_document_id, file_id, from_status, to_status, reason, reviewed_by)
  values (p_document, v_doc.current_file_id, v_doc.status, p_status, nullif(btrim(p_reason), ''), app.current_user_id());
  select * into v_type from document_types where id = v_doc.document_type_id;
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'review',
                        v_type.name || case when v_doc.label <> '' then ' – ' || v_doc.label else '' end || ': '
                        || replace(v_doc.status, '_', ' ') || ' → ' || replace(p_status, '_', ' ')
                        || case when p_status = 'rejected' then ' (' || btrim(p_reason) || ')' else '' end,
                        'student_documents', p_document::text);
end $$;

create or replace function app.record_document_custody(p_document uuid, p_location text, p_note text, p_ref text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc student_documents%rowtype;
  v_type document_types%rowtype;
  v_org uuid;
begin
  select * into v_doc from student_documents where id = p_document for update;
  if not found or not app.can_read_student(v_doc.student_id) then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if not app.can_on_student(v_doc.student_id, 'documents.custody') then
    raise exception 'permission denied: documents.custody' using errcode = '42501';
  end if;
  insert into document_custody_events (student_document_id, location, note, third_party_ref, recorded_by)
  values (p_document, p_location, nullif(btrim(p_note), ''), nullif(btrim(p_ref), ''), app.current_user_id());
  perform set_config('app.doc_change', 'on', true);
  update student_documents set original_location = p_location, location_note = nullif(btrim(p_note), ''),
         third_party_ref = coalesce(nullif(btrim(p_ref), ''), third_party_ref)
   where id = p_document;
  perform set_config('app.doc_change', 'off', true);
  select * into v_type from document_types where id = v_doc.document_type_id;
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'custody',
                        'Original ' || v_type.name || ' location: ' || replace(p_location, '_', ' '),
                        'student_documents', p_document::text);
end $$;

-- Authorize opening a specific file version. Returns the storage key only if
-- permitted; logs both granted and denied attempts.
create or replace function app.authorize_file_access(p_file uuid) returns table (storage_key text, mime_type text, original_filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_file document_files%rowtype;
  v_doc student_documents%rowtype;
  v_org uuid;
begin
  select * into v_file from document_files where id = p_file;
  if found then select * into v_doc from student_documents where id = v_file.student_document_id; end if;
  if v_file.id is null or not app.can_read_student(v_doc.student_id)
     or not app.can_on_student(v_doc.student_id, 'documents.file.view') then
    perform app.audit('file_access', 'document_files', p_file::text, null, v_doc.student_id, null, null, 'denied');
    return;
  end if;
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.audit('file_access', 'document_files', p_file::text, v_org, v_doc.student_id, null,
                    jsonb_build_object('version', v_file.version, 'document_id', v_doc.id));
  return query select v_file.storage_key, v_file.mime_type, v_file.original_filename;
end $$;
