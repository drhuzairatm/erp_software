import { randomUUID } from 'node:crypto'
import { can } from '../lib/auth/context'
import { forbidden, invalid, notFound } from '../lib/errors'
import { fieldErrors, taskSchema, taskUpdateSchema } from '../lib/validation'
import { type Ctx, PAGE_SIZE, pageOf, run } from './base'

export interface TaskFilters {
  view?: 'overdue' | 'today' | 'upcoming' | 'unassigned' | 'completed' | 'waiting' | 'open' | 'all'
  mine?: 'yes'
  assignee?: string
  status?: string
  studentId?: string
  delay?: string
  page?: string | number
}

export interface TaskRow {
  id: string; org_id: string; org_name: string; student_id: string | null; student_code: string | null; student_name: string | null
  title: string; task_type: string; assigned_to: string | null; assignee_name: string | null; creator_name: string | null; priority: string
  status: string; due_date: string | null; due_at: Date | null; overdue_at: Date | null; completed_late: boolean; delay_reason: string | null; completed_at: Date | null; created_at: Date
  is_overdue: boolean; total: string; student_photo_version: number | null
}

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function listTasks(ctx: Ctx, orgIds: string[], f: TaskFilters) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const conds = [tx`t.org_id = any(${tx.array(orgIds)}::uuid[])`]
    const open = tx`t.status not in ('completed', 'cancelled')`
    switch (f.view ?? 'open') {
      case 'overdue': conds.push(open, tx`app.task_deadline(t.due_at, t.due_date) < now()`); break
      case 'today': conds.push(open, tx`t.due_date = current_date and app.task_deadline(t.due_at, t.due_date) >= now()`); break
      case 'upcoming': conds.push(open, tx`t.due_date > current_date`); break
      case 'unassigned': conds.push(open, tx`t.assigned_to is null`); break
      case 'completed': conds.push(tx`t.status = 'completed'`); break
      case 'waiting': conds.push(tx`t.status = 'waiting_external'`); break
      case 'open': conds.push(open); break
    }
    if (f.mine === 'yes') conds.push(tx`t.assigned_to = ${ctx.userId}`)
    if (f.assignee && UUID_RE.test(f.assignee)) conds.push(tx`t.assigned_to = ${f.assignee}`)
    if (f.status && /^[a-z_]+$/.test(f.status)) conds.push(tx`t.status = ${f.status}`)
    if (f.delay && /^[a-z_]+$/.test(f.delay)) conds.push(tx`t.delay_reason = ${f.delay}`)
    if (f.studentId && UUID_RE.test(f.studentId)) conds.push(tx`t.student_id = ${f.studentId}`)
    const where = conds.reduce((a, c) => tx`${a} and ${c}`)
    const rows = await tx<TaskRow[]>`
      select t.id, t.org_id, o.name as org_name, t.student_id, s.student_code, s.full_name as student_name, t.title, t.task_type,
             t.assigned_to, au.full_name as assignee_name, cu.full_name as creator_name, t.priority, t.status, t.due_date,
             t.due_at, t.overdue_at, t.completed_late, t.delay_reason, t.completed_at, t.created_at,
             (t.status not in ('completed', 'cancelled') and app.task_deadline(t.due_at, t.due_date) < now()) as is_overdue,
             (select ph.version from student_photos ph where ph.student_id = s.id and ph.is_current) as student_photo_version,
             count(*) over () as total
        from tasks t
        join organizations o on o.id = t.org_id
        left join students s on s.id = t.student_id and app.can_read_student(s.id)
        left join user_profiles au on au.id = t.assigned_to
        left join user_profiles cu on cu.id = t.created_by
       where ${where}
       order by (t.status in ('completed', 'cancelled')), t.due_date asc nulls last,
                case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at
       limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
    return { rows, total: Number(rows[0]?.total ?? 0), page, pageSize: PAGE_SIZE }
  })
}

export async function getTask(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) return null
  return run(ctx, async (tx) => {
    const [task] = await tx<(TaskRow & { description: string | null; delay_note: string | null; created_by: string; start_date: string | null; completion_instructions: string | null; evidence_required: boolean; requires_review: boolean; progress_percent: number; assigned_at: Date | null; original_due_at: Date | null; original_due_date: string | null; submitted_at: Date | null; correction_count: number; meeting_id: string | null })[]>`
      select t.*, o.name as org_name, s.student_code, s.full_name as student_name, au.full_name as assignee_name, cu.full_name as creator_name,
             (t.status not in ('completed', 'cancelled') and app.task_deadline(t.due_at, t.due_date) < now()) as is_overdue,
             (select a.meeting_id from meeting_action_points a where a.task_id = t.id) as meeting_id
        from tasks t
        join organizations o on o.id = t.org_id
        left join students s on s.id = t.student_id and app.can_read_student(s.id)
        left join user_profiles au on au.id = t.assigned_to
        left join user_profiles cu on cu.id = t.created_by
       where t.id = ${id}`
    if (!task) return null
    const [comments, events, staff, extensions, reviews, canReview] = await Promise.all([
      tx<{ id: string; body: string; created_at: Date; author: string | null; author_id: string | null }[]>`
        select c.id, c.body, c.created_at, u.full_name as author, c.author_id from task_comments c left join user_profiles u on u.id = c.author_id
         where c.task_id = ${id} order by c.created_at`,
      tx<{ id: string; event_type: string; from_value: string | null; to_value: string | null; occurred_at: Date; actor: string | null }[]>`
        select e.id, e.event_type,
               case when e.event_type = 'reassigned' then (select full_name from user_profiles where id::text = e.from_value) else e.from_value end as from_value,
               case when e.event_type in ('reassigned', 'assigned') then (select full_name from user_profiles where id::text = e.to_value) else e.to_value end as to_value,
               e.occurred_at, u.full_name as actor
          from task_events e left join user_profiles u on u.id = e.actor_id
         where e.task_id = ${id} order by e.occurred_at, e.id`,
      tx<{ id: string; full_name: string }[]>`
        select u.id, u.full_name from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active
         where m.org_id = ${task.org_id} and m.is_active order by u.full_name`,
      tx<{ id: string; previous_due: Date | null; new_due: Date | null; reason: string; extended_at: Date; actor: string | null }[]>`
        select x.id, x.previous_due, x.new_due, x.reason, x.extended_at, u.full_name as actor from task_deadline_extensions x left join user_profiles u on u.id = x.extended_by where x.task_id = ${id} order by x.extended_at`,
      tx<{ id: string; decision: string; note: string | null; created_at: Date; actor: string | null }[]>`
        select r.id, r.decision, r.note, r.created_at, u.full_name as actor from task_reviews r left join user_profiles u on u.id = r.actor_id where r.task_id = ${id} order by r.created_at`,
      tx<{ ok: boolean }[]>`select app.task_can_review(${id}) as ok`,
    ])
    const mineOrCreated = task.assigned_to === ctx.userId || task.created_by === ctx.userId
    const permissions = {
      update: can(ctx, 'tasks.update.all', task.org_id) || can(ctx, 'tasks.assign', task.org_id) || (mineOrCreated && can(ctx, 'tasks.update.own', task.org_id)),
      reassign: can(ctx, 'tasks.assign', task.org_id) || task.created_by === ctx.userId,
    }
    return { task, comments, events, staff, extensions, reviews, permissions: { ...permissions, review: canReview[0].ok, submit: task.assigned_to === ctx.userId, extend: can(ctx, 'tasks.assign', task.org_id) || task.created_by === ctx.userId } }
  })
}

/** A date and time typed in India time. */
const dueAt = (date?: string | null, time?: string) => (date && time ? new Date(`${date}T${time}:00+05:30`) : null)

export async function createTask(ctx: Ctx, raw: Record<string, unknown>) {
  const parsed = taskSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  if (!can(ctx, 'tasks.create', v.orgId)) throw forbidden('You cannot create tasks for this company.')
  if (v.assignedTo && v.assignedTo !== ctx.userId && !can(ctx, 'tasks.assign', v.orgId)) throw forbidden('You can only assign tasks to yourself.')
  const id = randomUUID()
  await run(ctx, (tx) => tx`
    insert into tasks (id, org_id, student_id, title, description, task_type, assigned_to, priority, status, due_date, due_at, start_date, completion_instructions, evidence_required, requires_review, delay_reason, delay_note)
    values (${id}, ${v.orgId}, ${v.studentId ?? null}, ${v.title}, ${v.description ?? null}, ${v.taskType}, ${v.assignedTo ?? null},
            ${v.priority}, ${v.status}, ${v.dueDate ?? null}, ${dueAt(v.dueDate, v.dueTime)}, ${v.startDate ?? null}, ${v.completionInstructions ?? null}, ${!!v.evidenceRequired}, ${!!v.requiresReview}, ${v.delayReason ?? null}, ${v.delayNote ?? null})`)
  return id
}

export async function updateTask(ctx: Ctx, id: string, raw: Record<string, unknown>) {
  const parsed = taskUpdateSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  return run(ctx, async (tx) => {
    const [cur] = await tx<{ status: string }[]>`select status from tasks where id = ${id}`
    if (!cur) throw notFound()
    const set: Record<string, unknown> = {}
    if (v.title !== undefined) set.title = v.title
    if ('description' in raw) set.description = v.description ?? null
    if ('assignedTo' in raw) set.assigned_to = v.assignedTo ?? null
    if (v.progressPercent !== undefined) set.progress_percent = v.progressPercent
    if (v.priority) set.priority = v.priority
    if (v.status) set.status = v.status
    if ('dueDate' in raw) set.due_date = v.dueDate ?? null
    if ('delayReason' in raw) set.delay_reason = v.delayReason ?? null
    if ('delayNote' in raw) set.delay_note = v.delayNote ?? null
    if (!Object.keys(set).length) return
    const r = await tx`update tasks set ${tx(set as never)} where id = ${id}`
    if (r.count === 0) throw forbidden('You cannot update this task.')
  })
}

export async function addTaskComment(ctx: Ctx, taskId: string, body: string) {
  const text = body?.trim()
  if (!text) throw invalid('Write a comment.')
  if (text.length > 4000) throw invalid('Comment is too long.')
  return run(ctx, (tx) => tx`insert into task_comments (task_id, author_id, body) values (${taskId}, ${ctx.userId}, ${text})`)
}

/** Staff who can receive tasks in each of the given companies. */
export async function taskAssignees(ctx: Ctx, orgIds: string[]) {
  return run(ctx, (tx) => tx<{ id: string; full_name: string; org_id: string }[]>`
    select distinct u.id, u.full_name, m.org_id from organization_memberships m join user_profiles u on u.id = m.user_id and u.is_active
     where m.is_active and m.org_id = any(${tx.array(orgIds)}::uuid[]) order by u.full_name`)
}

/** Counts per task view (same visibility rules as the list). */
export async function taskCounts(ctx: Ctx, orgIds: string[], mine: boolean) {
  const [r] = await run(ctx, (tx) => tx<{ open: number; overdue: number; today: number; upcoming: number; waiting: number; unassigned: number; completed: number; completed_week: number; urgent: number }[]>`
    select count(*) filter (where status not in ('completed', 'cancelled'))::int as open,
           count(*) filter (where status not in ('completed', 'cancelled') and app.task_deadline(due_at, due_date) < now())::int as overdue,
           count(*) filter (where status not in ('completed', 'cancelled') and due_date = current_date)::int as today,
           count(*) filter (where status not in ('completed', 'cancelled') and due_date > current_date)::int as upcoming,
           count(*) filter (where status = 'waiting_external')::int as waiting,
           count(*) filter (where status not in ('completed', 'cancelled') and assigned_to is null)::int as unassigned,
           count(*) filter (where status = 'completed')::int as completed,
           count(*) filter (where status = 'completed' and completed_at > now() - interval '7 days')::int as completed_week,
           count(*) filter (where status not in ('completed', 'cancelled') and priority in ('urgent', 'high'))::int as urgent
      from tasks where org_id = any(${tx.array(orgIds)}::uuid[]) ${mine ? tx`and assigned_to = ${ctx.userId}` : tx``}`)
  return r
}

export async function submitTask(ctx: Ctx, id: string, note?: string) {
  if (!UUID_RE.test(id)) throw notFound()
  await run(ctx, (tx) => tx`select app.task_submit(${id}, ${note ?? null})`)
}
export async function reviewTask(ctx: Ctx, id: string, decision: string, note?: string) {
  if (!UUID_RE.test(id)) throw notFound()
  await run(ctx, (tx) => tx`select app.task_review(${id}, ${decision}, ${note ?? null})`)
}
export async function extendTask(ctx: Ctx, id: string, date: string, time: string, reason: string) {
  if (!UUID_RE.test(id)) throw notFound()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw invalid('Choose the new date and time.', { date: ['Choose the new date and time.'] })
  await run(ctx, (tx) => tx`select app.task_extend(${id}, ${new Date(`${date}T${time}:00+05:30`)}, ${reason})`)
}

export async function taskReminderSettings(ctx: Ctx, orgId: string) {
  const [r] = await run(ctx, (tx) => tx<{ before_minutes: number[]; at_deadline: boolean; after_overdue: boolean; escalate: boolean }[]>`select before_minutes, at_deadline, after_overdue, escalate from task_reminder_settings where org_id = ${orgId}`)
  return r ?? { before_minutes: [1440, 360, 180, 120, 60], at_deadline: true, after_overdue: true, escalate: true }
}
export async function saveTaskReminderSettings(ctx: Ctx, orgId: string, before: number[], atDeadline: boolean, afterOverdue: boolean, escalate: boolean) {
  if (!can(ctx, 'settings.manage', orgId)) throw forbidden()
  const clean = [...new Set(before.filter((m) => Number.isInteger(m) && m > 0 && m <= 10080))]
  await run(ctx, (tx) => tx`insert into task_reminder_settings (org_id, before_minutes, at_deadline, after_overdue, escalate) values (${orgId}, ${clean}::int[], ${atDeadline}, ${afterOverdue}, ${escalate})
    on conflict (org_id) do update set before_minutes = excluded.before_minutes, at_deadline = excluded.at_deadline, after_overdue = excluded.after_overdue, escalate = excluded.escalate, updated_at = now()`)
}

export interface TaskReportFilters { from?: string; to?: string; departmentId?: string }
/** Task reports from the records themselves. Only companies where the person can read all tasks. Weekly or monthly is a choice of dates. */
export async function taskReport(ctx: Ctx, orgIds: string[], f: TaskReportFilters) {
  const allowed = orgIds.filter((o) => can(ctx, 'tasks.read.all', o))
  if (!allowed.length) throw forbidden()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const from = /^\d{4}-\d{2}-\d{2}$/.test(f.from ?? '') ? f.from! : `${today.slice(0, 7)}-01`
  const to = /^\d{4}-\d{2}-\d{2}$/.test(f.to ?? '') ? f.to! : today
  const dept = UUID_RE.test(f.departmentId ?? '') ? f.departmentId! : null
  return run(ctx, async (tx) => {
    const people = await tx<{ user_id: string; full_name: string; employee_id: string; org_name: string; department: string | null; open: number; overdue: number; due_today: number; assigned: number; completed: number; on_time: number; late: number; breached: number; avg_hours: number | null }[]>`
      select u.id as user_id, u.full_name, u.employee_id, o.name as org_name, d.name as department,
             count(*) filter (where t.status not in ('completed', 'cancelled'))::int as open,
             count(*) filter (where t.status not in ('completed', 'cancelled') and app.task_deadline(t.due_at, t.due_date) < now())::int as overdue,
             count(*) filter (where t.status not in ('completed', 'cancelled') and t.due_date = (now() at time zone 'Asia/Kolkata')::date)::int as due_today,
             count(*) filter (where (t.created_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date)::int as assigned,
             count(*) filter (where (t.completed_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date)::int as completed,
             count(*) filter (where (t.completed_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date and not t.completed_late)::int as on_time,
             count(*) filter (where (t.completed_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date and t.completed_late)::int as late,
             count(*) filter (where (t.overdue_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date)::int as breached,
             round(avg(extract(epoch from t.completed_at - coalesce(t.assigned_at, t.created_at)) / 3600) filter (where (t.completed_at at time zone 'Asia/Kolkata')::date between ${from}::date and ${to}::date), 1)::float as avg_hours
        from organization_memberships m join user_profiles u on u.id = m.user_id join organizations o on o.id = m.org_id left join departments d on d.id = m.department_id
        left join tasks t on t.assigned_to = u.id and t.org_id = m.org_id
       where m.is_active and u.account_status = 'active' and m.org_id = any(${tx.array(allowed)}::uuid[]) and (${dept}::uuid is null or m.department_id = ${dept}::uuid)
       group by u.id, u.full_name, u.employee_id, o.name, d.name order by o.name, u.full_name`
    const departments = new Map<string, { department: string; people: number; open: number; overdue: number; completed: number; late: number }>()
    for (const p of people) {
      const k = `${p.org_name} · ${p.department ?? 'No department'}`
      const d = departments.get(k) ?? { department: k, people: 0, open: 0, overdue: 0, completed: 0, late: 0 }
      d.people++; d.open += p.open; d.overdue += p.overdue; d.completed += p.completed; d.late += p.late
      departments.set(k, d)
    }
    const sum = (k: 'open' | 'overdue' | 'due_today' | 'completed' | 'late' | 'on_time' | 'breached' | 'assigned') => people.reduce((n, p) => n + p[k], 0)
    const deptList = await tx<{ id: string; name: string; org_id: string }[]>`select id, name, org_id from departments where is_active and org_id = any(${tx.array(allowed)}::uuid[]) order by name`
    return { from, to, people, departments: [...departments.values()], totals: { open: sum('open'), overdue: sum('overdue'), due_today: sum('due_today'), completed: sum('completed'), late: sum('late'), on_time: sum('on_time'), breached: sum('breached'), assigned: sum('assigned') }, deptList }
  })
}
