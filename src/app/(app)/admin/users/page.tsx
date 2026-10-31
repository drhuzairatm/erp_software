import type { Metadata } from 'next'
import { fmtDateTime } from '@/components/format'
import { Badge, Card, PageHeader } from '@/components/ui'
import { can } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { listStaff } from '@/server/services/admin'
import { CreateStaffForm, MembershipForm, UserButtons } from '../admin-forms'

export const metadata: Metadata = { title: 'Staff' }

export default async function UsersPage() {
  const ctx = await requireUser()
  if (!can(ctx, 'users.manage')) return <PageHeader title="Staff" description="You do not have permission to manage staff." />
  const data = await listStaff(ctx)
  const orgs = ctx.memberships.filter((m) => data.orgIds.includes(m.orgId)).map((m) => ({ value: m.orgId, label: m.orgName }))
  return (
    <>
      <PageHeader title="Staff accounts" description="Create accounts, set company roles, issue password links, and deactivate leavers. You can only assign roles — and manage people — whose access is within your own. Changes are audited." />
      <Card title="Add a staff member" className="mb-6"><CreateStaffForm orgs={orgs} roles={data.roles} /></Card>
      <Card padded={false}>
        <div className="table-wrap"><table>
          <thead><tr><th>Person</th><th>Company access (role, department)</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>{data.users.map((u) => {
            const reset = data.resets.find((r) => r.user_id === u.id)
            const login = data.logins.find((l) => l.user_id === u.id)
            return (
              <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                <td><p className="font-medium">{u.full_name} {!u.is_active && <Badge tone="red">Deactivated</Badge>}</p><p className="text-xs text-slate-500">{u.email}{u.job_title ? ` · ${u.job_title}` : ''}</p>
                  {reset && <p className="mt-1"><Badge tone="amber">Password reset requested {fmtDateTime(reset.requested_at)}</Badge></p>}</td>
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
