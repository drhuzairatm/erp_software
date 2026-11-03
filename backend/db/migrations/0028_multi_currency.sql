-- =============================================================================
-- 0028 Multi-currency payments (Nov 2026)
--
-- * currencies: INR, USD, EUR to start; more can be added without code changes.
-- * Every entry stores the exchange rate APPLIED to that transaction (INR per 1 unit;
--   INR = 1) and its INR equivalent, calculated in the database. Historical
--   entries are never recalculated; a reference rate only pre-fills the form.
-- * Balances stay per currency (no automatic cross-currency offsetting);
--   consolidated reporting uses the stored INR equivalents and is labelled so.
-- * A rate can be corrected only while an entry is pending (or on a charge),
--   with a reason, in an append-only history. Verified entries are protected.
-- * Numbered receipts are issued when a receipt is verified.
-- * A transaction reference can be used once per company for receipts/refunds.
-- * Existing INR entries get rate 1 and INR = amount (certain). No rates are
--   invented for any other currency.
-- =============================================================================

insert into permissions (key, category, description, is_sensitive) values
  ('currencies.manage', 'Finance', 'Manage payment currencies and reference exchange rates', true)
on conflict (key) do nothing;

create table currencies (
  code                 text primary key check (code ~ '^[A-Z]{3}$'),
  name                 text not null,
  symbol               text not null,
  is_active            boolean not null default true,
  sort_order           int not null default 100,
  reference_rate       numeric(18, 8) check (reference_rate is null or reference_rate > 0),   -- INR per 1 unit, suggestion only
  reference_rate_date  date,
  updated_by           uuid references user_profiles(id),
  updated_at           timestamptz not null default now()
);
insert into currencies (code, name, symbol, sort_order, reference_rate) values
  ('INR', 'Indian Rupee', '₹', 10, 1), ('USD', 'US Dollar', '$', 20, null), ('EUR', 'Euro', '€', 30, null);
create trigger currencies_audit after insert or update on currencies for each row execute function app.audit_row('', '');

alter table payment_entries
  add column exchange_rate numeric(18, 8) check (exchange_rate is null or exchange_rate > 0),
  add column inr_amount    numeric(16, 2),
  add column rate_source   text check (rate_source in ('fixed', 'manual'));

-- Existing INR entries: rate 1 (certain); other currencies are left without a rate (none exist today)
alter table payment_entries disable trigger payments_guard;
alter table payment_entries disable trigger payment_entries_audit;
update payment_entries set exchange_rate = 1, inr_amount = amount, rate_source = 'fixed' where currency = 'INR';
alter table payment_entries enable trigger payments_guard;
alter table payment_entries enable trigger payment_entries_audit;
alter table payment_entries add constraint payment_entries_currency_fk foreign key (currency) references currencies(code);

-- Duplicate protection: a transaction reference once per company for receipts and refunds
create unique index payment_entries_reference_once on payment_entries (org_id, entry_type, lower(btrim(reference_no)))
  where reference_no is not null and btrim(reference_no) <> '' and entry_type in ('receipt', 'refund') and verification_status <> 'rejected';

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
  -- currency and exchange rate (Nov 2026): the INR equivalent is always calculated here, never taken from the client
  if not exists (select 1 from currencies where code = new.currency and (is_active or new.entry_type = 'reversal')) then
    raise exception 'currency % is not available', new.currency using errcode = '23514';
  end if;
  if new.entry_type <> 'reversal' then
    if new.currency = 'INR' then
      new.exchange_rate := 1; new.rate_source := 'fixed';
    else
      if new.exchange_rate is null or new.exchange_rate <= 0 or new.exchange_rate > 100000 then
        raise exception 'enter the exchange rate applied to this payment (INR per 1 %)', new.currency using errcode = '23514';
      end if;
      new.rate_source := 'manual';
    end if;
    new.inr_amount := round(new.amount * new.exchange_rate, 2);
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
    new.exchange_rate := v_orig.exchange_rate;   -- a reversal undoes the original at the original's rate
    new.inr_amount := v_orig.inr_amount;
    new.rate_source := v_orig.rate_source;
  end if;
  return new;
