import { can } from '../lib/auth/context'
import { type Ctx, run } from './base'
import { type DashboardFilters, studentConditions } from './dashboard'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Management analytics from live records the user may see (RLS + company scope). Revenue figures are returned
 * ONLY for companies where the user has payments.read (MD / Accounts) — the CEO and other roles get counts only.
 */
export async function managementAnalytics(ctx: Ctx, orgIds: string[], f: DashboardFilters) {
  const financeOrgs = orgIds.filter((o) => can(ctx, 'payments.read', o))
  const canStaff = orgIds.some((o) => can(ctx, 'staff.workload.view', o))
  const from = f.from && DATE_RE.test(f.from) ? f.from : null
  const to = f.to && DATE_RE.test(f.to) ? f.to : null
  return run(ctx, async (tx) => {
    const sw = studentConditions(tx, orgIds, { ...f, from: undefined, to: undefined })
    const inPeriod = tx`coalesce(s.registration_date, s.created_at::date) between coalesce(${from}::date, current_date - 364) and coalesce(${to}::date, current_date)`
    const [k] = await tx<{ total: number; new_period: number; in_progress: number; completed: number; on_hold: number; cancelled: number; new_prev: number }[]>`
      select count(*)::int as total,
             count(*) filter (where ${inPeriod})::int as new_period,
             count(*) filter (where s.status = 'active')::int as in_progress,
             count(*) filter (where s.status = 'completed')::int as completed,
             count(*) filter (where s.status = 'on_hold')::int as on_hold,
             count(*) filter (where s.status = 'cancelled')::int as cancelled,
             count(*) filter (where coalesce(s.registration_date, s.created_at::date) between current_date - 729 and current_date - 365)::int as new_prev
        from v_students s where ${sw}`
    const monthly = await tx<{ month: string; label: string; registered: number; completed: number }[]>`
      with m as (select generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month')::date as month)
      select m.month::text, to_char(m.month, 'Mon') as label,
             (select count(*)::int from v_students s where ${sw} and date_trunc('month', coalesce(s.registration_date, s.created_at::date)) = m.month) as registered,
             (select count(*)::int from v_students s join student_stage_history h on h.student_id = s.id and h.to_stage = 'travel_completed'
               where ${sw} and date_trunc('month', h.changed_at) = m.month) as completed
        from m order by m.month`
    const yearly = await tx<{ year: number; count: number }[]>`
      select extract(year from coalesce(s.registration_date, s.created_at::date))::int as year, count(*)::int as count
        from v_students s where ${sw} group by 1 order by 1 desc limit 5`
    const byCountry = await tx<{ label: string; value: number }[]>`
      select coalesce(c.name, 'Not chosen') as label, count(*)::int as value from v_students s left join countries c on c.id = s.destination_country_id
       where ${sw} and ${inPeriod} group by 1 order by 2 desc`
    const byCourse = await tx<{ label: string; value: number }[]>`
      select coalesce(c.name, 'Not chosen') as label, count(*)::int as value from v_students s left join courses c on c.id = s.course_id
       where ${sw} and ${inPeriod} group by 1 order by 2 desc`
    const byStage = await tx<{ key: string; label: string; value: number; kind: string }[]>`
      select st.key, st.name as label, count(s.id)::int as value, st.kind from stages st
        left join v_students s on s.current_stage_key = st.key and ${sw}
       group by st.key, st.name, st.sort_order, st.kind order by st.sort_order`
    const byCompany = await tx<{ org: string; code: string; students: number; active: number; completed: number; new_period: number }[]>`
      select o.name as org, o.code, count(s.id)::int as students, count(s.id) filter (where s.status = 'active')::int as active,
             count(s.id) filter (where s.status = 'completed')::int as completed, count(s.id) filter (where ${inPeriod})::int as new_period
        from organizations o left join v_students s on s.originating_org_id = o.id and ${sw}
       where o.id = any(${tx.array(orgIds)}::uuid[]) group by o.name, o.code order by o.name`
    const [rates] = await tx<{ docs_required: number; docs_approved: number; tasks_done_30: number; tasks_late_30: number; acks_pending: number }[]>`
      select (select count(*)::int from student_documents d join v_students s on s.id = d.student_id where ${sw} and s.status = 'active' and d.is_required) as docs_required,
             (select count(*)::int from student_documents d join v_students s on s.id = d.student_id where ${sw} and s.status = 'active' and d.is_required and d.status = 'approved') as docs_approved,
             (select count(*)::int from tasks t where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.completed_at > now() - interval '30 days') as tasks_done_30,
             (select count(*)::int from tasks t where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.completed_at > now() - interval '30 days'
                and t.due_date is not null and t.completed_at::date > t.due_date) as tasks_late_30,
             0 as acks_pending`
    const staff = canStaff ? await tx<{ id: string; name: string; students: number; moves_30: number; tasks_done_30: number; overdue: number }[]>`
      select u.id, u.full_name as name,
             (select count(distinct a.student_id)::int from student_assignments a join v_students s on s.id = a.student_id
               where a.user_id = u.id and a.is_active and s.status = 'active' and ${sw}) as students,
             (select count(*)::int from student_stage_history h where h.changed_by = u.id and h.changed_at > now() - interval '30 days') as moves_30,
             (select count(*)::int from tasks t where t.assigned_to = u.id and t.completed_at > now() - interval '30 days') as tasks_done_30,
             (select count(*)::int from tasks t where t.assigned_to = u.id and t.status not in ('completed', 'cancelled') and t.due_date < current_date) as overdue
        from user_profiles u
       where u.is_active and exists (select 1 from organization_memberships m where m.user_id = u.id and m.is_active and m.org_id = any(${tx.array(orgIds)}::uuid[]))
       order by 4 desc, 3 desc limit 12` : []
    let finance: { currency: string; received_period: number; received_months: number[]; outstanding: number; pending: number; due_period: number }[] = []
    if (financeOrgs.length) {
      finance = await tx`
        with m as (select generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month')::date as month),
        cur as (select distinct currency from payment_entries where org_id = any(${tx.array(financeOrgs)}::uuid[]))
        select cur.currency,
               coalesce((select sum(e.received_effect) from payment_entry_effects e where e.currency = cur.currency and e.ledger = 'service'
                  and e.org_id = any(${tx.array(financeOrgs)}::uuid[]) and e.entry_date between coalesce(${from}::date, current_date - 364) and coalesce(${to}::date, current_date)), 0)::float as received_period,
               coalesce((select sum(e.due_effect) from payment_entry_effects e where e.currency = cur.currency and e.ledger = 'service'
                  and e.org_id = any(${tx.array(financeOrgs)}::uuid[]) and e.entry_date between coalesce(${from}::date, current_date - 364) and coalesce(${to}::date, current_date)), 0)::float as due_period,
               array(select coalesce((select sum(e.received_effect) from payment_entry_effects e where e.currency = cur.currency and e.ledger = 'service'
                  and e.org_id = any(${tx.array(financeOrgs)}::uuid[]) and date_trunc('month', e.entry_date) = m.month), 0)::float from m order by m.month) as received_months,
               coalesce((select sum(b.outstanding) from student_balances b where b.currency = cur.currency and b.ledger = 'service' and b.org_id = any(${tx.array(financeOrgs)}::uuid[])), 0)::float as outstanding,
               coalesce((select sum(e.pending_receipts) from payment_entry_effects e where e.currency = cur.currency and e.org_id = any(${tx.array(financeOrgs)}::uuid[])), 0)::float as pending
          from cur order by cur.currency`
    }
    // Consolidated INR equivalents: each entry at the rate stored on it (never today's rate)
    let financeInr: { due_period: number; received_period: number; outstanding: number; missing: number } | null = null
    if (financeOrgs.length) {
      ;[financeInr] = await tx<{ due_period: number; received_period: number; outstanding: number; missing: number }[]>`
        select coalesce(sum(due_inr) filter (where entry_date between coalesce(${from}::date, current_date - 364) and coalesce(${to}::date, current_date)), 0)::float as due_period,
               coalesce(sum(received_inr) filter (where entry_date between coalesce(${from}::date, current_date - 364) and coalesce(${to}::date, current_date)), 0)::float as received_period,
               coalesce(sum(due_inr) - sum(received_inr), 0)::float as outstanding, count(*) filter (where inr_missing)::int as missing
          from payment_entry_effects where ledger = 'service' and org_id = any(${tx.array(financeOrgs)}::uuid[])`
    }
    const byUniversity = await tx<{ label: string; value: number }[]>`
      select coalesce(u.name, 'No university recorded') as label, count(*)::int as value
        from v_students s left join universities u on u.id = s.preferred_university_id
       where ${sw} group by 1 order by 2 desc limit 30`
    const byIntake = await tx<{ label: string; value: number }[]>`
      select coalesce(i.name, 'No intake recorded') as label, count(*)::int as value
        from v_students s left join university_intakes i on i.id = s.intake_id
       where ${sw} group by 1 order by 2 desc limit 30`
    return { kpis: k, monthly, yearly, byCountry, byCourse, byStage, byCompany, byUniversity, byIntake, rates, staff, canStaff, finance, financeInr, financeVisible: financeOrgs.length > 0, from, to }
  })
}

