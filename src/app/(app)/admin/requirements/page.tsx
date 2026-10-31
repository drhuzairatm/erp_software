import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate } from '@/components/format'
import { DISPLAY, LevelChip } from '@/components/notice'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { CATEGORIES, PRIORITIES, canManageRequirements, listRequirements } from '@/server/services/requirements'

export const metadata: Metadata = { title: 'Country-wise requirements' }

export default async function RequirementsPage() {
  const ctx = await requireUser()
  if (!canManageRequirements(ctx)) return <PageHeader title="Country-wise requirements" description="You do not have access to this page." />
  const rows = await listRequirements(ctx)
  return (
    <>
      <PageHeader title="Country-wise requirements" description="Academic and other requirement notices shown to staff for each destination."
        actions={<Link className="btn-primary" href="/admin/requirements/new">New requirement</Link>} />
      <div className="mb-4"><Alert tone="blue">These notices are <strong>advisory</strong>: staff see them, can be asked to acknowledge them, and the student&apos;s marks are compared —
        but they never block or reject an application. Countries without a configured requirement show nothing (no thresholds are assumed).</Alert></div>
      <Card padded={false}>
        {rows.length === 0 ? <EmptyState title="No requirements configured" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Requirement</th><th>Country</th><th>Display</th><th>Priority</th><th>Effective</th><th>Status</th><th>Last updated</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={r.status === 'active' ? '' : 'opacity-60'}>
                <td><Link className="font-medium" href={`/admin/requirements/${r.notice_group_id}`}>{r.title}</Link>
                  <div className="text-xs text-slate-500">{CATEGORIES[r.category as keyof typeof CATEGORIES]} · v{r.version}{r.items.length ? ` · ${r.items.map((i) => `${i.subject_name} ${i.min_percentage != null ? Number(i.min_percentage) + '%' : i.min_marks}`).join(', ')}` : ''}</div></td>
                <td>{r.country}{(r.university || r.course) && <div className="text-xs text-slate-500">{[r.university, r.course].filter(Boolean).join(' · ')}</div>}</td>
                <td><LevelChip level={DISPLAY[r.display_type].level} label={DISPLAY[r.display_type].label} /></td>
                <td>{PRIORITIES[r.priority as keyof typeof PRIORITIES]}</td>
                <td className="whitespace-nowrap text-xs">{fmtDate(r.effective_from)}{r.effective_to ? ` – ${fmtDate(r.effective_to)}` : ' onwards'}</td>
                <td><Badge tone={r.status === 'active' ? 'green' : 'slate'}>{r.status}</Badge></td>
                <td className="text-xs">{r.updated_by ?? 'System'}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  )
}
