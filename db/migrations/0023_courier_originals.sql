-- =============================================================================
-- 0023 Original documents by courier (scan → approval → courier), MD decision Nov 2026
--
-- Sequence enforced here:
--   1. scans are uploaded and APPROVED (existing document workflow);
--   2. staff issue courier instructions for approved documents only — the
--      delivery address configured by the company is released to the student
--      at this point and not before (an exception needs courier.exception and
--      a recorded reason);
--   3. the student/parent submits the courier company and tracking number
--      (portal) or staff record it;
--   4. staff update transit, confirm physical receipt and reconcile each
--      original against the approved scan → completed or reconciliation required.
-- Every step is kept in an append-only event log.
-- Delivery addresses are NOT invented: each company enters its own.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('courier.exception', 'Documents', 'Issue courier instructions before the scans are approved (recorded exception)', true)
on conflict (key) do nothing;

alter table tasks drop constraint tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check check (task_type in ('general', 'followup', 'documentation', 'attestation', 'apostille',
  'translation', 'university_application', 'visa', 'finance', 'travel', 'passport', 'courier'));

-- Company delivery addresses for originals
create table courier_addresses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id),
  label         text not null check (length(btrim(label)) between 2 and 120),
  recipient     text not null check (length(btrim(recipient)) between 2 and 200),
  address       text not null check (length(btrim(address)) between 5 and 1000),
  phone         text check (phone is null or length(phone) <= 40),
  instructions  text check (instructions is null or length(instructions) <= 2000),
  is_active     boolean not null default true,
  created_by    uuid references user_profiles(id) default app.current_user_id(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger courier_addresses_touch before update on courier_addresses for each row execute function app.touch_updated_at();
create trigger courier_addresses_audit after insert or update or delete on courier_addresses
  for each row execute function app.audit_row('org_id', '');

create table original_shipments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id),
  student_id          uuid not null references students(id),
  address_id          uuid not null references courier_addresses(id),
  address_snapshot    text not null,           -- exactly what the student was given
  instructions        text,
  status              text not null default 'instructions_issued'
                        check (status in ('instructions_issued', 'dispatched', 'in_transit', 'received', 'reconciliation_required', 'completed', 'cancelled')),
  exception_reason    text,                    -- set when issued before all scans were approved
  issued_by           uuid not null references user_profiles(id),
  issued_at           timestamptz not null default now(),
  courier_company     text check (courier_company is null or length(courier_company) <= 120),
  tracking_number     text check (tracking_number is null or length(tracking_number) <= 80),
  dispatch_date       date,
  expected_delivery   date,
  dispatch_source     text check (dispatch_source in ('portal', 'staff')),
  dispatch_recorded_at timestamptz,
  received_at         timestamptz,
  received_by         uuid references user_profiles(id),
  completed_at        timestamptz,
  cancelled_reason    text,
  updated_at          timestamptz not null default now()
);
create index original_shipments_student_idx on original_shipments (student_id, issued_at desc);
create index original_shipments_open_idx on original_shipments (org_id, status) where status not in ('completed', 'cancelled');
create trigger original_shipments_touch before update on original_shipments for each row execute function app.touch_updated_at();

create table original_shipment_items (
  id                   uuid primary key default gen_random_uuid(),
  shipment_id          uuid not null references original_shipments(id),
  student_document_id  uuid not null references student_documents(id),
  scan_status          text not null,          -- document status when instructions were issued
  reconciliation       text not null default 'pending' check (reconciliation in ('pending', 'matches', 'mismatch')),
  reconciliation_note  text check (reconciliation_note is null or length(reconciliation_note) <= 1000),
  reconciled_by        uuid references user_profiles(id),
  reconciled_at        timestamptz,
  unique (shipment_id, student_document_id)
);

create table original_shipment_events (
  id           bigint generated always as identity primary key,
  shipment_id  uuid not null references original_shipments(id),
  action       text not null,
  detail       text,
  actor        uuid references user_profiles(id),
  actor_type   text not null default 'staff' check (actor_type in ('staff', 'student', 'system')),
  created_at   timestamptz not null default now()
);
create index original_shipment_events_idx on original_shipment_events (shipment_id, id);
create trigger original_shipment_events_immutable before update or delete on original_shipment_events
  for each row execute function app.audit_immutable();

