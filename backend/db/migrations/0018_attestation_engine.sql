-- =============================================================================
-- 0018 Phase 1: country-specific attestation / apostille engine
--
-- * Authorities and ROUTES are configuration: route = destination + optional
--   issuing country, document type, university, visa-application country and
--   previous-education country → ordered stages (mandatory/optional,
--   authority, responsible department). Draft → MD approval → frozen; changes
--   need a new version. Routes encode business procedures, not legal advice.
-- * An attestation can start only for the CURRENT, manager-APPROVED version of
--   a document. It snapshots the route (version, stages) so later rule changes
--   never alter work in progress.
-- * Stages are done in order: a stage cannot start or complete while an
--   earlier mandatory stage is unresolved. Skipping a mandatory stage requires
--   attestation.exception and a reason (recorded and audited).
-- * A new document version / loss of approval cancels an attestation in progress.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('attestation.routes.manage',  'Administration', 'Draft attestation/apostille routes and authorities', false),
  ('attestation.routes.approve', 'Administration', 'Approve attestation routes so they take effect', true),
  ('attestation.process',        'Documents', 'Start attestation and record stage progress', false),
  ('attestation.exception',      'Documents', 'Skip a mandatory attestation stage with a recorded reason', true)
on conflict (key) do nothing;
insert into role_permissions (role_id, permission_key)
select r.id, v.p from roles r join (values
  ('manager', 'attestation.process'), ('manager', 'attestation.exception'),
  ('documentation', 'attestation.process'), ('system_admin', 'attestation.routes.manage')) v(k, p) on r.key = v.k
on conflict do nothing;

insert into document_types (key, name, category, has_expiry, sort_order) values
  ('birth_affidavit', 'Birth Affidavit', 'identity', false, 45),
  ('sponsor_affidavit', 'Sponsor Affidavit', 'financial', false, 145),
  ('police_clearance', 'Police Clearance Certificate (PCC)', 'visa', true, 135)
on conflict (key) do nothing;

-- Visa application country (controls PCC / visa document routes)
alter table students add column visa_application_country_id uuid references countries(id);
grant select (visa_application_country_id) on students to erp_app;
grant insert (visa_application_country_id) on students to erp_app;
grant update (visa_application_country_id) on students to erp_app;

-- -----------------------------------------------------------------------------
-- Configuration
-- -----------------------------------------------------------------------------
create table attestation_authorities (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 160),
  country_id  uuid references countries(id),
  kind        text not null check (kind in ('apostille_authority', 'education_ministry', 'foreign_affairs', 'embassy',
                                            'notary', 'home_department', 'university', 'other')),
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (name, country_id)
);

create table attestation_routes (
  id                             uuid primary key default gen_random_uuid(),
  route_group_id                 uuid not null default gen_random_uuid(),
  version                        int not null default 1,
  name                           text not null check (length(btrim(name)) between 3 and 200),
  description                    text,
  route_type                     text not null default 'legalisation' check (route_type in ('apostille', 'legalisation', 'other')),
  destination_country_id         uuid not null references countries(id),
  issuing_country_id             uuid references countries(id),
  document_type_id               uuid references document_types(id),
  university_id                  uuid references universities(id),
  visa_application_country_id    uuid references countries(id),
  previous_education_country_id  uuid references countries(id),
  source_note                    text,
  status                         text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  effective_from                 date,
  effective_to                   date,
  created_by                     uuid references user_profiles(id) default app.current_user_id(),
  created_at                     timestamptz not null default now(),
  approved_by                    uuid references user_profiles(id),
  approved_at                    timestamptz,
  unique (route_group_id, version),
  check (status <> 'approved' or (effective_from is not null and approved_at is not null))
);
create unique index attestation_routes_one_draft on attestation_routes (route_group_id) where status = 'draft';

create table attestation_route_stages (
  id                        uuid primary key default gen_random_uuid(),
  route_id                  uuid not null references attestation_routes(id) on delete cascade,
  sort_order                int not null,
  name                      text not null check (length(btrim(name)) between 2 and 160),
  authority_id              uuid references attestation_authorities(id),
  is_mandatory              boolean not null default true,
  responsible_department    text,
  requires_reference        boolean not null default false,
  requires_supporting_file  boolean not null default false,
  expected_days             int check (expected_days is null or expected_days between 0 and 365),
  guidance                  text,
  unique (route_id, sort_order)
);

