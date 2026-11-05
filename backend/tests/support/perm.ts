import { adminSql } from './helpers'

export async function hasPerm(userId: string, orgId: string, perm: string) {
  const [r] = await adminSql()<{ ok: boolean }[]>`select exists (select 1 from organization_memberships m where m.user_id = ${userId} and m.org_id = ${orgId} and m.is_active and app.role_has_perm(m.role_id, ${perm})) as ok`
  return r.ok
}
