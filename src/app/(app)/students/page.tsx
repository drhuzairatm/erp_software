import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate } from '@/components/format'
import { Badge, Card, DemoBadge, EmptyState, PageHeader, Pagination, StatusBadge } from '@/components/ui'
import { can, canAny } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { getLookups } from '@/server/services/lookups'
import { listStudents, type StudentFilters } from '@/server/services/students'
import { taskAssignees } from '@/server/services/tasks'
import { getScope } from '@/server/scope'
import { todayISO } from '@/components/format'

export const metadata: Metadata = { title: 'Students' }

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireUser()
  if (!canAny(ctx, ['students.read.all', 'students.read.processing', 'students.read.assigned'])) {
    return <PageHeader title="Students" description="You do not have access to student records." />
  }
  const sp = await searchParams
  const scope = await getScope(ctx)
  const [data, lookups, staff] = await Promise.all([
    listStudents(ctx, scope.orgIds, sp as StudentFilters),
    getLookups(ctx),
    taskAssignees(ctx, scope.orgIds),
  ])
  const canCreate = scope.orgIds.some((o) => can(ctx, 'students.create', o))
  const canImport = ctx.memberships.some((m) => can(ctx, 'students.import', m.orgId))
  const universities = sp.country ? lookups.universities.filter((u) => u.country_id === sp.country) : lookups.universities
  const today = todayISO()
  const uniqueStaff = [...new Map(staff.map((s) => [s.id, s])).values()]
  return (
    <>
      <PageHeader title="Students" description={`${scope.label} · ${data.total} matching record${data.total === 1 ? '' : 's'}`}
        actions={<>{canImport && <Link href="/students/import" className="btn-secondary">Import CSV</Link>}{canCreate && <Link href="/students/new" className="btn-primary">Register student</Link>}</>} />
      <form method="get" className="card mb-4 grid grid-cols-2 gap-3 p-4 md:grid-cols-4 xl:grid-cols-8">
        <div className="col-span-2">
          <label className="label" htmlFor="q">Search</label>
          <input className="input" id="q" name="q" defaultValue={sp.q} placeholder="Student ID, name, phone, email or passport no." />
        </div>
        <div><label className="label" htmlFor="country">Country</label>
          <select className="input" id="country" name="country" defaultValue={sp.country ?? ''}><option value="">All</option>{lookups.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="educationCountry">Educated in</label>
          <select className="input" id="educationCountry" name="educationCountry" defaultValue={sp.educationCountry ?? ''}><option value="">All</option>
            {[...lookups.countries].sort((a, b) => Number(b.is_education_origin) - Number(a.is_education_origin)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="course">Course</label>
          <select className="input" id="course" name="course" defaultValue={sp.course ?? ''}><option value="">All</option>{lookups.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="university">University</label>
          <select className="input" id="university" name="university" defaultValue={sp.university ?? ''}><option value="">All</option>{universities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label className="label" htmlFor="stage">Stage</label>
          <select className="input" id="stage" name="stage" defaultValue={sp.stage ?? ''}><option value="">All</option>{lookups.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="status">Status</label>
          <select className="input" id="status" name="status" defaultValue={sp.status ?? ''}>
            <option value="">All (not merged)</option><option value="active">Active</option><option value="on_hold">On hold</option>
            <option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="merged">Merged</option>
          </select></div>
        <div><label className="label" htmlFor="assignee">Assigned staff</label>
          <select className="input" id="assignee" name="assignee" defaultValue={sp.assignee ?? ''}>
            <option value="">Anyone</option><option value="me">Assigned to me</option><option value="none">No processing staff</option>
            {uniqueStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select></div>
        <div><label className="label" htmlFor="nextDue">Next action</label>
          <select className="input" id="nextDue" name="nextDue" defaultValue={sp.nextDue ?? ''}>
            <option value="">Any</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Due within 7 days</option>
          </select></div>
        <div><label className="label" htmlFor="sort">Sort by</label>
          <select className="input" id="sort" name="sort" defaultValue={sp.sort ?? 'newest'}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option>
            <option value="code">Student ID</option><option value="due">Next action due</option><option value="stage">Stage</option>
          </select></div>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" value="yes" defaultChecked={sp.archived === 'yes'} /> Archived</label>
        </div>
        <div className="col-span-2 flex items-end gap-2">
          <button className="btn-primary" type="submit">Apply</button>
          <Link href="/students" className="btn-ghost">Clear</Link>
        </div>
      </form>
      <Card padded={false}>
        {data.rows.length === 0 ? <EmptyState title="No students found">Try changing the filters or search.</EmptyState> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th scope="col">Student</th><th scope="col">Company</th><th scope="col">Destination / course</th><th scope="col">Stage</th>
                <th scope="col">Counsellor</th><th scope="col">Next action</th><th scope="col">Registered</th>
              </tr></thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/students/${s.id}`} className="font-medium">{s.full_name}</Link>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        <span className="font-mono">{s.student_code}</span>
                        {s.is_demo && <DemoBadge />}
                        {s.archived_at && <Badge>Archived</Badge>}
                      </div>
                    </td>
                    <td><Badge tone={s.org_code === 'GRD' ? 'purple' : 'blue'}>{s.org_name}</Badge></td>
                    <td>{s.country_name ?? '—'}<div className="text-xs text-slate-500">{s.course_name ?? ''}{s.university_name ? ` · ${s.university_name}` : ''}</div></td>
                    <td><div>{s.stage_name}</div>{s.status !== 'active' && <StatusBadge status={s.status} />}</td>
                    <td>{s.counsellor_name ?? <span className="text-slate-400">—</span>}</td>
                    <td>
                      <div className="max-w-56 truncate">{s.next_action ?? '—'}</div>
                      {s.next_action_due && <div className={`text-xs ${s.next_action_due < today && s.status === 'active' ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
                        {s.next_action_due < today && s.status === 'active' ? 'Overdue · ' : ''}{fmtDate(s.next_action_due)}</div>}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data.page} total={data.total} pageSize={data.pageSize} params={sp} />
      </Card>
    </>
  )
}
