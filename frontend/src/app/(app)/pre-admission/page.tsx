import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate } from '@/components/format'
import { Alert, Badge, Card, EmptyState, PageHeader, Pagination } from '@/components/ui'
import { canAny } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { DVR_STATUSES, dvrOrgs, listDvr } from '@/services/dvr'
import { getLookups } from '@/services/lookups'
import { getScope } from '@/services/scope'
import { DvrResult, DvrStatus, dvrStatusText } from './shared'

export const metadata: Metadata = { title: 'Pre-admission verification' }

export default async function PreAdmissionPage({ searchParams }: { searchParams: Promise<{ view?: string; status?: string; country?: string; q?: string; page?: string }> }) {
  const ctx = await requireUser()
  if (!canAny(ctx, ['dvr.create', 'dvr.review', 'dvr.manage'])) notFound()
  const sp = await searchParams
  const scope = await getScope(ctx)
  const [data, lookups] = await Promise.all([listDvr(ctx, scope.orgIds, sp), getLookups(ctx)])
  const orgs = dvrOrgs(ctx)
  const canCreate = orgs.create.length > 0
  const canReview = orgs.review.length > 0
  return (
    <>
      <PageHeader title="Pre-admission verification" description="Document checks before registration. No student record is created."
        actions={canCreate ? <Link className="btn-primary" href="/pre-admission/new">New request</Link> : undefined} />
      <Alert tone="blue">Results here are a preliminary assessment, not a guarantee of admission or a visa.</Alert>
      <form className="my-4 flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="pq">Search name or DVR number</label><input className="input" id="pq" name="q" defaultValue={sp.q} /></div>
        <div><label className="label" htmlFor="pv">Show</label><select className="input" id="pv" name="view" defaultValue={sp.view ?? ''}><option value="">All I can see</option>{canCreate && <option value="mine">Raised by me</option>}{canReview && <option value="assigned">Assigned to me</option>}{canReview && <option value="unassigned">Waiting for a reviewer</option>}</select></div>
        <div><label className="label" htmlFor="ps">Status</label><select className="input" id="ps" name="status" defaultValue={sp.status ?? ''}><option value="">Any</option>{DVR_STATUSES.map((s) => <option key={s} value={s}>{dvrStatusText(s)}</option>)}</select></div>
        <div><label className="label" htmlFor="pc">Country</label><select className="input" id="pc" name="country" defaultValue={sp.country ?? ''}><option value="">Any</option>{lookups.countries.filter((c) => c.is_destination).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn-primary">Apply</button>
      </form>
      <Card>
        {data.rows.length === 0 ? <EmptyState title="No verification requests" /> : <ul className="divide-y divide-slate-100">{data.rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="min-w-0"><Link className="font-medium wrap-anywhere" href={`/pre-admission/${r.id}`}><span className="font-mono">{r.dvr_number}</span> · {r.prospect_name}</Link>
              <span className="block text-xs text-slate-500 wrap-anywhere">{r.org_name} · {[r.country, r.university, r.programme, r.intake].filter(Boolean).join(' · ')}</span>
              <span className="block text-xs text-slate-500">Counsellor {r.counsellor ?? 'Unknown'} · {r.reviewer ? `reviewer ${r.reviewer}` : 'no reviewer yet'} · {fmtDate(r.created_at)}</span></span>
            <span className="flex flex-wrap items-center gap-2">{r.reverification_required && <Badge tone="amber">Re-verification needed</Badge>}{r.overall_result && <DvrResult result={r.overall_result} />}<DvrStatus status={r.status} /></span>
          </li>))}</ul>}
      </Card>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} params={{ view: sp.view, status: sp.status, country: sp.country, q: sp.q }} />
    </>
  )
}