end $$;

-- Rate corrections: only while pending (or on charges), with a reason; append-only history
create table payment_rate_changes (
  id                bigint generated always as identity primary key,
  payment_entry_id  uuid not null references payment_entries(id),
  old_rate          numeric(18, 8),
  new_rate          numeric(18, 8) not null,
  old_inr           numeric(16, 2),
  new_inr           numeric(16, 2) not null,
  reason            text not null check (length(btrim(reason)) between 3 and 500),
  changed_by        uuid not null references user_profiles(id),
  changed_at        timestamptz not null default now()
);
create trigger payment_rate_changes_immutable before update or delete on payment_rate_changes for each row execute function app.audit_immutable();

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
  if coalesce(current_setting('app.payment_rate', true), 'off') = 'on'
     and (to_jsonb(new) - 'exchange_rate' - 'inr_amount') = (to_jsonb(old) - 'exchange_rate' - 'inr_amount') then
    return new;
  end if;
  raise exception 'payment entries cannot be edited; record a reversal instead' using errcode = '42501';
end $$;

create or replace function app.correct_exchange_rate(p_entry uuid, p_rate numeric, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e payment_entries%rowtype; v_inr numeric(16, 2);
begin
  select * into v_e from payment_entries where id = p_entry for update;
  if not found or not app.has_perm(v_e.org_id, 'payments.read') then raise exception 'payment entry not found' using errcode = 'P0002'; end if;
  if not app.has_perm(v_e.org_id, 'payments.record') then raise exception 'permission denied: payments.record' using errcode = '42501'; end if;
  if v_e.currency = 'INR' then raise exception 'INR entries always use rate 1' using errcode = '23514'; end if;
  if v_e.entry_type = 'reversal' or not (v_e.verification_status = 'pending' or (v_e.entry_type = 'charge'
       and not exists (select 1 from payment_entries r where r.reverses_entry_id = v_e.id))) then
    raise exception 'the rate of a verified entry cannot be changed; record a reversal and a new entry' using errcode = '23514';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate > 100000 then raise exception 'enter a valid exchange rate' using errcode = '23514'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'give the reason for changing the rate' using errcode = '23514'; end if;
  v_inr := round(v_e.amount * p_rate, 2);
  perform set_config('app.payment_rate', 'on', true);
  update payment_entries set exchange_rate = p_rate, inr_amount = v_inr where id = p_entry;
  perform set_config('app.payment_rate', 'off', true);
  insert into payment_rate_changes (payment_entry_id, old_rate, new_rate, old_inr, new_inr, reason, changed_by)
  values (p_entry, v_e.exchange_rate, p_rate, v_e.inr_amount, v_inr, btrim(p_reason), app.current_user_id());
  perform app.add_event_internal(v_e.student_id, v_e.org_id, 'payment', 'rate_changed',
    'Exchange rate changed on ' || v_e.entry_type || ' of ' || v_e.currency || ' ' || to_char(v_e.amount, 'FM999,999,990.00') || ': '
    || coalesce(v_e.exchange_rate::text, 'none') || ' → ' || p_rate::text || ' (' || btrim(p_reason) || ')', 'payment_entries', p_entry::text);
end $$;

-- Receipts
create table payment_receipts (
  payment_entry_id  uuid primary key references payment_entries(id),
  org_id            uuid not null references organizations(id),
  receipt_no        text not null unique,
  issued_at         timestamptz not null default now(),
  issued_by         uuid references user_profiles(id)
);
create trigger payment_receipts_immutable before update or delete on payment_receipts for each row execute function app.audit_immutable();
create trigger payment_receipts_audit after insert on payment_receipts for each row execute function app.audit_row('org_id', '');

create or replace function app.issue_payment_receipt(p_entry uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e payment_entries%rowtype; v_prefix text; v_no text; v_n int;
begin
  select * into v_e from payment_entries where id = p_entry;
  if exists (select 1 from payment_receipts where payment_entry_id = p_entry) then
    return (select receipt_no from payment_receipts where payment_entry_id = p_entry);
  end if;
  select coalesce(student_code_prefix, code) into v_prefix from organizations where id = v_e.org_id;
  perform pg_advisory_xact_lock(hashtext('receipt:' || v_e.org_id::text));
  select count(*) + 1 into v_n from payment_receipts where org_id = v_e.org_id and receipt_no like v_prefix || '-RCP-' || to_char(current_date, 'YYYY') || '-%';
  v_no := v_prefix || '-RCP-' || to_char(current_date, 'YYYY') || '-' || lpad(v_n::text, 5, '0');
  insert into payment_receipts (payment_entry_id, org_id, receipt_no, issued_by) values (p_entry, v_e.org_id, v_no, app.current_user_id());
  return v_no;
end $$;

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
  -- numbered receipt for verified receipts (per company and year; never reused)
  if p_decision = 'verified' and v_e.entry_type = 'receipt' then
    perform app.issue_payment_receipt(p_entry);
  end if;
  perform app.add_event_internal(v_e.student_id, v_e.org_id, 'payment', 'verification',
                        initcap(v_e.entry_type) || ' of ' || v_e.currency || ' ' || to_char(v_e.amount, 'FM999,999,990.00') || ' ' || p_decision,
                        'payment_entries', p_entry::text);
end $$;

-- Balances: INR-equivalent effects appended (existing columns unchanged)
create or replace view payment_entry_effects with (security_invoker = true) as
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
       case when e.verification_status = 'pending' and e.entry_type = 'receipt' then e.amount else 0 end as pending_receipts,
       -- INR equivalents from the rate stored on each entry (null when no rate was recorded)
       case when e.verification_status in ('not_required', 'verified') then
         case coalesce(o.entry_type, e.entry_type) when 'charge' then 1 when 'waiver' then -1 else 0 end
         * case when e.entry_type = 'reversal' then -1 else 1 end * e.inr_amount
       else 0 end as due_inr,
       case when e.verification_status in ('not_required', 'verified') then
         case coalesce(o.entry_type, e.entry_type) when 'receipt' then 1 when 'refund' then -1 else 0 end
         * case when e.entry_type = 'reversal' then -1 else 1 end * e.inr_amount
       else 0 end as received_inr,
       e.inr_amount is null as inr_missing
  from payment_entries e
  left join payment_entries o on o.id = e.reverses_entry_id;

-- RLS and grants
alter table currencies enable row level security;
alter table payment_rate_changes enable row level security;
alter table payment_receipts enable row level security;
create policy currencies_select on currencies for select to erp_app using (app.current_user_id() is not null);
create policy currencies_write on currencies for update to erp_app
  using (exists (select 1 from app.orgs_with_perm('currencies.manage'))) with check (exists (select 1 from app.orgs_with_perm('currencies.manage')));
create policy currencies_insert on currencies for insert to erp_app with check (exists (select 1 from app.orgs_with_perm('currencies.manage')));
create policy rate_changes_select on payment_rate_changes for select to erp_app
  using (exists (select 1 from payment_entries e where e.id = payment_entry_id));
create policy receipts_select on payment_receipts for select to erp_app using (app.has_perm(org_id, 'payments.read'));
grant select, insert on currencies to erp_app;
grant update (name, symbol, is_active, sort_order, reference_rate, reference_rate_date, updated_by, updated_at) on currencies to erp_app;
grant select on payment_rate_changes, payment_receipts to erp_app;
grant insert (exchange_rate) on payment_entries to erp_app;
grant select (exchange_rate, inr_amount, rate_source) on payment_entries to erp_app;
grant execute on function app.correct_exchange_rate(uuid, numeric, text) to erp_app;
revoke all on function app.issue_payment_receipt(uuid) from public;
