import { can } from '../lib/auth/context'
import type { Tx } from '../lib/db'
import { type Ctx, run } from './base'

export interface DashboardFilters {
  from?: string
  to?: string
  country?: string
  course?: string
  stage?: string
  staff?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f-]{36}$/i

/** Shared student filter: scope companies + dashboard filters. All queries also pass RLS. */
export function studentConditions(tx: Tx, orgIds: string[], f: DashboardFilters, alias = 's') {
  const a = tx.unsafe(alias)
  const conds = [
    tx`exists (select 1 from student_org_access soa where soa.student_id = ${a}.id and soa.org_id = any(${tx.array(orgIds)}::uuid[]))`,
    tx`${a}.archived_at is null`,
    tx`${a}.status <> 'merged'`,
  ]
  if (f.from && DATE_RE.test(f.from)) conds.push(tx`coalesce(${a}.registration_date, ${a}.created_at::date) >= ${f.from}`)
  if (f.to && DATE_RE.test(f.to)) conds.push(tx`coalesce(${a}.registration_date, ${a}.created_at::date) <= ${f.to}`)
  if (f.country && UUID_RE.test(f.country)) conds.push(tx`${a}.destination_country_id = ${f.country}`)
  if (f.course && UUID_RE.test(f.course)) conds.push(tx`${a}.course_id = ${f.course}`)
  if (f.stage && /^[a-z_]+$/.test(f.stage)) conds.push(tx`${a}.current_stage_key = ${f.stage}`)
  if (f.staff && UUID_RE.test(f.staff)) {
    conds.push(tx`exists (select 1 from student_assignments sa where sa.student_id = ${a}.id and sa.is_active and sa.user_id = ${f.staff})`)
  }
  return conds.reduce((x, c) => tx`${x} and ${c}`)
}

