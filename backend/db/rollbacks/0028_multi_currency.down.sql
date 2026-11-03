-- Undo 0028 (multi-currency). WARNING: removes currencies, exchange rates and INR equivalents, rate-change history and
-- receipt numbers. Refuses if entries in a currency other than INR exist. Back up first (npm run db:backup).
do $$ begin
  if exists (select 1 from payment_entries where currency <> 'INR') then
    raise exception 'entries in currencies other than INR exist; this rollback would lose their exchange rates';
  end if;
end $$;

drop view student_balances;
drop view payment_entry_effects;
create view payment_entry_effects with (security_invoker = true) as
select e.id, e.org_id, e.student_id, e.ledger, e.currency, e.entry_type, e.entry_date,
       case when e.verification_status in ('not_required', 'verified') then
         case coalesce(o.entry_type, e.entry_type)
           when 'charge' then 1 when 'waiver' then -1 else 0 end
         * case when e.entry_type = 'reversal' then -1 else 1 end * e.amount
       else 0 end as due_effect,
       case when e.verification_status in ('not_required', 'verified') then
         case coalesce(o.entry_type, e.entry_type)
           when 'receipt' then 1 when 'refund' then -1 else 0 end
         * case when e.entry_type = 'reversal' then -1 else 1 end * e.amount
       else 0 end as received_effect,
       case when e.verification_status in ('not_required', 'verified') then
         case coalesce(o.entry_type, e.entry_type) when 'disbursement' then 1 else 0 end
         * case when e.entry_type = 'reversal' then -1 else 1 end * e.amount
       else 0 end as disbursed_effect,
       case when e.verification_status = 'pending' and e.entry_type = 'receipt' then e.amount else 0 end as pending_receipts
  from payment_entries e
  left join payment_entries o on o.id = e.reverses_entry_id;

create view student_balances with (security_invoker = true) as
select student_id, org_id, ledger, currency,
       sum(due_effect)::numeric(14, 2)                           as amount_due,
       sum(received_effect)::numeric(14, 2)                      as amount_received,
       (sum(due_effect) - sum(received_effect))::numeric(14, 2)  as outstanding,
       sum(disbursed_effect)::numeric(14, 2)                     as amount_disbursed,
       (sum(received_effect) - sum(disbursed_effect))::numeric(14, 2) as held_balance,
       sum(pending_receipts)::numeric(14, 2)                     as pending_receipts
  from payment_entry_effects
 group by student_id, org_id, ledger, currency;
grant select on payment_entry_effects, student_balances to erp_app;

create or replace function app.verify_payment(p_entry uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_e payment_entries%rowtype;
  v_allow_self boolean;
begin
  select * into v_e from payment_entries where id = p_entry for update;
  if not found or not app.has_perm(v_e.org_id, 'payments.read') then
    raise exception 'payment entry not found' using errcode = 'P0002';
  end if;
  if not app.has_perm(v_e.org_id, 'payments.verify') then
    raise exception 'permission denied: payments.verify' using errcode = '42501';
  end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'invalid decision' using errcode = '23514'; end if;
  if v_e.verification_status <> 'pending' then
    raise exception 'only pending entries can be verified or rejected' using errcode = '23514';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'a note is required when rejecting' using errcode = '23514';
  end if;
  select coalesce((settings ->> 'allow_self_payment_verification')::boolean, false) into v_allow_self
    from organizations where id = v_e.org_id;
  if v_e.recorded_by = app.current_user_id() and not v_allow_self then
    raise exception 'entries must be verified by a different staff member than the one who recorded them' using errcode = '42501';
  end if;
  perform set_config('app.payment_verify', 'on', true);
  update payment_entries set verification_status = p_decision, verified_by = app.current_user_id(), verified_at = now()
   where id = p_entry;
  perform set_config('app.payment_verify', 'off', true);
  insert into payment_verifications (payment_entry_id, decision, note, verified_by)
  values (p_entry, p_decision, nullif(btrim(p_note), ''), app.current_user_id());
  perform app.add_event_internal(v_e.student_id, v_e.org_id, 'payment', 'verification',
                        initcap(v_e.entry_type) || ' of ' || v_e.currency || ' ' || to_char(v_e.amount, 'FM999,999,990.00') || ' ' || p_decision,
                        'payment_entries', p_entry::text);
end $$;

create or replace function app.payments_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_orig payment_entries%rowtype;
  v_kind text;
begin
  new.recorded_by := app.current_user_id();
  if new.recorded_by is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  new.recorded_at := now();
  new.verified_by := null;
  new.verified_at := null;
  select kind into v_kind from fee_categories where id = new.fee_category_id and org_id = new.org_id;
  new.ledger := v_kind;
  new.verification_status := case when new.entry_type = 'charge' then 'not_required' else 'pending' end;
  if not app.student_has_org(new.student_id, new.org_id) then
    raise exception 'this company does not have access to the student' using errcode = '23514';
  end if;
  if new.entry_type = 'reversal' then
    select * into v_orig from payment_entries where id = new.reverses_entry_id;
    if not found or v_orig.student_id <> new.student_id or v_orig.org_id <> new.org_id then
      raise exception 'reversal must reference an entry of the same student and company' using errcode = '23514';
    end if;
    if v_orig.entry_type = 'reversal' then raise exception 'a reversal cannot be reversed' using errcode = '23514'; end if;
    if v_orig.verification_status not in ('not_required', 'verified') then
      raise exception 'only verified entries or charges can be reversed' using errcode = '23514';
    end if;
    new.amount := v_orig.amount;
    new.currency := v_orig.currency;
    new.fee_category_id := v_orig.fee_category_id;
    new.ledger := v_orig.ledger;
  end if;
  return new;
end $$;

create or replace function app.payments_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'payment entries cannot be deleted; record a reversal instead' using errcode = '42501'; end if;
  if coalesce(current_setting('app.merging', true), 'off') = 'on'
     and (to_jsonb(new) - 'student_id') = (to_jsonb(old) - 'student_id') then
    return new;
  end if;
  if coalesce(current_setting('app.payment_verify', true), 'off') = 'on'
     and (to_jsonb(new) - 'verification_status' - 'verified_by' - 'verified_at')
       = (to_jsonb(old) - 'verification_status' - 'verified_by' - 'verified_at') then
    return new;
  end if;
  raise exception 'payment entries cannot be edited; record a reversal instead' using errcode = '42501';
end $$;

drop function app.issue_payment_receipt(uuid);
drop function app.correct_exchange_rate(uuid, numeric, text);
drop table payment_receipts;
drop table payment_rate_changes;
drop index payment_entries_reference_once;
alter table payment_entries drop constraint payment_entries_currency_fk;
alter table payment_entries disable trigger payments_guard;
alter table payment_entries drop column exchange_rate, drop column inr_amount, drop column rate_source;
alter table payment_entries enable trigger payments_guard;
drop table currencies;
delete from role_permissions where permission_key = 'currencies.manage';
delete from permissions where key = 'currencies.manage';
