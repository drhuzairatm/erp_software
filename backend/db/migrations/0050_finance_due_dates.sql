-- Phase 10: due dates and reminders on existing charges. The ledger, rates, receipts and reversals are
-- reused unchanged; no payment entry is altered and nothing is recalculated.
--
-- A due date belongs to a charge. The ledger records no link between a receipt and a charge, so
-- payment_due_status works out what is unpaid when it is read: credits are treated as settling the
-- earliest due date first. That is a display rule for reminders and reports. Nothing is stored or allocated.

create table payment_due_dates (
  entry_id   uuid primary key references payment_entries(id),
  org_id     uuid not null references organizations(id),
  student_id uuid not null references students(id),
  due_date   date not null,
  note       text check (note is null or length(note) <= 500),
  set_by     uuid not null references user_profiles(id),
  set_at     timestamptz not null default now()
);
create index payment_due_dates_date on payment_due_dates (org_id, due_date);
create index payment_due_dates_student on payment_due_dates (student_id);

alter table payment_due_dates enable row level security;
create policy payment_due_dates_select on payment_due_dates for select to erp_app
  using (app.has_perm(org_id, 'payments.read') and app.can_read_student(student_id));
grant select on payment_due_dates to erp_app;

create view payment_due_status with (security_invoker = true) as
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
grant select on payment_due_status to erp_app;

create or replace function app.set_payment_due_date(p_entry uuid, p_date date, p_note text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e payment_entries; v_old payment_due_dates; v_me uuid := app.current_user_id();
begin
  select * into e from payment_entries where id = p_entry for update;
  if not found or not app.has_perm(e.org_id, 'payments.read') or not app.can_read_student(e.student_id) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not app.has_perm(e.org_id, 'payments.record') then raise exception 'permission denied' using errcode = '42501'; end if;
  if e.entry_type <> 'charge' then raise exception 'A due date can only be set on a charge.' using errcode = '23514'; end if;
  if exists (select 1 from payment_entries r where r.reverses_entry_id = e.id and r.verification_status in ('not_required', 'verified')) then
    raise exception 'This charge has been reversed.' using errcode = '23514';
  end if;
  if p_date is null or p_date < e.entry_date then raise exception 'The due date cannot be before the charge date.' using errcode = '23514'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'The note is too long.' using errcode = '23514'; end if;
  select * into v_old from payment_due_dates where entry_id = p_entry for update;
  if found then
    if v_old.due_date = p_date and v_old.note is not distinct from nullif(btrim(p_note), '') then return; end if;
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for changing the due date.' using errcode = '23514'; end if;
    update payment_due_dates set due_date = p_date, note = nullif(btrim(p_note), ''), set_by = v_me, set_at = now() where entry_id = p_entry;
  else
    insert into payment_due_dates (entry_id, org_id, student_id, due_date, note, set_by)
    values (p_entry, e.org_id, e.student_id, p_date, nullif(btrim(p_note), ''), v_me);
  end if;
  perform app.audit(case when v_old.entry_id is null then 'payment_due_date_set' else 'payment_due_date_changed' end, 'payment_entries', p_entry::text, e.org_id, e.student_id,
    case when v_old.entry_id is null then null else jsonb_build_object('due_date', v_old.due_date) end,
    jsonb_build_object('due_date', p_date), 'success',
    case when v_old.entry_id is null then null else jsonb_build_object('reason', btrim(p_reason)) end);
end $$;

-- System job, daily: reminders to staff who record payments. No amounts or names in the text.
-- Overdue reminders stop 3 days after the due date, as task reminders do.
create or replace function app.payment_due_reminders() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_before bigint; v_after bigint; v_overdue boolean;
begin
  if app.current_user_id() is not null then raise exception 'system job only' using errcode = '42501'; end if;
  select count(*) into v_before from staff_notifications where event_key in ('payment_due_soon', 'payment_overdue');
  for r in select s.entry_id, s.org_id, s.student_id, s.due_date, m.user_id
             from payment_due_status s
             join organization_memberships m on m.org_id = s.org_id and m.is_active and app.role_has_perm(m.role_id, 'payments.record')
             join user_profiles u on u.id = m.user_id and u.is_active
            where s.unpaid > 0 and s.due_date between current_date - 3 and current_date + 3 loop
    v_overdue := r.due_date < current_date;
    perform app.staff_notify(r.user_id, r.org_id, case when v_overdue then 'payment_overdue' else 'payment_due_soon' end,
      case when v_overdue then 'A student payment is overdue' else 'A student payment is due soon' end,
      '/students/' || r.student_id, null, null, case when v_overdue then 'warning' else 'info' end,
      case when v_overdue then 'payment_overdue:' else 'payment_due_soon:' end || r.entry_id || ':' || r.due_date, v_overdue);
  end loop;
  select count(*) into v_after from staff_notifications where event_key in ('payment_due_soon', 'payment_overdue');
  return v_after - v_before;
end $$;

revoke execute on function app.set_payment_due_date(uuid, date, text, text), app.payment_due_reminders() from public;
grant execute on function app.set_payment_due_date(uuid, date, text, text), app.payment_due_reminders() to erp_app;
