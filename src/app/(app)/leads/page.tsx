import type { Metadata } from 'next'
import Link from 'next/link'
import { HBarList } from '@/components/charts'
import { fmtDate } from '@/components/format'
import { Icon } from '@/components/icons'
import { Avatar, Badge, Card, EmptyState, FilterBar, PageHeader, Pagination, StatCard, ViewTabs } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { canReviewLeads, canSeeLeads, LEAD_STATUSES, listLeads, PROGRAMMES, SOURCES } from '@/server/services/leads'
import { getScope } from '@/server/scope'

export const metadata: Metadata = { title: 'Leads' }

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  if (!canSeeLeads(ctx)) return <PageHeader title="Leads" description="You do not have access to leads." />
  const sp = await searchParams
  const scope = await getScope(ctx)
  const review = canReviewLeads(ctx)
  const view = sp.view ?? 'open'
  const data = await listLeads(ctx, scope.orgIds, { ...sp, view })
  const canManage = scope.orgIds.some((o) => can(ctx, 'leads.manage', o)) || review
  const qs = (over: Record<string, string | undefined>) => '?' + new URLSearchParams(Object.entries({ ...sp, page: undefined, ...over } as Record<string, string | undefined>)
    .filter((x): x is [string, string] => !!x[1])).toString()
  const k = data.kpis
  const views = [['open', 'Open', k.open], ['followup', 'Follow-up due', k.followup], ['referrals', 'Referrals'], ['converted', 'Converted'], ['all', 'All']] as [string, string, number?][]
  if (review) views.push(['review', 'Central review queue', k.review], ['duplicates', 'Possible duplicates', k.duplicates])
  return (
    <>
      <PageHeader title="Leads" description={`${scope.label} · enquiries before registration, including referrals and Leadist imports. Duplicates are flagged, never merged.`}
        actions={canManage && <>
          <Link className="btn-secondary" href="/leads/import"><Icon name="upload" className="h-4 w-4" />Import (Leadist / CSV)</Link>
          <Link className="btn-primary" href="/leads/new"><Icon name="plus" className="h-4 w-4" />New lead</Link></>} />
      <section aria-label="Lead summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="New leads" value={k.new} tone="blue" icon={<Icon name="flag" className="h-5 w-5" />} />
        <StatCard label="Follow-ups due" value={k.followup} tone={k.overdue ? 'red' : 'amber'} icon={<Icon name="clock" className="h-5 w-5" />} sub={k.overdue ? `${k.overdue} overdue` : undefined} href={qs({ view: 'followup' })} />
        <StatCard label="Converted (30 days)" value={k.converted_30} tone="green" icon={<Icon name="check" className="h-5 w-5" />} href={qs({ view: 'converted' })} />
        <StatCard label="Referrals (30 days)" value={k.referrals_30} tone="purple" icon={<Icon name="students" className="h-5 w-5" />} href={qs({ view: 'referrals' })} />
        {review ? <StatCard label="Central review queue" value={k.review} tone={k.review ? 'orange' : 'slate'} icon={<Icon name="globe" className="h-5 w-5" />} href={qs({ view: 'review' })} />
          : <StatCard label="Open leads" value={k.open} tone="slate" icon={<Icon name="tasks" className="h-5 w-5" />} />}
      </section>
      <ViewTabs label="Lead views" items={views.map(([key, l, n]) => ({ href: qs({ view: key }), label: l, active: view === key, count: n, alert: key === 'duplicates' || key === 'review' }))} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <FilterBar>
            <input type="hidden" name="view" value={view} />
            <div><label className="label" htmlFor="q">Search</label><input className="input" id="q" name="q" defaultValue={sp.q} placeholder="Name, phone or email" /></div>
            <div><label className="label" htmlFor="status">Status</label>
              <select className="input" id="status" name="status" defaultValue={sp.status ?? ''}><option value="">Any</option>{Object.entries(LEAD_STATUSES).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}</select></div>
            <div><label className="label" htmlFor="source">Source</label>
              <select className="input" id="source" name="source" defaultValue={sp.source ?? ''}><option value="">Any</option>{Object.entries(SOURCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="mine" value="yes" defaultChecked={sp.mine === 'yes'} /> Assigned to me</label>
            <button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/leads">Clear</Link>
          </FilterBar>
          <Card padded={false}>
            {data.rows.length === 0 ? <EmptyState title="No leads in this view" /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Lead</th><th>Programme</th><th>Company</th><th>Source</th><th>Status</th><th>Assigned</th><th>Follow-up</th></tr></thead>
                <tbody>{data.rows.map((l) => (
                  <tr key={l.id}>
                    <td><div className="flex items-center gap-3"><Avatar name={l.full_name} />
                      <div><Link href={`/leads/${l.id}`} className="font-semibold">{l.full_name}</Link>
                        <div className="text-xs text-slate-500">{l.phone ?? l.email}{l.duplicate_status === 'possible' && <> · <span className="font-semibold text-amber-700">possible duplicate</span></>}</div></div></div></td>
                    <td className="text-sm">{l.programme ? PROGRAMMES[l.programme as keyof typeof PROGRAMMES] : '—'}{l.destination && <div className="text-xs text-slate-500">{l.destination}</div>}</td>
                    <td>{l.org_name ? <Badge tone={l.org_name.startsWith('GRAD') ? 'purple' : 'blue'}>{l.org_name}</Badge> : <Badge tone="orange">Central queue</Badge>}</td>
                    <td className="text-xs">{SOURCES[l.source as keyof typeof SOURCES]}</td>
                    <td><Badge tone={LEAD_STATUSES[l.status].tone}>{LEAD_STATUSES[l.status].label}</Badge></td>
                    <td className="text-sm">{l.assignee ?? <span className="text-amber-700">Unassigned</span>}</td>
                    <td className={`whitespace-nowrap text-sm ${l.overdue ? 'font-semibold text-red-700' : ''}`}>{l.next_followup_on ? fmtDate(l.next_followup_on) : '—'}{l.overdue && <div className="text-xs">Overdue</div>}</td>
                  </tr>))}
                </tbody>
              </table></div>
            )}
            <Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={{ ...sp, view }} />
          </Card>
        </div>
        <Card title="Leads by source (90 days)">
          {data.bySource.length === 0 ? <p className="text-sm text-slate-500">No leads yet.</p>
            : <HBarList title="Leads by source" data={data.bySource.map((b) => ({ label: SOURCES[b.source as keyof typeof SOURCES] ?? b.source, value: b.n }))} />}
        </Card>
      </div>
    </>
  )
}
