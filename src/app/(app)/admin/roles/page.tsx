import type { Metadata } from 'next'
import { Alert, Badge, Card, PageHeader } from '@/components/ui'
import { can, orgsWith } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { listRoles } from '@/server/services/admin'
import { CreateRoleForm, RolePermissionsForm } from '../admin-forms'

export const metadata: Metadata = { title: 'Roles & permissions' }

export default async function RolesPage() {
  const ctx = await requireUser()
  if (!can(ctx, 'roles.manage')) return <PageHeader title="Roles & permissions" description="You do not have permission to manage roles." />
  const { roles, permissions } = await listRoles(ctx)
  const orgs = orgsWith(ctx, 'roles.manage').map((id) => ({ value: id, label: ctx.memberships.find((m) => m.orgId === id)!.orgName }))
  return (
    <>
      <PageHeader title="Roles & permissions" description="Roles are configured separately for each company. Permissions are enforced by the server and the database." />
      <div className="mb-6 space-y-4">
        <Alert tone="amber">For safety you cannot change a role you hold yourself, and you can only grant permissions you hold. The Managing Director role is locked. Every change is recorded in the audit log.</Alert>
        <Card title="Create a role"><CreateRoleForm orgs={orgs} /></Card>
      </div>
      <div className="space-y-4">
        {roles.map((r) => (
          <details key={r.id} className="card">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
              <span className="font-medium">{r.name}</span><Badge tone="blue">{r.org_name}</Badge>
              <span className="text-xs text-slate-500">{r.members} active member{r.members === 1 ? '' : 's'} · {r.perms.length} permissions</span>
              {r.held_by_me && <Badge tone="amber">Your role</Badge>}
              {r.is_protected && <Badge tone="purple">Locked – always has every permission</Badge>}
              {r.is_privileged && !r.is_protected && <Badge tone="red">Privileged – assigning needs “Assign privileged roles”</Badge>}
              {r.requires_mfa && <Badge tone="green">2FA required</Badge>}
            </summary>
            <div className="border-t border-slate-200 p-4">
              {r.description && <p className="mb-3 text-sm text-slate-600">{r.description}</p>}
              <RolePermissionsForm roleId={r.id} perms={r.perms} all={permissions} disabled={r.held_by_me || r.is_protected}
                grantable={ctx.memberships.find((m) => m.orgId === r.org_id)?.permissions ?? []} />
            </div>
          </details>
        ))}
      </div>
    </>
  )
}
