import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, fmtDateTime } from '@/components/format'
import { Alert, Badge, Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canApproveRoutes, canManageRoutes, getRoute } from '@/server/services/attestation'
import { describe } from '@/lib/conditions'
import { conditionOptions, namesOf } from '@/server/services/rules'
import { routeOptions } from '../options'
import { AddStageForm, ApproveRouteButton, DeleteRouteDraftButton, NewRouteVersionButton, RouteForm, StageButtons } from '../route-forms'

export const metadata: Metadata = { title: 'Attestation route' }

export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireUser()
  const [data, condOptions] = await Promise.all([getRoute(ctx, id), conditionOptions(ctx)])
  if (!data) notFound()
  const { route: r } = data
  const draft = r.status === 'draft'
  const manage = canManageRoutes(ctx)
  const options = await routeOptions(ctx)
  return (
    <>
      <PageHeader title={r.name} back={{ href: '/admin/attestation-routes', label: 'Attestation routes' }}
        description={<span className="flex flex-wrap items-center gap-2">Version {r.version} <Badge tone={draft ? 'amber' : r.status === 'approved' ? 'green' : 'slate'}>{r.status}</Badge>
          {r.status === 'approved' && <span>effective {fmtDate(r.effective_from)} · approved by {r.approved_by_name} {fmtDateTime(r.approved_at)}</span>}</span>}
        actions={<>{draft && canApproveRoutes(ctx) && <ApproveRouteButton id={r.id} />}{r.status === 'approved' && manage && <NewRouteVersionButton id={r.id} />}
          {draft && manage && <DeleteRouteDraftButton id={r.id} />}</>} />
      {draft && !canApproveRoutes(ctx) && <div className="mb-4"><Alert tone="amber">This draft has no effect until the MD approves it.</Alert></div>}
      {data.usage > 0 && <div className="mb-4"><Alert tone="blue">{data.usage} attestation(s) used this version; they keep their own copy of its stages.</Alert></div>}
      <div className="space-y-6">
        <Card title="Applies to">
          <RouteForm id={r.id} readOnly={!draft || !manage} options={options} condOptions={condOptions}
            conditions={r.conditions} conditionsText={describe(r.conditions, namesOf(condOptions))} initial={{
            name: r.name, description: r.description, routeType: r.route_type, destinationCountryId: r.destination_country_id, issuingCountryId: r.issuing_country_id,
            documentTypeId: r.document_type_id, visaApplicationCountryId: r.visa_application_country_id, previousEducationCountryId: r.previous_education_country_id,
            universityId: r.university_id, sourceNote: r.source_note }} />
        </Card>
        <Card title="Stages (in order)" padded={false}>
          {data.stages.length === 0 ? <p className="p-4 text-sm text-slate-500">No stages yet.</p> : (
            <ol className="divide-y divide-slate-100">{data.stages.map((s, i) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 p-4 text-sm">
                <div><p className="font-medium">{i + 1}. {s.name} {!s.is_mandatory && <span className="text-xs font-normal text-slate-500">(optional)</span>}</p>
                  <p className="text-xs text-slate-600">{[s.authority, s.responsible_department && `Dept: ${s.responsible_department}`, s.expected_days != null && `~${s.expected_days} days`,
                    s.requires_reference && 'reference required', s.requires_supporting_file && 'supporting document required'].filter(Boolean).join(' · ')}</p>
                  {s.guidance && <p className="text-xs text-slate-600">{s.guidance}</p>}</div>
                {draft && manage && <StageButtons routeId={r.id} stageId={s.id} />}
              </li>))}
            </ol>
          )}
          {draft && manage && <div className="border-t border-slate-100 p-4"><AddStageForm routeId={r.id} options={options} /></div>}
        </Card>
        <Card title="Versions"><ul className="space-y-1 text-sm">{data.versions.map((v) => (
          <li key={v.id}><Link href={`/admin/attestation-routes/${v.id}`}>Version {v.version}</Link> · {v.status}{v.effective_from && ` · ${fmtDate(v.effective_from)}${v.effective_to ? ` – ${fmtDate(v.effective_to)}` : ' onwards'}`}{v.id === r.id && ' (this)'}</li>))}
        </ul></Card>
      </div>
    </>
  )
}