create or replace function app.guard_route_frozen() returns trigger
language plpgsql as $$
declare v_status text;
begin
  if tg_table_name = 'attestation_routes' then
    if old.status <> 'draft' and coalesce(current_setting('app.rule_change', true), 'off') <> 'on' then
      raise exception 'approved routes cannot be edited; create a new version' using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from attestation_routes where id = coalesce(new.route_id, old.route_id);
  if v_status <> 'draft' then
    raise exception 'stages of an approved route cannot be changed; create a new version' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger attestation_routes_frozen before update or delete on attestation_routes
  for each row execute function app.guard_route_frozen();
create trigger attestation_route_stages_frozen before insert or update or delete on attestation_route_stages
  for each row execute function app.guard_route_frozen();
create trigger attestation_routes_audit after insert or update or delete on attestation_routes
  for each row execute function app.audit_row('', '');
create trigger attestation_route_stages_audit after insert or update or delete on attestation_route_stages
  for each row execute function app.audit_row('', '');
create trigger attestation_authorities_audit after insert or update or delete on attestation_authorities
  for each row execute function app.audit_row('', '');

create or replace function app.approve_attestation_route(p_route uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r attestation_routes%rowtype;
begin
  if not exists (select 1 from app.orgs_with_perm('attestation.routes.approve')) then
    raise exception 'permission denied: attestation.routes.approve' using errcode = '42501';
  end if;
  select * into v_r from attestation_routes where id = p_route for update;
  if not found or v_r.status <> 'draft' then raise exception 'only draft routes can be approved' using errcode = '23514'; end if;
  if not exists (select 1 from attestation_route_stages where route_id = p_route) then
    raise exception 'add at least one stage before approving' using errcode = '23514';
  end if;
  perform set_config('app.rule_change', 'on', true);
  update attestation_routes set status = 'retired', effective_to = current_date where route_group_id = v_r.route_group_id and status = 'approved';
  update attestation_routes set status = 'approved', effective_from = current_date, approved_by = app.current_user_id(), approved_at = now() where id = p_route;
  perform set_config('app.rule_change', 'off', true);
end $$;

create or replace function app.new_attestation_route_version(p_route uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r attestation_routes%rowtype; v_new uuid;
begin
  if not exists (select 1 from app.orgs_with_perm('attestation.routes.manage')) then
    raise exception 'permission denied: attestation.routes.manage' using errcode = '42501';
  end if;
  select * into v_r from attestation_routes where id = p_route;
  if not found then raise exception 'route not found' using errcode = 'P0002'; end if;
  if exists (select 1 from attestation_routes where route_group_id = v_r.route_group_id and status = 'draft') then
    raise exception 'a draft version already exists' using errcode = '23514';
  end if;
  insert into attestation_routes (route_group_id, version, name, description, route_type, destination_country_id, issuing_country_id,
                                  document_type_id, university_id, visa_application_country_id, previous_education_country_id, source_note, created_by)
  select v_r.route_group_id, (select max(version) + 1 from attestation_routes where route_group_id = v_r.route_group_id), v_r.name, v_r.description,
         v_r.route_type, v_r.destination_country_id, v_r.issuing_country_id, v_r.document_type_id, v_r.university_id,
         v_r.visa_application_country_id, v_r.previous_education_country_id, v_r.source_note, app.current_user_id()
  returning id into v_new;
  insert into attestation_route_stages (route_id, sort_order, name, authority_id, is_mandatory, responsible_department, requires_reference,
                                        requires_supporting_file, expected_days, guidance)
  select v_new, sort_order, name, authority_id, is_mandatory, responsible_department, requires_reference, requires_supporting_file, expected_days, guidance
    from attestation_route_stages where route_id = p_route;
  return v_new;
end $$;

-- Approved, effective routes that fit a checklist item (most specific first).
create or replace function app.matching_attestation_routes(p_document uuid)
returns table (route_id uuid, specificity int)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id,
         (r.issuing_country_id is not null)::int * 4 + (r.document_type_id is not null)::int * 2 + (r.university_id is not null)::int * 2
         + (r.visa_application_country_id is not null)::int + (r.previous_education_country_id is not null)::int
    from student_documents d join students s on s.id = d.student_id
    join attestation_routes r on r.status = 'approved' and r.effective_from <= current_date and (r.effective_to is null or r.effective_to > current_date)
   where d.id = p_document
     and r.destination_country_id = s.destination_country_id
     and (r.issuing_country_id is null or r.issuing_country_id = d.issuing_country_id)
     and (r.document_type_id is null or r.document_type_id = d.document_type_id)
     and (r.university_id is null or r.university_id = s.preferred_university_id)
     and (r.visa_application_country_id is null or r.visa_application_country_id = s.visa_application_country_id)
     and (r.previous_education_country_id is null or r.previous_education_country_id = s.previous_education_country_id)
   order by 2 desc
$$;

-- -----------------------------------------------------------------------------
-- Work records
-- -----------------------------------------------------------------------------
create table document_attestations (
  id                   uuid primary key default gen_random_uuid(),
  student_document_id  uuid not null references student_documents(id),
  file_id              uuid not null references document_files(id),
  route_id             uuid not null references attestation_routes(id),
  route_version        int not null,
  route_name           text not null,
  route_type           text not null,
  status               text not null default 'in_progress' check (status in ('in_progress', 'completed', 'cancelled')),
  started_by           uuid not null references user_profiles(id),
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text
);
create unique index document_attestations_one_active on document_attestations (student_document_id) where status = 'in_progress';
create index document_attestations_doc_idx on document_attestations (student_document_id, started_at desc);

create table document_attestation_steps (
  id                        uuid primary key default gen_random_uuid(),
  attestation_id            uuid not null references document_attestations(id),
  sort_order                int not null,
  name                      text not null,
  authority_name            text,
  is_mandatory              boolean not null,
  responsible_department    text,
  requires_reference        boolean not null default false,
  requires_supporting_file  boolean not null default false,
  expected_days             int,
  guidance                  text,
  status                    text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'not_required', 'exception')),
  assigned_to               uuid references user_profiles(id),
  started_at                timestamptz,
  processing_date           date,
  reference_no              text check (reference_no is null or length(reference_no) <= 120),
  comments                  text check (comments is null or length(comments) <= 2000),
  completed_at              timestamptz,
  completed_by              uuid references user_profiles(id),
  exception_reason          text,
  exception_by              uuid references user_profiles(id),
  exception_at              timestamptz,
  unique (attestation_id, sort_order)
);

