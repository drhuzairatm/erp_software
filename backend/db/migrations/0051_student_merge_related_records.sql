-- Fixes for student merges (audit findings BC-03 and BC-04). Payment entries are not altered here, and a merge still moves
-- them exactly as before.
--
-- BC-03. A merge moved the charge but not its due date, so a paid charge looked unpaid on the merged record and could raise
-- false overdue reminders. The due date now moves with the charge, and payment_due_status takes the student from the charge
-- itself, so the two cannot disagree.
--
-- Moving the due date is not enough. The ledger records no link between a receipt and a charge: credits settle the earliest
-- due date first. Pooling two records' credits could therefore shift money onto the other record's older charge, and a fully
-- paid charge would look unpaid again. So a merge records how much of each dated charge was settled at that moment
-- (settled_on_merge). The view honours that first, and only spare credit settles earliest first. If the money is later
-- reduced, for example a receipt is reversed, so the recorded amounts can no longer all be honoured, the view falls back to
-- plain earliest first. The total unpaid is then still right. This remains a display rule: nothing is allocated in the ledger.
--
-- BC-04. Preferences, tickets and pre-admission links stayed on the merged record. They now move, with their history.
-- If two records hold preferences that cannot both fit, the merge stops and says why. Nothing is lost silently.

alter table payment_due_dates add column settled_on_merge numeric(14, 2) not null default 0 check (settled_on_merge >= 0);

alter table student_preference_history add column note text check (note is null or length(note) <= 300);
alter table student_preference_history drop constraint student_preference_history_action_check;
alter table student_preference_history add constraint student_preference_history_action_check
  check (action in ('saved', 'cleared', 'merged_in', 'merged_duplicate'));

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
  select d.entry_id, c.org_id, c.student_id, c.ledger, c.currency, c.amount, d.due_date, d.note,
         least(d.settled_on_merge, c.amount) as recorded, coalesce(k.credit, 0) as credit
    from payment_due_dates d join active_charges c on c.id = d.entry_id
    left join credits k on k.student_id = c.student_id and k.org_id = c.org_id and k.ledger = c.ledger and k.currency = c.currency
), honoured as (
  -- amounts recorded at a merge count only while the money behind them still exists
  select x.*, case when x.credit >= sum(x.recorded) over w then x.recorded else 0 end as settled
    from dated x
  window w as (partition by x.student_id, x.org_id, x.ledger, x.currency)
), running as (
  select h.*, sum(h.amount - h.settled) over (partition by h.student_id, h.org_id, h.ledger, h.currency order by h.due_date, h.entry_id) as run_open,
         h.credit - sum(h.settled) over (partition by h.student_id, h.org_id, h.ledger, h.currency) as spare
    from honoured h
)
select r.entry_id, r.org_id, r.student_id, r.ledger, r.currency, r.amount, r.due_date, r.note,
       least(r.amount - r.settled, greatest(r.run_open - r.spare, 0))::numeric(14, 2) as unpaid
  from running r;

-- A due date set after an earlier merge, or left behind by one, follows its charge.
update payment_due_dates d set student_id = e.student_id
  from payment_entries e where e.id = d.entry_id and d.student_id <> e.student_id;

