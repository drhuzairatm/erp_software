import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Avatar, Card, EmptyState, PageHeader, Pagination, ViewTabs } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { type AuditFilters, listAudit } from '@/server/services/admin'
import { getScope } from '@/server/scope'

export const metadata: Metadata = { title: 'Audit log' }

const SKIP = ['id', 'created_at', 'created_by', 'updated_by', 'updated_at']
const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** Changed fields only (before → after); falls back to the values when only one side exists. */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !SKIP.includes(k))
  const changed = before && after ? keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])) : keys
  if (!changed.length) return null
  return (
    <ul className="mt-2 space-y-0.5 rounded-lg bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700 ring-1 ring-slate-100">
      {changed.slice(0, 8).map((k) => (
        <li key={k} className="break-all"><span className="text-slate-500">{k}:</span>{' '}
          {before && after ? <><span className="text-rose-700 line-through decoration-rose-300">{show(b[k])}</span> → <span className="text-emerald-700">{show(a[k])}</span></>
            : <span>{show(after ? a[k] : b[k])}</span>}</li>))}
      {changed.length > 8 && <li className="text-slate-400">… {changed.length - 8} more field(s)</li>}
    </ul>
  )
}

const OUTCOME_DOT: Record<string, string> = { success: 'bg-emerald-500 ring-emerald-100', denied: 'bg-red-500 ring-red-100', failure: 'bg-amber-500 ring-amber-100' }

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  if (!scope.orgIds.some((o) => can(ctx, 'audit.read', o))) return <PageHeader title="Audit log" description="You do not have access to the audit log." />
  const sp = await searchParams
  const data = await listAudit(ctx, scope.orgIds, sp as AuditFilters)
  return (
    <>
      <PageHeader title="Audit log" description={`${scope.label} · append-only record of important actions. Entries cannot be edited or deleted.`} />
      <ViewTabs label="Outcome" items={[['', 'All entries'], ['denied', 'Denied attempts'], ['failure', 'Failures'], ['success', 'Successful']].map(([k, l]) => ({
        href: '?' + new URLSearchParams(Object.entries({ ...sp, page: undefined, outcome: k || undefined } as Record<string, string | undefined>).filter((x): x is [string, string] => !!x[1])).toString(),
        label: l, active: (sp.outcome ?? '') === k }))} />
      <form method="get" className="card mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-6">
        <div><label className="label" htmlFor="action">Action</label>
          <select className="input" id="action" name="action" defaultValue={sp.action ?? ''}><option value="">Any</option>{data.actions.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select></div>
        <div><label className="label" htmlFor="entity">Record type</label>
          <select className="input" id="entity" name="entity" defaultValue={sp.entity ?? ''}><option value="">Any</option>{data.entities.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select></div>
        <div><label className="label" htmlFor="outcome">Outcome</label>
          <select className="input" id="outcome" name="outcome" defaultValue={sp.outcome ?? ''}><option value="">Any</option><option value="success">Success</option><option value="denied">Denied</option><option value="failure">Failure</option></select></div>
        <div><label className="label" htmlFor="from">From</label><input className="input" type="date" id="from" name="from" defaultValue={sp.from} /></div>
        <div><label className="label" htmlFor="to">To</label><input className="input" type="date" id="to" name="to" defaultValue={sp.to} /></div>
        <div className="flex items-end gap-2"><button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/audit">Clear</Link></div>
      </form>
      <Card padded={false}>
        {data.rows.length === 0 ? <EmptyState title="No audit entries match" /> : (
          <ol className="divide-y divide-slate-100" aria-label="Audit entries">
            {data.rows.map((r, i) => {
              const day = new Date(r.occurred_at).toDateString()
              const newDay = i === 0 || new Date(data.rows[i - 1].occurred_at).toDateString() !== day
              const info = r.metadata && typeof r.metadata === 'object' ? Object.entries(r.metadata as Record<string, unknown>).filter(([k]) => !SKIP.includes(k)) : []
              return (
                <li key={r.id}>
                  {newDay && <p className="bg-slate-50/80 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{new Date(r.occurred_at).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}</p>}
                  <div className="flex gap-3 px-5 py-3">
                    <div className="relative mt-0.5 h-7 w-7 shrink-0 self-start"><Avatar name={r.actor ?? 'System'} size="sm" />
                      <span aria-hidden className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ${OUTCOME_DOT[r.outcome] ?? 'bg-slate-400 ring-slate-100'}`} /></div>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold text-slate-900">{r.actor ?? 'System'}</span>
                        <span className="text-slate-700">{label(r.action)}</span>
                        <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">{label(r.entity_type)}</span>
                        {r.student_code && <span className="font-mono text-xs text-slate-500">{r.student_code}</span>}
                        {r.outcome !== 'success' && <span className={`rounded-full px-2 text-xs font-semibold ${r.outcome === 'denied' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{label(r.outcome)}</span>}
                      </p>
                      <p className="text-xs text-slate-500">{fmtDateTime(r.occurred_at)}{r.org_name && ` · ${r.org_name}`}{r.request_ip && ` · ${r.request_ip}`}</p>
                      <Changes before={r.before_data} after={r.after_data} />
                      {info.length > 0 && <p className="mt-1 break-all text-xs text-slate-500">{info.slice(0, 6).map(([k, v]) => `${k}: ${show(v)}`).join(' · ')}</p>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={sp} />
      </Card>
    </>
  )
}