create table attestation_step_files (
  id            uuid primary key default gen_random_uuid(),
  step_id       uuid not null references document_attestation_steps(id),
  storage_key   text not null unique,
  filename      text not null,
  mime_type     text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes    int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256        text not null,
  uploaded_by   uuid not null references user_profiles(id),
  uploaded_at   timestamptz not null default now()
);
create trigger attestation_step_files_immutable before update or delete on attestation_step_files
  for each row execute function app.audit_immutable();

create trigger document_attestations_audit after insert or update on document_attestations
  for each row execute function app.audit_row('', '');
create trigger document_attestation_steps_audit after insert or update on document_attestation_steps
  for each row execute function app.audit_row('', '');

create or replace function app.guard_attestation_writes() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.attestation_change', true), 'off') <> 'on' then
    raise exception 'attestation records change only through the attestation workflow' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger document_attestations_guard before update or delete on document_attestations
  for each row execute function app.guard_attestation_writes();
create trigger document_attestation_steps_guard before update or delete on document_attestation_steps
  for each row execute function app.guard_attestation_writes();

-- Current attestation state of a checklist item
create or replace function app.attestation_state(p_document uuid) returns table (state text, attestation_id uuid, done int, total int)
language sql stable security definer set search_path = public, pg_temp as $$
  with d as (select * from student_documents where id = p_document),
  a as (select x.* from document_attestations x, d
         where x.student_document_id = d.id and x.status in ('in_progress', 'completed') and x.file_id = d.current_file_id
         order by x.started_at desc limit 1)
  select case when (select status from a) = 'completed' then 'completed'
              when (select status from a) = 'in_progress' then 'processing'
              when (select status from d) = 'approved' and (select approved_file_id = current_file_id from d)
                   and exists (select 1 from app.matching_attestation_routes(p_document)) then 'ready'
              else null end,
         (select id from a),
         (select count(*)::int from document_attestation_steps s where s.attestation_id = (select id from a) and s.status in ('completed', 'not_required', 'exception')),
         (select count(*)::int from document_attestation_steps s where s.attestation_id = (select id from a))
$$;

