import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { getLookups } from '@/server/services/lookups'
import { canManageUniversities, listUniversities } from '@/server/services/universities'
import { UniversityForm } from './university-forms'

export const metadata: Metadata = { title: 'Universities' }

export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<{ country?: string; q?: string; inactive?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const [rows, lookups] = await Promise.all([listUniversities(ctx, sp), getLookups(ctx)])
  const manage = canManageUniversities(ctx)
  const destinations = lookups.countries.filter((c) => c.is_destination)
  return (
    <>
      <PageHeader title="Universities" description="Universities, campuses, courses, intakes and the documents each university requires." />
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div><label className="label" htmlFor="q">Search</label><input className="input" id="q" name="q" defaultValue={sp.q} /></div>
        <div><label className="label" htmlFor="country">Country</label>
          <select className="input" id="country" name="country" defaultValue={sp.country ?? ''}><option value="">All</option>{destinations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {manage && <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="inactive" value="yes" defaultChecked={sp.inactive === 'yes'} /> Include deactivated</label>}
        <button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/universities">Clear</Link>
      </form>
      <Card padded={false}>
        {rows.length === 0 ? <EmptyState title="No universities" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>University</th><th>Country</th><th>Courses</th><th className="text-right">Campuses</th><th>Next deadline</th><th className="text-right">Document rules</th><th className="text-right">Active students</th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                <td><Link href={`/universities/${u.id}`} className="font-medium">{u.name}</Link>{!u.is_active && <> <Badge>Deactivated</Badge></>}<div className="text-xs text-slate-500">{u.city}</div></td>
                <td>{u.country}</td>
                <td className="text-xs">{u.courses.join(', ') || '—'}</td>
                <td className="text-right tabular-nums">{u.campuses}</td>
                <td>{u.next_deadline ? fmtDate(u.next_deadline) : '—'}</td>
                <td className="text-right tabular-nums">{u.doc_reqs}</td>
                <td className="text-right tabular-nums">{u.students}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {manage && (
        <Card title="Add a university" className="mt-6">
          <UniversityForm id={null} countries={destinations.map((c) => ({ value: c.id, label: c.name }))} />
        </Card>
      )}
    </>
  )
}
