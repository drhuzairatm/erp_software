import type { Metadata } from 'next'
import Link from 'next/link'
import { Icon } from '@/components/icons'
import { PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { exportAllowed, reportsFor } from '@/services/reports'
import { getScope } from '@/services/scope'

export const metadata: Metadata = { title: 'Reports' }

const GROUPS: { title: string; icon: string; tone: string; keys: string[] }[] = [
  { title: 'Students & admissions', icon: 'students', tone: 'bg-blue-50 text-blue-600', keys: ['active-by-company', 'by-country-university', 'by-stage', 'student-list', 'leads'] },
  { title: 'Documents & compliance', icon: 'doc', tone: 'bg-violet-50 text-violet-600', keys: ['documents', 'pending-acknowledgements', 'passport-expiry', 'attestation', 'courier'] },
  { title: 'Work & follow-up', icon: 'tasks', tone: 'bg-amber-50 text-amber-600', keys: ['overdue-tasks', 'awaiting-external'] },
  { title: 'Finance', icon: 'wallet', tone: 'bg-emerald-50 text-emerald-600', keys: ['balances'] },
]

export default async function ReportsPage() {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  const reports = reportsFor(ctx, scope.orgIds)
  if (!reports.length) return <PageHeader title="Reports" description="You do not have access to reports." />
  const grouped = GROUPS.map((g) => ({ ...g, reports: reports.filter((r) => g.keys.includes(r.key)) }))
  const other = reports.filter((r) => !GROUPS.some((g) => g.keys.includes(r.key)))
  if (other.length) grouped.push({ title: 'Other', icon: 'reports', tone: 'bg-slate-100 text-slate-600', keys: [], reports: other })
  return (
    <>
      <PageHeader title="Reports" description={`${scope.label} · reports include only records you are permitted to see.`} />
      <div className="space-y-8">
        {grouped.filter((g) => g.reports.length).map((g) => (
          <section key={g.title} aria-labelledby={`rg-${g.icon}`}>
            <h2 id={`rg-${g.icon}`} className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span aria-hidden className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${g.tone}`}><Icon name={g.icon} className="h-4 w-4" /></span>{g.title}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {g.reports.map((r) => {
                const exp = exportAllowed(ctx, scope.orgIds, r)
                return (
                  <Link key={r.key} href={`/reports/${r.key}`}
                    className="card group flex flex-col p-5 text-slate-900 no-underline transition hover:-translate-y-0.5 hover:no-underline hover:shadow-md hover:ring-1 hover:ring-brand-200">
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-[15px] font-semibold group-hover:text-brand-700">{r.title}</span>
                      <span aria-hidden className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500">→</span>
                    </span>
                    <span className="mt-1.5 flex-1 text-sm text-slate-600">{r.description}</span>
                    <span className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
                      <span className={`rounded-full px-2 py-0.5 ${exp ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{exp ? 'CSV export available' : 'View only'}</span>
                      {r.pii && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">contains contact details</span>}
                      {r.finance && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">financial</span>}
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