export async function getDashboard(ctx: Ctx, orgIds: string[], f: DashboardFilters) {
  const canFinance = orgIds.some((o) => can(ctx, 'payments.read', o))
  const financeOrgs = orgIds.filter((o) => can(ctx, 'payments.read', o))
  const canWorkload = orgIds.some((o) => can(ctx, 'staff.workload.view', o))
  return run(ctx, async (tx) => {
    const sw = studentConditions(tx, orgIds, f)
    const taskStudent = f.country || f.course || f.stage || f.from || f.to
      ? tx`and (t.student_id is null or exists (select 1 from v_students s where s.id = t.student_id and ${sw}))`
      : tx``
    const taskStaff = f.staff && UUID_RE.test(f.staff) ? tx`and t.assigned_to = ${f.staff}` : tx``

    const [cards] = await tx<{
      active: number; on_hold: number; completed: number; new_30: number; next_overdue: number
    }[]>`
      select count(*) filter (where s.status = 'active')::int as active,
             count(*) filter (where s.status = 'on_hold')::int as on_hold,
             count(*) filter (where s.status = 'completed')::int as completed,
             count(*) filter (where s.created_at > now() - interval '30 days')::int as new_30,
             count(*) filter (where s.status = 'active' and s.next_action_due < current_date)::int as next_overdue
        from v_students s where ${sw}`

    const byStage = await tx<{ key: string; name: string; count: number }[]>`
      select st.key, st.name, count(s.id)::int as count
        from stages st left join v_students s on s.current_stage_key = st.key and ${sw}
       group by st.key, st.name, st.sort_order order by st.sort_order`

    const [att] = await tx<{ ready: number; processing: number }[]>`
      select count(*) filter (where x.state = 'ready')::int as ready, count(*) filter (where x.state = 'processing')::int as processing
        from student_documents d join v_students s on s.id = d.student_id cross join lateral app.attestation_state(d.id) x
       where ${sw} and d.status = 'approved' and s.status in ('active', 'on_hold')`
    const [passport] = await tx<{ warning: number; urgent: number; critical: number; expired: number }[]>`
      select count(*) filter (where s.passport_status = 'warning')::int as warning, count(*) filter (where s.passport_status = 'urgent')::int as urgent,
             count(*) filter (where s.passport_status = 'critical')::int as critical, count(*) filter (where s.passport_status = 'expired')::int as expired
        from v_students s where ${sw} and s.status in ('active', 'on_hold')`
    const [docs] = await tx<{ missing: number; awaiting_review: number; pending_approval: number; rejected: number; expired: number }[]>`
      select count(*) filter (where d.status = 'missing' and d.is_required)::int as missing,
             count(*) filter (where d.status in ('uploaded', 'under_review', 'verified'))::int as awaiting_review,
             count(*) filter (where d.status = 'pending_approval')::int as pending_approval,
             count(*) filter (where d.status in ('rejected', 'changes_required'))::int as rejected,
             count(*) filter (where d.status = 'expired' or (d.status = 'approved' and d.expiry_date < current_date))::int as expired
        from student_documents d join v_students s on s.id = d.student_id
       where ${sw} and s.status in ('active', 'on_hold')`

    const [tasks] = await tx<{ overdue_internal: number; overdue_external: number; due_today: number; waiting_external: number; unassigned: number; students_waiting: number }[]>`
      select count(*) filter (where t.due_date < current_date and t.status in ('not_started', 'in_progress'))::int as overdue_internal,
             count(*) filter (where t.due_date < current_date and t.status = 'waiting_external')::int as overdue_external,
             count(*) filter (where t.due_date = current_date)::int as due_today,
             count(*) filter (where t.status = 'waiting_external')::int as waiting_external,
             count(*) filter (where t.assigned_to is null)::int as unassigned,
             count(distinct t.student_id) filter (where t.status = 'waiting_external')::int as students_waiting
        from tasks t
       where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.status not in ('completed', 'cancelled') ${taskStudent} ${taskStaff}`

    const waitingByParty = await tx<{ delay_reason: string; count: number }[]>`
      select t.delay_reason, count(*)::int as count from tasks t
       where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.status = 'waiting_external' ${taskStudent} ${taskStaff}
       group by t.delay_reason order by count desc`

    let finance: { outstanding: string; students_with_balance: number; pending_count: number; pending_amount: string; currency: string }[] = []
    if (canFinance) {
      finance = await tx`
        select b.currency, coalesce(sum(b.outstanding) filter (where b.outstanding > 0), 0)::text as outstanding,
               count(distinct b.student_id) filter (where b.outstanding > 0)::int as students_with_balance,
               (select count(*)::int from payment_entries e where e.verification_status = 'pending' and e.org_id = any(${tx.array(financeOrgs)}::uuid[])) as pending_count,
               (select coalesce(sum(amount), 0)::text from payment_entries e where e.verification_status = 'pending' and e.entry_type = 'receipt'
                  and e.org_id = any(${tx.array(financeOrgs)}::uuid[])) as pending_amount
          from student_balances b join v_students s on s.id = b.student_id
         where b.ledger = 'service' and b.org_id = any(${tx.array(financeOrgs)}::uuid[]) and ${sw}
         group by b.currency`
    }

    // Count-only payment status (CEO and others with payments.status): no amounts are ever returned.
    const statusOrgs = orgIds.filter((o) => can(ctx, 'payments.status', o) || can(ctx, 'payments.read', o))
    const paymentCounts = statusOrgs.length
      ? await tx<{ org_id: string; students_with_balance: number; entries_awaiting_verification: number; students_awaiting_payment: number }[]>`
          select * from app.payment_status_counts(${tx.array(statusOrgs)}::uuid[])`
      : []
    const workload = await workloadQuery(tx, orgIds, canWorkload ? (f.staff && UUID_RE.test(f.staff) ? f.staff : null) : ctx.userId, f)
    return { cards, byStage, docs, attestation: att, passport, tasks, waitingByParty, finance, canFinance, paymentCounts, workload, canWorkload }
  })
}

export interface WorkloadRow {
  user_id: string; full_name: string; open: number; overdue_internal: number; waiting_external: number; due_this_week: number
  completed_period: number; completed_on_time: number; avg_completion_days: string | null; high_priority_open: number
}

/**
 * Objective workload indicators. Overdue items that are waiting on an external
 * party are reported separately and are NOT counted as internal delays.
 */
