import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDate, fmtMoney, label } from '@/components/format'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { requireUser } from '@/lib/auth/session'
import { ServiceError } from '@/lib/errors'
import { getLookups } from '@/services/lookups'
import { runReport } from '@/services/reports'
import { getScope } from '@/services/scope'

export const metadata: Metadata = { title: 'Report' }

const STUDENT_FILTER_REPORTS = ['pending-acknowledgements', 'passport-expiry', 'attestation', 'active-by-company', 'by-country-university', 'by-stage', 'documents', 'balances', 'student-list']

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params
  const sp = await searchParams
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  const result = await runReport(ctx, key, scope.orgIds, sp).catch((e) => { if (e instanceof ServiceError) return null; throw e })
  if (!result) notFound()
  const lookups = await getLookups(ctx)
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()
  const rowLink = (row: Record<string, unknown>) => (row.student_id ? `/students/${row.student_id}` : row.task_id ? `/tasks/${row.task_id}` : null)
  return (
    <>
      <PageHeader title={result.report.title} description={`${scope.label} · ${result.report.description}`} back={{ href: '/reports', label: 'Reports' }}
        actions={result.canExport && <a className="btn-secondary" href={`/api/reports/${key}${qs ? `?${qs}` : ''}`}>Export CSV</a>} />
      {STUDENT_FILTER_REPORTS.includes(key) && (
        <form method="get" className="card mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-6">
          {key === 'documents' && (
            <div><label className="label" htmlFor="status">Document status</label>
              <select className="input" id="status" name="status" defaultValue={sp.status ?? ''}>
                <option value="">All pending</option><option value="missing">Missing</option><option value="awaiting">Awaiting verification</option>
                <option value="approval">Awaiting manager approval</option><option value="rejected">Rejected / changes required</option><option value="expired">Expired</option>
              </select></div>
          )}
          <div><label className="label" htmlFor="from">Registered from</label><input className="input" type="date" id="from" name="from" defaultValue={sp.from} /></div>
          <div><label className="label" htmlFor="to">Registered to</label><input className="input" type="date" id="to" name="to" defaultValue={sp.to} /></div>
          <div><label className="label" htmlFor="country">Country</label>
            <select className="input" id="country" name="country" defaultValue={sp.country ?? ''}><option value="">All</option>{lookups.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="course">Course</label>
            <select className="input" id="course" name="course" defaultValue={sp.course ?? ''}><option value="">All</option>{lookups.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="flex items-end gap-2"><button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href={`/reports/${key}`}>Clear</Link></div>
        </form>
      )}
      <Card padded={false}>
        {result.rows.length === 0 ? <EmptyState title="No rows for these filters" /> : (
          <div className="table-wrap"><table>
            <thead><tr>{result.columns.map((c) => <th key={c.key} className={c.type === 'number' || c.type === 'money' ? 'text-right' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>{result.rows.map((row, i) => {
              const href = rowLink(row)
              return (
                <tr key={i}>{result.columns.map((c, j) => {
                  const v = row[c.key]
                  const text = c.type === 'money' ? fmtMoney(v as string, (row.currency as string) || 'INR') : c.type === 'date' ? fmtDate(v as string | null) : c.key === 'status' ? label(v as string) : (v as string | number | null) ?? '—'
                  return <td key={c.key} className={c.type === 'number' || c.type === 'money' ? 'text-right tabular-nums' : ''}>{j === 0 && href ? <Link href={href}>{text}</Link> : text}</td>
                })}</tr>
              )
            })}</tbody>
          </table></div>
        )}
        <p className="hint px-4 pb-3">{result.rows.length} row{result.rows.length === 1 ? '' : 's'}{result.rows.length >= 5000 ? ' (limited to 5,000)' : ''}. Exports are recorded in the audit log.</p>
      </Card>
    </>
  )
}
