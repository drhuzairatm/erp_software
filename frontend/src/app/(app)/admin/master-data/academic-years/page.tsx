import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { canManageYears, listAcademicYears } from '@/services/preferences'
import { YearForm, YearToggle } from './forms'

export const metadata: Metadata = { title: 'Academic years' }

export default async function AcademicYearsPage() {
  const ctx = await requireUser()
  if (!canManageYears(ctx)) notFound()
  const years = await listAcademicYears(ctx)
  return (<>
    <PageHeader title="Academic years" description="Used on student preferences. Records that used a year keep it when it is deactivated." />
    <Card><YearForm /></Card>
    <div className="mt-4"><Card>{years.length === 0 ? <EmptyState title="No academic years yet" /> : <ul className="divide-y divide-slate-100">{years.map((y) => <li key={y.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span className="font-medium">{y.code}</span><span className="flex flex-wrap items-center gap-2"><Badge tone={y.is_active ? 'green' : 'slate'}>{y.is_active ? 'Active' : 'Inactive'}</Badge><YearToggle id={y.id} code={y.code} active={y.is_active} /></span></li>)}</ul>}</Card></div>
  </>)
}
