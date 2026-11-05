import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Badge, Card, EmptyState, PageHeader, Pagination, StatusBadge } from '@/components/ui'
import { canAny } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { myAttendance } from '@/services/attendance'
import { MarkAttendance } from './mark-form'
import { CancelLeaveButton, CorrectionForm, LeaveForm } from './request-forms'

export const metadata: Metadata = { title: 'Attendance' }

const timeOf = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(d)) : '–')

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ qr?: string; page?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const data = await myAttendance(ctx, { page: sp.page })
  const orgs = ctx.memberships.map((m) => ({ id: m.orgId, name: m.orgName }))
  const rec = data.today[0]
  const actions = !rec?.check_in_at ? [{ key: 'check_in', label: 'Check in', primary: true }]
    : rec.check_out_at ? [] : [
      rec.on_break_since ? { key: 'break_end', label: 'End break', primary: true } : { key: 'break_start', label: 'Start break' },
      { key: 'check_out', label: 'Check out', primary: !rec.on_break_since },
    ]
  const leaveTypes = data.policies[0]?.leave_types ?? ['Casual leave', 'Sick leave', 'Paid leave', 'Unpaid leave']
  return (
    <>
      <PageHeader title="Attendance" description="Mark your day, and see your history, leave and corrections."
        actions={canAny(ctx, ['attendance.view', 'attendance.review']) ? <Link className="btn-secondary" href="/attendance/manage">Team attendance</Link> : undefined} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Today">
            {rec && (
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-slate-500">Status</dt><dd><StatusBadge status={rec.status} label={label(rec.status)} /></dd></div>
                <div><dt className="text-slate-500">Checked in</dt><dd data-testid="checked-in">{timeOf(rec.check_in_at)}</dd></div>
                <div><dt className="text-slate-500">Checked out</dt><dd data-testid="checked-out">{timeOf(rec.check_out_at)}</dd></div>
                <div><dt className="text-slate-500">Review</dt><dd>{rec.review_status === 'pending' ? <Badge tone="amber">Waiting for review</Badge> : label(rec.review_status === 'none' ? 'not needed' : rec.review_status)}</dd></div>
              </dl>
            )}
            {actions.length > 0 ? <MarkAttendance orgs={orgs} actions={actions} qr={sp.qr} /> : <p className="text-sm text-slate-600">You have finished for today. Ask for a correction below if something is wrong.</p>}
          </Card>
          <Card title="History">
            {data.history.length === 0 ? <EmptyState title="No attendance yet" /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Late</th><th>Review</th></tr></thead>
                <tbody>{data.history.map((r) => (
                  <tr key={r.id}><td>{r.work_date}</td><td>{label(r.status)}</td><td>{timeOf(r.check_in_at)}</td><td>{timeOf(r.check_out_at)}</td><td>{r.late_minutes ? `${r.late_minutes} min` : '–'}</td>
                    <td>{r.review_status === 'none' ? '–' : label(r.review_status)}{r.review_note && <span className="block text-xs text-slate-500 wrap-anywhere">{r.review_note}</span>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} params={{}} />
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Leave, field duty and visits">
            <LeaveForm orgs={orgs} leaveTypes={leaveTypes} />
            {data.leaves.length > 0 && <ul className="mt-4 divide-y divide-slate-100 text-sm">{data.leaves.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{l.leave_type ?? label(l.kind)}: {l.from_date}{l.to_date !== l.from_date ? ` to ${l.to_date}` : ''}
                <span className="block text-xs text-slate-500">{label(l.status)}{l.decision_note ? ` · ${l.decision_note}` : ''}</span></span>
                {l.status === 'pending' && <CancelLeaveButton id={l.id} />}</li>))}</ul>}
          </Card>
          <Card title="Ask for a correction">
            <CorrectionForm orgs={orgs} />
            {data.corrections.length > 0 && <ul className="mt-4 divide-y divide-slate-100 text-sm">{data.corrections.map((c) => (
              <li key={c.id} className="py-2">{c.work_date}: {label(c.status)}<span className="block text-xs text-slate-500">{c.decision_note ?? c.reason}</span><span className="block text-xs text-slate-500">{fmtDateTime(c.created_at)}</span></li>))}</ul>}
          </Card>
        </div>
      </div>
    </>
  )
}