create or replace function app.start_attestation(p_document uuid, p_route uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_doc student_documents%rowtype; v_route attestation_routes%rowtype; v_id uuid; v_org uuid; v_type text;
begin
  select * into v_doc from student_documents where id = p_document for update;
  if not found or not app.can_read_student(v_doc.student_id) then raise exception 'document not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_doc.student_id, 'attestation.process') then
    raise exception 'permission denied: attestation.process' using errcode = '42501';
  end if;
  if v_doc.status <> 'approved' or v_doc.approved_file_id is distinct from v_doc.current_file_id or v_doc.current_file_id is null then
    raise exception 'only the current, manager-approved version of a document can go for attestation' using errcode = '23514';
  end if;
  if exists (select 1 from document_attestations where student_document_id = p_document and status = 'in_progress') then
    raise exception 'an attestation is already in progress for this document' using errcode = '23514';
  end if;
  if p_route not in (select route_id from app.matching_attestation_routes(p_document)) then
    raise exception 'this route does not apply to the document (destination, issuing country, document type…)' using errcode = '23514';
  end if;
  select * into v_route from attestation_routes where id = p_route;
  perform set_config('app.attestation_change', 'on', true);
  insert into document_attestations (student_document_id, file_id, route_id, route_version, route_name, route_type, started_by)
  values (p_document, v_doc.current_file_id, p_route, v_route.version, v_route.name, v_route.route_type, app.current_user_id())
  returning id into v_id;
  insert into document_attestation_steps (attestation_id, sort_order, name, authority_name, is_mandatory, responsible_department,
                                          requires_reference, requires_supporting_file, expected_days, guidance)
  select v_id, s.sort_order, s.name, a.name, s.is_mandatory, s.responsible_department, s.requires_reference, s.requires_supporting_file,
         s.expected_days, s.guidance
    from attestation_route_stages s left join attestation_authorities a on a.id = s.authority_id
   where s.route_id = p_route order by s.sort_order;
  perform set_config('app.attestation_change', 'off', true);
  select originating_org_id into v_org from students where id = v_doc.student_id;
  select name into v_type from document_types where id = v_doc.document_type_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'attestation_started',
    v_type || ': attestation started – ' || v_route.name, 'document_attestations', v_id::text);
  return v_id;
end $$;

