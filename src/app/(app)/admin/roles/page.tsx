import type { Metadata } from 'next'
import Link from 'next/link'
import { Alert, Badge, Card, PageHeader } from '@/components/ui'
import { can, orgsWith } from '@/server/auth/context'
import { requireUser } from '@/server/auth/session'
import { listRoles } from '@/server/services/admin'
import { CreateRoleForm, RolePermissionsForm, RoleStructureForm } from '../admin-forms'

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
              {!r.is_active && <Badge tone="slate">Inactive</Badge>}
              {r.parent_role_id && <span className="text-xs text-slate-500">reports to {roles.find((x) => x.id === r.parent_role_id)?.name}</span>}
            </summary>
            <div className="border-t border-slate-200 p-4">
              {r.description && <p className="mb-3 text-sm text-slate-600">{r.description}</p>}
              <div className="mb-4 grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
                <RoleStructureForm roleId={r.id} active={r.is_active} parent={r.parent_role_id} disabled={r.held_by_me || r.is_protected}
                  parents={roles.filter((x) => x.org_id === r.org_id && x.id !== r.id).map((x) => ({ value: x.id, label: x.name }))} />
                <div className="text-sm"><p className="label text-xs">People in this role ({r.member_names.length})</p>
                  {r.member_names.length === 0 ? <p className="text-slate-500">Nobody</p>
                    : <p className="text-slate-700">{r.member_names.map((m, i) => <span key={m.id}>{i > 0 && ', '}<Link href={`/admin/users/${m.id}`}>{m.name}</Link></span>)}</p>}</div>
              </div>
              <p className="hint mb-3">The reporting role is for the organisation chart only; it never grants permissions. A role can be made inactive only when nobody holds it.</p>
              <RolePermissionsForm roleId={r.id} perms={r.perms} all={permissions} disabled={r.held_by_me || r.is_protected}
                grantable={ctx.memberships.find((m) => m.orgId === r.org_id)?.permissions ?? []} />
            </div>
          </details>
        ))}
      </div>
    </>
  )
}
