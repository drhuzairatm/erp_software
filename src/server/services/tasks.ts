import { randomUUID } from 'node:crypto'
import { can } from '../auth/context'
import { forbidden, invalid, notFound } from '../errors'
import { fieldErrors, taskSchema, taskUpdateSchema } from '../validation'
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
  status: string; due_date: string | null; delay_reason: string | null; completed_at: Date | null; created_at: Date
  is_overdue: boolean; total: string; student_photo_version: number | null
}

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function listTasks(ctx: Ctx, orgIds: string[], f: TaskFilters) {
  const page = pageOf(f.page)
  return run(ctx, async (tx) => {
    const conds = [tx`t.org_id = any(${tx.array(orgIds)}::uuid[])`]
    const open = tx`t.status not in ('completed', 'cancelled')`
    switch (f.view ?? 'open') {
      case 'overdue': conds.push(open, tx`t.due_date < current_date`); break
      case 'today': conds.push(open, tx`t.due_date = current_date`); break
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
             t.delay_reason, t.completed_at, t.created_at,
             (t.status not in ('completed', 'cancelled') and t.due_date < current_date) as is_overdue,
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
    const [task] = await tx<(TaskRow & { description: string | null; delay_note: string | null; created_by: string })[]>`
      select t.*, o.name as org_name, s.student_code, s.full_name as student_name, au.full_name as assignee_name, cu.full_name as creator_name,
             (t.status not in ('completed', 'cancelled') and t.due_date < current_date) as is_overdue
        from tasks t
        join organizations o on o.id = t.org_id
        left join students s on s.id = t.student_id and app.can_read_student(s.id)
        left join user_profiles au on au.id = t.assigned_to
        left join user_profiles cu on cu.id = t.created_by
       where t.id = ${id}`
    if (!task) return null
    const [comments, events, staff] = await Promise.all([
      tx<{ id: string; body: string; created_at: Date; author: string | null }[]>`
        select c.id, c.body, c.created_at, u.full_name as author from task_comments c left join user_profiles u on u.id = c.author_id
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
    ])
    const mineOrCreated = task.assigned_to === ctx.userId || task.created_by === ctx.userId
    const permissions = {
      update: can(ctx, 'tasks.update.all', task.org_id) || can(ctx, 'tasks.assign', task.org_id) || (mineOrCreated && can(ctx, 'tasks.update.own', task.org_id)),
      reassign: can(ctx, 'tasks.assign', task.org_id) || task.created_by === ctx.userId,
    }
    return { task, comments, events, staff, permissions }
  })
}

export async function createTask(ctx: Ctx, raw: Record<string, unknown>) {
  const parsed = taskSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Please correct the highlighted fields.', fieldErrors(parsed.error))
  const v = parsed.data
  if (!can(ctx, 'tasks.create', v.orgId)) throw forbidden('You cannot create tasks for this company.')
  if (v.assignedTo && v.assignedTo !== ctx.userId && !can(ctx, 'tasks.assign', v.orgId)) throw forbidden('You can only assign tasks to yourself.')
  const id = randomUUID()
  await run(ctx, (tx) => tx`
    insert into tasks (id, org_id, student_id, title, description, task_type, assigned_to, priority, status, due_date, delay_reason, delay_note)
    values (${id}, ${v.orgId}, ${v.studentId ?? null}, ${v.title}, ${v.description ?? null}, ${v.taskType}, ${v.assignedTo ?? null},
            ${v.priority}, ${v.status}, ${v.dueDate ?? null}, ${v.delayReason ?? null}, ${v.delayNote ?? null})`)
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
           count(*) filter (where status not in ('completed', 'cancelled') and due_date < current_date)::int as overdue,
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
