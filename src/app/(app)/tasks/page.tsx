import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate, label } from '@/components/format'
import { Icon } from '@/components/icons'
import { Avatar, Card, EmptyState, FilterBar, PageHeader, Pagination, PriorityBadge, StatCard, StatusBadge, ViewTabs, studentPhotoUrl } from '@/components/ui'
import { can, canAny } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { listTasks, type TaskFilters, type TaskRow, taskAssignees, taskCounts } from '@/server/services/tasks'
import { getScope } from '@/server/scope'
import { DELAY_REASONS } from '@/server/validation'

export const metadata: Metadata = { title: 'Tasks' }

const VIEWS = [
  ['open', 'All open'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'],
  ['waiting', 'Waiting on external'], ['unassigned', 'Unassigned'], ['completed', 'Completed'],
] as const

const COLUMNS = [
  ['not_started', 'Not started', 'bg-slate-400'], ['in_progress', 'In progress', 'bg-blue-500'],
  ['waiting_external', 'Waiting on external', 'bg-amber-500'], ['completed', 'Completed', 'bg-emerald-500'],
] as const

const PRIORITY_BAR: Record<string, string> = { urgent: 'border-l-red-500', high: 'border-l-orange-400', normal: 'border-l-sky-400', low: 'border-l-slate-300' }

function Due({ t }: { t: TaskRow }) {
  if (!t.due_date) return <span className="text-slate-400">No due date</span>
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap ${t.is_overdue ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
      <Icon name="clock" className="h-3.5 w-3.5" />{fmtDate(t.due_date)}{t.is_overdue && ' · overdue'}
    </span>
  )
}

function StudentRef({ t }: { t: TaskRow }) {
  if (!t.student_id) return <span className="text-slate-400">—</span>
  if (!t.student_code) return <span className="text-slate-400">Restricted</span>
  return <Link href={`/students/${t.student_id}`} className="inline-flex items-center gap-1.5 text-slate-700"><Avatar name={t.student_name} size="sm" src={studentPhotoUrl(t.student_id, t.student_photo_version)} />{t.student_name} <span className="font-mono text-xs text-slate-500">{t.student_code}</span></Link>
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  if (!canAny(ctx, ['tasks.read.all', 'tasks.read.own'])) return <PageHeader title="Tasks" description="You do not have access to tasks." />
  const sp = await searchParams
  const scope = await getScope(ctx)
  const board = sp.layout === 'board'
  const view = (VIEWS.find(([k]) => k === sp.view)?.[0] ?? 'open') as TaskFilters['view']
  const [data, staff, counts] = await Promise.all([
    listTasks(ctx, scope.orgIds, { ...sp, view } as TaskFilters), taskAssignees(ctx, scope.orgIds), taskCounts(ctx, scope.orgIds, sp.mine === 'yes'),
  ])
  const seesAll = scope.orgIds.some((o) => can(ctx, 'tasks.read.all', o))
  const canCreate = scope.orgIds.some((o) => can(ctx, 'tasks.create', o))
  const base = { mine: sp.mine, assignee: sp.assignee, delay: sp.delay, layout: sp.layout }
  const href = (over: Record<string, string | undefined>) =>
    '?' + new URLSearchParams(Object.entries({ ...base, view, ...over }).filter(([, x]) => x) as [string, string][]).toString()
  const uniqueStaff = [...new Map(staff.map((s) => [s.id, s])).values()]
  const countOf: Record<string, number> = { open: counts.open, overdue: counts.overdue, today: counts.today, upcoming: counts.upcoming,
    waiting: counts.waiting, unassigned: counts.unassigned, completed: counts.completed }
  return (
    <>
      <PageHeader title="Tasks" description={`${scope.label}${seesAll ? '' : ' · tasks assigned to or created by you'}`}
        actions={<>
          <div className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200" role="group" aria-label="Layout">
            <Link href={href({ layout: undefined })} aria-current={!board ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium no-underline hover:no-underline ${!board ? 'bg-navy-950 text-white' : 'text-slate-600'}`}>List</Link>
            <Link href={href({ layout: 'board' })} aria-current={board ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium no-underline hover:no-underline ${board ? 'bg-navy-950 text-white' : 'text-slate-600'}`}>Board</Link>
          </div>
          {canCreate && <Link href="/tasks/new" className="btn-primary"><Icon name="plus" className="h-4 w-4" />New task</Link>}
        </>} />

      <section aria-label="Task summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Open tasks" value={counts.open} tone="blue" icon={<Icon name="tasks" className="h-5 w-5" />} href={href({ view: 'open' })} />
        <StatCard label="Overdue" value={counts.overdue} tone="red" icon={<Icon name="clock" className="h-5 w-5" />} href={href({ view: 'overdue' })} />
        <StatCard label="Due today" value={counts.today} tone="amber" icon={<Icon name="flag" className="h-5 w-5" />} href={href({ view: 'today' })} />
        <StatCard label="High / urgent priority" value={counts.urgent} tone="orange" icon={<Icon name="trend" className="h-5 w-5" />} />
        <StatCard label="Completed (7 days)" value={counts.completed_week} tone="green" icon={<Icon name="check" className="h-5 w-5" />} href={href({ view: 'completed' })} />
      </section>

      <ViewTabs label="Task views" items={VIEWS.map(([k, l]) => ({ href: href({ view: k }), label: l, active: view === k, count: countOf[k], alert: k === 'overdue' }))} />

      <FilterBar>
        <input type="hidden" name="view" value={view} />
        {board && <input type="hidden" name="layout" value="board" />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mine" value="yes" defaultChecked={sp.mine === 'yes'} /> Only my tasks</label>
        {seesAll && (
          <div><label className="label" htmlFor="assignee">Assigned to</label>
            <select className="input" id="assignee" name="assignee" defaultValue={sp.assignee ?? ''}><option value="">Anyone</option>{uniqueStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
        )}
        <div><label className="label" htmlFor="delay">Waiting on</label>
          <select className="input" id="delay" name="delay" defaultValue={sp.delay ?? ''}><option value="">Any</option>{DELAY_REASONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}</select></div>
        <button className="btn-primary" type="submit">Apply</button>
        <Link className="btn-ghost" href="/tasks">Clear</Link>
      </FilterBar>

      {board ? (
        <section aria-label="Task board" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map(([status, title, dot]) => {
            const rows = data.rows.filter((t) => t.status === status)
            return (
              <div key={status} className="flex min-h-40 flex-col rounded-2xl bg-slate-100/80 p-3">
                <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
                  <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot}`} />{title}
                  <span className="ml-auto rounded-full bg-white px-2 text-xs tabular-nums text-slate-600">{rows.length}</span>
                </h2>
                <ul className="space-y-2">
                  {rows.length === 0 && <li className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">Nothing here</li>}
                  {rows.map((t) => (
                    <li key={t.id} className={`rounded-xl border border-l-4 border-slate-200 bg-white p-3 shadow-sm ${PRIORITY_BAR[t.priority] ?? ''}`}>
                      <Link href={`/tasks/${t.id}`} className="text-sm font-semibold text-slate-900">{t.title}</Link>
                      <p className="mt-0.5 text-xs text-slate-500">{label(t.task_type)} · {t.org_name}</p>
                      <div className="mt-2 text-xs"><StudentRef t={t} /></div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <Due t={t} />
                        <span className="flex items-center gap-1.5"><PriorityBadge priority={t.priority} />
                          {t.assignee_name ? <span title={t.assignee_name}><Avatar name={t.assignee_name} size="sm" /></span> : <span className="font-medium text-amber-700">Unassigned</span>}</span>
                      </div>
                      {t.status === 'waiting_external' && t.delay_reason && <p className="mt-1 text-xs text-amber-800">Waiting on {label(t.delay_reason)}</p>}
                    </li>))}
                </ul>
              </div>
            )
          })}
        </section>
      ) : (
        <Card padded={false}>
          {data.rows.length === 0 ? <EmptyState title="No tasks in this view" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Task</th><th>Student</th><th>Assigned to</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
              <tbody>{data.rows.map((t) => (
                <tr key={t.id}>
                  <td className={`border-l-4 ${PRIORITY_BAR[t.priority] ?? 'border-l-transparent'}`}>
                    <Link href={`/tasks/${t.id}`} className="font-medium">{t.title}</Link><div className="text-xs text-slate-500">{label(t.task_type)} · {t.org_name}</div></td>
                  <td>{t.student_id && t.student_code ? <Link href={`/students/${t.student_id}`} className="inline-flex items-center gap-2"><Avatar name={t.student_name} size="sm" src={studentPhotoUrl(t.student_id, t.student_photo_version)} />{t.student_name}</Link> : t.student_id ? <span className="text-slate-400">Restricted</span> : '—'}
                    {t.student_code && <div className="font-mono text-xs text-slate-500">{t.student_code}</div>}</td>
                  <td>{t.assignee_name ? <span className="flex items-center gap-2"><Avatar name={t.assignee_name} size="sm" />{t.assignee_name}</span> : <span className="text-amber-700">Unassigned</span>}</td>
                  <td><StatusBadge status={t.status} />{t.status === 'waiting_external' && t.delay_reason && <div className="text-xs text-slate-500">on {label(t.delay_reason)}</div>}</td>
                  <td><PriorityBadge priority={t.priority} /></td>
                  <td className={`whitespace-nowrap ${t.is_overdue ? 'font-semibold text-red-700' : ''}`}>{fmtDate(t.due_date)}{t.is_overdue && <div className="text-xs">Overdue</div>}
                    {t.completed_at && <div className="text-xs font-normal text-slate-500">Done {fmtDate(t.completed_at)}</div>}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          <Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={{ ...sp, view }} />
        </Card>
      )}
      {board && <div className="card mt-4"><Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={{ ...sp, view }} /></div>}
    </>
  )
}
