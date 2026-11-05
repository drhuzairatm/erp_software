import { can } from '../lib/auth/context'
import type { Tx } from '../lib/db'
import { forbidden, notFound } from '../lib/errors'
import { audit, type Ctx, run } from './base'
import { type DashboardFilters, studentConditions } from './dashboard'

export interface ReportFilters extends DashboardFilters {
  status?: string
  department?: string
}

interface Column { key: string; label: string; type?: 'text' | 'number' | 'money' | 'date' }

interface ReportDef {
  key: string
  title: string
  description: string
  /** contains personal contact data in exports */
  pii?: boolean
  /** contains financial data */
  finance?: boolean
  /** also needs one of these permissions, in any company in scope */
  requires?: string[]
  columns: (ctx: Ctx, orgIds: string[]) => Column[]
  query: (tx: Tx, orgIds: string[], f: ReportFilters, ctx: Ctx) => Promise<Record<string, unknown>[]>
}

const LIMIT = 5000

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Employee reports: the chosen dates, or this month so far. At most about a year, so a mistyped date cannot walk decades of days. */
function employeePeriod(f: ReportFilters) {
  const today = new Date().toISOString().slice(0, 10)
  const to = f.to && DATE_ONLY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : today
  const start = f.from && DATE_ONLY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : `${to.slice(0, 7)}-01`
  const earliest = new Date(Date.parse(to) - 366 * 86400000).toISOString().slice(0, 10)
  return { from: start < earliest ? earliest : start, to }
}

function departmentCondition(tx: Tx, f: ReportFilters) {
  return f.department && /^[0-9a-f-]{36}$/i.test(f.department) ? tx`and m.department_id = ${f.department}` : tx``
}

/** Departments for the employee report filters. */
export async function reportDepartments(ctx: Ctx, orgIds: string[]) {
  return run(ctx, (tx) => tx<{ id: string; name: string; company: string }[]>`
    select d.id, d.name, o.name as company from departments d join organizations o on o.id = d.org_id
     where d.is_active and d.org_id = any(${tx.array(orgIds)}::uuid[]) order by o.name, d.name`)
}

/** Finance reports filter by entry date, not registration date. Country and programme narrow through the student. */
function financeConditions(tx: Tx, orgIds: string[], f: ReportFilters) {
  const conds = [tx`true`]
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(tx`x.entry_date >= ${f.from}`)
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(tx`x.entry_date <= ${f.to}`)
  if (f.country || f.course) {
    conds.push(tx`exists (select 1 from v_students s where s.id = x.student_id and ${studentConditions(tx, orgIds, { country: f.country, course: f.course })})`)
  }
  return conds.reduce((a, c) => tx`${a} and ${c}`)
}

function financePeriodReport(key: string, title: string, unit: 'month' | 'year', format: 'YYYY-MM' | 'YYYY'): ReportDef {
  return {
    key, title, finance: true,
    description: 'Verified entries by entry date, per company, ledger and currency. Currencies are never added together. A reversal counts in the period of the reversal, so closed periods keep their entries. INR equivalents use the rate stored on each entry.',
    columns: () => [
      { key: 'period', label: unit === 'month' ? 'Month' : 'Year' }, { key: 'company', label: 'Company' }, { key: 'ledger', label: 'Ledger' }, { key: 'currency', label: 'Currency' },
      { key: 'charged', label: 'Charged less waivers', type: 'money' }, { key: 'received', label: 'Received less refunds', type: 'money' },
      { key: 'disbursed', label: 'Paid out', type: 'money' }, { key: 'pending', label: 'Awaiting verification', type: 'money' },
      { key: 'received_inr', label: 'Received, INR equivalent', type: 'number' }, { key: 'no_rate', label: 'Entries with no rate', type: 'number' },
    ],
    query: (tx, orgIds, f, ctx) => {
      const fin = orgIds.filter((o) => can(ctx, 'payments.read', o))
      return tx`
        select to_char(x.entry_date, ${format}::text) as period, o.name as company, case x.ledger when 'service' then 'Service' else 'Third party' end as ledger, x.currency,
               sum(x.due_effect)::numeric(14, 2) as charged, sum(x.received_effect)::numeric(14, 2) as received, sum(x.disbursed_effect)::numeric(14, 2) as disbursed,
               sum(x.pending_receipts)::numeric(14, 2) as pending, coalesce(sum(x.received_inr), 0)::numeric(16, 2) as received_inr, count(*) filter (where x.inr_missing and (x.due_effect <> 0 or x.received_effect <> 0 or x.disbursed_effect <> 0))::int as no_rate
          from payment_entry_effects x join organizations o on o.id = x.org_id
         where x.org_id = any(${tx.array(fin)}::uuid[]) and ${financeConditions(tx, orgIds, f)}
         group by 1, o.name, x.ledger, x.currency order by 1 desc, o.name, x.ledger, x.currency limit ${LIMIT}`
    },
  }
}

