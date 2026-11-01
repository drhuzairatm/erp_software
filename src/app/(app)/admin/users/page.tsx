import type { Metadata } from 'next'
import { fmtDateTime } from '@/components/format'
import { Icon } from '@/components/icons'
import Link from 'next/link'
import { Avatar, Badge, Card, PageHeader, StatCard, staffPhotoUrl } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { listStaff } from '@/server/services/admin'
import { CreateStaffForm, MembershipForm, UserButtons } from '../admin-forms'

export const metadata: Metadata = { title: 'Staff' }

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; org?: string; status?: string }> }) {
  const sp = await searchParams
  const ctx = await requireUser()
  if (!can(ctx, 'users.manage')) return <PageHeader title="Staff" description="You do not have permission to manage staff." />
  const data = await listStaff(ctx)
  const orgs = ctx.memberships.filter((m) => data.orgIds.includes(m.orgId)).map((m) => ({ value: m.orgId, label: m.orgName }))
  const managers = data.users.filter((u) => u.is_active).map((u) => ({ value: u.id, label: `${u.full_name} (${u.employee_id})` }))
  const roleNames = [...new Set(data.memberships.map((m) => m.role_name))].sort()
  const q = sp.q?.trim().toLowerCase()
  const users = data.users.filter((u) => {
    const ms = data.memberships.filter((m) => m.user_id === u.id)
    return (!q || `${u.full_name} ${u.email} ${u.employee_id} ${u.job_title ?? ''}`.toLowerCase().includes(q))
      && (!sp.role || ms.some((m) => m.role_name === sp.role)) && (!sp.org || ms.some((m) => m.org_id === sp.org))
      && (!sp.status || (sp.status === 'active' ? u.is_active : !u.is_active))
  })
  return (
    <>
      <PageHeader title="Staff accounts" description="Create accounts, set company roles, issue password links, and deactivate leavers. You can only assign roles — and manage people — whose access is within your own. Changes are audited." />
      <section aria-label="Staff summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active staff" value={data.users.filter((u) => u.is_active).length} tone="blue" icon={<Icon name="staff" className="h-5 w-5" />} />
        <StatCard label="Two-factor enabled" value={data.mfa.filter((x) => x.enabled).length} tone="green" icon={<Icon name="shield" className="h-5 w-5" />} />
        <StatCard label="Password resets requested" value={data.resets.length} tone={data.resets.length ? 'amber' : 'slate'} icon={<Icon name="key" className="h-5 w-5" />} />
        <StatCard label="Deactivated" value={data.users.filter((u) => !u.is_active).length} tone="slate" icon={<Icon name="close" className="h-5 w-5" />} />
      </section>
      <Card title="Add a staff member" className="mb-6"><CreateStaffForm orgs={orgs} roles={data.roles} managers={managers} /></Card>
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div><label className="label" htmlFor="sq">Search</label><input className="input" id="sq" name="q" defaultValue={sp.q} placeholder="Name, email, employee ID" /></div>
        <div><label className="label" htmlFor="sr">Role</label><select className="input" id="sr" name="role" defaultValue={sp.role ?? ''}><option value="">All</option>{roleNames.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        {orgs.length > 1 && <div><label className="label" htmlFor="so">Company</label><select className="input" id="so" name="org" defaultValue={sp.org ?? ''}><option value="">All</option>{orgs.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>}
        <div><label className="label" htmlFor="ss">Status</label><select className="input" id="ss" name="status" defaultValue={sp.status ?? ''}><option value="">All</option><option value="active">Active</option><option value="inactive">Deactivated</option></select></div>
        <button className="btn-primary" type="submit">Apply</button><Link className="btn-ghost" href="/admin/users">Clear</Link>
      </form>
      <Card padded={false}>
        <div className="table-wrap"><table>
          <thead><tr><th>Person</th><th>Company access (role, department)</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>{users.map((u) => {
            const reset = data.resets.find((r) => r.user_id === u.id)
            const login = data.logins.find((l) => l.user_id === u.id)
            return (
              <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                <td><div className="flex items-start gap-3"><Avatar name={u.full_name} src={staffPhotoUrl(u.id, u.photo_version)} />
                  <div><p className="font-medium"><Link href={`/admin/users/${u.id}`}>{u.full_name}</Link> {!u.is_active && <Badge tone="red">Deactivated</Badge>}</p>
                    <p className="text-xs text-slate-500"><span className="font-mono">{u.employee_id}</span> · {u.email}{u.job_title ? ` · ${u.job_title}` : ''}</p>
                    {u.manager_name && <p className="text-xs text-slate-500">Reports to {u.manager_name}</p>}
                  {reset && <p className="mt-1"><Badge tone="amber">Password reset requested {fmtDateTime(reset.requested_at)}</Badge></p>}</div></div></td>
                <td className="space-y-2">{data.memberships.filter((m) => m.user_id === u.id).map((m) => (
                  <div key={m.id}>
                    <p className="text-xs font-medium text-slate-600">{m.org_name}</p>
                    {!m.editable ? <p className="text-sm">{m.role_name}{u.id === ctx.userId ? ' (you)' : ''}{!m.is_active && ' – inactive'}
                      {u.id !== ctx.userId && <span className="block text-xs text-slate-500">Outside your authority to change</span>}</p>
                      : <MembershipForm id={m.id} roleId={m.role_id} active={m.is_active} departmentId={m.department_id}
                          roles={data.roles.filter((r) => r.org_id === m.org_id)} departments={data.departments.filter((d) => d.org_id === m.org_id)} />}
                  </div>))}
                </td>
                <td className="whitespace-nowrap text-xs">{login ? fmtDateTime(login.last_login) : 'Never'}
                  <div className="mt-1">{data.mfa.find((x) => x.user_id === u.id)?.enabled ? <Badge tone="green">2FA on</Badge> : <Badge>2FA off</Badge>}</div></td>
                <td>{data.administerable.includes(u.id) && <UserButtons userId={u.id} active={u.is_active} mfaEnabled={!!data.mfa.find((x) => x.user_id === u.id)?.enabled} />}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </Card>
    </>
  )
}
