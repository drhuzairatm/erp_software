import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate, label } from '@/components/format'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canApproveRoutes, canManageRoutes, listAuthorities, listRoutes } from '@/server/services/attestation'
import { getLookups } from '@/server/services/lookups'
import { AddAuthorityForm, ToggleAuthority } from './route-forms'

export const metadata: Metadata = { title: 'Attestation routes' }
const TONE = { draft: 'amber', approved: 'green', retired: 'slate' } as const

export default async function RoutesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireUser()
  if (!canManageRoutes(ctx) && !canApproveRoutes(ctx)) return <PageHeader title="Attestation routes" description="You do not have access to attestation configuration." />
  const { status } = await searchParams
  const [routes, auths, lookups] = await Promise.all([listRoutes(ctx, { status }), listAuthorities(ctx), getLookups(ctx)])
  return (
    <>
      <PageHeader title="Attestation & apostille routes" description="Which authorities a document must pass through, by destination, issuing country and document type."
        actions={canManageRoutes(ctx) && <Link className="btn-primary" href="/admin/attestation-routes/new">New route</Link>} />
      <div className="mb-4"><Alert tone="amber">Routes describe your business procedures; they are not legal advice. A route takes effect only after the MD approves it,
        and approved routes cannot be edited (create a new version). Routes marked [TO CONFIRM] were set up from your brief for testing and must be confirmed.</Alert></div>
      <p className="mb-2 text-sm"><Link href={status === 'all' ? '?' : '?status=all'}>{status === 'all' ? 'Hide retired versions' : 'Show retired versions'}</Link></p>
      <Card padded={false} className="mb-6">
        {routes.length === 0 ? <EmptyState title="No routes yet" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Route</th><th>Destination</th><th>Applies to</th><th className="text-right">Stages</th><th>Status</th></tr></thead>
            <tbody>{routes.map((r) => (
              <tr key={r.id} className={r.status === 'retired' ? 'opacity-60' : ''}>
                <td><Link className="font-medium" href={`/admin/attestation-routes/${r.id}`}>{r.name}</Link><div className="text-xs text-slate-500">v{r.version} · {label(r.route_type)}</div></td>
                <td>{r.destination}</td>
                <td className="text-xs">{[r.issuing_country && `issued in ${r.issuing_country}`, r.document_type, r.visa_application_country && `visa applied in ${r.visa_application_country}`,
                  r.previous_education_country && `educated in ${r.previous_education_country}`, r.university].filter(Boolean).join(' · ') || 'All documents'}</td>
                <td className="text-right tabular-nums">{r.stages}</td>
                <td><Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge>{r.status === 'approved' && <div className="text-xs text-slate-500">since {fmtDate(r.effective_from)}</div>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      <Card title="Authorities">
        <ul className="mb-4 grid grid-cols-1 gap-x-6 md:grid-cols-2">{auths.map((a) => (
          <li key={a.id} className={`flex items-center justify-between py-1 text-sm ${a.is_active ? '' : 'text-slate-400'}`}>
            <span>{a.name} <span className="text-xs text-slate-500">· {a.country ?? 'any country'} · {label(a.kind)}</span></span>
            {canManageRoutes(ctx) && <ToggleAuthority id={a.id} active={a.is_active} />}
          </li>))}
        </ul>
        {canManageRoutes(ctx) && <AddAuthorityForm countries={lookups.countries.map((c) => ({ value: c.id, label: c.name }))} />}
      </Card>
    </>
  )
}
