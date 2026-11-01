import type { Metadata } from 'next'
import Link from 'next/link'
import { VerifyForm } from '@/app/(app)/students/[id]/tab-forms'
import { fmtDate, fmtDateTime, fmtMoney, label } from '@/components/format'
import { Sparkline } from '@/components/charts'
import { Icon } from '@/components/icons'
import { Alert, Card, EmptyState, PageHeader, Pagination, StatCard, StatusBadge, ViewTabs } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { type LedgerFilters, listLedger } from '@/server/services/payments'
import { getScope } from '@/server/scope'

export const metadata: Metadata = { title: 'Payment ledger' }

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  const scope = await getScope(ctx)
  if (!scope.orgIds.some((o) => can(ctx, 'payments.read', o))) return <PageHeader title="Payment ledger" description="You do not have access to financial records." />
  const sp = await searchParams
  const data = await listLedger(ctx, scope.orgIds, sp as LedgerFilters)
  const back = '/payments'
  const main = data.totals[0]
  const kpi = (v: string | number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: main?.currency ?? 'INR', maximumFractionDigits: 0 }).format(Number(v))
  const qs = (over: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ ...sp, page: undefined, ...over } as Record<string, string | undefined>).filter((x): x is [string, string] => !!x[1])).toString()
  const TYPE_TONE: Record<string, string> = { charge: 'text-slate-900', receipt: 'text-emerald-700', refund: 'text-rose-700', disbursement: 'text-rose-700', waiver: 'text-sky-700', reversal: 'text-amber-700' }
  return (
    <>
      <PageHeader title="Payment ledger" description={`${scope.label} · basic ledger, not an accounting system. Record new entries from a student's Payments tab.`}
        actions={scope.orgIds.some((o) => can(ctx, 'reports.export.finance', o)) && <Link className="btn-secondary" href="/reports/balances">Outstanding balances report</Link>} />
      {data.summary.pending_count > 0 && (
        <div className="mb-4"><Alert tone="amber">{data.summary.pending_count} entr{data.summary.pending_count === 1 ? 'y is' : 'ies are'} awaiting verification (receipts worth {fmtMoney(data.summary.pending)}). <Link href="/payments?status=pending">Show them</Link></Alert></div>
      )}
      <section aria-label="Ledger summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Verified receipts, last 30 days${main ? ` (${main.currency})` : ''}`} value={main ? kpi(main.received_30) : '—'} tone="green"
          icon={<Icon name="wallet" className="h-5 w-5" />} chart={main && <Sparkline values={main.months} color="#10b981" width={56} height={28} />} />
        <StatCard label="Charges raised, last 30 days" value={main ? kpi(main.charged_30) : '—'} tone="blue" icon={<Icon name="doc" className="h-5 w-5" />} />
        <StatCard label="Refunds & disbursements, 30 days" value={main ? kpi(main.refunded_30) : '—'} tone="purple" icon={<Icon name="trend" className="h-5 w-5" />} />
        <StatCard label="Awaiting verification" value={data.summary.pending_count} tone={data.summary.pending_count ? 'amber' : 'slate'}
          icon={<Icon name="clock" className="h-5 w-5" />} href="/payments?status=pending" sub={data.summary.pending_count ? `${fmtMoney(data.summary.pending)} in receipts` : undefined} />
      </section>
      {data.totals.length > 1 && <p className="-mt-3 mb-4 text-xs text-slate-500">Other currencies in this ledger: {data.totals.slice(1).map((t) => `${t.currency} ${fmtMoney(t.received_30, t.currency)} received (30 days)`).join(' · ')}</p>}
      <ViewTabs label="Ledger views" items={[
        { href: qs({ status: undefined }), label: 'All entries', active: !sp.status },
        { href: qs({ status: 'pending' }), label: 'Awaiting verification', active: sp.status === 'pending', count: data.summary.pending_count, alert: true },
        { href: qs({ status: 'verified' }), label: 'Verified', active: sp.status === 'verified' },
        { href: qs({ status: 'rejected' }), label: 'Rejected', active: sp.status === 'rejected' },
        { href: qs({ status: 'not_required' }), label: 'Charges', active: sp.status === 'not_required' },
      ]} />
      <form method="get" className="card mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-7">
        <div className="col-span-2"><label className="label" htmlFor="q">Search</label><input className="input" id="q" name="q" defaultValue={sp.q} placeholder="Student ID, name, reference" /></div>
        <div><label className="label" htmlFor="status">Verification</label>
          <select className="input" id="status" name="status" defaultValue={sp.status ?? ''}><option value="">Any</option><option value="pending">Awaiting verification</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="not_required">Charges</option></select></div>
        <div><label className="label" htmlFor="type">Type</label>
          <select className="input" id="type" name="type" defaultValue={sp.type ?? ''}><option value="">Any</option>{['charge', 'receipt', 'waiver', 'refund', 'disbursement', 'reversal'].map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
        <div><label className="label" htmlFor="ledger">Ledger</label>
          <select className="input" id="ledger" name="ledger" defaultValue={sp.ledger ?? ''}><option value="">Both</option><option value="service">Service fees</option><option value="third_party">Third-party money</option></select></div>
        <div><label className="label" htmlFor="from">From</label><input className="input" type="date" id="from" name="from" defaultValue={sp.from} /></div>
        <div><label className="label" htmlFor="to">To</label><input className="input" type="date" id="to" name="to" defaultValue={sp.to} /></div>
        <div className="flex items-end gap-2"><button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/payments">Clear</Link></div>
      </form>
      <Card padded={false}>
        {data.rows.length === 0 ? <EmptyState title="No ledger entries" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Student</th><th>Entry</th><th className="text-right">Amount</th><th>Reference</th><th>Recorded by</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.rows.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{fmtDate(e.entry_date)}</td>
                <td>{e.student_code ? <Link href={`/students/${e.student_id}?tab=payments`}>{e.student_name}</Link> : '—'}<div className="font-mono text-xs text-slate-500">{e.student_code}</div></td>
                <td>{label(e.entry_type)} · {e.fee_category}<div className="text-xs text-slate-500">{e.org_name}{e.ledger === 'third_party' ? ' · third-party' : ''}</div></td>
                <td className={`text-right font-semibold tabular-nums ${TYPE_TONE[e.entry_type] ?? ''}`}>{['refund', 'disbursement'].includes(e.entry_type) ? '−' : ''}{fmtMoney(e.amount, e.currency)}</td>
                <td className="text-xs">{e.method && label(e.method)}<div>{e.reference_no}</div></td>
                <td className="text-xs">{e.recorder_name}<div className="text-slate-500">{fmtDateTime(e.recorded_at)}</div></td>
                <td><StatusBadge status={e.verification_status} />{e.verifier_name && <div className="text-xs text-slate-500">{e.verifier_name}</div>}</td>
                <td>{e.verification_status === 'pending' && can(ctx, 'payments.verify', e.org_id) && e.recorded_by !== ctx.userId && <VerifyForm entryId={e.id} back={back} />}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={sp} />
      </Card>
    </>
  )
}