export interface AttendanceTodayRow { company: string; expected: number; present: number; late: number; on_leave: number; absent: number; no_record: number }
export interface TaskSummaryRow { company: string; open: number; overdue: number; done_30: number }

/**
 * Employee and operations figures for the management dashboard, from live records and limited by permission and RLS.
 * Attendance is shown only with attendance.view and task totals only with staff.workload.view.
 * The system marks nobody absent on its own, so "no record" is kept apart from a recorded absence.
 */
export async function teamAndOperations(ctx: Ctx, orgIds: string[]) {
  const attendanceOrgs = orgIds.filter((o) => can(ctx, 'attendance.view', o))
  const taskOrgs = orgIds.filter((o) => can(ctx, 'staff.workload.view', o))
  return run(ctx, async (tx) => {
    const attendance = attendanceOrgs.length ? await tx<AttendanceTodayRow[]>`
      with people as (
        select o.name as company, m.org_id, m.user_id, (now() at time zone coalesce(p.timezone, 'Asia/Kolkata'))::date as d, coalesce(p.weekly_off, '{0}'::int[]) as off
          from organization_memberships m join organizations o on o.id = m.org_id join user_profiles u on u.id = m.user_id and u.is_active
          left join attendance_policies p on p.org_id = m.org_id
         where m.is_active and m.org_id = any(${tx.array(attendanceOrgs)}::uuid[]))
      select x.company, count(*) filter (where extract(dow from x.d)::int <> all(x.off))::int as expected,
             count(r.id) filter (where r.status in ('present', 'late', 'half_day', 'field_duty', 'official_visit'))::int as present,
             count(r.id) filter (where r.status = 'late')::int as late, count(r.id) filter (where r.status = 'leave')::int as on_leave,
             count(r.id) filter (where r.status = 'absent')::int as absent,
             count(*) filter (where r.id is null and extract(dow from x.d)::int <> all(x.off))::int as no_record
        from people x left join attendance_records r on r.org_id = x.org_id and r.user_id = x.user_id and r.work_date = x.d
       group by x.company order by x.company` : []
    const tasks = taskOrgs.length ? await tx<TaskSummaryRow[]>`
      select o.name as company, count(*) filter (where t.status not in ('completed', 'cancelled'))::int as open,
             count(*) filter (where t.status not in ('completed', 'cancelled') and t.due_date < current_date)::int as overdue,
             count(*) filter (where t.completed_at > now() - interval '30 days')::int as done_30
        from tasks t join organizations o on o.id = t.org_id
       where t.org_id = any(${tx.array(taskOrgs)}::uuid[]) group by o.name order by o.name` : []
    const sw = studentConditions(tx, orgIds, {})
    const [ops] = await tx<{ pending_documents: number; verification_requests: number; open_tickets: number; admission_letter: number; visa_processing: number; university_application: number; tasks_due_7: number }[]>`
      select (select count(*)::int from student_documents d join v_students s on s.id = d.student_id
               where ${sw} and s.status in ('active', 'on_hold')
                 and (d.status in ('rejected', 'changes_required', 'uploaded', 'under_review', 'verified', 'pending_approval', 'expired') or (d.status = 'missing' and d.is_required))) as pending_documents,
             (select count(*)::int from dvr_requests v where v.org_id = any(${tx.array(orgIds)}::uuid[]) and v.status not in ('draft', 'verification_completed', 'closed', 'cancelled')) as verification_requests,
             (select count(*)::int from student_tickets t where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.status in ('open', 'in_progress', 'waiting_for_student')) as open_tickets,
             (select count(*)::int from v_students s where ${sw} and s.status = 'active' and s.current_stage_key = 'admission_letter') as admission_letter,
             (select count(*)::int from v_students s where ${sw} and s.status = 'active' and s.current_stage_key = 'visa_processing') as visa_processing,
             (select count(*)::int from v_students s where ${sw} and s.status = 'active' and s.current_stage_key = 'university_application') as university_application,
             (select count(*)::int from tasks t where t.org_id = any(${tx.array(orgIds)}::uuid[]) and t.status not in ('completed', 'cancelled') and t.due_date between current_date and current_date + 7) as tasks_due_7`
    const deadlines = await tx<{ id: string; intake: string; university: string; deadline: string; students: number }[]>`
      select i.id, i.name as intake, u.name as university, to_char(i.application_deadline, 'YYYY-MM-DD') as deadline,
             (select count(*)::int from v_students s where ${sw} and s.status = 'active' and s.intake_id = i.id) as students
        from university_intakes i join universities u on u.id = i.university_id
       where i.is_active and i.application_deadline between current_date and current_date + 30
       order by i.application_deadline, u.name limit 8`
    return { attendance, tasks, ops, deadlines }
  })
}

