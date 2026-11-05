import type { Metadata } from 'next'
import { Card, EmptyState, PageHeader } from '@/components/ui'
import { can } from '@/lib/auth/context'
import { requireUser } from '@/lib/auth/session'
import { getScope } from '@/services/scope'
import { attendanceMonthly } from '@/services/attendance'

export const metadata: Metadata = { title: 'Attendance reports' }

export default async function AttendanceReportsPage({ searchParams }: { searchParams: Promise<{ month?: string; department?: string }> }) {
  const ctx = await requireUser()
  const sp = await searchParams
  const scope = await getScope(ctx)
  const orgIds = scope.orgIds.filter((o) => can(ctx, 'attendance.view', o) || can(ctx, 'attendance.review', o))
  if (!orgIds.length) return <PageHeader title="Attendance reports" description="You do not have access to attendance reports." />
  const data = await attendanceMonthly(ctx, { orgIds, month: sp.month, departmentId: sp.department })
  return (
    <>
      <PageHeader back={{ href: '/attendance/manage', label: 'Team attendance' }} title="Attendance reports" description={`Month ${data.month}. "No record" counts working days with nothing recorded; it is not treated as absent.`} />
      <form className="mb-4 flex flex-wrap items-end gap-2"><div><label className="label" htmlFor="m">Month</label><input className="input" id="m" type="month" name="month" defaultValue={data.month} /></div><button className="btn-primary">Apply</button></form>
      <div className="space-y-6">
        <Card title="By department" padded={false}>
          {data.departments.length === 0 ? <EmptyState title="No staff" /> : <div className="table-wrap"><table>
            <thead><tr><th>Department</th><th>People</th><th>Present</th><th>Late</th><th>Half day</th><th>Leave</th><th>Absent</th><th>No record</th></tr></thead>
            <tbody>{data.departments.map((d) => <tr key={d.department}><td>{d.department}</td><td>{d.people}</td><td>{d.present}</td><td>{d.late}</td><td>{d.half_day}</td><td>{d.leave}</td><td>{d.absent}</td><td>{d.no_record}</td></tr>)}</tbody>
          </table></div>}
        </Card>
        <Card title="By employee" padded={false}>
          <div className="table-wrap"><table>
            <thead><tr><th>Person</th><th>Present</th><th>Late</th><th>Half day</th><th>Leave</th><th>Field</th><th>Visit</th><th>Absent</th><th>No record</th><th>Late min</th><th>Early min</th><th>Hours</th><th>Review</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={`${r.org_name}${r.user_id}`}><td>{r.full_name}<span className="block text-xs text-slate-500">{r.employee_id} · {r.org_name}{r.department ? ` · ${r.department}` : ''}</span></td>
              <td>{r.present}</td><td>{r.late}</td><td>{r.half_day}</td><td>{r.leave}</td><td>{r.field_duty}</td><td>{r.official_visit}</td><td>{r.absent}</td><td>{r.no_record}</td><td>{r.late_minutes}</td><td>{r.early_minutes}</td><td>{(r.worked_minutes / 60).toFixed(1)}</td><td>{r.pending_review}</td></tr>)}</tbody>
          </table></div>
        </Card>
      </div>
    </>
  )
}