-- Step actions: start | complete | not_required | exception | assign | note
create or replace function app.attestation_step_action(p_step uuid, p_action text, p_reference text, p_date date, p_comment text, p_assignee uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s document_attestation_steps%rowtype; v_a document_attestations%rowtype; v_doc student_documents%rowtype;
  v_org uuid; v_type text; v_open int; v_me uuid := app.current_user_id();
begin
  select * into v_s from document_attestation_steps where id = p_step for update;
  if not found then raise exception 'stage not found' using errcode = 'P0002'; end if;
  select * into v_a from document_attestations where id = v_s.attestation_id for update;
  select * into v_doc from student_documents where id = v_a.student_document_id;
  if not app.can_read_student(v_doc.student_id) then raise exception 'stage not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_doc.student_id, case when p_action = 'exception' then 'attestation.exception' else 'attestation.process' end) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_a.status <> 'in_progress' then raise exception 'this attestation is not in progress' using errcode = '23514'; end if;

  if p_action in ('start', 'complete', 'not_required', 'exception') then
    if v_s.status in ('completed', 'not_required', 'exception') then raise exception 'this stage is already finished' using errcode = '23514'; end if;
    -- earlier stages must be resolved first (mandatory: completed or exception; optional: completed or not required)
    if exists (select 1 from document_attestation_steps e where e.attestation_id = v_a.id and e.sort_order < v_s.sort_order
                 and e.status not in ('completed', 'not_required', 'exception')) then
      raise exception 'earlier stages must be finished first' using errcode = '23514';
    end if;
  end if;

  perform set_config('app.attestation_change', 'on', true);
  case p_action
    when 'assign' then
      if p_assignee is not null and not exists (select 1 from student_org_access x join organization_memberships m on m.org_id = x.org_id and m.is_active
                                                 where x.student_id = v_doc.student_id and m.user_id = p_assignee) then
        raise exception 'assignee has no access to this student' using errcode = '23514';
      end if;
      update document_attestation_steps set assigned_to = p_assignee where id = p_step;
    when 'note' then
      update document_attestation_steps set comments = nullif(btrim(p_comment), ''), reference_no = coalesce(nullif(btrim(p_reference), ''), reference_no),
                                            processing_date = coalesce(p_date, processing_date) where id = p_step;
    when 'start' then
      update document_attestation_steps set status = 'in_progress', started_at = now(), processing_date = coalesce(p_date, current_date),
             reference_no = coalesce(nullif(btrim(p_reference), ''), reference_no), comments = coalesce(nullif(btrim(p_comment), ''), comments) where id = p_step;
    when 'complete' then
      if v_s.requires_reference and coalesce(nullif(btrim(p_reference), ''), v_s.reference_no) is null then
        raise exception 'a reference number is required for this stage' using errcode = '23514';
      end if;
      if v_s.requires_supporting_file and not exists (select 1 from attestation_step_files where step_id = p_step) then
        raise exception 'upload the supporting document for this stage first' using errcode = '23514';
      end if;
      update document_attestation_steps set status = 'completed', completed_at = now(), completed_by = v_me,
             started_at = coalesce(started_at, now()), processing_date = coalesce(p_date, processing_date, current_date),
             reference_no = coalesce(nullif(btrim(p_reference), ''), reference_no), comments = coalesce(nullif(btrim(p_comment), ''), comments) where id = p_step;
    when 'not_required' then
      if v_s.is_mandatory then raise exception 'a mandatory stage cannot be marked not required; record an exception instead' using errcode = '23514'; end if;
      if coalesce(btrim(p_comment), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
      update document_attestation_steps set status = 'not_required', comments = btrim(p_comment), completed_at = now(), completed_by = v_me where id = p_step;
    when 'exception' then
      if coalesce(btrim(p_comment), '') = '' then raise exception 'a reason is required for an exception' using errcode = '23514'; end if;
      update document_attestation_steps set status = 'exception', exception_reason = btrim(p_comment), exception_by = v_me, exception_at = now(),
             completed_at = now(), completed_by = v_me where id = p_step;
      perform app.audit('attestation_exception', 'document_attestation_steps', p_step::text, null, v_doc.student_id, null,
                        jsonb_build_object('stage', v_s.name, 'reason', btrim(p_comment)));
    else
      raise exception 'unknown action' using errcode = '23514';
  end case;

  select originating_org_id into v_org from students where id = v_doc.student_id;
  select name into v_type from document_types where id = v_doc.document_type_id;
  if p_action in ('complete', 'not_required', 'exception') then
    perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'attestation_stage',
      v_type || ' – ' || v_s.name || ': ' || case p_action when 'complete' then 'completed' when 'not_required' then 'not required' else 'skipped by exception (' || btrim(p_comment) || ')' end,
      'document_attestations', v_a.id::text);
    perform app.enqueue_notification(v_doc.student_id, 'attestation_stage_completed', jsonb_build_object('document', v_type, 'stage', v_s.name));
    select count(*) into v_open from document_attestation_steps where attestation_id = v_a.id and status not in ('completed', 'not_required', 'exception');
    if v_open = 0 then
      update document_attestations set status = 'completed', completed_at = now() where id = v_a.id;
      perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'attestation_completed', v_type || ': attestation completed (' || v_a.route_name || ')',
        'document_attestations', v_a.id::text);
      perform app.enqueue_notification(v_doc.student_id, 'attestation_completed', jsonb_build_object('document', v_type));
    end if;
  end if;
  perform set_config('app.attestation_change', 'off', true);
end $$;

create or replace function app.cancel_attestation(p_attestation uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a document_attestations%rowtype; v_doc student_documents%rowtype; v_org uuid;
begin
  select * into v_a from document_attestations where id = p_attestation for update;
  if not found then raise exception 'attestation not found' using errcode = 'P0002'; end if;
  select * into v_doc from student_documents where id = v_a.student_document_id;
  if not app.can_on_student(v_doc.student_id, 'attestation.process') then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_a.status <> 'in_progress' then raise exception 'only attestations in progress can be cancelled' using errcode = '23514'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  perform set_config('app.attestation_change', 'on', true);
  update document_attestations set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason) where id = p_attestation;
  perform set_config('app.attestation_change', 'off', true);
  select originating_org_id into v_org from students where id = v_doc.student_id;
  perform app.add_event_internal(v_doc.student_id, v_org, 'document', 'attestation_cancelled', 'Attestation cancelled: ' || btrim(p_reason),
    'document_attestations', p_attestation::text);
end $$;

