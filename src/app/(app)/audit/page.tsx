import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Card, EmptyState, PageHeader, Pagination, StatusBadge } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { type AuditFilters, listAudit } from '@/server/services/admin'
import { getScope } from '@/server/scope'

export const metadata: Metadata = { title: 'Audit log' }

function summarize(v: unknown) {
  if (!v || typeof v !== 'object') return null
  const entries = Object.entries(v as Record<string, unknown>).filter(([k]) => !['id', 'created_at', 'created_by', 'updated_by'].includes(k))
  if (!entries.length) return null
  return entries.slice(0, 8).map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`).join(' · ')
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  if (!scope.orgIds.some((o) => can(ctx, 'audit.read', o))) return <PageHeader title="Audit log" description="You do not have access to the audit log." />
  const sp = await searchParams
  const data = await listAudit(ctx, scope.orgIds, sp as AuditFilters)
  return (
    <>
      <PageHeader title="Audit log" description={`${scope.label} · append-only record of important actions. Entries cannot be edited or deleted.`} />
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
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th><th>Outcome</th></tr></thead>
            <tbody>{data.rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(r.occurred_at)}{r.request_ip && <div className="text-slate-400">{r.request_ip}</div>}</td>
                <td className="text-sm">{r.actor ?? 'System'}{r.org_name && <div className="text-xs text-slate-500">{r.org_name}</div>}</td>
                <td className="text-sm">{label(r.action)}</td>
                <td className="text-xs">{label(r.entity_type)}{r.student_code && <div className="font-mono">{r.student_code}</div>}</td>
                <td className="max-w-md text-xs text-slate-600">
                  {summarize(r.before_data) && <div><span className="text-slate-400">before </span>{summarize(r.before_data)}</div>}
                  {summarize(r.after_data) && <div><span className="text-slate-400">after </span>{summarize(r.after_data)}</div>}
                  {summarize(r.metadata) && <div><span className="text-slate-400">info </span>{summarize(r.metadata)}</div>}
                </td>
                <td><StatusBadge status={r.outcome === 'success' ? 'verified' : 'rejected'} label={label(r.outcome)} /></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={sp} />
      </Card>
    </>
  )
}
