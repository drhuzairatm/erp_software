import type { Tx } from '../db'

export interface Membership {
  orgId: string
  orgCode: string
  orgName: string
  roleKey: string
  roleName: string
  roleRequiresMfa: boolean
  departmentName: string | null
  permissions: string[]
}

export interface AuthContext {
  userId: string
  sessionId: string
  email: string
  fullName: string
  jobTitle: string | null
  mustChangePassword: boolean
  mfaEnabled: boolean
  /** Two-factor login is required for this user but not yet set up */
  mfaSetupRequired: boolean
  memberships: Membership[]
  ip: string | null
}

/** Load the user's ACTIVE memberships and permissions (inside a user transaction). */
export async function loadMemberships(tx: Tx, userId: string): Promise<Membership[]> {
  const rows = await tx<{ org_id: string; code: string; name: string; role_key: string; role_name: string; requires_mfa: boolean; department: string | null; perms: string[] | null }[]>`
    select m.org_id, o.code, o.name, r.key as role_key, r.name as role_name, r.requires_mfa, d.name as department,
           array_remove(array_agg(rp.permission_key order by rp.permission_key), null) as perms
      from organization_memberships m
      join organizations o on o.id = m.org_id and o.is_active
      join roles r on r.id = m.role_id
      left join role_permissions rp on rp.role_id = r.id
      left join departments d on d.id = m.department_id
     where m.user_id = ${userId} and m.is_active
     group by m.org_id, o.code, o.name, r.key, r.name, r.requires_mfa, d.name
     order by o.name`
  return rows.map((r) => ({ orgId: r.org_id, orgCode: r.code, orgName: r.name, roleKey: r.role_key, roleName: r.role_name,
    roleRequiresMfa: r.requires_mfa, departmentName: r.department, permissions: r.perms ?? [] }))
}

/** Does the user hold `perm` in `orgId` (or in ANY company if orgId is omitted)? */
export function can(ctx: Pick<AuthContext, 'memberships'>, perm: string, orgId?: string | null): boolean {
  return ctx.memberships.some((m) => (orgId ? m.orgId === orgId : true) && m.permissions.includes(perm))
}

export function orgsWith(ctx: Pick<AuthContext, 'memberships'>, perm: string): string[] {
  return ctx.memberships.filter((m) => m.permissions.includes(perm)).map((m) => m.orgId)
}

export function canAny(ctx: Pick<AuthContext, 'memberships'>, perms: string[], orgId?: string | null) {
  return perms.some((p) => can(ctx, p, orgId))
}
