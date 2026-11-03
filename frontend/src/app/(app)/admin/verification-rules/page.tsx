import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate } from '@/components/format'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { canApproveRules, canManageRules, listRules } from '@/services/verification-rules'

export const metadata: Metadata = { title: 'Verification rules' }

const TONE = { draft: 'amber', approved: 'green', retired: 'slate' } as const

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireUser()
  if (!canManageRules(ctx) && !canApproveRules(ctx)) return <PageHeader title="Verification rules" description="You do not have access to verification rules." />
  const { status } = await searchParams
  const rules = await listRules(ctx, { status })
  return (
    <>
      <PageHeader title="Document verification rules" description="Mandatory wording and checks that documentation staff must confirm before a document can be approved."
        actions={canManageRules(ctx) && <Link href="/admin/verification-rules/new" className="btn-primary">New rule</Link>} />
      <div className="mb-4"><Alert tone="amber">Rules take effect only after the MD approves them. Approved rules cannot be edited — create a new version; past verifications keep the version they were checked against.
        Rules marked [PLACEHOLDER] contain example wording and must be replaced with the approved wording.</Alert></div>
      <p className="mb-2 text-sm"><Link href={status === 'all' ? '?' : '?status=all'}>{status === 'all' ? 'Hide retired versions' : 'Show retired versions'}</Link></p>
      <Card padded={false}>
        {rules.length === 0 ? <EmptyState title="No rules yet" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Rule</th><th>Document</th><th>Applies to</th><th className="text-right">Checks</th><th>Status</th></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.id} className={r.status === 'retired' ? 'opacity-60' : ''}>
                <td><Link href={`/admin/verification-rules/${r.id}`} className="font-medium">{r.name}</Link><div className="text-xs text-slate-500">version {r.version}</div></td>
                <td>{r.document_type}</td>
                <td className="text-xs">{[r.previous_education_country && `educated in ${r.previous_education_country}`, r.destination_country && `going to ${r.destination_country}`,
                  r.university, r.course].filter(Boolean).join(' · ') || 'All students'}</td>
                <td className="text-right tabular-nums">{r.requirements}</td>
                <td><Badge tone={TONE[r.status as keyof typeof TONE]}>{r.status}</Badge>
                  {r.status === 'approved' && <div className="text-xs text-slate-500">since {fmtDate(r.effective_from)}{r.approved_by_name ? ` · ${r.approved_by_name}` : ''}</div>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  )
}
