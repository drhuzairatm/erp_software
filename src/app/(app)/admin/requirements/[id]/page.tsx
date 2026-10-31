import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { fmtDate, fmtDateTime } from '@/components/format'
import { DISPLAY, NoticeCard } from '@/components/notice'
import { Alert, Badge, Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canManageRequirements, getRequirement } from '@/server/services/requirements'
import { RequirementForm, StatusForm } from '../forms'
import { requirementOptions } from '../options'

export const metadata: Metadata = { title: 'Requirement' }
const ACTION: Record<string, string> = { created: 'Created', edited: 'Edited (new version)', activated: 'Activated', deactivated: 'Deactivated' }

export default async function RequirementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const ctx = await requireUser()
  if (!canManageRequirements(ctx)) return <PageHeader title="Requirement" description="You do not have access to this page." />
  const data = await getRequirement(ctx, id)
  if (!data) notFound()
  const c = data.current
  const d = DISPLAY[c.display_type]
  return (
    <>
      <PageHeader title={c.title} back={{ href: '/admin/requirements', label: 'Country-wise requirements' }}
        description={<span className="flex flex-wrap items-center gap-2">{c.country} · version {c.version} <Badge tone={c.status === 'active' ? 'green' : 'slate'}>{c.status}</Badge>
          · effective {fmtDate(c.effective_from)}{c.effective_to && ` – ${fmtDate(c.effective_to)}`} · last updated by {c.updated_by ?? 'System'}</span>} />
      {sp.saved && <div className="mb-4"><Alert tone="green">Saved.</Alert></div>}
      <div className="space-y-6">
        <Card title="Preview (as staff see it)">
          <NoticeCard level={d.level} label={d.label} title={c.title}>
            <p>{c.message}</p>
            {c.items.length > 0 && <ul className="mt-2 list-inside list-disc">{c.items.map((i) => <li key={i.subject_name + i.record_kind}>{i.subject_name}: minimum {i.min_percentage != null ? `${Number(i.min_percentage)}%` : `${Number(i.min_marks)} marks`}</li>)}</ul>}
          </NoticeCard>
          <p className="hint mt-2">{data.acknowledgements} acknowledgement(s) recorded across all versions.</p>
        </Card>
        <Card title={c.status === 'active' ? 'Deactivate' : 'Activate'}><StatusForm groupId={id} active={c.status === 'active'} /></Card>
        <Card title="Edit (saves a new version)">
          <RequirementForm groupId={id} {...await requirementOptions(ctx)} initial={{ ...c, effective_from: c.effective_from, items: c.items }} />
        </Card>
        <Card title="Change and approval history" padded={false}>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Action</th><th>Version</th><th>By</th><th>Reason</th><th>Previous → new</th></tr></thead>
            <tbody>{data.events.map((e) => {
              const prev = e.previous as { title?: string; items?: { subject_name: string; min_percentage: number | null }[] } | null
              const cur = e.current as { title?: string; items?: { subject_name: string; min_percentage: number | null }[] } | null
              const fmt = (x: typeof cur) => x?.items?.map((i) => `${i.subject_name} ${i.min_percentage ?? ''}%`).join(', ') || x?.title || ''
              return (
                <tr key={e.id}><td className="whitespace-nowrap">{fmtDateTime(e.occurred_at)}</td><td>{ACTION[e.action]}</td><td>v{e.version}</td><td>{e.actor ?? 'System'}</td>
                  <td className="text-xs">{e.reason}</td><td className="text-xs">{prev ? <>{fmt(prev)} → {fmt(cur)}</> : fmt(cur)}</td></tr>
              )
            })}</tbody>
          </table></div>
        </Card>
      </div>
    </>
  )
}