create or replace function app.merge_students(p_surviving uuid, p_merged uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_keep students%rowtype;
  v_drop students%rowtype;
  v_ledger_before text;
  v_ledger_after text;
  v_entries int;
  v_due int;
  v_prefs int := 0;
  v_prefs_dup int := 0;
  v_tickets int := 0;
  v_dvr int := 0;
  v_rank int;
  v_action text;
  p student_preferences%rowtype;
  r record;
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

  -- Ledger totals of both records together, compared again after the move, and what each dated charge has settled so far.
  select string_agg(concat_ws('|', x.org_id, x.ledger, x.currency, x.due, x.received, x.disbursed, x.pending), ',' order by x.org_id, x.ledger, x.currency) into v_ledger_before
    from (select b.org_id, b.ledger, b.currency, sum(b.amount_due) as due, sum(b.amount_received) as received, sum(b.amount_disbursed) as disbursed, sum(b.pending_receipts) as pending
            from student_balances b where b.student_id in (p_surviving, p_merged) group by b.org_id, b.ledger, b.currency) x;
  perform 1 from payment_due_dates d where d.student_id in (p_surviving, p_merged) for update;
  update payment_due_dates d set settled_on_merge = s.amount - s.unpaid
    from payment_due_status s where s.entry_id = d.entry_id and s.student_id in (p_surviving, p_merged);

  -- Re-point child records (payment entries are otherwise immutable; this flag
  -- allows ONLY their student_id to change, see payments guard trigger)
  perform set_config('app.merging', 'on', true);
  update student_notes set student_id = p_surviving where student_id = p_merged;
  update followups set student_id = p_surviving where student_id = p_merged;
  update tasks set student_id = p_surviving where student_id = p_merged;
  update payment_entries set student_id = p_surviving where student_id = p_merged;
  get diagnostics v_entries = row_count;
  update payment_due_dates set student_id = p_surviving where student_id = p_merged;
  get diagnostics v_due = row_count;
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

  select string_agg(concat_ws('|', x.org_id, x.ledger, x.currency, x.due, x.received, x.disbursed, x.pending), ',' order by x.org_id, x.ledger, x.currency) into v_ledger_after
    from (select b.org_id, b.ledger, b.currency, sum(b.amount_due) as due, sum(b.amount_received) as received, sum(b.amount_disbursed) as disbursed, sum(b.pending_receipts) as pending
            from student_balances b where b.student_id in (p_surviving, p_merged) group by b.org_id, b.ledger, b.currency) x;
  if v_ledger_before is distinct from v_ledger_after then
    raise exception 'The merge was stopped because the payment totals would have changed. Nothing was merged.' using errcode = '23514';
  end if;

  -- Keep the other brand's access/attribution
  insert into student_org_access (student_id, org_id, relation)
  select p_surviving, a.org_id, case when a.relation = 'processing' then 'processing' else 'secondary_brand' end
    from student_org_access a
   where a.student_id = p_merged
     and not exists (select 1 from student_org_access b where b.student_id = p_surviving and b.org_id = a.org_id
                       and (b.relation = a.relation or (a.relation <> 'processing' and b.relation in ('originating','secondary_brand'))))
  on conflict do nothing;

  -- Preferences. The history comes across first, then each preference moves, is recognised as a duplicate, or stops the merge.
  update student_preference_history set student_id = p_surviving where student_id = p_merged;
  for p in select * from student_preferences where student_id = p_merged order by rank for update loop
    if (p.country_id = v_keep.destination_country_id and p.university_id is not distinct from v_keep.preferred_university_id and p.course_id is not distinct from v_keep.course_id)
       or exists (select 1 from student_preferences x where x.student_id = p_surviving and x.country_id = p.country_id
                    and x.university_id is not distinct from p.university_id and x.course_id is not distinct from p.course_id) then
      v_action := 'merged_duplicate';
      v_rank := p.rank;
      v_prefs_dup := v_prefs_dup + 1;
      delete from student_preferences where id = p.id;
    else
      select c.rank into v_rank from (values (p.rank, 0), (5 - p.rank, 1)) as c(rank, pos)
       where not exists (select 1 from student_preferences x where x.student_id = p_surviving and x.rank = c.rank)
       order by c.pos limit 1;
      if v_rank is null then
        raise exception 'Cannot merge: both records have different secondary and tertiary preferences. Clear the one that is no longer wanted on % or %, then merge again.', v_keep.student_code, v_drop.student_code using errcode = '23514';
      end if;
      v_action := 'merged_in';
      v_prefs := v_prefs + 1;
      update student_preferences set student_id = p_surviving, rank = v_rank where id = p.id;
    end if;
    insert into student_preference_history (student_id, rank, action, country, university, programme, intake, academic_year, changed_by, note)
    values (p_surviving, v_rank, v_action, (select name from countries where id = p.country_id), (select name from universities where id = p.university_id),
            (select name from courses where id = p.course_id), (select name from university_intakes where id = p.intake_id), (select code from academic_years where id = p.academic_year_id),
            app.current_user_id(), 'From merged record ' || v_drop.student_code);
  end loop;

  -- Tickets keep their company, number, messages, files, assignee and events. The student who asked is now this record.
  for r in select t.id, t.org_id from student_tickets t where t.student_id = p_merged for update loop
    if not exists (select 1 from student_org_access a where a.student_id = p_surviving and a.org_id = r.org_id) then
      raise exception 'Cannot merge: student question access could not be kept for the surviving record.' using errcode = '23514';
    end if;
    update student_tickets set student_id = p_surviving where id = r.id;
    perform app.ticket_log(r.id, r.org_id, p_surviving, 'student_merged', null, null, 'Moved from merged record ' || v_drop.student_code, false);
    v_tickets := v_tickets + 1;
  end loop;
  update portal_notices set student_id = p_surviving where student_id = p_merged and kind = 'ticket';

  -- Pre-admission links keep who linked them and when. The request itself is unchanged.
  for r in select q.id, q.org_id, q.status from dvr_requests q where q.linked_student_id = p_merged for update loop
    if not exists (select 1 from student_org_access a where a.student_id = p_surviving and a.org_id = r.org_id) then
      raise exception 'Cannot merge: a pre-admission link could not be kept for the surviving record.' using errcode = '23514';
    end if;
    update dvr_requests set linked_student_id = p_surviving where id = r.id;
    insert into dvr_events (request_id, action, from_status, to_status, note, actor_id)
    values (r.id, 'student_link_moved', r.status, r.status, 'Moved from merged record ' || v_drop.student_code || ' to ' || v_keep.student_code, app.current_user_id());
    perform app.audit('dvr_student_link_moved', 'dvr_requests', r.id::text, r.org_id, p_surviving, jsonb_build_object('linked_student_id', p_merged), jsonb_build_object('linked_student_id', p_surviving));
    v_dvr := v_dvr + 1;
  end loop;

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
                    jsonb_build_object('merged_into', p_surviving, 'reason', btrim(p_reason),
                      'moved', jsonb_build_object('payment_entries', v_entries, 'due_dates', v_due, 'preferences', v_prefs, 'duplicate_preferences', v_prefs_dup, 'tickets', v_tickets, 'pre_admission_links', v_dvr)));