export async function workloadQuery(tx: Tx, orgIds: string[], onlyUser: string | null, f: DashboardFilters) {
  const from = f.from && DATE_RE.test(f.from) ? f.from : null
  const to = f.to && DATE_RE.test(f.to) ? f.to : null
  return tx<WorkloadRow[]>`
    select u.id as user_id, u.full_name,
           count(*) filter (where t.status not in ('completed', 'cancelled'))::int as open,
           count(*) filter (where t.status in ('not_started', 'in_progress') and t.due_date < current_date)::int as overdue_internal,
           count(*) filter (where t.status = 'waiting_external')::int as waiting_external,
           count(*) filter (where t.status not in ('completed', 'cancelled') and t.due_date between current_date and current_date + 7)::int as due_this_week,
           count(*) filter (where t.status = 'completed' and t.completed_at >= coalesce(${from}::date, current_date - 30)
                              and t.completed_at < coalesce(${to}::date, current_date) + 1)::int as completed_period,
           count(*) filter (where t.status = 'completed' and t.completed_at >= coalesce(${from}::date, current_date - 30)
                              and t.completed_at < coalesce(${to}::date, current_date) + 1
                              and (t.due_date is null or t.completed_at::date <= t.due_date))::int as completed_on_time,
           round(avg(extract(epoch from (t.completed_at - t.created_at)) / 86400)
                 filter (where t.status = 'completed' and t.completed_at >= coalesce(${from}::date, current_date - 30)), 1)::text as avg_completion_days,
           count(*) filter (where t.status not in ('completed', 'cancelled') and t.priority in ('high', 'urgent'))::int as high_priority_open
      from tasks t join user_profiles u on u.id = t.assigned_to
     where t.org_id = any(${tx.array(orgIds)}::uuid[]) ${onlyUser ? tx`and t.assigned_to = ${onlyUser}` : tx``}
     group by u.id, u.full_name
     order by open desc, u.full_name`
}

// ---------------------------------------------------------------------------
// In-app notifications (computed from live data; no external delivery)
// ---------------------------------------------------------------------------
export async function getNotifications(ctx: Ctx) {
  return run(ctx, async (tx) => {
    const [t] = await tx<{ assigned_new: number; due_soon: number; overdue: number }[]>`
      select count(*) filter (where t.created_at > now() - interval '3 days' and t.created_by <> ${ctx.userId})::int as assigned_new,
             count(*) filter (where t.due_date between current_date and current_date + 2)::int as due_soon,
             count(*) filter (where t.due_date < current_date)::int as overdue
        from tasks t where t.assigned_to = ${ctx.userId} and t.status not in ('completed', 'cancelled')`
    const [d] = await tx<{ rejected: number; awaiting_review: number }[]>`
      select count(*) filter (where d.status in ('rejected', 'changes_required'))::int as rejected,
             count(*) filter (where d.status in ('uploaded', 'under_review', 'verified') and app.can_on_student(d.student_id, 'documents.review'))::int as awaiting_review
        from student_documents d
        join student_assignments a on a.student_id = d.student_id and a.user_id = ${ctx.userId} and a.is_active`
    // Documents waiting for MY approval (not ones I verified/submitted myself)
    const [ap] = await tx<{ n: number }[]>`
      select count(*)::int as n from student_documents d
       where d.status = 'pending_approval' and coalesce(d.verified_by <> ${ctx.userId}, true) and coalesce(d.submitted_by <> ${ctx.userId}, true)
         and app.can_on_student(d.student_id, 'documents.approve')`
    const [s] = await tx<{ next_action_due: number }[]>`
      select count(*)::int as next_action_due from v_students s
        join student_assignments a on a.student_id = s.id and a.user_id = ${ctx.userId} and a.is_active
       where s.status = 'active' and s.next_action_due <= current_date`
    const items = [
      { key: 'overdue', label: 'Your overdue tasks', count: t.overdue, href: '/tasks?mine=yes&view=overdue', tone: 'red' },
      { key: 'due_soon', label: 'Your tasks due in the next 2 days', count: t.due_soon, href: '/tasks?mine=yes&view=open', tone: 'amber' },
      { key: 'assigned_new', label: 'Tasks assigned to you recently', count: t.assigned_new, href: '/tasks?mine=yes&view=open', tone: 'blue' },
      { key: 'awaiting_review', label: 'Documents to verify on your students', count: d.awaiting_review, href: '/reports/documents?status=awaiting', tone: 'amber' },
      { key: 'approval', label: 'Documents awaiting your approval', count: ap.n, href: '/reports/documents?status=approval', tone: 'purple' },
      { key: 'rejected', label: 'Rejected / changes required on your students', count: d.rejected, href: '/reports/documents?status=rejected', tone: 'red' },
      { key: 'next_action', label: 'Your students needing their next action', count: s.next_action_due, href: '/students?assignee=me&nextDue=overdue', tone: 'amber' },
    ].filter((i) => i.count > 0)
    return { items, total: items.reduce((a, i) => a + i.count, 0) }
  })
}
