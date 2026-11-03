import type { Metadata } from 'next'
import { fmtDateTime } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getLookups } from '@/server/services/lookups'
import { listRequests } from '@/server/services/master-data'
import { DecideForm, RequestForm } from '../forms'

export const metadata: Metadata = { title: 'Master data requests' }

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const [rows, l] = await Promise.all([listRequests(ctx), getLookups(ctx)])
  const perm = { country: 'countries.manage', university: 'universities.manage', course: 'courses.manage' } as const
  return (
    <>
      <PageHeader title="Requests for missing master data" description="Can't find a country, university or course? Ask for it here – staff never create master data directly." />
      <Card title="New request" className="mb-5"><RequestForm defaultKind={sp.kind} countries={l.countries.filter((c) => c.is_destination).map((c) => ({ value: c.id, label: c.name }))} /></Card>
      <Card title="Requests" padded={false}>
        {rows.length === 0 ? <EmptyState title="No requests" /> : (
          <ul className="divide-y divide-slate-100">{rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
              <div><p className="font-medium">{r.name} <span className="text-xs font-normal text-slate-500">({r.kind}{r.country ? ` in ${r.country}` : ''})</span>{' '}
                <Badge tone={r.status === 'pending' ? 'amber' : r.status === 'approved' ? 'green' : 'red'}>{r.status}</Badge></p>
                <p className="text-xs text-slate-500">Requested by {r.requested_by_name} · {fmtDateTime(r.requested_at)}{r.details && ` · ${r.details}`}</p>
                {r.decided_at && <p className="text-xs text-slate-500">{r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.decided_by_name} · {fmtDateTime(r.decided_at)}{r.decision_note && ` · ${r.decision_note}`}</p>}</div>
              {r.status === 'pending' && can(ctx, perm[r.kind]) && <DecideForm id={r.id} kind={r.kind} />}
            </li>))}</ul>
        )}
      </Card>
    </>
  )
}