export const REPORTS: ReportDef[] = [
  {
    key: 'active-by-company',
    title: 'Students by company',
    description: 'Active, on-hold, completed and cancelled students per originating company.',
    columns: () => [
      { key: 'company', label: 'Company' }, { key: 'active', label: 'Active', type: 'number' }, { key: 'on_hold', label: 'On hold', type: 'number' },
      { key: 'completed', label: 'Travel completed', type: 'number' }, { key: 'cancelled', label: 'Cancelled', type: 'number' }, { key: 'total', label: 'Total', type: 'number' },
    ],
    query: (tx, orgIds, f) => tx`
      select o.name as company, count(*) filter (where s.status = 'active')::int as active, count(*) filter (where s.status = 'on_hold')::int as on_hold,
             count(*) filter (where s.status = 'completed')::int as completed, count(*) filter (where s.status = 'cancelled')::int as cancelled, count(*)::int as total
        from v_students s join organizations o on o.id = s.originating_org_id
       where ${studentConditions(tx, orgIds, f)} group by o.name order by o.name`,
  },
  {
    key: 'by-country-university',
    title: 'Students by country and university',
    description: 'Active and completed students grouped by destination country and preferred university.',
    columns: () => [
      { key: 'country', label: 'Country' }, { key: 'university', label: 'University' }, { key: 'course', label: 'Course' },
      { key: 'active', label: 'Active', type: 'number' }, { key: 'completed', label: 'Travel completed', type: 'number' },
    ],
    query: (tx, orgIds, f) => tx`
      select coalesce(c.name, '(not set)') as country, coalesce(u.name, '(not set)') as university, coalesce(co.name, '(not set)') as course,
             count(*) filter (where s.status in ('active', 'on_hold'))::int as active, count(*) filter (where s.status = 'completed')::int as completed
        from v_students s left join countries c on c.id = s.destination_country_id left join universities u on u.id = s.preferred_university_id
        left join courses co on co.id = s.course_id
       where ${studentConditions(tx, orgIds, f)} group by 1, 2, 3 order by 1, 2, 3`,
  },
  {
    key: 'by-stage',
    title: 'Students by current stage',
    description: 'How many students are in each admission stage, and how long they have been there on average.',
    columns: () => [
      { key: 'stage', label: 'Stage' }, { key: 'students', label: 'Students', type: 'number' },
      { key: 'avg_days_in_stage', label: 'Average days in stage', type: 'number' }, { key: 'over_30_days', label: 'In stage > 30 days', type: 'number' },
    ],
    query: (tx, orgIds, f) => tx`
      select st.name as stage, count(s.id)::int as students,
             round(avg(extract(epoch from now() - s.stage_changed_at) / 86400))::int as avg_days_in_stage,
             count(*) filter (where s.stage_changed_at < now() - interval '30 days')::int as over_30_days
        from v_students s join stages st on st.key = s.current_stage_key
       where ${studentConditions(tx, orgIds, f)} group by st.name, st.sort_order order by st.sort_order`,
  },
  {
    key: 'documents',
    title: 'Pending and rejected documents',
    description: 'Required documents that are missing, awaiting verification or manager approval, need changes, rejected or expired, for active students.',
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'student_name', label: 'Student' }, { key: 'company', label: 'Company' },
      { key: 'document', label: 'Document' }, { key: 'status', label: 'Status' }, { key: 'rejection_reason', label: 'Rejection reason' },
      { key: 'expiry_date', label: 'Expiry', type: 'date' }, { key: 'stage', label: 'Student stage' },
    ],
    query: (tx, orgIds, f) => {
      const st = f.status
      const statusCond = st === 'rejected' ? tx`d.status in ('rejected', 'changes_required')`
        : st === 'awaiting' ? tx`d.status in ('uploaded', 'under_review', 'verified')`
        : st === 'approval' ? tx`d.status = 'pending_approval'`
        : st === 'missing' ? tx`d.status = 'missing' and d.is_required`
        : st === 'expired' ? tx`(d.status = 'expired' or (d.status = 'approved' and d.expiry_date < current_date))`
        : tx`(d.status in ('rejected', 'changes_required', 'uploaded', 'under_review', 'verified', 'pending_approval', 'expired') or (d.status = 'missing' and d.is_required) or (d.status = 'approved' and d.expiry_date < current_date))`
      return tx`
        select s.student_code, s.full_name as student_name, o.name as company, t.name || case when d.label <> '' then ' – ' || d.label else '' end as document,
               case when d.status = 'approved' and d.expiry_date < current_date then 'expired' else d.status end as status,
               d.rejection_reason, d.expiry_date, stg.name as stage, s.id as student_id
          from student_documents d join v_students s on s.id = d.student_id join document_types t on t.id = d.document_type_id
          join organizations o on o.id = s.originating_org_id join stages stg on stg.key = s.current_stage_key
         where ${studentConditions(tx, orgIds, f)} and s.status in ('active', 'on_hold') and ${statusCond}
         order by d.status, s.student_code limit ${LIMIT}`
    },
  },
  {
    key: 'pending-acknowledgements',
    title: 'Notices awaiting acknowledgement',
    description: 'Active students with country-wise requirement notices that staff have not yet acknowledged (advisory; nothing is blocked).',
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'student_name', label: 'Student' }, { key: 'notice', label: 'Notice' },
      { key: 'priority', label: 'Priority' }, { key: 'academic', label: 'Academic status' }, { key: 'counsellor', label: 'Counsellor' }, { key: 'stage', label: 'Stage' },
    ],
    query: (tx, orgIds, f) => tx`
      select s.student_code, s.full_name as student_name, a.title as notice, initcap(a.priority) as priority,
             case a.academic_status when 'meets' then 'Meets requirements' when 'below' then 'Below requirements' when 'missing' then 'Information missing'
                                    when 'manual_review' then 'Manual review recommended' end as academic,
             (select u.full_name from student_assignments x join user_profiles u on u.id = x.user_id where x.student_id = s.id and x.is_active and x.assignment_type = 'counsellor' limit 1) as counsellor,
             st.name as stage, s.id as student_id
        from v_students s join stages st on st.key = s.current_stage_key cross join lateral app.student_advisories(s.id) a
       where s.status in ('active', 'on_hold') and a.requires_acknowledgement and a.acknowledged_at is null and ${studentConditions(tx, orgIds, f)}
       order by array_position(array['critical','high','normal','informational'], a.priority), s.full_name limit ${LIMIT}`,
  },
  {
    key: 'passport-expiry',
    title: 'Passport expiry',
    description: 'Active students whose passport expires within 12 months or has expired (most severe first). Passport numbers and dates show only for roles with passport permission.',
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'student_name', label: 'Student' }, { key: 'status_label', label: 'Passport status' },
      { key: 'passport_expiry', label: 'Expiry', type: 'date' }, { key: 'counsellor', label: 'Counsellor' }, { key: 'stage', label: 'Stage' },
      { key: 'last_followup', label: 'Last follow-up' },
    ],
    query: (tx, orgIds, f) => tx`
      select s.student_code, s.full_name as student_name,
             case s.passport_status when 'expired' then 'Expired' when 'critical' then 'Critical (≤3 months)' when 'urgent' then 'Urgent renewal (≤6 months)' else 'Expiry warning (≤12 months)' end as status_label,
             s.passport_expiry, (select u.full_name from student_assignments a join user_profiles u on u.id = a.user_id
                                  where a.student_id = s.id and a.is_active and a.assignment_type = 'counsellor' limit 1) as counsellor,
             st.name as stage,
             (select to_char(max(p.created_at), 'DD Mon YYYY') from passport_followups p where p.student_id = s.id) as last_followup,
             s.id as student_id
        from v_students s join stages st on st.key = s.current_stage_key
       where s.passport_status in ('warning', 'urgent', 'critical', 'expired') and s.status in ('active', 'on_hold') and ${studentConditions(tx, orgIds, f)}
       order by array_position(array['expired', 'critical', 'urgent', 'warning'], s.passport_status), s.full_name limit ${LIMIT}`,
  },
  {
    key: 'attestation',
    title: 'Attestation progress',
    description: 'Documents currently in attestation/apostille: current stage, authority, responsible staff and days since the stage started.',
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'student_name', label: 'Student' }, { key: 'document', label: 'Document' },
      { key: 'route', label: 'Route' }, { key: 'stage', label: 'Current stage' }, { key: 'authority', label: 'Authority' },
      { key: 'responsible', label: 'Responsible' }, { key: 'reference_no', label: 'Reference' }, { key: 'days', label: 'Days in stage', type: 'number' },
      { key: 'progress', label: 'Progress' },
    ],
    query: (tx, orgIds, f) => tx`
      select s.student_code, s.full_name as student_name, t.name as document, a.route_name as route, st.name as stage, st.authority_name as authority,
             u.full_name as responsible, st.reference_no,
             (current_date - coalesce(st.started_at, prev.done_at, a.started_at)::date) as days,
             (select count(*) filter (where x.status in ('completed', 'not_required', 'exception')) || '/' || count(*) from document_attestation_steps x where x.attestation_id = a.id) as progress,
             s.id as student_id
        from document_attestations a
        join student_documents d on d.id = a.student_document_id join document_types t on t.id = d.document_type_id
        join v_students s on s.id = d.student_id
        cross join lateral (select * from document_attestation_steps x where x.attestation_id = a.id and x.status in ('pending', 'in_progress') order by x.sort_order limit 1) st
        left join lateral (select max(completed_at) as done_at from document_attestation_steps y where y.attestation_id = a.id and y.sort_order < st.sort_order) prev on true
        left join user_profiles u on u.id = st.assigned_to
       where a.status = 'in_progress' and ${studentConditions(tx, orgIds, f)}
       order by days desc limit ${LIMIT}`,
  },
  {
    key: 'courier',
    title: 'Original documents by courier',
    description: 'Courier instructions issued after scan approval, dispatch and tracking, receipt and reconciliation. Open shipments first.',
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'student_name', label: 'Student' }, { key: 'documents', label: 'Documents' },
      { key: 'status_label', label: 'Status' }, { key: 'courier', label: 'Courier / tracking' }, { key: 'issued', label: 'Instructions issued', type: 'date' },
      { key: 'days_open', label: 'Days open', type: 'number' }, { key: 'exception', label: 'Exception' },
    ],
    query: (tx, orgIds) => tx`
      select s.student_code, s.full_name as student_name,
             (select string_agg(t.name, ', ') from original_shipment_items i join student_documents d on d.id = i.student_document_id
                join document_types t on t.id = d.document_type_id where i.shipment_id = sh.id) as documents,
             initcap(replace(sh.status, '_', ' ')) as status_label, concat_ws(' · ', sh.courier_company, sh.tracking_number) as courier,
             sh.issued_at::date as issued, case when sh.status in ('completed', 'cancelled') then null else (current_date - sh.issued_at::date) end as days_open,
             coalesce(sh.exception_reason, '') as exception, s.id as student_id
        from original_shipments sh join students s on s.id = sh.student_id and app.can_read_student(s.id)
       where sh.org_id = any(${tx.array(orgIds)}::uuid[])
       order by (sh.status in ('completed', 'cancelled')), sh.issued_at limit ${LIMIT}`,
  },
  {
    key: 'leads',
    title: 'Leads and referrals',
    description: 'Leads by company, source and status, with follow-up dates and conversions. Only leads you are permitted to see.',
    pii: true,
    columns: () => [
      { key: 'name', label: 'Lead' }, { key: 'company', label: 'Company' }, { key: 'source', label: 'Source' }, { key: 'programme', label: 'Programme' },
      { key: 'status', label: 'Status' }, { key: 'assigned_to', label: 'Assigned to' }, { key: 'next_followup_on', label: 'Next follow-up', type: 'date' },
      { key: 'referred_by', label: 'Referred by' }, { key: 'student_code', label: 'Registered as' }, { key: 'created', label: 'Created', type: 'date' },
    ],
    query: (tx, orgIds) => tx`
      select l.full_name as name, coalesce(o.name, 'Central review queue') as company, l.source, replace(coalesce(l.programme, ''), '_', ' ') as programme,
             l.status, u.full_name as assigned_to, l.next_followup_on, rs.student_code as referred_by, s.student_code, l.created_at::date as created
        from leads l left join organizations o on o.id = l.org_id left join user_profiles u on u.id = l.assigned_to
        left join referrals r on r.id = l.referral_id left join students rs on rs.id = r.referrer_student_id and app.can_read_student(rs.id)
        left join students s on s.id = l.converted_student_id and app.can_read_student(s.id)
       where (l.org_id = any(${tx.array(orgIds)}::uuid[]) or l.org_id is null)
       order by l.created_at desc limit ${LIMIT}`,
  },
  {
    key: 'overdue-tasks',
    title: 'Overdue tasks by staff member',
    description: 'Open tasks past their due date. Tasks waiting on an external party are shown separately from internal delays.',
    columns: () => [
      { key: 'staff', label: 'Assigned to' }, { key: 'task', label: 'Task' }, { key: 'student_code', label: 'Student ID' },
      { key: 'due_date', label: 'Due', type: 'date' }, { key: 'days_overdue', label: 'Days overdue', type: 'number' },
      { key: 'delay_type', label: 'Delay type' }, { key: 'waiting_on', label: 'Waiting on' }, { key: 'company', label: 'Company' },
    ],
    query: (tx, orgIds, f) => tx`
      select coalesce(u.full_name, '(unassigned)') as staff, t.title as task, s.student_code, t.due_date, (current_date - t.due_date) as days_overdue,
             case when t.status = 'waiting_external' then 'External' else 'Internal' end as delay_type,
             replace(coalesce(t.delay_reason, ''), '_', ' ') as waiting_on, o.name as company, t.id as task_id
        from tasks t join organizations o on o.id = t.org_id left join user_profiles u on u.id = t.assigned_to
        left join students s on s.id = t.student_id and app.can_read_student(s.id)
       where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.status not in ('completed', 'cancelled') and t.due_date < current_date
         ${f.staff && /^[0-9a-f-]{36}$/i.test(f.staff) ? tx`and t.assigned_to = ${f.staff}` : tx``}
       order by staff, t.due_date limit ${LIMIT}`,
  },
  {
    key: 'awaiting-external',
    title: 'Students awaiting external parties',
    description: 'Open tasks marked as waiting on the student, a university, embassy, provider or other party.',
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'student_name', label: 'Student' }, { key: 'waiting_on', label: 'Waiting on' },
      { key: 'task', label: 'Task' }, { key: 'assigned_to', label: 'Followed up by' }, { key: 'due_date', label: 'Due', type: 'date' },
      { key: 'waiting_days', label: 'Days since update', type: 'number' },
    ],
    query: (tx, orgIds) => tx`
      select s.student_code, s.full_name as student_name, replace(t.delay_reason, '_', ' ') as waiting_on, t.title as task,
             u.full_name as assigned_to, t.due_date, (current_date - t.updated_at::date) as waiting_days, s.id as student_id
        from tasks t left join students s on s.id = t.student_id and app.can_read_student(s.id) left join user_profiles u on u.id = t.assigned_to
       where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.status = 'waiting_external'
       order by t.delay_reason, t.due_date nulls last limit ${LIMIT}`,
  },
  {
    key: 'balances',
    title: 'Outstanding student balances',
    description: 'Service-fee balances (verified receipts only). Third-party money such as university fees is shown separately.',
    finance: true,
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'student_name', label: 'Student' }, { key: 'company', label: 'Company' },
      { key: 'ledger', label: 'Ledger' }, { key: 'currency', label: 'Currency' }, { key: 'amount_due', label: 'Due', type: 'money' },
      { key: 'amount_received', label: 'Received (verified)', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' },
      { key: 'pending_receipts', label: 'Awaiting verification', type: 'money' },
      { key: 'next_due', label: 'Earliest unpaid due date', type: 'date' }, { key: 'overdue', label: 'Overdue', type: 'money' },
    ],
    query: (tx, orgIds, f, ctx) => {
      const fin = orgIds.filter((o) => can(ctx, 'payments.read', o))
      return tx`
        select s.student_code, s.full_name as student_name, o.name as company, case b.ledger when 'service' then 'Service' else 'Third party' end as ledger,
               b.currency, b.amount_due, b.amount_received, b.outstanding, b.pending_receipts, s.id as student_id,
               d.next_due, coalesce(d.overdue, 0) as overdue
          from student_balances b join v_students s on s.id = b.student_id join organizations o on o.id = b.org_id
          left join lateral (
            select min(u.due_date) as next_due, sum(u.unpaid) filter (where u.due_date < current_date) as overdue
              from payment_due_status u
             where u.student_id = b.student_id and u.org_id = b.org_id and u.ledger = b.ledger and u.currency = b.currency and u.unpaid > 0) d on true
         where b.org_id = any(${tx.array(fin)}::uuid[]) and ${studentConditions(tx, orgIds, f)}
           and (b.outstanding <> 0 or b.pending_receipts > 0)
           ${f.status === 'overdue' ? tx`and d.overdue > 0` : tx``}
         order by b.ledger, b.outstanding desc limit ${LIMIT}`
    },
  },
  {
    key: 'by-intake',
    title: 'Students by intake',
    description: 'Intake-wise counts per university. Students with no recorded intake are shown on their own row.',
    columns: () => [
      { key: 'university', label: 'University' }, { key: 'intake', label: 'Intake' }, { key: 'active', label: 'Active', type: 'number' },
      { key: 'completed', label: 'Travel completed', type: 'number' }, { key: 'total', label: 'Total', type: 'number' },
    ],
    query: (tx, orgIds, f) => tx`
      select coalesce(u.name, '—') as university, coalesce(i.name, 'No intake recorded') as intake,
             count(*) filter (where s.status = 'active')::int as active, count(*) filter (where s.status = 'completed')::int as completed, count(*)::int as total
        from v_students s left join university_intakes i on i.id = s.intake_id left join universities u on u.id = i.university_id
       where ${studentConditions(tx, orgIds, f)} group by 1, 2 order by 1, 2 limit ${LIMIT}`,
  },
  {
    key: 'attendance-summary',
    title: 'Attendance summary',
    description: 'Per employee, for the chosen dates (this month if none are chosen). No record means a working day without an entry: it is not a recorded absence and may include staff not required to mark attendance. Company holidays are not known to the system. Working hours are unconfirmed.',
    requires: ['attendance.view'],
    columns: () => [
      { key: 'staff', label: 'Employee' }, { key: 'company', label: 'Company' }, { key: 'department', label: 'Department' },
      { key: 'working_days', label: 'Working days', type: 'number' }, { key: 'present', label: 'Present', type: 'number' }, { key: 'late', label: 'Of which late', type: 'number' },
      { key: 'half_day', label: 'Of which half day', type: 'number' }, { key: 'on_leave', label: 'Leave', type: 'number' }, { key: 'absent', label: 'Recorded absent', type: 'number' },
      { key: 'no_record', label: 'No record', type: 'number' }, { key: 'to_review', label: 'Awaiting review', type: 'number' },
    ],
    query: (tx, orgIds, f, ctx) => {
      const orgs = orgIds.filter((o) => can(ctx, 'attendance.view', o))
      const { from, to } = employeePeriod(f)
      return tx`
        with days as (
          select o.id as org_id, g::date as d
            from organizations o left join attendance_policies p on p.org_id = o.id
           cross join lateral generate_series(${from}::date, least(${to}::date, (now() at time zone coalesce(p.timezone, 'Asia/Kolkata'))::date), interval '1 day') g
           where o.id = any(${tx.array(orgs)}::uuid[]) and extract(dow from g)::int <> all(coalesce(p.weekly_off, '{0}'::int[])))
        select u.full_name as staff, o.name as company, coalesce(d.name, '—') as department,
               (select count(*)::int from days g where g.org_id = m.org_id and g.d >= m.created_at::date) as working_days,
               count(r.id) filter (where r.status in ('present', 'late', 'half_day', 'field_duty', 'official_visit'))::int as present,
               count(r.id) filter (where r.status = 'late')::int as late, count(r.id) filter (where r.status = 'half_day')::int as half_day,
               count(r.id) filter (where r.status = 'leave')::int as on_leave, count(r.id) filter (where r.status = 'absent')::int as absent,
               (select count(*)::int from days g where g.org_id = m.org_id and g.d >= m.created_at::date
                  and not exists (select 1 from attendance_records x where x.org_id = m.org_id and x.user_id = m.user_id and x.work_date = g.d)) as no_record,
               count(r.id) filter (where r.review_status = 'pending')::int as to_review
          from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active join organizations o on o.id = m.org_id
          left join departments d on d.id = m.department_id
          left join attendance_records r on r.org_id = m.org_id and r.user_id = m.user_id and r.work_date between ${from}::date and ${to}::date
         where m.is_active and m.org_id = any(${tx.array(orgs)}::uuid[]) ${departmentCondition(tx, f)}
         group by u.full_name, o.name, d.name, m.org_id, m.user_id, m.created_at order by o.name, u.full_name limit ${LIMIT}`
    },
  },
  {
    key: 'employee-tasks',
    title: 'Employee tasks and workload',
    description: 'Open and overdue tasks now, and tasks completed in the chosen dates (this month if none are chosen). Completion is completed ÷ (completed + open). Activity indicators only: read with task complexity and external delays.',
    requires: ['staff.workload.view'],
    columns: () => [
      { key: 'staff', label: 'Employee' }, { key: 'company', label: 'Company' }, { key: 'department', label: 'Department' },
      { key: 'open', label: 'Pending', type: 'number' }, { key: 'overdue', label: 'Overdue', type: 'number' },
      { key: 'completed', label: 'Completed in period', type: 'number' }, { key: 'completion_pct', label: 'Completion %', type: 'number' },
    ],
    query: (tx, orgIds, f, ctx) => {
      const orgs = orgIds.filter((o) => can(ctx, 'staff.workload.view', o))
      const { from, to } = employeePeriod(f)
      return tx`
        select u.full_name as staff, o.name as company, coalesce(d.name, '—') as department, x.open, x.overdue, x.completed,
               case when x.completed + x.open > 0 then round(x.completed * 100.0 / (x.completed + x.open))::int else null end as completion_pct
          from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active join organizations o on o.id = m.org_id
          left join departments d on d.id = m.department_id
         cross join lateral (
           select count(*) filter (where t.status not in ('completed', 'cancelled'))::int as open,
                  count(*) filter (where t.status not in ('completed', 'cancelled') and t.due_date < current_date)::int as overdue,
                  count(*) filter (where t.completed_at::date between ${from}::date and ${to}::date)::int as completed
             from tasks t where t.assigned_to = m.user_id and t.org_id = m.org_id) x
         where m.is_active and m.org_id = any(${tx.array(orgs)}::uuid[]) ${departmentCondition(tx, f)}
         order by x.overdue desc, x.open desc, u.full_name limit ${LIMIT}`
    },
  },
  financePeriodReport('finance-monthly', 'Monthly financial summary', 'month', 'YYYY-MM'),
  financePeriodReport('finance-yearly', 'Yearly financial summary', 'year', 'YYYY'),
  {
    key: 'finance-revenue',
    title: 'Revenue by fee category',
    description: 'Service fees only: verified receipts less verified refunds, by entry date. Third-party money such as university fees is not revenue and is excluded. Each currency stays separate.',
    finance: true,
    columns: () => [
      { key: 'company', label: 'Company' }, { key: 'category', label: 'Fee category' }, { key: 'currency', label: 'Currency' },
      { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'entries', label: 'Entries', type: 'number' },
      { key: 'inr_equivalent', label: 'INR equivalent', type: 'number' }, { key: 'no_rate', label: 'Entries with no rate', type: 'number' },
    ],
    query: (tx, orgIds, f, ctx) => {
      const fin = orgIds.filter((o) => can(ctx, 'payments.read', o))
      return tx`
        select o.name as company, fc.name as category, x.currency, sum(x.received_effect)::numeric(14, 2) as revenue, count(*)::int as entries,
               coalesce(sum(x.received_inr), 0)::numeric(16, 2) as inr_equivalent, count(*) filter (where x.inr_missing)::int as no_rate
          from payment_entry_effects x join payment_entries e on e.id = x.id join fee_categories fc on fc.id = e.fee_category_id join organizations o on o.id = x.org_id
         where x.org_id = any(${tx.array(fin)}::uuid[]) and x.ledger = 'service' and x.received_effect <> 0 and ${financeConditions(tx, orgIds, f)}
         group by o.name, fc.name, x.currency order by o.name, x.currency, revenue desc limit ${LIMIT}`
    },
  },
  {
    key: 'student-list',
    title: 'Student contact list',
    description: 'Students matching the filters, including contact details where you are permitted to see them.',
    pii: true,
    columns: () => [
      { key: 'student_code', label: 'Student ID' }, { key: 'full_name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' },
      { key: 'company', label: 'Company' }, { key: 'country', label: 'Country' }, { key: 'course', label: 'Course' }, { key: 'stage', label: 'Stage' },
      { key: 'counsellor', label: 'Counsellor' }, { key: 'next_action', label: 'Next action' }, { key: 'next_action_due', label: 'Due', type: 'date' },
    ],
    query: (tx, orgIds, f) => tx`
      select s.student_code, s.full_name, coalesce(s.phone, s.phone_masked) as phone, coalesce(s.email, s.email_masked) as email, o.name as company,
             c.name as country, co.name as course, st.name as stage,
             (select u.full_name from student_assignments a join user_profiles u on u.id = a.user_id
               where a.student_id = s.id and a.is_active and a.assignment_type = 'counsellor' limit 1) as counsellor,
             s.next_action, s.next_action_due, s.id as student_id
        from v_students s join organizations o on o.id = s.originating_org_id join stages st on st.key = s.current_stage_key
        left join countries c on c.id = s.destination_country_id left join courses co on co.id = s.course_id
       where ${studentConditions(tx, orgIds, f)} order by s.student_code limit ${LIMIT}`,
  },
]

