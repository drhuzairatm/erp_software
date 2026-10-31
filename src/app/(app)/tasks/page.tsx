import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate, label } from '@/components/format'
import { Card, EmptyState, PageHeader, Pagination, PriorityBadge, StatusBadge } from '@/components/ui'
import { can, canAny } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { listTasks, type TaskFilters, taskAssignees } from '@/server/services/tasks'
import { getScope } from '@/server/scope'
import { DELAY_REASONS } from '@/server/validation'

export const metadata: Metadata = { title: 'Tasks' }

const VIEWS = [
  ['open', 'All open'], ['overdue', 'Overdue'], ['today', 'Due today'], ['upcoming', 'Upcoming'],
  ['waiting', 'Waiting on external'], ['unassigned', 'Unassigned'], ['completed', 'Completed'],
] as const

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  if (!canAny(ctx, ['tasks.read.all', 'tasks.read.own'])) return <PageHeader title="Tasks" description="You do not have access to tasks." />
  const sp = await searchParams
  const scope = await getScope(ctx)
  const view = (VIEWS.find(([k]) => k === sp.view)?.[0] ?? 'open') as TaskFilters['view']
  const [data, staff] = await Promise.all([listTasks(ctx, scope.orgIds, { ...sp, view } as TaskFilters), taskAssignees(ctx, scope.orgIds)])
  const seesAll = scope.orgIds.some((o) => can(ctx, 'tasks.read.all', o))
  const canCreate = scope.orgIds.some((o) => can(ctx, 'tasks.create', o))
  const base = { mine: sp.mine, assignee: sp.assignee, delay: sp.delay }
  const href = (v: string) => '?' + new URLSearchParams(Object.entries({ ...base, view: v }).filter(([, x]) => x) as [string, string][]).toString()
  const uniqueStaff = [...new Map(staff.map((s) => [s.id, s])).values()]
  return (
    <>
      <PageHeader title="Tasks" description={`${scope.label}${seesAll ? '' : ' · tasks assigned to or created by you'}`}
        actions={canCreate && <Link href="/tasks/new" className="btn-primary">New task</Link>} />
      <nav aria-label="Task views" className="mb-4 flex flex-wrap gap-1">
        {VIEWS.map(([k, l]) => (
          <Link key={k} href={href(k)} aria-current={view === k ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-sm no-underline hover:no-underline ${view === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{l}</Link>
        ))}
      </nav>
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="view" value={view} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mine" value="yes" defaultChecked={sp.mine === 'yes'} /> Only my tasks</label>
        {seesAll && (
          <div><label className="label" htmlFor="assignee">Assigned to</label>
            <select className="input" id="assignee" name="assignee" defaultValue={sp.assignee ?? ''}><option value="">Anyone</option>{uniqueStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
        )}
        <div><label className="label" htmlFor="delay">Waiting on</label>
          <select className="input" id="delay" name="delay" defaultValue={sp.delay ?? ''}><option value="">Any</option>{DELAY_REASONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}</select></div>
        <button className="btn-primary" type="submit">Apply</button>
        <Link className="btn-ghost" href="/tasks">Clear</Link>
      </form>
      <Card padded={false}>
        {data.rows.length === 0 ? <EmptyState title="No tasks in this view" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Task</th><th>Student</th><th>Assigned to</th><th>Status</th><th>Priority</th><th>Due</th></tr></thead>
            <tbody>{data.rows.map((t) => (
              <tr key={t.id}>
                <td><Link href={`/tasks/${t.id}`} className="font-medium">{t.title}</Link><div className="text-xs text-slate-500">{label(t.task_type)} · {t.org_name}</div></td>
                <td>{t.student_id && t.student_code ? <Link href={`/students/${t.student_id}`}>{t.student_name}</Link> : t.student_id ? <span className="text-slate-400">Restricted</span> : '—'}
                  {t.student_code && <div className="font-mono text-xs text-slate-500">{t.student_code}</div>}</td>
                <td>{t.assignee_name ?? <span className="text-amber-700">Unassigned</span>}</td>
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
    </>
  )
}
