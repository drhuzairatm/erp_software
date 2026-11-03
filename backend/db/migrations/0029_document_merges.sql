-- =============================================================================
-- 0029 Combined submission PDFs (Nov 2026)
--
-- Staff with documents.download merge selected student documents into one PDF
-- (generated on request, NOT stored – no duplicate copies of passports etc.).
-- Each generation (or failed attempt) is recorded here and in the audit log:
-- generated filename, the exact source file versions in order, university,
-- purpose, who and when. Source files and their statuses are never modified.
-- =============================================================================

create table document_merges (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id),
  org_id         uuid not null references organizations(id),
  filename       text not null check (length(filename) between 5 and 220),
  source_files   uuid[] not null check (cardinality(source_files) between 1 and 40),
  university_id  uuid references universities(id),
  purpose        text not null check (purpose in ('university_admission', 'visa_application', 'embassy_submission', 'general')),
  pages          int,
  included_unapproved boolean not null default false,
  outcome        text not null check (outcome in ('success', 'failure')),
  failure_note   text,
  mode           text not null check (mode in ('download', 'preview')),
  created_by     uuid not null references user_profiles(id),
  created_at     timestamptz not null default now()
);
create index document_merges_student_idx on document_merges (student_id, created_at desc);
create trigger document_merges_immutable before update or delete on document_merges for each row execute function app.audit_immutable();

create or replace function app.record_document_merge(p_student uuid, p_filename text, p_files uuid[], p_university uuid, p_purpose text, p_pages int,
                                                     p_unapproved boolean, p_outcome text, p_failure text, p_mode text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if not app.can_read_student(p_student) or not app.can_on_student(p_student, 'documents.download') then
    raise exception 'permission denied: documents.download' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_files) f where not exists (
       select 1 from document_files df join student_documents d on d.id = df.student_document_id where df.id = f and d.student_id = p_student)) then
    raise exception 'unknown file' using errcode = '23514';
  end if;
  select originating_org_id into v_org from students where id = p_student;
  insert into document_merges (student_id, org_id, filename, source_files, university_id, purpose, pages, included_unapproved, outcome, failure_note, mode, created_by)
  values (p_student, v_org, p_filename, p_files, p_university, p_purpose, p_pages, p_unapproved, p_outcome, left(p_failure, 1000), p_mode, app.current_user_id());
  perform app.audit('documents_merged', 'document_merges', p_student::text, v_org, p_student, null,
    jsonb_build_object('filename', p_filename, 'files', p_files, 'university', p_university, 'purpose', p_purpose, 'pages', p_pages, 'mode', p_mode,
                       'unapproved_included', p_unapproved), case when p_outcome = 'success' then 'success' else 'failure' end);
  if p_outcome = 'success' then
    perform app.add_event_internal(p_student, v_org, 'document', 'merged',
      'Combined PDF ' || case when p_mode = 'preview' then 'previewed' else 'downloaded' end || ': ' || cardinality(p_files) || ' document(s), ' || coalesce(p_pages, 0) || ' page(s) – ' || replace(p_purpose, '_', ' '),
      'document_merges', p_student::text);
  end if;
end $$;

alter table document_merges enable row level security;
create policy document_merges_select on document_merges for select to erp_app using (app.can_on_student(student_id, 'documents.download'));
grant select on document_merges to erp_app;
grant execute on function app.record_document_merge(uuid, text, uuid[], uuid, text, int, boolean, text, text, text) to erp_app;
