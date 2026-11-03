-- =============================================================================
-- 0006 Basic payment ledger (NOT an accounting system)
--
-- * Entries are append-only: no edits, no deletes. Corrections are recorded as
--   reversal entries that reference the original.
-- * Receipts, refunds, waivers, disbursements and reversals start as
--   'pending' and only count towards balances after an authorized verification.
--   Charges (amounts due) are 'not_required'.
-- * `ledger` separates the company's own service revenue ('service') from
--   third-party money such as university fees ('third_party').
-- * No tax, invoice numbering or statutory accounting is implemented.
-- =============================================================================

create table payment_entries (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id),
  student_id           uuid not null references students(id),
  entry_type           text not null check (entry_type in ('charge', 'receipt', 'refund', 'waiver', 'disbursement', 'reversal')),
  fee_category_id      uuid not null,
  ledger               text not null check (ledger in ('service', 'third_party')),
  amount               numeric(12, 2) not null check (amount > 0 and amount < 100000000),
  currency             text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  entry_date           date not null default current_date,
  method               text check (method in ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other')),
  reference_no         text check (reference_no is null or length(reference_no) <= 100),
  receipt_ref          text check (receipt_ref is null or length(receipt_ref) <= 100),
  recipient_entity_id  uuid references legal_entities(id),
  payee                text check (payee is null or length(payee) <= 200),
  reverses_entry_id    uuid references payment_entries(id),
  notes                text check (notes is null or length(notes) <= 2000),
  verification_status  text not null check (verification_status in ('not_required', 'pending', 'verified', 'rejected')),
  verified_by          uuid references user_profiles(id),
  verified_at          timestamptz,
  recorded_by          uuid not null references user_profiles(id),
  recorded_at          timestamptz not null default now(),
  foreign key (fee_category_id, org_id) references fee_categories(id, org_id),
  check ((entry_type = 'reversal') = (reverses_entry_id is not null)),
  check (entry_type <> 'disbursement' or ledger = 'third_party'),
  check (entry_type not in ('receipt', 'refund') or method is not null)
);
create unique index payment_entries_one_reversal on payment_entries (reverses_entry_id) where reverses_entry_id is not null
  and verification_status <> 'rejected';
create index payment_entries_student_idx on payment_entries (student_id, entry_date);
create index payment_entries_org_idx on payment_entries (org_id, verification_status);

create table payment_verifications (
  id                uuid primary key default gen_random_uuid(),
  payment_entry_id  uuid not null references payment_entries(id),
  decision          text not null check (decision in ('verified', 'rejected')),
  note              text,
  verified_by       uuid not null references user_profiles(id),
  verified_at       timestamptz not null default now()
);

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
create trigger payments_before_insert before insert on payment_entries
  for each row execute function app.payments_before_insert();

-- Immutability: only verification fields may change (through verify_payment),
-- and student_id only during a controlled merge.
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
create trigger payments_guard before update or delete on payment_entries
  for each row execute function app.payments_guard();
create trigger payments_no_truncate before truncate on payment_entries
  for each statement execute function app.audit_immutable();

create trigger payment_entries_audit after insert or update on payment_entries
  for each row execute function app.audit_row('org_id', 'student_id');

create or replace function app.payments_after_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cat text;
begin
  select name into v_cat from fee_categories where id = new.fee_category_id;
  perform app.add_event_internal(new.student_id, new.org_id, 'payment', new.entry_type,
                        initcap(new.entry_type) || ' recorded: ' || v_cat || ' ' || new.currency || ' ' || to_char(new.amount, 'FM999,999,990.00')
                        || case when new.verification_status = 'pending' then ' (awaiting verification)' else '' end,
                        'payment_entries', new.id::text);
  return null;
end $$;
create trigger payments_after_insert after insert on payment_entries
  for each row execute function app.payments_after_insert();

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

-- Signed effect of each entry on balances.
--   due_effect      : what the student owes (charges minus waivers)
--   received_effect : money received from the student (receipts minus refunds)
--   disbursed_effect: third-party money paid out (e.g. to a university)
-- Only entries that are 'not_required' or 'verified' count. A verified
-- reversal cancels its original's effect.
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

-- Boolean-only helper for stage-change warnings: does the student have an
-- outstanding SERVICE balance? (Reveals no amounts; usable by non-finance staff.)
create or replace function app.student_has_outstanding_service_balance(p_student uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.can_read_student(p_student) and coalesce((
    select sum(due_effect) - sum(received_effect) > 0
      from payment_entry_effects where student_id = p_student and ledger = 'service'), false)
$$;
