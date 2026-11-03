import type { Metadata } from 'next'
import Link from 'next/link'
import { BarChart, DonutChart, HBarList, LineChart, PALETTE, RadialProgress, Sparkline } from '@/components/charts'
import { PriorityAttention } from '@/components/dashboard/priority-attention'
import { fmtDate, fmtDateTime, fmtMoney, label } from '@/components/format'
import { Icon } from '@/components/icons'
import { Alert, Avatar, Badge, Card, EmptyState, StatCard, studentPhotoUrl } from '@/components/ui'
import { BRANDS, brandOf } from '@/lib/brands'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { managementAnalytics, staffOverview } from '@/services/analytics'
import type { Ctx } from '@/services/base'
import { getDashboard } from '@/services/dashboard'
import { getLookups, type Lookups } from '@/services/lookups'
import { taskAssignees } from '@/services/tasks'
import { getScope } from '@/services/scope'

export const metadata: Metadata = { title: 'Dashboard' }

type SP = { from?: string; to?: string; country?: string; course?: string; stage?: string; staff?: string; password?: string; view?: string }

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const scope = await getScope(ctx)
  if (!scope.orgIds.some((o) => can(ctx, 'dashboard.view', o))) {
    return <Alert tone="amber" title="No dashboard access">Use the menu to open the sections available to your role.</Alert>
  }
  const consolidatedAllowed = !scope.isAll || scope.orgIds.every((o) => can(ctx, 'dashboard.consolidated', o))
  const orgIds = consolidatedAllowed ? scope.orgIds : [scope.orgIds[0]]
  const canAnalytics = orgIds.some((o) => can(ctx, 'reports.view', o))
  const leadership = ctx.memberships.some((m) => m.roleKey === 'md' || m.roleKey === 'ceo')
  const view = canAnalytics && (sp.view === 'analytics' || (!sp.view && leadership)) ? 'analytics' : 'operations'
  const current = scope.isAll ? null : ctx.memberships.find((m) => m.orgId === orgIds[0])
  const brand = brandOf(current?.orgCode ?? (ctx.memberships.length === 1 ? ctx.memberships[0].orgCode : null))
  const firstName = ctx.fullName.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0]
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const scopeLabel = scope.isAll && consolidatedAllowed ? 'Consolidated view · both companies' : (current?.orgName ?? BRANDS[brand].name)

  return (
    <>
      <h1 className="sr-only">{scope.isAll && consolidatedAllowed ? 'Consolidated dashboard' : `${current?.orgName ?? ''} dashboard`}</h1>
      <section className="bg-hero relative mb-6 overflow-hidden rounded-3xl px-6 py-6 text-white shadow-[var(--shadow-lift)] sm:px-8 sm:py-7">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -right-24 top-10 h-72 w-72 rounded-full border border-cyan-brand/20" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-brand">{scopeLabel}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{greeting}, {firstName}</p>
            <p className="mt-1 text-sm text-slate-300">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date())}
              {' · '}{view === 'analytics' ? 'Management analytics from live records' : 'Your priorities for today'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(ctx, 'students.create') && <Link href="/students/new" className="btn bg-cyan-brand text-navy-950 hover:bg-white"><Icon name="plus" className="h-4 w-4" />Register student</Link>}
            {can(ctx, 'students.create') && <Link href="/students/import" className="btn border border-white/20 bg-white/10 text-white hover:bg-white/20"><Icon name="upload" className="h-4 w-4" />Import CSV</Link>}
            <Link href="/tasks" className="btn border border-white/20 bg-white/10 text-white hover:bg-white/20"><Icon name="tasks" className="h-4 w-4" />My tasks</Link>
          </div>
        </div>
        {canAnalytics && (
          <nav aria-label="Dashboard view" className="relative mt-5 inline-flex rounded-full bg-white/10 p-1 text-sm">
            {(['operations', 'analytics'] as const).map((v) => (
              <Link key={v} href={`/?view=${v}`} aria-current={view === v ? 'page' : undefined}
                className={`rounded-full px-4 py-1.5 font-semibold no-underline hover:no-underline ${view === v ? 'bg-white text-navy-950' : 'text-slate-200 hover:text-white'}`}>
                {v === 'operations' ? 'Operations' : 'Management analytics'}</Link>))}
          </nav>
        )}
      </section>
      {sp.password === 'changed' && <div className="mb-4"><Alert tone="green">Your password has been changed.</Alert></div>}
      {scope.isAll && !consolidatedAllowed && <div className="mb-4"><Alert tone="amber">You do not have consolidated dashboard access; showing your first company only.</Alert></div>}
      {view === 'analytics' ? <Analytics ctx={ctx} orgIds={orgIds} sp={sp} /> : <Operations ctx={ctx} orgIds={orgIds} sp={sp} />}
    </>
  )
}

