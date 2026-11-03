import type { Metadata } from 'next'
import Link from 'next/link'
import { daysFromTodayISO, fmtDate } from '@/components/format'
import { Icon } from '@/components/icons'
import { Badge, Card, EmptyState, PageHeader, StatCard } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { getLookups } from '@/services/lookups'
import { canManageUniversities, listUniversities } from '@/services/universities'
import { UniversityForm } from './university-forms'

export const metadata: Metadata = { title: 'Universities' }

export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<{ country?: string; q?: string; inactive?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const [rows, lookups] = await Promise.all([listUniversities(ctx, sp), getLookups(ctx)])
  const manage = canManageUniversities(ctx)
  const destinations = lookups.countries.filter((c) => c.is_destination)
  const soon = daysFromTodayISO(60)
  return (
    <>
      <PageHeader title="Universities" description="Universities, campuses, courses, intakes and the documents each university requires." />
      <section aria-label="University summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Universities" value={rows.filter((u) => u.is_active).length} tone="blue" icon={<Icon name="university" className="h-5 w-5" />} />
        <StatCard label="Destination countries" value={new Set(rows.map((u) => u.country)).size} tone="purple" icon={<Icon name="globe" className="h-5 w-5" />} />
        <StatCard label="Active students placed" value={rows.reduce((a, u) => a + u.students, 0)} tone="green" icon={<Icon name="students" className="h-5 w-5" />} />
        <StatCard label="Deadlines in the next 60 days" value={rows.filter((u) => u.next_deadline && u.next_deadline <= soon).length} tone="amber" icon={<Icon name="clock" className="h-5 w-5" />} />
      </section>
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div><label className="label" htmlFor="q">Search</label><input className="input" id="q" name="q" defaultValue={sp.q} /></div>
        <div><label className="label" htmlFor="country">Country</label>
          <select className="input" id="country" name="country" defaultValue={sp.country ?? ''}><option value="">All</option>{destinations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {manage && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="inactive" value="yes" defaultChecked={sp.inactive === 'yes'} /> Include deactivated</label>}
        <button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/universities">Clear</Link>
      </form>
      {rows.length === 0 ? <Card><EmptyState title="No universities" /></Card> : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((u) => (
            <li key={u.id} className={`card relative flex flex-col overflow-hidden p-5 transition hover:shadow-md ${u.is_active ? '' : 'opacity-60'}`}>
              <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 to-cyan-brand" />
              <div className="flex items-start gap-3">
                <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-950 text-cyan-brand"><Icon name="university" className="h-6 w-6" /></span>
                <div className="min-w-0">
                  <Link href={`/universities/${u.id}`} className="font-semibold text-slate-900 after:absolute after:inset-0">{u.name}</Link>
                  <p className="text-xs text-slate-500">{[u.city, u.country].filter(Boolean).join(', ')}</p>
                  {!u.is_active && <Badge>Deactivated</Badge>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {u.courses.length ? u.courses.map((c) => <span key={c} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">{c}</span>)
                  : <span className="text-xs text-slate-400">No courses recorded</span>}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                <div><dt className="text-[11px] text-slate-500">Students</dt><dd className="text-lg font-bold tabular-nums text-slate-900">{u.students}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Campuses</dt><dd className="text-lg font-bold tabular-nums text-slate-900">{u.campuses}</dd></div>
                <div><dt className="text-[11px] text-slate-500">Document rules</dt><dd className="text-lg font-bold tabular-nums text-slate-900">{u.doc_reqs}</dd></div>
              </dl>
              <p className={`mt-3 flex items-center gap-1.5 text-xs ${u.next_deadline && u.next_deadline <= soon ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>
                <Icon name="clock" className="h-3.5 w-3.5" />{u.next_deadline ? `Next application deadline ${fmtDate(u.next_deadline)}` : 'No upcoming deadline'}</p>
            </li>))}
        </ul>
      )}
      {manage && (
        <Card title="Add a university" className="mt-6">
          <UniversityForm id={null} countries={destinations.map((c) => ({ value: c.id, label: c.name }))} />
        </Card>
      )}
    </>
  )
}
