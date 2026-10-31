import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtMoney, label } from '@/components/format'
import { Alert, Card, EmptyState, PageHeader, StatCard } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getDashboard } from '@/server/services/dashboard'
import { getLookups, type Lookups } from '@/server/services/lookups'
import { taskAssignees } from '@/server/services/tasks'
import { getScope } from '@/server/scope'

export const metadata: Metadata = { title: 'Dashboard' }

type SP = { from?: string; to?: string; country?: string; course?: string; stage?: string; staff?: string; password?: string }

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const scope = await getScope(ctx)
  if (!scope.orgIds.some((o) => can(ctx, 'dashboard.view', o))) {
    return <Alert tone="amber" title="No dashboard access">Use the menu to open the sections available to your role.</Alert>
  }
  const consolidatedAllowed = !scope.isAll || scope.orgIds.every((o) => can(ctx, 'dashboard.consolidated', o))
  const orgIds = consolidatedAllowed ? scope.orgIds : [scope.orgIds[0]]
  const [d, lookups, staff] = await Promise.all([getDashboard(ctx, orgIds, sp), getLookups(ctx), taskAssignees(ctx, orgIds)])
  const f = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== 'password') as [string, string][])
  const withF = (path: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(f)
    for (const [k, v] of Object.entries(extra)) q.set(k, v)
    const s = q.toString()
    return s ? `${path}?${s}` : path
  }
  const title = scope.isAll && consolidatedAllowed ? 'Consolidated dashboard' : `${ctx.memberships.find((m) => m.orgId === orgIds[0])?.orgName} dashboard`
  const maxStage = Math.max(1, ...d.byStage.map((s) => s.count))

  return (
    <>
      <PageHeader title={title} description="All figures are calculated live from the records you are permitted to see." />
      {sp.password === 'changed' && <div className="mb-4"><Alert tone="green">Your password has been changed.</Alert></div>}
      {scope.isAll && !consolidatedAllowed && <div className="mb-4"><Alert tone="amber">You do not have consolidated dashboard access; showing your first company only.</Alert></div>}

      <DashboardFilters sp={sp} lookups={lookups} staff={staff} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Active students" value={d.cards.active} tone="blue" href={withF('/students', { status: 'active' })} sub={`${d.cards.new_30} new in last 30 days`} />
        <StatCard label="On hold" value={d.cards.on_hold} tone="amber" href={withF('/students', { status: 'on_hold' })} />
        <StatCard label="Next action overdue" value={d.cards.next_overdue} tone={d.cards.next_overdue ? 'red' : 'slate'} href={withF('/students', { nextDue: 'overdue' })} />
        <StatCard label="Missing required documents" value={d.docs.missing} tone="slate" href="/reports/documents?status=missing" />
        <StatCard label="Documents awaiting verification" value={d.docs.awaiting_review} tone="purple" href="/reports/documents?status=awaiting"
          sub={`${d.docs.pending_approval} awaiting manager approval`} />
        <StatCard label="Rejected / changes required" value={d.docs.rejected} tone={d.docs.rejected ? 'red' : 'slate'} href="/reports/documents?status=rejected" sub={d.docs.expired ? `${d.docs.expired} expired` : undefined} />
        <StatCard label="Attestation in progress" value={d.attestation.processing} tone="purple" href="/reports/attestation"
          sub={`${d.attestation.ready} approved and ready to start`} />
        <StatCard label="Passports needing renewal" value={d.passport.urgent + d.passport.critical + d.passport.expired}
          tone={d.passport.critical + d.passport.expired ? 'red' : d.passport.urgent ? 'orange' : 'slate'} href="/reports/passport-expiry"
          sub={`${d.passport.expired} expired · ${d.passport.critical} critical · ${d.passport.urgent} urgent · ${d.passport.warning} warning`} />
        <StatCard label="Overdue tasks (internal)" value={d.tasks.overdue_internal} tone={d.tasks.overdue_internal ? 'red' : 'slate'} href="/tasks?view=overdue" />
        <StatCard label="Overdue – waiting on external party" value={d.tasks.overdue_external} tone="amber" href="/tasks?view=waiting" />
        <StatCard label="Tasks due today" value={d.tasks.due_today} tone="blue" href="/tasks?view=today" />
        <StatCard label="Students awaiting external parties" value={d.tasks.students_waiting} tone="amber" href="/reports/awaiting-external" />
        <StatCard label="Unassigned open tasks" value={d.tasks.unassigned} tone={d.tasks.unassigned ? 'amber' : 'slate'} href="/tasks?view=unassigned" />
        <StatCard label="Travel completed" value={d.cards.completed} tone="green" href={withF('/students', { status: 'completed' })} />
      </div>

      {d.canFinance && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {d.finance.length === 0 ? <StatCard label="Outstanding service fees" value={fmtMoney(0)} /> : d.finance.map((fi) => (
            <StatCard key={fi.currency} label={`Outstanding service fees (${fi.currency})`} value={fmtMoney(fi.outstanding, fi.currency)} tone="red"
              href="/reports/balances" sub={`${fi.students_with_balance} students · verified receipts only`} />
          ))}
          {d.finance[0] && (
            <StatCard label="Entries awaiting verification" value={d.finance[0].pending_count} tone="amber" href="/payments?status=pending"
              sub={`Receipts worth ${fmtMoney(d.finance[0].pending_amount, d.finance[0].currency)} not yet counted`} />
          )}
        </div>
      )}

      {!d.canFinance && d.paymentCounts.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatCard label="Students with fees outstanding" value={d.paymentCounts.reduce((a, c) => a + c.students_with_balance, 0)} tone="amber" sub="Count only — amounts are visible to MD and Accounts" />
          <StatCard label="Students at Fee Clearance awaiting payment" value={d.paymentCounts.reduce((a, c) => a + c.students_awaiting_payment, 0)} tone="amber" />
          <StatCard label="Payments awaiting verification" value={d.paymentCounts.reduce((a, c) => a + c.entries_awaiting_verification, 0)} tone="slate" />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Students by admission stage" className="xl:col-span-2">
          <ul className="space-y-1.5">
            {d.byStage.map((s) => (
              <li key={s.key}>
                <Link href={withF('/students', { stage: s.key })} className="group flex items-center gap-3 rounded px-1 py-0.5 text-sm text-slate-800 no-underline hover:bg-slate-50 hover:no-underline">
                  <span className="w-44 shrink-0 truncate">{s.name}</span>
                  <span className="h-3 flex-1 rounded bg-slate-100" aria-hidden>
                    <span className="block h-3 rounded bg-brand-600 group-hover:bg-brand-700" style={{ width: `${(s.count / maxStage) * 100}%` }} />
                  </span>
                  <span className="w-10 text-right font-medium tabular-nums">{s.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Waiting on external parties">
          {d.waitingByParty.length === 0 ? <EmptyState title="Nothing waiting" /> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.waitingByParty.map((w) => (
                <li key={w.delay_reason} className="flex justify-between py-2">
                  <Link href={`/tasks?view=waiting&delay=${w.delay_reason}`}>{label(w.delay_reason)}</Link>
                  <span className="font-medium tabular-nums">{w.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint mt-3">External delays are tracked separately and are not counted as staff delays.</p>
        </Card>
      </div>

      <Card title={d.canWorkload ? 'Workload by staff member' : 'My workload'} className="mt-6" padded={false}>
        {d.workload.length === 0 ? <EmptyState title="No assigned tasks" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Staff member</th><th scope="col" className="text-right">Open</th><th scope="col" className="text-right">High priority</th>
                  <th scope="col" className="text-right">Overdue (internal)</th><th scope="col" className="text-right">Waiting external</th>
                  <th scope="col" className="text-right">Due in 7 days</th><th scope="col" className="text-right">Completed (period)</th>
                  <th scope="col" className="text-right">On time</th><th scope="col" className="text-right">Avg days to complete</th>
                </tr>
              </thead>
              <tbody>
                {d.workload.map((w) => (
                  <tr key={w.user_id}>
                    <td><Link href={`/tasks?assignee=${w.user_id}&view=open`}>{w.full_name}</Link></td>
                    <td className="text-right tabular-nums">{w.open}</td>
                    <td className="text-right tabular-nums">{w.high_priority_open}</td>
                    <td className={`text-right tabular-nums ${w.overdue_internal ? 'font-semibold text-red-700' : ''}`}>{w.overdue_internal}</td>
                    <td className="text-right tabular-nums">{w.waiting_external}</td>
                    <td className="text-right tabular-nums">{w.due_this_week}</td>
                    <td className="text-right tabular-nums">{w.completed_period}</td>
                    <td className="text-right tabular-nums">{w.completed_period ? `${Math.round((w.completed_on_time / w.completed_period) * 100)}%` : '—'}</td>
                    <td className="text-right tabular-nums">{w.avg_completion_days ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint px-4 pb-3">Completed and on-time figures cover the selected date range (default: last 30 days). These indicators describe workload; they do not account for task complexity and should be read together with external delays.</p>
      </Card>
    </>
  )
}

function DashboardFilters({ sp, lookups, staff }: { sp: SP; lookups: Lookups; staff: { id: string; full_name: string }[] }) {
  const uniqueStaff = [...new Map(staff.map((s) => [s.id, s])).values()]
  return (
    <form className="card mb-6 grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-7" method="get">
      <div><label className="label" htmlFor="from">Registered from</label><input className="input" type="date" id="from" name="from" defaultValue={sp.from} /></div>
      <div><label className="label" htmlFor="to">Registered to</label><input className="input" type="date" id="to" name="to" defaultValue={sp.to} /></div>
      <div><label className="label" htmlFor="country">Destination</label>
        <select className="input" id="country" name="country" defaultValue={sp.country ?? ''}><option value="">All</option>{lookups.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label" htmlFor="course">Course</label>
        <select className="input" id="course" name="course" defaultValue={sp.course ?? ''}><option value="">All</option>{lookups.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label" htmlFor="stage">Stage</label>
        <select className="input" id="stage" name="stage" defaultValue={sp.stage ?? ''}><option value="">All</option>{lookups.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></div>
      <div><label className="label" htmlFor="staff">Staff member</label>
        <select className="input" id="staff" name="staff" defaultValue={sp.staff ?? ''}><option value="">All</option>{uniqueStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
      <div className="col-span-2 flex items-end gap-2 md:col-span-1">
        <button className="btn-primary" type="submit">Apply</button>
        <Link href="/" className="btn-ghost">Reset</Link>
      </div>
    </form>
  )
}