/* ---------------------------------------------------------------- staff operations */
async function Operations({ ctx, orgIds, sp }: { ctx: Ctx; orgIds: string[]; sp: SP }) {
  const [o, d, lookups, staff] = await Promise.all([staffOverview(ctx, orgIds), getDashboard(ctx, orgIds, sp), getLookups(ctx), taskAssignees(ctx, orgIds)])
  const f = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== 'password' && k !== 'view') as [string, string][])
  const withF = (path: string, extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(f)
    for (const [k, v] of Object.entries(extra)) q.set(k, v)
    const s = q.toString()
    return s ? `${path}?${s}` : path
  }
  const maxStage = Math.max(1, ...d.byStage.map((s) => s.count))
  const k = o.kpis
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="My assigned students" value={k.assigned} tone="blue" icon={<Icon name="students" />} href="/students?assignee=me" />
        <StatCard label="New registrations (7 days)" value={k.new_7} tone="green" icon={<Icon name="plus" />} href="/students" />
        <StatCard label="Applications in progress" value={k.applications} tone="purple" icon={<Icon name="university" />} href="/students?stage=university_application" />
        <StatCard label="Document verification queue" value={k.verify_queue} tone={k.verify_queue ? 'amber' : 'slate'} icon={<Icon name="doc" />} href="/reports/documents?status=awaiting" />
        <StatCard label="My open tasks" value={k.my_open_tasks} tone={k.my_overdue ? 'red' : 'blue'} icon={<Icon name="tasks" />} href="/tasks?mine=yes&view=open"
          sub={k.my_overdue ? `${k.my_overdue} overdue` : 'None overdue'} />
        <StatCard label="Today's follow-ups" value={k.followups_today} tone="orange" icon={<Icon name="clock" />} href="/tasks?view=today" />
        {k.payment_followups != null && <StatCard label="Payment follow-ups" value={k.payment_followups} tone="amber" icon={<Icon name="wallet" />}
          sub="Students with fees outstanding (count only)" />}
      </div>

      <PriorityAttention ctx={ctx} orgIds={orgIds} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="My students – application status" className="xl:col-span-2" padded={false}
          actions={<Link href="/students?assignee=me" className="text-sm font-medium">View all →</Link>}>
          {o.myStudents.length === 0 ? <EmptyState title="No students are assigned to you" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Student</th><th>Stage</th><th>Documents</th><th>Next action</th></tr></thead>
              <tbody>{o.myStudents.map((s) => {
                const pct = s.docs_required ? Math.round((s.docs_approved / s.docs_required) * 100) : 0
                return (
                  <tr key={s.id}>
                    <td><div className="flex items-center gap-2.5"><Avatar name={s.full_name} size="sm" src={studentPhotoUrl(s.id, s.photo_version)} /><div><Link href={`/students/${s.id}`} className="font-semibold">{s.full_name}</Link>
                      <div className="text-xs text-slate-500">{s.student_code}{s.country && ` · ${s.country}`}</div></div></div></td>
                    <td><span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">{s.stage}</span>
                      {(s.passport_status === 'expired' || s.passport_status === 'critical') && <div className="mt-1"><Badge tone="red">Passport {s.passport_status}</Badge></div>}</td>
                    <td className="min-w-32"><div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-gradient-to-r from-brand-500 to-teal-brand" style={{ width: `${pct}%` }} /></div>
                      <span className="text-xs tabular-nums text-slate-600">{s.docs_approved}/{s.docs_required}</span></div></td>
                    <td className="text-xs">{s.next_action ?? '—'}{s.next_action_due && <div className={s.next_action_due < new Date().toISOString().slice(0, 10) ? 'font-semibold text-red-700' : 'text-slate-500'}>due {fmtDate(s.next_action_due)}</div>}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Today's follow-ups">
            {o.today.length === 0 ? <p className="text-sm text-slate-500">Nothing due today. 🎉</p> : (
              <ul className="space-y-2">{o.today.map((t) => (
                <li key={t.kind + t.id}>
                  <Link href={t.kind === 'task' ? `/tasks/${t.id}` : `/students/${t.student_id}`} className="flex items-start gap-3 rounded-xl border border-slate-100 p-2.5 text-sm no-underline hover:border-brand-200 hover:bg-brand-50/40 hover:no-underline">
                    <span aria-hidden className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${t.kind === 'task' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                      <Icon name={t.kind === 'task' ? 'tasks' : 'phone'} className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{t.title}</span>
                      <span className="block text-xs text-slate-500">{t.student_name ?? 'Internal'}{t.due_date && ` · ${fmtDate(t.due_date)}`}</span></span>
                    {(t.priority === 'urgent' || t.priority === 'high') && <Badge tone="red">{t.priority}</Badge>}
                  </Link>
                </li>))}
              </ul>
            )}
          </Card>
          <Card title="Quick actions">
            <div className="grid grid-cols-2 gap-2">
              {[
                ['/students/new', 'Register student', 'plus', can(ctx, 'students.create')], ['/students', 'Find a student', 'search', true],
                ['/tasks?view=today', 'Due today', 'clock', true], ['/reports/documents?status=awaiting', 'Verify documents', 'doc', can(ctx, 'documents.review')],
                ['/reports/passport-expiry', 'Passport renewals', 'passport', can(ctx, 'reports.view')], ['/reports', 'Reports', 'reports', can(ctx, 'reports.view')],
              ].filter((x) => x[3]).map(([href, text, icon]) => (
                <Link key={href as string} href={href as string} className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm font-medium text-slate-800 no-underline transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md hover:no-underline">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-teal-brand text-white"><Icon name={icon as string} className="h-4 w-4" /></span>{text as string}</Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Recent activity" className="mt-6">
        {o.recent.length === 0 ? <p className="text-sm text-slate-500">No recent activity.</p> : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">{o.recent.map((e) => (
            <li key={e.id} className="relative text-sm">
              <span aria-hidden className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-gradient-to-br from-brand-500 to-teal-brand shadow" />
              <p><Link href={`/students/${e.student_id}`} className="font-semibold">{e.full_name}</Link> <span className="text-slate-700">{e.summary}</span></p>
              <p className="text-xs text-slate-500">{fmtDateTime(e.occurred_at)}{e.actor && ` · ${e.actor}`} · {label(e.category)}</p>
            </li>))}
          </ol>
        )}
      </Card>

      <h2 className="mb-3 mt-10 text-lg font-bold tracking-tight">Team overview</h2>
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

/* ---------------------------------------------------------------- management analytics */
async function Analytics({ ctx, orgIds, sp }: { ctx: Ctx; orgIds: string[]; sp: SP }) {
  const [a, lookups] = await Promise.all([managementAnalytics(ctx, orgIds, sp), getLookups(ctx)])
  const k = a.kpis
  const reg = a.monthly.map((m) => m.registered)
  const growth = k.new_prev ? Math.round(((k.new_period - k.new_prev) / k.new_prev) * 100) : null
  const pct = (x: number, y: number) => (y ? (x / y) * 100 : 0)
  const fin = a.finance[0]
  const stages = a.byStage.filter((s) => s.value > 0)
  const top = (rows: { label: string; value: number }[], n: number) => rows.length <= n ? rows : [...rows.slice(0, n - 1), { label: 'Other', value: rows.slice(n - 1).reduce((x, r) => x + r.value, 0) }]
  return (
    <>
      <form method="get" className="card mb-6 flex flex-wrap items-end gap-3 p-4">
        <input type="hidden" name="view" value="analytics" />
        <div><label className="label" htmlFor="a-from">From</label><input className="input" type="date" id="a-from" name="from" defaultValue={sp.from} /></div>
        <div><label className="label" htmlFor="a-to">To</label><input className="input" type="date" id="a-to" name="to" defaultValue={sp.to} /></div>
        <div><label className="label" htmlFor="a-country">Destination</label>
          <select className="input" id="a-country" name="country" defaultValue={sp.country ?? ''}><option value="">All</option>{lookups.countries.filter((c) => c.is_destination).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="a-course">Course</label>
          <select className="input" id="a-course" name="course" defaultValue={sp.course ?? ''}><option value="">All</option>{lookups.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn-primary" type="submit">Apply</button>
        <Link href="/?view=analytics" className="btn-ghost">Reset</Link>
        <p className="w-full text-xs text-slate-500">Period: {a.from ? fmtDate(a.from) : 'last 12 months'}{a.to ? ` – ${fmtDate(a.to)}` : ''}. Company: use the company selector in the menu (MD: “All my companies” for comparison).</p>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total students" value={k.total} tone="blue" icon={<Icon name="students" />} chart={<Sparkline values={reg.map((_, i) => reg.slice(0, i + 1).reduce((x, y) => x + y, 0))} color="#6C8CFF" />} sub={`${k.on_hold} on hold · ${k.cancelled} cancelled`} />
        <StatCard label="New admissions (period)" value={k.new_period} tone="green" icon={<Icon name="trend" />} chart={<Sparkline values={reg} color="#24E0B8" />}
          sub={growth == null ? 'No previous-year data' : `${growth >= 0 ? '▲' : '▼'} ${Math.abs(growth)}% vs previous 12 months`} />
        <StatCard label="Applications in progress" value={k.in_progress} tone="purple" icon={<Icon name="university" />} href="/students?status=active" />
        <StatCard label="Completed admissions" value={k.completed} tone="green" icon={<Icon name="check" />} chart={<Sparkline values={a.monthly.map((m) => m.completed)} color="#4ADE80" />} href="/students?status=completed" />
        {a.financeVisible && fin ? (
          <>
            <StatCard label={`Revenue billed (${fin.currency}, period)`} value={fmtMoney(fin.due_period, fin.currency)} tone="blue" icon={<Icon name="wallet" />} sub="Service fee charges (verified)" />
            <StatCard label={`Payments received (${fin.currency}, period)`} value={fmtMoney(fin.received_period, fin.currency)} tone="green" icon={<Icon name="payments" />}
              chart={<Sparkline values={fin.received_months} color="#24E0B8" />} sub="Verified receipts, net of refunds" />
            <StatCard label={`Outstanding (${fin.currency})`} value={fmtMoney(fin.outstanding, fin.currency)} tone="red" icon={<Icon name="wallet" />} href="/reports/balances" />
            <StatCard label={`Receipts awaiting verification (${fin.currency})`} value={fmtMoney(fin.pending, fin.currency)} tone="amber" icon={<Icon name="clock" />} href="/payments?status=pending" />
          </>
        ) : (
          <div className="card col-span-2 flex items-center gap-3 p-4 text-sm text-slate-600 lg:col-span-4"><Icon name="shield" className="h-5 w-5 text-slate-400" />
            {a.financeVisible ? 'No payments recorded yet.' : 'Revenue and payment amounts are shown to the MD and Accounts only.'}</div>
        )}
      </div>

      {a.financeVisible && a.finance.length > 0 && (
        <Card title="Fees by currency (service fees, verified)" className="mb-6" padded={false}>
          <div className="table-wrap"><table>
            <thead><tr><th>Currency</th><th className="text-right">Expected (period)</th><th className="text-right">Received (period)</th><th className="text-right">Outstanding (all time)</th><th className="text-right">Awaiting verification</th></tr></thead>
            <tbody>
              {a.finance.map((f) => (
                <tr key={f.currency}><td className="font-semibold">{f.currency}</td><td className="text-right tabular-nums">{fmtMoney(f.due_period, f.currency)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(f.received_period, f.currency)}</td><td className="text-right font-semibold tabular-nums">{fmtMoney(f.outstanding, f.currency)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(f.pending, f.currency)}</td></tr>))}
              {a.financeInr && (
                <tr className="bg-slate-50"><td className="font-semibold">Consolidated – INR equivalent</td><td className="text-right tabular-nums">{fmtMoney(a.financeInr.due_period, 'INR')}</td>
                  <td className="text-right tabular-nums">{fmtMoney(a.financeInr.received_period, 'INR')}</td><td className="text-right font-semibold tabular-nums">{fmtMoney(a.financeInr.outstanding, 'INR')}</td><td className="text-right text-xs text-slate-500">—</td></tr>
              )}
            </tbody>
          </table></div>
          <p className="hint px-4 pb-3">Each currency is shown separately; original amounts are never added together. The INR-equivalent row uses the exchange rate stored on each payment, not today&apos;s rate
            {a.financeInr && a.financeInr.missing > 0 ? ` (${a.financeInr.missing} entries without a rate are left out)` : ''}.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Monthly admissions (registrations)" className="xl:col-span-2"><BarChart title="Registrations per month, last 12 months" data={a.monthly.map((m) => ({ label: m.label, value: m.registered }))} /></Card>
        <Card title="Country-wise admissions"><DonutChart title="Students by destination" centerLabel="students" data={top(a.byCountry, 7)} /></Card>
        <Card title="Application stages"><DonutChart title="Students by stage" centerLabel="students" data={stages.map((s, i) => ({ label: s.label, value: s.value, color: s.kind === 'completed' ? '#4ADE80' : s.kind === 'cancelled' ? '#94A3B8' : s.kind === 'hold' ? '#FFB547' : PALETTE[i % 4] }))} /></Card>
        <Card title="Course-wise admissions"><HBarList title="Students by course" data={top(a.byCourse, 8)} /></Card>
        <Card title="Performance indicators">
          <div className="grid grid-cols-2 gap-4">
            <RadialProgress value={pct(k.completed, k.total)} label="Completion" sub={`${k.completed} of ${k.total}`} color="#4ADE80" size={100} />
            <RadialProgress value={pct(a.rates.docs_approved, a.rates.docs_required)} label="Required documents approved" sub="active students" color="#36D9FF" size={100} />
            <RadialProgress value={a.rates.tasks_done_30 ? 100 - pct(a.rates.tasks_late_30, a.rates.tasks_done_30) : 0} label="Tasks on time" sub="last 30 days" color="#6C8CFF" size={100} />
            <RadialProgress value={pct(k.in_progress, k.total)} label="In progress" sub={`${k.in_progress} active`} color="#FFB547" size={100} />
          </div>
        </Card>
        {a.financeVisible && fin && (
          <Card title={`Revenue trend – payments received (${fin.currency})`} className="xl:col-span-2">
            <LineChart title="Payments received per month" labels={a.monthly.map((m) => m.label)} series={[{ label: 'Received', values: fin.received_months, color: '#24E0B8' }]} />
          </Card>
        )}
        <Card title="Yearly admissions" className={a.financeVisible && fin ? '' : 'xl:col-span-3'}>
          <BarChart title="Registrations per year" color="#6C8CFF" height={200} width={a.financeVisible && fin ? 360 : 640} data={[...a.yearly].reverse().map((y) => ({ label: String(y.year), value: y.count }))} />
        </Card>
      </div>

      {a.byCompany.length > 1 && (
        <Card title="Company comparison" className="mt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{a.byCompany.map((c) => (
            <div key={c.code} className={`rounded-2xl border p-4 ${c.code === 'GRD' ? 'border-cyan-200 bg-gradient-to-br from-cyan-50 to-white' : 'border-blue-200 bg-gradient-to-br from-blue-50 to-white'}`}>
              <p className="text-sm font-bold">{c.org}</p>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[['Students', c.students], ['Active', c.active], ['Completed', c.completed], ['New (period)', c.new_period]].map(([t, v]) => (
                  <div key={t as string}><dt className="text-[11px] uppercase tracking-wide text-slate-500">{t}</dt><dd className="text-xl font-bold tabular-nums">{v}</dd></div>))}
              </dl>
            </div>))}
          </div>
        </Card>
      )}

      {a.canStaff && (
        <Card title="Staff performance (last 30 days)" className="mt-6" padded={false}>
          {a.staff.length === 0 ? <EmptyState title="No staff activity" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Staff member</th><th className="text-right">Active students</th><th className="text-right">Stage updates</th><th className="text-right">Tasks completed</th><th className="text-right">Overdue tasks</th></tr></thead>
              <tbody>{a.staff.map((s) => (
                <tr key={s.id}><td className="font-medium">{s.name}</td><td className="text-right tabular-nums">{s.students}</td><td className="text-right tabular-nums">{s.moves_30}</td>
                  <td className="text-right tabular-nums">{s.tasks_done_30}</td><td className={`text-right tabular-nums ${s.overdue ? 'font-semibold text-red-700' : ''}`}>{s.overdue}</td></tr>))}
              </tbody>
            </table></div>
          )}
          <p className="hint px-4 pb-3">Activity indicators only; read together with task complexity and external delays.</p>
        </Card>
      )}
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