-- Shipments change only through the functions below
create or replace function app.guard_shipments() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.courier_change', true), 'off') <> 'on' then
    raise exception 'courier records can only be changed through courier actions' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger original_shipments_guard before update or delete on original_shipments for each row execute function app.guard_shipments();
create trigger original_shipment_items_guard before update or delete on original_shipment_items for each row execute function app.guard_shipments();

create or replace function app.shipment_event(p_shipment uuid, p_action text, p_detail text, p_actor_type text default 'staff') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s original_shipments%rowtype;
begin
  select * into v_s from original_shipments where id = p_shipment;
  insert into original_shipment_events (shipment_id, action, detail, actor, actor_type)
  values (p_shipment, p_action, p_detail, case when p_actor_type = 'staff' then app.current_user_id() end, p_actor_type);
  perform app.add_event_internal(v_s.student_id, v_s.org_id, 'document', 'courier_' || p_action, 'Originals by courier: ' || p_detail,
                                 'original_shipments', p_shipment::text);
end $$;

-- Configure a delivery address (company settings)
create or replace function app.save_courier_address(p_id uuid, p_org uuid, p_label text, p_recipient text, p_address text, p_phone text,
                                                    p_instructions text, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_org uuid := p_org;
begin
  if p_id is not null then select org_id into v_org from courier_addresses where id = p_id; end if;
  if v_org is null or not app.has_perm(v_org, 'settings.manage') then raise exception 'permission denied: settings.manage' using errcode = '42501'; end if;
  if p_id is null then
    insert into courier_addresses (id, org_id, label, recipient, address, phone, instructions, is_active)
    values (v_id, v_org, btrim(p_label), btrim(p_recipient), btrim(p_address), nullif(btrim(p_phone), ''), nullif(btrim(p_instructions), ''), coalesce(p_active, true));
  else
    update courier_addresses set label = btrim(p_label), recipient = btrim(p_recipient), address = btrim(p_address), phone = nullif(btrim(p_phone), ''),
           instructions = nullif(btrim(p_instructions), ''), is_active = coalesce(p_active, is_active) where id = p_id;
  end if;
  return v_id;
end $$;

-- 2. Issue courier instructions (releases the address to the student)
create or replace function app.issue_courier_instructions(p_student uuid, p_address uuid, p_documents uuid[], p_exception text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_st students%rowtype; v_a courier_addresses%rowtype; v_id uuid := gen_random_uuid(); v_unapproved int; v_names text;
begin
  select * into v_st from students where id = p_student;
  if not found or not app.can_read_student(p_student) then raise exception 'student not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(p_student, 'documents.custody') then raise exception 'permission denied: documents.custody' using errcode = '42501'; end if;
  select * into v_a from courier_addresses where id = p_address and is_active;
  if not found or v_a.org_id <> v_st.originating_org_id then raise exception 'choose an active delivery address of the student''s company' using errcode = '23514'; end if;
  if coalesce(cardinality(p_documents), 0) = 0 then raise exception 'choose the original documents to be sent' using errcode = '23514'; end if;
  if exists (select 1 from unnest(p_documents) x where not exists (select 1 from student_documents d where d.id = x and d.student_id = p_student)) then
    raise exception 'unknown document' using errcode = '23514';
  end if;
  if exists (select 1 from original_shipment_items i join original_shipments s on s.id = i.shipment_id
              where i.student_document_id = any(p_documents) and s.status not in ('completed', 'cancelled')) then
    raise exception 'a chosen document already has open courier instructions' using errcode = '23514';
  end if;
  select count(*) into v_unapproved from student_documents d where d.id = any(p_documents) and d.status <> 'approved';
  if v_unapproved > 0 then
    if coalesce(btrim(p_exception), '') = '' then
      raise exception 'courier instructions are issued only after the scans are approved (% document(s) not approved)', v_unapproved using errcode = '23514';
    end if;
    if not app.can_on_student(p_student, 'courier.exception') then
      raise exception 'permission denied: courier.exception (instructions before scan approval)' using errcode = '42501';
    end if;
  end if;
  insert into original_shipments (id, org_id, student_id, address_id, address_snapshot, instructions, exception_reason, issued_by)
  values (v_id, v_st.originating_org_id, p_student, p_address,
          v_a.recipient || E'\n' || v_a.address || coalesce(E'\nPhone: ' || v_a.phone, ''), v_a.instructions,
          case when v_unapproved > 0 then btrim(p_exception) end, app.current_user_id());
  insert into original_shipment_items (shipment_id, student_document_id, scan_status)
  select v_id, d.id, d.status from student_documents d where d.id = any(p_documents);
  select string_agg(t.name || case when d.label <> '' then ' – ' || d.label else '' end, ', ' order by t.sort_order) into v_names
    from student_documents d join document_types t on t.id = d.document_type_id where d.id = any(p_documents);
  perform app.shipment_event(v_id, 'instructions_issued', 'courier instructions issued for ' || v_names
    || case when v_unapproved > 0 then ' (EXCEPTION before scan approval: ' || btrim(p_exception) || ')' else '' end);
  if v_unapproved > 0 then
    perform app.audit('courier_exception', 'original_shipments', v_id::text, v_st.originating_org_id, p_student, null,
                      jsonb_build_object('reason', btrim(p_exception), 'documents', p_documents));
  end if;
  perform app.enqueue_notification(p_student, 'courier_instructions_issued', jsonb_build_object('document', v_names));
  return v_id;
end $$;

-- 3. Courier details (staff)
create or replace function app.record_courier_dispatch(p_shipment uuid, p_company text, p_tracking text, p_date date, p_expected date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s original_shipments%rowtype;
begin
  select * into v_s from original_shipments where id = p_shipment for update;
  if not found or not app.can_read_student(v_s.student_id) then raise exception 'shipment not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_s.student_id, 'documents.custody') then raise exception 'permission denied: documents.custody' using errcode = '42501'; end if;
  if v_s.status not in ('instructions_issued', 'dispatched', 'in_transit') then raise exception 'courier details can no longer be changed' using errcode = '23514'; end if;
  if coalesce(btrim(p_company), '') = '' or coalesce(btrim(p_tracking), '') = '' then
    raise exception 'enter the courier company and the tracking number' using errcode = '23514';
  end if;
  if p_date is not null and p_date > current_date then raise exception 'the dispatch date cannot be in the future' using errcode = '23514'; end if;
  perform set_config('app.courier_change', 'on', true);
  update original_shipments set courier_company = btrim(p_company), tracking_number = btrim(p_tracking), dispatch_date = coalesce(p_date, current_date),
         expected_delivery = p_expected, dispatch_source = 'staff', dispatch_recorded_at = now(),
         status = case when status = 'instructions_issued' then 'dispatched' else status end
   where id = p_shipment;
  perform set_config('app.courier_change', 'off', true);
  perform app.shipment_event(p_shipment, 'dispatched', 'courier ' || btrim(p_company) || ', tracking ' || btrim(p_tracking) || ' (recorded by staff)');
end $$;

-- 3. Courier details (student/parent in the portal) — own shipment only
create or replace function app.portal_submit_courier(p_token_hash text, p_shipment uuid, p_company text, p_tracking text, p_date date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s original_shipments%rowtype; v_student uuid := app.portal_student(p_token_hash);
begin
  select * into v_s from original_shipments where id = p_shipment for update;
  if v_student is null or not found or v_s.student_id <> v_student then raise exception 'not found' using errcode = 'P0002'; end if;
  if v_s.status not in ('instructions_issued', 'dispatched') then raise exception 'the courier details can no longer be changed online; contact us' using errcode = '23514'; end if;
  if coalesce(btrim(p_company), '') = '' or coalesce(btrim(p_tracking), '') = '' then
    raise exception 'enter the courier company and the tracking number' using errcode = '23514';
  end if;
  if length(btrim(p_company)) > 120 or length(btrim(p_tracking)) > 80 then raise exception 'too long' using errcode = '23514'; end if;
  if p_date is not null and (p_date > current_date or p_date < v_s.issued_at::date - 1) then raise exception 'check the dispatch date' using errcode = '23514'; end if;
  perform set_config('app.courier_change', 'on', true);
  update original_shipments set courier_company = btrim(p_company), tracking_number = btrim(p_tracking), dispatch_date = coalesce(p_date, current_date),
         dispatch_source = 'portal', dispatch_recorded_at = now(), status = 'dispatched'
   where id = p_shipment;
  perform set_config('app.courier_change', 'off', true);
  perform app.shipment_event(p_shipment, 'dispatched', 'courier ' || btrim(p_company) || ', tracking ' || btrim(p_tracking) || ' (submitted in the student portal)', 'student');
end $$;

-- 4. Transit / receipt / cancel
create or replace function app.update_shipment_status(p_shipment uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s original_shipments%rowtype; r record;
begin
  select * into v_s from original_shipments where id = p_shipment for update;
  if not found or not app.can_read_student(v_s.student_id) then raise exception 'shipment not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_s.student_id, 'documents.custody') then raise exception 'permission denied: documents.custody' using errcode = '42501'; end if;
  if p_status = 'in_transit' and v_s.status not in ('dispatched') then raise exception 'record the courier details first' using errcode = '23514'; end if;
  if p_status = 'received' and v_s.status not in ('dispatched', 'in_transit') then raise exception 'only a dispatched shipment can be received' using errcode = '23514'; end if;
  if p_status = 'cancelled' then
    if v_s.status in ('received', 'reconciliation_required', 'completed', 'cancelled') then raise exception 'this shipment can no longer be cancelled' using errcode = '23514'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'give the reason for cancelling' using errcode = '23514'; end if;
  end if;
  if p_status not in ('in_transit', 'received', 'cancelled') then raise exception 'invalid status' using errcode = '23514'; end if;
  perform set_config('app.courier_change', 'on', true);
  update original_shipments set status = p_status,
         received_at = case when p_status = 'received' then now() else received_at end,
         received_by = case when p_status = 'received' then app.current_user_id() else received_by end,
         cancelled_reason = case when p_status = 'cancelled' then btrim(p_note) else cancelled_reason end
   where id = p_shipment;
  perform set_config('app.courier_change', 'off', true);
  if p_status = 'received' then
    -- the originals are now with the office
    perform set_config('app.doc_change', 'on', true);
    for r in select i.student_document_id from original_shipment_items i where i.shipment_id = p_shipment loop
      insert into document_custody_events (student_document_id, location, note, third_party_ref, recorded_by)
      values (r.student_document_id, 'with_staff', 'Original received by courier', v_s.tracking_number, app.current_user_id());
      update student_documents set original_location = 'with_staff', location_note = 'Original received by courier',
             third_party_ref = coalesce(v_s.tracking_number, third_party_ref) where id = r.student_document_id;
    end loop;
    perform set_config('app.doc_change', 'off', true);
    perform app.enqueue_notification(v_s.student_id, 'original_received', jsonb_build_object('document',
      (select string_agg(t.name, ', ') from original_shipment_items i join student_documents d on d.id = i.student_document_id
         join document_types t on t.id = d.document_type_id where i.shipment_id = p_shipment)));
  end if;
  perform app.shipment_event(p_shipment, p_status, case p_status when 'in_transit' then 'in transit' when 'received' then 'originals physically received at the office'
    else 'cancelled' end || coalesce(' – ' || nullif(btrim(p_note), ''), ''));
end $$;

-- 4. Reconcile each original against the approved scan
create or replace function app.reconcile_shipment(p_shipment uuid, p_items jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s original_shipments%rowtype; x jsonb; v_status text; v_bad int;
begin
  select * into v_s from original_shipments where id = p_shipment for update;
  if not found or not app.can_read_student(v_s.student_id) then raise exception 'shipment not found' using errcode = 'P0002'; end if;
  if not app.can_on_student(v_s.student_id, 'documents.custody') then raise exception 'permission denied: documents.custody' using errcode = '42501'; end if;
  if v_s.status not in ('received', 'reconciliation_required') then raise exception 'confirm physical receipt first' using errcode = '23514'; end if;
  perform set_config('app.courier_change', 'on', true);
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    if (x ->> 'result') not in ('matches', 'mismatch') then raise exception 'choose matches or mismatch for every document' using errcode = '23514'; end if;
    if (x ->> 'result') = 'mismatch' and coalesce(btrim(x ->> 'note'), '') = '' then
      raise exception 'describe each mismatch' using errcode = '23514';
    end if;
    update original_shipment_items set reconciliation = x ->> 'result', reconciliation_note = nullif(btrim(x ->> 'note'), ''),
           reconciled_by = app.current_user_id(), reconciled_at = now()
     where id = (x ->> 'id')::uuid and shipment_id = p_shipment;
  end loop;
  if exists (select 1 from original_shipment_items where shipment_id = p_shipment and reconciliation = 'pending') then
    raise exception 'reconcile every document in the shipment' using errcode = '23514';
  end if;
  select count(*) into v_bad from original_shipment_items where shipment_id = p_shipment and reconciliation = 'mismatch';
  v_status := case when v_bad > 0 then 'reconciliation_required' else 'completed' end;
  update original_shipments set status = v_status, completed_at = case when v_status = 'completed' then now() end where id = p_shipment;
  perform set_config('app.courier_change', 'off', true);
  perform app.shipment_event(p_shipment, v_status, case when v_bad > 0 then v_bad || ' original(s) do not match the approved scan'
                                                     else 'all originals match the approved scans – completed' end);
  if v_bad > 0 then
    insert into tasks (org_id, student_id, title, description, task_type, assigned_to, priority, due_date, source_key)
    values (v_s.org_id, v_s.student_id, 'Original documents do not match the approved scans – ' || (select student_code from students where id = v_s.student_id),
            'Physical originals received by courier differ from the approved scans. Check the shipment on the Documents tab.', 'courier',
            app.current_user_id(), 'high', current_date + 2, 'courier-mismatch:' || p_shipment::text || ':' || (select count(*) from original_shipment_events where shipment_id = p_shipment))
    on conflict do nothing;
  end if;
  return v_status;
end $$;

-- Portal: the student's courier instructions (exist only after issuance, i.e. after scan approval)
create or replace function app.portal_shipments(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'status', s.status, 'issued_at', s.issued_at, 'address', s.address_snapshot, 'instructions', s.instructions,
           'courier_company', s.courier_company, 'tracking_number', s.tracking_number, 'dispatch_date', s.dispatch_date, 'received_at', s.received_at,
           'documents', (select jsonb_agg(t.name || case when d.label <> '' then ' – ' || d.label else '' end order by t.sort_order)
                           from original_shipment_items i join student_documents d on d.id = i.student_document_id
                           join document_types t on t.id = d.document_type_id where i.shipment_id = s.id))
         order by s.issued_at desc), '[]')
    from original_shipments s
   where s.student_id = app.portal_student(p_token_hash) and s.status <> 'cancelled'
$$;

-- Notifications (templates are provisioned; rules start switched off)
alter table notification_rules drop constraint notification_rules_event_key_check;
alter table notification_rules add constraint notification_rules_event_key_check
  check (event_key in ('student_registered', 'stage_changed', 'document_changes_required', 'document_rejected', 'document_approved',
                       'visa_outcome', 'portal_login_code', 'attestation_stage_completed', 'attestation_completed', 'one_and_same_requested',
                       'courier_instructions_issued', 'original_received'));

-- RLS
alter table courier_addresses enable row level security;
alter table original_shipments enable row level security;
alter table original_shipment_items enable row level security;
alter table original_shipment_events enable row level security;
create policy courier_addresses_select on courier_addresses for select to erp_app using (app.is_member(org_id));
create policy shipments_select on original_shipments for select to erp_app using (app.can_read_student(student_id));
create policy shipment_items_select on original_shipment_items for select to erp_app
  using (exists (select 1 from original_shipments s where s.id = shipment_id and app.can_read_student(s.student_id)));
create policy shipment_events_select on original_shipment_events for select to erp_app
  using (exists (select 1 from original_shipments s where s.id = shipment_id and app.can_read_student(s.student_id)));
grant select on courier_addresses, original_shipments, original_shipment_items, original_shipment_events to erp_app;
grant execute on function
  app.save_courier_address(uuid, uuid, text, text, text, text, text, boolean),
  app.issue_courier_instructions(uuid, uuid, uuid[], text), app.record_courier_dispatch(uuid, text, text, date, date),
  app.portal_submit_courier(text, uuid, text, text, date), app.update_shipment_status(uuid, text, text),
  app.reconcile_shipment(uuid, jsonb), app.portal_shipments(text)
to erp_app;