end $$;

-- A merged record is kept for history only: nothing new may link to it, so a pre-admission link cannot be orphaned there.
create or replace function app.dvr_link_student(p_request uuid, p_student uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v dvr_requests%rowtype; v_me uuid := app.current_user_id();
begin
  select * into v from dvr_requests q where q.id = p_request for update;
  if v.id is null or not app.dvr_is_owner(p_request) then raise exception 'permission denied: pre-admission request' using errcode = '42501'; end if;
  if v.status not in ('verification_completed', 'returned_to_counselor', 'closed') then raise exception 'Link a student after verification is complete.' using errcode = '23514'; end if;
  if v.linked_student_id is not null then raise exception 'This request is already linked to a student.' using errcode = '23514'; end if;
  if not app.can_read_student(p_student) or not exists (select 1 from student_org_access a where a.student_id = p_student and a.org_id = v.org_id) then raise exception 'That student was not found in this company.' using errcode = '23514'; end if;
  if exists (select 1 from students s where s.id = p_student and s.status = 'merged') then raise exception 'That student record was merged. Link the surviving record instead.' using errcode = '23514'; end if;
  update dvr_requests set linked_student_id = p_student, linked_at = now(), linked_by = v_me where id = p_request;
  perform app.audit('dvr_student_linked', 'dvr_requests', p_request::text, v.org_id, p_student, null, null);
  insert into dvr_events (request_id, action, from_status, to_status, actor_id) values (p_request, 'student_linked', v.status, v.status, v_me);
end $$;

-- Both functions keep the access they already had. Stated again here because each was re-created in this file.
revoke execute on function app.merge_students(uuid, uuid, text), app.dvr_link_student(uuid, uuid) from public;
