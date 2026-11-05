import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, EmptyState, PageHeader, StatCard } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { getScope } from '@/services/scope'
import { taskReminderSettings, taskReport } from '@/services/tasks'
import { TaskRemindersForm } from '../task-forms'

export const metadata: Metadata = { title: 'Task reports' }

const iso = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)

export default async function TaskReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; department?: string; period?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const scope = await getScope(ctx)
  const orgIds = scope.orgIds.filter((o) => can(ctx, 'tasks.read.all', o))
  if (!orgIds.length) return <PageHeader title="Task reports" description="You do not have access to task reports." />
  const now = new Date()
  const week = new Date(now.getTime() - 6 * 86400000)
  const period = sp.period === 'today' ? { from: iso(now), to: iso(now) } : sp.period === 'week' ? { from: iso(week), to: iso(now) } : { from: sp.from, to: sp.to }
  const r = await taskReport(ctx, orgIds, { ...period, departmentId: sp.department })
  const settingsOrgs = ctx.memberships.filter((m) => can(ctx, 'settings.manage', m.orgId) && orgIds.includes(m.orgId))
  const reminders = await Promise.all(settingsOrgs.map(async (o) => ({ org: o, v: await taskReminderSettings(ctx, o.orgId) })))
  return (
    <>
      <PageHeader back={{ href: '/tasks', label: 'Tasks' }} title="Task reports" description={`${r.from} to ${r.to}. Workload, performance and overdue figures come straight from the task records.`} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="tr-from">From</label><input className="input" id="tr-from" type="date" name="from" defaultValue={r.from} /></div>
        <div><label className="label" htmlFor="tr-to">To</label><input className="input" id="tr-to" type="date" name="to" defaultValue={r.to} /></div>
        <div><label className="label" htmlFor="tr-dept">Department</label><select className="input" id="tr-dept" name="department" defaultValue={sp.department ?? ''}><option value="">All</option>{r.deptList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <button className="btn-primary">Apply</button>
        <a className="btn-ghost" href="?period=today">Today</a><a className="btn-ghost" href="?period=week">Last 7 days</a><Link className="btn-ghost" href="/tasks/reports">This month</Link>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Due today" value={r.totals.due_today} />
        <StatCard label="Pending" value={r.totals.open} />
        <StatCard label="Overdue now" value={r.totals.overdue} tone={r.totals.overdue ? 'red' : 'slate'} />
        <StatCard label="Completed" value={r.totals.completed} tone="green" />
        <StatCard label="Completed late" value={r.totals.late} tone="amber" />
        <StatCard label="Deadline breaches" value={r.totals.breached} />
      </div>
      <div className="space-y-6">
        <Card title="By department" padded={false}>
          {r.departments.length === 0 ? <EmptyState title="No staff match" /> : <div className="table-wrap"><table><thead><tr><th>Department</th><th>People</th><th>Pending</th><th>Overdue</th><th>Completed</th><th>Late</th></tr></thead>
            <tbody>{r.departments.map((d) => <tr key={d.department}><td>{d.department}</td><td>{d.people}</td><td>{d.open}</td><td>{d.overdue}</td><td>{d.completed}</td><td>{d.late}</td></tr>)}</tbody></table></div>}
        </Card>
        <Card title="Workload and performance by employee" padded={false}>
          <div className="table-wrap"><table><thead><tr><th>Person</th><th>Pending</th><th>Overdue</th><th>Due today</th><th>Assigned</th><th>Completed</th><th>On time</th><th>Late</th><th>Avg hours</th></tr></thead>
            <tbody>{r.people.map((p) => <tr key={`${p.org_name}${p.user_id}`}><td>{p.full_name}<span className="block text-xs text-slate-500">{p.org_name}{p.department ? ` · ${p.department}` : ''}</span></td>
              <td>{p.open}</td><td>{p.overdue}</td><td>{p.due_today}</td><td>{p.assigned}</td><td>{p.completed}</td><td>{p.on_time}</td><td>{p.late}</td><td>{p.avg_hours ?? '–'}</td></tr>)}</tbody></table></div>
        </Card>
        {reminders.map(({ org, v }) => <Card key={org.orgId} title={`Reminders · ${org.orgName}`}><TaskRemindersForm orgId={org.orgId} v={v} /></Card>)}
      </div>
    </>
  )
}
