import type { Metadata } from 'next'
import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { exportAllowed, reportsFor } from '@/server/services/reports'
import { getScope } from '@/server/scope'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage() {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  const reports = reportsFor(ctx, scope.orgIds)
  if (!reports.length) return <PageHeader title="Reports" description="You do not have access to reports." />
  return (
    <>
      <PageHeader title="Reports" description={`${scope.label} · reports include only records you are permitted to see.`} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <Card key={r.key} title={<Link href={`/reports/${r.key}`}>{r.title}</Link>}>
            <p className="text-sm text-slate-600">{r.description}</p>
            <p className="mt-2 text-xs text-slate-500">{exportAllowed(ctx, scope.orgIds, r) ? 'CSV export available' : 'View only'}{r.pii ? ' · contains contact details' : ''}{r.finance ? ' · financial' : ''}</p>
          </Card>
        ))}
      </div>
    </>
  )
}
