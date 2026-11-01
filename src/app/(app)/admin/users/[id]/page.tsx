import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fmtDateTime, label } from '@/components/format'
import { Avatar, Badge, Card, DL, PageHeader, staffPhotoUrl } from '@/components/ui'
import { requireUser } from '@/server/auth/session'
import { getStaffMember } from '@/server/services/admin'
import { ReportingManagerForm, StaffPhotoForm } from '../../admin-forms'

export const metadata: Metadata = { title: 'Staff profile' }

export default async function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireUser()
  const data = await getStaffMember(ctx, id)
  if (!data) notFound()
  const { user: u } = data
  const big = u.photo_version ? `/api/staff/${u.id}/photo?size=display&v=${u.photo_version}` : null
  return (
    <>
      <PageHeader back={{ href: '/admin/users', label: 'Staff' }} title={u.full_name}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{u.employee_id}</span>{u.job_title && <>· {u.job_title}</>}
          {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</span>} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card title="Profile photo">
          <div className="flex flex-col items-center gap-3">
            {big ? (
              <a href={big} target="_blank" rel="noopener" aria-label={`Open ${u.full_name}'s photo`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={staffPhotoUrl(u.id, u.photo_version)!} alt={`Photo of ${u.full_name}`} className="h-32 w-32 rounded-full object-cover ring-4 ring-white shadow-md" />
              </a>
            ) : <Avatar name={u.full_name} size="xl" />}
            {big && <a className="text-xs" href={big} target="_blank" rel="noopener">View larger photo</a>}
          </div>
          {u.can_photo && <div className="mt-4 border-t border-slate-100 pt-4"><StaffPhotoForm userId={u.id} hasPhoto={!!u.photo_version} /></div>}
        </Card>
        <div className="space-y-6 xl:col-span-2">
          <Card title="Details">
            <DL items={[['Employee ID', <span key="e" className="font-mono">{u.employee_id}</span>], ['Work email', u.email], ['Job title', u.job_title],
              ['Reporting manager', u.manager_name ?? 'None'], ['Account created', fmtDateTime(u.created_at)]]} />
            {u.can_admin && <div className="mt-4 border-t border-slate-100 pt-4">
              <ReportingManagerForm userId={u.id} current={u.reports_to} managers={data.managers.map((m) => ({ value: m.id, label: `${m.full_name} (${m.employee_id})` }))} /></div>}
          </Card>
          <Card title="Company access and role" padded={false}>
            <div className="table-wrap"><table>
              <thead><tr><th>Company</th><th>Role</th><th>Department</th><th>Status</th></tr></thead>
              <tbody>{data.memberships.map((m) => (
                <tr key={m.org_name}><td>{m.org_name}</td><td>{m.role_name}</td><td>{m.department ?? '—'}</td><td>{m.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td></tr>))}
              </tbody>
            </table></div>
            <p className="hint px-4 pb-3">Roles, departments and access are changed on the <Link href="/admin/users">Staff</Link> list (only roles within your own authority).</p>
          </Card>
          {data.reports.length > 0 && (
            <Card title={`Reports to ${u.full_name.split(' ')[0]} (${data.reports.length})`}>
              <ul className="flex flex-wrap gap-2">{data.reports.map((r) => <li key={r.id}><Link href={`/admin/users/${r.id}`} className="rounded-full bg-slate-100 px-3 py-1 text-sm no-underline">{r.full_name}</Link></li>)}</ul>
            </Card>
          )}
          {data.history.length > 0 && (
            <Card title="Recent changes">
              <ul className="space-y-1 text-sm">{data.history.map((h) => (
                <li key={h.id}>{fmtDateTime(h.occurred_at)} · {h.actor ?? 'System'} · {label(h.action)} {label(h.entity_type)}</li>))}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