export function reportsFor(ctx: Ctx, orgIds: string[]) {
  const view = orgIds.some((o) => can(ctx, 'reports.view', o))
  if (!view) return []
  return REPORTS.filter((r) => (!r.finance || orgIds.some((o) => can(ctx, 'payments.read', o))) && (!r.requires || r.requires.some((p) => orgIds.some((o) => can(ctx, p, o)))))
}

export function exportAllowed(ctx: Ctx, orgIds: string[], r: ReportDef) {
  const any = (p: string) => orgIds.some((o) => can(ctx, p, o))
  return any('reports.export') && (!r.pii || any('reports.export.pii')) && (!r.finance || any('reports.export.finance'))
}

export async function runReport(ctx: Ctx, key: string, orgIds: string[], f: ReportFilters) {
  const r = reportsFor(ctx, orgIds).find((x) => x.key === key)
  if (!r) throw notFound('Report not found or not available to you.')
  const rows = await run(ctx, (tx) => r.query(tx, orgIds, f, ctx))
  return { report: r, columns: r.columns(ctx, orgIds), rows, canExport: exportAllowed(ctx, orgIds, r) }
}

/** Build a CSV export. Permission is checked and the export is audited. */
export async function exportReport(ctx: Ctx, key: string, orgIds: string[], f: ReportFilters) {
  const r = REPORTS.find((x) => x.key === key)
  if (!r || !reportsFor(ctx, orgIds).includes(r)) throw notFound('Report not found.')
  if (!exportAllowed(ctx, orgIds, r)) {
    await run(ctx, (tx) => audit(tx, 'export', 'report', key, { outcome: 'denied', metadata: { filters: f, orgIds } }))
    throw forbidden('You are not allowed to export this report.')
  }
  return run(ctx, async (tx) => {
    const rows = await r.query(tx, orgIds, f, ctx)
    const columns = r.columns(ctx, orgIds)
    for (const orgId of orgIds) {
      await audit(tx, 'export', 'report', key, { orgId, metadata: { rows: rows.length, filters: f, pii: !!r.pii, finance: !!r.finance } })
    }
    return { filename: `${key}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(columns, rows) }
  })
}

/** CSV with protection against spreadsheet formula injection. */
export function toCsv(columns: Column[], rows: Record<string, unknown>[]) {
  const cell = (v: unknown) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map((c) => cell(c.label)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}
