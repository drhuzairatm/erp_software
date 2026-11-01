import type { Metadata } from 'next'
import { fmtDateTime, label } from '@/components/format'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { canSeeMasterData, masterDataHistory } from '@/server/services/master-data'

export const metadata: Metadata = { title: 'Master data history' }

const SKIP = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']
function changes(b: unknown, a: unknown) {
  const x = (b ?? {}) as Record<string, unknown>; const y = (a ?? {}) as Record<string, unknown>
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => !SKIP.includes(k) && JSON.stringify(x[k]) !== JSON.stringify(y[k]))
    .slice(0, 6).map((k) => `${k}: ${x[k] === undefined ? '' : JSON.stringify(x[k]) + ' → '}${JSON.stringify(y[k] ?? null)}`)
}

export default async function HistoryPage() {
  const ctx = await requireUser()
  if (!canSeeMasterData(ctx)) return <PageHeader title="Master data history" description="You do not have access to master data." />
  const rows = await masterDataHistory(ctx)
  return (
    <>
      <PageHeader title="Master Data Audit History" description="Countries, universities, courses, offerings, requirements, workflows, rules and master-data permissions – who changed what, when." />
      <Card padded={false}>
        {rows.length === 0 ? <EmptyState title="No changes yet" /> : (
          <ul className="divide-y divide-slate-100">{rows.map((r) => (
            <li key={r.id} className="px-4 py-2.5 text-sm"><p><span className="font-medium">{r.actor ?? 'System'}</span> · {label(r.action)} · {label(r.entity_type)}
              <span className="text-xs text-slate-500"> · {fmtDateTime(r.occurred_at)}</span></p>
              {changes(r.before_data, r.after_data).map((c, i) => <p key={i} className="break-all font-mono text-[11px] text-slate-600">{c}</p>)}</li>))}</ul>
        )}
      </Card>
    </>
  )
}
