import { can } from '../auth/context'
import type { Tx } from '../db'
import { forbidden, notFound } from '../errors'
import { audit, type Ctx, run } from './base'
import { type DashboardFilters, studentConditions } from './dashboard'

export interface ReportFilters extends DashboardFilters {
  status?: string
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
  columns: (ctx: Ctx, orgIds: string[]) => Column[]
  query: (tx: Tx, orgIds: string[], f: ReportFilters, ctx: Ctx) => Promise<Record<string, unknown>[]>
}

const LIMIT = 5000

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
    ],
    query: (tx, orgIds, f, ctx) => {
      const fin = orgIds.filter((o) => can(ctx, 'payments.read', o))
      return tx`
        select s.student_code, s.full_name as student_name, o.name as company, case b.ledger when 'service' then 'Service' else 'Third party' end as ledger,
               b.currency, b.amount_due, b.amount_received, b.outstanding, b.pending_receipts, s.id as student_id
          from student_balances b join v_students s on s.id = b.student_id join organizations o on o.id = b.org_id
         where b.org_id = any(${tx.array(fin)}::uuid[]) and ${studentConditions(tx, orgIds, f)}
           and (b.outstanding <> 0 or b.pending_receipts > 0)
         order by b.ledger, b.outstanding desc limit ${LIMIT}`
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
  return REPORTS.filter((r) => !r.finance || orgIds.some((o) => can(ctx, 'payments.read', o)))
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
