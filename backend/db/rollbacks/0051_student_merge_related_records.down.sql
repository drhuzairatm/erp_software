-- Undo 0051. Records already moved by a merge stay on the surviving student: they are correct there, and the merged record is
-- history only. The amounts recorded at a merge are lost, so credits go back to settling the earliest due date first. History rows
-- written by a merge are removed, because the earlier rule does not allow them. The audit log keeps what each merge moved.
-- Merges after this rollback leave due dates, preferences, tickets and pre-admission links behind again (BC-03, BC-04).
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

create or replace function app.merge_students(p_surviving uuid, p_merged uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_keep students%rowtype;
  v_drop students%rowtype;
begin
  if p_surviving = p_merged then raise exception 'cannot merge a record into itself' using errcode = '23514'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
  select * into v_keep from students where id = p_surviving for update;
  select * into v_drop from students where id = p_merged for update;
  if v_keep.id is null or v_drop.id is null
     or not app.can_read_student(p_surviving) or not app.can_read_student(p_merged) then
    raise exception 'student not found' using errcode = 'P0002';
  end if;
  if not app.has_perm(v_keep.originating_org_id, 'students.merge')
     or not app.has_perm(v_drop.originating_org_id, 'students.merge') then
    raise exception 'permission denied: students.merge is required in both companies' using errcode = '42501';
  end if;
  if v_keep.status = 'merged' or v_drop.status = 'merged' then
    raise exception 'one of the records is already merged' using errcode = '23514';
  end if;

  -- Re-point child records (payment entries are otherwise immutable; this flag
  -- allows ONLY their student_id to change, see payments guard trigger)
  perform set_config('app.merging', 'on', true);
  update student_notes set student_id = p_surviving where student_id = p_merged;
  update followups set student_id = p_surviving where student_id = p_merged;
  update tasks set student_id = p_surviving where student_id = p_merged;
  update payment_entries set student_id = p_surviving where student_id = p_merged;
  -- Documents: keep both if the same type exists, labelling the moved one.
  update student_documents d set student_id = p_surviving,
         label = case when exists (select 1 from student_documents k where k.student_id = p_surviving
                                     and k.document_type_id = d.document_type_id and k.label = d.label)
                      then left(trim(d.label || ' (from ' || v_drop.student_code || ')'), 120) else d.label end
   where d.student_id = p_merged;
  -- Assignments: end the merged record's assignments (surviving keeps its own)
  update student_assignments set is_active = false, ended_at = now(), ended_by = app.current_user_id()
   where student_id = p_merged and is_active;
  perform set_config('app.merging', 'off', true);

  -- Keep the other brand's access/attribution
  insert into student_org_access (student_id, org_id, relation)
  select p_surviving, a.org_id, case when a.relation = 'processing' then 'processing' else 'secondary_brand' end
    from student_org_access a
   where a.student_id = p_merged
     and not exists (select 1 from student_org_access b where b.student_id = p_surviving and b.org_id = a.org_id
                       and (b.relation = a.relation or (a.relation <> 'processing' and b.relation in ('originating','secondary_brand'))))
  on conflict do nothing;

  perform set_config('app.stage_change', 'on', true);
  update students set status = 'merged', merged_into_id = p_surviving where id = p_merged;
  perform set_config('app.stage_change', 'off', true);

  insert into student_merges (surviving_student_id, merged_student_id, merged_by, reason)
  values (p_surviving, p_merged, app.current_user_id(), btrim(p_reason));

  perform app.add_event_internal(p_surviving, v_keep.originating_org_id, 'student', 'merged',
                        'Duplicate record ' || v_drop.student_code || ' merged into this record: ' || btrim(p_reason));
  perform app.add_event_internal(p_merged, v_drop.originating_org_id, 'student', 'merged',
                        'Merged into ' || v_keep.student_code || ': ' || btrim(p_reason));
  perform app.audit('merge', 'students', p_merged::text, v_drop.originating_org_id, p_merged, null,
                    jsonb_build_object('merged_into', p_surviving, 'reason', btrim(p_reason)));
end $$;

create or replace view payment_due_status with (security_invoker = true) as
with active_charges as (
  select e.id, e.org_id, e.student_id, e.ledger, e.currency, e.amount
    from payment_entries e
   where e.entry_type = 'charge'
     and not exists (select 1 from payment_entries r where r.reverses_entry_id = e.id and r.verification_status in ('not_required', 'verified'))
), credits as (
  -- received money plus waivers. Waivers are the gap between active charges and the net amount due.
  select b.student_id, b.org_id, b.ledger, b.currency,
         b.amount_received + coalesce((select sum(c.amount) from active_charges c
            where c.student_id = b.student_id and c.org_id = b.org_id and c.ledger = b.ledger and c.currency = b.currency), 0) - b.amount_due as credit
    from student_balances b
), dated as (
  select d.entry_id, d.org_id, d.student_id, c.ledger, c.currency, c.amount, d.due_date, d.note,
         sum(c.amount) over (partition by d.student_id, d.org_id, c.ledger, c.currency order by d.due_date, d.entry_id) as running
    from payment_due_dates d join active_charges c on c.id = d.entry_id
)
select x.entry_id, x.org_id, x.student_id, x.ledger, x.currency, x.amount, x.due_date, x.note,
       least(x.amount, greatest(x.running - coalesce(k.credit, 0), 0))::numeric(14, 2) as unpaid
  from dated x
  left join credits k on k.student_id = x.student_id and k.org_id = x.org_id and k.ledger = x.ledger and k.currency = x.currency;

alter table payment_due_dates drop column settled_on_merge;

delete from student_preference_history where action in ('merged_in', 'merged_duplicate');
alter table student_preference_history drop constraint student_preference_history_action_check;
alter table student_preference_history add constraint student_preference_history_action_check check (action in ('saved', 'cleared'));
alter table student_preference_history drop column note;

-- Both functions keep the access they already had. Stated again here because each was re-created in this file.
revoke execute on function app.merge_students(uuid, uuid, text), app.dvr_link_student(uuid, uuid) from public;
