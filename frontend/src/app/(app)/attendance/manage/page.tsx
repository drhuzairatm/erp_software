import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDateTime, label } from '@/components/format'
import { Avatar, Badge, Card, EmptyState, PageHeader, StatCard, staffPhotoUrl } from '@/components/ui'
import { can, canAny } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { getScope } from '@/services/scope'
import { attendanceToday, attendanceWorkQueue, FLAG_LABEL } from '@/services/attendance'
import { DecisionForm, SetStatusForm } from '../request-forms'

export const metadata: Metadata = { title: 'Team attendance' }
const timeOf = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(d)) : '–')

export default async function TeamAttendancePage() {
  const ctx = await requireUser()
  if (!canAny(ctx, ['attendance.view', 'attendance.review'])) return <PageHeader title="Team attendance" description="You do not have access to this page." />
  const scope = await getScope(ctx)
  const orgIds = scope.orgIds.filter((o) => can(ctx, 'attendance.view', o) || can(ctx, 'attendance.review', o))
  if (!orgIds.length) return <PageHeader title="Team attendance" description="You do not have access to team attendance in the selected company." />
  const [today, q] = await Promise.all([attendanceToday(ctx, orgIds), attendanceWorkQueue(ctx, orgIds)])
  const count = (f: (r: (typeof today)[number]) => boolean) => today.filter(f).length
  const reviewOrgs = ctx.memberships.filter((m) => orgIds.includes(m.orgId) && can(ctx, 'attendance.review', m.orgId)).map((m) => ({ id: m.orgId, name: m.orgName }))
  return (
    <>
      <PageHeader title="Team attendance" description="Today, and everything waiting for a decision. A person with no record has not been marked absent."
        actions={<span className="flex flex-wrap gap-2"><Link className="btn-secondary" href="/attendance/reports">Monthly reports</Link>{canAny(ctx, ['attendance.manage']) && <><Link className="btn-secondary" href="/attendance/settings">Settings</Link><Link className="btn-secondary" href="/attendance/kiosk">Office QR kiosk</Link></>}</span>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Checked in" value={count((r) => !!r.check_in_at)} tone="green" />
        <StatCard label="Late" value={count((r) => r.status === 'late')} tone="amber" />
        <StatCard label="On leave or duty" value={count((r) => ['leave', 'field_duty', 'official_visit'].includes(r.status ?? ''))} />
        <StatCard label="No record yet" value={count((r) => !r.status)} />
        <StatCard label="Waiting for review" value={q.reviews.length} tone={q.reviews.length ? 'red' : 'slate'} />
      </div>
      <div className="space-y-6">
        {reviewOrgs.length > 0 && <>
          <Card title={`Manual review (${q.reviews.length})`}>
            {q.reviews.length === 0 ? <EmptyState title="Nothing waiting for review" /> : <ul className="divide-y divide-slate-100">{q.reviews.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" data-testid="review-row">
                <span><span className="font-medium">{r.full_name}</span> · {r.work_date} · {label(r.status)}<span className="block text-xs text-slate-500">{r.org_name} · in {timeOf(r.check_in_at)} · out {timeOf(r.check_out_at)}</span>
                  <span className="mt-1 flex flex-wrap gap-1">{r.flags.map((f) => <Badge key={f} tone="amber">{FLAG_LABEL[f] ?? f}</Badge>)}</span></span>
                <DecisionForm kind="review" id={r.id} approve={{ value: 'accepted', label: 'Accept' }} refuse={{ value: 'not_accepted', label: 'Do not accept' }} />
              </li>))}</ul>}
          </Card>
          <Card title={`Correction requests (${q.corrections.length})`}>
            {q.corrections.length === 0 ? <EmptyState title="No correction requests" /> : <ul className="divide-y divide-slate-100">{q.corrections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span><span className="font-medium">{c.full_name}</span> · {c.work_date}<span className="block text-xs text-slate-500">in {timeOf(c.check_in_at)} · out {timeOf(c.check_out_at)} · {c.reason}</span></span>
                <DecisionForm kind="correction" id={c.id} approve={{ value: 'approved', label: 'Approve' }} refuse={{ value: 'rejected', label: 'Refuse' }} /></li>))}</ul>}
          </Card>
          <Card title={`Leave and duty requests (${q.leaves.length})`}>
            {q.leaves.length === 0 ? <EmptyState title="No requests" /> : <ul className="divide-y divide-slate-100">{q.leaves.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><span><span className="font-medium">{l.full_name}</span> · {l.leave_type ?? label(l.kind)} · {l.from_date} to {l.to_date}<span className="block text-xs text-slate-500">{l.reason}</span></span>
                <DecisionForm kind="leave" id={l.id} approve={{ value: 'approved', label: 'Approve' }} refuse={{ value: 'rejected', label: 'Refuse' }} /></li>))}</ul>}
          </Card>
          <Card title="Record a status (for example, absent)"><SetStatusForm orgs={reviewOrgs} people={today} /></Card>
        </>}
        <Card title="Today" padded={false}>
          <div className="table-wrap"><table>
            <thead><tr><th>Person</th><th>Department</th><th>Status</th><th>In</th><th>Out</th><th>Late</th></tr></thead>
            <tbody>{today.map((r) => (
              <tr key={`${r.org_id}-${r.user_id}`}><td><span className="flex items-center gap-2"><Avatar name={r.full_name} src={staffPhotoUrl(r.user_id, r.photo_version)} size="sm" /><span>{r.full_name}<span className="block text-xs text-slate-500">{r.org_name}</span></span></span></td>
                <td>{r.department ?? '–'}</td><td>{r.status ? label(r.status) : 'No record'}</td><td>{timeOf(r.check_in_at)}</td><td>{timeOf(r.check_out_at)}</td><td>{r.late_minutes ? `${r.late_minutes} min` : '–'}</td></tr>))}</tbody>
          </table></div>
        </Card>
        {reviewOrgs.length > 0 && <Card title="Recent flagged attempts">
          {q.suspicious.length === 0 ? <EmptyState title="No flagged attempts" /> : <ul className="divide-y divide-slate-100 text-sm">{q.suspicious.map((e) => (
            <li key={e.id} className="py-2"><span className="font-medium">{e.full_name}</span> · {label(e.event_type)} · {fmtDateTime(e.occurred_at)}
              <span className="block text-xs text-slate-500 wrap-anywhere">{e.flags.map((f) => FLAG_LABEL[f] ?? f).join(', ')}{e.distance_m !== null ? ` · ${e.distance_m} m from office` : ''}{e.client_ip ? ` · ${e.client_ip}` : ''}</span></li>))}</ul>}
        </Card>}
      </div>
    </>
  )
}