-- A new version or loss of approval cancels an attestation in progress
create or replace function app.attestation_on_document_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.approved_file_id is distinct from old.approved_file_id or (old.status = 'approved' and new.status <> 'approved') then
    perform set_config('app.attestation_change', 'on', true);
    update document_attestations set status = 'cancelled', cancelled_at = now(),
           cancel_reason = 'Document version or approval changed; a new attestation is needed'
     where student_document_id = new.id and status = 'in_progress';
    perform set_config('app.attestation_change', 'off', true);
  end if;
  return null;
end $$;
create trigger student_documents_attestation_reset after update on student_documents
  for each row execute function app.attestation_on_document_change();

create or replace function app.register_attestation_file(p_step uuid, p_key text, p_filename text, p_mime text, p_size int, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student uuid; v_status text; v_id uuid;
begin
  select d.student_id, a.status into v_student, v_status from document_attestation_steps s join document_attestations a on a.id = s.attestation_id
    join student_documents d on d.id = a.student_document_id where s.id = p_step;
  if v_student is null or not app.can_on_student(v_student, 'attestation.process') then raise exception 'permission denied' using errcode = '42501'; end if;
  if v_status <> 'in_progress' then raise exception 'this attestation is not in progress' using errcode = '23514'; end if;
  insert into attestation_step_files (step_id, storage_key, filename, mime_type, size_bytes, sha256, uploaded_by)
  values (p_step, p_key, p_filename, p_mime, p_size, p_sha256, app.current_user_id()) returning id into v_id;
  return v_id;
end $$;

create or replace function app.attestation_file_target(p_step uuid) returns table (student_id uuid, org_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.student_id, s.originating_org_id from document_attestation_steps st join document_attestations a on a.id = st.attestation_id
    join student_documents d on d.id = a.student_document_id join students s on s.id = d.student_id
   where st.id = p_step and app.can_on_student(d.student_id, 'attestation.process')
$$;

create or replace function app.authorize_attestation_file(p_file uuid) returns table (storage_key text, mime_type text, filename text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f attestation_step_files%rowtype; v_student uuid;
begin
  select f.* into v_f from attestation_step_files f where f.id = p_file;
  if found then
    select d.student_id into v_student from document_attestation_steps s join document_attestations a on a.id = s.attestation_id
      join student_documents d on d.id = a.student_document_id where s.id = v_f.step_id;
  end if;
  if v_f.id is null or not app.can_on_student(v_student, 'documents.file.view') then
    perform app.audit('file_access', 'attestation_step_files', p_file::text, null, v_student, null, null, 'denied');
    return;
  end if;
  perform app.audit('file_access', 'attestation_step_files', p_file::text, null, v_student);
  return query select v_f.storage_key, v_f.mime_type, v_f.filename;
end $$;

-- -----------------------------------------------------------------------------
-- Notifications for attestation progress
-- -----------------------------------------------------------------------------
alter table notification_rules drop constraint notification_rules_event_key_check;
alter table notification_rules add constraint notification_rules_event_key_check
  check (event_key in ('student_registered', 'stage_changed', 'document_changes_required', 'document_rejected', 'document_approved',
                       'visa_outcome', 'portal_login_code', 'attestation_stage_completed', 'attestation_completed'));

-- -----------------------------------------------------------------------------
-- Student view (+ visa application country) and portal overview (+ attestation progress)
-- -----------------------------------------------------------------------------
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
       case when p.pii then s.parent_email end as parent_email,
       s.visa_application_country_id
  from students s
  cross join lateral (select app.can_on_student(s.id, 'students.contact.view') as pii) p
  cross join lateral (select app.can_on_student(s.id, 'students.passport.view') as passport) pp
 where app.can_read_student(s.id);

create or replace function app.portal_overview(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid := app.portal_student(p_token_hash); v_s students%rowtype; v_cur int;
begin
  if v_id is null then return null; end if;
  select * into v_s from students where id = v_id;
  select ws.sort_order into v_cur from workflow_stages ws where ws.workflow_id = v_s.workflow_id
     and ws.stage_key = coalesce(case when v_s.status = 'on_hold' then v_s.stage_before_hold end, v_s.current_stage_key);
  return jsonb_build_object(
    'student', jsonb_build_object(
      'code', v_s.student_code, 'name', v_s.full_name, 'status', v_s.status,
      'stage', (select name from stages where key = v_s.current_stage_key),
      'next_action', v_s.next_action, 'next_action_due', v_s.next_action_due,
      'destination', (select name from countries where id = v_s.destination_country_id),
      'course', (select name from courses where id = v_s.course_id),
      'university', (select name from universities where id = v_s.preferred_university_id),
      'counsellor', (select u.full_name from student_assignments a join user_profiles u on u.id = a.user_id
                      where a.student_id = v_id and a.is_active and a.assignment_type = 'counsellor' limit 1)),
    'company', (select jsonb_build_object('code', o.code, 'name', o.name,
                       'support_phone', o.settings ->> 'support_phone', 'support_email', o.settings ->> 'support_email')
                  from organizations o where o.id = v_s.originating_org_id),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('name', st.name,
                 'state', case when v_cur is null then 'upcoming' when ws.sort_order < v_cur then 'done'
                               when ws.sort_order = v_cur then case when v_s.status = 'completed' then 'done' else 'current' end else 'upcoming' end)
                 order by ws.sort_order)
                from workflow_stages ws join stages st on st.key = ws.stage_key where ws.workflow_id = v_s.workflow_id), '[]'),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', d.id, 'name', t.name || case when d.label <> '' then ' – ' || d.label else '' end, 'required', d.is_required,
                   'state', case
                     when d.status = 'approved' and d.expiry_date is not null and d.expiry_date < current_date then 'expired'
                     when d.status in ('uploaded', 'under_review', 'verified', 'pending_approval') then 'checking'
                     else d.status end,
                   'reason', case when d.status in ('changes_required', 'rejected', 'expired') then d.rejection_reason end,
                   'can_upload', d.status in ('missing', 'changes_required', 'rejected', 'expired')
                                 or (d.status = 'approved' and d.expiry_date is not null and d.expiry_date < current_date),
                   'attestation', (select jsonb_build_object('state', x.state, 'done', x.done, 'total', x.total)
                                     from app.attestation_state(d.id) x where x.state in ('processing', 'completed')))
                 order by d.is_required desc, t.sort_order)
                from student_documents d join document_types t on t.id = d.document_type_id where d.student_id = v_id), '[]'));