/** Staff operations: the signed-in user's own work first. */
export async function staffOverview(ctx: Ctx, orgIds: string[]) {
  const canPay = orgIds.some((o) => can(ctx, 'payments.read', o) || can(ctx, 'payments.status', o))
  return run(ctx, async (tx) => {
    const me = ctx.userId
    const scopeCond = tx`exists (select 1 from student_org_access soa where soa.student_id = s.id and soa.org_id = any(${tx.array(orgIds)}::uuid[])) and s.archived_at is null and s.status <> 'merged'`
    const [k] = await tx<{ assigned: number; new_7: number; applications: number; verify_queue: number; my_open_tasks: number; my_overdue: number; followups_today: number; payment_followups: number | null }[]>`
      select (select count(distinct s.id)::int from v_students s join student_assignments a on a.student_id = s.id and a.is_active and a.user_id = ${me} where ${scopeCond} and s.status in ('active', 'on_hold')) as assigned,
             (select count(*)::int from v_students s where ${scopeCond} and s.created_at > now() - interval '7 days') as new_7,
             (select count(*)::int from v_students s where ${scopeCond} and s.status = 'active' and s.current_stage_key in ('university_application', 'admission_letter')) as applications,
             (select count(*)::int from student_documents d join v_students s on s.id = d.student_id where ${scopeCond} and d.status in ('uploaded', 'under_review', 'verified', 'pending_approval')) as verify_queue,
             (select count(*)::int from tasks t where t.assigned_to = ${me} and t.status not in ('completed', 'cancelled')) as my_open_tasks,
             (select count(*)::int from tasks t where t.assigned_to = ${me} and t.status not in ('completed', 'cancelled') and t.due_date < current_date) as my_overdue,
             (select count(*)::int from v_students s join student_assignments a on a.student_id = s.id and a.is_active and a.user_id = ${me}
               where ${scopeCond} and s.status = 'active' and s.next_action_due = current_date)
             + (select count(*)::int from tasks t where t.assigned_to = ${me} and t.status not in ('completed', 'cancelled') and t.due_date = current_date) as followups_today,
             case when ${canPay} then (select count(distinct s.id)::int from v_students s where ${scopeCond} and s.status in ('active', 'on_hold') and app.student_has_outstanding_service_balance(s.id)) end as payment_followups`
    const myStudents = await tx<{ id: string; student_code: string; full_name: string; stage: string; stage_order: number; next_action: string | null; next_action_due: string | null
      docs_required: number; docs_approved: number; passport_status: string | null; country: string | null; status: string; photo_version: number | null }[]>`
      select s.id, s.student_code, s.full_name, st.name as stage, st.sort_order as stage_order, s.next_action, s.next_action_due::text, s.passport_status, c.name as country, s.status,
             (select count(*)::int from student_documents d where d.student_id = s.id and d.is_required) as docs_required,
             (select count(*)::int from student_documents d where d.student_id = s.id and d.is_required and d.status = 'approved') as docs_approved,
             (select ph.version from student_photos ph where ph.student_id = s.id and ph.is_current) as photo_version
        from v_students s join stages st on st.key = s.current_stage_key left join countries c on c.id = s.destination_country_id
       where ${scopeCond} and s.status in ('active', 'on_hold')
         and exists (select 1 from student_assignments a where a.student_id = s.id and a.is_active and a.user_id = ${me})
       order by s.next_action_due nulls last, s.full_name limit 12`
    const recent = await tx<{ id: string; student_id: string; student_code: string; full_name: string; summary: string; occurred_at: Date; actor: string | null; category: string }[]>`
      select e.id::text, e.student_id, s.student_code, s.full_name, e.summary, e.occurred_at, u.full_name as actor, e.category
        from student_events e join v_students s on s.id = e.student_id left join user_profiles u on u.id = e.actor_user_id
       where ${scopeCond} order by e.occurred_at desc limit 10`
    const today = await tx<{ id: string; title: string; due_date: string | null; student_id: string | null; student_name: string | null; priority: string; kind: string }[]>`
      (select t.id, t.title, t.due_date::text, t.student_id, s.full_name as student_name, t.priority, 'task' as kind
         from tasks t left join v_students s on s.id = t.student_id
        where t.assigned_to = ${me} and t.status not in ('completed', 'cancelled') and t.due_date <= current_date order by t.due_date, t.priority desc limit 8)
      union all
      (select s.id, s.next_action, s.next_action_due::text, s.id, s.full_name, 'normal', 'next_action'
         from v_students s join student_assignments a on a.student_id = s.id and a.is_active and a.user_id = ${me}
        where ${scopeCond} and s.status = 'active' and s.next_action_due <= current_date and s.next_action is not null order by s.next_action_due limit 8)`
    return { kpis: k, myStudents, recent, today, canPay }
  })
}