end $$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table attestation_authorities enable row level security;
alter table attestation_routes enable row level security;
alter table attestation_route_stages enable row level security;
alter table document_attestations enable row level security;
alter table document_attestation_steps enable row level security;
alter table attestation_step_files enable row level security;

create policy att_authorities_select on attestation_authorities for select to erp_app using (app.current_user_id() is not null);
create policy att_authorities_write on attestation_authorities for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('attestation.routes.manage')))
  with check (exists (select 1 from app.orgs_with_perm('attestation.routes.manage')));
create policy att_routes_select on attestation_routes for select to erp_app using (app.current_user_id() is not null);
create policy att_routes_write on attestation_routes for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('attestation.routes.manage')))
  with check (exists (select 1 from app.orgs_with_perm('attestation.routes.manage')) and status = 'draft');
create policy att_stages_select on attestation_route_stages for select to erp_app using (app.current_user_id() is not null);
create policy att_stages_write on attestation_route_stages for all to erp_app
  using (exists (select 1 from app.orgs_with_perm('attestation.routes.manage')))
  with check (exists (select 1 from app.orgs_with_perm('attestation.routes.manage')));
create policy doc_att_select on document_attestations for select to erp_app
  using (exists (select 1 from student_documents d where d.id = student_document_id));
create policy doc_att_steps_select on document_attestation_steps for select to erp_app
  using (exists (select 1 from document_attestations a where a.id = attestation_id));
create policy att_files_select on attestation_step_files for select to erp_app
  using (exists (select 1 from document_attestation_steps s where s.id = step_id));

grant select, insert, update on attestation_authorities to erp_app;
grant select, insert, update, delete on attestation_routes, attestation_route_stages to erp_app;
grant select on document_attestations, document_attestation_steps to erp_app;
grant select (id, step_id, filename, mime_type, size_bytes, uploaded_by, uploaded_at) on attestation_step_files to erp_app;
grant execute on function
  app.approve_attestation_route(uuid), app.new_attestation_route_version(uuid), app.matching_attestation_routes(uuid),
  app.attestation_state(uuid), app.start_attestation(uuid, uuid), app.attestation_step_action(uuid, text, text, date, text, uuid),
  app.cancel_attestation(uuid, text), app.register_attestation_file(uuid, text, text, text, int, text),
  app.attestation_file_target(uuid), app.authorize_attestation_file(uuid)
to erp_app;
